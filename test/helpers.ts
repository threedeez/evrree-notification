import { createNotifier, NotificationError } from "../src/index.js";
import type {
  EmailProvider,
  NotifierConfig,
  SmsProvider,
} from "../src/index.js";

export type Behavior = () => Promise<{ providerMessageId?: string }>;

export function fakeSms(
  name: string,
  behavior: Behavior,
): SmsProvider & { calls: number } {
  const p = {
    name,
    calls: 0,

    async send() {
      p.calls++;

      console.log(`[fakeSms:${name}] called`, {
        calls: p.calls,
      });

      try {
        const result = await behavior();

        console.log(`[fakeSms:${name}] resolved`, result);

        return result;
      } catch (error) {
        console.log(`[fakeSms:${name}] rejected`, {
          error,
          isNotificationError: error instanceof NotificationError,
          code: error instanceof NotificationError ? error.code : undefined,
          retryable:
            error instanceof NotificationError ? error.retryable : undefined,
        });

        throw error;
      }
    },
  };

  return p;
}

export function fakeEmail(
  name: string,
  behavior: Behavior,
): EmailProvider & { calls: number } {
  const p = {
    name,
    calls: 0,
    async send() {
      p.calls++;
      return behavior();
    },
  };
  return p;
}

export const ok =
  (id = "msg-1"): Behavior =>
  async () => ({ providerMessageId: id });
export const fail =
  (
    code: ConstructorParameters<typeof NotificationError>[0]["code"],
    retryable: boolean,
    extra: Partial<ConstructorParameters<typeof NotificationError>[0]> = {},
  ): Behavior =>
  async () => {
    throw new NotificationError({ code, retryable, ...extra });
  };

export const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

export function smsNotifier(
  providers: SmsProvider[],
  extra: Partial<NotifierConfig> = {},
) {
  return createNotifier({
    appName: "Evrree CBT",
    defaultCountryCode: "NG",
    sms: {
      providers: providers.map((instance) => ({
        type: "custom" as const,
        instance,
      })),
    },
    retry: { attempts: 3, initialDelayMs: 500, maxDelayMs: 5000 },
    logger: silentLogger,
    ...extra,
  });
}

export function emailNotifier(
  providers: EmailProvider[],
  extra: Partial<NotifierConfig> = {},
) {
  return createNotifier({
    appName: "Evrree CBT",
    defaultCountryCode: "NG",
    email: {
      from: { name: "Evrree", address: "no-reply@evrree.com" },
      providers: providers.map((instance) => ({
        type: "custom" as const,
        instance,
      })),
    },
    logger: silentLogger,
    ...extra,
  });
}
