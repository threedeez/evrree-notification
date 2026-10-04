import {
  Inject,
  Module,
  type DynamicModule,
  type OnModuleDestroy,
  type OnModuleInit,
  type Provider,
} from "@nestjs/common";
import { createNotifier, Notifier } from "../notifier";
import type { NotifierConfig } from "../types.js";

export const NOTIFIER = Symbol("NOTIFIER");
const NOTIFIER_LIFECYCLE = Symbol("NOTIFIER_LIFECYCLE");

export const InjectNotifier = () => Inject(NOTIFIER);

export interface NotificationModuleOptions extends NotifierConfig {
  verifyOnStartup?: boolean;
}

export interface NotificationModuleAsyncOptions {
  imports?: unknown[];
  inject?: unknown[];
  isGlobal?: boolean;
  useFactory: (
    ...args: unknown[]
  ) => NotificationModuleOptions | Promise<NotificationModuleOptions>;
}

class ManagedNotifier implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly notifier: Notifier,
    private readonly verifyOnStartup: boolean,
  ) {}

  async onModuleInit() {
    if (!this.verifyOnStartup) return;
    try {
      const report = await this.notifier.verify();
      console.info("[NotificationModule] verify() on startup:", report);
    } catch (err) {
      console.error("[NotificationModule] verify() on startup failed", err);
    }
  }

  async onModuleDestroy() {
    await this.notifier.close();
  }
}

@Module({})
export class NotificationModule {
  static forRoot(options: NotificationModuleOptions): DynamicModule {
    return {
      module: NotificationModule,
      global: true,
      providers: [
        { provide: NOTIFIER, useFactory: () => createNotifier(options) },
        this.lifecycleProvider(options.verifyOnStartup ?? false),
      ],
      exports: [NOTIFIER],
    };
  }

  static forRootAsync(options: NotificationModuleAsyncOptions): DynamicModule {
    let verifyOnStartup = false;

    return {
      module: NotificationModule,
      global: options.isGlobal ?? true,
      imports: (options.imports ?? []) as never[],
      providers: [
        {
          provide: NOTIFIER,
          useFactory: async (...args: unknown[]) => {
            const resolved = await options.useFactory(...args);
            verifyOnStartup = resolved.verifyOnStartup ?? false;
            return createNotifier(resolved);
          },
          inject: (options.inject ?? []) as never[],
        },
        {
          provide: NOTIFIER_LIFECYCLE,
          useFactory: (notifier: Notifier) =>
            new ManagedNotifier(notifier, verifyOnStartup),
          inject: [NOTIFIER],
        },
      ],
      exports: [NOTIFIER],
    };
  }

  private static lifecycleProvider(verifyOnStartup: boolean): Provider {
    return {
      provide: NOTIFIER_LIFECYCLE,
      useFactory: (notifier: Notifier) =>
        new ManagedNotifier(notifier, verifyOnStartup),
      inject: [NOTIFIER],
    };
  }
}
