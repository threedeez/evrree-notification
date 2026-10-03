import { Channels, NotificationErrorCode } from "../../common/index.js";
import { NotificationError } from "../../errors.js";
import type { PushProvider, PushMessage } from "../../types";

export interface FcmProviderOptions {
  serviceAccount: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  };
}

const BATCH_SIZE = 500;

const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

const PERMANENT_CODES = new Set([
  "messaging/invalid-argument",
  "messaging/third-party-auth-error",
  "messaging/sender-id-mismatch",
  "messaging/authentication-error",
]);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

function baseMessage(msg: PushMessage) {
  return {
    notification: { title: msg.title, body: msg.body, imageUrl: msg.imageUrl },
    data: msg.data,
    android: {
      priority: (msg.priority === "high" ? "high" : "normal") as
        "high" | "normal",
      ttl: msg.ttlSeconds != null ? msg.ttlSeconds * 1000 : undefined,
      notification: msg.sound ? { sound: msg.sound } : undefined,
    },
    apns: {
      headers: msg.priority === "high" ? { "apns-priority": "10" } : undefined,
      payload: { aps: { badge: msg.badge, sound: msg.sound } },
    },
  };
}

export class FcmPushProvider implements PushProvider {
  readonly name = "fcm";
  private appPromise: Promise<import("firebase-admin").app.App> | null = null;
  private readonly options: FcmProviderOptions;
  private static appCounter = 0;
  private readonly appName = `evrree-notification-${FcmPushProvider.appCounter++}`;

  constructor(options: FcmProviderOptions) {
    this.options = options;
  }

  private async getApp() {
    if (!this.appPromise) this.appPromise = this.initApp();
    return this.appPromise;
  }

  private async initApp() {
    let admin: typeof import("firebase-admin");
    try {
      admin =
        (await import("firebase-admin")).default ??
        (await import("firebase-admin"));
    } catch (cause) {
      throw new NotificationError({
        code: NotificationErrorCode.CONFIG_ERROR,
        channel: Channels.PUSH,
        provider: this.name,
        message: "Install firebase-admin to use the fcm push provider",
        cause,
      });
    }

    return admin.initializeApp(
      {
        credential: admin.credential.cert({
          projectId: this.options.serviceAccount.projectId,
          clientEmail: this.options.serviceAccount.clientEmail,
          privateKey: this.options.serviceAccount.privateKey,
        }),
      },
      this.appName,
    );
  }

  async send(msg: PushMessage) {
    const app = await this.getApp();
    const messaging = app.messaging();

    if ("topic" in msg.to) {
      try {
        const id = await messaging.send({
          topic: msg.to.topic,
          ...baseMessage(msg),
        });
        return { providerMessageId: id };
      } catch (cause) {
        throw this.mapError(cause);
      }
    }

    const batches = chunk(msg.to.tokens, BATCH_SIZE);
    let successCount = 0;
    let lastMessageId: string | undefined;
    const invalidTokens: string[] = [];
    const errors: unknown[] = [];

    for (const tokens of batches) {
      let response;
      try {
        response = await messaging.sendEachForMulticast({
          tokens,
          ...baseMessage(msg),
        });
      } catch (cause) {
        errors.push(cause);
        continue;
      }
      response.responses.forEach((r, i) => {
        if (r.success) {
          successCount++;
          lastMessageId = r.messageId ?? lastMessageId;
        } else {
          const code = (r.error as { code?: string } | undefined)?.code;
          if (code && DEAD_TOKEN_CODES.has(code))
            invalidTokens.push(tokens[i]!);
          else errors.push(r.error);
        }
      });
    }

    // At least one token got through -> counts as sent (AC15). Only throw
    // when *nothing* succeeded.
    if (successCount === 0 && msg.to.tokens.length > 0) {
      throw this.mapError(errors[0] ?? new Error("All tokens failed"));
    }

    return { providerMessageId: lastMessageId, invalidTokens };
  }

  async subscribeToTopic(tokens: string[], topic: string) {
    const app = await this.getApp();
    try {
      const res = await app.messaging().subscribeToTopic(tokens, topic);
      return {
        successCount: res.successCount,
        failedTokens: collectFailedTokens(tokens, res),
      };
    } catch (cause) {
      throw this.mapError(cause);
    }
  }

  async unsubscribeFromTopic(tokens: string[], topic: string) {
    const app = await this.getApp();
    try {
      const res = await app.messaging().unsubscribeFromTopic(tokens, topic);
      return {
        successCount: res.successCount,
        failedTokens: collectFailedTokens(tokens, res),
      };
    } catch (cause) {
      throw this.mapError(cause);
    }
  }

  /** Deletes the named Firebase app. Called by NotificationModule.onModuleDestroy in NestJS. */
  async close(): Promise<void> {
    if (!this.appPromise) return;
    const app = await this.appPromise;
    await app.delete();
    this.appPromise = null;
  }

  private mapError(cause: unknown): NotificationError {
    if (cause instanceof NotificationError) return cause;
    const code = (cause as { code?: string } | undefined)?.code;
    const isAuth =
      code === "messaging/authentication-error" ||
      code === "app/invalid-credential";
    return new NotificationError({
      code: isAuth
        ? NotificationErrorCode.PROVIDER_AUTH_ERROR
        : NotificationErrorCode.PROVIDER_ERROR,
      channel: Channels.PUSH,
      provider: this.name,
      retryable: !isAuth && !(code && PERMANENT_CODES.has(code)),
      message: `FCM request failed${code ? ` (${code})` : ""}`,
      cause,
    });
  }
}

function collectFailedTokens(
  tokens: string[],
  res: { errors: { index: number }[] },
): string[] {
  return res.errors.map((e) => tokens[e.index]!).filter(Boolean);
}
