import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotifier } from "../src/index.js";
import { silentLogger } from "./helpers.js";

// AC34, end-to-end: a REAL provider error (Termii/Twilio), carrying what
// looks like a live API key, must never leak that key through the
// NotificationError it bubbles up as - not in .message, not in .cause.

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const REAL_LOOKING_KEY = "TLKey_abcdEFGH12345_liveSecret";

describe("AC34: secrets never leak through a real provider error", () => {
  it("Termii: a 401 body containing the api_key is fully scrubbed from the resulting error", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ message: "invalid api_key: " + REAL_LOOKING_KEY }),
        { status: 401 },
      ),
    );
    const notifier = createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      sms: {
        providers: [
          {
            type: "termii",
            baseUrl: "https://termii.com/api",
            apiKey: REAL_LOOKING_KEY,
            channel: "dnd",
          },
        ],
      },
      logger: silentLogger,
    });

    const res = await notifier.sms.send({ to: "08031234567", text: "hi" });
    const dump = JSON.stringify(res);
    expect(dump).not.toContain(REAL_LOOKING_KEY);
  });

  it("Twilio: an authToken embedded in a thrown cause is scrubbed, not just the top-level message", async () => {
    const authToken = "auth_token_live_999999";
    fetchMock.mockRejectedValue(
      new Error(
        `connection reset while using authorization: Bearer ${authToken}`,
      ),
    );

    const notifier = createNotifier({
      appName: "X",
      defaultCountryCode: "NG",
      sms: {
        providers: [
          {
            type: "twilio",
            baseUrl: "https://api.twilio.com",
            accountSid: "AC1",
            authToken,
            from: "+1",
          },
        ],
      },
      retry: { attempts: 1 },
      logger: silentLogger,
    });

    const res = await notifier.sms.send({ to: "08031234567", text: "hi" });
    const dump = JSON.stringify(res, (_k, v) =>
      v instanceof Error ? { message: v.message, stack: v.stack } : v,
    );
    expect(dump).not.toContain(authToken);
  });
});
