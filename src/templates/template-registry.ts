import { NotificationErrorCode } from "../common";
import { NotificationError } from "../errors";
import type { NotificationTemplate } from "../types";

export class TemplateRegistry {
  private readonly templates = new Map<string, NotificationTemplate>();

  constructor(initial: NotificationTemplate[] = []) {
    for (const template of initial) {
      this.register(template);
    }
  }

  register(
    template: NotificationTemplate,
    opts: { override?: boolean } = {},
  ): void {
    if (this.templates.has(template.id) && !opts.override) {
      throw new NotificationError({
        code: NotificationErrorCode.CONFIG_ERROR,
        message: `Template "${template.id}" is already registered. Pass { override: true } to replace it.`,
      });
    }
    this.templates.set(template.id, template);
  }

  get(id: string): NotificationTemplate {
    const template = this.templates.get(id);
    if (!template) {
      throw new NotificationError({
        code: NotificationErrorCode.TEMPLATE_NOT_FOUND,
        message: `No template registered with id "${id}"`,
      });
    }
    return template;
  }

  list(): NotificationTemplate[] {
    return [...this.templates.values()];
  }
}
