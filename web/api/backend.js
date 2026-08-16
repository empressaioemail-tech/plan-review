/**
 * Plan-review QA BFF. Holds service tokens. Browser never sees a DSN.
 * PLAN-ROW G-60. Env only: PLAN_REVIEW_BACKEND_URL, PLAN_REVIEW_API_KEY,
 * SMART_FILES_BACKEND_URL, SMART_FILES_API_KEY.
 */

const FORBIDDEN_DSN = /DATABASE|neon\.tech|snowy-bread|winter-shape|fancy-fire|tiny-art/i;

export default async function handler(req, res) {
  const dsnKeys = Object.keys(process.env).filter((k) => FORBIDDEN_DSN.test(k));
  if (dsnKeys.length > 0) {
    res.status(503).json({
      error: "dsn_refused",
      message: "QA UI must not hold a database DSN",
    });
    return;
  }

  const prBackend = (process.env.PLAN_REVIEW_BACKEND_URL || "").replace(/\/$/, "");
  const prKey = process.env.PLAN_REVIEW_API_KEY || "";
  const filesBackend = (process.env.SMART_FILES_BACKEND_URL || "").replace(/\/$/, "");
  const filesKey = process.env.SMART_FILES_API_KEY || "";

  if (!prBackend || /cortex-api|property-explorer|cmdcenter/i.test(prBackend)) {
    res.status(503).json({ error: "mount_not_configured" });
    return;
  }
  if (!prKey || !filesBackend || !filesKey) {
    res.status(503).json({ error: "mount_not_configured" });
    return;
  }

  const incoming = new URL(req.url, "http://local");
  const path = incoming.searchParams.get("path") || "";
  const persona = String(req.headers["x-persona"] || incoming.searchParams.get("persona") || "");

  if (path.startsWith("/api/icc/")) {
    if (!persona) {
      res.status(401).json({
        error: "unauthorized",
        message: "Unauthed ICC content is refused. Gate with a persona.",
      });
      return;
    }
  }

  let backend = prBackend;
  let key = prKey;
  if (path.startsWith("/api/smart-files/")) {
    backend = filesBackend;
    key = filesKey;
  } else if (!path.startsWith("/api/plan-review/") && !path.startsWith("/api/icc/")) {
    res.status(400).json({ error: "path must start with /api/plan-review/, /api/icc/, or /api/smart-files/" });
    return;
  }

  incoming.searchParams.delete("path");
  incoming.searchParams.delete("persona");
  const qs = incoming.searchParams.toString();
  const target = `${backend}${path}${qs ? `?${qs}` : ""}`;

  const headers = {
    accept: req.headers.accept || "application/json",
    authorization: `Bearer ${key}`,
    "user-agent": "plan-review-app/g60",
  };
  if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await readRaw(req);
  }

  const upstream = await fetch(target, { method: req.method, headers, body });
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.status(upstream.status);
  const ct = upstream.headers.get("content-type");
  if (ct) res.setHeader("content-type", ct);
  res.send(buf);
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
