// Model classification helpers shared by the cavallo wizard.
const VIDEO_RE = /video|sora|veo|wan|seedance|kling|hailuo|minimax-h|happyhorse/i;

export function classifyModels(ids: string[]): { videoModels: string[] } {
	return { videoModels: ids.filter((m) => VIDEO_RE.test(m)) };
}
