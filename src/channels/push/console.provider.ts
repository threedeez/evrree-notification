import { randomUUID } from "node:crypto";
import type { PushProvider, PushMessage, ProviderContext } from "../../types";

export class ConsolePushProvider implements PushProvider {
  readonly name = "console";

  async send(msg: PushMessage, ctx: ProviderContext) {
    const target =
      "tokens" in msg.to
        ? `${msg.to.tokens.length} token(s)`
        : `topic:${msg.to.topic}`;
    ctx.logger.info("[push:console]", { to: target, title: msg.title });
    return { providerMessageId: `console-${randomUUID()}` };
  }

  async subscribeToTopic(tokens: string[]) {
    return { successCount: tokens.length, failedTokens: [] };
  }

  async unsubscribeFromTopic(tokens: string[]) {
    return { successCount: tokens.length, failedTokens: [] };
  }

  async verify() {}
}
