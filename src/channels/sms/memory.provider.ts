import { randomUUID } from "node:crypto";
import type { SmsProvider, NormalizedSms, ProviderContext } from "../../types";

export class MemorySmsProvider implements SmsProvider {
  readonly name = "memory";
  readonly sent: NormalizedSms[] = [];
  private failNextError: Error | null = null;

  async send(msg: NormalizedSms, _ctx: ProviderContext) {
    if (this.failNextError) {
      const err = this.failNextError;
      this.failNextError = null;
      throw err;
    }
    this.sent.push(msg);
    return { providerMessageId: `memory-${randomUUID()}` };
  }

  failNext(error: Error): void {
    this.failNextError = error;
  }

  clear(): void {
    this.sent.length = 0;
  }

  async verify() {}
}
