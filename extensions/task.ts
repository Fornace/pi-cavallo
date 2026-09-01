// DashScope async video-synthesis API: submit, poll, download.
// Shared by every model in the catalog (HappyHorse + Wan families).
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile } from "fs/promises";

const execFileAsync = promisify(execFile);

const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com/api/v1";

export interface SubmitInput {
	model: string;
	apiKey: string;
	inputPayload: Record<string, unknown>;
	parametersPayload: Record<string, unknown>;
	signal?: AbortSignal;
}

export async function submitTask(input: SubmitInput): Promise<string> {
	const res = await fetch(`${DASHSCOPE_BASE}/services/aigc/video-generation/video-synthesis`, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${input.apiKey}`,
			"X-DashScope-Async": "enable",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: input.model,
			input: input.inputPayload,
			parameters: input.parametersPayload,
		}),
		signal: input.signal,
	});
	if (!res.ok) {
		throw new Error(`[${input.model}] DashScope API error (${res.status}): ${await res.text()}`);
	}
	const data: any = await res.json();
	const taskId = data?.output?.task_id;
	if (!taskId) {
		throw new Error(`Failed to retrieve task_id. Response: ${JSON.stringify(data)}`);
	}
	return taskId;
}

export interface PollResult {
	videoUrl: string;
	usage: Record<string, unknown>;
}

export async function pollUntilDone(model: string, apiKey: string, taskId: string, onStatus: (text: string) => void): Promise<PollResult> {
	let lastReported = "";
	while (true) {
		await new Promise((r) => setTimeout(r, 10_000));
		const res = await fetch(`${DASHSCOPE_BASE}/tasks/${taskId}`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) {
			throw new Error(`[${model}] Polling error (${res.status}): ${await res.text()}`);
		}
		const data: any = await res.json();
		const status = data?.output?.task_status;
		if (status === "SUCCEEDED") {
			const videoUrl = data?.output?.video_url;
			if (!videoUrl) throw new Error("Task succeeded but no video_url was returned.");
			return { videoUrl, usage: data?.usage ?? {} };
		}
		if (status === "FAILED") {
			throw new Error(`[${model}] ${data?.output?.code} - ${data?.output?.message}`);
		}
		if (status && status !== lastReported) {
			lastReported = status;
			onStatus(status);
		}
	}
}

export async function downloadVideo(url: string, outPath: string): Promise<void> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);
	await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

/** Best-effort 160px JPEG thumbnail via ffmpeg; returns undefined without it. */
export async function makeThumbnail(outPath: string): Promise<string | undefined> {
	try {
		const thumbPath = `${outPath}.thumb.jpg`;
		await execFileAsync("ffmpeg", ["-y", "-i", outPath, "-vframes", "1", "-vf", "scale=160:-1", "-f", "image2", "-vcodec", "mjpeg", "-q:v", "3", thumbPath]);
		return (await readFile(thumbPath)).toString("base64");
	} catch (err: any) {
		if (err?.code === "ENOENT" || err?.message?.includes("ENOENT")) {
			console.warn("[cavallo] ffmpeg not found. Install ffmpeg for video thumbnail previews.");
		}
		return undefined;
	}
}
