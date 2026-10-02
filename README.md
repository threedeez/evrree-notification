# @evrree/notification

Unified server-side notifications for Node.js applications.

`@evrree/notification` provides a consistent API for sending **email, SMS, and push notifications** without coupling your application to a specific provider.

It supports:

- Email via SMTP
- SMS via Termii or Twilio
- Push notifications via Firebase Cloud Messaging (FCM)
- Multiple providers per channel with automatic fallback
- Retries with exponential backoff and jitter
- Notification templates with Handlebars
- Multi-channel notifications
- Bulk sending with controlled concurrency
- Idempotency
- Dry-run mode
- Console and in-memory providers
- Custom providers
- NestJS integration
- Testing helpers
- Provider health checks

The package is designed for **server-side Node.js applications only**.

---

## Requirements

- Node.js 20+
- A server-side Node.js environment
- TypeScript is supported but not required

Supported application environments include:

- Plain Node.js
- NestJS
- Express
- Fastify
- Background workers
- BullMQ workers

---

## Installation

```bash
pnpm add @evrree/notification
```

or:

```bash
npm install @evrree/notification
```

or:

```bash
yarn add @evrree/notification
```

### Optional dependencies

Firebase Cloud Messaging requires:

```bash
pnpm add firebase-admin
```

NestJS integration requires:

```bash
pnpm add @nestjs/common reflect-metadata
```

The core package does **not** require NestJS or Firebase.

---

# Server-side only

`@evrree/notification` must only be used from backend/server-side code.

Do not import the package into:

- React applications
- Next.js client components
- Browser bundles
- React Native applications
- Other frontend code

Provider credentials such as SMTP passwords, Termii API keys, Twilio credentials, and Firebase service-account credentials must never be exposed to browsers.

The package does not read `process.env`.

Your application owns environment variables and passes the resulting configuration into the notifier.

For example:

```ts
const notifier = createNotifier({
  appName: "Evrree",
  email: {
    from: {
      name: "Evrree",
      address: config.emailFrom,
    },
    providers: [
      {
        type: "smtp",
        host: config.smtpHost,
        port: 587,
        secure: false,
        auth: {
          user: config.smtpUser,
          pass: config.smtpPassword,
        },
      },
    ],
  },
});
```

---

# Quick start

```ts
import { createNotifier } from "@evrree/notification";

const notifier = createNotifier({
  appName: "Evrree",
  email: {
    from: {
      name: "Evrree",
      address: "no-reply@evrree.com",
    },
    providers: [
      {
        type: "smtp",
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: {
          user: "smtp-user",
          pass: "smtp-password",
        },
      },
    ],
  },
});

const result = await notifier.email.send({
  to: "user@example.com",
  subject: "Welcome to Evrree",
  text: "Welcome to Evrree!",
});

console.log(result);
```

Example result:

```ts
{
  id: "8b4d...",
  channel: "email",
  status: "sent",
  provider: "smtp",
  providerMessageId: "<message-id>",
  attempts: 1,
  recipients: ["u***@example.com"],
  sentAt: new Date()
}
```

---

# Configuration

A notifier is created using `createNotifier()`.

```ts
import { createNotifier } from "@evrree/notification";

const notifier = createNotifier({
  appName: "Evrree CBT",
  defaultCountryCode: "NG",

  email: {
    from: {
      name: "Evrree",
      address: "no-reply@evrree.com",
    },
    replyTo: "support@evrree.com",

    providers: [
      {
        type: "smtp",
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: {
          user: "smtp-user",
          pass: "smtp-password",
        },
      },
    ],
  },

  sms: {
    senderId: "Evrree",

    providers: [
      {
        type: "termii",
        apiKey: "termii-api-key",
        channel: "dnd",
        baseUrl: "https://v4.api.termii.com/api",
      },
      {
        type: "twilio",
        accountSid: "account-sid",
        authToken: "auth-token",
        from: "+1234567890",
      },
    ],
  },

  push: {
    providers: [
      {
        type: "fcm",
        serviceAccount: {
          projectId: "project-id",
          clientEmail: "firebase-adminsdk@example.com",
          privateKey: "-----BEGIN PRIVATE KEY-----...",
        },
      },
    ],
  },

  retry: {
    attempts: 3,
    initialDelayMs: 500,
    maxDelayMs: 5000,
  },

  templates: [],

  hooks: {
    onSent: (result) => {
      console.log("Notification sent", result);
    },

    onFailed: (result) => {
      console.error("Notification failed", result);
    },
  },

  dryRun: false,

  logger: console,
});
```

Every channel is optional.

If a channel has not been configured, attempting to use it results in:

```ts
CHANNEL_NOT_CONFIGURED
```

---

# Environment variables

The package does not read environment variables itself.

This is intentional.

The consuming application should read environment variables and construct the configuration.

For example, in a NestJS application:

```ts
NotificationModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],

  useFactory: (config: ConfigService) => ({
    appName: "Evrree",

    sms: {
      providers: [
        {
          type: "termii",
          apiKey: config.getOrThrow<string>("TERMII_API_KEY"),
          channel: "dnd",
          baseUrl: "https://v4.api.termii.com/api",
        },
      ],
    },
  }),
});
```

This keeps deployment-specific configuration inside the application that owns the deployment.

---

# Email

Email providers use a common interface.

## SMTP

The built-in SMTP provider uses Nodemailer.

```ts
email: {
  from: {
    name: "Evrree",
    address: "no-reply@evrree.com",
  },

  providers: [
    {
      type: "smtp",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: {
        user: "username",
        pass: "password",
      },
    },
  ],
}
```

SMTP connections use a pooled transporter where supported.

The provider exposes the SMTP message ID as `providerMessageId`.

---

## Mailpit

Mailpit can be used during local development.

Example:

```ts
email: {
  from: {
    name: "Evrree",
    address: "no-reply@evrree.local",
  },

  providers: [
    {
      type: "smtp",
      host: "localhost",
      port: 1025,
      secure: false,
    },
  ],
}
```

This allows emails to be tested without sending real messages.

---

## Email content

An email requires:

- `subject`
- `html` or `text`

Example:

```ts
await notifier.email.send({
  to: "ada@example.com",
  subject: "Welcome",
  html: "<h1>Welcome to Evrree</h1>",
});
```

Text-only email:

```ts
await notifier.email.send({
  to: "ada@example.com",
  subject: "Welcome",
  text: "Welcome to Evrree",
});
```

If HTML is provided without a text version, the package can generate a plain-text representation.

---

## Multiple recipients

```ts
await notifier.email.send({
  to: [
    "ada@example.com",
    {
      name: "John Doe",
      address: "john@example.com",
    },
  ],

  cc: "manager@example.com",

  bcc: [
    "audit@example.com",
    "admin@example.com",
  ],

  subject: "Notification",
  text: "Hello everyone",
});
```

---

# SMS

SMS providers use a common interface.

Supported built-in providers:

- Termii
- Twilio

## Termii

```ts
sms: {
  senderId: "Evrree",

  providers: [
    {
      type: "termii",
      apiKey: "your-api-key",
      channel: "dnd",
      baseUrl: "https://v4.api.termii.com/api",
    },
  ],
}
```

The `baseUrl` is configurable because Termii accounts may use different API base URLs.

The provider appends:

```text
/sms/send
```

for normal messages and:

```text
/sms/send/bulk
```

for bulk messages.

For example:

```text
https://v4.api.termii.com/api/sms/send
```

The SDK sends the API key and message data to Termii and exposes the provider's `message_id` as `providerMessageId`.

---

## Twilio

```ts
sms: {
  providers: [
    {
      type: "twilio",
      accountSid: "ACxxxxxxxx",
      authToken: "your-auth-token",
      from: "+1234567890",
    },
  ],
}
```

Twilio messages are sent through its Messages API.

---

## Phone normalization

Phone numbers are normalized to E.164 format.

For example, with:

```ts
defaultCountryCode: "NG"
```

the following Nigerian number formats can be normalized:

```text
08012345678
08123456789
+2348012345678
2348012345678
```

Invalid numbers result in:

```ts
INVALID_RECIPIENT
```

Duplicate phone numbers are removed after normalization.

---

# Push notifications

Push notifications use Firebase Cloud Messaging.

```ts
push: {
  providers: [
    {
      type: "fcm",

      serviceAccount: {
        projectId: "your-project",
        clientEmail: "firebase-adminsdk@example.com",
        privateKey: "-----BEGIN PRIVATE KEY-----...",
      },
    },
  ],
}
```

The package loads `firebase-admin` lazily.

If FCM is configured without `firebase-admin` installed, the package throws:

```text
Install firebase-admin to use the fcm push provider
```

---

## Send to tokens

```ts
await notifier.push.send({
  to: {
    tokens: [
      "token-1",
      "token-2",
    ],
  },

  title: "Exam Reminder",

  body: "Your examination starts tomorrow.",

  data: {
    examId: "exam-123",
  },
});
```

FCM token sends are batched according to Firebase's limits.

Invalid registration tokens are returned through:

```ts
invalidTokens
```

---

## Topic notifications

```ts
await notifier.push.subscribeToTopic(
  ["token-1", "token-2"],
  "mathematics",
);
```

Unsubscribe:

```ts
await notifier.push.unsubscribeFromTopic(
  ["token-1", "token-2"],
  "mathematics",
);
```

Send to a topic:

```ts
await notifier.push.send({
  to: {
    topic: "mathematics",
  },

  title: "New Lesson",
  body: "A new mathematics lesson is available.",
});
```

Topic operations use the configured push provider that supports topic subscriptions.

---

# Console provider

Every channel supports a console provider.

```ts
email: {
  providers: [
    {
      type: "console",
    },
  ],
}
```

The console provider does not send a real notification.

It logs a redacted summary through the configured logger.

Sensitive information such as:

- email addresses
- phone numbers
- push tokens
- message bodies
- API credentials

should not be written to logs.

---

# Memory provider

The memory provider is useful for tests.

```ts
email: {
  providers: [
    {
      type: "memory",
    },
  ],
}
```

It stores notifications in memory instead of delivering them.

For application tests, prefer the dedicated testing helper described below.

---

# Custom providers

You can provide your own provider implementation.

```ts
email: {
  providers: [
    {
      type: "custom",
      instance: myEmailProvider,
    },
  ],
}
```

A custom provider receives a message and provider context.

```ts
interface EmailProvider {
  name: string;

  send(
    message: EmailMessage,
    context: ProviderContext,
  ): Promise<{
    providerMessageId?: string;
  }>;

  verify?(): Promise<void>;

  close?(): Promise<void>;
}
```

The same pattern applies to SMS and push providers.

---

# Example: custom Resend provider

The package does not need to depend directly on Resend.

A consuming application can implement Resend as a custom provider.

```ts
const resendProvider = {
  name: "resend",

  async send(message, ctx) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",

      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        from: message.from
          ? `${message.from.name ?? ""} <${message.from.address}>`
          : undefined,

        to: Array.isArray(message.to)
          ? message.to.map((recipient) =>
              typeof recipient === "string"
                ? recipient
                : recipient.address,
            )
          : [
              typeof message.to === "string"
                ? message.to
                : message.to.address,
            ],

        subject: message.subject,
        html: message.html,
        text: message.text,
      }),

      signal: ctx.signal,
    });

    if (!response.ok) {
      throw new Error(`Resend returned ${response.status}`);
    }

    const result = await response.json();

    return {
      providerMessageId: result.id,
    };
  },
};
```

Then:

```ts
const notifier = createNotifier({
  appName: "Evrree",

  email: {
    from: {
      name: "Evrree",
      address: "no-reply@evrree.com",
    },

    providers: [
      {
        type: "custom",
        instance: resendProvider,
      },
    ],
  },
});
```

This keeps provider-specific SDKs out of the core package.

---

# Templates

Templates allow notification content to be defined once and reused.

```ts
const notifier = createNotifier({
  appName: "Evrree",

  templates: [
    {
      id: "password-reset",

      content: {
        email: {
          subject: "Reset your {{appName}} password",

          html: `
            <h1>Password Reset</h1>
            <p>Hello {{recipient.name}},</p>
            <p>Use this code to reset your password:</p>
            <strong>{{code}}</strong>
          `,

          text: `
            Hello {{recipient.name}},

            Use this code to reset your password:

            {{code}}
          `,
        },

        sms: {
          text: "{{appName}} password reset code: {{code}}",
        },

        push: {
          title: "Password Reset",
          body: "Your password reset code is {{code}}.",
        },
      },
    },
  ],
});
```

Templates use Handlebars.

---

# Rendering templates

You can render a template without sending it.

```ts
const rendered = notifier.templates.render(
  "password-reset",
  "email",
  {
    code: "123456",
  },
);
```

Rendering does not contact a provider.

This can be useful for previews and tests.

---

# Sending a template

```ts
await notifier.sendTemplate(
  "email",
  "password-reset",
  {
    name: "Ada",
    email: "ada@example.com",
  },
  {
    code: "123456",
  },
);
```

SMS:

```ts
await notifier.sendTemplate(
  "sms",
  "password-reset",
  {
    name: "Ada",
    phone: "08012345678",
  },
  {
    code: "123456",
  },
);
```

Push:

```ts
await notifier.sendTemplate(
  "push",
  "password-reset",
  {
    name: "Ada",
    pushTokens: ["token"],
  },
  {
    code: "123456",
  },
);
```

---

# Template variables

The following variables are always available:

```text
appName
recipient
year
```

For example:

```handlebars
Hello {{recipient.name}},

Welcome to {{appName}}.

© {{year}}
```

Custom data is passed through the `data` argument:

```ts
{
  code: "123456",
  expiresIn: "10 minutes",
}
```

and can be used as:

```handlebars
Your verification code is {{code}}.
It expires in {{expiresIn}}.
```

---

# HTML escaping

Email HTML variables are escaped by default.

```handlebars
{{name}}
```

is escaped to prevent user-provided content from being interpreted as HTML.

When raw HTML is explicitly required:

```handlebars
{{{htmlContent}}}
```

SMS, push content, email subjects, and plain-text email content are not HTML-escaped.

---

# Strict template rendering

Templates are rendered in strict mode.

If a required variable is missing:

```handlebars
Hello {{username}}
```

and `username` was not supplied, the package throws:

```ts
TEMPLATE_RENDER_ERROR
```

The error identifies the missing variable.

---

# Locales

Templates can define multiple locales.

```ts
{
  id: "exam-reminder",

  locales: {
    en: {
      sms: {
        text: "Your exam starts tomorrow."
      }
    },

    ha: {
      sms: {
        text: "Jarabawarku zai fara gobe."
      }
    }
  },

  content: {
    sms: {
      text: "Your exam starts tomorrow."
    }
  }
}
```

The recipient locale determines which localized template is selected.

```ts
{
  name: "Abdul",
  phone: "08012345678",
  locale: "ha"
}
```

If the requested locale is unavailable, the template falls back to English where available.

---

# Email layouts

An optional email layout can wrap every rendered email.

Example:

```ts
email: {
  layout: `
    <html>
      <body>
        <header>{{appName}}</header>

        {{{body}}}

        <footer>
          © {{year}}
        </footer>
      </body>
    </html>
  `
}
```

The rendered notification body is inserted through:

```handlebars
{{{body}}}
```

---

# OTP example

OTP generation and verification are intentionally **not** handled by this package.

Your authentication service should generate and verify the OTP.

The notification package only delivers it.

Example template:

```ts
{
  id: "login-otp",

  content: {
    sms: {
      text: "{{appName}} verification code: {{code}}. Expires in {{expiresIn}}."
    },

    email: {
      subject: "Your verification code",
      html: `
        <p>Your verification code is:</p>
        <h2>{{code}}</h2>
        <p>This code expires in {{expiresIn}}.</p>
      `
    }
  }
}
```

Then:

```ts
await notifier.notify(
  {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
  },

  "login-otp",

  {
    code: otp,
    expiresIn: "10 minutes",
  },
);
```

---

# Password reset example

```ts
await notifier.sendTemplate(
  "email",

  "password-reset",

  {
    id: user.id,
    name: user.name,
    email: user.email,
  },

  {
    resetUrl: "https://example.com/reset/token",
  },
);
```

The authentication service remains responsible for:

- generating the reset token
- storing the token
- validating the token
- expiring the token
- changing the password

---

# Multi-channel notifications

Use `notify()` when a notification may be delivered through multiple channels.

```ts
await notifier.notify(
  {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    pushTokens: user.pushTokens,
  },

  "exam-reminder",

  {
    examName: "Mathematics",
    startsAt: "9:00 AM",
  },
);
```

By default, all eligible channels are attempted.

A channel is eligible when:

1. The recipient has contact information for that channel.
2. The template contains content for that channel.

---

# Restricting channels

```ts
await notifier.notify(
  recipient,
  "exam-reminder",
  data,
  {
    channels: ["sms", "push"],
  },
);
```

---

# First-success strategy

By default:

```ts
strategy: "all"
```

attempts all eligible channels.

To stop after the first successful delivery:

```ts
await notifier.notify(
  recipient,
  "exam-reminder",
  data,
  {
    strategy: "first-success",
  },
);
```

For example:

```text
Push → succeeds
SMS  → not attempted
Email → not attempted
```

If push fails:

```text
Push → fails
SMS  → attempted
```

---

# Bulk sending

Use `sendBulk()` when sending many independent notifications.

```ts
const results = await notifier.sendBulk(
  [
    {
      channel: "email",
      to: "one@example.com",
      subject: "Hello",
      text: "Hello One",
    },

    {
      channel: "email",
      to: "two@example.com",
      subject: "Hello",
      text: "Hello Two",
    },
  ],

  {
    concurrency: 10,
  },
);
```

The default concurrency is:

```text
10
```

The returned results preserve the same order as the input.

One failed item does not cause the entire bulk operation to reject.

---

# Retries

Provider delivery failures can be retried automatically.

Example:

```ts
retry: {
  attempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
}
```

The retry delay uses exponential backoff with jitter.

Conceptually:

```text
500ms
1000ms
2000ms
```

with jitter applied.

The maximum delay is capped by:

```ts
maxDelayMs
```

The SDK also respects `Retry-After` when supplied by an HTTP provider.

---

# Retryable failures

The following types of failures may be retried:

- Network errors
- Connection failures
- Timeouts
- HTTP 429
- HTTP 5xx
- Temporary SMTP 4xx responses

Permanent failures are not retried.

Examples:

- HTTP 400
- HTTP 401
- HTTP 403
- Permanent SMTP 5xx responses

---

# Provider fallback

Multiple providers can be configured for the same channel.

```ts
sms: {
  providers: [
    {
      type: "termii",
      apiKey: "termii-key",
      channel: "dnd",
      baseUrl: "https://v4.api.termii.com/api",
    },

    {
      type: "twilio",
      accountSid: "account-sid",
      authToken: "auth-token",
      from: "+1234567890",
    },
  ],
}
```

The package:

1. Tries Termii.
2. Retries retryable failures.
3. If Termii is exhausted, moves to Twilio.
4. Retries according to the configured retry policy.
5. Returns the final provider result.

For example:

```text
Termii
  ├── attempt 1 → 503
  ├── attempt 2 → 503
  └── attempt 3 → 503

Twilio
  └── attempt 1 → success
```

The final result identifies:

```ts
{
  provider: "twilio",
  status: "sent",
}
```

---

# Caller errors vs provider errors

This distinction is important.

## Caller errors throw

Errors caused by incorrect usage throw `NotificationError`.

Examples:

```text
INVALID_MESSAGE
INVALID_RECIPIENT
CHANNEL_NOT_CONFIGURED
CONFIG_ERROR
TEMPLATE_NOT_FOUND
TEMPLATE_RENDER_ERROR
```

For example:

```ts
try {
  await notifier.email.send({
    to: "not-an-email",
    subject: "Hello",
    text: "Hello",
  });
} catch (error) {
  // handle invalid input
}
```

These errors are not fixed by switching providers.

---

## Provider failures resolve

After retries and provider fallback are exhausted, provider delivery failures resolve with:

```ts
{
  status: "failed",
  error: NotificationError
}
```

Example:

```ts
const result = await notifier.sms.send({
  to: "08012345678",
  text: "Hello",
});

if (result.status === "failed") {
  console.error(result.error);
}
```

This allows applications to process delivery failures without wrapping every provider failure in a `try/catch`.

---

# SendResult

Successful delivery:

```ts
{
  id: string;
  channel: "email" | "sms" | "push";
  status: "sent";
  provider?: string;
  providerMessageId?: string;
  attempts: number;
  recipients: string[];
  sentAt?: Date;
}
```

Failed delivery:

```ts
{
  id: string;
  channel: "sms";
  status: "failed";
  provider?: string;
  attempts: number;
  recipients: string[];
  error?: NotificationError;
}
```

Dry run:

```ts
{
  id: string;
  channel: "email";
  status: "dry_run";
  attempts: 0;
  recipients: string[];
}
```

---

# Idempotency

Send operations support idempotency keys.

```ts
await notifier.email.send(
  {
    to: "user@example.com",
    subject: "Payment received",
    text: "Your payment was received.",
  },

  {
    idempotencyKey: "payment-123-confirmation",
  },
);
```

Repeated calls with the same idempotency key within the configured


## Demo / Local Testing

A `demo.mjs` file is included in the repository to manually test the notification package after building it.

### 1. Install dependencies

```bash
pnpm install
```

### 2. Build the package

```bash
pnpm build
```

This generates the package output inside `dist/`.

### 3. Run the demo

```bash
node demo.mjs
```

The demo imports the built package and allows you to test the notifier without publishing the package to npm.

Example:

```js
import { createNotifier } from "./dist/index.js";

const notifier = createNotifier({
  appName: "Evrree Demo",

  sms: {
    providers: [
      {
        type: "console",
      },
    ],
  },

  email: {
    from: {
      name: "Evrree",
      address: "no-reply@example.com",
    },

    providers: [
      {
        type: "console",
      },
    ],
  },

  push: {
    providers: [
      {
        type: "console",
      },
    ],
  },
});

const result = await notifier.sms.send({
  to: "08012345678",
  text: "Hello from Evrree Notification!",
});

console.log(result);
```

The console provider does not send a real notification. It prints a redacted notification summary so the package can be tested safely.

### Testing real providers

For real provider testing, replace the console provider with the provider you want to test.

For example, Termii:

```js
const notifier = createNotifier({
  appName: "Evrree Demo",

  sms: {
    providers: [
      {
        type: "termii",
        apiKey: "YOUR_TERMII_API_KEY",
        channel: "dnd",
        baseUrl: "https://v4.api.termii.com/api",
      },
    ],
  },
});
```

Then:

```js
const result = await notifier.sms.send({
  to: "08012345678",
  text: "Test notification from Evrree",
});

console.log(result);
```

> **Important:** Never commit real API keys, SMTP passwords, Firebase credentials, or other provider secrets to `demo.mjs` or the repository. Use environment variables in your local application when testing real providers.

### Testing different channels

The demo can also test each supported channel:

```js
await notifier.email.send({
  to: "user@example.com",
  subject: "Evrree Test",
  text: "This is a test email.",
});

await notifier.sms.send({
  to: "08012345678",
  text: "This is a test SMS.",
});

await notifier.push.send({
  to: {
    tokens: ["test-token"],
  },
  title: "Evrree Test",
  body: "This is a test push notification.",
});
```

### Testing templates

```js
const notifier = createNotifier({
  appName: "Evrree Demo",

  templates: [
    {
      id: "otp",
      content: {
        sms: {
          text: "{{appName}} verification code: {{code}}",
        },
      },
    },
  ],

  sms: {
    providers: [
      {
        type: "console",
      },
    ],
  },
});

const result = await notifier.sendTemplate(
  "sms",
  "otp",
  {
    phone: "08012345678",
  },
  {
    code: "123456",
  },
);

console.log(result);
```

### Testing provider fallback

Configure multiple providers for a channel:

```js
sms: {
  providers: [
    {
      type: "termii",
      apiKey: "YOUR_TERMII_API_KEY",
      channel: "dnd",
      baseUrl: "https://v4.api.termii.com/api",
    },

    {
      type: "twilio",
      accountSid: "YOUR_ACCOUNT_SID",
      authToken: "YOUR_AUTH_TOKEN",
      from: "+1234567890",
    },
  ],
}
```

The notifier will retry retryable failures from the first provider before moving to the next provider.

### Testing dry-run mode

```js
const notifier = createNotifier({
  appName: "Evrree Demo",

  dryRun: true,

  sms: {
    providers: [
      {
        type: "termii",
        apiKey: "test",
        channel: "dnd",
        baseUrl: "https://v4.api.termii.com/api",
      },
    ],
  },
});

const result = await notifier.sms.send({
  to: "08012345678",
  text: "This will not actually be sent.",
});

console.log(result.status);
// "dry_run"
```

Dry-run mode still validates and renders the notification but does not call the provider.

### Testing provider health

```js
const health = await notifier.verify();

console.log(health);
```

Example:

```js
{
  email: [
    {
      ok: true,
      provider: "smtp"
    }
  ],
  sms: [
    {
      ok: true,
      provider: "termii"
    }
  ],
  push: []
}
```

`verify()` does not throw when a provider health check fails. The result identifies which providers are healthy and which failed.

### Development workflow

When developing the package locally:

```bash
pnpm install
pnpm build
node demo.mjs
```

After changing source code:

```bash
pnpm build
node demo.mjs
```

This makes `demo.mjs` a simple manual integration test for the currently built package.