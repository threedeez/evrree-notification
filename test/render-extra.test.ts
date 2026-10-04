import { describe, expect, it } from 'vitest';
import { createTestNotifier } from '../src/testing/index.js';
import { renderTemplate } from '../src/templates/render.js';

describe('a template missing content for a channel (render.ts TEMPLATE_NOT_FOUND branches)', () => {
  it('sms channel: throws when the template has no sms content', async () => {
    const t = createTestNotifier({
      templates: [{ id: 'email-only', content: { email: { subject: 's', html: '<p>x</p>' } } }],
    });
    await expect(t.sendTemplate('sms', 'email-only', { phone: '08031234567' }, {})).rejects.toMatchObject({
      code: 'TEMPLATE_NOT_FOUND',
      channel: 'sms',
    });
  });

  it('push channel: throws when the template has no push content', async () => {
    const t = createTestNotifier({
      templates: [{ id: 'email-only', content: { email: { subject: 's', html: '<p>x</p>' } } }],
    });
    await expect(t.sendTemplate('push', 'email-only', { pushTokens: ['t'] }, {})).rejects.toMatchObject({
      code: 'TEMPLATE_NOT_FOUND',
      channel: 'push',
    });
  });
});

describe('renderTemplate: remaining branches not reached via the Notifier', () => {
  it('a Handlebars runtime error that is NOT "missing variable" still gets wrapped as TEMPLATE_RENDER_ERROR', () => {
    // A reference to an unregistered partial throws "The partial ... could
    // not be found" at render time - a differently-worded error than the
    // "X" not defined case AC19 already covers, so this exercises
    // safeRender's generic fallback-message branch instead.
    const template = {
      id: 'broken',
      content: { email: { subject: 's', html: '{{> thisPartialDoesNotExist}}' } },
    };
    expect(() => renderTemplate(template, 'email', 'App', {}, {})).toThrow(
      expect.objectContaining({
        code: 'TEMPLATE_RENDER_ERROR',
        message: expect.stringContaining('Failed to render template "broken"'),
      }),
    );
  });

  it('renders content.email.text when the template provides a dedicated plain-text variant', () => {
    const template = {
      id: 'with-text',
      content: {
        email: { subject: 's', html: '<p>Hi {{recipient.name}}</p>', text: 'Hi {{recipient.name}}, plain' },
      },
    };
    const result = renderTemplate(template, 'email', 'App', { name: 'Ada' }, {}) as { text?: string };
    expect(result.text).toBe('Hi Ada, plain');
  });
});
