// DashScope async video-synthesis API: submit, poll, download.
// Shared by every model in the catalog (HappyHorse + Wan families).
import { open, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

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

export async function pollUntilDone(model: string, apiKey: string, taskId: string, onStatus: (text: string) => void, signal?: AbortSignal): Promise<PollResult> {
 const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(8 * 60_000)]) : AbortSignal.timeout(8 * 60_000);
	let lastReported = "";
	while (true) {
		await delay(10_000, undefined, { signal: bounded });
		const res = await fetch(`${DASHSCOPE_BASE}/tasks/${taskId}`, {
			headers: { Authorization: `Bearer ${apiKey}` },
   signal: bounded,
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

export async function downloadVideo(url: string, outPath: string, signal?: AbortSignal): Promise<void> {
 const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
 const limit = 512 * 1024 * 1024;
 const res = await fetch(url, { signal: bounded });
 if (!res.ok) throw new Error(`Download failed (${res.status}): ${res.statusText}`);
 if (!res.body) throw new Error("Video download has no body");
 const declared = res.headers.get("content-length");
 if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) < 1 || Number(declared) > limit)) {
  await res.body.cancel();
  throw new Error("Video download content length exceeds 512MiB bound or is invalid");
 }
 const stage = `${outPath}.partial`;
 let output;
 try { output = await open(stage, "wx", 0o600); }
 catch (error) { await res.body.cancel(); throw error; }
 let total = 0;
 try {
  for await (const chunk of res.body) {
   bounded.throwIfAborted();
   total += chunk.length;
   if (total > limit) throw new Error("Video download exceeded 512MiB bound");
   await output.writeFile(chunk);
  }
  if (!total || (declared !== null && total !== Number(declared))) throw new Error("Video download size does not match declared content length");
  await output.sync();
 } catch (error) {
  await output.close();
  // Retain the owned partial as failed custody, never present it as a completed video.
  throw new Error(`Video download failed; partial retained at ${stage}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
 }
 await output.close();
 const { link } = await import("node:fs/promises");
 await link(stage, outPath); // Exclusive publication, never overwrite another output.
 await unlink(stage);
}
