import axios from "axios";

export class AuthApiError extends Error {
  constructor(public readonly code: string, message = "Account request failed.") {
    super(message);
    this.name = "AuthApiError";
  }
}
const serverCodes = new Set(["ACCOUNT_EXISTS", "INVALID_CREDENTIALS", "AUTH_REQUIRED", "SESSION_EXPIRED", "AUTH_RATE_LIMITED",
  "AUTH_INVALID_EMAIL", "AUTH_INVALID_PASSWORD", "AUTH_INVALID_NAME", "AGE_REQUIRED", "TERMS_REQUIRED", "REGISTRATION_POLICY_CHANGED", "BIRTH_DATE_INVALID"]);

/** Keep Axios request bodies, credentials and server internals out of app errors. */
export function normalizeAuthError(error: unknown): AuthApiError {
  if (error instanceof AuthApiError) return error;
  if (error instanceof Error && error.message === "ERR_BACKEND_URL_MISSING") return new AuthApiError("NETWORK_ERROR");
  if (error && typeof error === "object" && "code" in error && error.code === "ERR_BACKEND_URL_MISSING") return new AuthApiError("NETWORK_ERROR");
  if (!axios.isAxiosError(error)) return new AuthApiError("UNKNOWN");
  if (["ECONNABORTED", "ETIMEDOUT"].includes(error.code ?? "")) return new AuthApiError("TIMEOUT");
  if (!error.response) return new AuthApiError("NETWORK_ERROR");
  const status = error.response.status;
  const code = (error.response.data as { code?: unknown } | undefined)?.code;
  if (status >= 500) return new AuthApiError("SERVER_ERROR");
  if (typeof code === "string" && serverCodes.has(code)) return new AuthApiError(code);
  return new AuthApiError(({ 400: "AUTH_INVALID_FIELDS", 401: "AUTH_REQUIRED", 409: "ACCOUNT_EXISTS", 429: "AUTH_RATE_LIMITED" } as Record<number, string>)[status] ?? "UNKNOWN");
}
