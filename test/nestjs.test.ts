import "reflect-metadata";
import { Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InjectNotifier,
  NOTIFIER,
  NotificationModule,
} from "../src/nestjs/index";
import { Notifier } from "../src/notifier";

// A consumer service, exactly as another Evrree service would write one:
// pull the notifier in with @InjectNotifier() and use it normally.
@Injectable()
class GreetingService {
  constructor(@InjectNotifier() private readonly notifier: Notifier) {}

  async sendWelcome() {
    return this.notifier.email.send({
      to: "a@b.com",
      subject: "Welcome",
      text: "Hi",
    });
  }
}

// We use moduleRef.init()/.close() rather than createNestApplication(), since
// the latter needs an HTTP adapter (@nestjs/platform-express) installed, and
// these tests only need DI resolution + lifecycle hooks, not an HTTP server.

// Same reasoning as ConfigService/ConfigModule below: kept at module scope,
// not nested inside an it() callback, so the decorator is never applied to a
// locally-scoped class declaration.
@Module({ providers: [GreetingService], exports: [GreetingService] })
class FeatureModule {}

afterEach(() => vi.restoreAllMocks());

describe("NotificationModule.forRoot (AC35)", () => {
  it("provides a real, usable Notifier via @InjectNotifier()", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          appName: "Evrree CBT",
          defaultCountryCode: "NG",
          email: {
            from: { address: "no-reply@evrree.com" },
            providers: [{ type: "memory" }],
          },
        }),
      ],
      providers: [GreetingService],
    }).compile();

    await moduleRef.init();

    const service = moduleRef.get(GreetingService);
    const notifier = moduleRef.get<Notifier>(NOTIFIER);
    expect(notifier).toBeInstanceOf(Notifier);

    const result = await service.sendWelcome();
    expect(result.status).toBe("sent");

    await moduleRef.close();
  });

  it("is global by default: a totally separate feature module can still @InjectNotifier()", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          appName: "X",
          defaultCountryCode: "NG",
          email: {
            from: { address: "a@b.com" },
            providers: [{ type: "memory" }],
          },
        }),
        FeatureModule,
      ],
    }).compile();

    await moduleRef.init();
    const service = moduleRef.get(GreetingService);
    expect((await service.sendWelcome()).status).toBe("sent");
    await moduleRef.close();
  });

  it("calls notifier.close() on module destroy (the lifecycle bug fix)", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          appName: "X",
          defaultCountryCode: "NG",
          email: {
            from: { address: "a@b.com" },
            providers: [{ type: "memory" }],
          },
        }),
      ],
    }).compile();

    await moduleRef.init();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);
    const closeSpy = vi.spyOn(notifier, "close");

    await moduleRef.close();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("verifyOnStartup runs verify() during onModuleInit and logs an unhealthy provider, without crashing the app", async () => {
    // notifier.verify() already catches each provider's own failure and
    // returns it in the report (never throws) - so onModuleInit's own
    // try/catch only exists to guard against verify() itself misbehaving.
    // What we can actually observe here is the report being logged.
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          appName: "X",
          defaultCountryCode: "NG",
          verifyOnStartup: true,
          sms: {
            providers: [
              {
                type: "custom",
                instance: {
                  name: "bad",
                  send: async () => ({}),
                  verify: async () => {
                    throw new Error("down");
                  },
                  close: () => {
                    throw new Error("cannot close");
                  },
                },
              },
            ],
          },
        }),
      ],
    }).compile();

    await expect(moduleRef.init()).resolves.not.toThrow();
    expect(infoLog).toHaveBeenCalledWith(
      "[NotificationModule] verify() on startup:",
      expect.objectContaining({
        sms: [expect.objectContaining({ ok: false, provider: "bad" })],
      }),
    );
    await moduleRef.close();
  });

  it("a verify() that itself throws is caught and logged during the real onModuleInit, never crashes the app", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    // Mocked on the prototype *before* the module is built, so the real
    // ManagedNotifier.onModuleInit -> this.notifier.verify() call (Nest's
    // actual lifecycle, not a re-implementation) is what throws here.
    vi.spyOn(Notifier.prototype, "verify").mockRejectedValueOnce(
      new Error("unexpected bug"),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          appName: "X",
          defaultCountryCode: "NG",
          verifyOnStartup: true,
          email: {
            from: { address: "a@b.com" },
            providers: [{ type: "memory" }],
          },
        }),
      ],
    }).compile();

    await expect(moduleRef.init()).resolves.not.toThrow();
    expect(errorLog).toHaveBeenCalledWith(
      "[NotificationModule] verify() on startup failed",
      expect.any(Error),
    );

    await moduleRef.close();
  });
});

// Declared at module scope, not inside describe() - decorators on a class
// nested inside a function body are handled inconsistently across
// TypeScript/esbuild decorator modes (some setups throw
// "TS1206: Decorators are not valid here" for that pattern). Keeping every
// @Injectable()/@Module() class at the top level, same as GreetingService
// above, avoids the ambiguity entirely regardless of which decorator mode a
// given environment resolves to.
@Injectable()
class ConfigService {
  appName = "Async App";
}

// ConfigService must come from a module NotificationModule can see via its
// own `imports` option - a global module's providers are visible to OTHER
// modules, but its own internal factories can only inject from what it
// explicitly imports. This mirrors how a real app would wire shared config.
@Module({ providers: [ConfigService], exports: [ConfigService] })
class ConfigModule {}

describe("NotificationModule.forRootAsync (AC35)", () => {
  it("resolves config via useFactory + inject, and still cleans up on destroy", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: unknown) => ({
            ...(config as ConfigService),
            appName: (config as ConfigService).appName,
            defaultCountryCode: "NG",
            email: {
              from: { address: "a@b.com" },
              providers: [{ type: "memory" as const }],
            },
          }),
        }),
      ],
    }).compile();

    await moduleRef.init();

    const notifier = moduleRef.get<Notifier>(NOTIFIER);
    const result = await notifier.email.send({
      to: "x@y.com",
      subject: "s",
      text: "t",
    });
    expect(result.status).toBe("sent");

    const closeSpy = vi.spyOn(notifier, "close");
    await moduleRef.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("isGlobal defaults to true and can be overridden to false", () => {
    const asyncModuleFalse = NotificationModule.forRootAsync({
      isGlobal: false,
      useFactory: () => ({ appName: "X", defaultCountryCode: "NG" }),
    });
    expect(asyncModuleFalse.global).toBe(false);

    const asyncModuleDefault = NotificationModule.forRootAsync({
      useFactory: () => ({ appName: "X", defaultCountryCode: "NG" }),
    });
    expect(asyncModuleDefault.global).toBe(true);
  });
});
