import type { IncomingHttpHeaders } from "http";
import dns from "node:dns";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  /* older Node */
}

const TARGET_HEADER = "x-fal-target-url";
const ALLOWED_HOST_SUFFIXES = ["fal.run", "fal.ai", "fal.media"];

function isAllowedTarget(targetUrl: string): boolean {
  try {
    const host = new URL(targetUrl).host.toLowerCase();
    return ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

function falAuthHeader(): string | undefined {
  const key = process.env.FAL_KEY;
  if (!key) return undefined;
  return key.startsWith("Key ") ? key : `Key ${key}`;
}

function headerValue(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const key = name.toLowerCase();
  const raw =
    (headers as Record<string, string | string[] | undefined>)[key] ??
    (headers as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export type ProxyRes = {
  statusCode?: number;
  setHeader: (name: string, value: string | number | readonly string[]) => void;
  write: (chunk: string | Buffer) => unknown;
  end: (chunk?: string | Buffer) => unknown;
  headersSent?: boolean;
};

function jsonError(res: ProxyRes, status: number, message: string, extra?: Record<string, unknown>) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ message, error: message, ...extra }));
}

/** Shared Fal proxy used by Vite middleware and Vercel /api/fal/proxy */
export async function proxyFalRequest(opts: {
  method?: string;
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  body?: string;
  res: ProxyRes;
}): Promise<void> {
  const { method = "GET", headers, body, res } = opts;
  const targetUrl = headerValue(headers, TARGET_HEADER);
  if (!targetUrl) {
    jsonError(res, 400, "Missing x-fal-target-url");
    return;
  }
  if (!isAllowedTarget(targetUrl)) {
    jsonError(res, 400, "Target URL not allowed", { targetUrl });
    return;
  }

  const authorization = falAuthHeader();
  if (!authorization) {
    jsonError(res, 401, "FAL_KEY missing on server — set it in Vercel Environment Variables");
    return;
  }

  const accept = headerValue(headers, "accept") || "application/json";
  const contentType = headerValue(headers, "content-type") || "application/json";

  const upstreamHeaders: Record<string, string> = {
    Authorization: authorization,
    Accept: accept,
    "User-Agent": headerValue(headers, "user-agent") || "image-generation-editor-fal-proxy",
    "x-fal-client-proxy": "image-generation-editor",
  };

  for (const [k, v] of Object.entries(headers)) {
    if (!k.toLowerCase().startsWith("x-fal-")) continue;
    if (k.toLowerCase() === TARGET_HEADER) continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (val) upstreamHeaders[k] = val;
  }

  const upper = method.toUpperCase();
  if (upper !== "GET" && upper !== "HEAD") {
    upstreamHeaders["Content-Type"] = contentType;
  }

  console.log(`[fal-proxy] ${upper} ${targetUrl}`);

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: upper,
      headers: upstreamHeaders,
      body: upper === "GET" || upper === "HEAD" ? undefined : body,
    });
  } catch (err: any) {
    const cause = err?.cause?.message || err?.cause?.code || err?.code || "";
    const detail = [err?.message, cause].filter(Boolean).join(" — ");
    console.error("[fal-proxy] fetch failed", targetUrl, detail, err);
    jsonError(res, 502, `Proxy non raggiunge Fal (${detail || "fetch failed"})`, { targetUrl });
    return;
  }

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (
      k === "transfer-encoding" ||
      k === "content-encoding" ||
      k === "content-length" ||
      k === "connection"
    ) {
      return;
    }
    try {
      res.setHeader(key, value);
    } catch {
      /* ignore */
    }
  });

  try {
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  } catch (err) {
    console.error("[fal-proxy] upstream read failed", err);
    if (!res.headersSent) {
      jsonError(res, 502, "Upstream Fal read failed");
    } else {
      res.end();
    }
  }
}
