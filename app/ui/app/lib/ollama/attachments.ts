import type { ChatAttachment } from "./types";

export function getImagePayloads(attachments?: ChatAttachment[]) {
  return (
    attachments
      ?.filter((attachment) => attachment.kind === "image" && attachment.data)
      .map((attachment) => attachment.data as string) ?? []
  );
}

export function imageAttachmentDataUrl(attachment: ChatAttachment) {
  if (!attachment.data) return "";
  return `data:${attachment.mimeType || "image/*"};base64,${attachment.data}`;
}

export function buildMessageContentWithAttachments(
  content: string,
  attachments?: ChatAttachment[]
) {
  const textAttachments =
    attachments?.filter(
      (attachment) => attachment.kind === "text" && attachment.text?.trim()
    ) ?? [];
  const metadataOnlyAttachments =
    attachments?.filter((attachment) => attachment.kind === "file") ?? [];

  if (textAttachments.length === 0 && metadataOnlyAttachments.length === 0) {
    return content;
  }

  const sections = textAttachments.map((attachment) => {
    const truncation = attachment.truncated ? " (truncated)" : "";
    return [
      `Attached file: ${attachment.name}${truncation}`,
      "```",
      attachment.text,
      "```"
    ].join("\n");
  });

  if (metadataOnlyAttachments.length > 0) {
    sections.push(
      [
        "Attached files without readable text content:",
        metadataOnlyAttachments.map((attachment) => `- ${attachment.name}`).join("\n")
      ].join("\n")
    );
  }

  return [content.trim(), ...sections].filter(Boolean).join("\n\n");
}
