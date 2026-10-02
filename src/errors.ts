import type { Channel } from "./types";

export type NotificationErrorCode =
  | "CONFIG_ERROR"
  | "CHANNEL_NOT_CONFIGURED"
  | "INVALID_RECIPIENT"
  | "INVALID_MESSAGE"
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_RENDER_ERROR"
  | "PROVIDER_AUTH_ERROR"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "ABORTED";

export interface NotificationErrorInit {
  code: NotificationErrorCode;
  message?: string;
  channel?: Channel;
  provider?: string;
  retryable?: boolean;
  statusCode?: number;
  cause?: unknown;
}

// Codes that are never retried, regardless of what the caller passes for
// `retryable` — these represent caller mistakes, not transient provider
// failures. Kept in sync with the "Errors" section of the ticket.
const NEVER_RETRYABLE: ReadonlySet<NotificationErrorCode> = new Set([
  "CONFIG_ERROR",
  "CHANNEL_NOT_CONFIGURED",
  "INVALID_RECIPIENT",
  "INVALID_MESSAGE",
  "TEMPLATE_NOT_FOUND",
  "TEMPLATE_RENDER_ERROR",
  "ABORTED",
]);

export const DEFAULT_MESSAGES: Record<NotificationErrorCode, string> = {
  CONFIG_ERROR: "Invalid notifier configuration",
  CHANNEL_NOT_CONFIGURED: "This channel is not configured",
  INVALID_RECIPIENT: "Invalid recipient",
  INVALID_MESSAGE: "Invalid message",
  TEMPLATE_NOT_FOUND: "Template not found",
  TEMPLATE_RENDER_ERROR: "Failed to render template",
  PROVIDER_AUTH_ERROR: "Provider rejected credentials",
  RATE_LIMITED: "Provider rate limit exceeded",
  PROVIDER_ERROR: "Provider request failed",
  TIMEOUT: "Provider request timed out",
  ABORTED: "Request was aborted",
};

export class NotificationError extends Error {
  readonly code: NotificationErrorCode;
  readonly channel?: Channel;
  readonly provider?: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
  override readonly cause?: unknown;

  constructor(init: NotificationErrorInit) {
    const message = init.message ?? DEFAULT_MESSAGES[init.code];
    super(message);
    this.name = "NotificationError";
    this.code = init.code;
    this.channel = init.channel;
    this.provider = init.provider;
    this.statusCode = init.statusCode;
    this.cause = redactCause(init.cause);
    this.retryable = NEVER_RETRYABLE.has(init.code)
      ? false
      : (init.retryable ?? false);

    Error.captureStackTrace?.(this, NotificationError);
  }
}

/**
 * Strip anything that looks like a secret (api keys, auth headers, tokens)
 * out of an error's `cause` before we attach it. See AC34 — provider errors
 * must never leak credentials via `cause` or `message`.
 */
function redactCause(cause: unknown): unknown {
  if (cause == null) return cause;
  if (typeof cause === "string") return redactSecrets(cause);
  if (cause instanceof Error) {
    const clone = new Error(redactSecrets(cause.message));
    clone.name = cause.name;
    clone.stack = cause.stack ? redactSecrets(cause.stack) : undefined;
    return clone;
  }
  return cause;
}

const SECRET_KEY_PATTERN =
  /(api[_-]?key|authorization|auth[_-]?token|password|pass|secret)/i;

function redactSecrets(input: string): string {
  return input.replace(
    new RegExp(
      `("?${SECRET_KEY_PATTERN.source}"?\\s*[:=]\\s*"?)([^"\\s,}]+)`,
      "gi",
    ),
    "$1[REDACTED]",
  );
}
