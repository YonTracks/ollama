import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MarkdownContent,
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

  it("splits markdown headings even when models omit blank lines", () => {
    expect(splitMarkdownTextBlocks("Intro\n   ### Details\nUse `code` here")).toEqual([
      "Intro",
      "### Details",
      "Use `code` here"
    ]);
  });

  it("does not glue headings or paragraphs to following bullet lists", () => {
    expect(splitMarkdownTextBlocks("### Details\n* First\n* Second")).toEqual([
      "### Details",
      "* First\n* Second"
    ]);

    expect(splitMarkdownTextBlocks("Intro\n* First\n* Second\nOutro")).toEqual([
      "Intro",
      "* First\n* Second",
      "Outro"
    ]);
  });

  it("renders nested mixed lists from model markdown", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        content: [
          "1. Primary Circuit (The Conductor):",
          "    *   Component: A large, durable pump and reservoir system.",
          "    *   Function: Moves fluid ($\\mathbf{v}$) through the duct.",
          "2. Electromagnetic Circuit (The Field):",
          "    *   Component: Superconducting Magnet Coils."
        ].join("\n")
      })
    );

    expect(html).toContain("<ol");
    expect(html).toContain("<ul");
    expect(html).toContain("Primary Circuit");
    expect(html).toContain("<strong");
    expect(html).not.toContain("*   Component");
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

  it("parses italic text and backticks in the same line", () => {
    expect(parseInlineMarkdown("Use `text` with *emphasis* here")).toEqual([
      { type: "text", content: "Use " },
      { type: "code", content: "text" },
      { type: "text", content: " with " },
      { type: "emphasis", content: "emphasis" },
      { type: "text", content: " here" }
    ]);

    expect(parseInlineMarkdown("*text*")).toEqual([
      { type: "emphasis", content: "text" }
    ]);

    expect(
      parseInlineMarkdown(
        "Plasma is the *substance* or the *medium*, and MHD is the *theory* or the *tool* used to describe the physics of that substance."
      )
    ).toEqual([
      { type: "text", content: "Plasma is the " },
      { type: "emphasis", content: "substance" },
      { type: "text", content: " or the " },
      { type: "emphasis", content: "medium" },
      { type: "text", content: ", and MHD is the " },
      { type: "emphasis", content: "theory" },
      { type: "text", content: " or the " },
      { type: "emphasis", content: "tool" },
      { type: "text", content: " used to describe the physics of that substance." }
    ]);

    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        content:
          "Plasma is the *substance* or the *medium*, and MHD is the *theory* or the *tool* used to describe the physics of that substance."
      })
    );

    expect(html).toContain("<em");
    expect(html).not.toContain("*substance*");
    expect(html).not.toContain("*tool*");

    expect(
      parseInlineMarkdown(
        "Plasma is the \\*substance\\* or the \\*medium\\*, and MHD is the \\*theory\\* or the \\*tool\\* used to describe the physics of that substance."
      )
    ).toEqual([
      { type: "text", content: "Plasma is the " },
      { type: "emphasis", content: "substance" },
      { type: "text", content: " or the " },
      { type: "emphasis", content: "medium" },
      { type: "text", content: ", and MHD is the " },
      { type: "emphasis", content: "theory" },
      { type: "text", content: " or the " },
      { type: "emphasis", content: "tool" },
      { type: "text", content: " used to describe the physics of that substance." }
    ]);

    expect(
      parseInlineMarkdown(
        "Plasma is the \\\\*substance\\\\* or the \\*medium* of the model."
      )
    ).toEqual([
      { type: "text", content: "Plasma is the " },
      { type: "emphasis", content: "substance" },
      { type: "text", content: " or the " },
      { type: "emphasis", content: "medium" },
      { type: "text", content: " of the model." }
    ]);
  });

  it("renders escaped markdown markers as literal text", () => {
    expect(parseInlineMarkdown("literal \\* marker and \\`tick\\` and \\| pipe")).toEqual([
      { type: "text", content: "literal * marker and `tick` and | pipe" }
    ]);
  });

  it("normalizes supported latex-style inline commands", () => {
    expect(parseInlineMarkdown("$\\mathbf{v} \\cdot \\mathbf{v}$")).toEqual([
      {
        type: "math",
        content: [
          { type: "strong", content: "v" },
          { type: "text", content: " \u00b7 " },
          { type: "strong", content: "v" }
        ]
      }
    ]);

    expect(parseInlineMarkdown("\\textbf{Move} $\\rightarrow$ next")).toEqual([
      { type: "strong", content: "Move" },
      { type: "text", content: " " },
      { type: "math", content: [{ type: "text", content: "\u2192" }] },
      { type: "text", content: " next" }
    ]);

    expect(parseInlineMarkdown("$\\text{Action} (S) = \\int d^4x \\mathcal{L}$")).toEqual([
      {
        type: "math",
        content: [{ type: "text", content: "Action (S) = \u222b d\u2074x \u2112" }]
      }
    ]);

    expect(parseInlineMarkdown("The Lagrangian (\\mathcal{L})")).toEqual([
      { type: "text", content: "The Lagrangian (\u2112)" }
    ]);

    expect(parseInlineMarkdown("(\\mathcal{E} = -\\frac{d\\Phi_B}{dt})")).toEqual([
      { type: "text", content: "(\u2130 = -d\u03a6_B/dt)" }
    ]);
  });
});
