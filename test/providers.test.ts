import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleEmailProvider } from "../src/channels/email/console.provider.js";
import { MemoryEmailProvider } from "../src/channels/email/memory.provider.js";
import { ConsoleSmsProvider } from "../src/channels/sms/console.provider.js";
import { MemorySmsProvider } from "../src/channels/sms/memory.provider.js";
import { ConsolePushProvider } from "../src/channels/push/console.provider.js";
import { MemoryPushProvider } from "../src/channels/push/memory.provider.js";
import { silentLogger } from "./helpers.js";

const ctx = {
  signal: new AbortController().signal,
  logger: silentLogger,
  attempt: 1,
};

describe("ConsoleEmailProvider", () => {
  it("logs a redacted summary and returns a fake id; verify() resolves", async () => {
    const info = vi.fn();
    const p = new ConsoleEmailProvider();
    const res = await p.send(
      {
        to: [{ address: "ada@gmail.com" }],
        from: { address: "x@y.com" },
        subject: "Hi",
      } as never,
      { ...ctx, logger: { ...silentLogger, info } },
    );
    expect(res.providerMessageId).toMatch(/^console-/);
    expect(info).toHaveBeenCalledWith("[email:console]", {
      to: ["a***@gmail.com"],
      subject: "Hi",
    });
    await expect(p.verify?.()).resolves.toBeUndefined();
  });
});

describe("MemoryEmailProvider", () => {
  it("stores sent messages, supports failNext and clear, verify() resolves", async () => {
    const p = new MemoryEmailProvider();
    await p.send({ subject: "a" } as never);
    await p.send({ subject: "b" } as never);
    expect(p.sent).toHaveLength(2);

    p.failNext(new Error("boom"));
    await expect(p.send({ subject: "c" } as never)).rejects.toThrow("boom");
    expect(p.sent).toHaveLength(2); // the failed one was not recorded

    // failNext only fires once
    await p.send({ subject: "d" } as never);
    expect(p.sent).toHaveLength(3);

    p.clear();
    expect(p.sent).toHaveLength(0);
    await expect(p.verify?.()).resolves.toBeUndefined();
  });
});

describe("ConsoleSmsProvider", () => {
  it("logs a redacted summary; verify() resolves", async () => {
    const info = vi.fn();
    const p = new ConsoleSmsProvider();
    const res = await p.send(
      { to: ["+2348031234567"], text: "hello" },
      { ...ctx, logger: { ...silentLogger, info } },
    );
    expect(res.providerMessageId).toMatch(/^console-/);
    expect(info).toHaveBeenCalledWith("[sms:console]", {
      to: ["+234803****567"],
      length: 5,
    });
    await expect(p.verify?.()).resolves.toBeUndefined();
  });
});

describe("MemorySmsProvider", () => {
  it("stores sent messages, supports failNext and clear, verify() resolves", async () => {
    const p = new MemorySmsProvider();
    await p.send({ to: ["+2348031234567"], text: "a" });
    expect(p.sent).toHaveLength(1);
    p.failNext(new Error("down"));
    await expect(p.send({ to: ["+2348031234567"], text: "b" })).rejects.toThrow(
      "down",
    );
    expect(p.sent).toHaveLength(1);
    p.clear();
    expect(p.sent).toHaveLength(0);
    await expect(p.verify?.()).resolves.toBeUndefined();
  });
});

describe("ConsolePushProvider", () => {
  it("logs token-count target and topic target; subscribe/unsubscribe/verify all resolve", async () => {
    const info = vi.fn();
    const p = new ConsolePushProvider();
    await p.send(
      { to: { tokens: ["a", "b"] }, title: "t", body: "b" },
      { ...ctx, logger: { ...silentLogger, info } },
    );
    expect(info).toHaveBeenCalledWith("[push:console]", {
      to: "2 token(s)",
      title: "t",
    });

    await p.send(
      { to: { topic: "exam" }, title: "t2", body: "b" },
      { ...ctx, logger: { ...silentLogger, info } },
    );
    expect(info).toHaveBeenCalledWith("[push:console]", {
      to: "topic:exam",
      title: "t2",
    });

    await expect(p.subscribeToTopic(["a", "b"])).resolves.toEqual({
      successCount: 2,
      failedTokens: [],
    });
    await expect(p.unsubscribeFromTopic(["a"])).resolves.toEqual({
      successCount: 1,
      failedTokens: [],
    });
    await expect(p.verify?.()).resolves.toBeUndefined();
  });
});

describe("MemoryPushProvider", () => {
  it("stores sent messages, supports failNext/clear, subscribe/unsubscribe/verify", async () => {
    const p = new MemoryPushProvider();
    await p.send({ to: { tokens: ["t"] }, title: "a", body: "b" });
    expect(p.sent).toHaveLength(1);
    p.failNext(new Error("down"));
    await expect(
      p.send({ to: { tokens: ["t"] }, title: "a", body: "b" }),
    ).rejects.toThrow("down");
    p.clear();
    expect(p.sent).toHaveLength(0);
    await expect(p.subscribeToTopic(["a"])).resolves.toEqual({
      successCount: 1,
      failedTokens: [],
    });
    await expect(p.unsubscribeFromTopic(["a", "b"])).resolves.toEqual({
      successCount: 2,
      failedTokens: [],
    });
    await expect(p.verify?.()).resolves.toBeUndefined();
  });
});

const { sendMail, verify, close } = vi.hoisted(() => ({
  sendMail: vi.fn(),
  verify: vi.fn(),
  close: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail, verify, close }),
  },
}));

describe("SmtpEmailProvider (mocked nodemailer)", () => {
  afterEach(() => vi.clearAllMocks());

  it("maps fields and returns the nodemailer messageId", async () => {
    const { SmtpEmailProvider } =
      await import("../src/channels/email/smtp.provider.js");
    sendMail.mockResolvedValueOnce({ messageId: "abc123" });
    const p = new SmtpEmailProvider({
      host: "smtp.x.com",
      port: 587,
      secure: false,
      auth: { user: "u", pass: "p" },
    });

    const res = await p.send(
      {
        to: [{ address: "a@b.com" }],
        cc: [{ address: "c@b.com" }],
        bcc: [{ name: "D", address: "d@b.com" }],
        from: { name: "Evrree", address: "no-reply@evrree.com" },
        replyTo: "support@evrree.com",
        subject: "Hi",
        html: "<p>x</p>",
        text: "x",
        attachments: [{ filename: "a.txt", content: "hi" }],
        headers: { "X-Test": "1" },
      } as never,
      ctx,
    );

    expect(res.providerMessageId).toBe("abc123");
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Evrree" <no-reply@evrree.com>',
        to: ["a@b.com"],
        cc: ["c@b.com"],
        bcc: ['"D" <d@b.com>'],
        replyTo: "support@evrree.com",
        subject: "Hi",
      }),
    );
  });

  it("maps EAUTH to PROVIDER_AUTH_ERROR (not retryable)", async () => {
    const { SmtpEmailProvider } =
      await import("../src/channels/email/smtp.provider.js");
    sendMail.mockRejectedValueOnce({ code: "EAUTH", message: "bad creds" });
    const p = new SmtpEmailProvider({
      host: "h",
      port: 587,
      secure: false,
      auth: { user: "u", pass: "p" },
    });
    await expect(
      p.send(
        { to: [], from: { address: "a@b.com" }, subject: "s" } as never,
        ctx,
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_AUTH_ERROR",
      retryable: false,
    });
  });

  it("maps a 4xx SMTP response code to retryable, 5xx to not retryable", async () => {
    const { SmtpEmailProvider } =
      await import("../src/channels/email/smtp.provider.js");
    const p = new SmtpEmailProvider({
      host: "h",
      port: 587,
      secure: false,
      auth: { user: "u", pass: "p" },
    });

    sendMail.mockRejectedValueOnce({ responseCode: 450 });
    await expect(
      p.send(
        { to: [], from: { address: "a@b.com" }, subject: "s" } as never,
        ctx,
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: true,
      statusCode: 450,
    });

    sendMail.mockRejectedValueOnce({ responseCode: 550 });
    await expect(
      p.send(
        { to: [], from: { address: "a@b.com" }, subject: "s" } as never,
        ctx,
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: false,
      statusCode: 550,
    });
  });

  it("maps a network error code to retryable TIMEOUT/PROVIDER_ERROR", async () => {
    const { SmtpEmailProvider } =
      await import("../src/channels/email/smtp.provider.js");
    const p = new SmtpEmailProvider({
      host: "h",
      port: 587,
      secure: false,
      auth: { user: "u", pass: "p" },
    });

    sendMail.mockRejectedValueOnce({ code: "ETIMEDOUT" });
    await expect(
      p.send(
        { to: [], from: { address: "a@b.com" }, subject: "s" } as never,
        ctx,
      ),
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      retryable: true,
    });

    sendMail.mockRejectedValueOnce({ code: "ECONNRESET" });
    await expect(
      p.send(
        { to: [], from: { address: "a@b.com" }, subject: "s" } as never,
        ctx,
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: true,
    });

    sendMail.mockRejectedValueOnce(new Error("totally unknown failure"));
    await expect(
      p.send(
        { to: [], from: { address: "a@b.com" }, subject: "s" } as never,
        ctx,
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: false,
    });
  });

  it("verify() and close() delegate to the transporter", async () => {
    const { SmtpEmailProvider } =
      await import("../src/channels/email/smtp.provider.js");
    const p = new SmtpEmailProvider({
      host: "h",
      port: 587,
      secure: false,
      auth: { user: "u", pass: "p" },
    });
    verify.mockResolvedValueOnce(true);
    await p.verify();
    expect(verify).toHaveBeenCalled();
    await p.close();
    expect(close).toHaveBeenCalled();
  });
});
