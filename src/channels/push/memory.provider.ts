import { randomUUID } from "node:crypto";
import type { PushProvider, PushMessage, ProviderContext } from "../../types";

export class MemoryPushProvider implements PushProvider {
  readonly name = "memory";
  readonly sent: PushMessage[] = [];
  private failNextError: Error | null = null;

  async send(msg: PushMessage, _ctx: ProviderContext) {
    if (this.failNextError) {
      const err = this.failNextError;
      this.failNextError = null;
      throw err;
    }
    this.sent.push(msg);
    return { providerMessageId: `memory-${randomUUID()}` };
  }

  async subscribeToTopic(tokens: string[]) {
    return { successCount: tokens.length, failedTokens: [] };
  }

  async unsubscribeFromTopic(tokens: string[]) {
    return { successCount: tokens.length, failedTokens: [] };
  }

  failNext(error: Error): void {
    this.failNextError = error;
  }

  clear(): void {
    this.sent.length = 0;
  }

  async verify() {}
}
