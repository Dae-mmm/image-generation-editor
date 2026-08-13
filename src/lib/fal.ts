/**
 * Browser client: ONE request to /api/generate.
 * Avoids fal.queue polling through a proxy (dozens of Vercel invocations).
 */

export function formatFalError(err: unknown): string {
  if (!err) return "Errore sconosciuto";
  if (typeof err === "string") return err;
  const e = err as { message?: string; status?: number; body?: any };
  const body = e.body;
  const digDetail = (detail: unknown): string | null => {
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && (detail[0] as { msg?: string })?.msg) {
      return String((detail[0] as { msg: string }).msg);
    }
    return null;
  };
  if (body?.error?.body) {
    const nested = digDetail(body.error.body.detail) || body.error.body.message;
    if (nested) return nested;
  }
  if (typeof body?.error === "string") return body.error;
  if (body?.error?.message) return body.error.message;
  if (body?.message) return body.message;
  const fromDetail = digDetail(body?.detail);
  if (fromDetail) return fromDetail;
  if (e.message) return e.message;
  if (e.status) return `Errore HTTP ${e.status}`;
  try {
    return JSON.stringify(err).slice(0, 400);
  } catch {
    return "Errore durante la generazione";
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lettura immagine fallita"));
    reader.readAsDataURL(blob);
  });
}

function isRemoteHttpUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

const exportableCache = new Map<string, Promise<string>>();

async function fetchRemoteAsDataUrl(url: string): Promise<string> {
  const tryFetch = async (target: string) => {
    const res = await fetch(target);
    if (!res.ok) throw new Error("Download fallito");
    const blob = await res.blob();
    if (blob.type && !blob.type.startsWith("image/") && blob.type !== "application/octet-stream") {
      throw new Error("Risposta non è un'immagine");
    }
    return blobToDataUrl(blob);
  };

  try {
    return await tryFetch(url);
  } catch (directErr) {
    try {
      return await tryFetch(`/api/proxy-image?url=${encodeURIComponent(url)}`);
    } catch {
      throw directErr instanceof Error ? directErr : new Error("Download fallito");
    }
  }
}

/**
 * Remote Fal URLs display in <img> but taint the canvas (CORS), so JPEG/ZIP
 * export fails. Convert them to same-origin data URLs like user uploads.
 */
export function toExportableSrc(src: string): Promise<string> {
  if (!src || !isRemoteHttpUrl(src)) return Promise.resolve(src);
  let pending = exportableCache.get(src);
  if (!pending) {
    pending = fetchRemoteAsDataUrl(src).catch((err) => {
      exportableCache.delete(src);
      throw err;
    });
    exportableCache.set(src, pending);
  }
  return pending;
}

/** Resize/compress so payload stays under Vercel ~4.5MB body limit. */
async function compressImageSrc(src: string, maxEdge = 1600, quality = 0.82): Promise<string> {
  const localSrc = await toExportableSrc(src);
  if (localSrc.startsWith("data:") && localSrc.length < 900_000) return localSrc;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Impossibile caricare l'immagine"));
    el.src = localSrc;
  });

  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non disponibile");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Compressione fallita"))),
      "image/jpeg",
      quality,
    );
  });
  return blobToDataUrl(blob);
}

export async function generateFromPhoto(
  imageSrc: string,
  prompt: string,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Preparazione foto…");
  const imageDataUrl = await compressImageSrc(imageSrc);

  onStatus?.("Generazione su Fal…");
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageDataUrl,
      prompt: prompt.trim(),
    }),
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    throw new Error(res.statusText || `Errore HTTP ${res.status}`);
  }

  if (!res.ok) {
    throw Object.assign(new Error(data?.message || data?.error || `Errore HTTP ${res.status}`), {
      status: res.status,
      body: data,
    });
  }

  if (!data?.url || typeof data.url !== "string") {
    throw new Error("Risposta server senza URL immagine");
  }

  onStatus?.("Salvataggio immagine…");
  return toExportableSrc(data.url);
}

export async function downloadImageUrl(url: string, filename = "generata.jpg") {
  const src = await toExportableSrc(url);
  const res = await fetch(src);
  if (!res.ok) throw new Error("Download fallito");
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}
