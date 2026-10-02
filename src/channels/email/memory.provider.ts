import { randomUUID } from "node:crypto";
import type {
  EmailProvider,
  NormalizedEmail,
  ProviderContext,
} from "../../types.js";

/** Stores every sent message in memory. Used by createTestNotifier(). */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = "memory";
  readonly sent: NormalizedEmail[] = [];
  private failNextError: Error | null = null;

  async send(msg: NormalizedEmail, _ctx: ProviderContext) {
    if (this.failNextError) {
      const err = this.failNextError;
      this.failNextError = null;
      throw err;
    }
    this.sent.push(msg);
    return { providerMessageId: `memory-${randomUUID()}` };
  }

  /** Test helper: makes the next send() call throw the given error. */
  failNext(error: Error): void {
    this.failNextError = error;
  }

  clear(): void {
    this.sent.length = 0;
  }

  async verify() {
    // Always healthy.
  }
}
