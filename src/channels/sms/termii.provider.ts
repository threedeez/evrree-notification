import { Channels, NotificationErrorCode } from "../../common/index";
import { NotificationError } from "../../errors";
import type { SmsProvider, NormalizedSms, ProviderContext } from "../../types";

export interface TermiiProviderOptions {
  apiKey: string;
  channel: "generic" | "dnd";
  senderId?: string;
  baseUrl: string; // Termii gives different accounts different base URLs
  /** Per-request timeout. Default 10s. A shorter ctx.signal still wins. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BULK_RECIPIENTS = 10_000; // Termii bulk endpoint limit per request
const MAX_ERROR_BODY_CHARS = 500;

export class TermiiSmsProvider implements SmsProvider {
  readonly name = "termii";
  private readonly options: TermiiProviderOptions;

  constructor(options: TermiiProviderOptions) {
    this.options = options;
  }

  async send(
    msg: NormalizedSms,
    ctx: ProviderContext,
  ): Promise<{ providerMessageId?: string }> {
    // Termii wants international format without the leading "+".
    const to = msg.to.map((n) => n.replace(/^\+/, ""));

    if (to.length === 0) {
      throw this.fail(
        NotificationErrorCode.INVALID_RECIPIENT,
        "no recipients",
        false,
      );
    }
    if (to.length > MAX_BULK_RECIPIENTS) {
      throw this.fail(
        NotificationErrorCode.INVALID_MESSAGE,
        `termii bulk supports at most ${MAX_BULK_RECIPIENTS} recipients per request`,
        false,
      );
    }

    const from = msg.senderId ?? this.options.senderId;
    if (!from) {
      // Provider-level problem (another provider may not need a sender ID),
      // so this is PROVIDER_ERROR, not a caller error: fallback still applies.
      throw this.fail(
        NotificationErrorCode.PROVIDER_ERROR,
        "termii requires a senderId (set it on the provider or the message)",
        false,
      );
    }

    const bulk = to.length > 1;
    const baseUrl = (this.options.baseUrl ?? "").replace(/\/+$/, "");
    const url = `${baseUrl}/api/sms/send${bulk ? "/bulk" : ""}`;

    const body = JSON.stringify({
      api_key: this.options.apiKey,
      to: bulk ? to : to[0],
      from,
      sms: msg.text,
      type: "plain",
      channel: this.options.channel,
    });

    const signal = AbortSignal.any([
      ctx.signal,
      AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    ]);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      });
    } catch (cause) {
      throw this.fromFetchError(cause, signal);
    }

    if (!res.ok) throw await this.fromHttpError(res);

    // 2xx. A success always carries message_id. If we can't read one we can't
    // tell whether the SMS went out, so don't retry (a retry could double-send).
    let messageId: string | undefined;

    try {
      const data = (await res.json()) as { message_id?: unknown };

      if (typeof data?.message_id === "string" && data.message_id) {
        messageId = data.message_id;
      }
    } catch {
      // The request succeeded, but the response body was not valid JSON.
      // Treat it as successful to avoid potentially sending the SMS twice.
    }

    return {
      ...(messageId ? { providerMessageId: messageId } : {}),
    };
  }

  // ---- error construction --------------------------------------------------

  private fail(
    code: string,
    message: string,
    retryable: boolean,
    statusCode?: number,
    cause?: unknown,
  ): NotificationError {
    return new NotificationError({
      code,
      channel: Channels.SMS,
      provider: this.name,
      message,
      retryable,
      statusCode,
      cause,
    } as ConstructorParameters<typeof NotificationError>[0]);
  }

  private fromFetchError(
    cause: unknown,
    signal: AbortSignal,
  ): NotificationError {
    if (signal.aborted) {
      const isTimeout =
        (signal.reason as Error | undefined)?.name === "TimeoutError";
      return this.fail(
        isTimeout ? "TIMEOUT" : "ABORTED",
        isTimeout ? "termii request timed out" : "termii request aborted",
        isTimeout,
        undefined,
        this.sanitizeError(cause),
      );
    }
    // DNS failure, connection reset, TLS error: the request most likely never
    // reached Termii, so a retry is safe.
    return this.fail(
      NotificationErrorCode.PROVIDER_ERROR,
      "termii network error",
      true,
      undefined,
      this.sanitizeError(cause),
    );
  }

  private async fromHttpError(res: Response): Promise<NotificationError> {
    const status = res.status;

    let text = "";
    try {
      text = await res.text();
    } catch {
      // ignore, we just want to include whatever we can in the error
    }

    const retryable = status === 408 || status === 429 || status >= 500;

    const code =
      status === 401 || status === 403
        ? NotificationErrorCode.PROVIDER_AUTH_ERROR
        : NotificationErrorCode.PROVIDER_ERROR;

    return this.fail(
      code,
      `termii request failed (HTTP ${status})`,
      retryable,
      status,
      {
        status,
        body: this.redact(text).slice(0, MAX_ERROR_BODY_CHARS),
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
      },
    );
  }

  // ---- AC34: never leak the API key ------------------------------------------

  private redact(text: string): string {
    const key = this.options.apiKey;
    return key ? text.split(key).join("[REDACTED]") : text;
  }

  /** Keep only name/message/code from a raw error; never the raw object. */
  private sanitizeError(err: unknown): {
    name?: string;
    message?: string;
    code?: string;
  } {
    const e = err as
      (Error & { code?: string; cause?: { code?: string } }) | undefined;
    return {
      name: e?.name,
      message: e?.message ? this.redact(e.message) : undefined,
      code: e?.cause?.code ?? e?.code,
    };
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
