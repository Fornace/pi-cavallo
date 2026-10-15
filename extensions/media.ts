// Local reference-file loading shared by the DashScope and gateway flows:
// resolve a declared path against the session cwd, detect the MIME type from
// the extension, and return a base64 data: URI.
import { resolve, isAbsolute, extname } from "path";
import { existsSync } from "fs";
import { readFile } from "fs/promises";

const SUPPORTED_INPUT_MIME = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/heic",
	"image/heif",
	"video/mp4",
	"video/webm",
]);

function mimeFromExt(path: string): string {
	const ext = extname(path).toLowerCase();
	switch (ext) {
		case ".png": return "image/png";
		case ".jpg":
		case ".jpeg": return "image/jpeg";
		case ".webp": return "image/webp";
		case ".heic": return "image/heic";
		case ".heif": return "image/heif";
		case ".mp4": return "video/mp4";
		case ".webm": return "video/webm";
		default: return "image/png";
	}
}

/** Load a local reference file as a data: URI. Public URLs are not handled here. */
export async function loadReferenceFile(cwd: string, pathArg: string): Promise<string> {
	const cleaned = pathArg.replace(/^@/, "");
	const abs = isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned);
	if (!existsSync(abs)) throw new Error(`Reference file not found: ${abs}`);
	const mimeType = mimeFromExt(abs);
	if (!SUPPORTED_INPUT_MIME.has(mimeType)) throw new Error(`Unsupported reference file type: ${mimeType}.`);
	const buf = await readFile(abs);
	const sizeMB = buf.length / (1024 * 1024);
	if (sizeMB > 50) {
		console.warn(`[cavallo] Warning: ${abs} is ${sizeMB.toFixed(1)}MB. Large files are Base64-encoded into memory (~${(sizeMB * 1.33).toFixed(0)}MB). Consider using a public URL instead.`);
	}
	return `data:${mimeType};base64,${buf.toString("base64")}`;
}
