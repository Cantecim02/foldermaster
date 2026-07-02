export type DiagnosticEntryLike = {
  id?: string;
  level?: string;
  source?: string;
  message?: string;
  details?: string;
  createdAt?: string;
};

export function createDiagnosticEventKey(entry: DiagnosticEntryLike) {
  const timeBucket = entry.createdAt ? entry.createdAt.slice(0, 19) : "";
  return [
    timeBucket,
    entry.level ?? "error",
    normalizeDiagnosticSource(entry.source),
    normalizeDiagnosticMessage(entry.message),
    normalizeDiagnosticDetails(entry.details)
  ].join("|");
}

export function dedupeDiagnosticEntries<T extends DiagnosticEntryLike>(entries: T[], maxEntries: number) {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const entry of entries) {
    const key = createDiagnosticEventKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
    if (deduped.length >= maxEntries) break;
  }

  return deduped;
}

export function isMetroConnectivityWarning(message?: string | null) {
  const normalized = normalizeDiagnosticMessage(message);
  return (
    normalized.includes("cannot connect to metro") ||
    normalized.includes("disconnected from metro") ||
    normalized.includes("metro url") ||
    /url:\s*\d{1,3}(?:\.\d{1,3}){3}:\d+/i.test(message ?? "")
  );
}

export function sanitizeDiagnosticText(value?: string | null) {
  if (!value) return value ?? undefined;
  return value
    .replace(/file:\/\/\/[^\s)]+\/([^/\s)]+)/g, "file://.../$1")
    .replace(/\/Users\/[^\s)]+\/([^/\s)]+)/g, "/Users/.../$1")
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?/g, "http://local-dev")
    .replace(/URL:\s*\d{1,3}(?:\.\d{1,3}){3}:\d+/gi, "URL: local-dev");
}

function normalizeDiagnosticSource(source?: string | null) {
  return (source ?? "legacy").trim().toLowerCase();
}

function normalizeDiagnosticMessage(message?: string | null) {
  return (message ?? "")
    .replace(/\s+/g, " ")
    .replace(/\d{1,3}(?:\.\d{1,3}){3}:\d+/g, "local-dev")
    .trim()
    .toLowerCase();
}

function normalizeDiagnosticDetails(details?: string | null) {
  return (details ?? "")
    .replace(/\s+/g, " ")
    .replace(/\d{1,3}(?:\.\d{1,3}){3}:\d+/g, "local-dev")
    .slice(0, 240)
    .trim()
    .toLowerCase();
}
