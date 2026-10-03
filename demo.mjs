// Live demo for @evrree/notification. Nothing is really sent: it uses the
// console and memory providers, so no credentials are needed.
//
// Usage (from the evrree-notification repo folder):
//   npm install
//   npm run build
//   node demo.mjs
import {
  createNotifier,
  NotificationError,
  createTestNotifier,
} from "@evrree/notification";
import console from "node:console";

const logger = {
  debug() {},
  info: (...a) => console.log("   [logger]", ...a),
  warn() {},
  error: console.error,
};

const notifier = createNotifier({
  appName: "Evrree CBT",
  defaultCountryCode: "NG",
  email: {
    from: { name: "", address: "" },
    providers: [
      {
        type: "smtp",
        host: "smtp.zeptomail.com",
        port: 587,
        auth: {
          user: "",
          pass: "",
        },
      },
    ],
  },
  sms: {
    senderId: "Threedeez",
    providers: [
      {
        type: "termii",
        baseUrl: "",
        apiKey: "",
        channel: "generic",
      },
    ],
  },
  push: { providers: [{ type: "console" }] },
  templates: [
    {
      id: "otp",
      content: {
        email: {
          subject: "Your {{appName}} code",
          html: "<p>Hi {{recipient.name}}, your code is <b>{{code}}</b></p>",
        },
        sms: { text: "{{appName}}: your code is {{code}}" },
      },
    },
  ],
  logger,
});

console.log("\n1) Send an SMS using a local Nigerian number");
let r = await notifier.sms.send({
  to: "09032877519",
  text: "Hello",
  senderId: "",
});
console.log(r.error);
console.log("   status:", r.status, "| error code:", r.error?.code);

let e = await notifier.email.send({
  to: "diltechng@gmail.com",
  subject: "Test Email",
  html: "<p>This is a test email.</p>",
});
console.log("   status:", e.status, "| error code:", e.error?.code);

console.log("\n2) Multi-channel notify with a template (email + sms)");
const n = await notifier.notify(
  {
    name: "Ada",
    email: "",
    phone: "",
  },
  "otp",
  { code: "4821" },
  {
    channels: ["email", "sms"],
    strategy: "all",
  },
);

console.log("   failed channels:", n.failed);
console.log("   succeeded channels:", n.succeeded);

console.log("\n3) Bad phone number -> throws (caller mistake)");
try {
  await notifier.sms.send({
    to: "019",
    text: "x",
    senderId: "Threedeez",
  });
} catch (e) {
  console.log("   threw:", e instanceof NotificationError, e.code);
}

console.log("\n4) Missing template variable -> throws");
try {
  await notifier.sendTemplate("sms", "otp", { phone: "" }, { code: "1234" });
} catch (e) {
  console.log("   threw:", e.code, "-", e.message);
}

console.log("\n5) Test notifier: messages land in the outbox");
const t = createTestNotifier({
  templates: [
    {
      id: "otp",
      content: { email: { subject: "Code {{code}}", html: "<p>{{code}}</p>" } },
    },
  ],
});
await t.sendTemplate(
  "email",
  "otp",
  { email: "ada@example.com" },
  { code: "999" },
);
console.log(
  "   outbox.email count:",
  t.outbox.email.length,
  "| subject:",
  t.outbox.email[0].subject,
);

console.log(
  "\n6) Simulated outage with failNext (resolves as failed, does not throw)",
);
t.failNext(
  "sms",
  new NotificationError({ code: "PROVIDER_ERROR", retryable: true }),
);
r = await t.sms.send({ to: "08031234567", text: "x" });
console.log("   status:", r.status, "| error code:", r.error?.code);
