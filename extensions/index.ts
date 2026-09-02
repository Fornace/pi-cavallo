import { resolve, isAbsolute, extname } from "path";
import { existsSync } from "fs";
import { readFile, mkdir } from "fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Container, Text, Box, Spacer, Image, Markdown } from "@earendil-works/pi-tui";
import { MODEL_IDS, inferCapability, specFor, type Capability } from "./models.ts";
import { resolveDefaultModel, saveDefaultModel } from "./settings.ts";
import { resolveVideoRoute, openaiVideoFlow } from "./providers.ts";
import { runCavalloSetup, configureCavalloProvider } from "./wizard.ts";
import { submitTask, pollUntilDone, downloadVideo, makeThumbnail } from "./task.ts";

const SUPPORTED_INPUT_MIME = new Set(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"]);
const DEFAULT_OUTPUT_DIR = "./generated";

function slugify(text: string) {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 40) || "video";
}

function timestamp() {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function mimeFromExt(path: string): string {
	const ext = extname(path).toLowerCase();
	switch (ext) {
		case ".png": return "image/png";
		case ".jpg":
		case ".jpeg": return "image/jpeg";
		case ".webp": return "image/webp";
		case ".mp4": return "video/mp4";
		case ".webm": return "video/webm";
		default: return "image/png";
	}
}

async function loadReferenceFile(cwd: string, pathArg: string): Promise<string> {
	const cleaned = pathArg.replace(/^@/, "");
	const abs = isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned);
	if (!existsSync(abs)) throw new Error(`Reference file not found: ${abs}`);
	const mimeType = mimeFromExt(abs);
	if (!SUPPORTED_INPUT_MIME.has(mimeType)) throw new Error(`Unsupported reference file type: ${mimeType}.`);
	const buf = await readFile(abs);
	const sizeMB = buf.length / (1024 * 1024);
	if (sizeMB > 50) {
		console.warn(`[cavallo] Warning: ${abs} is ${sizeMB.toFixed(1)}MB. Large files are Base64-encoded into memory (~${(sizeMB * 1.33).toFixed(0)}MB). Consider using a public URL instead.`);
	}
	return `data:${mimeType};base64,${buf.toString("base64")}`;
}

async function resolveOutputPath(cwd: string, prompt: string | undefined, override: string | undefined): Promise<string> {
	if (override) {
		const cleaned = override.replace(/^@/, "");
		const abs = isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned);
		await mkdir(resolve(abs, ".."), { recursive: true });
		return abs;
	}
	const dir = isAbsolute(DEFAULT_OUTPUT_DIR) ? DEFAULT_OUTPUT_DIR : resolve(cwd, DEFAULT_OUTPUT_DIR);
	await mkdir(dir, { recursive: true });
	return resolve(dir, `${slugify(prompt || "video")}-${timestamp()}.mp4`);
}

function resolveApiKey(ctx: any): string {
	if (ctx.modelRegistry) {
		try {
			const k = ctx.modelRegistry.getApiKeyForProvider("alibaba-cloud");
			if (k) return k;
		} catch { /* fall through */ }
	}
	if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY;
	throw new Error(
		"No DashScope API key found. pi-cavallo looked in this order:\n" +
			"  1. ~/.pi/agent/auth.json → \"alibaba-cloud\" key (set via /login or edit auth.json)\n" +
			"  2. models.json provider config (pi --list-models to check)\n" +
			"  3. DASHSCOPE_API_KEY env var\n\n" +
			"Get a key at https://dashscope.console.aliyun.com/",
	);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("cavallo-setup", {
		description: "Interactive setup: point cavallo at an OpenAI-compatible video provider (URL + key, capability probe)",
		handler: async (_args, ctx) => {
			await runCavalloSetup(ctx);
		},
	});

	pi.registerTool({
		name: "cavallo_configure",
		label: "Cavallo Configure",
		description:
			"Configure cavallo to submit video generation through an OpenAI-compatible gateway (mantice) instead of DashScope. " +
			"Probes the endpoint and saves the route. Call this when the user asks to set up or switch the video provider.",
		promptSnippet: "Configure the cavallo video provider (mantice) non-interactively.",
		parameters: Type.Object({
			baseUrl: Type.String({ description: "OpenAI-compatible base URL, e.g. https://llm.fornace.net/v1" }),
			apiKey: Type.Optional(Type.String({
				description: "API key. Omit to reuse the mantice key already stored in pi credentials.",
			})),
			model: Type.Optional(Type.String({
				description: "Video model/group id. Omit to auto-detect (e.g. fornace-video).",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const report = await configureCavalloProvider(ctx, params);
			return { content: [{ type: "text", text: report }], details: {} };
		},
	});

	pi.registerCommand("cavallo-models", {
		description: "List Cavallo video models, capabilities, and current defaults",
		handler: async (args) => {
			if (args?.trim()) {
				const m = args.trim().match(/^(t2v|i2v|r2v|edit)\s*=\s*(\S+)$/);
				if (!m) {
					pi.sendUserMessage("Usage: /cavallo-models t2v=happyhorse-1.1-t2v (capabilities: t2v, i2v, r2v, edit)");
					return;
				}
				const [, cap, model] = m;
				const spec = specFor(model);
				if (!spec || !spec.capabilities.includes(cap as Capability)) {
					pi.sendUserMessage(`Model ${model} does not support ${cap}. Run /cavallo-models to see the catalog.`);
					return;
				}
				await saveDefaultModel(cap as Capability, model);
				pi.sendUserMessage(`Cavallo default for ${cap} is now ${model} (saved in settings.json).`);
				return;
			}
			const lines = ["Cavallo video models (Alibaba Model Studio):", ""];
			for (const cap of ["t2v", "i2v", "r2v", "edit"] as Capability[]) {
				const d = resolveDefaultModel(cap);
				const models = MODEL_IDS.filter((id) => specFor(id)!.capabilities.includes(cap));
				lines.push(`${cap}  default: ${d.model}${d.source === "settings" ? " (settings override)" : ""}`);
				for (const id of models) {
					const spec = specFor(id)!;
					lines.push(`  ${id}  ${spec.resolutions.join("/")}  ${spec.minDuration}-${spec.maxDuration}s${spec.audio ? "  audio" : ""}`);
				}
				lines.push("");
			}
			lines.push("Override a default: /cavallo-models t2v=<model-id>  (or edit \"cavallo\" in settings.json)");
			pi.sendUserMessage(lines.join("\n"));
		},
	});

	pi.registerMessageRenderer("cavallo_result", (message, _options, theme) => {
		const { details, content } = message;
		const container = new Container();
		container.addChild(new Text(theme.fg("success", (content?.[0] as any)?.text || "Success!"), 0, 0));
		if (!details) return container;
		const { model, prompt, imagePath, videoPath, referenceImages, outputPath, taskId, videoUrl, metrics, thumbData } = details as any;

		if (thumbData) {
			container.addChild(new Image(thumbData, "image/jpeg", { ...theme, fallbackColor: (s: string) => theme.fg("muted", s) }, { maxWidthCells: 20, maxHeightCells: 14 }));
			container.addChild(new Spacer(1));
		}
		if (outputPath) {
			const mdTheme = getMarkdownTheme();
			const encodedCmd = encodeURIComponent(`open -R "${outputPath}"`);
			container.addChild(new Markdown(`[Reveal in Finder](command:bash?command=${encodedCmd})\n\`${outputPath}\``, 0, 0, mdTheme));
		}
		container.addChild(new Spacer(1));

		const box = new Box(1, 1, (s: string) => theme.bg("customMessageBg", s));
		const inner = new Container();
		inner.addChild(new Text(theme.fg("accent", theme.bold("CAVALLO DETAILS")), 0, 0));
		inner.addChild(new Spacer(1));
		const add = (label: string, value: string) => {
			inner.addChild(new Text(theme.fg("muted", label.padEnd(10)) + theme.fg("text", String(value)), 0, 0));
		};
		if (model) add("Model", model);
		if (prompt) add("Prompt", prompt);
		if (imagePath) add("Image", imagePath);
		if (videoPath) add("Video", videoPath);
		if (referenceImages?.length) add("Refs", Array.isArray(referenceImages) ? referenceImages.join(", ") : referenceImages);
		if (taskId) add("Task ID", taskId);
		if (metrics?.duration) add("Duration", `${metrics.duration}s`);
		if (metrics?.SR) add("Resolution", `${metrics.SR}P`);
		if (outputPath) add("Saved To", outputPath);
		if (videoUrl) add("URL", videoUrl);
		box.addChild(inner);
		container.addChild(box);
		return container;
	});

	pi.registerTool({
		name: "cavallo_video",
		label: "Cavallo Video",
		description:
			"Generate or edit videos using Alibaba video models (HappyHorse 1.1/1.0, Wan 3.0, Wan 2.7; T2V, I2V, R2V, Video-Edit). " +
			"Returns the path to the generated video file. Omit `model` to use the best default for the task.",
		promptSnippet:
			"Generate or edit videos using Alibaba video models (T2V, I2V, R2V, Video-Edit). Omit `model` to auto-select.",
		promptGuidelines: [
			"Call cavallo_video when the user asks to create or edit a video.",
			"Prefer omitting `model`: the best default is chosen automatically (t2v: happyhorse-1.1-t2v, i2v: happyhorse-1.1-i2v, r2v: happyhorse-1.1-r2v, edit: happyhorse-1.0-video-edit).",
			"Pass `imagePath` for Image-to-Video, `videoPath` for Video-Edit, `referenceImages` (up to 9) for Reference-to-Video.",
			"Use 'wan3.0-video' or 'wan3.0-video-prime' for clips longer than 15s (up to 30s), first/last-frame stitching, or file/web-link references.",
			"Use 'wan2.7-i2v-2026-04-25' with `lastImagePath`/`firstClipPath` for end-frame or continuation control.",
			"For Mantice H3 Max, prefer 768P, 16:9, 5 seconds, and balanced prompt expansion. The fal safety checker is always enabled by policy and cannot be disabled.",
		],
		parameters: Type.Object({
			model: Type.Optional(StringEnum(MODEL_IDS, {
				description: "Model id. Omit to auto-select the best default for the detected task type, or set persistent defaults via /cavallo-models.",
			})),
			prompt: Type.Optional(Type.String({ description: "Natural language instructions for generation or edit." })),
			negativePrompt: Type.Optional(Type.String({ description: "Natural language instructions for what to exclude from the video." })),
			imagePath: Type.Optional(Type.String({ description: "Path to input image (first frame) for I2V model." })),
			lastImagePath: Type.Optional(Type.String({ description: "Path to last frame image for I2V model." })),
			videoPath: Type.Optional(Type.String({ description: "Path to input video for Video-Edit model." })),
			firstClipPath: Type.Optional(Type.String({ description: "Path to input video clip for video continuation using I2V model." })),
			audioPath: Type.Optional(Type.String({ description: "Public HTTP/HTTPS URL to an audio file for audio-driven video. Local file paths are not supported by the API." })),
			referenceImages: Type.Optional(Type.Array(Type.String(), { description: "Paths to reference images for R2V or Video-Edit models." })),
			aspectRatio: Type.Optional(StringEnum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], {
				description: "Output aspect ratio. H3 Max default is 16:9.",
			})),
			resolution: Type.Optional(StringEnum(["480P", "768P", "720P", "1080P"], {
				description: "Output resolution. H3 Max accepts 480P or 768P; other configured video providers may support 720P/1080P.",
			})),
			promptExpansionMode: Type.Optional(StringEnum(["balanced", "quality"], {
				description: "Prompt rewriting effort. balanced is faster; quality spends longer on a richer prompt.",
			})),
			duration: Type.Optional(Type.Integer({
				description: "Duration in seconds. H3 Max defaults to 5; supported range depends on the provider.",
				minimum: 2,
				maximum: 30,
			})),
			seed: Type.Optional(Type.Integer({ description: "Random seed for reproducibility.", minimum: 0, maximum: 2147483647 })),
			promptExtend: Type.Optional(Type.Boolean({ description: "Enable intelligent prompt rewriting (adds latency, default true)." })),
			watermark: Type.Optional(Type.Boolean({ description: "Add AI Generated watermark to the video (default true)." })),
			outputPath: Type.Optional(Type.String({ description: "Optional output path for the generated video. Defaults to ./generated/<slug>-<timestamp>.mp4" })),
		}),

		prepareArguments(args: any) {
			if (args.referenceImage !== undefined) {
				args.referenceImages = Array.isArray(args.referenceImage) ? args.referenceImage : [args.referenceImage];
				delete args.referenceImage;
			}
			return args;
		},

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			// OpenAI-compatible provider (mantice etc.) when configured via /cavallo-setup.
			// Currently text-to-video only; reference/image inputs need DashScope.
			const route = await resolveVideoRoute(ctx);
			if (route.kind === "openai-compat") {
				return openaiVideoFlow(pi, ctx, route.config, {
					...params,
					promptExpansionMode: params.promptExpansionMode as "balanced" | "quality" | undefined,
				}, signal, onUpdate);
			}

			const apiKey = resolveApiKey(ctx);
			const cwd = ctx.cwd;
			const capability = inferCapability(params);
			const model = params.model ?? resolveDefaultModel(capability).model;
			const spec = specFor(model);
			if (!spec) {
				throw new Error(`Unknown model: ${model}. Run /cavallo-models to list valid ids.`);
			}
			if (!spec.capabilities.includes(capability)) {
				throw new Error(`Model ${model} does not support ${capability}. It supports: ${spec.capabilities.join(", ")}.`);
			}

			// Model-specific input validation
			if (capability === "i2v" && !params.imagePath && !params.firstClipPath) {
				throw new Error(`Model ${model} requires either imagePath or firstClipPath.`);
			}
			if (capability === "edit" && !params.videoPath) {
				throw new Error(`Model ${model} requires videoPath.`);
			}
			if (capability === "r2v" && (!params.referenceImages || params.referenceImages.length === 0)) {
				throw new Error(`Model ${model} requires referenceImages (1-9 image paths).`);
			}
			if (params.audioPath && !params.audioPath.startsWith("http://") && !params.audioPath.startsWith("https://")) {
				throw new Error(`audioPath must be a public HTTP/HTTPS URL. Local files are not supported by the API. Got: ${params.audioPath}`);
			}
			if (params.duration !== undefined && (params.duration < spec.minDuration || params.duration > spec.maxDuration)) {
				throw new Error(`Duration must be ${spec.minDuration}-${spec.maxDuration} seconds for ${model}. Got: ${params.duration}`);
			}
			const resolution = params.resolution ?? "720P";
			if (!spec.resolutions.includes(resolution)) {
				throw new Error(`Resolution ${resolution} is not supported by ${model}. Supported: ${spec.resolutions.join(", ")}.`);
			}

			if (ctx.hasUI) {
				ctx.ui.setWorkingIndicator({ frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], intervalMs: 80 });
			}
			onUpdate?.({
				content: [{ type: "text", text: `Submitting video generation task to ${model}…` }],
				details: { ...params, model, status: "Submitting", progress: "Submitting to DashScope..." },
			});

			const inputPayload: any = {};
			const parametersPayload: any = { resolution };
			if (params.duration !== undefined) parametersPayload.duration = params.duration;
			if (params.seed !== undefined) parametersPayload.seed = params.seed;
			if (params.promptExtend !== undefined) parametersPayload.prompt_extend = params.promptExtend;
			if (params.watermark !== undefined) parametersPayload.watermark = params.watermark;
			if (params.aspectRatio !== undefined && (capability === "t2v" || capability === "r2v")) {
				parametersPayload.ratio = params.aspectRatio;
			}

			if (params.prompt) inputPayload.prompt = params.prompt;
			if (params.negativePrompt) inputPayload.negative_prompt = params.negativePrompt;
			if (params.audioPath && capability === "t2v") inputPayload.audio_url = params.audioPath;

			const media: Array<{ type: string; url?: string; reference_voice?: string }> = [];
			if (capability === "i2v") {
				if (params.imagePath) media.push({ type: "first_frame", url: await loadReferenceFile(cwd, params.imagePath) });
				if (params.lastImagePath) media.push({ type: "last_frame", url: await loadReferenceFile(cwd, params.lastImagePath) });
				if (params.firstClipPath) media.push({ type: "first_clip", url: await loadReferenceFile(cwd, params.firstClipPath) });
				if (params.audioPath) media.push({ type: "driving_audio", url: params.audioPath });
			} else if (capability === "r2v") {
				let attachedVoice = false;
				for (const ref of params.referenceImages || []) {
					const item: any = { type: "reference_image", url: await loadReferenceFile(cwd, ref) };
					if (!attachedVoice && params.audioPath) { item.reference_voice = params.audioPath; attachedVoice = true; }
					media.push(item);
				}
			} else if (capability === "edit") {
				if (params.videoPath) media.push({ type: "video", url: await loadReferenceFile(cwd, params.videoPath) });
				for (const ref of params.referenceImages || []) {
					media.push({ type: "reference_image", url: await loadReferenceFile(cwd, ref) });
				}
			}
			if (media.length > 0) inputPayload.media = media;

			let taskId: string;
			try {
				taskId = await submitTask({ model, apiKey, inputPayload, parametersPayload, signal });
			} catch (err: any) {
				if (ctx.hasUI) ctx.ui.setWorkingIndicator();
				throw new Error(`[${model}] ${err?.message?.includes("DashScope API error") ? err.message : `DashScope API connection error: ${err?.message ?? String(err)}`}`);
			}

			onUpdate?.({
				content: [{ type: "text", text: `Task ${taskId} submitted. Polling for completion…` }],
				details: { ...params, model, taskId, status: "Polling", progress: "Waiting for video generation..." },
			});

			const runBackground = async () => {
				const setStatus = (text: string | undefined) => {
					if (ctx.hasUI) ctx.ui.setStatus(`cavallo_${taskId}`, text);
				};
				try {
					setStatus("Cavallo: Polling...");
					const { videoUrl, usage } = await pollUntilDone(model, apiKey, taskId, (s) => setStatus(`Cavallo: ${s}...`));
					setStatus("Cavallo: Downloading...");
					const outPath = await resolveOutputPath(cwd, params.prompt, params.outputPath);
					await downloadVideo(videoUrl, outPath);
					const thumbData = await makeThumbnail(outPath);
					setStatus(undefined);
					pi.sendMessage({
						customType: "cavallo_result",
						display: true,
						content: [{ type: "text", text: `Video generated successfully: ${outPath}` }],
						details: { ...params, model, taskId, status: "Done", videoUrl, outputPath: outPath, metrics: usage, thumbData },
					});
				} catch (err: any) {
					setStatus(undefined);
					if (ctx.hasUI) ctx.ui.notify(`Cavallo Background Task Failed: ${err.message}`, "error");
				}
			};
			runBackground().catch(console.error);
			if (ctx.hasUI) ctx.ui.setWorkingIndicator();

			return {
				content: [{ type: "text", text: `Task ${taskId} submitted and running in background.` }],
				details: { taskId, status: "Background" },
			};
		},

		renderResult(result, _options, theme) {
			const details = result.details as any;
			const container = new Container();
			if (details?.status === "Background") {
				container.addChild(new Text(theme.fg("muted", (result.content[0] as any)?.text || "Task running in background..."), 0, 0));
				return container;
			}
			container.addChild(new Text(theme.fg("success", (result.content[0] as any)?.text || "Success!"), 0, 0));
			return container;
		},
	});
}
