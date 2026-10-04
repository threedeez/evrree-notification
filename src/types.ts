import type { NotificationError } from "./errors";

export type Channel = "email" | "sms" | "push";

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface EmailMessage {
  to: string | EmailAddress | (string | EmailAddress)[];
  cc?: string | EmailAddress | (string | EmailAddress)[];
  bcc?: string | EmailAddress | (string | EmailAddress)[];
  from?: EmailAddress;
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  tags?: Record<string, string>;
}

export interface SmsMessage {
  to: string | string[];
  text: string;
  senderId?: string;
}

export interface PushMessage {
  to: { tokens: string[] } | { topic: string };
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  badge?: number;
  sound?: string;
  priority?: "normal" | "high";
  ttlSeconds?: number;
}

export interface SendOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface SendResult {
  id: string;
  channel: Channel;
  status: "sent" | "failed" | "dry_run";
  provider?: string;
  providerMessageId?: string;
  attempts: number;
  recipients: string[];
  error?: NotificationError;
  invalidTokens?: string[];
  sentAt?: Date;
}

export interface Recipient {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  pushTokens?: string[];
  locale?: string;
}

export interface NotifyOptions extends SendOptions {
  channels?: Channel[];
  strategy?: "all" | "first-success";
}

export interface NotifyResult {
  results: SendResult[];
  succeeded: Channel[];
  failed: Channel[];
}

// ---- Templates ----------------------------------------------------------

export interface TemplateContent {
  email?: { subject: string; html: string; text?: string };
  sms?: { text: string };
  push?: { title: string; body: string; data?: Record<string, string> };
}

export interface NotificationTemplate {
  id: string;
  locales?: Record<string, TemplateContent>;
  content: TemplateContent;
}

export interface SendOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
}

export interface NotifierConfig {
  timeoutMs?: number;
  idempotencyTtlMs?: number;
}

// ---- Provider-facing types ----------------------------------------------

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ProviderContext {
  signal: AbortSignal;
  logger: Logger;
  attempt: number;
}

export interface NormalizedEmail extends Omit<
  EmailMessage,
  "to" | "cc" | "bcc" | "from"
> {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  from: EmailAddress;
}

export interface NormalizedSms extends Omit<SmsMessage, "to"> {
  to: string[];
}

export interface EmailProvider {
  name: string;
  send(
    msg: NormalizedEmail,
    ctx: ProviderContext,
  ): Promise<{ providerMessageId?: string }>;
  verify?(): Promise<void>;
  close?(): Promise<void>;
}

export interface SmsProvider {
  name: string;
  send(
    msg: NormalizedSms,
    ctx: ProviderContext,
  ): Promise<{ providerMessageId?: string }>;
  verify?(): Promise<void>;
  close?(): Promise<void>;
}

export interface PushProvider {
  name: string;
  send(
    msg: PushMessage,
    ctx: ProviderContext,
  ): Promise<{ providerMessageId?: string; invalidTokens?: string[] }>;
  subscribeToTopic?(
    tokens: string[],
    topic: string,
  ): Promise<{ successCount: number; failedTokens: string[] }>;
  unsubscribeFromTopic?(
    tokens: string[],
    topic: string,
  ): Promise<{ successCount: number; failedTokens: string[] }>;
  verify?(): Promise<void>;
}

// ---- Config ---------------------------------------------------------------

export interface RetryConfig {
  attempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export type EmailProviderConfig =
  | {
      type: "smtp";
      host: string;
      port: number;
      secure: boolean;
      auth: { user: string; pass: string };
    }
  | { type: "console" }
  | { type: "memory" }
  | { type: "custom"; instance: EmailProvider };

export type SmsProviderConfig =
  | {
      type: "termii";
      apiKey: string;
      channel: "generic" | "dnd";
      baseUrl: string;
    }
  | {
      type: "twilio";
      accountSid: string;
      baseUrl: string;
      authToken: string;
      from: string;
    }
  | { type: "console" }
  | { type: "memory" }
  | { type: "custom"; instance: SmsProvider };

export type PushProviderConfig =
  | {
      type: "fcm";
      serviceAccount: {
        projectId: string;
        clientEmail: string;
        privateKey: string;
      };
    }
  | { type: "console" }
  | { type: "memory" }
  | { type: "custom"; instance: PushProvider };

export interface NotifierConfig {
  appName: string;
  defaultCountryCode: string;
  email?: {
    from: EmailAddress;
    replyTo?: string;
    layout?: string;
    providers: EmailProviderConfig[];
  };
  sms?: {
    senderId?: string;
    providers: SmsProviderConfig[];
  };
  push?: {
    providers: PushProviderConfig[];
  };
  retry?: Partial<RetryConfig>;
  templates?: NotificationTemplate[];
  hooks?: {
    onSent?: (result: SendResult) => void | Promise<void>;
    onFailed?: (result: SendResult) => void | Promise<void>;
  };
  dryRun?: boolean;
  logger?: Logger;
}
