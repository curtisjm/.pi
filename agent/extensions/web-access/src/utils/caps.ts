export interface CappedText {
  text: string;
  fullLength: number;
  returnedLength: number;
  offset: number;
  end: number;
  capped: boolean;
  hasMore: boolean;
}

export function capText(text: string, maxChars: number, offset = 0): CappedText {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const safeMax = Math.max(0, maxChars);
  const end = Math.min(text.length, safeOffset + safeMax);
  const slice = text.slice(safeOffset, end);
  return {
    text: slice,
    fullLength: text.length,
    returnedLength: slice.length,
    offset: safeOffset,
    end,
    capped: safeOffset > 0 || end < text.length,
    hasMore: end < text.length,
  };
}

export function formatCapDisclosure(args: {
  responseId: string;
  selector?: string;
  capped: CappedText;
  toolName?: "get_web_content";
}): string {
  const toolName = args.toolName ?? "get_web_content";
  const selector = args.selector ? `, ${args.selector}` : "";
  const nextOffset = args.capped.end;
  const lines = [
    `[Content capped: showing chars ${args.capped.offset}-${args.capped.end} of ${args.capped.fullLength}.]`,
    `Full content is stored as responseId "${args.responseId}".`,
  ];

  if (args.capped.hasMore) {
    lines.push(
      `To retrieve the next chunk: ${toolName}({ responseId: "${args.responseId}"${selector}, offset: ${nextOffset}, maxChars: 30000 })`,
    );
  }

  lines.push(
    `To retrieve all content intentionally: ${toolName}({ responseId: "${args.responseId}"${selector}, full: true })`,
  );

  return lines.join("\n");
}

export function clampInteger(value: unknown, defaultValue: number, max: number, min = 1): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : defaultValue;
  return Math.max(min, Math.min(max, numeric));
}
