// MiniMax H3 content-array mapping for OpenAI-compatible gateway routes
// (Mantice). Mirrors the official Video Generation V2 contract (saved
// 2026-10-15 at works/artifacts/mantice/minimax-h3-reference):
// content items [{type:"text",text}, {type:"image_url",image_url:{url},role}]
// with roles first_frame / last_frame / reference_image. Frames and reference
// images are mutually exclusive, reference images cap at 9, last_frame must
// pair with first_frame, and every request carries exactly one non-empty text
// item. Local files load as base64 data URIs; http(s) and mm_file:// URLs
// pass through unchanged.
import { loadReferenceFile } from "./media.ts";

/** Gateway model ids verified to route to MiniMax H3 with the content-array schema. */
const H3_VIDEO_ROUTES = new Set(["fornace-video", "fornace-video-h3-max"]);

export type H3ImageRole = "first_frame" | "last_frame" | "reference_image";

export type H3ContentItem =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string }; role: H3ImageRole };

export interface H3ImageInputs {
	imagePath?: string;
	lastImagePath?: string;
	referenceImages?: string[];
}

export function isH3VideoRoute(model: string): boolean {
	return H3_VIDEO_ROUTES.has(model);
}

/** True when any image input is declared. An empty referenceImages array counts
 * as none; a declared-but-empty frame path still counts so it fails validation. */
export function hasH3ImageInputs(inputs: H3ImageInputs): boolean {
	if (inputs.imagePath !== undefined || inputs.lastImagePath !== undefined) return true;
	return (inputs.referenceImages?.length ?? 0) > 0;
}

/** Structural validation of the declared image combination, before anything is loaded or submitted. */
function assertH3ImageInputs(inputs: H3ImageInputs): void {
	const frames: ReadonlyArray<readonly [string, string | undefined]> = [
		["imagePath", inputs.imagePath],
		["lastImagePath", inputs.lastImagePath],
	];
	for (const [field, value] of frames) {
		if (value !== undefined && !value.trim()) throw new Error(`${field} must not be an empty path.`);
	}
	const refs = inputs.referenceImages ?? [];
	const emptyRef = refs.findIndex((p) => !p || !p.trim());
	if (emptyRef !== -1) throw new Error(`referenceImages[${emptyRef}] must not be an empty path.`);
	if (inputs.lastImagePath !== undefined && inputs.imagePath === undefined) {
		throw new Error("MiniMax H3 last_frame must be paired with first_frame: pass imagePath along lastImagePath.");
	}
	const hasFrames = inputs.imagePath !== undefined || inputs.lastImagePath !== undefined;
	if (hasFrames && refs.length > 0) {
		throw new Error("MiniMax H3 rejects mixing first/last frame images with reference images; choose image-to-video or reference-to-video.");
	}
	if (refs.length > 9) throw new Error(`MiniMax H3 accepts at most 9 reference images; got ${refs.length}.`);
}

/** Resolve one declared image to an upstream URL: public URL or mm_file
 * passthrough, anything else loads from local disk as a data URI. */
async function toImageUrl(cwd: string, field: string, pathArg: string): Promise<string> {
	if (/^(https?:\/\/|mm_file:\/\/)/i.test(pathArg)) return pathArg;
	return loadReferenceFile(cwd, pathArg);
}

/** Build the H3 content array: one text item plus role-tagged image items. */
export async function buildH3Content(cwd: string, prompt: string, inputs: H3ImageInputs): Promise<H3ContentItem[]> {
	assertH3ImageInputs(inputs);
	if (!prompt.trim()) {
		throw new Error("MiniMax H3 requires a non-empty prompt (content must include one non-empty text item).");
	}
	const content: H3ContentItem[] = [{ type: "text", text: prompt }];
	if (inputs.imagePath !== undefined) {
		content.push({ type: "image_url", image_url: { url: await toImageUrl(cwd, "imagePath", inputs.imagePath) }, role: "first_frame" });
	}
	if (inputs.lastImagePath !== undefined) {
		content.push({ type: "image_url", image_url: { url: await toImageUrl(cwd, "lastImagePath", inputs.lastImagePath) }, role: "last_frame" });
	}
	for (const ref of inputs.referenceImages ?? []) {
		content.push({ type: "image_url", image_url: { url: await toImageUrl(cwd, "referenceImages entry", ref) }, role: "reference_image" });
	}
	return content;
}
