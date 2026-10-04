import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TermiiSmsProvider } from "../src/channels/sms/termii.provider.js";
import { TwilioSmsProvider } from "../src/channels/sms/twilio.provider.js";
import { silentLogger } from "./helpers.js";

// Direct provider-class tests (bypassing the Notifier) for the few branches
// only reachable by instantiating these providers with their own options,
// separately from the shared `sms.senderId` config the Notifier normally
// resolves before calling send().

const ctx = {
  signal: new AbortController().signal,
  logger: silentLogger,
  attempt: 1,
};
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ message_id: "x", sid: "x" }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("TermiiSmsProvider: senderId fallback to the provider's own options", () => {
  it("uses options.senderId when the message carries no senderId of its own (single recipient)", async () => {
    const p = new TermiiSmsProvider({
      apiKey: "",
      baseUrl: "https://termii.com/api",
      channel: "dnd",
      senderId: "ProviderLevel",
    });
    await p.send({ to: ["+2348031234567"], text: "hi" }, ctx);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.from).toBe("ProviderLevel");
  });

  it("uses options.senderId when the message carries no senderId of its own (bulk)", async () => {
    const p = new TermiiSmsProvider({
      apiKey: "",
      baseUrl: "https://termii.com/api",
      channel: "dnd",
      senderId: "ProviderLevel",
    });
    await p.send({ to: ["+2348031234567", "+2348059999999"], text: "hi" }, ctx);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.from).toBe("ProviderLevel");
  });

  it("a senderId on the message itself still wins over options.senderId", async () => {
    const p = new TermiiSmsProvider({
      apiKey: "",
      baseUrl: "https://termii.com/api",
      channel: "dnd",
      senderId: "ProviderLevel",
    });
    await p.send(
      { to: ["+2348031234567"], text: "hi", senderId: "MessageLevel" },
      ctx,
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.from).toBe("MessageLevel");
  });
});

describe("TwilioSmsProvider: network failure (not an HTTP error response)", () => {
  it("a rejected fetch() is mapped through errorFromFetchFailure as a retryable PROVIDER_ERROR", async () => {
    fetchMock.mockReset().mockRejectedValue(new TypeError("fetch failed"));
    const p = new TwilioSmsProvider({
      accountSid: "AC1",
      baseUrl: "https://api.twilio.com",
      authToken: "TOK",
      from: "+1",
    });
    await expect(
      p.send({ to: ["+2348031234567"], text: "hi" }, ctx),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: true,
    });
  });
});
