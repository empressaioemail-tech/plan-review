/**
 * ICC activity page. Unauthed callers get HTTP 401 (WDLL item 3 / walk item 16).
 * Authed callers receive the SPA shell. PLAN-ROW G-60.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export default function handler(req, res) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)pr_persona=([^;]+)/);
  const persona =
    (match && decodeURIComponent(match[1])) ||
    String(req.query?.persona || "");
  if (!persona) {
    res.status(401).json({
      error: "unauthorized",
      message: "Unauthed ICC content is refused. Open /gate and pick a persona.",
    });
    return;
  }
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
