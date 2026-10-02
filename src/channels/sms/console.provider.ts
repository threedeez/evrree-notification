import { randomUUID } from "node:crypto";
import { redactPhone } from "../../validation/phone";
import type { SmsProvider, NormalizedSms, ProviderContext } from "../../types";

export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";

  async send(msg: NormalizedSms, ctx: ProviderContext) {
    ctx.logger.info("[sms:console]", {
      to: msg.to.map(redactPhone),
      length: msg.text.length,
    });
    return { providerMessageId: `console-${randomUUID()}` };
  }

  async verify() {}
}
