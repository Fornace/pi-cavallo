import { resolve, isAbsolute, extname } from "path";
import { existsSync } from "fs";
import { readFile, mkdir, writeFile } from "fs/promises";
import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Container, Text, Box, Spacer } from "@earendil-works/pi-tui";

const MODELS = [
	"happyhorse-1.0-t2v",
	"happyhorse-1.0-i2v",
	"happyhorse-1.0-r2v",
	"happyhorse-1.0-video-edit",
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
	// For DashScope, if it accepts Data URIs:
	const buf = await readFile(abs);
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
			"Use 'happyhorse-1.0-t2v' for Text-to-Video.",
			"Use 'happyhorse-1.0-i2v' for Image-to-Video. Pass an image path in `imagePath`.",
			"Use 'happyhorse-1.0-r2v' to generate video from up to 9 reference images. Pass paths in `referenceImages`.",
			"Use 'happyhorse-1.0-video-edit' to edit a video. Pass the input video in `videoPath` and reference images in `referenceImages` if needed.",
		],
		parameters: Type.Object({
			model: StringEnum(MODELS, {
				description: "The HappyHorse model to use.",
				default: "happyhorse-1.0-t2v",
			}),
			prompt: Type.Optional(Type.String({
				description: "Natural language instructions for generation or edit.",
			})),
			imagePath: Type.Optional(Type.String({
				description: "Path to input image for I2V model.",
			})),
			videoPath: Type.Optional(Type.String({
				description: "Path to input video for Video-Edit model.",
			})),
			referenceImages: Type.Optional(Type.Array(Type.String(), {
				description: "Paths to reference images for R2V or Video-Edit models.",
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
			
			onUpdate?.({
				content: [{ type: "text", text: `🎬 Submitting video generation task to ${model}…` }],
				details: { ...params, status: "Submitting" },
			});

			const inputPayload: any = {};
			if (params.prompt) inputPayload.prompt = params.prompt;
			
			if (params.imagePath) {
				inputPayload.image_url = await loadReferenceFile(cwd, params.imagePath);
			}
			if (params.videoPath) {
				inputPayload.video_url = await loadReferenceFile(cwd, params.videoPath);
			}
			if (params.referenceImages && params.referenceImages.length > 0) {
				inputPayload.reference_urls = await Promise.all(
					params.referenceImages.map((p: string) => loadReferenceFile(cwd, p))
				);
			}

			let response;
			try {
				response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis", {
					method: "POST",
					headers: {
						"Authorization": `Bearer ${apiKey}`,
						"X-DashScope-Async": "enable",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ model, input: inputPayload }),
					signal
				});
			} catch (err: any) {
				throw new Error(`DashScope API connection error: ${err?.message ?? String(err)}`);
			}

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`DashScope API error (${response.status}): ${errText}`);
			}

			const data: any = await response.json();
			const taskId = data?.output?.task_id;
			if (!taskId) {
				throw new Error(`Failed to retrieve task_id. Response: ${JSON.stringify(data)}`);
			}

			onUpdate?.({
				content: [{ type: "text", text: `⏳ Task ${taskId} submitted. Polling for completion…` }],
				details: { ...params, taskId, status: "Polling" },
			});

			// Polling
			let videoUrl: string | undefined;
			while (!signal?.aborted) {
				await new Promise(r => setTimeout(r, 5000));
				
				const pollRes = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
					headers: { "Authorization": `Bearer ${apiKey}` },
					signal
				});
				if (!pollRes.ok) {
					const errText = await pollRes.text();
					throw new Error(`DashScope Polling error (${pollRes.status}): ${errText}`);
				}
				const pollData: any = await pollRes.json();
				const status = pollData?.output?.task_status;
				
				if (status === "SUCCEEDED") {
					videoUrl = pollData?.output?.video_url;
					break;
				} else if (status === "FAILED") {
					const code = pollData?.output?.code;
					const message = pollData?.output?.message;
					throw new Error(`Task failed: ${code} - ${message}`);
				}
				
				onUpdate?.({
					content: [{ type: "text", text: `⏳ Task ${taskId} is ${status}…` }],
					details: { ...params, taskId, status },
				});
			}

			if (signal?.aborted) {
				return { content: [{ type: "text", text: "Cancelled." }], details: {} };
			}

			if (!videoUrl) {
				throw new Error("Task succeeded but no video_url was returned.");
			}

			onUpdate?.({
				content: [{ type: "text", text: `📥 Downloading video from ${videoUrl}…` }],
				details: { ...params, taskId, status: "Downloading" },
			});

			const outPath = await resolveOutputPath(cwd, params.prompt, params.outputPath);
			const videoRes = await fetch(videoUrl, { signal });
			if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.statusText}`);
			
			const arrayBuf = await videoRes.arrayBuffer();
			await writeFile(outPath, Buffer.from(arrayBuf));

			return {
				content: [
					{ type: "text", text: `✅ Video generated successfully: ${outPath}` },
				],
				details: {
					...params,
					taskId,
					status: "Done",
					videoUrl,
					outputPath: outPath,
				},
			};
		},

		renderResult(result, _options, theme) {
			const { details } = result;
			const container = new Container();

			container.addChild(
				new Text(theme.fg("success", (result.content[0] as any)?.text || "Success!"), 0, 0)
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
			} = details as any;

			container.addChild(new Spacer(1));

			const settingsBox = new Box(1, 1, (s) => theme.bg("customMessageBg", s));
			const settingsContainer = new Container();

			settingsContainer.addChild(
				new Text(theme.fg("accent", theme.bold("🎬 CAVALLO DETAILS")), 0, 0)
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
			if (outputPath) addSetting("Saved To", outputPath);
			if (videoUrl) addSetting("URL", videoUrl);

			settingsBox.addChild(settingsContainer);
			container.addChild(settingsBox);

			return container;
		},
	});
}
