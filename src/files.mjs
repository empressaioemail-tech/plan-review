/**
 * Smart Files HTTP client. Plan-review never holds a files DSN.
 * Documents and dataroom atoms are file-shaped atoms on this service.
 */

const FORBIDDEN_HOST = /cortex-api|fancy-fire|legacy-design-tools/i;

function baseUrl() {
  const u = (process.env.SMART_FILES_BACKEND_URL || "").replace(/\/$/, "");
  if (!u) throw new Error("SMART_FILES_BACKEND_URL is required");
  if (FORBIDDEN_HOST.test(u)) throw new Error("refusing cortex as files host");
  return u;
}

function token() {
  return (
    process.env.SMART_FILES_SERVICE_TOKEN ||
    process.env.SMART_FILES_API_KEY ||
    ""
  );
}

async function filesFetch(path, init = {}) {
  const t = token();
  if (!t) {
    const err = new Error("SMART_FILES_SERVICE_TOKEN is required");
    err.status = 503;
    throw err;
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${t}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(body.error || body.message || `files HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function createEngagementFolder({ orgId, userId, label }) {
  return filesFetch("/api/smart-files/folders", {
    method: "POST",
    body: JSON.stringify({ orgId, userId, label }),
  });
}

export async function listFolderFiles(folderId) {
  return filesFetch(`/api/smart-files/folders/${encodeURIComponent(folderId)}/files`);
}

export async function uploadToFolder({ folderId, orgId, userId, title, contentType, bytesBase64 }) {
  return filesFetch(`/api/smart-files/folders/${encodeURIComponent(folderId)}/files`, {
    method: "POST",
    body: JSON.stringify({ orgId, userId, title, contentType, bytesBase64 }),
  });
}

export async function shareFolder({ folderId, orgId, userId }) {
  return filesFetch(`/api/smart-files/folders/${encodeURIComponent(folderId)}/share`, {
    method: "POST",
    body: JSON.stringify({ orgId, userId }),
  });
}

export async function resolveShare(token) {
  return filesFetch(`/api/smart-files/share/${encodeURIComponent(token)}`);
}

export const PLAN_REVIEW_APP_URL = "https://plan-review-app-ten.vercel.app";
export const SMARTSITE_MAP_ORIGIN = "https://smartsite.cloud";

export function dataRoomUrl(token) {
  if (!token) return null;
  return `${PLAN_REVIEW_APP_URL}/applicant?token=${token}`;
}

export function smartSiteMapUrl(parcelNodeId) {
  const u = new URL(SMARTSITE_MAP_ORIGIN);
  u.searchParams.set("parcelNodeId", String(parcelNodeId || ""));
  return u.toString();
}

export async function readSmartFile(entityId) {
  return filesFetch(`/api/smart-files/files/${encodeURIComponent(entityId)}`);
}

export function filesToDataroomAtoms(folderId, files) {
  return (files || []).map((f) => ({
    atomType: "smart-file",
    entityId: f.entityId,
    title: f.title,
    accessPolicy: f.accessPolicy,
    contentCid: f.contentCid || null,
    currentVersion: f.currentVersion,
    placements: [{ targetType: "folder", targetId: folderId }],
    bodyVerbatim: false,
  }));
}
