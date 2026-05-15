import { describe, expect, it } from "vitest";
import {
  buildMessageContentWithAttachments,
  getImagePayloads,
  imageAttachmentDataUrl
} from "./attachments";
import type { ChatAttachment } from "./types";

describe("attachment helpers", () => {
  it("collects image payloads for Ollama vision requests", () => {
    const attachments: ChatAttachment[] = [
      {
        id: "image",
        name: "board.png",
        mimeType: "image/png",
        size: 10,
        kind: "image",
        data: "abc123"
      },
      {
        id: "file",
        name: "notes.md",
        mimeType: "text/markdown",
        size: 5,
        kind: "text",
        text: "hello"
      }
    ];

    expect(getImagePayloads(attachments)).toEqual(["abc123"]);
    expect(imageAttachmentDataUrl(attachments[0])).toBe("data:image/png;base64,abc123");
  });

  it("adds readable file contents to the prompt", () => {
    expect(
      buildMessageContentWithAttachments("Summarize this", [
        {
          id: "notes",
          name: "notes.md",
          mimeType: "text/markdown",
          size: 14,
          kind: "text",
          text: "# Notes",
          truncated: true
        },
        {
          id: "archive",
          name: "archive.zip",
          mimeType: "application/zip",
          size: 512,
          kind: "file"
        }
      ])
    ).toContain("Attached file: notes.md (truncated)\n```\n# Notes\n```");
  });
});
