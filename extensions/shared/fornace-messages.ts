import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences, truncateToWidth, type Component } from "@earendil-works/pi-tui";

export type NotificationLevel = "info" | "warning" | "error";
export interface NotificationData { text: string; level: NotificationLevel; sourceEntryId?: string }
export interface MessageOptions { level?: NotificationLevel; detail?: string; expanded?: boolean }
const labels = { info: "Info", warning: "Warning", error: "Error" } as const;
const colors = { info: "accent", warning: "warning", error: "error" } as const;

function plainText(text: string): string {
  return stripTerminalSequences(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, " ");
}
function notification(value: unknown): NotificationData {
  const data = value as Partial<NotificationData> | undefined;
  if (!data || typeof data.text !== "string" || !["info", "warning", "error"].includes(data.level ?? "") ||
      (data.sourceEntryId !== undefined && typeof data.sourceEntryId !== "string")) {
    throw new Error("Invalid Fornace notification entry");
  }
  return data as NotificationData;
}

/** Pure content. Pi owns spacing, expansion, terminal state and redraws. */
export class FornaceMessage implements Component {
  private readonly message: string;
  private readonly theme: Theme;
  private readonly level: NotificationLevel;
  private readonly detail?: string;
  private readonly expanded: boolean;
  constructor(message: string, theme: Theme, level: NotificationLevel = "info", detail?: string, expanded = false) {
    this.message = message;
    this.theme = theme;
    this.level = level;
    this.detail = detail;
    this.expanded = expanded;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const heading = this.theme.bold(this.theme.fg(colors[this.level], labels[this.level]));
    const detail = this.expanded && this.detail ? `\n${this.theme.fg("muted", plainText(this.detail))}` : "";
    return new Text(`${heading} · ${this.theme.fg("text", plainText(this.message))}${detail}`, 0, 0)
      .render(width).map(line => truncateToWidth(line, width, ""));
  }
  invalidate(): void {}
}

export function renderMessage(text: string, theme: Theme, options: MessageOptions = {}): FornaceMessage {
  return new FornaceMessage(text, theme, options.level, options.detail, options.expanded);
}

/** Each package owns new entry IDs. Legacy records render without any sibling listener. */
export function registerNotificationUI(pi: ExtensionAPI, entryType: string): void {
  const types = new Set([entryType, "pi-fornace:notification"]);
  for (const type of types) {
    pi.registerEntryRenderer<NotificationData>(type, (entry, options, theme) => {
      const data = notification(entry.data);
      return renderMessage(data.text, theme, { level: data.level, expanded: options.expanded });
    });
  }
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    const visible = new Set(ctx.sessionManager.buildContextEntries().flatMap(entry =>
      entry.type === "custom" && types.has(entry.customType)
        ? [`${entry.customType}:${notification(entry.data).sourceEntryId ?? entry.id}`] : []));
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || !types.has(entry.customType)) continue;
      const data = notification(entry.data);
      const sourceEntryId = data.sourceEntryId ?? entry.id;
      const key = `${entry.customType}:${sourceEntryId}`;
      if (data.level === "info" || visible.has(key)) continue;
      pi.appendEntry(entry.customType, { ...data, sourceEntryId });
      visible.add(key);
    }
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("session_compact", restore);
}
