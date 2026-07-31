import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxyFalRequest } from "../../lib/fal-proxy";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
  maxDuration: 60,
};

function readBody(req: VercelRequest): Promise<string | undefined> {
  if (req.body == null) return Promise.resolve(undefined);
  if (typeof req.body === "string") return Promise.resolve(req.body);
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString("utf8"));
  return Promise.resolve(JSON.stringify(req.body));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await proxyFalRequest({
      method: req.method,
      headers: req.headers,
      body: await readBody(req),
      res,
    });
  } catch (err: any) {
    console.error("[fal-proxy] unhandled", err);
    if (!res.headersSent) {
      res.status(500).json({
        message: err?.message || "A server error has occurred",
        error: err?.message || "A server error has occurred",
      });
    }
  }
}
