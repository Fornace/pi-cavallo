// Cavallo model catalog. Every entry mirrors Alibaba Model Studio's
// published specs (help.aliyun.com/en/model-studio/video-generate-edit-model,
// verified 2026-09-01). Payload shapes are the DashScope video-synthesis
// API shared by the HappyHorse and Wan families.

export type Capability = "t2v" | "i2v" | "r2v" | "edit";

export interface ModelSpec {
	id: string;
	capabilities: Capability[];
	minDuration: number;
	maxDuration: number;
	resolutions: string[];
	/** Model generates native audio and accepts an audio reference. */
	audio: boolean;
	notes?: string;
}

export const MODEL_SPECS: ModelSpec[] = [
	{
		id: "happyhorse-1.1-t2v",
		capabilities: ["t2v"],
		minDuration: 3, maxDuration: 15,
		resolutions: ["480P", "720P", "1080P"],
		audio: true,
		notes: "Recommended t2v: native audio, up to 1080P.",
	},
	{
		id: "happyhorse-1.1-i2v",
		capabilities: ["i2v"],
		minDuration: 3, maxDuration: 15,
		resolutions: ["480P", "720P", "1080P"],
		audio: true,
		notes: "Recommended first-frame i2v.",
	},
	{
		id: "happyhorse-1.1-r2v",
		capabilities: ["r2v"],
		minDuration: 3, maxDuration: 15,
		resolutions: ["480P", "720P", "1080P"],
		audio: true,
		notes: "Recommended r2v: character consistency across scenes.",
	},
	{
		id: "happyhorse-1.0-t2v",
		capabilities: ["t2v"],
		minDuration: 3, maxDuration: 15,
		resolutions: ["720P", "1080P"],
		audio: true,
	},
	{
		id: "happyhorse-1.0-i2v",
		capabilities: ["i2v"],
		minDuration: 3, maxDuration: 15,
		resolutions: ["720P", "1080P"],
		audio: true,
	},
	{
		id: "happyhorse-1.0-r2v",
		capabilities: ["r2v"],
		minDuration: 3, maxDuration: 15,
		resolutions: ["720P", "1080P"],
		audio: true,
	},
	{
		id: "happyhorse-1.0-video-edit",
		capabilities: ["edit"],
		minDuration: 3, maxDuration: 15,
		resolutions: ["720P", "1080P"],
		audio: false,
	},
	{
		id: "wan3.0-video",
		capabilities: ["t2v", "i2v", "r2v", "edit"],
		minDuration: 2, maxDuration: 30,
		resolutions: ["480P", "720P", "1080P"],
		audio: true,
		notes: "All-in-one: reference, edit, first/last-frame stitching, up to 30s, parses files and web links as references.",
	},
	{
		id: "wan3.0-video-prime",
		capabilities: ["t2v", "i2v", "r2v", "edit"],
		minDuration: 2, maxDuration: 30,
		resolutions: ["480P", "720P", "1080P"],
		audio: true,
		notes: "Speed-optimized wan3.0-video.",
	},
	{
		id: "wan2.7-t2v",
		capabilities: ["t2v"],
		minDuration: 2, maxDuration: 15,
		resolutions: ["480P", "720P", "1080P"],
		audio: true,
	},
	{
		id: "wan2.7-i2v-2026-04-25",
		capabilities: ["i2v"],
		minDuration: 2, maxDuration: 15,
		resolutions: ["480P", "720P", "1080P"],
		audio: true,
	},
	{
		id: "wan2.7-r2v",
		capabilities: ["r2v"],
		minDuration: 2, maxDuration: 15,
		resolutions: ["480P", "720P", "1080P"],
		audio: true,
	},
	{
		id: "wan2.7-videoedit",
		capabilities: ["edit"],
		minDuration: 2, maxDuration: 15,
		resolutions: ["720P", "1080P"],
		audio: false,
	},
];

export const MODEL_IDS = MODEL_SPECS.map((m) => m.id);

/** Auto-picked default per capability, in priority order. */
export const DEFAULT_MODELS: Record<Capability, string> = {
	t2v: "happyhorse-1.1-t2v",
	i2v: "happyhorse-1.1-i2v",
	r2v: "happyhorse-1.1-r2v",
	edit: "happyhorse-1.0-video-edit",
};

export function specFor(id: string): ModelSpec | undefined {
	return MODEL_SPECS.find((m) => m.id === id);
}

/** Infer the capability to default to from the parameters the caller supplied. */
export function inferCapability(params: {
	imagePath?: string;
	firstClipPath?: string;
	videoPath?: string;
	referenceImages?: string[];
}): Capability {
	if (params.videoPath) return "edit";
	if (params.imagePath || params.firstClipPath) return "i2v";
	if (params.referenceImages && params.referenceImages.length > 0) return "r2v";
	return "t2v";
}

/** First catalog model that serves the capability and accepts the constraint. */
export function supports(spec: ModelSpec, capability: Capability): boolean {
	return spec.capabilities.includes(capability);
}
