export { createNotifier, Notifier } from "./notifier";
export { createTestNotifier } from "./testing";
export { NotificationError } from "./errors";
export type { NotificationErrorCode } from "./errors";

export type {
  Channel,
  EmailAddress,
  EmailAttachment,
  EmailMessage,
  SmsMessage,
  PushMessage,
  SendOptions,
  SendResult,
  Recipient,
  NotifyOptions,
  NotifyResult,
  NotificationTemplate,
  TemplateContent,
  Logger,
  ProviderContext,
  EmailProvider,
  SmsProvider,
  PushProvider,
  NotifierConfig,
  EmailProviderConfig,
  SmsProviderConfig,
  PushProviderConfig,
  RetryConfig,
} from "./types";
