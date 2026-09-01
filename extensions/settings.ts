// Cavallo settings: per-capability default-model overrides stored in pi's
// settings.json under the "cavallo" key. Overrides win over the built-in
// DEFAULT_MODELS; the per-call `model` parameter wins over everything.
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { type Capability, DEFAULT_MODELS, specFor } from "./models.ts";

export interface CavalloSettings {
	defaults?: Partial<Record<Capability, string>>;
}

function settingsPath(): string {
	return resolve(homedir(), CONFIG_DIR_NAME || ".pi", "agent", "settings.json");
}

export function loadCavalloSettings(): CavalloSettings {
	try {
		const raw = JSON.parse(readFileSync(settingsPath(), "utf8"));
		return raw?.cavallo ?? {};
	} catch {
		return {};
	}
}

/** Persist a default-model override for one capability into settings.json. */
export async function saveDefaultModel(capability: Capability, model: string): Promise<void> {
	const { readFileSync: read, writeFileSync: write, mkdirSync } = await import("fs");
	const p = settingsPath();
	let raw: any = {};
	try { raw = JSON.parse(read(p, "utf8")); } catch { /* new file */ }
	raw.cavallo = raw.cavallo ?? {};
	raw.cavallo.defaults = { ...(raw.cavallo.defaults ?? {}), [capability]: model };
	mkdirSync(resolve(p, ".."), { recursive: true });
	write(p, JSON.stringify(raw, null, 2));
}

/** Resolve the effective default model for a capability:
 * settings override first, then the built-in default. */
export function resolveDefaultModel(capability: Capability): { model: string; source: "settings" | "builtin" } {
	const override = loadCavalloSettings().defaults?.[capability];
	if (override && specFor(override)) {
		return { model: override, source: "settings" };
	}
	return { model: DEFAULT_MODELS[capability], source: "builtin" };
}
