import { describe, expect, it, vi } from "vitest";
import { createNotifier, NotificationError } from "../src/index.js";
import { fakeSms, ok, silentLogger, smsNotifier } from "./helpers.js";

describe('provider-config builders: "memory" type and unknown-type default case', () => {
  it('"memory" is a valid config type for email, sms and push (not just "custom")', async () => {
    const notifier = createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      email: { from: { address: "a@b.com" }, providers: [{ type: "memory" }] },
      sms: { providers: [{ type: "memory" }] },
      push: { providers: [{ type: "memory" }] },
      logger: silentLogger,
    });
    expect(
      (await notifier.email.send({ to: "a@b.com", subject: "s", text: "t" }))
        .provider,
    ).toBe("memory");
    expect(
      (await notifier.sms.send({ to: "08031234567", text: "t" })).provider,
    ).toBe("memory");
    expect(
      (
        await notifier.push.send({
          to: { tokens: ["t"] },
          title: "t",
          body: "b",
        })
      ).provider,
    ).toBe("memory");
  });

  it("an unrecognised provider type throws CONFIG_ERROR naming the index, for each channel", () => {
    const bad = (cfg: object) =>
      expect(() =>
        createNotifier({
          appName: "x",
          defaultCountryCode: "NG",
          ...cfg,
        } as never),
      ).toThrow(
        expect.objectContaining({
          code: "CONFIG_ERROR",
          message: expect.stringContaining("Unknown"),
        }),
      );
    bad({
      email: { from: { address: "a@b.com" }, providers: [{ type: "bogus" }] },
    });
    bad({ sms: { providers: [{ type: "bogus" }] } });
    bad({ push: { providers: [{ type: "bogus" }] } });
  });

  it('a well-formed "smtp" config actually constructs an SmtpEmailProvider (not just the error path)', () => {
    // Only construction is exercised here (no network call) - this proves
    // buildEmailProviders' happy path for "smtp", not SMTP delivery itself
    // (see test/providers.test.ts for mocked-nodemailer send behaviour, and
    // test/integration/smtp.mailpit.test.ts for a real end-to-end send).
    expect(() =>
      createNotifier({
        appName: "x",
        defaultCountryCode: "NG",
        email: {
          from: { address: "a@b.com" },
          providers: [
            {
              type: "smtp",
              host: "smtp.example.com",
              port: 587,
              secure: false,
              auth: { user: "u", pass: "p" },
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("email.providers: [] throws CONFIG_ERROR naming the field (the sms/push equivalents are tested elsewhere)", () => {
    expect(() =>
      createNotifier({
        appName: "x",
        defaultCountryCode: "NG",
        email: { from: { address: "a@b.com" }, providers: [] },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CONFIG_ERROR",
        message: expect.stringContaining("email.providers"),
      }),
    );
  });

  it("empty defaultCountryCode throws CONFIG_ERROR naming the field", () => {
    expect(() =>
      createNotifier({ appName: "x", defaultCountryCode: "" }),
    ).toThrow(
      expect.objectContaining({
        code: "CONFIG_ERROR",
        message: expect.stringContaining("defaultCountryCode"),
      }),
    );
  });
});

describe("dryRun across all three channels", () => {
  const notifier = () =>
    createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      dryRun: true,
      email: { from: { address: "a@b.com" }, providers: [{ type: "memory" }] },
      sms: { providers: [{ type: "memory" }] },
      push: { providers: [{ type: "memory" }] },
      logger: silentLogger,
    });

  it("email dryRun: validates, never calls the provider, status dry_run", async () => {
    const res = await notifier().email.send({
      to: "a@b.com",
      subject: "s",
      text: "t",
    });
    expect(res).toMatchObject({ status: "dry_run", attempts: 0 });
  });

  it("push dryRun: validates, never calls the provider, status dry_run", async () => {
    const res = await notifier().push.send({
      to: { tokens: ["t"] },
      title: "t",
      body: "b",
    });
    expect(res).toMatchObject({ status: "dry_run", attempts: 0 });
  });
});

describe("sms channel guard rails not covered elsewhere", () => {
  it("CHANNEL_NOT_CONFIGURED when no sms providers are configured at all", async () => {
    const notifier = createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      logger: silentLogger,
    });
    await expect(
      notifier.sms.send({ to: "08031234567", text: "x" }),
    ).rejects.toMatchObject({
      code: "CHANNEL_NOT_CONFIGURED",
      channel: "sms",
    });
  });

  it("INVALID_RECIPIENT when the (post-normalisation) recipient list ends up empty", async () => {
    const notifier = smsNotifier([fakeSms("a", ok())]);
    await expect(
      notifier.sms.send({ to: [], text: "x" }),
    ).rejects.toMatchObject({
      code: "INVALID_RECIPIENT",
    });
  });

  it("warns (but still sends) when SMS text exceeds 6 segments", async () => {
    const warn = vi.fn();
    const notifier = smsNotifier([fakeSms("a", ok())], {
      logger: { ...silentLogger, warn },
    });
    const longText = "a".repeat(920);
    const res = await notifier.sms.send({ to: "08031234567", text: longText });
    expect(res.status).toBe("sent");
    expect(warn).toHaveBeenCalledWith(
      "[notifier] SMS text exceeds 6 segments; it may be costly or truncated",
      { length: 920 },
    );
  });
});

describe("withFirstPushProvider (push.subscribeToTopic / unsubscribeFromTopic)", () => {
  it("CHANNEL_NOT_CONFIGURED when push is not configured", async () => {
    const notifier = createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      logger: silentLogger,
    });
    await expect(
      notifier.push.subscribeToTopic(["t"], "topic"),
    ).rejects.toMatchObject({
      code: "CHANNEL_NOT_CONFIGURED",
      channel: "push",
    });
  });

  it("CONFIG_ERROR when the configured provider does not implement topic subscriptions", async () => {
    const provider = {
      name: "basic",
      async send() {
        return {};
      },
    }; // no subscribeToTopic/unsubscribeFromTopic
    const notifier = createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      push: { providers: [{ type: "custom", instance: provider }] },
      logger: silentLogger,
    });
    await expect(
      notifier.push.subscribeToTopic(["t"], "topic"),
    ).rejects.toMatchObject({
      code: "CONFIG_ERROR",
      channel: "push",
    });
    await expect(
      notifier.push.unsubscribeFromTopic(["t"], "topic"),
    ).rejects.toMatchObject({
      code: "CONFIG_ERROR",
    });
  });

  it("delegates to the first provider when it does implement topic subscriptions", async () => {
    const provider = {
      name: "fcm-like",
      async send() {
        return {};
      },
      async subscribeToTopic(tokens: string[]) {
        return { successCount: tokens.length, failedTokens: [] };
      },
      async unsubscribeFromTopic(tokens: string[]) {
        return { successCount: tokens.length, failedTokens: [] };
      },
    };
    const notifier = createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      push: { providers: [{ type: "custom", instance: provider }] },
      logger: silentLogger,
    });
    await expect(
      notifier.push.subscribeToTopic(["a", "b"], "topic"),
    ).resolves.toEqual({
      successCount: 2,
      failedTokens: [],
    });
  });
});

describe("sendTemplate: missing recipient contact details per channel", () => {
  const templates = [
    {
      id: "t",
      content: {
        email: { subject: "s", html: "<p>x</p>" },
        sms: { text: "x" },
        push: { title: "t", body: "b" },
      },
    },
  ];

  it("email: throws INVALID_RECIPIENT when recipient.email is missing", async () => {
    const notifier = createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      email: { from: { address: "a@b.com" }, providers: [{ type: "memory" }] },
      templates,
      logger: silentLogger,
    });
    await expect(
      notifier.sendTemplate("email", "t", {}, {}),
    ).rejects.toMatchObject({
      code: "INVALID_RECIPIENT",
      channel: "email",
    });
  });

  it("sms: throws INVALID_RECIPIENT when recipient.phone is missing", async () => {
    const notifier = smsNotifier([fakeSms("a", ok())], { templates });
    await expect(
      notifier.sendTemplate("sms", "t", {}, {}),
    ).rejects.toMatchObject({
      code: "INVALID_RECIPIENT",
      channel: "sms",
    });
  });

  it("push: throws INVALID_RECIPIENT when recipient.pushTokens is missing or empty", async () => {
    const notifier = createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      push: { providers: [{ type: "memory" }] },
      templates,
      logger: silentLogger,
    });
    await expect(
      notifier.sendTemplate("push", "t", {}, {}),
    ).rejects.toMatchObject({
      code: "INVALID_RECIPIENT",
      channel: "push",
    });
    await expect(
      notifier.sendTemplate("push", "t", { pushTokens: [] }, {}),
    ).rejects.toMatchObject({
      code: "INVALID_RECIPIENT",
    });
  });
});

describe("Notifier.close()", () => {
  it("is a no-op when no provider implements close()", async () => {
    const notifier = createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      email: { from: { address: "a@b.com" }, providers: [{ type: "memory" }] },
      logger: silentLogger,
    });
    await expect(notifier.close()).resolves.toBeUndefined();
  });

  it("calls close() on every provider that has one, across all three channels", async () => {
    const closeEmail = vi.fn();
    const closeSms = vi.fn();
    const notifier = createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      email: {
        from: { address: "a@b.com" },
        providers: [
          {
            type: "custom",
            instance: { name: "e", send: async () => ({}), close: closeEmail },
          },
        ],
      },
      sms: {
        providers: [
          {
            type: "custom",
            instance: { name: "s", send: async () => ({}), close: closeSms },
          },
        ],
      },
      logger: silentLogger,
    });
    await notifier.close();
    expect(closeEmail).toHaveBeenCalledTimes(1);
    expect(closeSms).toHaveBeenCalledTimes(1);
  });

  it("a provider whose close() throws is caught and logged, and does not stop other providers from closing", async () => {
    const error = vi.fn();
    const closeOk = vi.fn().mockResolvedValue(undefined);

    const notifier = createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      email: {
        from: { address: "a@b.com" },
        providers: [
          {
            type: "custom",
            instance: {
              name: "broken",
              send: async () => ({}),
              close: () => {
                throw new Error("cannot close");
              },
            },
          },
        ],
      },
      sms: {
        providers: [
          {
            type: "custom",
            instance: {
              name: "ok",
              send: async () => ({}),
              close: closeOk,
            },
          },
        ],
      },
      logger: { ...silentLogger, error },
    });

    await expect(notifier.close()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      "[notifier] error closing a provider",
      expect.any(Error),
    );

    expect(closeOk).toHaveBeenCalledTimes(1);
  });
});

describe("createTestNotifier.failNext covers all three channels", () => {
  it('failNext("push", ...) makes the next push send fail (the sms/email branches are covered by AC36 in features.test.ts)', async () => {
    const { createTestNotifier } = await import("../src/testing/index.js");
    const { NotificationError } = await import("../src/errors.js");
    const t = createTestNotifier();
    t.failNext(
      "push",
      new NotificationError({ code: "PROVIDER_ERROR", retryable: false }),
    );
    const res = await t.push.send({
      to: { tokens: ["t"] },
      title: "t",
      body: "b",
    });
    expect(res.status).toBe("failed");
    expect(t.outbox.push).toHaveLength(0);
  });
});

describe("a provider that throws a plain Error (not NotificationError) gets wrapped", () => {
  it("wraps it as a non-retryable PROVIDER_ERROR (so it is not pointlessly retried)", async () => {
    const provider = fakeSms("weird", async () => {
      throw new Error("totally unexpected bug");
    });
    const notifier = smsNotifier([provider]);
    const res = await notifier.sms.send({ to: "08031234567", text: "x" });
    expect(res.status).toBe("failed");
    expect(res.error).toBeInstanceOf(NotificationError);
    expect(res.error).toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: false,
    });
    expect(provider.calls).toBe(1); // not retried, since retryable: false
  });
});
