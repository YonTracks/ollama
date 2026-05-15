import { describe, expect, it } from "vitest";
import {
  parseInlineMarkdown,
  parseMarkdownContent,
  splitMarkdownTextBlocks
} from "./MarkdownContent";

describe("parseMarkdownContent", () => {
  it("splits fenced code blocks from surrounding text", () => {
    expect(
      parseMarkdownContent("Use this:\n```ts\nconst value = 1;\n```\nDone.")
    ).toEqual([
      { type: "text", content: "Use this:\n" },
      { type: "code", language: "ts", content: "const value = 1;" },
      { type: "text", content: "\nDone." }
    ]);
  });

  it("keeps plain text as a text part", () => {
    expect(parseMarkdownContent("hello `code`")).toEqual([
      { type: "text", content: "hello `code`" }
    ]);
  });

  it("splits loose model markdown into readable blocks", () => {
    const markdown = [
      "**Semi-Hollow Body Guitar (Upper Center):** This is the most prominent guitar.",
      "**Solid Body Guitar (Lower Right):** This guitar is light-colored.",
      "**Partial Guitar (Lower Left):** The headstock and neck of a third guitar are visible.",
      "\uD83D\uDD0A Equipment and Accessories",
      "**Amplifiers/Cabinets:** There are several stacked pieces of black electronic equipment.",
      "**Cables and Pedals:** Various colored cables and electronic components are scattered across the top.",
      "\uD83E\uDDFA Foreground and Context",
      "The bottom left and bottom right of the image contain various draped items.",
      "**In summary, the image is a snapshot of musical gear.**"
    ].join("\n");

    expect(splitMarkdownTextBlocks(markdown)).toEqual([
      "**Semi-Hollow Body Guitar (Upper Center):** This is the most prominent guitar.",
      "**Solid Body Guitar (Lower Right):** This guitar is light-colored.",
      "**Partial Guitar (Lower Left):** The headstock and neck of a third guitar are visible.",
      "\uD83D\uDD0A Equipment and Accessories",
      "**Amplifiers/Cabinets:** There are several stacked pieces of black electronic equipment.",
      "**Cables and Pedals:** Various colored cables and electronic components are scattered across the top.",
      "\uD83E\uDDFA Foreground and Context",
      "The bottom left and bottom right of the image contain various draped items.",
      "**In summary, the image is a snapshot of musical gear.**"
    ]);
  });

  it("keeps list and table lines together", () => {
    expect(splitMarkdownTextBlocks("- **One:** item\n- **Two:** item")).toEqual([
      "- **One:** item\n- **Two:** item"
    ]);

    expect(splitMarkdownTextBlocks("| A | B |\n| --- | --- |\n| **One:** | two |")).toEqual([
      "| A | B |\n| --- | --- |\n| **One:** | two |"
    ]);
  });
});

describe("parseInlineMarkdown", () => {
  it("parses bold and inline code without mixing them", () => {
    expect(parseInlineMarkdown("**Title:** use `const value = 1` now")).toEqual([
      { type: "strong", content: "Title:" },
      { type: "text", content: " use " },
      { type: "code", content: "const value = 1" },
      { type: "text", content: " now" }
    ]);
  });
});
