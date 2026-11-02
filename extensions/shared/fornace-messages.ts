import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences, truncateToWidth, type Component } from "@earendil-works/pi-tui";

export type NotificationLevel = "info" | "warning" | "error";
export interface NotificationData { text: string; level: NotificationLevel; sourceEntryId?: string; surface?: "messages" }
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

/** Each package owns new entry IDs. Legacy records render without any sibling listener.
 * Re-copied notifications (sourceEntryId) and pre-surface update errors stay off the transcript. */
export function registerNotificationUI(pi: ExtensionAPI, entryType: string): void {
  const types = new Set([entryType, "pi-fornace:notification"]);
  for (const type of types) {
    pi.registerEntryRenderer<NotificationData>(type, (entry, renderOptions, theme) => {
      const data = notification(entry.data);
      if (data.surface === "messages" || data.sourceEntryId) return undefined;
      if (entry.type === "custom" && data.text.startsWith("Fornace native update ")) return undefined;
      if (entry.type === "custom" && data.text.startsWith("Error: Native update exited ")) return undefined;
      return renderMessage(data.text, theme, { level: data.level, expanded: renderOptions.expanded });
    });
  }
}
