import type { ExtensionAPI, ExtensionContext, MediaReferenceContent } from "@earendil-works/pi-coding-agent";

/** Capture completes before emission. Never derive an eager thumbnail or embed raster bytes. */
export async function completedVideo(
 pi: ExtensionAPI, ctx: ExtensionContext, path: string, details: Record<string, unknown>, signal?: AbortSignal,
): Promise<MediaReferenceContent> {
 if (ctx.media?.capabilities !== "pi.media.v1") {
  throw new Error(`Video downloaded at ${path}, but this host has no pi.media.v1 capture service. Original retained; media completion not admitted.`);
 }
 const reference = await ctx.media.capture({ source: "path", path, ingress: "cavallo", intent: "view" }, signal);
 pi.sendMessage({ customType: "cavallo_result", display: true,
  content: [{ type: "text", text: `Video saved: ${path}` }, reference],
  details: { ...details, status: "Done", outputPath: path },
 });
 return reference;
}

export function failedVideo(pi: ExtensionAPI, details: Record<string, unknown>, error: unknown): void {
 const message = error instanceof Error ? error.message : String(error);
 pi.appendEntry("cavallo_failure", { ...details, status: "Failed", error: message, failedAt: new Date().toISOString() });
 pi.sendMessage({ customType: "cavallo_result", display: true,
  content: [{ type: "text", text: `Video task failed: ${message}` }],
  details: { ...details, status: "Failed", error: message },
 });
}
