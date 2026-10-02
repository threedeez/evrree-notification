import { NotificationError } from "../errors";
import { createNotifier, Notifier } from "../notifier";
import { MemoryEmailProvider } from "../channels/email/memory.provider";
import { MemorySmsProvider } from "../channels/sms/memory.provider";
import { MemoryPushProvider } from "../channels/push/memory.provider";
import type {
  Channel,
  NotificationTemplate,
  NormalizedEmail,
  NormalizedSms,
  PushMessage,
} from "../types";

export interface TestNotifierOptions {
  appName?: string;
  defaultCountryCode?: string;
  templates?: NotificationTemplate[];
}

export interface Outbox {
  email: NormalizedEmail[];
  sms: NormalizedSms[];
  push: PushMessage[];
  clear(): void;
}

export interface TestNotifier extends Notifier {
  outbox: Outbox;
  /** Makes the next send() on the given channel throw the given error. */
  failNext(channel: Channel, error: NotificationError): void;
}

/**
 * All channels wired to in-memory providers, with inspection helpers.
 * See README "Testing" section — `notifier.outbox.email` etc.
 */
export function createTestNotifier(
  options: TestNotifierOptions = {},
): TestNotifier {
  const emailProvider = new MemoryEmailProvider();
  const smsProvider = new MemorySmsProvider();
  const pushProvider = new MemoryPushProvider();

  const notifier = createNotifier({
    appName: options.appName ?? "Test App",
    defaultCountryCode: options.defaultCountryCode ?? "NG",
    email: {
      from: { address: "test@example.com" },
      providers: [{ type: "custom", instance: emailProvider }],
    },
    sms: { providers: [{ type: "custom", instance: smsProvider }] },
    push: { providers: [{ type: "custom", instance: pushProvider }] },
    templates: options.templates,
  }) as TestNotifier;

  const outbox: Outbox = {
    get email() {
      return emailProvider.sent;
    },
    get sms() {
      return smsProvider.sent;
    },
    get push() {
      return pushProvider.sent;
    },
    clear() {
      emailProvider.clear();
      smsProvider.clear();
      pushProvider.clear();
    },
  };

  notifier.outbox = outbox;
  notifier.failNext = (channel, error) => {
    if (channel === "email") {
      emailProvider.failNext(error);
    } else if (channel === "sms") {
      smsProvider.failNext(error);
    } else {
      pushProvider.failNext(error);
    }
  };

  return notifier;
}

export { NotificationError } from "../errors";
