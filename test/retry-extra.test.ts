import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/retry";

describe("withRetry edge cases", () => {
  it("throws ABORTED immediately if the signal is already aborted before the first attempt", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn();
    await expect(
      withRetry(
        fn,
        { attempts: 3, initialDelayMs: 1, maxDelayMs: 1 },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("works with neither signal nor timeoutMs supplied (uses a fresh internal AbortController)", async () => {
    const { result, attempts } = await withRetry(async () => "ok", {
      attempts: 1,
      initialDelayMs: 1,
      maxDelayMs: 1,
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(1);
  });

  it("combines an external signal with a per-call timeoutMs without throwing", async () => {
    const controller = new AbortController();
    const { result } = await withRetry(
      async (_attempt, signal) => {
        expect(signal.aborted).toBe(false);
        return "ok";
      },
      { attempts: 1, initialDelayMs: 1, maxDelayMs: 1 },
      { signal: controller.signal, timeoutMs: 1000 },
    );
    expect(result).toBe("ok");
  });

  it("with attempts: 0, the loop never runs and the last (undefined) error is thrown", async () => {
    const fn = vi.fn();
    // Not a realistic config (createNotifier never allows attempts: 0 to be
    // reached in practice), but this is the documented "unreachable, but
    // keeps TS happy" fallback line - worth proving it doesn't hang.
    await expect(
      withRetry(fn, { attempts: 0, initialDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });
});
