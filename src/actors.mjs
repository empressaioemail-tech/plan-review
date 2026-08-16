/** QA personas. Not G-11. Not a login product. Tenant must be shared for files rooms. */
export const QA_PERSONAS = [
  { orgId: "icc-demo", userId: "reviewer", label: "Empressa reviewer / icc-demo" },
  { orgId: "icc-demo", userId: "observer", label: "ICC observer / icc-demo" },
];

export function resolvePersona(orgId, userId) {
  const org = String(orgId || "").trim();
  const user = String(userId || "").trim();
  return QA_PERSONAS.find((p) => p.orgId === org && p.userId === user) ?? null;
}

export function actorKey(orgId, userId) {
  return `${orgId}/${userId}`;
}
