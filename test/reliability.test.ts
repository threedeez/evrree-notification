import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emailNotifier,
  fail,
  fakeEmail,
  fakeSms,
  ok,
  smsNotifier,
} from "./helpers.js";

const SMS = { to: "08031234567", text: "hi" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("retry + fallback", () => {
  it("AC26: 503 is retried up to `attempts` times, then falls back; attempts counts every try", async () => {
    const termii = fakeSms(
      "termii",
      fail("PROVIDER_ERROR", true, { statusCode: 503 }),
    );
    const twilio = fakeSms("twilio", ok("tw-1"));
    const notifier = smsNotifier([termii, twilio]);

    const pending = notifier.sms.send(SMS);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(termii.calls).toBe(3);
    expect(twilio.calls).toBe(1);
    expect(result.status).toBe("sent");
    expect(result.provider).toBe("twilio");
    expect(result.attempts).toBe(4);
    expect(result.providerMessageId).toBe("tw-1");
  });

  it("AC27: 401 is not retried, reports PROVIDER_AUTH_ERROR, and moves to the fallback", async () => {
    const termii = fakeSms(
      "termii",
      fail("PROVIDER_AUTH_ERROR", false, { statusCode: 401 }),
    );
    const twilio = fakeSms("twilio", ok());
    const result = await smsNotifier([termii, twilio]).sms.send(SMS);
    expect(termii.calls).toBe(1);
    expect(result.provider).toBe("twilio");
    expect(result.attempts).toBe(2);

    const onlyBad = await smsNotifier([
      fakeSms(
        "termii",
        fail("PROVIDER_AUTH_ERROR", false, { statusCode: 401 }),
      ),
    ]).sms.send(SMS);
    expect(onlyBad.status).toBe("failed");
    expect(onlyBad.error?.code).toBe("PROVIDER_AUTH_ERROR");
    expect(onlyBad.attempts).toBe(1);
  });

  it("AC28: honours Retry-After (2s) before retrying", async () => {
    let n = 0;
    const p = fakeSms("termii", async () => {
      if (++n === 1)
        throw new (await import("../src/index.js")).NotificationError({
          code: "RATE_LIMITED",
          retryable: true,
          statusCode: 429,
          cause: { retryAfterMs: 2000 },
        });
      return { providerMessageId: "x" };
    });
    const pending = smsNotifier([p]).sms.send(SMS);
    await vi.advanceTimersByTimeAsync(1999);
    expect(p.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(p.calls).toBe(2);
    expect(result.status).toBe("sent");
  });

  it("AC29: a hanging provider times out after 10s with TIMEOUT", async () => {
    const hang = fakeSms("slow", () => new Promise(() => {}));
    const notifier = smsNotifier([hang], { retry: { attempts: 1 } });
    const pending = notifier.sms.send(SMS);
    await vi.advanceTimersByTimeAsync(9999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("TIMEOUT");
  });

  it("all providers failing resolves as failed (does not throw) and calls onFailed once", async () => {
    const onFailed = vi.fn();
    const onSent = vi.fn();
    const notifier = smsNotifier(
      [
        fakeSms("a", fail("PROVIDER_ERROR", false)),
        fakeSms("b", fail("PROVIDER_ERROR", false)),
      ],
      { hooks: { onFailed, onSent } },
    );
    const result = await notifier.sms.send(SMS);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("PROVIDER_ERROR");
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onSent).not.toHaveBeenCalled();
  });

  it("a caller abort stops everything with ABORTED and skips fallbacks", async () => {
    const controller = new AbortController();
    controller.abort();
    const b = fakeSms("b", ok());
    const result = await smsNotifier([fakeSms("a", ok()), b]).sms.send(SMS, {
      signal: controller.signal,
    });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("ABORTED");
    expect(b.calls).toBe(0);
  });
});

describe("idempotency, hooks, dry run", () => {
  it("AC30: same idempotencyKey sends once and returns the same result", async () => {
    const p = fakeSms("a", ok());
    const notifier = smsNotifier([p]);
    const first = await notifier.sms.send(SMS, { idempotencyKey: "otp-1" });
    const second = await notifier.sms.send(SMS, { idempotencyKey: "otp-1" });
    expect(p.calls).toBe(1);
    expect(second).toBe(first);
    await notifier.sms.send(SMS, { idempotencyKey: "otp-2" });
    expect(p.calls).toBe(2);
  });

  it("AC30: the key expires after 24h", async () => {
    const p = fakeSms("a", ok());
    const notifier = smsNotifier([p]);
    await notifier.sms.send(SMS, { idempotencyKey: "k" });
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    await notifier.sms.send(SMS, { idempotencyKey: "k" });
    expect(p.calls).toBe(2);
  });

  it("AC31: onSent fires once, and a throwing hook never breaks the send", async () => {
    const onSent = vi.fn(() => {
      throw new Error("audit db down");
    });
    const error = vi.fn();
    const notifier = smsNotifier([fakeSms("a", ok())], {
      hooks: { onSent },
      logger: { debug() {}, info() {}, warn() {}, error },
    });
    const result = await notifier.sms.send(SMS);
    expect(result.status).toBe("sent");
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });

  it("AC32: dryRun validates but never calls a provider", async () => {
    const p = fakeSms("a", ok());
    const notifier = smsNotifier([p], { dryRun: true });
    const result = await notifier.sms.send(SMS);
    expect(result.status).toBe("dry_run");
    expect(p.calls).toBe(0);
    await expect(
      notifier.sms.send({ to: "12345", text: "x" }),
    ).rejects.toMatchObject({
      code: "INVALID_RECIPIENT",
    });
  });
});

describe("caller mistakes throw, provider failures resolve", () => {
  it("AC7: unconfigured channel throws CHANNEL_NOT_CONFIGURED", async () => {
    const n = smsNotifier([fakeSms("a", ok())]);
    await expect(
      n.email.send({ to: "a@b.com", subject: "s", text: "t" }),
    ).rejects.toMatchObject({
      code: "CHANNEL_NOT_CONFIGURED",
    });
    await expect(
      n.push.send({ to: { tokens: ["t"] }, title: "t", body: "b" }),
    ).rejects.toMatchObject({
      code: "CHANNEL_NOT_CONFIGURED",
    });
  });

  it("validates email, sms and push messages", async () => {
    const e = emailNotifier([fakeEmail("smtp", ok())]);
    await expect(
      e.email.send({ to: "not-an-email", subject: "s", text: "t" }),
    ).rejects.toMatchObject({
      code: "INVALID_RECIPIENT",
    });
    await expect(
      e.email.send({ to: "a@b.com", subject: "s" }),
    ).rejects.toMatchObject({
      code: "INVALID_MESSAGE",
    });
    await expect(
      e.email.send({ to: "a@b.com", subject: "", text: "t" }),
    ).rejects.toMatchObject({
      code: "INVALID_MESSAGE",
    });
    await expect(
      e.email.send({ to: [], subject: "s", text: "t" }),
    ).rejects.toMatchObject({
      code: "INVALID_RECIPIENT",
    });
    await expect(
      smsNotifier([fakeSms("a", ok())]).sms.send({
        to: "08031234567",
        text: "",
      }),
    ).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
  });

  it("SMS to duplicate numbers is de-duplicated after normalising", async () => {
    let received: string[] = [];
    const p = {
      name: "a",
      async send(msg: { to: string[] }) {
        received = msg.to;
        return {};
      },
    };
    await smsNotifier([p]).sms.send({
      to: ["08031234567", "+2348031234567", "0803 123 4567"],
      text: "x",
    });
    expect(received).toEqual(["+2348031234567"]);
  });
});

describe("email content", () => {
  it("AC9: generates plain text when only html is given", async () => {
    let seen: { text?: string } = {};
    const p = {
      name: "e",
      async send(m: { text?: string }) {
        seen = m;
        return {};
      },
    };
    await emailNotifier([p]).email.send({
      to: "a@b.com",
      subject: "s",
      html: "<h1>Hello</h1><p>Your code is <b>4821</b>&amp; more</p>",
    });
    expect(seen.text).toContain("Hello");
    expect(seen.text).toContain("4821");
    expect(seen.text).not.toContain("<");
  });

  it("AC10: multiple to/cc/bcc and named addresses; config from/replyTo applied", async () => {
    let seen!: { to: unknown; cc?: unknown; bcc?: unknown; from: unknown };
    const p = {
      name: "e",
      async send(m: typeof seen) {
        seen = m;
        return {};
      },
    };
    const n = emailNotifier([p]);
    await n.email.send({
      to: ["a@b.com", { name: "Bee", address: "bee@b.com" }],
      cc: "c@b.com",
      bcc: [{ address: "d@b.com" }],
      subject: "s",
      text: "t",
    });
    expect(seen.to).toEqual([
      { address: "a@b.com" },
      { name: "Bee", address: "bee@b.com" },
    ]);
    expect(seen.cc).toEqual([{ address: "c@b.com" }]);
    expect(seen.bcc).toEqual([{ address: "d@b.com" }]);
    expect(seen.from).toEqual({
      name: "Evrree",
      address: "no-reply@evrree.com",
    });
  });
});
