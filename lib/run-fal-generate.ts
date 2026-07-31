/**
 * Server-side Fal workflow runner (uses FAL_KEY from env, no browser proxy).
 */
import { fal } from "@fal-ai/client";

export const FAL_WORKFLOW = "workflows/dmammolidesign/imagemakerpsc";

function ensureFalConfigured() {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY missing on server — set it in Vercel Environment Variables");
  }
  fal.config({ credentials: key });
}

export function extractImageUrl(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === "string" && /^https?:\/\//.test(data)) return data;
  if (typeof data !== "object") return null;

  const d = data as Record<string, unknown>;
  const fromList = (list: unknown): string | null => {
    if (!Array.isArray(list) || !list[0]) return null;
    const first = list[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      const o = first as Record<string, unknown>;
      if (typeof o.url === "string") return o.url;
      if (typeof o.image_url === "string") return o.image_url;
    }
    return null;
  };

  const direct =
    fromList(d.images) ||
    fromList(d.image_urls) ||
    (typeof d.image === "string" ? d.image : null) ||
    (d.image && typeof d.image === "object" && typeof (d.image as { url?: string }).url === "string"
      ? (d.image as { url: string }).url
      : null) ||
    (typeof d.url === "string" ? d.url : null) ||
    (typeof d.image_url === "string" ? d.image_url : null);

  if (direct) return direct;
  if (d.output) return extractImageUrl(d.output);
  if (d.data) return extractImageUrl(d.data);

  for (const v of Object.values(d)) {
    if (typeof v === "string" && /^https?:\/\//.test(v) && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(v)) {
      return v;
    }
    if (v && typeof v === "object") {
      const nested = extractImageUrl(v);
      if (nested) return nested;
    }
  }
  return null;
}

function dataUrlToFile(dataUrl: string): File {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error("imageDataUrl non valida");
  const contentType = m[1] || "image/jpeg";
  const buf = Buffer.from(m[2], "base64");
  const ext = contentType.includes("png") ? "png" : "jpg";
  return new File([new Uint8Array(buf)], `photo.${ext}`, { type: contentType });
}

export async function runFalGenerate(opts: {
  imageDataUrl?: string;
  imageUrl?: string;
  prompt: string;
}): Promise<string> {
  ensureFalConfigured();

  let image_url = opts.imageUrl?.trim() || "";
  if (!image_url) {
    if (!opts.imageDataUrl) throw new Error("Serve imageDataUrl o imageUrl");
    const file = dataUrlToFile(opts.imageDataUrl);
    image_url = await fal.storage.upload(file);
  }

  const result = await fal.subscribe(FAL_WORKFLOW, {
    input: {
      image_urls: [image_url],
      prompt: (opts.prompt || "").trim(),
    },
    logs: true,
  });

  const url =
    extractImageUrl(result.data) ||
    extractImageUrl(result) ||
    extractImageUrl((result as { output?: unknown }).output);

  if (!url) {
    console.error("[fal] unexpected result", JSON.stringify(result).slice(0, 2000));
    throw new Error("Il workflow non ha restituito un'immagine");
  }
  return url;
}

export function formatServerFalError(err: unknown): { message: string; status: number; body?: unknown } {
  const e = err as { message?: string; status?: number; body?: any };
  const dig = (detail: unknown): string | null => {
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
    return null;
  };
  const body = e?.body;
  const message =
    dig(body?.error?.body?.detail) ||
    body?.error?.body?.message ||
    body?.error?.message ||
    (typeof body?.error === "string" ? body.error : null) ||
    dig(body?.detail) ||
    body?.message ||
    e?.message ||
    "Errore Fal";
  return { message, status: e?.status && e.status >= 400 ? e.status : 500, body };
}
