import { fal } from "@fal-ai/client";

fal.config({
  proxyUrl: "/api/fal/proxy",
});

export const FAL_WORKFLOW = "workflows/dmammolidesign/imagemakerpsc";

async function srcToFile(src: string, filename = "photo.jpg"): Promise<File> {
  if (src.startsWith("data:")) {
    const res = await fetch(src);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || "image/jpeg" });
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Impossibile leggere la foto (${res.status})`);
  const blob = await res.blob();
  const ext = blob.type.includes("png") ? "png" : "jpg";
  return new File([blob], filename.replace(/\.\w+$/, `.${ext}`), {
    type: blob.type || "image/jpeg",
  });
}

function extractImageUrl(data: unknown): string | null {
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

  // Workflow wrappers
  if (d.output) return extractImageUrl(d.output);
  if (d.data) return extractImageUrl(d.data);

  // Deep-ish scan for first http(s) url string under common keys
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

export function formatFalError(err: unknown): string {
  if (!err) return "Errore sconosciuto";
  if (typeof err === "string") return err;
  const e = err as {
    message?: string;
    status?: number;
    body?: any;
  };
  const body = e.body;
  const digDetail = (detail: unknown): string | null => {
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0]) {
      const d0 = detail[0] as { msg?: string };
      if (d0.msg) return String(d0.msg);
    }
    return null;
  };
  if (body?.error?.body) {
    const nested = digDetail(body.error.body.detail) || body.error.body.message;
    if (nested) return nested;
  }
  if (typeof body?.error === "string") return body.error;
  if (body?.error?.message) return body.error.message;
  if (body?.message && body.message !== "Internal Server Error") return body.message;
  const fromDetail = digDetail(body?.detail);
  if (fromDetail) return fromDetail;
  if (e.message && e.message !== "Internal Server Error") return e.message;
  if (e.status) return `Errore Fal HTTP ${e.status}`;
  if (body) {
    try {
      const s = JSON.stringify(body);
      if (s && s !== "{}") return s.slice(0, 400);
    } catch { /* ignore */ }
  }
  return e.message || "Errore durante la generazione";
}

/** Upload photo + run Fal workflow. Returns result image URL. */
export async function generateFromPhoto(
  imageSrc: string,
  prompt: string,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Upload foto…");
  const file = await srcToFile(imageSrc);
  const uploaded = await fal.storage.upload(file);

  onStatus?.("In coda Fal…");
  // Queue subscribe is more reliable through our Vite/Vercel proxy than fal.stream (SSE).
  // Same workflow + same input schema as the Fal API snippet (image_urls + prompt).
  const result = await fal.subscribe(FAL_WORKFLOW, {
    input: {
      image_urls: [uploaded],
      prompt: prompt.trim(),
    },
    logs: true,
    onQueueUpdate: (update) => {
      onStatus?.(update.status || "IN_QUEUE");
    },
  });

  const url =
    extractImageUrl(result.data) ||
    extractImageUrl(result) ||
    extractImageUrl((result as { output?: unknown }).output);

  if (!url) {
    console.error("[fal] unexpected result shape", result);
    throw new Error("Il workflow non ha restituito un'immagine (formato output sconosciuto)");
  }
  return url;
}

export async function downloadImageUrl(url: string, filename = "generata.jpg") {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Download fallito");
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}
