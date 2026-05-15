import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listStandaloneModels,
  sendStandaloneChat,
  DEFAULT_CORE_API_BASE
} from "./standalone";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("standalone Ollama client", () => {
  it("lists models from the core /api/tags endpoint", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void url;
      void init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            models: [
              {
                name: "llama3.2:latest",
                digest: "abc",
                size: 1024,
                details: { families: ["llama"] }
              }
            ]
          }),
          { status: 200 }
        )
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(listStandaloneModels()).resolves.toMatchObject([
      { name: "llama3.2", local: true }
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_CORE_API_BASE}/api/tags`,
      expect.objectContaining({ cache: "no-store" })
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("/api/v1/");
  });

  it("streams chat from the core /api/chat endpoint without using desktop APIs", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            '{"message":{"thinking":"hmm"},"done":false}\n{"message":{"content":"hello"},"done":false}\n{"done":true}\n'
          )
        );
        controller.close();
      }
    });

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void url;
      void init;
      return Promise.resolve(new Response(stream, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of sendStandaloneChat(
      undefined,
      "llama3.2",
      [{ id: "msg", role: "user", content: "hi", status: "complete" }],
      true
    )) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_CORE_API_BASE}/api/chat`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "llama3.2",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
          think: true
        })
      })
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("/api/v1/");
    expect(events[0]).toMatchObject({ eventName: "thinking", thinking: "hmm" });
    expect(events[1]).toMatchObject({ eventName: "thinking", thinking: "" });
    expect(events[2]).toMatchObject({ eventName: "chat", content: "hello" });
    expect(events.at(-1)).toMatchObject({ eventName: "done" });
  });
});
