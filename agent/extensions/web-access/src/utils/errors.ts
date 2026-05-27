export class WebAccessError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WebAccessError";
  }
}

export class MissingProviderKeyError extends WebAccessError {
  constructor(provider: string, envVar: string) {
    super(`${provider} is required for this request but ${envVar} is missing. Add it to agent/.env or the environment.`, "missing_provider_key", {
      provider,
      envVar,
    });
    this.name = "MissingProviderKeyError";
  }
}

export class DirectFetchRejectedError extends WebAccessError {
  constructor(message = "Direct fetch did not produce agent-friendly content") {
    super(message, "direct_fetch_rejected");
    this.name = "DirectFetchRejectedError";
  }
}

export function conciseError(error: unknown): string {
  if (error instanceof WebAccessError) return error.message;
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.name;
  return String(error);
}
