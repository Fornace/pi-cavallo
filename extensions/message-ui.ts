import { NotificationMessageComponent, NOTIFICATION_ENTRY, type ExtensionAPI, type ExtensionContext, type Theme, type NotificationLevel, type NotificationMessageOptions } from "@earendil-works/pi-coding-agent";

if (typeof NotificationMessageComponent !== "function" || NOTIFICATION_ENTRY !== "pi:notification") {
  throw new Error("Native Pi notification rendering is required. Upgrade the Pi host; /reload only changes extensions.");
}

export function notify(pi: ExtensionAPI, ctx: ExtensionContext, text: string, level: NotificationLevel = "info"): void {
  if (!ctx.hasUI) return;
  if (ctx.mode !== "tui") { ctx.ui.notify(text, level); return; }
  pi.appendEntry(NOTIFICATION_ENTRY, { text, level });
}

export function renderMessage(text: string, theme: Theme, options: NotificationMessageOptions = {}): NotificationMessageComponent {
  return new NotificationMessageComponent(text, options, () => theme);
}
