import { describe, expect, it, vi } from "vitest";

// Simulates firebase-admin genuinely not being installed: the dynamic
// import() itself rejects. This is its own file because the mock factory
// must throw for every test in it - the other FCM test files mock a working
// firebase-admin and would conflict with this one in the same file.
vi.mock("firebase-admin", () => {
  throw new Error("Cannot find module 'firebase-admin'");
});

describe("FcmPushProvider when firebase-admin is not installed (AC3)", () => {
  it("throws CONFIG_ERROR with an install hint, instead of a raw module-not-found error", async () => {
    const { FcmPushProvider } =
      await import("../src/channels/push/fcm.provider.js");
    const provider = new FcmPushProvider({
      serviceAccount: {
        projectId: "p",
        clientEmail: "e@p.iam.gserviceaccount.com",
        privateKey: "k",
      },
    });

    await expect(
      provider.send({
        to: { tokens: ["t"] },
        title: "t",
        body: "b",
      }),
    ).rejects.toMatchObject({
      code: "CONFIG_ERROR",
      message: "Install firebase-admin to use the fcm push provider",
    });
  });
});
