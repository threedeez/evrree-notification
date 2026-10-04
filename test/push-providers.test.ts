import { afterEach, describe, expect, it, vi } from "vitest";
import { createNotifier } from "../src/index.js";
import { silentLogger } from "./helpers.js";

// Mock firebase-admin before importing anything that lazy-imports it.
const sendEachForMulticast = vi.fn();
const send = vi.fn();
const subscribeToTopic = vi.fn();
const unsubscribeFromTopic = vi.fn();
const deleteApp = vi.fn();
const initializeApp = vi.fn(() => ({
  messaging: () => ({
    sendEachForMulticast,
    send,
    subscribeToTopic,
    unsubscribeFromTopic,
  }),
  delete: deleteApp,
}));

vi.mock("firebase-admin", () => ({
  default: {
    initializeApp,
    credential: { cert: (x: unknown) => x },
  },
  initializeApp,
  credential: { cert: (x: unknown) => x },
}));

afterEach(() => vi.clearAllMocks());

const serviceAccount = {
  projectId: "p",
  clientEmail: "e@p.iam.gserviceaccount.com",
  privateKey: "KEY",
};

function make(retry: { attempts?: number } = {}) {
  return createNotifier({
    appName: "X",
    defaultCountryCode: "NG",
    push: { providers: [{ type: "fcm", serviceAccount }] },
    retry: { attempts: retry.attempts ?? 3 },
    logger: silentLogger,
  });
}

function multicastResult(n: number, failIndexes: Record<number, string> = {}) {
  return {
    successCount: n - Object.keys(failIndexes).length,
    failureCount: Object.keys(failIndexes).length,
    responses: Array.from({ length: n }, (_, i) =>
      failIndexes[i]
        ? { success: false, error: { code: failIndexes[i] } }
        : { success: true, messageId: `msg-${i}` },
    ),
  };
}

describe("FCM provider (AC14, AC15, AC16)", () => {
  it("AC14: 1,200 tokens -> 3 calls of 500/500/200", async () => {
    sendEachForMulticast
      .mockResolvedValueOnce(multicastResult(500))
      .mockResolvedValueOnce(multicastResult(500))
      .mockResolvedValueOnce(multicastResult(200));

    const tokens = Array.from({ length: 1200 }, (_, i) => `tok-${i}`);
    const res = await make().push.send({
      to: { tokens },
      title: "t",
      body: "b",
    });

    expect(sendEachForMulticast).toHaveBeenCalledTimes(3);
    expect(sendEachForMulticast.mock.calls[0]![0].tokens).toHaveLength(500);
    expect(sendEachForMulticast.mock.calls[1]![0].tokens).toHaveLength(500);
    expect(sendEachForMulticast.mock.calls[2]![0].tokens).toHaveLength(200);
    expect(res.status).toBe("sent");
  });

  it("AC15: dead tokens are collected; partial success still counts as sent", async () => {
    sendEachForMulticast.mockResolvedValueOnce(
      multicastResult(3, { 1: "messaging/registration-token-not-registered" }),
    );
    const tokens = ["a", "b", "c"];
    const res = await make().push.send({
      to: { tokens },
      title: "t",
      body: "b",
    });

    expect(res.status).toBe("sent");
    expect(res.invalidTokens).toEqual(["b"]);
  });

  it("all tokens dead resolves as failed (0 successes), with a single attempt (no pointless retry)", async () => {
    sendEachForMulticast.mockResolvedValue(
      multicastResult(2, {
        0: "messaging/invalid-registration-token",
        1: "messaging/registration-token-not-registered",
      }),
    );
    const res = await make({ attempts: 1 }).push.send({
      to: { tokens: ["a", "b"] },
      title: "t",
      body: "b",
    });
    expect(res.status).toBe("failed"); // 0 successes -> genuinely nothing delivered
    expect(res.error?.code).toBe("PROVIDER_ERROR");
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  it("topic send calls messaging().send() with the topic", async () => {
    send.mockResolvedValueOnce("projects/p/messages/1");
    const res = await make().push.send({
      to: { topic: "exam-reminders" },
      title: "t",
      body: "b",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "exam-reminders" }),
    );
    expect(res.status).toBe("sent");
    expect(res.providerMessageId).toBe("projects/p/messages/1");
  });

  it("AC16: subscribeToTopic / unsubscribeFromTopic report failed tokens by index", async () => {
    subscribeToTopic.mockResolvedValueOnce({
      successCount: 2,
      failureCount: 1,
      errors: [{ index: 1, error: {} }],
    });
    const notifier = make();
    const res = await notifier.push.subscribeToTopic(
      ["a", "b", "c"],
      "exam-reminders",
    );
    expect(subscribeToTopic).toHaveBeenCalledWith(
      ["a", "b", "c"],
      "exam-reminders",
    );
    expect(res).toEqual({ successCount: 2, failedTokens: ["b"] });

    unsubscribeFromTopic.mockResolvedValueOnce({
      successCount: 3,
      failureCount: 0,
      errors: [],
    });
    const res2 = await notifier.push.unsubscribeFromTopic(
      ["a", "b", "c"],
      "exam-reminders",
    );
    expect(res2).toEqual({ successCount: 3, failedTokens: [] });
  });

  it("uses a named app, not the default Firebase app", async () => {
    sendEachForMulticast.mockResolvedValueOnce(multicastResult(1));
    await make().push.send({ to: { tokens: ["a"] }, title: "t", body: "b" });
    const name = (
      initializeApp.mock.calls[0] as unknown as [unknown, string?] | undefined
    )?.[1];
    expect(name).toMatch(/^evrree-notification-/);
  });

  it("the app is only initialised once across multiple sends", async () => {
    sendEachForMulticast.mockResolvedValue(multicastResult(1));
    const notifier = make();
    await notifier.push.send({ to: { tokens: ["a"] }, title: "t", body: "b" });
    await notifier.push.send({ to: { tokens: ["a"] }, title: "t", body: "b" });
    expect(initializeApp).toHaveBeenCalledTimes(1);
  });
});
