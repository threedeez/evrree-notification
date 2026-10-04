import nodemailer, { type Transporter } from "nodemailer";
import { NotificationError } from "../../errors";
import type {
  EmailProvider,
  NormalizedEmail,
  ProviderContext,
} from "../../types";
import { Channels, NotificationErrorCode } from "../../common";

export interface SmtpProviderOptions {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  /** Socket-level safety nets. nodemailer has no AbortSignal support, so
   *  these stop connections from hanging for minutes. Defaults: 10s/10s/30s. */
  connectionTimeoutMs?: number;
  greetingTimeoutMs?: number;
  socketTimeoutMs?: number;
  maxConnections?: number;
}

/** Shape of the extra fields nodemailer puts on its errors. */
interface SmtpError extends Error {
  code?: string;
  responseCode?: number;
  command?: string;
}

// Network-level failures: the message most likely never reached the server.
const NETWORK_CODES = new Set([
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ESOCKET",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "EDNS",
  "ENOTFOUND",
]);

// Local/config failures. Retrying the same provider can't help, but a
// fallback provider may still work, so these stay PROVIDER_ERROR.
const PERMANENT_CODES = new Set([
  "EAUTH",
  "ENOAUTH",
  "EOAUTH2",
  "ETLS",
  "EREQUIRETLS",
]);

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly transporter: Transporter;

  constructor(options: SmtpProviderOptions) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: options.auth,
      pool: true,
      maxConnections: options.maxConnections ?? 5,
      connectionTimeout: options.connectionTimeoutMs ?? 10_000,
      greetingTimeout: options.greetingTimeoutMs ?? 10_000,
      socketTimeout: options.socketTimeoutMs ?? 30_000,
    });
  }

  async send(
    msg: NormalizedEmail,
    ctx: ProviderContext,
  ): Promise<{ providerMessageId?: string }> {
    const { signal } = ctx;
    if (signal.aborted) throw this.fromAbort(signal);

    try {
      const info = await abortable(
        this.transporter.sendMail({
          from: toAddress(msg.from),
          to: msg.to.map(toAddress),
          cc: msg.cc?.map(toAddress),
          bcc: msg.bcc?.map(toAddress),
          replyTo: msg.replyTo,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          attachments: msg.attachments,
          headers: buildHeaders(msg),
        }),
        signal,
      );

      // nodemailer only throws when ALL recipients are rejected. Partial
      // rejections come back here; log counts only (never addresses).
      if (info.rejected?.length) {
        ctx.logger.warn(
          `[smtp] ${info.rejected.length} recipient(s) rejected by server`,
        );
      }
      return { providerMessageId: info.messageId };
    } catch (cause) {
      throw this.toNotificationError(cause, signal);
    }
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  async close(): Promise<void> {
    this.transporter.close();
  }

  // ---- error mapping -------------------------------------------------------

  private fromAbort(signal: AbortSignal): NotificationError {
    const isTimeout =
      (signal.reason as Error | undefined)?.name === "TimeoutError";
    return new NotificationError({
      code: isTimeout
        ? NotificationErrorCode.TIMEOUT
        : NotificationErrorCode.ABORTED,
      channel: Channels.EMAIL,
      provider: this.name,
      retryable: isTimeout,
      cause: signal.reason,
    });
  }

  private toNotificationError(
    cause: unknown,
    signal: AbortSignal,
  ): NotificationError {
    if (cause instanceof NotificationError) return cause;
    if (signal.aborted) return this.fromAbort(signal);

    const err = cause as SmtpError | undefined;
    const responseCode =
      typeof err?.responseCode === "number" ? err.responseCode : undefined;

    // The message is deliberately generic: raw SMTP responses often echo the
    // recipient address. The full error stays on `cause` only.
    const base = {
      channel: Channels.EMAIL,
      provider: this.name,
      cause,
      statusCode: responseCode,
    };

    // 1. Server replied. 4xx = temporary, 5xx = permanent.
    if (responseCode !== undefined) {
      return new NotificationError({
        ...base,
        code: NotificationErrorCode.PROVIDER_ERROR,
        message: `SMTP error ${responseCode}`,
        retryable: responseCode >= 400 && responseCode < 500,
      });
    }

    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "EAUTH"
    ) {
      throw new NotificationError({
        code: NotificationErrorCode.PROVIDER_AUTH_ERROR,
        message: "SMTP authentication failed",
        retryable: false,
        cause: err,
      });
    }

    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "ETIMEDOUT"
    ) {
      throw new NotificationError({
        code: NotificationErrorCode.TIMEOUT,
        message: "SMTP request timed out",
        retryable: true,
        cause: err,
      });
    }

    // 2. No usable recipients, rejected locally before any server reply.
    if (err?.code === "EENVELOPE") {
      return new NotificationError({
        ...base,
        code: NotificationErrorCode.INVALID_RECIPIENT,
        message: "no valid recipients",
        retryable: false,
      });
    }

    // 3. Auth / TLS problems: permanent for this provider.
    if (err?.code && PERMANENT_CODES.has(err.code)) {
      return new NotificationError({
        ...base,
        code: NotificationErrorCode.PROVIDER_ERROR,
        message: `SMTP ${err.code}`,
        retryable: false,
      });
    }

    // 4. Network trouble: transient.
    if (err?.code && NETWORK_CODES.has(err.code)) {
      return new NotificationError({
        ...base,
        code: NotificationErrorCode.PROVIDER_ERROR,
        message: `SMTP network error (${err.code})`,
        retryable: true,
      });
    }

    // 5. Unknown: don't retry. A blind retry of an unknown failure risks a
    // duplicate email, and fallback to the next provider still happens.
    return new NotificationError({
      ...base,
      code: NotificationErrorCode.PROVIDER_ERROR,
      message: "SMTP send failed",
      retryable: false,
    });
  }
}

// ---- helpers ---------------------------------------------------------------

/** Object form lets nodemailer escape display names correctly (the old
 *  hand-built `"name" <addr>` string breaks on names containing quotes). */
function toAddress(addr: { name?: string; address: string }) {
  return addr.name ? `"${addr.name}" <${addr.address}>` : addr.address;
}

/** SMTP has no native "tags", so they travel as a header. Provider-specific
 *  headers (X-SES-MESSAGE-TAGS, X-Mailgun-Tag) can be set via msg.headers. */
function buildHeaders(
  msg: NormalizedEmail,
): Record<string, string> | undefined {
  const tags = (msg as { tags?: string[] }).tags;
  if (!msg.headers && !tags?.length) return undefined;
  return {
    ...msg.headers,
    ...(tags?.length ? { "X-Tags": tags.join(",") } : {}),
  };
}

/** nodemailer ignores AbortSignal, so race it. NOTE: aborting stops us
 *  waiting, not the underlying send (see caveat in the notes). */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}
