export class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.status = status;
    this.expose = options.expose ?? status < 500;
    this.details = options.details;
    this.code = options.code ?? codeFromStatus(status);
  }
}

export function codeFromStatus(status) {
  if (status === 404) return "FILE_NOT_FOUND";
  if (status === 413) return "FILE_TOO_LARGE";
  if (status === 415) return "UNSUPPORTED_FILE_TYPE";
  if (status === 429 || status === 503) return "SERVER_BUSY";
  if (status === 499) return "REQUEST_CANCELLED";
  if (status >= 500) return "CONVERSION_FAILED";
  return "INVALID_REQUEST";
}

export function createErrorPayload(error, { includeDetails = false } = {}) {
  const status = error?.status ?? 500;
  const message =
    error instanceof Error && (includeDetails || error.expose)
      ? error.message
      : "Unexpected server error.";
  return {
    success: false,
    code: error?.code ?? codeFromStatus(status),
    message,
    error: message,
    ...(includeDetails && error?.details ? { details: error.details } : {})
  };
}
