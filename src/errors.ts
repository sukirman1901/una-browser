export type ErrorCode = "stale_ref" | "not_found" | "grammar" | "timeout" | "cdp" | "challenge" | "blocked" | "attach" | "invalid";

export class UnaError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export function isUnaError(e: unknown): e is UnaError {
  return e instanceof UnaError;
}