import { Channels, NotificationErrorCode } from "../../common";
import { NotificationError } from "../../errors";
import type { SmsProvider, NormalizedSms, ProviderContext } from "../../types";

export interface TwilioProviderOptions {
  accountSid: string;
  authToken: string;
  baseUrl: string;
  from: string;
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";
  private readonly options: TwilioProviderOptions;

  constructor(options: TwilioProviderOptions) {
    this.options = options;
  }

  async send(
    msg: NormalizedSms,
    ctx: ProviderContext,
  ): Promise<{ providerMessageId?: string }> {
    const url = `${this.options.baseUrl}/${this.options.accountSid}/Messages.json`;
    const auth = Buffer.from(
      `${this.options.accountSid}:${this.options.authToken}`,
    ).toString("base64");

    let lastMessageId: string | undefined;
    for (const to of msg.to) {
      const body = new URLSearchParams({
        To: to,
        From: this.options.from,
        Body: msg.text,
      });

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: ctx.signal,
      });

      if (!res.ok) {
        throw new NotificationError({
          code:
            res.status === 401 || res.status === 403
              ? NotificationErrorCode.PROVIDER_AUTH_ERROR
              : NotificationErrorCode.PROVIDER_ERROR,
          channel: Channels.SMS,
          provider: this.name,
          statusCode: res.status,
          retryable: res.status === 429 || res.status >= 500,
        });
      }

      const data = (await res.json()) as { sid?: string };
      lastMessageId = data.sid;
    }

    return { providerMessageId: lastMessageId };
  }
}
