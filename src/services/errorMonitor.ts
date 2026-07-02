import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import {
  createDiagnosticEventKey,
  dedupeDiagnosticEntries,
  isMetroConnectivityWarning,
  sanitizeDiagnosticText
} from "./diagnosticsDedup";

const errorLogKey = "editio_internal_error_log";
const legacyErrorLogKey = "foldermaster_internal_error_log";
const maxEntries = 140;
const diagnosticsCollectionEnabled =
  (typeof __DEV__ !== "undefined" && __DEV__) || process.env.EXPO_PUBLIC_INTERNAL_DIAGNOSTICS === "true";
let installed = false;

type ReactNativeErrorUtils = {
  getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
};

type ErrorEventLike = {
  message?: unknown;
  error?: unknown;
  reason?: unknown;
  filename?: unknown;
  lineno?: unknown;
  colno?: unknown;
};

type GlobalWithHandlers = typeof globalThis & {
  __EDITIO_ERROR_MONITOR_INSTALLED__?: boolean;
  ErrorUtils?: ReactNativeErrorUtils;
  addEventListener?: (type: string, handler: (event: ErrorEventLike) => void) => void;
  onerror?: ((message?: unknown, source?: unknown, line?: unknown, column?: unknown, error?: unknown) => void) | null;
  onunhandledrejection?: ((event: ErrorEventLike) => void) | null;
  fetch?: typeof fetch;
};

export type ErrorLogLevel = "info" | "warn" | "error" | "fatal";

export type ErrorLogEntry = {
  id: string;
  level: ErrorLogLevel;
  source: string;
  message: string;
  stack?: string;
  details?: string;
  createdAt: string;
  runtime: {
    appName: "Editio";
    appVersion: "1.0.0";
    platform: string;
    osVersion: string;
    isDev: boolean;
  };
};

export function installErrorMonitor() {
  if (!diagnosticsCollectionEnabled) return;

  const globalScope = globalThis as GlobalWithHandlers;
  if (installed || globalScope.__EDITIO_ERROR_MONITOR_INSTALLED__) return;
  installed = true;
  globalScope.__EDITIO_ERROR_MONITOR_INSTALLED__ = true;

  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = (...args: unknown[]) => {
    void recordInternalError("error", args, "console.error");
    originalError(...args);
  };

  console.warn = (...args: unknown[]) => {
    void recordInternalError("warn", args, "console.warn");
    originalWarn(...args);
  };

  const errorUtils = globalScope.ErrorUtils;
  if (errorUtils?.getGlobalHandler && errorUtils?.setGlobalHandler) {
    const previousHandler = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      void recordInternalError(isFatal ? "fatal" : "error", [error], "global.ErrorUtils");
      previousHandler?.(error, isFatal);
    });
  }

  if (typeof globalScope.addEventListener === "function") {
    globalScope.addEventListener("error", (event) => {
      void recordInternalError("error", [event.error ?? event.message ?? event], "global.error");
    });
    globalScope.addEventListener("unhandledrejection", (event) => {
      void recordInternalError("error", [event.reason ?? event], "promise.unhandledrejection");
    });
  }

  const previousOnError = globalScope.onerror;
  globalScope.onerror = (message, source, line, column, error) => {
    void recordInternalError("error", [error ?? message, { source, line, column }], "global.onerror");
    previousOnError?.(message, source, line, column, error);
  };

  const previousUnhandled = globalScope.onunhandledrejection;
  globalScope.onunhandledrejection = (event) => {
    void recordInternalError("error", [event.reason ?? event], "promise.onunhandledrejection");
    previousUnhandled?.(event);
  };

  const originalFetch = globalScope.fetch;
  if (typeof originalFetch === "function") {
    globalScope.fetch = (async (...args: Parameters<typeof fetch>) => {
      try {
        const response = await originalFetch(...args);
        if (response.status >= 500) {
          void recordInternalError(
            "warn",
            [`HTTP ${response.status}`, { url: formatFetchTarget(args[0]) }],
            "network.fetch",
          );
        }
        return response;
      } catch (error) {
        void recordInternalError("error", [error, { url: formatFetchTarget(args[0]) }], "network.fetch");
        throw error;
      }
    }) as typeof fetch;
  }
}

export async function recordInternalError(level: ErrorLogLevel, args: unknown[], source = "manual") {
  if (!diagnosticsCollectionEnabled) return;

  try {
    const entry = toEntry(level, args, source);
    const metroWarning = isMetroConnectivityWarning(entry.message) || isMetroConnectivityWarning(entry.details);
    if (metroWarning || isIgnorableDiagnosticNoise(entry.message) || isIgnorableDiagnosticNoise(entry.details)) return;
    const current = await readStoredErrors();
    const next = dedupeDiagnosticEntries([entry, ...current], maxEntries);
    await AsyncStorage.setItem(errorLogKey, JSON.stringify(next));
  } catch {
    // Internal monitor must never affect user flows.
  }
}

export async function recordBreadcrumb(message: string, details?: unknown) {
  await recordInternalError("info", [message, details].filter(Boolean), "breadcrumb");
}

export async function listInternalErrors() {
  return readStoredErrors();
}

export async function clearInternalErrors() {
  await AsyncStorage.multiRemove([errorLogKey, legacyErrorLogKey]);
}

export function formatInternalErrorReport(entries: ErrorLogEntry[]) {
  const header = [
    "Editio Diagnostics",
    `Generated at: ${new Date().toISOString()}`,
    `Entries: ${entries.length}`,
    "",
  ];

  const body = entries.map((entry, index) => {
    const details = entry.details ? `\nDetails: ${entry.details}` : "";
    const stack = entry.stack ? `\nStack:\n${entry.stack}` : "";
    return [
      `#${index + 1} ${entry.level.toUpperCase()} ${entry.createdAt}`,
      `Source: ${entry.source}`,
      `Runtime: ${entry.runtime.platform} ${entry.runtime.osVersion} dev=${entry.runtime.isDev}`,
      `Message: ${entry.message}${details}${stack}`,
    ].join("\n");
  });

  return [...header, ...body].join("\n\n");
}

async function readStoredErrors() {
  const [raw, legacyRaw] = await Promise.all([
    AsyncStorage.getItem(errorLogKey),
    AsyncStorage.getItem(legacyErrorLogKey),
  ]);
  const current = parseEntries(raw);
  const legacy = parseEntries(legacyRaw);
  return dedupeDiagnosticEntries([...current, ...legacy], maxEntries);
}

function parseEntries(raw: string | null): ErrorLogEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<ErrorLogEntry>[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEntry).filter(Boolean) as ErrorLogEntry[];
  } catch {
    return [];
  }
}

function normalizeEntry(entry: Partial<ErrorLogEntry>): ErrorLogEntry | null {
  if (!entry.message || !entry.createdAt) return null;
  return {
    id: entry.id ?? createDiagnosticEventKey(entry),
    level: entry.level ?? "error",
    source: entry.source ?? "legacy",
    message: sanitizeDiagnosticText(String(entry.message)) ?? "",
    stack: sanitizeDiagnosticText(entry.stack),
    details: sanitizeDiagnosticText(entry.details),
    createdAt: entry.createdAt,
    runtime: entry.runtime ?? getRuntimeInfo(),
  };
}

function toEntry(level: ErrorLogLevel, args: unknown[], source: string): ErrorLogEntry {
  const firstError = args.find((item): item is Error => item instanceof Error);
  const details = args
    .filter((item) => item !== firstError)
    .map(formatArg)
    .filter(Boolean)
    .join(" ");

  const entry = {
    id: "",
    level,
    source,
    message: sanitizeDiagnosticText(args.map(formatArg).join(" ").slice(0, 1800)) ?? "",
    stack: sanitizeDiagnosticText(firstError?.stack?.slice(0, 6000)),
    details: details ? sanitizeDiagnosticText(details.slice(0, 2400)) : undefined,
    createdAt: new Date().toISOString(),
    runtime: getRuntimeInfo(),
  };
  entry.id = createDiagnosticEventKey(entry);
  return entry;
}

function isIgnorableDiagnosticNoise(message?: string | null) {
  const normalized = (message ?? "").toLowerCase();
  return normalized.includes("removing parsed object:");
}

function getRuntimeInfo(): ErrorLogEntry["runtime"] {
  return {
    appName: "Editio",
    appVersion: "1.0.0",
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    isDev: typeof __DEV__ !== "undefined" ? __DEV__ : false,
  };
}

function formatFetchTarget(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "url" in input) {
    return String(input.url);
  }
  return "unknown";
}

function formatArg(arg: unknown) {
  if (arg instanceof Error) return arg.message;
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}
