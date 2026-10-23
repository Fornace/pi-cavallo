// Stub-load cavallo: verify registration + pure logic without network.
import assert from "node:assert";
const registered = { tools: [], commands: [], renderers: [], entries: [], userMessages: [] };
const pi = {
	on: () => {},
	registerTool: (t) => registered.tools.push(t),
	registerCommand: (n, c) => registered.commands.push({ name: n, ...c }),
	registerMessageRenderer: (t) => registered.renderers.push(t),
	registerEntryRenderer: () => {},
	appendEntry: (type, data) => registered.entries.push({ type, data }),
	sendUserMessage: (msg) => registered.userMessages.push(msg),
};
const { default: ext } = await import("../extensions/index.ts");
ext(pi);
assert.equal(registered.tools.length, 2, "cavallo_video + cavallo_configure registered");
const names = registered.tools.map((t) => t.name);
assert.ok(names.includes("cavallo_video") && names.includes("cavallo_configure"), "tool names");
assert.ok(names.includes("cavallo_video"), "cavallo_video present");
const video = registered.tools.find((t) => t.name === "cavallo_video");
assert.ok(registered.commands.some(c => c.name === "cavallo-models"), "command registered");
assert.ok(registered.renderers.includes("cavallo_result"));
const schema = video.parameters;
assert.ok(!schema.properties.model.default ?? true, "model optional");
const enums = schema.properties.model.enum ?? schema.properties.model.anyOf;
assert.ok(enums.includes("happyhorse-1.1-t2v"), "1.1 in enum");
assert.ok(enums.includes("wan3.0-video-prime"), "wan3.0 prime in enum");
assert.ok(!enums.includes("nonexistent"), "no junk ids");
// pure logic
const { inferCapability, specFor, DEFAULT_MODELS } = await import("../extensions/models.ts");
assert.equal(inferCapability({ imagePath: "a.png" }), "i2v");
assert.equal(inferCapability({ videoPath: "a.mp4" }), "edit");
assert.equal(inferCapability({ referenceImages: ["a"] }), "r2v");
assert.equal(inferCapability({}), "t2v");
assert.equal(DEFAULT_MODELS.t2v, "happyhorse-1.1-t2v");
assert.equal(specFor("wan3.0-video").maxDuration, 30);
assert.equal(specFor("happyhorse-1.1-t2v").resolutions.includes("480P"), true);
// /cavallo-models displays via UI without triggering a paid model turn
const modelsCmd = registered.commands.find(c => c.name === "cavallo-models");
await modelsCmd.handler("", { hasUI: true, mode: "tui", ui: { notify: () => {} } });
await modelsCmd.handler("bad-arg", { hasUI: true, mode: "tui", ui: { notify: () => {} } });
await modelsCmd.handler("t2v=happyhorse-1.1-i2v", { hasUI: true, mode: "tui", ui: { notify: () => {} } });
assert.equal(registered.userMessages.length, 0, "/cavallo-models must never inject a paid user turn");
assert.equal(registered.entries.length, 3, "/cavallo-models emits UI notifications");
console.log("CAVALLO LOAD TEST OK");
