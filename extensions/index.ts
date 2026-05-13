import { resolve, isAbsolute, extname } from "path";
import { existsSync } from "fs";
import { readFile, mkdir, writeFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { ExtensionAPI, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Container, Text, Box, Spacer, Image, Markdown } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);

const MODELS = [
	"happyhorse-1.0-t2v",
	"happyhorse-1.0-i2v",
	"happyhorse-1.0-r2v",
	"happyhorse-1.0-video-edit",
	"wan2.7-t2v",
	"wan2.7-i2v-2026-04-25",
	"wan2.7-r2v",
	"wan2.7-videoedit",
] as const;

const SUPPORTED_INPUT_MIME = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"video/mp4",
	"video/webm",
]);

const DEFAULT_OUTPUT_DIR = "./generated";

function slugify(text: string) {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.substring(0, 40) || "video";
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
	if (!existsSync(abs)) {
		throw new Error(`Reference file not found: ${abs}`);
	}
	const mimeType = mimeFromExt(abs);
	if (!SUPPORTED_INPUT_MIME.has(mimeType)) {
		throw new Error(`Unsupported reference file type: ${mimeType}.`);
	}
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

export default function (pi: ExtensionAPI) {
	pi.registerMessageRenderer("cavallo_result", (message, _options, theme) => {
		const { details, content } = message;
		const container = new Container();

		container.addChild(
			new Text(theme.fg("success", (content?.[0] as any)?.text || "Success!"), 0, 0)
		);

		if (!details) return container;

		const {
			model,
			prompt,
			imagePath,
			videoPath,
			referenceImages,
			outputPath,
			taskId,
			videoUrl,
			metrics,
			thumbData
		} = details as any;

		if (thumbData) {
			container.addChild(
				new Image(thumbData, "image/jpeg", { ...theme, fallbackColor: (s) => theme.fg("muted", s) }, { maxWidthCells: 40, maxHeightCells: 20 })
			);
			container.addChild(new Spacer(1));
		}

		if (outputPath) {
			const mdTheme = getMarkdownTheme();
			const encodedCmd = encodeURIComponent(`open -R "${outputPath}"`);
			container.addChild(
				new Markdown(`[Reveal in Finder](command:bash?command=${encodedCmd})\n\`${outputPath}\``, 0, 0, mdTheme)
			);
		}

		container.addChild(new Spacer(1));

		const settingsBox = new Box(1, 1, (s) => theme.bg("customMessageBg", s));
		const settingsContainer = new Container();

		settingsContainer.addChild(
			new Text(theme.fg("accent", theme.bold("CAVALLO DETAILS")), 0, 0)
		);
		settingsContainer.addChild(new Spacer(1));

		const addSetting = (label: string, value: string) => {
			settingsContainer.addChild(
				new Text(
					theme.fg("muted", label.padEnd(10)) + theme.fg("text", String(value)),
					0,
					0
				)
			);
		};

		if (model) addSetting("Model", model);
		if (prompt) addSetting("Prompt", prompt);
		if (imagePath) addSetting("Image", imagePath);
		if (videoPath) addSetting("Video", videoPath);
		if (referenceImages && referenceImages.length > 0) {
			addSetting("Refs", Array.isArray(referenceImages) ? referenceImages.join(", ") : referenceImages);
		}
		if (taskId) addSetting("Task ID", taskId);
		if (metrics?.duration) addSetting("Duration", `${metrics.duration}s`);
		if (metrics?.SR) addSetting("Resolution", `${metrics.SR}P`);
		if (outputPath) addSetting("Saved To", outputPath);
		if (videoUrl) addSetting("URL", videoUrl);

		settingsBox.addChild(settingsContainer);
		container.addChild(settingsBox);

		return container;
	});

	pi.registerTool({
		name: "cavallo_video",
		label: "Cavallo Video",
		description:
			"Generate or edit videos using Alibaba HappyHorse models (I2V, T2V, R2V, Video-Edit). " +
			"Returns the path to the generated video file.",
		promptSnippet:
			"Generate or edit videos using Alibaba HappyHorse models (I2V, T2V, R2V).",
		promptGuidelines: [
			"Call cavallo_video when the user asks to create or edit a video.",
			"Use 'happyhorse-1.0-t2v' or 'wan2.7-t2v' for Text-to-Video.",
			"Use 'happyhorse-1.0-i2v' or 'wan2.7-i2v-2026-04-25' for Image-to-Video. Pass an image path in `imagePath`.",
			"Use 'happyhorse-1.0-r2v' or 'wan2.7-r2v' to generate video from up to 9 reference images. Pass paths in `referenceImages`.",
			"Use 'happyhorse-1.0-video-edit' or 'wan2.7-videoedit' to edit a video. Pass the input video in `videoPath` and reference images in `referenceImages` if needed.",
			"For Wan2.7, you can provide an `audioPath` for text-to-video and image-to-video models to drive the video with audio.",
			"For Wan2.7 Image-to-Video, you can use `lastImagePath` and `firstClipPath` to provide end-frames or starting clips.",
		],
		parameters: Type.Object({
			model: StringEnum(MODELS, {
				description: "The HappyHorse model to use.",
				default: "happyhorse-1.0-t2v",
			}),
			prompt: Type.Optional(Type.String({
				description: "Natural language instructions for generation or edit.",
			})),
			negativePrompt: Type.Optional(Type.String({
				description: "Natural language instructions for what to exclude from the video.",
			})),
			imagePath: Type.Optional(Type.String({
				description: "Path to input image (first frame) for I2V model.",
			})),
			lastImagePath: Type.Optional(Type.String({
				description: "Path to last frame image for I2V model.",
			})),
			videoPath: Type.Optional(Type.String({
				description: "Path to input video for Video-Edit model.",
			})),
			firstClipPath: Type.Optional(Type.String({
				description: "Path to input video clip for video continuation using I2V model.",
			})),
			audioPath: Type.Optional(Type.String({
				description: "Public HTTP/HTTPS URL to an audio file for audio-driven video. Local file paths are not supported by the DashScope API.",
			})),
			referenceImages: Type.Optional(Type.Array(Type.String(), {
				description: "Paths to reference images for R2V or Video-Edit models.",
			})),
			aspectRatio: Type.Optional(StringEnum(["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4"], {
				description: "Aspect ratio of the generated video (only applies to t2v and r2v models).",
			})),
			resolution: Type.Optional(StringEnum(["720P", "1080P"], {
				description: "Resolution of the generated video. Default is 720P for faster/cheaper generation.",
			})),
			duration: Type.Optional(Type.Integer({
				description: "Duration of the generated video in seconds (2 to 15). Default is 5.",
				minimum: 2,
				maximum: 15
			})),
			seed: Type.Optional(Type.Integer({
				description: "Random seed for reproducibility [0, 2147483647].",
				minimum: 0,
				maximum: 2147483647
			})),
			promptExtend: Type.Optional(Type.Boolean({
				description: "Enable intelligent prompt rewriting (adds latency, default true).",
			})),
			watermark: Type.Optional(Type.Boolean({
				description: "Add AI Generated watermark to the video (default true).",
			})),
			outputPath: Type.Optional(Type.String({
				description: "Optional output path for the generated video. Defaults to ./generated/<slug>-<timestamp>.mp4",
			})),
		}),

		prepareArguments(args: any) {
			if (args.referenceImage !== undefined) {
				args.referenceImages = Array.isArray(args.referenceImage) ? args.referenceImage : [args.referenceImage];
				delete args.referenceImage;
			}
			return args;
		},

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			let apiKey = process.env.DASHSCOPE_API_KEY;
			if (!apiKey && ctx.modelRegistry) {
				try {
					apiKey = await ctx.modelRegistry.getApiKeyForProvider("alibaba-cloud");
				} catch (err) {
					// ignore
				}
			}
			if (!apiKey) {
				throw new Error("DASHSCOPE_API_KEY is missing. Please set it in your environment or configure Alibaba Cloud in Pi (/models).");
			}

			const cwd = ctx.cwd;
			const model = params.model ?? "happyhorse-1.0-t2v";

			// Model-specific input validation
			if (model.includes("-i2v") && !params.imagePath && !params.firstClipPath) {
				throw new Error(`Model ${model} requires either imagePath or firstClipPath.`);
			}
			if (model.includes("-videoedit") && !params.videoPath) {
				throw new Error(`Model ${model} requires videoPath.`);
			}
			if (model.includes("-r2v") && (!params.referenceImages || params.referenceImages.length === 0)) {
				throw new Error(`Model ${model} requires referenceImages (1-9 image paths).`);
			}

			// Audio path must be a public URL
			if (params.audioPath && !params.audioPath.startsWith("http://") && !params.audioPath.startsWith("https://")) {
				throw new Error(`audioPath must be a public HTTP/HTTPS URL. Local files are not supported by the DashScope API. Got: ${params.audioPath}`);
			}

			// Duration validation: HappyHorse requires 3-15, Wan2.7 allows 2-15
			if (params.duration !== undefined) {
				const minDur = model.startsWith("happyhorse") ? 3 : 2;
				if (params.duration < minDur || params.duration > 15) {
					throw new Error(`Duration must be ${minDur}-15 seconds for ${model}. Got: ${params.duration}`);
				}
			}
			
			if (ctx.hasUI) {
				ctx.ui.setWorkingIndicator({
					frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
					intervalMs: 80
				});
			}

			onUpdate?.({
				content: [{ type: "text", text: `Submitting video generation task to ${model}…` }],
				details: { ...params, status: "Submitting", progress: "Submitting to DashScope..." },
			});

			const inputPayload: any = {};
			const parametersPayload: any = {
				resolution: params.resolution ?? "720P",
			};

			if (params.duration !== undefined) {
				parametersPayload.duration = params.duration;
			}
			if (params.seed !== undefined) {
				parametersPayload.seed = params.seed;
			}
			if (params.promptExtend !== undefined) {
				parametersPayload.prompt_extend = params.promptExtend;
			}
			if (params.watermark !== undefined) {
				parametersPayload.watermark = params.watermark;
			}
			if (params.aspectRatio !== undefined && (model.includes("-t2v") || model.includes("-r2v"))) {
				parametersPayload.ratio = params.aspectRatio;
			}

			if (params.prompt) inputPayload.prompt = params.prompt;
			if (params.negativePrompt) inputPayload.negative_prompt = params.negativePrompt;
			if (params.audioPath && model.includes("-t2v")) inputPayload.audio_url = params.audioPath;

			const media: Array<{ type: string; url?: string; reference_voice?: string }> = [];

			if (model.includes("-i2v")) {
				if (params.imagePath) {
					media.push({ type: "first_frame", url: await loadReferenceFile(cwd, params.imagePath) });
				}
				if (params.lastImagePath) {
					media.push({ type: "last_frame", url: await loadReferenceFile(cwd, params.lastImagePath) });
				}
				if (params.firstClipPath) {
					media.push({ type: "first_clip", url: await loadReferenceFile(cwd, params.firstClipPath) });
				}
				if (params.audioPath) {
					media.push({ type: "driving_audio", url: params.audioPath });
				}
			} else if (model.includes("-r2v") && (params.referenceImages?.length ?? 0) > 0) {
				// We attach reference_voice to the first reference image if audioPath is provided
				let attachedVoice = false;
				for (const ref of (params.referenceImages || [])) {
					const mediaItem: any = { type: "reference_image", url: await loadReferenceFile(cwd, ref) };
					if (!attachedVoice && params.audioPath) {
						mediaItem.reference_voice = params.audioPath;
						attachedVoice = true;
					}
					media.push(mediaItem);
				}
			} else if (model.includes("-videoedit")) {
				if (params.videoPath) {
					media.push({ type: "video", url: await loadReferenceFile(cwd, params.videoPath) });
				}
				if ((params.referenceImages?.length ?? 0) > 0) {
					for (const ref of (params.referenceImages || [])) {
						media.push({ type: "reference_image", url: await loadReferenceFile(cwd, ref) });
					}
				}
			}

			if (media.length > 0) {
				inputPayload.media = media;
			}

			let response;
			try {
				response = await fetch("https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis", {
					method: "POST",
					headers: {
						"Authorization": `Bearer ${apiKey}`,
						"X-DashScope-Async": "enable",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ model, input: inputPayload, parameters: parametersPayload }),
					signal
				});
			} catch (err: any) {
				if (ctx.hasUI) ctx.ui.setWorkingIndicator();
				throw new Error(`[${model}] DashScope API connection error: ${err?.message ?? String(err)}`);
			}

			if (!response.ok) {
				const errText = await response.text();
				if (ctx.hasUI) ctx.ui.setWorkingIndicator();
				throw new Error(`[${model}] DashScope API error (${response.status}): ${errText}`);
			}

			const data: any = await response.json();
			const taskId = data?.output?.task_id;
			if (!taskId) {
				if (ctx.hasUI) ctx.ui.setWorkingIndicator();
				throw new Error(`Failed to retrieve task_id. Response: ${JSON.stringify(data)}`);
			}

			onUpdate?.({
				content: [{ type: "text", text: `Task ${taskId} submitted. Polling for completion…` }],
				details: { ...params, taskId, status: "Polling", progress: "Waiting for video generation..." },
			});

			const startBackgroundTask = async () => {
				const updateStatus = (text: string | undefined) => {
					if (ctx.hasUI) ctx.ui.setStatus(`cavallo_${taskId}`, text);
				};
				
				try {
					updateStatus(`Cavallo: Polling...`);
					let videoUrl: string | undefined;
					let taskMetrics: any = {};
					let lastReportedStatus = "";
					
					while (true) {
						await new Promise(r => setTimeout(r, 10000)); // Poll every 10s
						
						const pollRes = await fetch(`https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`, {
							headers: { "Authorization": `Bearer ${apiKey}` }
						});
						if (!pollRes.ok) {
							const errText = await pollRes.text();
							throw new Error(`[${model}] Polling error (${pollRes.status}): ${errText}`);
						}
						const pollData: any = await pollRes.json();
						const status = pollData?.output?.task_status;
						
						if (status === "SUCCEEDED") {
							videoUrl = pollData?.output?.video_url;
							if (pollData?.usage) taskMetrics = pollData.usage;
							break;
						} else if (status === "FAILED") {
							const code = pollData?.output?.code;
							const message = pollData?.output?.message;
							throw new Error(`[${model}] ${code} - ${message}`);
						}
						
						if (status && status !== lastReportedStatus) {
							lastReportedStatus = status;
							updateStatus(`Cavallo: ${status}...`);
							onUpdate?.({
								content: [{ type: "text", text: `Task ${taskId}: ${status}` }],
								details: { ...params, model, taskId, status, progress: `Generation ${status.toLowerCase()}...` },
							});
						}
					}

					if (!videoUrl) {
						throw new Error("Task succeeded but no video_url was returned.");
					}

					updateStatus(`Cavallo: Downloading...`);

					const outPath = await resolveOutputPath(cwd, params.prompt, params.outputPath);
					const videoRes = await fetch(videoUrl);
					if (!videoRes.ok) {
						throw new Error(`Download failed: ${videoRes.statusText}`);
					}
					
					const arrayBuf = await videoRes.arrayBuffer();
					await writeFile(outPath, Buffer.from(arrayBuf));

					let thumbData: string | undefined;
					try {
						const thumbPath = `${outPath}.thumb.jpg`;
						await execFileAsync("ffmpeg", ["-y", "-i", outPath, "-vframes", "1", "-f", "image2", "-vcodec", "mjpeg", thumbPath]);
						const thumbBuf = await readFile(thumbPath);
						thumbData = thumbBuf.toString("base64");
					} catch (err: any) {
						if (err?.code === "ENOENT" || err?.message?.includes("ENOENT")) {
							console.warn("[cavallo] ffmpeg not found. Install ffmpeg for video thumbnail previews.");
						}
					}

					updateStatus(undefined);

					pi.sendMessage({
						customType: "cavallo_result",
						display: true,
						content: [{ type: "text", text: `Video generated successfully: ${outPath}` }],
						details: {
							...params,
							model,
							taskId,
							status: "Done",
							videoUrl,
							outputPath: outPath,
							metrics: taskMetrics,
							thumbData
						}
					});
				} catch (err: any) {
					updateStatus(undefined);
					if (ctx.hasUI) {
						ctx.ui.notify(`Cavallo Background Task Failed: ${err.message}`, "error");
					}
				}
			};

			startBackgroundTask().catch(console.error);

			if (ctx.hasUI) ctx.ui.setWorkingIndicator(); // restore default

			return {
				content: [{ type: "text", text: `Task ${taskId} submitted and running in background.` }],
				details: { taskId, status: "Background" },
			};
		},

		renderResult(result, _options, theme) {
			const details = result.details as any;
			const container = new Container();

			if (details?.status === "Background") {
				container.addChild(
					new Text(theme.fg("muted", (result.content[0] as any)?.text || "Task running in background..."), 0, 0)
				);
				return container;
			}

			// Dead code path: execute() always returns Background status.
			// Completed results are rendered by the registered "cavallo_result" message renderer
			// via pi.sendMessage() in the background task.
			container.addChild(
				new Text(theme.fg("success", (result.content[0] as any)?.text || "Success!"), 0, 0)
			);
			return container;
		},
	});
}
