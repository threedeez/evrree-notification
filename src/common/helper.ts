// ---------------------------------------------------------------------------
// Provider construction
// ---------------------------------------------------------------------------

import { NotificationErrorCode } from ".";
import { ConsoleEmailProvider } from "../channels/email/console.provider";
import { MemoryEmailProvider } from "../channels/email/memory.provider";
import { SmtpEmailProvider } from "../channels/email/smtp.provider";
import { ConsolePushProvider } from "../channels/push/console.provider";
import { FcmPushProvider } from "../channels/push/fcm.provider";
import { MemoryPushProvider } from "../channels/push/memory.provider";
import { ConsoleSmsProvider } from "../channels/sms/console.provider";
import { MemorySmsProvider } from "../channels/sms/memory.provider";
import { TermiiSmsProvider } from "../channels/sms/termii.provider";
import { TwilioSmsProvider } from "../channels/sms/twilio.provider";
import { NotificationError } from "../errors";
import {
  EmailProvider,
  NotifierConfig,
  PushProvider,
  SmsProvider,
} from "../types";

export function buildEmailProviders(config: NotifierConfig): EmailProvider[] {
  if (!config.email) return [];
  return config.email.providers.map((p, i) => {
    switch (p.type) {
      case "smtp":
        if (!p.host) {
          throw new NotificationError({
            code: NotificationErrorCode.CONFIG_ERROR,
            message: `email.providers[${i}].host is required for type "smtp"`,
          });
        }
        return new SmtpEmailProvider(p);
      case "console":
        return new ConsoleEmailProvider();
      case "memory":
        return new MemoryEmailProvider();
      case "custom":
        return p.instance;
      default:
        throw new NotificationError({
          code: NotificationErrorCode.CONFIG_ERROR,
          message: `Unknown email provider type at index ${i}`,
        });
    }
  });
}

export function buildSmsProviders(config: NotifierConfig): SmsProvider[] {
  if (!config.sms) return [];
  return config.sms.providers.map((p, i) => {
    switch (p.type) {
      case "termii":
        if (!p.apiKey) {
          throw new NotificationError({
            code: NotificationErrorCode.CONFIG_ERROR,
            message: `sms.providers[${i}].apiKey is required for type "termii"`,
          });
        }
        return new TermiiSmsProvider({
          ...p,
          senderId: config.sms?.senderId,
          baseUrl: p.baseUrl ?? "",
        });
      case "twilio":
        if (!p.accountSid || !p.authToken) {
          throw new NotificationError({
            code: NotificationErrorCode.CONFIG_ERROR,
            message: `sms.providers[${i}] is missing accountSid/authToken for type "twilio"`,
          });
        }
        return new TwilioSmsProvider({
          ...p,
          baseUrl: p.baseUrl ?? "",
        });
      case "console":
        return new ConsoleSmsProvider();
      case "memory":
        return new MemorySmsProvider();
      case "custom":
        return p.instance;
      default:
        throw new NotificationError({
          code: NotificationErrorCode.CONFIG_ERROR,
          message: `Unknown sms provider type at index ${i}`,
        });
    }
  });
}

export function buildPushProviders(config: NotifierConfig): PushProvider[] {
  if (!config.push) return [];
  return config.push.providers.map((p, i) => {
    switch (p.type) {
      case "fcm":
        if (!p.serviceAccount?.projectId) {
          throw new NotificationError({
            code: NotificationErrorCode.CONFIG_ERROR,
            message: `push.providers[${i}].serviceAccount is required for type "fcm"`,
          });
        }
        return new FcmPushProvider(p);
      case "console":
        return new ConsolePushProvider();
      case "memory":
        return new MemoryPushProvider();
      case "custom":
        return p.instance;
      default:
        throw new NotificationError({
          code: NotificationErrorCode.CONFIG_ERROR,
          message: `Unknown push provider type at index ${i}`,
        });
    }
  });
}

export function validateConfig(config: NotifierConfig): void {
  if (!config.appName)
    throw new NotificationError({
      code: NotificationErrorCode.CONFIG_ERROR,
      message: "appName is required",
    });
  if (!config.defaultCountryCode) {
    throw new NotificationError({
      code: NotificationErrorCode.CONFIG_ERROR,
      message: "defaultCountryCode is required",
    });
  }
  if (config.email && config.email.providers.length === 0) {
    throw new NotificationError({
      code: NotificationErrorCode.CONFIG_ERROR,
      message: "email.providers must not be empty",
    });
  }
  if (config.sms && config.sms.providers.length === 0) {
    throw new NotificationError({
      code: NotificationErrorCode.CONFIG_ERROR,
      message: "sms.providers must not be empty",
    });
  }
  if (config.push && config.push.providers.length === 0) {
    throw new NotificationError({
      code: NotificationErrorCode.CONFIG_ERROR,
      message: "push.providers must not be empty",
    });
  }
}
