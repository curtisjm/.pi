import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { WebAccessCache } from "../cache.ts";
import { getStoredWebContent, type GetWebContentParams } from "./get-web-content-core.ts";

export interface GetWebContentToolDeps {
  getCache: () => WebAccessCache;
}

export function registerGetWebContentTool(pi: ExtensionAPI, deps: GetWebContentToolDeps): void {
  pi.registerTool({
    name: "get_web_content",
    label: "Get Web Content",
    description:
      "Retrieve stored web_search/code_search/web_fetch content by responseId. Capped by default; full: true intentionally returns all stored content with no hard cap.",
    promptSnippet: "Retrieve stored full/capped content from prior web_search/code_search/web_fetch results by responseId.",
    promptGuidelines: [
      "Use get_web_content when a previous web tool result says content was capped or stored under a responseId.",
      "Do not request get_web_content with full: true unless the full stored content is necessary; prefer offsets/chunks for very large pages.",
    ],
    parameters: Type.Object({
      responseId: Type.String({ description: "Response ID from a prior web tool call" }),
      url: Type.Optional(Type.String()),
      urlIndex: Type.Optional(Type.Number({ minimum: 0 })),
      query: Type.Optional(Type.String()),
      queryIndex: Type.Optional(Type.Number({ minimum: 0 })),
      offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
      maxChars: Type.Optional(Type.Number({ minimum: 1, default: 30_000 })),
      full: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params: GetWebContentParams) {
      const text = getStoredWebContent(deps.getCache(), params);
      return {
        content: [{ type: "text" as const, text }],
        details: {
          responseId: params.responseId,
          full: params.full === true,
          offset: params.offset ?? 0,
          maxChars: params.maxChars ?? 30_000,
        },
      };
    },
  });
}
