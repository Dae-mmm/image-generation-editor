/**
 * Server-side fetch of Fal (and related) result images.
 * Used so the browser can export without a CORS-tainted canvas.
 */

const MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_HOSTS = new Set([
  "fal.media",
  "fal.ai",
  "storage.googleapis.com",
]);

const ALLOWED_HOST_SUFFIXES = [".fal.media", ".fal.ai"];

export function isAllowedFalImageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(String(raw || ""));
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (ALLOWED_HOSTS.has(host)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export async function fetchAllowedImage(url: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  if (!isAllowedFalImageUrl(url)) {
    const err = new Error("URL immagine non consentito") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const upstream = await fetch(url, { redirect: "follow" });
  if (!upstream.ok) {
    const err = new Error("Download immagine fallito") as Error & { status?: number };
    err.status = upstream.status;
    throw err;
  }

  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/") && contentType !== "application/octet-stream") {
    const err = new Error("Risposta non è un'immagine") as Error & { status?: number };
    err.status = 415;
    throw err;
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (buffer.length > MAX_BYTES) {
    const err = new Error("Immagine troppo grande") as Error & { status?: number };
    err.status = 413;
    throw err;
  }

  return { buffer, contentType };
}
