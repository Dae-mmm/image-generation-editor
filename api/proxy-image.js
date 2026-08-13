/**
 * GET /api/proxy-image?url=...
 * Fetches a Fal result image server-side so the browser can convert it
 * to a same-origin data URL (canvas export is blocked by CORS otherwise).
 */

const MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_HOSTS = new Set([
  "fal.media",
  "fal.ai",
  "storage.googleapis.com",
]);

const ALLOWED_HOST_SUFFIXES = [".fal.media", ".fal.ai"];

function isAllowedFalImageUrl(raw) {
  let u;
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const url = typeof req.query?.url === "string" ? req.query.url : "";
  if (!isAllowedFalImageUrl(url)) {
    res.status(400).json({ message: "URL immagine non consentito" });
    return;
  }

  try {
    const upstream = await fetch(url, { redirect: "follow" });
    if (!upstream.ok) {
      res.status(upstream.status >= 400 ? upstream.status : 502).json({
        message: "Download immagine fallito",
      });
      return;
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/") && contentType !== "application/octet-stream") {
      res.status(415).json({ message: "Risposta non è un'immagine" });
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      res.status(413).json({ message: "Immagine troppo grande" });
      return;
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.status(200).send(buffer);
  } catch (err) {
    console.error("[api/proxy-image]", err);
    res.status(502).json({
      message: (err && err.message) || "Proxy immagine fallito",
    });
  }
}
