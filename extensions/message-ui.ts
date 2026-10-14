import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerNotificationUI, type NotificationLevel } from "./shared/fornace-messages.ts";
export { renderMessage } from "./shared/fornace-messages.ts";

const ENTRY = "pi-cavallo:notification";
export function registerMessageUI(pi: ExtensionAPI): void { registerNotificationUI(pi, ENTRY); }

export function notify(pi: ExtensionAPI, ctx: ExtensionContext, text: string, level: NotificationLevel = "info"): void {
  if (!ctx.hasUI) return;
  if (ctx.mode !== "tui") { ctx.ui.notify(text, level); return; }
  pi.appendEntry(ENTRY, { text, level });
}
