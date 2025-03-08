export async function* streamToIterable(completion: any) {
  yield `data: ${completion.choices[0].message.content}`;
}

// export async function* streamToIterable(completion: any) {
//   const content = completion.choices[0].message.content;

//   // Simulate the structure of streamed responses
//   const payloads = content.split('\n\n').map((chunk) => `data: ${chunk}`);

//   for (const payload of payloads) {
//     yield payload;
//   }

//   yield 'data: [DONE]';
// }
// export async function* fakeStreamFromCompletion(completion: any) {
//   let previous = '';
//   for await (const chunk of resolvedStream) {
//     let eolIndex;
//     while ((eolIndex = previous.indexOf('\n')) >= 0) {
//       // line includes the EOL
//       const line = previous.slice(0, eolIndex + 1).trimEnd();
//       console.log(line)
//       if (line.startsWith('data: ')) yield line;
//       previous = previous.slice(eolIndex + 1);
//     }
//   }
//   // yield `${completion.choices[0].message.content}`;
// }

/*

  const resolvedStream = await stream;
  let previous = '';
  for await (const chunk of resolvedStream) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    previous += bufferChunk.toString();
    console.log(chunk);
    let eolIndex;
    while ((eolIndex = previous.indexOf('\n')) >= 0) {
      // line includes the EOL
      const line = previous.slice(0, eolIndex + 1).trimEnd();
      if (line.startsWith('data: ')) yield line;
      previous = previous.slice(eolIndex + 1);
    }
  }
}
*/