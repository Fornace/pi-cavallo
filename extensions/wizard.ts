// /cavallo-setup: interactive video provider wizard.
// Probes an OpenAI-compatible gateway for video support and persists the
// chosen route to settings.json under the "cavallo" key.
import { writeFileSync, readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { classifyModels } from "./probe.ts";

const SETTINGS_PATH = resolve(homedir(), ".pi", "agent", "settings.json");

function persistCavalloConfig(cfg: Record<string, unknown>): void {
	let raw: Record<string, unknown> = {};
	try { raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")); } catch { /* new file */ }
	raw.cavallo = cfg;
	writeFileSync(SETTINGS_PATH, JSON.stringify(raw, null, 2));
}

export interface ConfigureOptions {
	baseUrl: string;
	apiKey?: string;
	model?: string;
}

/** Non-interactive video route configuration. Used by cavallo_configure and
 * the wizard. Returns a human-readable report. */
export async function configureCavalloProvider(ctx: any, opts: ConfigureOptions): Promise<string> {
	const baseUrl = opts.baseUrl.replace(/\/+$/, "");
	let apiKey = opts.apiKey;
	if (!apiKey && ctx?.modelRegistry) {
		for (const p of ["mantice", "alibaba-cloud"]) {
			try {
				apiKey = await ctx.modelRegistry.getApiKeyForProvider(p);
				if (apiKey) break;
			} catch { /* next */ }
		}
	}
	if (!apiKey) apiKey = process.env.MANTICE_API_KEY;
	if (!apiKey) throw new Error("No API key found: pass apiKey, log in via /login, or set MANTICE_API_KEY.");

	const res = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
	if (!res.ok) throw new Error(`GET ${baseUrl}/models failed (${res.status})`);
	const data: any = await res.json();
	const ids: string[] = (data?.data ?? []).map((m: any) => m.id).filter(Boolean);
	const { videoModels } = classifyModels(ids);

	let videoEndpoint = false;
	try {
		const probe = await fetch(`${baseUrl}/videos/generations`, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
			body: JSON.stringify({ model: "__cavallo_probe__", prompt: "probe" }),
		});
		videoEndpoint = probe.status !== 404;
	} catch { videoEndpoint = false; }
	if (!videoEndpoint) throw new Error("Endpoint has no /videos/generations support. Nothing was saved.");

	const model = opts.model ?? videoModels[0] ?? "fornace-video";
	persistCavalloConfig({ baseUrl, apiKey, model });
	return [
		`Configured cavallo on ${baseUrl}:`,
		`  video model/group = ${model}`,
		videoModels.length ? `  other video models: ${videoModels.join(", ")}` : "",
		"cavallo_video text-to-video now uses this provider (i2v/r2v/edit stay on DashScope).",
	].filter(Boolean).join("\n");
}

export async function runCavalloSetup(ctx: any): Promise<void> {
	const ui = ctx.ui;
	ui.notify("Cavallo setup: configure an OpenAI-compatible video provider (mantice works).", "info");

	let preKey: string | undefined;
	for (const p of ["mantice", "alibaba-cloud"]) {
		try {
			preKey = await ctx.modelRegistry?.getApiKeyForProvider(p);
			if (preKey) break;
		} catch { /* next */ }
	}
	const baseUrl = (await ui.input("Provider base URL (OpenAI-compatible)", "https://llm.fornace.net/v1"))?.trim();
	if (!baseUrl) return;
	const apiKey = (await ui.input("API key", preKey ?? "sk-..."))?.trim();
	if (!apiKey) return;

	ui.notify("Probing capabilities…", "info");
	let models: string[] = [];
	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) throw new Error(`GET /models failed (${res.status})`);
		const data: any = await res.json();
		models = (data?.data ?? []).map((m: any) => m.id).filter(Boolean);
	} catch (err: any) {
		ui.notify(`Probe failed: ${err.message}`, "error");
		return;
	}
	const { videoModels } = classifyModels(models);

	// Endpoint check: 404 means unsupported; anything else means it exists.
	let videoEndpoint = false;
	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/videos/generations`, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
			body: JSON.stringify({ model: "__cavallo_probe__", prompt: "probe" }),
		});
		videoEndpoint = res.status !== 404;
	} catch { videoEndpoint = false; }

	ui.notify(
		[
			`Models: ${models.length} total`,
			`Video models: ${videoModels.join(", ") || "none detected"}`,
			`Video endpoint: ${videoEndpoint ? "✓" : "✗"}`,
		].join("\n"),
		"info",
	);

	if (!videoEndpoint) {
		ui.notify("This gateway has no /videos/generations endpoint. Setup aborted; DashScope stays the default.", "error");
		return;
	}

	const suggested = videoModels[0] ?? "fornace-video";
	const model = (await ui.select("Video model/group to use", [suggested, ...videoModels.filter((m) => m !== suggested), "fornace-video"]))
		?? suggested;

	persistCavalloConfig({ baseUrl, apiKey, model });
	ui.notify(
		`Saved. cavallo_video now submits to ${baseUrl} with model "${model}". ` +
			"Run /cavallo-setup again to change, or delete \"cavallo\" from settings.json to return to DashScope.",
		"info",
	);
}
