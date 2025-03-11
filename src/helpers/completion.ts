import { Mistral } from "@mistralai/mistralai";
import { ChatCompletionRequest } from "@mistralai/mistralai/models/components";
import dedent from 'dedent';
import { IncomingMessage } from 'http';
import { KnownError } from './error';
import { detectShell } from './os-detect';
import type { AxiosError } from 'axios';
import { streamToString } from './stream-to-string';
import './replace-all-polyfill';
import i18n from './i18n';
import { stripRegexPatterns } from './strip-regex-patterns';
import readline from 'readline';
import { streamToIterable } from "./event-stream-to-iterable";

const explainInSecondRequest = true;

function getMistralClient(key: string) {
  return new Mistral({
    apiKey: key,
  });
}

// outputs markdown format for code blocks. It oftne uses
// a github style like: "```bash"
const shellCodeExclusions = [/```[a-zA-Z]*\n/gi, /```/g, '\n'];

export async function getScriptAndInfo({
  prompt,
  key,
  model,
}: {
  prompt: string;
  key: string;
  model?: string;
}) {
  const fullPrompt = getFullPrompt(prompt);
  const completion = await generateCompletion({
    prompt: fullPrompt,
    number: 1,
    key,
    model,
  });
  const iterableStream = streamToIterable(completion);
  return {
    readScript: readData(iterableStream, ...shellCodeExclusions),
    readInfo: readData(iterableStream, ...shellCodeExclusions),
  };
}

export async function generateCompletion({
  prompt,
  number = 1,
  key,
  model,
}: {
  prompt: string | ChatCompletionRequest[];
  number?: number;
  model?: string;
  key: string;
}) {
  const mistral = getMistralClient(key);
  try {

    const completion = await mistral.chat.complete({
      model: model || "mistral-small-latest",
      stream: false, // Get full response
      messages: Array.isArray(prompt)
        ? prompt.flatMap(req => req.messages) // Flatten all messages from multiple requests
        : [{ role: "user", content: String(prompt) }],
      n: Math.min(number, 10),
    });

    return completion;
  } catch (err) {
    const error = err as AxiosError;

    if (error.code === 'ENOTFOUND') {
      throw new KnownError(
        `Error connecting to ${error.request.hostname} (${error.request.syscall}). Are you connected to the internet?`
      );
    }

    const response = error.response;
    let message = response?.data as string | object | IncomingMessage;
    if (response && message instanceof IncomingMessage) {
      message = await streamToString(
        response.data as unknown as IncomingMessage
      );
      try {
        // Handle if the message is JSON. It should be but occasionally will
        // be HTML, so lets handle both
        message = JSON.parse(message);
      } catch (e) {
        // Ignore
      }
    }

    const messageString = message && JSON.stringify(message, null, 2);
    if (response?.status === 429) {
      throw new KnownError(
        dedent`
        Request to Mistral failed with status 429. This is due to incorrect billing setup or excessive quota usage. Make sure to add a payment method if not under an active grant from Mistral.

        Full message from Mistral:
      ` +
        '\n\n' +
        messageString +
        '\n'
      );
    } else if (response && message) {
      throw new KnownError(
        dedent`
        Request to Mistral failed with status ${response?.status}:
      ` +
        '\n\n' +
        messageString +
        '\n'
      );
    }

    throw error;
  }
}

export async function getExplanation({
  script,
  key,
  model,
}: {
  script: string;
  key: string;
  model?: string;
}) {
  const prompt = getExplanationPrompt(script);
  const completion = await generateCompletion({
    prompt,
    key,
    number: 1,
    model,
  });
  const iterableStream = streamToIterable(completion);
  return { readExplanation: readData(iterableStream) };
}

export async function getRevision({
  prompt,
  code,
  key,
  model,
}: {
  prompt: string;
  code: string;
  key: string;
  model?: string;
}) {
  const fullPrompt = getRevisionPrompt(prompt, code);
  const completion = await generateCompletion({
    prompt: fullPrompt,
    key,
    number: 1,
    model,
  });
  const iterableStream = streamToIterable(completion);
  return {
    readScript: readData(iterableStream, ...shellCodeExclusions),
  };
}

export const readData =
  (
    iterableStream: AsyncGenerator<string, void>,
    ...excluded: (RegExp | string | undefined)[]
  ) =>
    (writer: (data: string) => void): Promise<string> =>
      new Promise(async (resolve) => {
        let stopTextStream = false;
        let data = '';
        let content = '';
        let dataStart = false;

        const [excludedPrefix] = excluded;
        const stopTextStreamKeys = ['q', 'escape']; //Group of keys that stop the text stream

        const rl = readline.createInterface({
          input: process.stdin,
        });

        process.stdin.setRawMode(true);

        process.stdin.on('keypress', (key, data) => {
          if (stopTextStreamKeys.includes(data.name)) {
            stopTextStream = true;
          }
        });
        for await (const chunk of iterableStream) {
          const payloads = chunk.toString().split('\n\n');
          for (const payload of payloads) {
            if (stopTextStream) {
              dataStart = false;
              resolve(data);
              return;
            }
            content = parseContent(payload);

            if (!dataStart) {
              dataStart = true;
            }

            if (dataStart && content) {
              const contentWithoutExcluded = stripRegexPatterns(
                content,
                excluded
              );

              data += contentWithoutExcluded;
              writer(contentWithoutExcluded);
            }
          }
        }

        function parseContent(payload: string): string {
          const data = payload.replaceAll(/(\n)?^data:\s*/g, '');
          try {
            return data ?? '';
          } catch (error) {
            return `Error with JSON.parse and ${payload}.\n${error}`;
          }
        }

        resolve(data);
      });

function getExplanationPrompt(script: string) {
  return dedent`
    ${explainScript} Please reply in ${i18n.getCurrentLanguagenName()}

    The script: ${script}
  `;
}

function getShellDetails() {
  const shellDetails = detectShell();

  return dedent`
      The target shell is ${shellDetails}
  `;
}
const shellDetails = getShellDetails();

const explainScript = dedent`
  Please provide a clear, concise description of the script, using minimal words. Outline the steps in a list format.
`;

function getOperationSystemDetails() {
  const os = require('@nexssp/os/legacy');
  return os.name();
}
const generationDetails = dedent`
    Only reply with the single line command surrounded by three backticks. It must be able to be directly run in the target shell. Do not include any other text.

    Make sure the command runs on ${getOperationSystemDetails()} operating system.
  `;

function getFullPrompt(prompt: string) {
  return dedent`
    Create a single line command that one can enter in a terminal and run, based on what is specified in the prompt.

    ${shellDetails}

    ${generationDetails}

    ${explainInSecondRequest ? '' : explainScript}

    The prompt is: ${prompt}
  `;
}

function getRevisionPrompt(prompt: string, code: string) {
  return dedent`
    Update the following script based on what is asked in the following prompt.

    The script: ${code}

    The prompt: ${prompt}

    ${generationDetails}
  `;
}