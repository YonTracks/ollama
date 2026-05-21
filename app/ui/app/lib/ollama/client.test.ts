import { afterEach, describe, expect, it, vi } from "vitest";
import {
  branchChat,
  deleteAllChats,
  deleteChat,
  deleteChatMessage,
  fetchConnectUrl,
  fetchUser,
  getApiBase,
  getSecurityStatus,
  listModels,
  sendChat,
  OllamaClientError
} from "./client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Ollama client", () => {
  it("selects the desktop API base without reading the standalone core API base", () => {
    vi.stubEnv("NEXT_PUBLIC_OLLAMA_CORE_API_BASE", "http://127.0.0.1:11434");
    vi.stubEnv("NODE_ENV", "production");
    expect(getApiBase()).toBe("");

    vi.stubEnv("NODE_ENV", "development");
    expect(getApiBase()).toBe("http://127.0.0.1:3001");

    vi.stubEnv("NEXT_PUBLIC_OLLAMA_API_BASE", "http://127.0.0.1:4555/");
    expect(getApiBase()).toBe("http://127.0.0.1:4555");
  });

  it("turns unreachable model listing failures into a clear client error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))
    );

    await expect(listModels()).rejects.toMatchObject({
      name: "OllamaClientError",
      code: "unreachable"
    });
  });

  it("parses streamed chat events without buffering private prompt data", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            '{"eventName":"chat_created","chatId":"abc"}\n{"eventName":"chat","content":"hello"}\n{"eventName":"done"}\n'
          )
        );
        controller.close();
      }
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(stream, { status: 200 })))
    );

    const events = [];
    for await (const event of sendChat("new", { model: "llama3.2", prompt: "hi" })) {
      events.push(event);
    }

    expect(events).toEqual([
      { eventName: "chat_created", chatId: "abc" },
      { eventName: "chat", content: "hello" },
      { eventName: "done" }
    ]);
  });

  it("sends attachments to the desktop chat API using the existing backend shape", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"eventName":"done"}\n'));
        controller.close();
      }
    });

    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      {
        void _url;
        void _init;
        return Promise.resolve(new Response(stream, { status: 200 }));
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    for await (const event of sendChat("new", {
      model: "llava",
      prompt: "describe this",
      attachments: [
        {
          id: "image",
          name: "image.png",
          mimeType: "image/png",
          size: 10,
          kind: "image",
          data: "abc123"
        },
        {
          id: "notes",
          name: "notes.md",
          mimeType: "text/markdown",
          size: 7,
          kind: "text",
          text: "# Notes"
        }
      ]
    })) {
      void event;
    }

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.attachments).toEqual([
      { filename: "image.png", data: "abc123" },
      { filename: "notes.md", data: "IyBOb3Rlcw==" }
    ]);
  });

  it("keeps HTTP failures typed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Ollama server is not ready" }), {
            status: 503
          })
        )
      )
    );

    await expect(listModels()).rejects.toBeInstanceOf(OllamaClientError);
    await expect(listModels()).rejects.toMatchObject({ status: 503, code: "http" });
  });

  it("accepts empty successful API responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
    );

    await expect(deleteChat("chat-id")).resolves.toBeUndefined();
  });

  it("branches chats and deletes individual messages through app routes", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            chat: {
              id: "branch-id",
              title: "Branch",
              messages: [{ role: "user", content: "hello" }]
            }
          }),
          { status: 200 }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(branchChat("chat-id", 2)).resolves.toMatchObject({
      chat: { id: "branch-id", title: "Branch" }
    });
    await expect(deleteChatMessage("chat-id", 1)).resolves.toMatchObject({
      chat: { id: "branch-id", messages: [{ role: "user", content: "hello" }] }
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/api/v1/chat/chat-id/branch"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ messageIndex: 2 })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/v1/chat/chat-id/message/1"),
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("reads account state from the non-failing app user endpoint", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ user: null, signin_url: "https://ollama.com/connect" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchUser()).resolves.toBeNull();
    await expect(fetchConnectUrl()).resolves.toBe("https://ollama.com/connect");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/user"),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("reads security status from the desktop diagnostics endpoint", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            mode: "desktop",
            coreApiBase: "http://127.0.0.1:11434",
            coreApiReachable: true,
            coreApiHostLocal: true,
            coreApiHostAllowed: true,
            desktopAuthEnabled: true,
            devMode: false,
            localOnlyOfflineMode: false,
            cloudDisabled: false,
            cloudSource: "surprise",
            networkExposureAllowed: false,
            modelMutationProxyEnabled: false,
            pushProxyEnabled: false,
            browserOriginsEnabled: false,
            proxyAllowedUpstreams: null,
            warnings: null
          }),
          { status: 200 }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSecurityStatus()).resolves.toMatchObject({
      mode: "desktop",
      coreApiReachable: true,
      cloudSource: "none",
      proxyAllowedUpstreams: [],
      warnings: []
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/security"),
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("deletes every chat returned by the chat list", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/api/v1/chats")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              chatInfos: [
                { id: "chat-a", title: "A", userExcerpt: "", createdAt: "", updatedAt: "" },
                { id: "chat-b", title: "B", userExcerpt: "", createdAt: "", updatedAt: "" }
              ]
            }),
            { status: 200 }
          )
        );
      }

      return Promise.resolve(new Response(null, { status: 200 }));
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteAllChats()).resolves.toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/v1/chat/chat-a"),
      expect.objectContaining({ method: "DELETE" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/api/v1/chat/chat-b"),
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
