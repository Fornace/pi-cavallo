import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const BRIDGE = "fornace.media.bridge.v1";
interface Reference { assetId: string; blockId: string; kind: "image" | "video"; }
function mediaRequest(pi: ExtensionAPI, ctx: ExtensionContext, operation: "capability" | "capture", path?: string, signal?: AbortSignal): Promise<Reference | { contract: string }> {
 return new Promise((resolve, reject) => {
  const request = { operation, context: ctx, handled: false, signal, publish: operation === "capture",
   ...(path ? { input: { source: "path", path, ingress: "cavallo", intent: "view" } } : {}), resolve, reject };
  pi.events.emit(BRIDGE, request);
  if (!request.handled) reject(new Error("Cavallo requires the Fornace media plugin capture bridge. Nothing submitted; original outputs remain files."));
 });
}
export async function requireMediaBridge(pi: ExtensionAPI, ctx: ExtensionContext, signal?: AbortSignal): Promise<void> {
 signal?.throwIfAborted();
 const result = await mediaRequest(pi, ctx, "capability", undefined, signal);
 if (!("contract" in result) || result.contract !== BRIDGE) throw new Error("Incompatible Fornace media plugin bridge");
}
/** Capture completes before emission; previews are prepared only by explicit user selection. */
export async function completedVideo(pi: ExtensionAPI, ctx: ExtensionContext, path: string, details: Record<string, unknown>, signal?: AbortSignal): Promise<Reference> {
 const result = await mediaRequest(pi, ctx, "capture", path, signal);
 if (!("assetId" in result)) throw new Error("Video original capture returned no identity");
 pi.sendMessage({ customType: "cavallo_result", display: true,
  content: [{ type: "text", text: `Video saved: ${path}` }],
  details: { ...details, status: "Done", outputPath: path, mediaAssetId: result.assetId },
 });
 return result;
}
export function failedVideo(pi: ExtensionAPI, details: Record<string, unknown>, error: unknown): void {
 const message = error instanceof Error ? error.message : String(error);
 pi.appendEntry("cavallo_failure", { ...details, status: "Failed", error: message, failedAt: new Date().toISOString() });
 pi.sendMessage({ customType: "cavallo_result", display: true,
  content: [{ type: "text", text: `Video task failed: ${message}` }], details: { ...details, status: "Failed", error: message },
 });
}
