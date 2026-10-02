import { NotificationError } from "./errors";
import type { RetryConfig } from "./types";

export const DEFAULT_RETRY: RetryConfig = {
  attempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
};

/**
 * backoff = min(maxDelayMs, initialDelayMs * 2^(attempt-1)) with +-20% jitter.
 * `attempt` is 1-indexed (the attempt that just failed).
 */
export function computeBackoffMs(
  attempt: number,
  config: RetryConfig,
  retryAfterMs?: number,
): number {
  if (retryAfterMs != null) return retryAfterMs;
  const base = Math.min(
    config.maxDelayMs,
    config.initialDelayMs * 2 ** (attempt - 1),
  );
  const jitterFactor = 1 + (Math.random() * 0.4 - 0.2); // +-20%
  // Clamp after jitter too — jitter must never push us past maxDelayMs.
  return Math.round(Math.min(config.maxDelayMs, base * jitterFactor));
}

export interface RetryableCall<T> {
  (attempt: number, signal: AbortSignal): Promise<T>;
}

/**
 * Runs `fn` up to config.attempts times. Stops early (does not retry) when
 * the thrown NotificationError has retryable === false. Honors an externally
 * supplied AbortSignal and a per-call timeout of `timeoutMs`.
 *
 * Returns { result, attempts } on success, or throws the last error.
 */
export async function withRetry<T>(
  fn: RetryableCall<T>,
  config: RetryConfig,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ result: T; attempts: number }> {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.attempts; attempt++) {
    if (opts.signal?.aborted) {
      throw new NotificationError({ code: "ABORTED", retryable: false });
    }

    const callSignal = opts.timeoutMs
      ? anySignal([opts.signal, AbortSignal.timeout(opts.timeoutMs)])
      : (opts.signal ?? new AbortController().signal);

    try {
      const result = await fn(attempt, callSignal);
      return { result, attempts: attempt };
    } catch (err) {
      lastError = err;
      const retryable = err instanceof NotificationError ? err.retryable : true;
      const isLastAttempt = attempt === config.attempts;

      if (!retryable || isLastAttempt) {
        throw err;
      }

      const retryAfterMs =
        err instanceof NotificationError && typeof err.statusCode === "number"
          ? extractRetryAfterMs(err)
          : undefined;

      await sleep(computeBackoffMs(attempt, config, retryAfterMs));
    }
  }

  // Unreachable, but keeps TS happy.
  throw lastError;
}

function extractRetryAfterMs(err: NotificationError): number | undefined {
  const cause = err.cause as { retryAfterMs?: number } | undefined;
  return cause?.retryAfterMs;
}

function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}
