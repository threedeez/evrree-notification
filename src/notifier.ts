import { randomUUID } from "node:crypto";
import { NotificationError } from "./errors";
import { DEFAULT_RETRY, withRetry } from "./retry.js";
import { TemplateRegistry } from "./templates/template-registry";
import { hasChannelContent, renderTemplate } from "./templates/render";
import { normalizeEmailAddressList, redactEmail } from "./validation/email";
import { normalizePhoneNumberList, redactPhone } from "./validation/phone";
import type {
  Channel,
  EmailMessage,
  EmailProvider,
  Logger,
  NotifierConfig,
  NotifyOptions,
  NotifyResult,
  PushMessage,
  PushProvider,
  Recipient,
  RetryConfig,
  SendOptions,
  SendResult,
  SmsMessage,
  SmsProvider,
} from "./types.js";
import { Channels, NotificationErrorCode } from "./common";
import {
  buildEmailProviders,
  buildPushProviders,
  buildSmsProviders,
  validateConfig,
} from "./common/helper";

// Errors caused by the caller. A different provider can't fix these, so we
// fail fast instead of falling back.
const CALLER_ERRORS = new Set([
  "INVALID_MESSAGE",
  "INVALID_RECIPIENT",
  "CHANNEL_NOT_CONFIGURED",
  "CONFIG_ERROR",
]);

const isCallerError = (err: unknown): boolean =>
  err instanceof NotificationError && CALLER_ERRORS.has(String(err.code));

const IDEMPOTENCY_MAX_ENTRIES = 1000;
const IDEMPOTENCY_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

type SendCtx = { signal: AbortSignal; logger: Logger; attempt: number };

interface DeliverArgs<TMsg, TRes> {
  channel: Channel;
  providers: ReadonlyArray<{
    name: string;
    send(msg: TMsg, ctx: SendCtx): Promise<TRes>;
  }>;
  msg: TMsg;
  /** Already redacted. Never put raw addresses/numbers/tokens here. */
  recipients: string[];
  opts?: SendOptions;
  /** Channel-specific fields copied onto a successful SendResult. */
  extra?: (res: TRes) => Partial<SendResult>;
}

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------

export class Notifier {
  readonly templates: {
    register: TemplateRegistry["register"];
    get: TemplateRegistry["get"];
    list: TemplateRegistry["list"];
    render: (
      templateId: string,
      channel: Channel,
      data: Record<string, unknown>,
    ) => unknown;
  };

  readonly email: {
    send: (msg: EmailMessage, opts?: SendOptions) => Promise<SendResult>;
  };
  readonly sms: {
    send: (msg: SmsMessage, opts?: SendOptions) => Promise<SendResult>;
  };
  readonly push: {
    send: (msg: PushMessage, opts?: SendOptions) => Promise<SendResult>;
    subscribeToTopic: (
      tokens: string[],
      topic: string,
    ) => Promise<{ successCount: number; failedTokens: string[] }>;
    unsubscribeFromTopic: (
      tokens: string[],
      topic: string,
    ) => Promise<{ successCount: number; failedTokens: string[] }>;
  };

  private readonly config: NotifierConfig;
  private readonly logger: Logger;
  private readonly retryConfig: RetryConfig;
  private readonly registry: TemplateRegistry;
  private readonly emailProviders: EmailProvider[];
  private readonly smsProviders: SmsProvider[];
  private readonly pushProviders: PushProvider[];
  // Stores promises so concurrent duplicate calls share one in-flight send.
  private readonly idempotencyCache = new Map<
    string,
    { promise: Promise<SendResult>; expiresAt: number }
  >();

  constructor(config: NotifierConfig) {
    validateConfig(config);
    this.config = config;
    this.logger = config.logger ?? console;
    this.retryConfig = { ...DEFAULT_RETRY, ...config.retry };
    this.registry = new TemplateRegistry(config.templates);
    this.emailProviders = buildEmailProviders(config);
    this.smsProviders = buildSmsProviders(config);
    this.pushProviders = buildPushProviders(config);

    this.templates = {
      register: this.registry.register.bind(this.registry),
      get: this.registry.get.bind(this.registry),
      list: this.registry.list.bind(this.registry),
      render: (templateId, channel, data) => {
        const template = this.registry.get(templateId);
        return renderTemplate(
          template,
          channel,
          this.config.appName,
          { locale: undefined } as Recipient,
          data,
          this.config.email?.layout,
        );
      },
    };

    this.email = { send: (msg, opts) => this.sendEmail(msg, opts) };
    this.sms = { send: (msg, opts) => this.sendSms(msg, opts) };
    this.push = {
      send: (msg, opts) => this.sendPush(msg, opts),
      subscribeToTopic: (tokens, topic) =>
        this.withFirstPushProvider((p) => p.subscribeToTopic?.(tokens, topic)),
      unsubscribeFromTopic: (tokens, topic) =>
        this.withFirstPushProvider((p) =>
          p.unsubscribeFromTopic?.(tokens, topic),
        ),
    };
  }

  // ---- 1-3: single-channel sends -----------------------------------------
  // Validation, redaction and dryRun live here. Delivery (withRetry, provider
  // fallback, hooks, idempotency) lives in deliver() / runDelivery() below.

  private async sendEmail(
    msg: EmailMessage,
    opts?: SendOptions,
  ): Promise<SendResult> {
    if (this.emailProviders.length === 0) {
      throw new NotificationError({
        code: "CHANNEL_NOT_CONFIGURED",
        channel: "email",
      });
    }
    if (!msg.subject || !(msg.html || msg.text)) {
      throw new NotificationError({
        code: "INVALID_MESSAGE",
        channel: "email",
        message: "email requires subject and html or text",
      });
    }

    const to = normalizeEmailAddressList(msg.to);
    const from = msg.from ?? this.config.email!.from;
    const recipients = to.map((a) => redactEmail(a.address));

    if (this.config.dryRun) {
      return {
        id: randomUUID(),
        channel: "email",
        status: "dry_run",
        attempts: 0,
        recipients,
      };
    }

    return this.deliver({
      channel: "email",
      providers: this.emailProviders,
      recipients,
      opts,
      msg: {
        ...msg,
        to,
        cc: normalizeEmailAddressList(msg.cc),
        bcc: normalizeEmailAddressList(msg.bcc),
        from,
      },
    });
  }

  private async sendSms(
    msg: SmsMessage,
    opts?: SendOptions,
  ): Promise<SendResult> {
    if (this.smsProviders.length === 0) {
      throw new NotificationError({
        code: "CHANNEL_NOT_CONFIGURED",
        channel: "sms",
      });
    }
    const toList = Array.isArray(msg.to) ? msg.to : [msg.to];
    const to = normalizePhoneNumberList(toList, this.config.defaultCountryCode);
    const recipients = to.map(redactPhone);

    if (this.config.dryRun) {
      return {
        id: randomUUID(),
        channel: "sms",
        status: "dry_run",
        attempts: 0,
        recipients,
      };
    }

    return this.deliver({
      channel: "sms",
      providers: this.smsProviders,
      recipients,
      opts,
      msg: { ...msg, to },
    });
  }

  private async sendPush(
    msg: PushMessage,
    opts?: SendOptions,
  ): Promise<SendResult> {
    if (this.pushProviders.length === 0) {
      throw new NotificationError({
        code: "CHANNEL_NOT_CONFIGURED",
        channel: "push",
      });
    }
    if ("tokens" in msg.to && msg.to.tokens.length === 0) {
      throw new NotificationError({
        code: "INVALID_MESSAGE",
        channel: "push",
        message: "tokens must be non-empty",
      });
    }

    const recipients =
      "tokens" in msg.to
        ? msg.to.tokens.map(() => "[token]")
        : [`topic:${msg.to.topic}`];

    if (this.config.dryRun) {
      return {
        id: randomUUID(),
        channel: "push",
        status: "dry_run",
        attempts: 0,
        recipients,
      };
    }

    return this.deliver({
      channel: "push",
      providers: this.pushProviders,
      recipients,
      opts,
      msg,
      extra: (res) => ({ invalidTokens: res.invalidTokens }),
    });
  }

  // ---- delivery core -------------------------------------------------------

  private deliver<TMsg, TRes extends { providerMessageId?: string }>(
    args: DeliverArgs<TMsg, TRes>,
  ): Promise<SendResult> {
    const key = args.opts?.idempotencyKey
      ? `${args.channel}:${args.opts.idempotencyKey}`
      : undefined;

    if (key) {
      const hit = this.idempotencyCache.get(key);
      if (hit && hit.expiresAt > Date.now()) return hit.promise;
    }

    const promise = this.runDelivery(args);

    if (key) {
      this.rememberIdempotent(key, promise);
      // Only successful sends stay cached, so a failed send can be retried
      // with the same key.
      promise.then(
        (r) => {
          if (r.status !== "sent") this.idempotencyCache.delete(key);
        },
        () => this.idempotencyCache.delete(key),
      );
    }
    return promise;
  }

  private rememberIdempotent(key: string, promise: Promise<SendResult>): void {
    const now = Date.now();
    if (this.idempotencyCache.size >= IDEMPOTENCY_MAX_ENTRIES) {
      for (const [k, v] of this.idempotencyCache) {
        if (v.expiresAt <= now) this.idempotencyCache.delete(k);
      }
    }
    this.idempotencyCache.set(key, {
      promise,
      expiresAt:
        now + (this.config.idempotencyTtlMs ?? IDEMPOTENCY_DEFAULT_TTL_MS),
    });
  }

  private async runDelivery<TMsg, TRes extends { providerMessageId?: string }>(
    args: DeliverArgs<TMsg, TRes>,
  ): Promise<SendResult> {
    const { channel, providers, msg, recipients, opts, extra } = args;

    let attempts = 0; // total across providers; withRetry only reports attempts on success
    let lastErr: unknown;
    let lastProvider = providers[0]!;

    for (const provider of providers) {
      lastProvider = provider;
      try {
        const { result: res } = await withRetry(
          (attempt, callSignal) => {
            attempts++;
            return provider.send(msg, {
              signal: callSignal, // caller signal merged with the per-attempt timeout
              logger: this.logger,
              attempt,
            });
          },
          this.retryConfig,
          { signal: opts?.signal, timeoutMs: this.config.timeoutMs },
        );

        const result: SendResult = {
          id: randomUUID(),
          channel,
          status: "sent",
          provider: provider.name,
          providerMessageId: res.providerMessageId,
          attempts,
          recipients,
          sentAt: new Date(),
          ...extra?.(res),
        };
        await this.runHook("onSent", result);
        return result;
      } catch (err) {
        lastErr = err;
        if (opts?.signal?.aborted || isCallerError(err)) break; // no fallback
        this.logger.warn(
          `[notifier] ${channel} provider ${provider.name} exhausted, trying next`,
          { code: (err as NotificationError)?.code },
        );
      }
    }

    const result: SendResult = {
      id: randomUUID(),
      channel,
      status: "failed",
      provider: lastProvider.name,
      attempts,
      recipients,
      error: this.toNotificationError(lastErr, channel, lastProvider.name),
    };
    await this.runHook("onFailed", result);
    return result;
  }

  private async withFirstPushProvider<T>(
    fn: (p: PushProvider) => Promise<T> | undefined,
  ): Promise<T> {
    if (this.pushProviders.length === 0) {
      throw new NotificationError({
        code: "CHANNEL_NOT_CONFIGURED",
        channel: "push",
      });
    }
    const result = fn(this.pushProviders[0]!);
    if (!result) {
      throw new NotificationError({
        code: NotificationErrorCode.CONFIG_ERROR,
        channel: Channels.PUSH,
        message: "Provider does not support topic subscriptions",
      });
    }
    return result;
  }

  // ---- 6: generic send ----------------------------------------------------

  async send(
    notification:
      | ({ channel: "email" } & EmailMessage)
      | ({ channel: "sms" } & SmsMessage)
      | ({ channel: "push" } & PushMessage),
    opts?: SendOptions,
  ): Promise<SendResult> {
    const { channel, ...rest } = notification;
    if (channel === "email") return this.sendEmail(rest as EmailMessage, opts);
    if (channel === "sms") return this.sendSms(rest as SmsMessage, opts);
    return this.sendPush(rest as PushMessage, opts);
  }

  // ---- 7: sendTemplate -----------------------------------------------------

  async sendTemplate(
    channel: Channel,
    templateId: string,
    recipient: Recipient,
    data: Record<string, unknown>,
    opts?: SendOptions,
  ): Promise<SendResult> {
    const template = this.registry.get(templateId);
    const rendered = renderTemplate(
      template,
      channel,
      this.config.appName,
      recipient,
      data,
      this.config.email?.layout,
    );

    if (channel === "email") {
      if (!recipient.email)
        throw new NotificationError({
          code: NotificationErrorCode.INVALID_RECIPIENT,
          channel: Channels.EMAIL,
          message: "recipient.email is required",
        });
      const r = rendered as { subject: string; html: string; text?: string };
      return this.sendEmail(
        { to: recipient.email, subject: r.subject, html: r.html, text: r.text },
        opts,
      );
    }
    if (channel === "sms") {
      if (!recipient.phone)
        throw new NotificationError({
          code: NotificationErrorCode.INVALID_RECIPIENT,
          channel: Channels.SMS,
          message: "recipient.phone is required",
        });
      const r = rendered as { text: string };
      return this.sendSms({ to: recipient.phone, text: r.text }, opts);
    }
    if (!recipient.pushTokens?.length) {
      throw new NotificationError({
        code: NotificationErrorCode.INVALID_RECIPIENT,
        channel: Channels.PUSH,
        message: "recipient.pushTokens is required",
      });
    }
    const r = rendered as {
      title: string;
      body: string;
      data?: Record<string, string>;
    };
    return this.sendPush(
      {
        to: { tokens: recipient.pushTokens },
        title: r.title,
        body: r.body,
        data: r.data,
      },
      opts,
    );
  }

  // ---- 8: notify (multi-channel) -------------------------------------------

  async notify(
    recipient: Recipient,
    templateId: string,
    data: Record<string, unknown>,
    opts?: NotifyOptions,
  ): Promise<NotifyResult> {
    const template = this.registry.get(templateId);
    const candidateChannels: Channel[] = opts?.channels ?? [
      "email",
      "sms",
      "push",
    ];

    const eligible = candidateChannels.filter((channel) => {
      const hasContact =
        (channel === "email" && !!recipient.email) ||
        (channel === "sms" && !!recipient.phone) ||
        (channel === "push" && !!recipient.pushTokens?.length);
      return hasContact && hasChannelContent(template, channel, recipient);
    });

    const results: SendResult[] = [];
    const strategy = opts?.strategy ?? "all";

    for (const channel of eligible) {
      const result = await this.sendTemplate(
        channel,
        templateId,
        recipient,
        data,
        opts,
      );
      results.push(result);
      if (strategy === "first-success" && result.status === "sent") break;
    }

    const succeeded = results
      .filter((r) => r.status === "sent")
      .map((r) => r.channel);
    const failed = results
      .filter((r) => r.status === "failed")
      .map((r) => r.channel);
    return { results, succeeded, failed };
  }

  // ---- 9: sendBulk -----------------------------------------------------------

  async sendBulk(
    items: Array<
      | (
          | ({ channel: "email" } & EmailMessage)
          | ({ channel: "sms" } & SmsMessage)
          | ({ channel: "push" } & PushMessage)
        )
      | {
          templateId: string;
          channel: Channel;
          recipient: Recipient;
          data: Record<string, unknown>;
        }
    >,
    options: { concurrency?: number } = {},
  ): Promise<SendResult[]> {
    const concurrency = options.concurrency ?? 10;
    const results: SendResult[] = new Array(items.length);
    let cursor = 0;

    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        const item = items[index]!;
        try {
          results[index] =
            "templateId" in item
              ? await this.sendTemplate(
                  item.channel,
                  item.templateId,
                  item.recipient,
                  item.data,
                )
              : await this.send(item);
        } catch (err) {
          // Caller-mistake errors (bad recipient/message/config) still count
          // as a per-item failure here — sendBulk must never reject (AC25).
          results[index] = {
            id: randomUUID(),
            channel: "channel" in item ? item.channel : "email",
            status: "failed",
            attempts: 0,
            recipients: [],
            error: this.toNotificationError(err),
          };
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, worker),
    );
    return results;
  }

  // ---- 12: verify --------------------------------------------------------

  async verify(): Promise<
    Record<Channel, { ok: boolean; provider: string; error?: string }[]>
  > {
    const check = async (
      providers: { name: string; verify?: () => Promise<void> }[],
    ) =>
      Promise.all(
        providers.map(async (p) => {
          try {
            await p.verify?.();
            return { ok: true, provider: p.name };
          } catch (err) {
            return {
              ok: false,
              provider: p.name,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );

    const [email, sms, push] = await Promise.all([
      check(this.emailProviders),
      check(this.smsProviders),
      check(this.pushProviders),
    ]);
    return { email, sms, push };
  }

  private async runHook(
    name: "onSent" | "onFailed",
    result: SendResult,
  ): Promise<void> {
    const hook = this.config.hooks?.[name];
    if (!hook) return;
    try {
      await hook(result);
    } catch (err) {
      this.logger.error(`[notifier] hooks.${name} threw`, err);
    }
  }

  async close(): Promise<void> {
    const closable = [
      ...this.emailProviders,
      ...this.smsProviders,
      ...this.pushProviders,
    ] as {
      close?: () => Promise<void>;
    }[];
    await Promise.all(
      closable.map(async (p) => {
        try {
          await p.close?.();
        } catch (err) {
          this.logger.error("[notifier] error closing a provider", err);
        }
      }),
    );
  }

  private toNotificationError(
    err: unknown,
    channel?: Channel,
    provider?: string,
  ): NotificationError {
    if (err instanceof NotificationError) return err;
    return new NotificationError({
      code: NotificationErrorCode.PROVIDER_ERROR,
      channel,
      provider,
      retryable: false,
      cause: err,
    });
  }
}

export function createNotifier(config: NotifierConfig): Notifier {
  return new Notifier(config);
}
