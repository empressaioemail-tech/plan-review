import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const FORBIDDEN = /fancy-fire|lucky-truth|06136146|tiny-art|snowy-bread/;

const STAGES = [
  "Submitted",
  "In Review",
  "Approved",
  "Approved with Conditions",
  "Denied",
];

function loadDsn() {
  const fromEnv =
    process.env.PLAN_REVIEW_DATABASE_URL || process.env.DATABASE_URL || "";
  if (fromEnv) return fromEnv.trim();
  const p = join(homedir(), ".empressa", "plan-review.database_url");
  return readFileSync(p, "utf8").trim();
}

let pool;

export function getPool() {
  if (!pool) {
    const url = loadDsn();
    if (!url) throw new Error("PLAN_REVIEW_DATABASE_URL is required");
    if (FORBIDDEN.test(url)) {
      throw new Error("refusing cortex-prod, smartcity, or smart-files DSN");
    }
    pool = new pg.Pool({ connectionString: url, max: 4 });
  }
  return pool;
}

export function jurisdictionFromParcel(parcelNodeId) {
  const fips = String(parcelNodeId || "").slice(0, 5);
  if (fips === "48021") return "Bastrop County, TX";
  if (/^\d{5}$/.test(fips)) return `FIPS ${fips}`;
  return null;
}

export async function createEngagement(row) {
  const { rows } = await getPool().query(
    `INSERT INTO plan_review_engagements
       (parcel_node_id, project_type, jurisdiction, stage, org_id, user_id, files_folder_id, scope_text, cotality_calls)
     VALUES ($1,$2,$3,'Submitted',$4,$5,$6,$7,0)
     RETURNING *`,
    [
      row.parcelNodeId,
      row.projectType,
      row.jurisdiction,
      row.orgId,
      row.userId,
      row.filesFolderId || null,
      row.scopeText || null,
    ],
  );
  return mapEngagement(rows[0]);
}

export async function setEngagementFolder(id, folderId) {
  const { rows } = await getPool().query(
    `UPDATE plan_review_engagements
        SET files_folder_id = $2, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id, folderId],
  );
  return rows[0] ? mapEngagement(rows[0]) : null;
}

export async function getEngagement(id) {
  const { rows } = await getPool().query(
    `SELECT * FROM plan_review_engagements WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapEngagement(rows[0]) : null;
}

export async function findEngagementByFolder(folderId) {
  if (!folderId) return null;
  const { rows } = await getPool().query(
    `SELECT * FROM plan_review_engagements WHERE files_folder_id = $1 LIMIT 1`,
    [folderId],
  );
  return rows[0] ? mapEngagement(rows[0]) : null;
}

export async function listEngagements() {
  const { rows } = await getPool().query(
    `SELECT * FROM plan_review_engagements ORDER BY created_at DESC`,
  );
  return rows.map(mapEngagement);
}

export async function queueBuckets() {
  const { rows } = await getPool().query(
    `SELECT stage, count(*)::int AS n FROM plan_review_engagements GROUP BY stage`,
  );
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const r of rows) counts[r.stage] = r.n;
  const engagements = await listEngagements();
  return {
    stages: STAGES,
    counts,
    total: engagements.length,
    engagements,
  };
}

export async function setStage(id, stage) {
  if (!STAGES.includes(stage)) throw new Error("invalid_stage");
  const { rows } = await getPool().query(
    `UPDATE plan_review_engagements SET stage = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, stage],
  );
  return rows[0] ? mapEngagement(rows[0]) : null;
}

export async function upsertFinding(row) {
  const { rows: existing } = await getPool().query(
    `SELECT * FROM plan_review_findings
      WHERE engagement_id = $1 AND section_id = $2
      LIMIT 1`,
    [row.engagementId, row.sectionId],
  );
  if (existing[0]?.override_reason) {
    return mapFinding(existing[0]);
  }
  if (existing[0]) {
    const { rows } = await getPool().query(
      `UPDATE plan_review_findings
          SET section_atom_id = $2,
              book_id = $3,
              citation = $4,
              heading = $5,
              analysis = $6,
              determination = $7,
              confidence = $8::jsonb,
              icc_deep_link = $9,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        existing[0].id,
        row.sectionAtomId,
        row.bookId || null,
        row.citation,
        row.heading || null,
        row.analysis || null,
        row.determination,
        JSON.stringify(row.confidence),
        row.iccDeepLink || null,
      ],
    );
    return mapFinding(rows[0]);
  }
  return insertFinding(row);
}

export async function insertFinding(row) {
  const { rows } = await getPool().query(
    `INSERT INTO plan_review_findings
       (engagement_id, section_atom_id, book_id, section_id, citation, heading, analysis,
        determination, confidence, icc_deep_link, body_verbatim)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,false)
     RETURNING *`,
    [
      row.engagementId,
      row.sectionAtomId,
      row.bookId || null,
      row.sectionId || null,
      row.citation,
      row.heading || null,
      row.analysis || null,
      row.determination,
      JSON.stringify(row.confidence),
      row.iccDeepLink || null,
    ],
  );
  return mapFinding(rows[0]);
}

export async function listFindings(engagementId) {
  const { rows } = await getPool().query(
    `SELECT * FROM plan_review_findings WHERE engagement_id = $1 ORDER BY created_at`,
    [engagementId],
  );
  return rows.map(mapFinding);
}

export async function findBySection(sectionId) {
  const { rows } = await getPool().query(
    `SELECT f.*, e.parcel_node_id
       FROM plan_review_findings f
       JOIN plan_review_engagements e ON e.id = f.engagement_id
      WHERE f.section_id = $1
      ORDER BY f.created_at DESC`,
    [sectionId],
  );
  return rows.map((r) => ({ ...mapFinding(r), parcelNodeId: r.parcel_node_id }));
}

export async function overrideFinding(id, patch) {
  const { rows } = await getPool().query(
    `UPDATE plan_review_findings
        SET original_determination = COALESCE(original_determination, determination),
            determination = $2,
            override_reason = $3,
            analysis = COALESCE($4, analysis),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id, patch.determination, patch.reason, patch.analysis || null],
  );
  return rows[0] ? mapFinding(rows[0]) : null;
}

export async function listCanned() {
  const { rows } = await getPool().query(
    `SELECT * FROM plan_review_canned ORDER BY created_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    sectionId: r.section_id,
    label: r.label,
    body: r.body,
  }));
}

export async function upsertLetter(engagementId, html) {
  const { rows } = await getPool().query(
    `INSERT INTO plan_review_letters (engagement_id, html)
     VALUES ($1, $2)
     ON CONFLICT (engagement_id) DO UPDATE SET html = EXCLUDED.html
     RETURNING *`,
    [engagementId, html],
  );
  return { engagementId, html: rows[0].html, generatedAt: rows[0].created_at };
}

export async function getLetter(engagementId) {
  const { rows } = await getPool().query(
    `SELECT * FROM plan_review_letters WHERE engagement_id = $1`,
    [engagementId],
  );
  if (!rows[0]) return { draft: null, generatedAt: null, html: null };
  return {
    draft: rows[0].html,
    html: rows[0].html,
    generatedAt: rows[0].created_at,
  };
}

export async function recordActivity(row) {
  const { rows } = await getPool().query(
    `INSERT INTO plan_review_activity
       (actor_did, source, book_id, section_id, engagement_id, rate, amount, tier)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      row.actorDid || "did:hauska:actor:org:icc",
      row.source,
      row.bookId || null,
      row.sectionId || null,
      row.engagementId || null,
      row.rate ?? 0.01,
      row.amount ?? 0.01,
      row.tier || "poc-fixture",
    ],
  );
  return mapActivity(rows[0]);
}

export async function listActivity(actorDid) {
  const actor = actorDid || "did:hauska:actor:org:icc";
  const { rows } = await getPool().query(
    `SELECT * FROM plan_review_activity
      WHERE actor_did = $1
      ORDER BY created_at DESC
      LIMIT 200`,
    [actor],
  );
  return rows.map(mapActivity);
}

export async function summarizeActivity(actorDid) {
  const actor = actorDid || "did:hauska:actor:org:icc";
  const { rows: totals } = await getPool().query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::float8 AS amount
       FROM plan_review_activity
      WHERE actor_did = $1`,
    [actor],
  );
  const { rows: bySource } = await getPool().query(
    `SELECT source, COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::float8 AS amount
       FROM plan_review_activity
      WHERE actor_did = $1
      GROUP BY source
      ORDER BY n DESC`,
    [actor],
  );
  return {
    n: totals[0]?.n || 0,
    amount: Number(totals[0]?.amount || 0),
    bySource: bySource.map((r) => ({
      source: r.source,
      n: r.n,
      amount: Number(r.amount),
    })),
  };
}

function mapEngagement(r) {
  return {
    id: r.id,
    parcelNodeId: r.parcel_node_id,
    projectType: r.project_type,
    jurisdiction: r.jurisdiction,
    stage: r.stage,
    orgId: r.org_id,
    userId: r.user_id,
    filesFolderId: r.files_folder_id,
    scopeText: r.scope_text,
    cotalityCalls: r.cotality_calls,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapFinding(r) {
  return {
    id: r.id,
    engagementId: r.engagement_id,
    sectionAtomId: r.section_atom_id,
    bookId: r.book_id,
    sectionId: r.section_id,
    citation: r.citation,
    heading: r.heading,
    analysis: r.analysis,
    determination: r.determination,
    confidence: r.confidence,
    iccDeepLink: r.icc_deep_link,
    bodyVerbatim: r.body_verbatim,
    originalDetermination: r.original_determination,
    overrideReason: r.override_reason,
    adjudicationAtomDid: r.adjudication_atom_did,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapActivity(r) {
  return {
    id: r.id,
    actorDid: r.actor_did,
    source: r.source,
    bookId: r.book_id,
    sectionId: r.section_id,
    engagementId: r.engagement_id,
    rate: Number(r.rate),
    amount: Number(r.amount),
    tier: r.tier,
    createdAt: r.created_at,
  };
}
