// Download one immutable video. Interrupted GETs resume with a strong ETag;
// generation is never repeated, and partial files never become success outputs.
import { open, link, unlink } from "node:fs/promises";

const LIMIT = 512 * 1024 * 1024;
const IDLE_MS = 120_000;
const RECOVERIES = 3;

class Interrupted extends Error {}

function transportFailure(error: unknown): boolean {
 if (error instanceof Interrupted) return true;
 if (!(error instanceof TypeError)) return false;
 const code = (error.cause as { code?: string } | undefined)?.code;
 return ["ECONNRESET", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_BODY_TIMEOUT"].includes(code ?? "");
}

function length(value: string | null): number | undefined {
 if (value === null) return undefined;
 const size = Number(value);
 if (!Number.isSafeInteger(size) || size < 1 || size > LIMIT) {
  throw new Error("Video download content length exceeds 512MiB bound or is invalid");
 }
 return size;
}

export async function downloadVideo(url: string, outPath: string, signal?: AbortSignal): Promise<void> {
 const stage = `${outPath}.partial`;
 const output = await open(stage, "wx", 0o600);
 let total = 0;
 let expected: number | undefined;
 let etag: string | undefined;
 let failures = 0;
 try {
  while (true) {
   signal?.throwIfAborted();
   const idle = new AbortController();
   const bounded = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;
   // Progress refreshes the timeout. A slow but active transfer must finish.
   const watchdog = setTimeout(() => idle.abort(new Interrupted("Video download stalled for 120 seconds")), IDLE_MS);
   watchdog.unref();
   try {
    const headers: Record<string, string> = {};
    if (total) {
     if (!etag || expected === undefined) throw new Error("Video resume requires its original strong ETag and length");
     headers.Range = `bytes=${total}-`;
     headers["If-Range"] = etag;
    }
    const res = await fetch(url, { headers, signal: bounded });
    watchdog.refresh();
    if (!res.body) throw new Error("Video download has no body");
    try {
     if (!total) {
      if (res.status !== 200) throw new Error(`Video download failed (${res.status}): ${res.statusText}`);
      expected = length(res.headers.get("content-length"));
      const validator = res.headers.get("etag");
      etag = validator && !validator.startsWith("W/") ? validator : undefined;
     } else {
      const range = res.headers.get("content-range");
      const wanted = `bytes ${total}-${expected! - 1}/${expected}`;
      if (res.status !== 206 || range !== wanted || res.headers.get("etag") !== etag
       || length(res.headers.get("content-length")) !== expected! - total) {
       throw new Error("Video resume response changed identity or byte range; partial retained");
      }
     }
    } catch (error) {
     await res.body.cancel();
     throw error;
    }
    for await (const chunk of res.body) {
     bounded.throwIfAborted();
     if (chunk.length) watchdog.refresh();
     total += chunk.length;
     if (total > LIMIT || (expected !== undefined && total > expected)) {
      throw new Error("Video download exceeded its declared size or 512MiB bound");
     }
     await output.writeFile(chunk);
    }
    if (!total) throw new Error("Video download returned no bytes");
    if (expected !== undefined && total !== expected) throw new Interrupted("Video download ended before its declared size");
    break;
   } catch (error) {
    signal?.throwIfAborted();
    const cause = idle.signal.aborted ? idle.signal.reason : error;
    if (!transportFailure(cause) || !total || expected === undefined || !etag || failures >= RECOVERIES) throw cause;
    failures += 1;
    await output.sync();
    console.error(`Video transfer interrupted at ${total}/${expected} bytes: ${cause instanceof Error ? cause.message : String(cause)}. Resuming this file (${failures}/${RECOVERIES}); no generation submitted.`);
   } finally {
    clearTimeout(watchdog);
   }
  }
  await output.sync();
 } catch (error) {
  throw new Error(`Video download failed; partial retained at ${stage}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
 } finally {
  await output.close();
 }
 await link(stage, outPath); // Exclusive publication, never overwrite another output.
 await unlink(stage);
}
