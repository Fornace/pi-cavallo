// Stub-load cavallo: verify registration + pure logic without network.
import assert from "node:assert";
const registered = { tools: [], commands: [], renderers: [] };
const pi = {
	registerTool: (t) => registered.tools.push(t),
	registerCommand: (n, c) => registered.commands.push({ name: n, ...c }),
	registerMessageRenderer: (t) => registered.renderers.push(t),
	sendUserMessage: () => {},
};
const { default: ext } = await import("/Users/ffrappo/works/repos/pi-cavallo/extensions/index.ts");
ext(pi);
assert.equal(registered.tools.length, 1, "one tool registered");
assert.equal(registered.tools[0].name, "cavallo_video");
assert.ok(registered.commands.some(c => c.name === "cavallo-models"), "command registered");
assert.ok(registered.renderers.includes("cavallo_result"));
const schema = registered.tools[0].parameters;
assert.ok(!schema.properties.model.default ?? true, "model optional");
const enums = schema.properties.model.enum ?? schema.properties.model.anyOf;
assert.ok(enums.includes("happyhorse-1.1-t2v"), "1.1 in enum");
assert.ok(enums.includes("wan3.0-video-prime"), "wan3.0 prime in enum");
assert.ok(!enums.includes("nonexistent"), "no junk ids");
// pure logic
const { inferCapability, specFor, DEFAULT_MODELS } = await import("/Users/ffrappo/works/repos/pi-cavallo/extensions/models.ts");
assert.equal(inferCapability({ imagePath: "a.png" }), "i2v");
assert.equal(inferCapability({ videoPath: "a.mp4" }), "edit");
assert.equal(inferCapability({ referenceImages: ["a"] }), "r2v");
assert.equal(inferCapability({}), "t2v");
assert.equal(DEFAULT_MODELS.t2v, "happyhorse-1.1-t2v");
assert.equal(specFor("wan3.0-video").maxDuration, 30);
assert.equal(specFor("happyhorse-1.1-t2v").resolutions.includes("480P"), true);
console.log("CAVALLO LOAD TEST OK");
