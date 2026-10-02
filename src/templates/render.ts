import Handlebars from "handlebars";
import { NotificationError } from "../errors";
import type {
  Channel,
  NotificationTemplate,
  Recipient,
  TemplateContent,
} from "../types";
import { Channels, NotificationErrorCode } from "../common";

// Compiled templates are cached per raw string across the process — cheap
// win since the same template gets rendered on every send.
const compileCache = new Map<string, HandlebarsTemplateDelegate>();

function compile(source: string): HandlebarsTemplateDelegate {
  let compiled = compileCache.get(source);
  if (!compiled) {
    compiled = Handlebars.compile(source, { strict: true, noEscape: false });
    compileCache.set(source, compiled);
  }
  return compiled;
}

// Same as `compile`, but with HTML escaping off — for SMS/push/subject/text,
// per the ticket: "Don't HTML-escape SMS/push/subject/text".
function compileUnescaped(source: string): HandlebarsTemplateDelegate {
  const cacheKey = `noescape:${source}`;
  let compiled = compileCache.get(cacheKey);
  if (!compiled) {
    compiled = Handlebars.compile(source, { strict: true, noEscape: true });
    compileCache.set(cacheKey, compiled);
  }
  return compiled;
}

export interface RenderContext {
  appName: string;
  recipient: Recipient;
  year: number;
  [key: string]: unknown;
}

function buildContext(
  appName: string,
  recipient: Recipient,
  data: Record<string, unknown>,
): RenderContext {
  return { appName, recipient, year: new Date().getFullYear(), ...data };
}

function safeRender(
  compiled: HandlebarsTemplateDelegate,
  context: RenderContext,
  templateId: string,
): string {
  try {
    return compiled(context);
  } catch (cause) {
    const missingVar = extractMissingVariable(cause);
    throw new NotificationError({
      code: NotificationErrorCode.TEMPLATE_RENDER_ERROR,
      message: missingVar
        ? `Template "${templateId}" is missing variable "${missingVar}"`
        : `Failed to render template "${templateId}": ${(cause as Error).message}`,
      cause,
    });
  }
}

function extractMissingVariable(cause: unknown): string | undefined {
  const message = cause instanceof Error ? cause.message : "";
  const match = /"([^"]+)" not defined/.exec(message);
  return match?.[1];
}

function resolveContent(
  template: NotificationTemplate,
  recipient: Recipient,
): TemplateContent {
  const locale = recipient.locale;
  if (locale && template.locales?.[locale]) {
    return template.locales[locale];
  }
  return template.content;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text?: string;
}
export interface RenderedSms {
  text: string;
}
export interface RenderedPush {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export function renderTemplate(
  template: NotificationTemplate,
  channel: Channel,
  appName: string,
  recipient: Recipient,
  data: Record<string, unknown>,
  emailLayout?: string,
): RenderedEmail | RenderedSms | RenderedPush {
  const content = resolveContent(template, recipient);
  const context = buildContext(appName, recipient, data);

  if (channel === "email") {
    if (!content.email) {
      throw new NotificationError({
        code: NotificationErrorCode.TEMPLATE_NOT_FOUND,
        channel: Channels.EMAIL,
        message: `Template "${template.id}" has no email content`,
      });
    }
    const subject = safeRender(
      compileUnescaped(content.email.subject),
      context,
      template.id,
    );
    let html = safeRender(compile(content.email.html), context, template.id);
    if (emailLayout) {
      html = safeRender(
        compileUnescaped(emailLayout),
        { ...context, body: html } as RenderContext,
        template.id,
      );
    }
    const text = content.email.text
      ? safeRender(compileUnescaped(content.email.text), context, template.id)
      : undefined;
    return { subject, html, text };
  }

  if (channel === "sms") {
    if (!content.sms) {
      throw new NotificationError({
        code: NotificationErrorCode.TEMPLATE_NOT_FOUND,
        channel: Channels.SMS,
        message: `Template "${template.id}" has no sms content`,
      });
    }
    return {
      text: safeRender(
        compileUnescaped(content.sms.text),
        context,
        template.id,
      ),
    };
  }

  if (!content.push) {
    throw new NotificationError({
      code: NotificationErrorCode.TEMPLATE_NOT_FOUND,
      channel: Channels.PUSH,
      message: `Template "${template.id}" has no push content`,
    });
  }
  return {
    title: safeRender(
      compileUnescaped(content.push.title),
      context,
      template.id,
    ),
    body: safeRender(compileUnescaped(content.push.body), context, template.id),
    data: content.push.data,
  };
}

/** Whether the template has content for a given channel, for notify()'s "skip if no content" rule. */
export function hasChannelContent(
  template: NotificationTemplate,
  channel: Channel,
  recipient: Recipient,
): boolean {
  return resolveContent(template, recipient)[channel] != null;
}
