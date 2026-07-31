import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxyFalRequest } from "./_proxyCore";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

function readBody(req: VercelRequest): Promise<string | undefined> {
  if (req.body == null) return Promise.resolve(undefined);
  if (typeof req.body === "string") return Promise.resolve(req.body);
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString("utf8"));
  return Promise.resolve(JSON.stringify(req.body));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await proxyFalRequest({
    method: req.method,
    headers: req.headers,
    body: await readBody(req),
    res,
  });
}
