export async function* streamToIterable(completion: any) {
  yield `data: ${completion.choices[0].message.content}`;
}