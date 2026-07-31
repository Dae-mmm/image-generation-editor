/**
 * Single Fal generation endpoint — CommonJS for reliable Vite+Vercel serverless.
 * One browser call → server talks to Fal (upload + queue) with FAL_KEY.
 */
const { fal } = require("@fal-ai/client");

const FAL_WORKFLOW = "workflows/dmammolidesign/imagemakerpsc";

function extractImageUrl(data) {
  if (!data) return null;
  if (typeof data === "string" && /^https?:\/\//.test(data)) return data;
  if (typeof data !== "object") return null;

  const fromList = (list) => {
    if (!Array.isArray(list) || !list[0]) return null;
    const first = list[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && typeof first.url === "string") return first.url;
    return null;
  };

  const direct =
    fromList(data.images) ||
    fromList(data.image_urls) ||
    (typeof data.image === "string" ? data.image : null) ||
    (data.image && typeof data.image === "object" ? data.image.url : null) ||
    (typeof data.url === "string" ? data.url : null) ||
    (typeof data.image_url === "string" ? data.image_url : null);

  if (direct) return direct;
  if (data.output) return extractImageUrl(data.output);
  if (data.data) return extractImageUrl(data.data);

  for (const v of Object.values(data)) {
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

function formatError(err) {
  const body = err && err.body;
  const dig = (detail) => {
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0] && detail[0].msg) return String(detail[0].msg);
    return null;
  };
  return (
    dig(body && body.error && body.error.body && body.error.body.detail) ||
    (body && body.error && body.error.body && body.error.body.message) ||
    (body && body.error && body.error.message) ||
    (typeof (body && body.error) === "string" ? body.error : null) ||
    dig(body && body.detail) ||
    (body && body.message) ||
    (err && err.message) ||
    "A server error has occurred"
  );
}

function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error("imageDataUrl non valida");
  const contentType = m[1] || "image/jpeg";
  const buf = Buffer.from(m[2], "base64");
  return new Blob([Uint8Array.from(buf)], { type: contentType });
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  try {
    if (!process.env.FAL_KEY) {
      res.status(500).json({
        message: "FAL_KEY missing on server — set it in Vercel Environment Variables",
        error: "FAL_KEY missing on server",
      });
      return;
    }

    fal.config({ credentials: process.env.FAL_KEY });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const prompt = String(body.prompt || "");
    let imageUrl = body.imageUrl ? String(body.imageUrl) : "";

    if (!imageUrl) {
      if (!body.imageDataUrl) {
        res.status(400).json({ message: "Missing imageDataUrl or imageUrl" });
        return;
      }
      const blob = dataUrlToBlob(String(body.imageDataUrl));
      imageUrl = await fal.storage.upload(blob);
    }

    const result = await fal.subscribe(FAL_WORKFLOW, {
      input: {
        image_urls: [imageUrl],
        prompt: prompt.trim(),
      },
      logs: true,
    });

    const url =
      extractImageUrl(result && result.data) ||
      extractImageUrl(result) ||
      extractImageUrl(result && result.output);

    if (!url) {
      console.error("[api/generate] unexpected result", JSON.stringify(result).slice(0, 2000));
      res.status(502).json({ message: "Il workflow non ha restituito un'immagine" });
      return;
    }

    res.status(200).json({ url });
  } catch (err) {
    console.error("[api/generate]", err);
    const message = formatError(err);
    const status = err && err.status >= 400 ? err.status : 500;
    res.status(status).json({
      message,
      error: message,
      body: err && err.body,
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "4.5mb",
    },
  },
  maxDuration: 60,
};
