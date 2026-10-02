import { randomUUID } from "node:crypto";
import { redactEmail } from "../../validation/email";
import type {
  EmailProvider,
  NormalizedEmail,
  ProviderContext,
} from "../../types";

/** Prints a redacted summary via the configured logger. Never actually sends. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(msg: NormalizedEmail, ctx: ProviderContext) {
    ctx.logger.info("[email:console]", {
      to: msg.to.map((a) => redactEmail(a.address)),
      subject: msg.subject,
    });
    return { providerMessageId: `console-${randomUUID()}` };
  }

  async verify() {
    // Always healthy — it's a no-op provider.
  }
}
