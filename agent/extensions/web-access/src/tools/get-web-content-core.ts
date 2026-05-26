import type { StoredResponse, WebAccessCache } from "../cache.ts";
import type { PageContent, SearchResponse } from "../types.ts";
import { capText, formatCapDisclosure } from "../utils/caps.ts";
import { normalizeUrl } from "../utils/urls.ts";
import type { SearchResponsePayload } from "./search-core.ts";
import type { WebFetchResponsePayload } from "./web-fetch-core.ts";

export interface GetWebContentParams {
  responseId: string;
  url?: string;
  urlIndex?: number;
  query?: string;
  queryIndex?: number;
  offset?: number;
  maxChars?: number;
  full?: boolean;
}

export interface SelectedStoredContent {
  content: string;
  label: string;
  selector: string;
  fullLength: number;
  responseKind: string;
}

export function getStoredWebContent(cache: WebAccessCache, params: GetWebContentParams): string {
  const stored = cache.getResponse(params.responseId);
  if (!stored) throw new Error(`No stored web response found for responseId "${params.responseId}". It may be expired or mistyped.`);

  const selected = selectStoredContent(stored, params);
  if (params.full === true) {
    return [
      `responseId: "${params.responseId}"`,
      `Target: ${selected.label}`,
      `Response kind: ${selected.responseKind}`,
      `[Full content returned intentionally: chars 0-${selected.fullLength} of ${selected.fullLength}.]`,
      "",
      selected.content,
    ].join("\n");
  }

  const offset = nonNegativeInteger(params.offset, 0);
  const maxChars = positiveInteger(params.maxChars, 30_000);
  const capped = capText(selected.content, maxChars, offset);
  return [
    `responseId: "${params.responseId}"`,
    `Target: ${selected.label}`,
    `Response kind: ${selected.responseKind}`,
    `[Showing chars ${capped.offset}-${capped.end} of ${capped.fullLength}; returned ${capped.returnedLength} chars.]`,
    "",
    capped.text,
    "",
    formatCapDisclosure({ responseId: params.responseId, selector: selected.selector, capped }),
  ].join("\n");
}

export function selectStoredContent(stored: StoredResponse, params: GetWebContentParams): SelectedStoredContent {
  const payload = isRecord(stored.payload) ? stored.payload : { content: String(stored.payload) };

  if (payload.kind === "web_fetch" && Array.isArray(payload.pages)) {
    return selectPageContent(stored.kind, payload.pages as PageContent[], params);
  }

  if ((payload.kind === "web_search" || payload.kind === "code_search") && Array.isArray(payload.responses)) {
    return selectSearchContent(stored.kind, payload as unknown as SearchResponsePayload, params);
  }

  const content = typeof payload.content === "string" ? payload.content : JSON.stringify(payload, null, 2);
  return {
    content,
    label: stored.responseId,
    selector: "",
    fullLength: content.length,
    responseKind: stored.kind,
  };
}

function selectPageContent(responseKind: string, pages: PageContent[], params: GetWebContentParams): SelectedStoredContent {
  if (pages.length === 0) throw new Error("Stored web_fetch response contains no pages.");

  let index: number | undefined;
  if (params.urlIndex !== undefined) index = nonNegativeInteger(params.urlIndex, 0);
  if (params.url) {
    const target = safeNormalize(params.url);
    index = pages.findIndex((page) => page.url === params.url || safeNormalize(page.url) === target);
    if (index < 0) throw new Error(`URL not found in stored response: ${params.url}`);
  }

  if (index === undefined) {
    if (pages.length > 1) {
      throw new Error(`Stored web_fetch response has ${pages.length} pages. Specify urlIndex or url.`);
    }
    index = 0;
  }

  const page = pages[index];
  if (!page) throw new Error(`urlIndex ${index} is out of range for ${pages.length} page(s).`);

  return {
    content: page.markdown,
    label: page.title ? `${page.title} (${page.url})` : page.url,
    selector: `urlIndex: ${index}`,
    fullLength: page.markdown.length,
    responseKind,
  };
}

function selectSearchContent(responseKind: string, payload: SearchResponsePayload, params: GetWebContentParams): SelectedStoredContent {
  const responses = payload.responses as SearchResponse[];
  if (responses.length === 0) throw new Error("Stored search response contains no queries.");

  let index: number | undefined;
  if (params.queryIndex !== undefined) index = nonNegativeInteger(params.queryIndex, 0);
  if (params.query) {
    const query = params.query.trim();
    index = responses.findIndex((response) => response.query === query);
    if (index < 0) throw new Error(`Query not found in stored response: ${params.query}`);
  }

  if (index === undefined) {
    const content = payload.content ?? responses.map(renderSearchResponseForStorage).join("\n\n");
    return {
      content,
      label: responses.length === 1 ? `query: ${responses[0]!.query}` : `${responses.length} stored search queries`,
      selector: responses.length === 1 ? "queryIndex: 0" : "",
      fullLength: content.length,
      responseKind,
    };
  }

  const response = responses[index];
  if (!response) throw new Error(`queryIndex ${index} is out of range for ${responses.length} query result(s).`);
  const content = renderSearchResponseForStorage(response);
  return {
    content,
    label: `query: ${response.query}`,
    selector: `queryIndex: ${index}`,
    fullLength: content.length,
    responseKind,
  };
}

function renderSearchResponseForStorage(response: SearchResponse): string {
  const lines = [`Query: ${response.query}`, `Provider: ${response.provider}`, `Searched at: ${response.searchedAt}`];
  response.results.forEach((result, index) => {
    lines.push(`\n${index + 1}. ${result.title}`);
    lines.push(`URL: ${result.url}`);
    lines.push(`Domain: ${result.domain}`);
    if (result.publishedDate) lines.push(`Published: ${result.publishedDate}`);
    if (result.author) lines.push(`Author: ${result.author}`);
    if (result.snippet) lines.push(`Snippet:\n${result.snippet}`);
    if (result.highlights?.length) {
      lines.push("Highlights:");
      result.highlights.forEach((highlight) => lines.push(`- ${highlight}`));
    }
  });
  return lines.join("\n");
}

function safeNormalize(url: string): string {
  try {
    return normalizeUrl(url);
  } catch {
    return url;
  }
}

function nonNegativeInteger(value: unknown, defaultValue: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : defaultValue;
}

function positiveInteger(value: unknown, defaultValue: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
