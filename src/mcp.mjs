/**
 * Hauska MCP client. Catalog tools are anonymous-ok.
 * Plan-review never holds the atoms DSN. Cotality is refused.
 */

const FORBIDDEN = /cotality|corelogic|get_property_detail/i;

function mcpUrl() {
  return (process.env.HAUSKA_MCP_URL || "https://hauska-mcp-server-h7gvu7rgcq-uc.a.run.app").replace(
    /\/$/,
    "",
  );
}

function parseSseOrJson(text) {
  const dataLine = text.split(/\r?\n/).find((l) => l.startsWith("data: "));
  const raw = dataLine ? dataLine.slice(6) : text;
  return JSON.parse(raw);
}

function textPayload(rpc) {
  const content = rpc?.result?.content;
  if (!Array.isArray(content)) {
    if (rpc?.error) throw new Error(rpc.error.message || "mcp error");
    return rpc;
  }
  const block = content.find((c) => c?.type === "text" && typeof c.text === "string");
  if (!block) return rpc;
  try {
    return JSON.parse(block.text);
  } catch {
    return { text: block.text };
  }
}

export async function mcpCall(name, args, key) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (key) headers["x-hauska-key"] = key;
  const res = await fetch(`${mcpUrl()}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${name}-${Date.now()}`,
      method: "tools/call",
      params: { name, arguments: args || {} },
    }),
  });
  const raw = await res.text();
  if (FORBIDDEN.test(raw)) {
    const err = new Error("cotality_extinguished");
    err.status = 400;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`mcp HTTP ${res.status}`);
    err.status = res.status;
    err.body = raw.slice(0, 400);
    throw err;
  }
  return textPayload(parseSseOrJson(raw));
}

export async function getPropertyAtomChain(parcelNodeId) {
  return mcpCall("get_property_atom_chain", { parcel_node_id: parcelNodeId });
}

export async function getAtom(atomId) {
  return mcpCall("get_atom", { atom_id: atomId });
}

function confidenceFromAtom(atom) {
  const axes = atom?.readContract?.axes || {};
  const c = axes.assertedConfidence || axes.calibratedConfidence;
  if (!c || typeof c !== "object") {
    return {
      n: 0,
      width: null,
      provenance: "asserted-baseline",
      basis: "asserted",
      note: "Calibration is a later topic. This is not an earned score.",
    };
  }
  return {
    n: c.n ?? 0,
    width: c.intervalWidth ?? c.width ?? null,
    provenance: c.provenance || "asserted",
    basis: c.provenance === "seed" ? "asserted" : c.provenance || "asserted",
    estimate: c.estimate ?? null,
    note: "From atom-chain readContract. Not an earned calibration.",
  };
}

function slotAtom(chain, slot) {
  return chain?.data?.slots?.[slot]?.atom || chain?.slots?.[slot]?.atom || null;
}

function slotDid(chain, slot) {
  return chain?.data?.slots?.[slot]?.atomDid || chain?.slots?.[slot]?.atomDid || null;
}

export function envelopeGeojson(chain) {
  const env = slotAtom(chain, "buildable-envelope");
  return env?.geojson || null;
}

export function chainBriefing(chain, parcelNodeId) {
  const data = chain?.data || chain || {};
  const slots = data.slots || {};
  const retrievedAt = new Date().toISOString();
  const steps = [];
  for (const [slot, row] of Object.entries(slots)) {
    if (!row) continue;
    const atom = row.atom;
    steps.push({
      role: atom ? "source" : row.withheld ? "withheld" : "pending",
      slot,
      atomId: row.atomDid || atom?.atomDid || null,
      citation: atom?.sourceCitation || null,
      confidence: atom ? confidenceFromAtom(atom) : null,
      retrievedAt,
      withheld: Boolean(row.withheld),
      note: atom
        ? `Atom-chain slot ${slot}. No fabricated steps.`
        : row.withheld
          ? `Slot ${slot} withheld by accessPolicy.`
          : `Slot ${slot} pending. Honest empty.`,
    });
  }
  return {
    parcelNodeId,
    status: data.status || "not_ready",
    pendingSlots: data.pendingSlots || [],
    withheldSlots: data.withheldSlots || [],
    chain: steps,
    bodyVerbatim: false,
  };
}

export function matrixFromChain(parcelNodeId, chain) {
  const zoning = slotAtom(chain, "zoning-fact");
  const setbacks = slotAtom(chain, "setback-rule");
  const flood = slotAtom(chain, "flood-hazard-fact");
  const envelope = slotAtom(chain, "buildable-envelope");
  const status = chain?.data?.status || chain?.status || "not_ready";
  const udcDistrict = zoning?.codeSectionRefs?.districtRequirements?.atomDid;
  const udcUse = zoning?.codeSectionRefs?.permittedUseTable?.atomDid;

  const ibcR302 = {
    sectionId: "R302.1",
    sectionAtomId: "icc:ibc-2018:R302.1",
    bookId: "IBC2018P6",
    citation: "2018 International Building Code Section R302.1",
    heading: "Exterior walls",
    determination: "Uncertain",
    confidence: confidenceFromAtom(setbacks || zoning || {}),
    relatedAtomId: slotDid(chain, "setback-rule") || slotDid(chain, "zoning-fact"),
    analysis: setbacks
      ? `Atom-chain ${status} on ${parcelNodeId}. District ${zoning?.district || "unknown"}. Recorded setbacks front ${setbacks.front} / side ${setbacks.side} / rear ${setbacks.rear} ft, height ${setbacks.maxHeightFt} ft. IBC exterior-wall determination stays Uncertain until calibration. No verbatim ICC body.`
      : `Atom-chain ${status} on ${parcelNodeId}. No setback-rule slot. Uncertain, not a fabricated Pass.`,
    iccDeepLink: "https://codes.iccsafe.org/content/IBC2018P6/R302.1",
  };

  const ibcR311 = {
    sectionId: "R311.7",
    sectionAtomId: "icc:ibc-2018:R311.7",
    bookId: "IBC2018P6",
    citation: "2018 International Building Code Section R311.7",
    heading: "Stairways",
    determination: "Unchecked",
    confidence: {
      n: 0,
      width: null,
      provenance: "asserted-baseline",
      basis: "asserted",
      note: "No stair atom in the chain. Unchecked is honest.",
    },
    relatedAtomId: slotDid(chain, "zoning-fact"),
    analysis: `Applicable IBC stairways section for new-single-family. Atom-chain has no stair-specific slot. Unchecked, not a fabricated Pass. Flood ${flood?.floodZone || "unknown"}.`,
    iccDeepLink: "https://codes.iccsafe.org/content/IBC2018P6/R311.7",
  };

  const udc = {
    sectionId: "14-02-003",
    sectionAtomId: udcDistrict || "did:hauska:code-section:bastrop_tx-bdc-2026-adopted/14-02-003",
    bookId: "BASTROP-UDC",
    citation: "City of Bastrop Building Block B3 Section 14-02-003",
    heading: "District requirements (SF-1)",
    determination: zoning?.district ? "Uncertain" : "Unchecked",
    confidence: confidenceFromAtom(zoning || {}),
    relatedAtomId: slotDid(chain, "zoning-fact"),
    analysis: zoning
      ? `Zoning-fact district ${zoning.district} on ${parcelNodeId}. Envelope ${envelope?.outcome?.kind || "unknown"} ${envelope?.outcome?.areaSqFt || ""} sq ft. Municipal UDC, not ICC. Calibration later.`
      : "No zoning-fact on chain.",
    iccDeepLink: null,
  };

  const udcUseRow = {
    sectionId: "14-02-008",
    sectionAtomId: udcUse || "did:hauska:code-section:bastrop_tx-bdc-2026-adopted/14-02-008",
    bookId: "BASTROP-UDC",
    citation: "City of Bastrop Building Block B3 Section 14-02-008",
    heading: "Permitted use table",
    determination: "Uncertain",
    confidence: confidenceFromAtom(zoning || {}),
    relatedAtomId: udcUse || slotDid(chain, "zoning-fact"),
    analysis: `new-single-family against permitted-use table cited by zoning-fact. Uncertain, not a fabricated Pass.`,
    iccDeepLink: null,
  };

  return [ibcR302, ibcR311, udc, udcUseRow];
}
