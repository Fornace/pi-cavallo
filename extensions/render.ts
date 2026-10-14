import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderMessage } from "./message-ui.ts";

export function registerCavalloRenderer(pi: ExtensionAPI): void {
 pi.registerMessageRenderer("cavallo_result", (message, options, theme) => {
  const details = message.details as Record<string, unknown> | undefined;
  const first = message.content?.[0];
  const text = typeof message.content === "string" ? message.content
   : typeof first === "object" && first.type === "text" ? first.text : "Video";
  // Core owns lazy media rows from message.content. Never decode details/thumbData.
  const rows = [["Model", "model"], ["Task ID", "taskId"], ["Status", "status"], ["Error", "error"], ["Output", "outputPath"]];
  const detail = rows.flatMap(([label, key]) => {
   const value = details?.[key!];
   if (!value || ((key === "error" || key === "outputPath") && text.includes(String(value)))) return [];
   return [label!.padEnd(10) + String(value)];
  }).join("\n");
  return renderMessage(text, theme, { level: details?.status === "Failed" ? "error" : "info", detail, expanded: options.expanded });
 });
}
