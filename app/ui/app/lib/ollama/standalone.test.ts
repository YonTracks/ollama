import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStandaloneModel,
  deleteStandaloneModel,
  listStandaloneModels,
  pullStandaloneModel,
  sendStandaloneChat,
  standaloneBlobExists,
  uploadStandaloneBlob,
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
    expect(events[0]).toMatchObject({ eventName: "thinking", thinking: "hmm" });
    expect(events[1]).toMatchObject({ eventName: "thinking", thinking: "" });
    expect(events[2]).toMatchObject({ eventName: "chat", content: "hello" });
    expect(events.at(-1)).toMatchObject({ eventName: "done" });
  });

  it("captures final usage metrics from split streaming chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"message":{"content":"hel'));
        controller.enqueue(
          encoder.encode(
            'lo"},"done":false}\n{"done":true,"total_duration":2000000000,"load_duration":100000000,"prompt_eval_count":12,'
          )
        );
        controller.enqueue(
          encoder.encode(
            '"prompt_eval_duration":1000000000,"eval_count":24,"eval_duration":2000000000,"done_reason":"stop"}\n'
          )
        );
        controller.close();
      }
    });

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void init;
      if (url.endsWith("/api/ps")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              models: [{ model: "llama3.2:latest", context_length: 32768 }]
            }),
            { status: 200 }
          )
        );
      }

      return Promise.resolve(new Response(stream, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of sendStandaloneChat(
      undefined,
      "llama3.2",
      [{ id: "msg", role: "user", content: "hi", status: "complete" }],
      false
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({ eventName: "chat", content: "hello" }),
      expect.objectContaining({
        eventName: "done",
        stats: expect.objectContaining({
          outputTokens: 24,
          promptTokens: 12,
          contextUsed: 36,
          contextLimit: 32768,
          outputTokensPerSecond: 12,
          promptTokensPerSecond: 12,
          totalSeconds: 2,
          loadSeconds: 0.1,
          doneReason: "stop"
        })
      })
    ]);
    expect(events).not.toContainEqual(expect.objectContaining({ content: undefined }));
  });

  it("serializes image and text attachments into Ollama chat messages", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"done":true}\n'));
        controller.close();
      }
    });

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void url;
      return Promise.resolve(new Response(stream, { status: 200, headers: init?.headers }));
    });
    vi.stubGlobal("fetch", fetchMock);

    for await (const event of sendStandaloneChat(
      undefined,
      "llava",
      [
        {
          id: "msg",
          role: "user",
          content: "What is in this?",
          status: "complete",
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
              size: 20,
              kind: "text",
              text: "# Notes"
            }
          ]
        }
      ],
      false
    )) {
      void event;
    }

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages[0]).toMatchObject({
      role: "user",
      images: ["abc123"]
    });
    expect(body.messages[0].content).toContain("What is in this?");
    expect(body.messages[0].content).toContain("Attached file: notes.md");
    expect(body.messages[0].content).toContain("# Notes");
  });

  it("uses generate directly for recognized image generation models", async () => {
    const generateStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            '{"model":"x/flux2-klein","completed":20,"total":20,"done":false}\n{"model":"x/flux2-klein","image":"iVBORw0KGgo=","done":true}\n'
          )
        );
        controller.close();
      }
    });

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void url;
      void init;
      return Promise.resolve(new Response(generateStream, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of sendStandaloneChat(
      undefined,
      "x/flux2-klein",
      [{ id: "msg", role: "user", content: "a neon sign", status: "complete" }],
      false,
      { width: 768, height: 1024, steps: 24 }
    )) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_CORE_API_BASE}/api/generate`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "x/flux2-klein",
          prompt: "a neon sign",
          width: 768,
          height: 1024,
          steps: 24,
          stream: true,
          think: false
        })
      })
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("/api/v1/");
    expect(events).toContainEqual(
      expect.objectContaining({
        eventName: "chat",
        attachments: [
          expect.objectContaining({
            kind: "image",
            data: "iVBORw0KGgo="
          })
        ]
      })
    );
    expect(events.at(-1)).toMatchObject({ eventName: "done" });
  });

  it("streams model pull and create operations", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            '{"status":"pulling manifest"}\n{"status":"success"}\n'
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
    for await (const event of pullStandaloneModel("llama3.2")) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_CORE_API_BASE}/api/pull`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "llama3.2", stream: true })
      })
    );
    expect(events.at(-1)).toMatchObject({ status: "success" });
  });

  it("creates, deletes, checks, and uploads imported model blobs", async () => {
    const createStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"status":"success"}\n'));
        controller.close();
      }
    });

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/create")) {
        return Promise.resolve(new Response(createStream, { status: 200 }));
      }
      if (url.includes("/blobs/") && init?.method === "HEAD") {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      if (url.includes("/blobs/") && init?.method === "POST") {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    for await (const event of createStandaloneModel({
      model: "mario",
      from: "llama3.2",
      system: "You are Mario."
    })) {
      void event;
    }

    await expect(standaloneBlobExists("sha256:abc")).resolves.toBe(false);
    await expect(uploadStandaloneBlob("sha256:abc", new Blob(["gguf"]))).resolves.toBeUndefined();
    await expect(deleteStandaloneModel("mario")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_CORE_API_BASE}/api/create`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "mario",
          from: "llama3.2",
          system: "You are Mario.",
          stream: true
        })
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_CORE_API_BASE}/api/delete`,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ model: "mario" })
      })
    );
  });

  it("falls back to generate when an unknown model does not support chat", async () => {
    const generateStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"response":"done","done":true}\n'));
        controller.close();
      }
    });

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void init;
      if (url.endsWith("/chat")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: '"custom-model" does not support chat' }), {
            status: 400
          })
        );
      }

      return Promise.resolve(new Response(generateStream, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of sendStandaloneChat(
      undefined,
      "custom-model",
      [{ id: "msg", role: "user", content: "write a caption", status: "complete" }],
      false
    )) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_CORE_API_BASE}/api/chat`,
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_CORE_API_BASE}/api/generate`,
      expect.objectContaining({ method: "POST" })
    );
    expect(events).toContainEqual(expect.objectContaining({ content: "done" }));
  });
});
