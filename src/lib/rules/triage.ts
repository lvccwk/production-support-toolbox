import type { ExtractedLogInfo, UnknownTriage } from "@/types";

/**
 * Structured triage for log lines that matched no rule (section 4.2 of the
 * enhancement plan). Pure function: given the parser's extracted facts it
 * derives targeted causes and investigation steps from:
 *   - the exception class names (common-class catalogue),
 *   - the source file extensions (language/framework hint),
 *   - HTTP statuses (4xx client-side vs 5xx server-side direction),
 *   - presence of a stack trace.
 * Falls back to a single baseline sentence when nothing can be derived —
 * never emits generic template advice.
 */

interface ExceptionHint {
  /** Regex tested against the short exception class name. */
  match: RegExp;
  label: string;
  causes: string[];
  investigation: string[];
}

/** Ordered catalogue: the first matching entry per exception wins. */
const EXCEPTION_HINTS: ExceptionHint[] = [
  {
    match: /\b(NumberFormatException|ValueError|IllegalArgumentException|TypeError|FormatException)\b/i,
    label: "data type or format",
    causes: [
      "The exception usually comes from data of the wrong type or format (e.g. a non-numeric value where a number was expected).",
    ],
    investigation: [
      "Identify the field or value that failed to parse, and where it came from.",
    ],
  },
  {
    match: /\b(ClassCastException)\b/i,
    label: "type cast",
    causes: [
      "A value was cast to an incompatible type — often a sign of schema drift between components.",
    ],
    investigation: [
      "Compare the runtime type of the value with the type the code expects.",
    ],
  },
  {
    match: /\b(NullPointerException|NullReferenceException|AttributeError|TypeError|NPE)\b/i,
    label: "null / undefined value",
    causes: [
      "A null or undefined value was dereferenced — trace where the value came from.",
    ],
    investigation: [
      "Inspect the first stack frame and the value passed into it.",
    ],
  },
  {
    match: /\b(IllegalStateException|InvalidStateException|ObjectDisposedException|StaleObjectStateException)\b/i,
    label: "invalid application state",
    causes: [
      "The application hit an invalid state (using an object after it was closed, or an operation executed twice).",
    ],
    investigation: [
      "Look at the state transition immediately before the failure.",
    ],
  },
  {
    match: /\b(IOException|SocketException|EOFException|IOError|BrokenPipeError|ConnectionResetError)\b/i,
    label: "I/O failure",
    causes: [
      "An I/O operation failed at the network or filesystem level.",
    ],
    investigation: [
      "Check the target resource (network path, file, socket) and recent network changes.",
    ],
  },
  {
    match: /\b(ClassNotFoundException|NoClassDefFoundError|ModuleNotFoundError|ImportError|NoSuchMethodError|AbstractMethodError)\b/i,
    label: "deployment / version mismatch",
    causes: [
      "A class or module available at build time is missing or mismatched at runtime — often a deployment or version mismatch.",
    ],
    investigation: [
      "Compare the deployed artifact version with the expected one; check the classpath.",
    ],
  },
  {
    match: /\b(StackOverflowError|Maximum call stack size exceeded|RecursionError)\b/i,
    label: "recursion",
    causes: [
      "Unbounded recursion or a call cycle that never terminates.",
    ],
    investigation: [
      "Look for recursive calls without a base case in the first stack frames.",
    ],
  },
  {
    match: /\b(InterruptedException|InterruptedIOException|KeyboardInterrupt)\b/i,
    label: "interruption",
    causes: [
      "The thread was interrupted while waiting — check shutdown or cancel flows.",
    ],
    investigation: [
      "Check who is cancelling the task and why.",
    ],
  },
  {
    match: /\b(ParseException|DateTimeParseException|ParseError)\b/i,
    label: "parsing",
    causes: [
      "A value failed to parse as its expected format (date, number, etc.).",
    ],
    investigation: [
      "Check the raw value and the expected format in the calling code.",
    ],
  },
  {
    match: /\b(AssertionError|AssertionFailedError)\b/i,
    label: "internal invariant",
    causes: [
      "An internal invariant failed — a code-level bug rather than an environment issue.",
    ],
    investigation: [
      "Look at the failing assertion in the first stack frame and the state that violated it.",
    ],
  },
  {
    match: /\b(UnsupportedOperationException|NotImplementedError)\b/i,
    label: "unsupported operation",
    causes: [
      "The operation is not supported by this implementation or version.",
    ],
    investigation: [
      "Check feature flags and version compatibility.",
    ],
  },
];

/** Broad catch-all entries — only consulted when no specific hint matched. */
const GENERIC_HINTS: ExceptionHint[] = [
  {
    match: /.*/,
    label: "generic exception",
    causes: [
      "A generic exception with no specific signature; the message text is the main clue.",
    ],
    investigation: [
      "Read the exception message and first stack frame carefully.",
    ],
  },
];

const BASELINE_CAUSE =
  "No known rule matched this error pattern; the exception message or stack trace contains the best clues.";
const BASELINE_INVESTIGATION =
  "Search the exact error text in the codebase and related logs.";
const STACK_TRACE_INVESTIGATION =
  "Start from the first stack frame and follow the 'Caused by' chain to the root cause.";

const CLIENT_DIRECTION = {
  cause: "The call was rejected with a 4xx status: the request, its credentials or its permissions are likely the problem.",
  investigation:
    "Validate the request payload, authentication and permissions of the rejected call.",
};
const SERVER_DIRECTION = {
  cause: "The failure happened on the server side (5xx): check the receiving service and its upstream dependencies.",
  investigation:
    "Check the receiving service's health and logs, then trace the upstream call chain.",
};

/** First source extension seen (priority-ordered): language/framework hint. */
function languageHint(info: ExtractedLogInfo): string | null {
  const MAPPINGS: Array<[RegExp, string]> = [
    [/\.(java|kt|scala|groovy)$/i, "Java/Kotlin (JVM)"],
    [/\.(cs|vb)$/i, ".NET"],
    [/\.py$/i, "Python"],
    [/\.go$/i, "Go"],
    [/\.(ts|tsx|js|jsx)$/i, "TypeScript / JavaScript (Node or browser)"],
    [/\.php$/i, "PHP"],
    [/\.rb$/i, "Ruby"],
    [/\.rs$/i, "Rust"],
  ];
  for (const source of info.sources) {
    for (const [re, hint] of MAPPINGS) {
      if (re.test(source.file)) return hint;
    }
  }
  return null;
}

function httpDirection(info: ExtractedLogInfo): "client" | "server" | null {
  if (info.httpStatuses.some((code) => code >= 500)) return "server";
  if (info.httpStatuses.some((code) => code >= 400)) return "client";
  return null;
}

function hintFor(exception: string): ExceptionHint {
  for (const hint of [...EXCEPTION_HINTS, ...GENERIC_HINTS]) {
    if (hint.match.test(exception)) return hint;
  }
  return GENERIC_HINTS[0];
}

/**
 * Build a structured unknown-error summary from parser output. Never throws.
 * Falls back to baseline sentences only when nothing else can be derived.
 */
export function triageUnknownError(info: ExtractedLogInfo): UnknownTriage {
  const causes: string[] = [];
  const investigation: string[] = [];

  // 1. Exception-class hints (dedupe by label, cap 3 exceptions).
  const seenLabels = new Set<string>();
  for (const exception of info.exceptions.slice(0, 5)) {
    const hint = hintFor(exception);
    if (hint.label === "generic exception") continue;
    if (seenLabels.has(hint.label)) continue;
    seenLabels.add(hint.label);
    causes.push(...hint.causes);
    investigation.push(...hint.investigation);
  }

  // 2. Stack-trace hint.
  if (info.stackTrace) {
    investigation.push(STACK_TRACE_INVESTIGATION);
  }

  // 3. HTTP direction hint (only when there is no language/exception signal).
  const direction = httpDirection(info);
  if (direction === "client") {
    causes.push(CLIENT_DIRECTION.cause);
    investigation.push(CLIENT_DIRECTION.investigation);
  } else if (direction === "server") {
    causes.push(SERVER_DIRECTION.cause);
    investigation.push(SERVER_DIRECTION.investigation);
  }

  // 4. Baseline only when nothing else was derived.
  if (causes.length === 0) causes.push(BASELINE_CAUSE);
  if (investigation.length === 0) investigation.push(BASELINE_INVESTIGATION);

  return {
    languageHint: languageHint(info),
    httpDirection: direction,
    causes: causes.slice(0, 5),
    investigation: investigation.slice(0, 6),
  };
}