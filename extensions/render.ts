import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text, Box, Spacer } from "@earendil-works/pi-tui";

export function registerCavalloRenderer(pi: ExtensionAPI): void {
 pi.registerMessageRenderer("cavallo_result", (message, _options, theme) => {
  const details = message.details as Record<string, any> | undefined;
  const first = message.content?.[0];
  const container = new Container();
  container.addChild(new Text(theme.fg(details?.status === "Failed" ? "error" : "success", typeof first === "object" && first.type === "text" ? first.text : "Video"), 0, 0));
  if (!details) return container;
  // Core owns lazy media rows from message.content. Never decode details/thumbData.
  if (details.outputPath) container.addChild(new Text(theme.fg("muted", String(details.outputPath)), 0, 0));
  const box = new Box(1, 1, s => theme.bg("customMessageBg", s));
  const inner = new Container();
  const add = (label: string, value: unknown) => inner.addChild(new Text(theme.fg("muted", label.padEnd(10)) + theme.fg("text", String(value)), 0, 0));
  for (const [label, key] of [["Model", "model"], ["Task ID", "taskId"], ["Status", "status"], ["Error", "error"]]) {
   if (details[key]) add(label, details[key]);
  }
  box.addChild(inner);
  container.addChild(new Spacer(1));
  container.addChild(box);
  return container;
 });
}
