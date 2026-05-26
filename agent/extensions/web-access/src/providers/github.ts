import type { FetchOptions, GitHubProvider, GitHubRoute, PageContent } from "../types.ts";
import { parseGitHubUrl } from "../utils/urls.ts";

export { parseGitHubUrl } from "../utils/urls.ts";

export class GitHubUrlProvider implements GitHubProvider {
  canHandle(url: string): GitHubRoute | null {
    return parseGitHubUrl(url);
  }

  async fetchGitHub(_url: string, _options?: FetchOptions): Promise<PageContent> {
    throw new Error("GitHub provider execution is not implemented until Phase 6.");
  }
}
