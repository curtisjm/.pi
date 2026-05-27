export type ProviderKeyStatus = "present" | "missing";
export type ExecutableStatus = "available" | "unavailable";

export type SearchProviderName = "exa";
export type FetchMode = "auto" | "direct" | "firecrawl" | "github";

export interface WebAccessTtls {
  searchTtlHours: number;
  pageTtlHours: number;
  githubBranchCloneTtlHours: number;
  githubCommitCloneTtlHours: number;
  responseTtlHours: number;
}

export interface WebAccessConfig {
  envPath: string;
  cacheDbPath: string;
  keys: {
    exa: ProviderKeyStatus;
    firecrawl: ProviderKeyStatus;
    githubToken: ProviderKeyStatus;
  };
  ttls: WebAccessTtls;
}

export interface SearchOptions {
  provider?: SearchProviderName;
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  recency?: "day" | "week" | "month" | "year";
  forceRefresh?: boolean;
  kind?: "web" | "code";
  maxCharacters?: number;
}

export interface SearchResponse {
  query: string;
  provider: SearchProviderName;
  searchedAt: string;
  cacheHit: boolean;
  results: SearchResult[];
}

export interface SearchResult {
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  highlights?: string[];
  publishedDate?: string;
  author?: string;
}

export interface FetchOptions {
  fetchMode?: FetchMode;
  forceRefresh?: boolean;
  onlyMainContent?: boolean;
  waitForMs?: number;
  timeoutMs?: number;
}

export interface PageContent {
  url: string;
  title: string | null;
  markdown: string;
  source:
    | "cache"
    | "direct-http"
    | "firecrawl"
    | "github-clone"
    | "github-api"
    | "github-gh";
  fetchedAt: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
}

export interface SearchProvider {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
}

export interface PageFetcher {
  fetchPage(url: string, options?: FetchOptions): Promise<PageContent>;
}

export type GitHubRouteKind = "repo" | "tree" | "blob" | "issue" | "pull";

export interface GitHubRoute {
  kind: GitHubRouteKind;
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
  number?: number;
}

export interface GitHubProvider {
  canHandle(url: string): GitHubRoute | null;
  fetchGitHub(url: string, options?: FetchOptions): Promise<PageContent>;
}
