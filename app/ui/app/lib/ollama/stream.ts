export async function* parseJsonlStream<T>(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<T> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        const finalLine = buffer.trim();
        if (finalLine) {
          yield JSON.parse(finalLine) as T;
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          yield JSON.parse(trimmed) as T;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* parseJsonlResponse<T>(response: Response): AsyncGenerator<T> {
  if (!response.body) {
    throw new Error("The Ollama response did not include a stream body.");
  }

  yield* parseJsonlStream<T>(response.body);
}
