import http from "node:http";
import { QA_PERSONAS, resolvePersona } from "./actors.mjs";
import {
  createEngagementFolder,
  filesToDataroomAtoms,
  listFolderFiles,
  shareFolder,
  uploadToFolder,
} from "./files.mjs";
import {
  createEngagement,
  findBySection,
  getEngagement,
  getLetter,
  jurisdictionFromParcel,
  listActivity,
  listCanned,
  listEngagements,
  listFindings,
  overrideFinding,
  queueBuckets,
  recordActivity,
  setEngagementFolder,
  setStage,
  upsertFinding,
  upsertLetter,
} from "./store.mjs";
import {
  chainBriefing,
  envelopeGeojson,
  getAtom,
  getPropertyAtomChain,
  matrixFromChain,
} from "./mcp.mjs";

const port = Number(process.env.PORT || 8080);
const service = "plan-review";
const ICC_ACTOR = "did:hauska:actor:org:icc";

function activitySource(req) {
  const h = String(req.headers["x-plan-review-source"] || "");
  if (h.startsWith("mcp:")) return h.slice(0, 80);
  return "plan-review-ui";
}

const IBC_SEED = [
  {
    sectionId: "R311.7",
    sectionAtomId: "icc:ibc-2018:R311.7",
    bookId: "IBC2018P6",
    citation: "2018 International Building Code Section R311.7",
    heading: "Stairways",
    analysis: "Applicability seeded Unchecked. Determination waits atom-chain, not a fabricated Pass.",
  },
  {
    sectionId: "R302.1",
    sectionAtomId: "icc:ibc-2018:R302.1",
    bookId: "IBC2018P6",
    citation: "2018 International Building Code Section R302.1",
    heading: "Exterior walls",
    analysis: "Applicability seeded Unchecked. No verbatim ICC body.",
  },
];

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function requireToken(req, res) {
  const expected = process.env.PLAN_REVIEW_SERVICE_TOKEN || "";
  const auth = req.headers.authorization || "";
  const got = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!expected || !got || got !== expected) {
    json(res, 401, {
      error: "unauthorized",
      message: "Anonymous callers are refused. Bearer service token required.",
    });
    return false;
  }
  return true;
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  return JSON.parse(raw.toString("utf8"));
}

function requirePersona(body, res) {
  const persona = resolvePersona(body.orgId, body.userId);
  if (!persona) {
    json(res, 400, {
      error: "unknown_persona",
      message: "orgId and userId must be an icc-demo persona",
      personas: QA_PERSONAS,
    });
    return null;
  }
  return persona;
}

function refuseCotality(obj) {
  const s = JSON.stringify(obj || {}).toLowerCase();
  return /cotality|corelogic|get_property_detail/.test(s);
}

async function seedMatrix(engagementId, parcelNodeId) {
  let chain = null;
  try {
    chain = await getPropertyAtomChain(parcelNodeId);
  } catch (err) {
    chain = { error: String(err.message), data: { status: "not_ready", slots: {} } };
  }
  const rows = matrixFromChain(parcelNodeId, chain);
  const out = [];
  for (const s of rows) {
    out.push(
      await upsertFinding({
        engagementId,
        ...s,
      }),
    );
  }
  return { sections: out, chainStatus: chain?.data?.status || chain?.status || "not_ready" };
}

function letterHtml(engagement, findings) {
  const rows = findings
    .map(
      (f) =>
        `<li>${escapeHtml(f.citation)} — ${escapeHtml(f.determination)} atom ${escapeHtml(f.sectionAtomId)}</li>`,
    )
    .join("");
  return `<!doctype html><html><body style="font-family:sans-serif;background:#fff;color:#111">
<h1>Decision letter</h1>
<p>Engagement ${escapeHtml(engagement.id)}</p>
<p>Parcel ${escapeHtml(engagement.parcelNodeId)} · ${escapeHtml(engagement.projectType)}</p>
<p>Stage ${escapeHtml(engagement.stage)}</p>
<p>Jurisdiction ${escapeHtml(engagement.jurisdiction || "")}</p>
<ul>${rows}</ul>
<p>Citations only. ICC body is not reproduced. Cotality calls: ${engagement.cotalityCalls}.</p>
</body></html>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function ensureFolder(engagement, persona) {
  if (engagement.filesFolderId) return engagement;
  const label = `Plan review ${engagement.parcelNodeId}`;
  const created = await createEngagementFolder({
    orgId: persona.orgId,
    userId: persona.userId,
    label,
  });
  const folderId = created.folder?.folderId || created.folderId;
  return setEngagementFolder(engagement.id, folderId);
}

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://local");
  const path = decodeURIComponent(url.pathname);

  if (req.method === "GET" && (path === "/" || path === "/healthz")) {
    json(res, 200, { ok: true, service });
    return;
  }

  if (!path.startsWith("/api/plan-review/") && !path.startsWith("/api/icc/")) {
    json(res, 404, { ok: false, service });
    return;
  }

  if (!requireToken(req, res)) return;

  if (req.method === "GET" && path === "/api/plan-review/personas") {
    json(res, 200, { personas: QA_PERSONAS });
    return;
  }

  if (req.method === "GET" && path === "/api/plan-review/queue") {
    json(res, 200, await queueBuckets());
    return;
  }

  if (req.method === "GET" && path === "/api/plan-review/reviewer/engagements") {
    json(res, 200, await listEngagements());
    return;
  }

  if (req.method === "GET" && path === "/api/plan-review/canned") {
    json(res, 200, { templates: await listCanned() });
    return;
  }

  if (req.method === "GET" && path === "/api/plan-review/findings") {
    const sectionId = url.searchParams.get("sectionId") || "";
    if (!sectionId) {
      json(res, 400, { error: "sectionId is required" });
      return;
    }
    json(res, 200, { findings: await findBySection(sectionId) });
    return;
  }

  if (req.method === "GET" && path === "/api/plan-review/code") {
    const book = (url.searchParams.get("book") || "").toUpperCase();
    const section = url.searchParams.get("section") || "";
    const chapter = url.searchParams.get("chapter") || "";
    if (book.includes("IPMC")) {
      json(res, 200, {
        book: "IPMC2018P2",
        section,
        status: "typed-absence",
        absence: {
          status: "verified-absent",
          basis: "G-41. IPMC 2018 has zero ingested sections. Not a fake book.",
        },
        bodyVerbatim: false,
      });
      return;
    }
    if (book.includes("UDC") || book.includes("BASTROP")) {
      const udcId =
        section === "14-02-008"
          ? "did:hauska:code-section:bastrop_tx-bdc-2026-adopted/14-02-008"
          : "did:hauska:code-section:bastrop_tx-bdc-2026-adopted/14-02-003";
      let atom = null;
      try {
        atom = await getAtom(udcId);
      } catch {
        atom = null;
      }
      const payload = atom?.data || atom?.atom || atom;
      await recordActivity({
        source: activitySource(req),
        bookId: "BASTROP-UDC",
        sectionId: section || "14-02-003",
      });
      json(res, 200, {
        book: "BASTROP-UDC",
        section: section || "14-02-003",
        sectionAtomId: udcId,
        citation: payload?.title
          ? `City of Bastrop Building Block B3 Section ${section || "14-02-003"}`
          : `City of Bastrop Building Block B3 Section ${section || "14-02-003"}`,
        heading: payload?.title || payload?.sectionNumber || "District requirements",
        analysis: payload?.bodyText
          ? String(payload.bodyText).slice(0, 400)
          : "Municipal UDC section from hauska catalog. Not ICC. No verbatim ICC body.",
        bodyVerbatim: false,
        chapters: ["14-02"],
        sections: ["14-02-003", "14-02-008"],
      });
      return;
    }
    const chapterHits = IBC_SEED.filter((s) =>
      chapter ? s.sectionId.startsWith(chapter.replace(/^R/i, "R")) || s.sectionId.startsWith(chapter) : true,
    );
    const hit =
      IBC_SEED.find((s) => s.sectionId === section) || chapterHits[0] || IBC_SEED[0];
    await recordActivity({
      source: activitySource(req),
      bookId: hit.bookId,
      sectionId: hit.sectionId,
    });
    json(res, 200, {
      book: "IBC2018P6",
      chapter: chapter || hit.sectionId.replace(/\..*$/, ""),
      section: hit.sectionId,
      citation: hit.citation,
      heading: hit.heading,
      analysis: hit.analysis,
      bodyVerbatim: false,
      iccDeepLink: `https://codes.iccsafe.org/content/IBC2018P6/${hit.sectionId}`,
      chapters: [...new Set(IBC_SEED.map((s) => s.sectionId.replace(/\..*$/, "")))],
      sections: (chapterHits.length ? chapterHits : IBC_SEED).map((s) => s.sectionId),
    });
    return;
  }

  if (req.method === "GET" && path === "/api/icc/activity") {
    const actorDid = url.searchParams.get("actorDid") || ICC_ACTOR;
    json(res, 200, {
      actorDid,
      rateLabel: "PoC fixture, not a quoted SaaS price",
      ipmcResidual: "IPMC 2018 not ingested (G-41)",
      purge: {
        sourceAdapter: "icc-code-connect",
        jurisdictionTenant: "icc-model-code",
      },
      rows: await listActivity(actorDid),
    });
    return;
  }

  if (
    (req.method === "POST" && path === "/api/plan-review/intake") ||
    (req.method === "POST" && path === "/api/plan-review/engagements")
  ) {
    const body = await readJson(req);
    if (refuseCotality(body)) {
      json(res, 400, { error: "cotality_extinguished", cotalityCalls: 0 });
      return;
    }
    const persona = requirePersona(body, res);
    if (!persona) return;
    const parcelNodeId = String(body.parcelNodeId || "").trim();
    const projectType = String(body.projectType || "").trim();
    if (!parcelNodeId || !projectType) {
      json(res, 400, { error: "parcelNodeId and projectType are required" });
      return;
    }
    let engagement = await createEngagement({
      parcelNodeId,
      projectType,
      jurisdiction: jurisdictionFromParcel(parcelNodeId),
      orgId: persona.orgId,
      userId: persona.userId,
      scopeText: body.scope || body.scopeText || null,
    });
    try {
      engagement = await ensureFolder(engagement, persona);
    } catch (err) {
      json(res, err.status || 503, {
        error: "files_folder_failed",
        message: String(err.message),
        engagement,
      });
      return;
    }
    await seedMatrix(engagement.id, engagement.parcelNodeId);
    await recordActivity({
      source: activitySource(req),
      engagementId: engagement.id,
      bookId: "IBC2018P6",
      sectionId: "intake",
    });
    json(res, 201, { ...engagement, cotalityCalls: 0 });
    return;
  }

  if (req.method === "POST" && path === "/api/plan-review/geocode") {
    json(res, 410, {
      error: "extinguished",
      message: "Cotality geocode is dead. Intake with parcelNodeId. Zero Cotality calls.",
      cotalityCalls: 0,
    });
    return;
  }

  const engMatch = path.match(/^\/api\/plan-review\/engagements\/([^/]+)(?:\/(.*))?$/);
  if (engMatch) {
    const id = engMatch[1];
    const rest = engMatch[2] || "";
    const engagement = await getEngagement(id);
    if (!engagement) {
      json(res, 404, { error: "engagement_not_found" });
      return;
    }

    if (req.method === "GET" && rest === "") {
      json(res, 200, engagement);
      return;
    }

    if (req.method === "GET" && rest === "matrix") {
      const seeded = await seedMatrix(id, engagement.parcelNodeId);
      await recordActivity({
        source: activitySource(req),
        engagementId: id,
        bookId: "IBC2018P6",
        sectionId: "R302.1",
      });
      json(res, 200, {
        engagementId: id,
        sections: seeded.sections,
        chainStatus: seeded.chainStatus,
        bodyVerbatim: false,
      });
      return;
    }

    if (req.method === "GET" && rest === "map-feature") {
      try {
        const chain = await getPropertyAtomChain(engagement.parcelNodeId);
        json(res, 200, {
          parcelNodeId: engagement.parcelNodeId,
          geojson: envelopeGeojson(chain),
          overlay: "buildable-envelope",
          note: "Parcel-node geometry slot is pending. Envelope is the live atom-chain overlay, not a fabricated boundary.",
        });
      } catch (err) {
        json(res, 200, {
          parcelNodeId: engagement.parcelNodeId,
          geojson: null,
          note: String(err.message),
        });
      }
      return;
    }

    if (req.method === "GET" && rest === "briefing") {
      const sectionAtomId = url.searchParams.get("sectionAtomId") || "";
      try {
        const chain = await getPropertyAtomChain(engagement.parcelNodeId);
        json(res, 200, {
          engagementId: id,
          sectionAtomId,
          ...chainBriefing(chain, engagement.parcelNodeId),
        });
      } catch (err) {
        const findings = await listFindings(id);
        const hit = findings.find((f) => f.sectionAtomId === sectionAtomId) || findings[0];
        json(res, 200, {
          engagementId: id,
          sectionAtomId: hit?.sectionAtomId || sectionAtomId,
          chain: hit
            ? [
                {
                  role: "source",
                  atomId: hit.sectionAtomId,
                  citation: hit.citation,
                  confidence: hit.confidence,
                  retrievedAt: new Date().toISOString(),
                  note: `Atom-chain fetch failed: ${err.message}. Stored finding only. No fabricated steps.`,
                },
              ]
            : [],
          bodyVerbatim: false,
        });
      }
      return;
    }

    if (req.method === "GET" && rest === "letter") {
      json(res, 200, await getLetter(id));
      return;
    }

    if (req.method === "POST" && (rest === "letter/generate" || rest === "letter")) {
      const findings = await listFindings(id);
      const html = letterHtml(engagement, findings);
      json(res, 200, await upsertLetter(id, html));
      return;
    }

    if (req.method === "POST" && rest === "override") {
      const body = await readJson(req);
      const persona = requirePersona(body, res);
      if (!persona) return;
      const findings = await listFindings(id);
      const target =
        findings.find((f) => f.sectionAtomId === body.sectionAtomId) || findings[0];
      if (!target) {
        json(res, 404, { error: "finding_not_found" });
        return;
      }
      const updated = await overrideFinding(target.id, {
        determination: body.determination,
        reason: body.reason,
        analysis: body.analysis,
      });
      await setStage(id, body.stage || "In Review");
      await recordActivity({
        source: activitySource(req),
        engagementId: id,
        bookId: updated.bookId,
        sectionId: updated.sectionId,
      });
      json(res, 201, {
        ...updated,
        adjudicationAtomDid: `pending:plan-review:${updated.id}`,
        note: "Engine ingest waits a quiet L26 slot. DID is a local pending marker, not a store atom.",
      });
      return;
    }

    if (req.method === "POST" && rest === "files-room") {
      const body = await readJson(req);
      const persona = requirePersona(body, res);
      if (!persona) return;
      const next = await ensureFolder(engagement, persona);
      json(res, 201, { engagement: next, folderId: next.filesFolderId });
      return;
    }

    if (req.method === "GET" && (rest === "documents" || rest === "sheets" || rest === "dataroom-atoms")) {
      if (!engagement.filesFolderId) {
        json(res, 200, {
          folderId: null,
          files: [],
          sheets: [],
          atomsByDocument: {},
          note: "No Smart Files room yet. POST files-room.",
        });
        return;
      }
      const listed = await listFolderFiles(engagement.filesFolderId);
      const files = listed.files || [];
      const atoms = filesToDataroomAtoms(engagement.filesFolderId, files);
      if (rest === "sheets") {
        json(res, 200, {
          sheets: files.map((f, i) => ({
            sheetId: f.entityId,
            label: f.title,
            pageNumber: i + 1,
            atomType: "smart-file",
            accessPolicy: f.accessPolicy,
          })),
          folderId: engagement.filesFolderId,
        });
        return;
      }
      if (rest === "dataroom-atoms") {
        json(res, 200, {
          atomsByDocument: Object.fromEntries(atoms.map((a) => [a.entityId, [a]])),
          store: "smart-files",
        });
        return;
      }
      json(res, 200, {
        folderId: engagement.filesFolderId,
        documents: files,
        store: "smart-files",
      });
      return;
    }

    if (
      req.method === "POST" &&
      (rest === "documents" ||
        rest === "documents/complete-upload" ||
        rest === "sheets/extract")
    ) {
      const body = await readJson(req);
      const persona = requirePersona(body, res);
      if (!persona) return;
      const next = await ensureFolder(engagement, persona);
      if (!body.bytesBase64 || !body.title) {
        json(res, 400, {
          error: "title and bytesBase64 are required",
          message: "Documents are Smart Files uploads. Cortex GCS upload-url is not this product.",
        });
        return;
      }
      const uploaded = await uploadToFolder({
        folderId: next.filesFolderId,
        orgId: persona.orgId,
        userId: persona.userId,
        title: body.title,
        contentType: body.contentType || "application/octet-stream",
        bytesBase64: body.bytesBase64,
      });
      json(res, 201, { file: uploaded.file || uploaded, store: "smart-files" });
      return;
    }

    if (req.method === "POST" && rest === "documents/upload-url") {
      json(res, 410, {
        error: "gone",
        message: "GCS upload-url is cortex dataroom. POST documents with bytesBase64 to Smart Files.",
        store: "smart-files",
      });
      return;
    }

    if (req.method === "POST" && (rest === "share" || rest.endsWith("/share"))) {
      const body = await readJson(req);
      const persona = requirePersona(body, res);
      if (!persona) return;
      const next = await ensureFolder(engagement, persona);
      const share = await shareFolder({
        folderId: next.filesFolderId,
        orgId: persona.orgId,
        userId: persona.userId,
      });
      json(res, 201, { ...share, store: "smart-files" });
      return;
    }

    if (req.method === "POST" && rest === "compliance-run") {
      const seeded = await seedMatrix(id, engagement.parcelNodeId);
      json(res, 200, {
        engagementId: id,
        sections: seeded.sections,
        chainStatus: seeded.chainStatus,
        note: "Compliance-run refreshes the matrix from atom-chain. Calibration later.",
      });
      return;
    }

    if (rest.startsWith("reports/")) {
      json(res, 501, {
        error: "report_runner_not_elevated",
        message: "Site-analysis report runners remount after the F1-F7 files path is live. Not cortex-prod.",
        path: rest,
      });
      return;
    }
  }

  json(res, 501, {
    error: "not_implemented",
    message: "Named leftover. Calibration, spaces shell, and DWG stay out.",
    path,
  });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    json(res, err.status || 500, {
      error: "internal",
      message: String(err?.message || err),
    });
  });
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`${service} listening on ${port}\n`);
});
