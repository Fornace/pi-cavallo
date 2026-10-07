// OpenAI-compatible video provider layer for pi-cavallo.
// When the "cavallo" section is configured in settings.json (via
// /cavallo-setup), cavallo_video submits to {baseUrl}/videos/generations and
// polls {baseUrl}/videos/generations/{id} — the mantice gateway flow — instead
// of DashScope directly.
//
//   "cavallo": {
//     "baseUrl": "https://llm.fornace.net/v1",
//     "apiKey": "sk-...",
//     "model": "fornace-video"
//   }
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { setTimeout as delay } from "node:timers/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { downloadVideo } from "./task.ts";
import { completedVideo, failedVideo } from "./completion.ts";

export interface DeclaredVideoInputs {
 model?: string; imagePath?: string; lastImagePath?: string; videoPath?: string;
 firstClipPath?: string; audioPath?: string; referenceImages?: string[];
 negativePrompt?: string; promptExtend?: boolean; watermark?: boolean;
}

/** Until a first-party gateway input schema is verified, no declared unsupported input can disappear. */
export function assertGatewayInputs(config: OpenAiVideoConfig, inputs: DeclaredVideoInputs): void {
 const unsupported = ["imagePath", "lastImagePath", "videoPath", "firstClipPath", "audioPath", "referenceImages", "negativePrompt", "promptExtend", "watermark"] as const;
 const declared: string[] = unsupported.filter(key => inputs[key] !== undefined);
 if (inputs.model !== undefined && inputs.model !== config.model) declared.push("model");
 if (declared.length) throw new Error(`Selected Cavallo gateway ${config.baseUrl} (${config.model}) does not have a verified schema for: ${declared.join(", ")}. Nothing submitted; route unchanged.`);
}


export interface OpenAiVideoConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
	enableSafetyChecker: true;
}

export type VideoRoute =
	| { kind: "openai-compat"; config: OpenAiVideoConfig }
	| { kind: "dashscope" };

export function loadCavalloVideoSettings(): Partial<OpenAiVideoConfig> {
	try {
		const raw = JSON.parse(
			readFileSync(resolve(homedir(), ".pi", "agent", "settings.json"), "utf8"),
		);
		return raw?.cavallo ?? {};
	} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
  throw new Error("Cavallo settings could not be read", { cause: error });
	}
}

export async function resolveVideoRoute(ctx: any): Promise<VideoRoute> {
	const s = loadCavalloVideoSettings();
	if (!s.baseUrl) return { kind: "dashscope" };
	let apiKey = s.apiKey;
	if (!apiKey && ctx?.modelRegistry) {
		try {
			apiKey = await ctx.modelRegistry.getApiKeyForProvider("mantice");
		} catch { /* fall through */ }
	}
	if (!apiKey) apiKey = process.env.MANTICE_API_KEY;
	if (!apiKey) {
		throw new Error(
			"cavallo: baseUrl is configured but no API key was found. " +
				"Run /cavallo-setup again, or set cavallo.apiKey in settings.json.",
		);
	}
	return {
		kind: "openai-compat",
		config: {
			baseUrl: s.baseUrl.replace(/\/+$/, ""),
			apiKey,
			model: s.model ?? "fornace-video",
			enableSafetyChecker: true,
		},
	};
}

export async function videoSubmit(
	config: OpenAiVideoConfig,
	opts: DeclaredVideoInputs & { prompt: string; duration?: number; resolution?: string; aspectRatio?: string; promptExpansionMode?: "balanced" | "quality"; seed?: number; signal?: AbortSignal },
): Promise<{ id: string; raw: any }> {
	assertGatewayInputs(config, opts);
 const body: Record<string, unknown> = {
		model: config.model,
		prompt: opts.prompt,
		duration: opts.duration ?? 5,
		resolution: opts.resolution ?? "768P",
		aspect_ratio: opts.aspectRatio ?? "16:9",
		prompt_expansion_mode: opts.promptExpansionMode ?? "balanced",
		enable_safety_checker: true,
	};
	if (opts.seed !== undefined) body.seed = opts.seed;
	const res = await fetch(`${config.baseUrl}/videos/generations`, {
		method: "POST",
		headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: opts.signal,
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Video submit failed (${res.status}): ${text.slice(0, 400)}`);
	}
	const data = JSON.parse(text);
	const id = data?.id ?? data?.request_id;
	if (!id) throw new Error(`Video submit returned no task id: ${text.slice(0, 300)}`);
	return { id, raw: data };
}

export interface VideoPollResult {
	status: "processing" | "succeeded" | "failed";
	videoUrl?: string;
}

export async function videoPoll(
	config: OpenAiVideoConfig,
	id: string,
	signal?: AbortSignal,
): Promise<VideoPollResult> {
	const res = await fetch(`${config.baseUrl}/videos/generations/${id}`, {
		headers: { Authorization: `Bearer ${config.apiKey}` },
		signal,
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Video poll failed (${res.status}): ${text.slice(0, 300)}`);
	}
	const data = JSON.parse(text);
	const status = data?.status === "succeeded" ? "succeeded"
		: data?.status === "failed" ? "failed"
		: data?.task_status === "SUCCESS" ? "succeeded"
		: data?.task_status === "FAIL" ? "failed"
		: "processing";
	const videoUrl = data?.video_url
		?? data?.video?.url
		?? (Array.isArray(data?.video_result) ? data.video_result[0]?.url : undefined);
	return { status, videoUrl };
}

/** Submit + poll until terminal. Resolves with the finished video URL. */
export async function openaiGenerateVideo(
	config: OpenAiVideoConfig,
	opts: DeclaredVideoInputs & { prompt: string; duration?: number; resolution?: string; aspectRatio?: string; promptExpansionMode?: "balanced" | "quality"; seed?: number; signal?: AbortSignal; onStatus?: (text: string) => void; onSubmitted?: (id: string) => void },
): Promise<string> {
 const bounded = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(8 * 60_000)]) : AbortSignal.timeout(8 * 60_000);
 const submit = await videoSubmit(config, { ...opts, signal: bounded });
 opts.onSubmitted?.(submit.id);
	opts.onStatus?.(`Task ${submit.id} submitted, polling…`);
	const deadline = Date.now() + 8 * 60_000;
	while (Date.now() < deadline) {
		if (opts.signal?.aborted) throw new Error("Cancelled.");
		await delay(5_000, undefined, { signal: bounded });
		const poll = await videoPoll(config, submit.id, bounded);
		if (poll.status === "succeeded") {
			if (!poll.videoUrl) throw new Error("Video task succeeded without a video url.");
			return poll.videoUrl;
		}
		if (poll.status === "failed") throw new Error("Video task failed upstream.");
		opts.onStatus?.("Polling…");
	}
	throw new Error("Video task timed out after 8 minutes.");
}

/** Full OpenAI-compat video flow used by cavallo_video's execute:
 * submit, poll, download, notify. Text-to-video only. */
export async function openaiVideoFlow(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	config: OpenAiVideoConfig,
	params: DeclaredVideoInputs & { prompt?: string; duration?: number; resolution?: string; aspectRatio?: string; promptExpansionMode?: "balanced" | "quality"; seed?: number; outputPath?: string },
	signal: AbortSignal | undefined,
	onUpdate?: any,
): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> {
 assertGatewayInputs(config, params);
 if (ctx.media?.capabilities !== "pi.media.v1") throw new Error("Cavallo generation requires pi.media.v1 completion capture. Nothing submitted.");
 const { mkdir } = await import("fs/promises");
 let taskId: string | undefined;
 let outPath: string | undefined;
 try {

	if (ctx.hasUI) {
		ctx.ui.setWorkingIndicator({
			frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
			intervalMs: 80,
		});
	}
	onUpdate?.({
		content: [{ type: "text", text: `Submitting video generation task to ${config.model}…` }],
		details: { ...params, model: config.model, status: "Submitting" },
	});
	const videoUrl = await openaiGenerateVideo(config, {
		...params,
  prompt: params.prompt ?? "",
  onSubmitted: (id) => { taskId = id; pi.appendEntry("cavallo_job", { taskId: id, model: config.model, status: "Submitted" }); },
		duration: params.duration,
		resolution: params.resolution,
		aspectRatio: params.aspectRatio,
		promptExpansionMode: params.promptExpansionMode,
		seed: params.seed,
		signal,
		onStatus: (text) => {
			if (ctx.hasUI) ctx.ui.setStatus("cavallo_openai", `Cavallo: ${text}`);
		},
	});
	if (ctx.hasUI) ctx.ui.setStatus("cavallo_openai", undefined);

	const { isAbsolute } = await import("node:path");
 const cwd = ctx.cwd;
	if (params.outputPath) {
		const cleaned = params.outputPath.replace(/^@/, "");
		outPath = isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned);
		await mkdir(resolve(outPath, ".."), { recursive: true });
	} else {
		const dir = resolve(cwd, "generated");
		await mkdir(dir, { recursive: true });
		const slug = (params.prompt ?? "video").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "video";
		outPath = resolve(dir, `${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`);
	}
 await downloadVideo(videoUrl, outPath, signal);
 await completedVideo(pi, ctx, outPath, { ...params, model: config.model, taskId, videoUrl }, signal);
 return {
  content: [{ type: "text", text: `Video saved: ${outPath}` }],
  details: { status: "Done", taskId, outputPath: outPath },
 };
 } catch (error) {
  failedVideo(pi, { model: config.model, taskId, outputPath: outPath, submitted: !!taskId }, error);
  throw error;
 } finally {
  if (ctx.hasUI) { ctx.ui.setStatus("cavallo_openai", undefined); ctx.ui.setWorkingIndicator(); }
 }
}
