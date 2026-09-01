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

export interface OpenAiVideoConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
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
	} catch {
		return {};
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
		},
	};
}

export async function videoSubmit(
	config: OpenAiVideoConfig,
	opts: { prompt: string; duration?: number; signal?: AbortSignal },
): Promise<{ id: string; raw: any }> {
	const body: Record<string, unknown> = { model: config.model, prompt: opts.prompt };
	if (opts.duration !== undefined) body.duration = opts.duration;
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
	opts: { prompt: string; duration?: number; signal?: AbortSignal; onStatus?: (text: string) => void },
): Promise<string> {
	const submit = await videoSubmit(config, opts);
	opts.onStatus?.(`Task ${submit.id} submitted, polling…`);
	const deadline = Date.now() + 8 * 60_000;
	while (Date.now() < deadline) {
		if (opts.signal?.aborted) throw new Error("Cancelled.");
		await new Promise((r) => setTimeout(r, 5_000));
		const poll = await videoPoll(config, submit.id, opts.signal);
		if (poll.status === "succeeded") {
			if (!poll.videoUrl) throw new Error("Video task succeeded without a video url.");
			return poll.videoUrl;
		}
		if (poll.status === "failed") throw new Error("Video task failed upstream.");
		opts.onStatus?.("Polling…");
	}
	throw new Error("Video task timed out after 8 minutes.");
}
