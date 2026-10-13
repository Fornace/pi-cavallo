import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

type Level = "info" | "warning" | "error";
interface Notification { text: string; level: Level }
const ENTRY = "pi-fornace:notification";

export function registerMessageUI(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<Notification>(ENTRY, (entry, options, theme) => {
    const data = entry.data;
    if (!data || typeof data.text !== "string" || !["info", "warning", "error"].includes(data.level)) {
      throw new Error("Invalid Fornace notification entry");
    }
    return renderMessage(pi, data.text, theme, { level: data.level, expanded: options.expanded });
  });
}

export function notify(pi: ExtensionAPI, ctx: ExtensionContext, text: string, level: Level = "info"): void {
  if (!ctx.hasUI) return;
  if (ctx.mode !== "tui") { ctx.ui.notify(text, level); return; }
  pi.appendEntry(ENTRY, { text, level });
}

export function renderMessage(pi: ExtensionAPI, text: string, theme: Theme,
  options: { level?: Level; detail?: string; expanded?: boolean } = {}): Component {
  const request: { operation: "render"; handled: boolean; text: string; theme: Theme;
    level?: Level; detail?: string; expanded?: boolean; component?: Component; error?: unknown }
    = { operation: "render", handled: false, text, theme, ...options };
  // Pi's EventBus logs thrown handler errors; the bridge returns them explicitly.
  pi.events.emit("fornace.message.bridge.v1", request);
  if ("error" in request) throw request.error;
  if (!request.handled) throw new Error("Fornace message bridge did not handle rendering; load pi-fornace for TUI notices.");
  if (!request.component) throw new Error("Fornace message bridge returned no component.");
  return request.component;
}
