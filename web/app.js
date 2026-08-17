/* G-69 Plan Review product UI. WDLL items 3-5.
   Kit chrome on queue and console. Land on queue. Inverted matrix.
   Override disabled until a reason is written. Documents stay Smart Files.
   No IBC body. icc-demo is a QA tenant, not a city pack. renderTab inner logic kept. */

const CITY_KEY = "template-city";
const PERSONAS = [
  { orgId: "icc-demo", userId: "reviewer", label: "Reviewer (demo tenant)" },
  { orgId: "icc-demo", userId: "observer", label: "Observer (demo tenant)" },
  { orgId: "icc-demo", userId: "applicant", label: "Applicant (demo tenant)" },
];
const STAGES = ["Submitted", "In Review", "Approved", "Approved with Conditions", "Denied"];
const QUEUE_METRICS = [
  ["Submitted", "Submitted"],
  ["In Review", "In review"],
  ["Past deadline", "Past deadline"],
  ["Approved with Conditions", "Approved with conditions"],
];

const app = document.getElementById("app");
const errEl = document.getElementById("err");
const whoEl = document.getElementById("who");

function showErr(msg) {
  errEl.hidden = !msg;
  errEl.textContent = msg || "";
}

function personaValue() {
  return localStorage.getItem("pr_persona") || "";
}

function persona() {
  const [orgId, userId] = personaValue().split("/");
  return { orgId, userId };
}

function isReviewer() {
  return personaValue() === "icc-demo/reviewer";
}

function isApplicant() {
  return personaValue() === "icc-demo/applicant";
}

function setPersona(value) {
  localStorage.setItem("pr_persona", value);
  document.cookie = `pr_persona=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
}

function embedParam() {
  return new URL(location.href).searchParams.get("embed");
}

function isEmbedded() {
  const q = embedParam();
  if (q === "1" || q === "true") return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const ref = document.referrer || "";
  return /smartcity-dashboards|dashboards/i.test(ref);
}

function applyEmbedChrome() {
  if (isEmbedded()) document.documentElement.dataset.embed = "1";
  else delete document.documentElement.dataset.embed;
}

function go(path) {
  const next = new URL(path, location.origin);
  const cur = embedParam();
  if (cur) next.searchParams.set("embed", cur);
  else if (isEmbedded() && !next.searchParams.get("embed")) next.searchParams.set("embed", "1");
  history.pushState({}, "", next.pathname + next.search);
  render();
}

function api(path, opts = {}) {
  const u = new URL("/api/backend", location.origin);
  u.searchParams.set("path", path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== "") u.searchParams.set(k, v);
    }
  }
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (personaValue()) headers["x-persona"] = personaValue();
  return fetch(u, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (res) => {
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: "not_json", preview: text.slice(0, 180) };
    }
    if (!res.ok) {
      const err = new Error(json.message || json.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  });
}

function mountSmartSite(el, parcelNodeId, smartSiteUrl) {
  el.innerHTML = "";
  const url =
    smartSiteUrl ||
    `https://smartsite.cloud/?parcelNodeId=${encodeURIComponent(parcelNodeId || "")}`;
  const frame = document.createElement("iframe");
  frame.className = "smartsite-frame";
  frame.title = `SmartSite map ${parcelNodeId || ""}`;
  frame.src = url;
  frame.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
  el.appendChild(frame);
  const note = document.createElement("p");
  note.className = "sub";
  note.innerHTML = `${escapeHtml(parcelNodeId)} on the live SmartSite map. <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open in SmartSite</a>. Plan-review remains the host.`;
  el.appendChild(note);
}

async function loadMap(el, engagement) {
  let smartSiteUrl = null;
  try {
    const data = await api(`/api/plan-review/engagements/${engagement.id}/map-feature`);
    smartSiteUrl = data.smartSiteUrl || null;
  } catch {
    smartSiteUrl = null;
  }
  mountSmartSite(el, engagement.parcelNodeId, smartSiteUrl);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function confText(c) {
  if (!c || typeof c !== "object") return "no confidence object";
  return `n=${c.n} width=${c.width ?? "null"} provenance=${c.provenance || ""} basis=${c.basis || ""}`;
}

function pathOf() {
  return location.pathname.replace(/\/$/, "") || "/";
}

function requireGate() {
  if (!personaValue()) setPersona("icc-demo/reviewer");
  return false;
}

function showToast(text) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function isLicensedIbc(s) {
  const book = String(s?.bookId || "");
  const cite = String(s?.citation || "");
  return /IBC|icc:ibc/i.test(book) || /International Building Code/i.test(cite);
}

function corpusTitle(s) {
  if (isLicensedIbc(s)) return "2018 International Building Code";
  if (/UDC|BASTROP/i.test(s?.bookId || "")) {
    const cite = String(s.citation || "");
    const cut = cite.replace(/\s+Section\s+.*$/i, "");
    return cut || "Template Unified Development Code";
  }
  return s?.bookId || "Code";
}

function mxClass(determination) {
  const d = String(determination || "");
  if (/^pass$/i.test(d)) return "mx-pass";
  if (/^fail$/i.test(d)) return "mx-fail";
  if (/uncertain/i.test(d)) return "mx-unc";
  return "mx-unchecked";
}

function isUnresolved(determination) {
  return !/^pass$/i.test(String(determination || ""));
}

function citeChip(s) {
  const licensed = isLicensedIbc(s);
  const corpus = licensed ? "2018 International Building Code" : corpusTitle(s);
  const section = s.sectionId ? `Section ${s.sectionId}` : "";
  return `<span class="cite${licensed ? " model" : ""}"><span class="corpus">${escapeHtml(corpus)}</span><span class="section">${escapeHtml(section)}</span></span>`;
}

function bindOverrideRequiresReason(form) {
  const reason = form.querySelector("[name=reason]");
  const btn = form.querySelector("[type=submit]");
  if (!reason || !btn) return;
  const sync = () => {
    btn.disabled = !String(reason.value || "").trim();
  };
  sync();
  reason.addEventListener("input", sync);
  reason.addEventListener("change", sync);
}

function renderGate() {
  app.innerHTML = `
    <div class="pagehead">
      <div>
        <p class="crumb">Demo fixture</p>
        <h2>Gate</h2>
        <p class="sub">Pick a persona. This is not product chrome. City is ${CITY_KEY}, not icc-demo.</p>
      </div>
    </div>
    <form class="stack panel panel-body" id="gate">
      <select name="persona" class="inp">
        ${PERSONAS.map((p) => `<option value="${p.orgId}/${p.userId}">${p.label}</option>`).join("")}
      </select>
      <button type="submit" class="btn-primary">Enter queue</button>
    </form>
  `;
  document.getElementById("gate").addEventListener("submit", (e) => {
    e.preventDefault();
    setPersona(new FormData(e.target).get("persona"));
    if (isApplicant()) go("/applicant");
    else go("/queue");
  });
}

async function renderQueue() {
  if (requireGate()) return;
  const data = await api("/api/plan-review/queue");
  const counts = data.counts || {};
  const stageFilter = new URL(location.href).searchParams.get("stage") || "";
  const metrics = QUEUE_METRICS.map(([key, label]) => {
    const n = key === "Past deadline" ? 0 : counts[key] ?? 0;
    const hint = key === "Past deadline" ? "no deadline field on engagement" : "";
    return `<button type="button" class="metric" data-stage="${escapeHtml(key)}" aria-pressed="${stageFilter === key}" title="${escapeHtml(hint)}">
      <span class="n">${n}</span><span class="l">${escapeHtml(label)}</span>
    </button>`;
  }).join("");
  const rows = (data.engagements || []).filter((e) => {
    if (!stageFilter) return true;
    if (stageFilter === "Past deadline") return false;
    return e.stage === stageFilter;
  });
  app.innerHTML = `
    <div class="pagehead">
      <div>
        <p class="crumb">Work / Plan review</p>
        <h2>Queue</h2>
        <p class="sub">${data.total ?? 0} engagements. City ${CITY_KEY}. icc-demo is the QA tenant, not a city pack.</p>
      </div>
      <div class="metrics">${metrics}</div>
    </div>
    ${isReviewer() ? `<form class="stack panel panel-body" id="intake" style="margin-bottom:16px">
      <h3>Intake</h3>
      <p class="hint">Project type plus place. No upload required to start.</p>
      <input class="inp" name="parcelNodeId" value="48021:28286" required />
      <input class="inp" name="projectType" value="new-single-family" required />
      <textarea class="inp" name="scope" placeholder="Optional scope"></textarea>
      <button type="submit">Start review</button>
    </form>` : "<p class='sub'>Observer is read-only on intake.</p>"}
    <div class="panel">
      <div class="panel-head">Engagements${stageFilter ? ` · ${escapeHtml(stageFilter)}` : ""}</div>
      <table class="dt">
        <thead><tr><th></th><th>Id</th><th>Place</th><th>Stage</th><th>Type</th></tr></thead>
        <tbody>${
          rows
            .map(
              (e) => `<tr data-href="/engagements/${escapeHtml(e.id)}">
                <td><span class="rail"></span></td>
                <td class="id"><a href="/engagements/${escapeHtml(e.id)}">${escapeHtml(e.id)}</a></td>
                <td>${escapeHtml(e.parcelNodeId)}</td>
                <td><span class="pill p-info">${escapeHtml(e.stage)}</span></td>
                <td>${escapeHtml(e.projectType)}</td>
              </tr>`,
            )
            .join("") || `<tr><td colspan="5" class="sub">Empty queue.</td></tr>`
        }</tbody>
      </table>
    </div>
  `;
  app.querySelectorAll(".metric").forEach((b) => {
    b.addEventListener("click", () => {
      const stage = b.dataset.stage;
      const next = stageFilter === stage ? "/queue" : `/queue?stage=${encodeURIComponent(stage)}`;
      go(next);
    });
  });
  const form = document.getElementById("intake");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const created = await api("/api/plan-review/intake", {
        method: "POST",
        body: { ...persona(), parcelNodeId: fd.get("parcelNodeId"), projectType: fd.get("projectType"), scope: fd.get("scope") },
      });
      go(`/engagements/${created.id}?tab=matrix`);
    });
  }
}

function tabs(id, current) {
  const items = [
    ["matrix", "Applicability"],
    ["decide", "Findings"],
    ["files", "Documents"],
    ["briefing", "History"],
    ["intake", "Intake"],
    ["map", "Place"],
    ["letter", "Letter"],
  ];
  return `<div class="tabs">${items
    .map(
      ([k, label]) =>
        `<button type="button" data-tab="${k}" ${current === k ? 'aria-current="true"' : ""}>${label}</button>`,
    )
    .join("")}</div>`;
}

function outcomeCounts(sections) {
  const counts = { Fail: 0, Uncertain: 0, Unchecked: 0, Pass: 0 };
  for (const s of sections || []) {
    const d = String(s.determination || "");
    if (/^pass$/i.test(d)) counts.Pass += 1;
    else if (/^fail$/i.test(d)) counts.Fail += 1;
    else if (/uncertain/i.test(d)) counts.Uncertain += 1;
    else counts.Unchecked += 1;
  }
  return counts;
}

async function renderEngagement(id, tab) {
  if (requireGate()) return;
  const engagement = await api(`/api/plan-review/engagements/${id}`);
  let metricsHtml = "";
  try {
    const preview = await api(`/api/plan-review/engagements/${id}/matrix`);
    const c = outcomeCounts(preview.sections);
    metricsHtml = `
      <div class="metrics">
        <div class="metric"><span class="n">${c.Fail}</span><span class="l">Fails</span></div>
        <div class="metric"><span class="n">${c.Uncertain}</span><span class="l">Uncertain</span></div>
        <div class="metric"><span class="n">${c.Unchecked}</span><span class="l">Unchecked</span></div>
        <div class="metric"><span class="n">${c.Pass}</span><span class="l">Passed</span></div>
      </div>`;
  } catch {
    metricsHtml = "";
  }
  const pane = document.createElement("div");
  pane.id = "pane";
  app.innerHTML = `
    <div class="pagehead">
      <div>
        <p class="crumb"><a href="/queue">Queue</a> / ${escapeHtml(engagement.parcelNodeId)}</p>
        <h2>Review console</h2>
        <p class="sub">${escapeHtml(engagement.id)} · ${escapeHtml(engagement.stage)} · ${escapeHtml(engagement.jurisdiction || "")} · ${escapeHtml(engagement.projectType)} · city ${CITY_KEY}</p>
      </div>
      ${metricsHtml}
    </div>
    ${tabs(id, tab)}
  `;
  app.appendChild(pane);
  app.querySelectorAll("[data-tab]").forEach((b) => {
    b.addEventListener("click", () => go(`/engagements/${id}?tab=${b.dataset.tab}`));
  });
  await renderTab(pane, engagement, tab);
}

async function renderTab(pane, engagement, tab) {
  const id = engagement.id;
  if (tab === "intake") {
    pane.innerHTML = `
      <p>Parcel ${escapeHtml(engagement.parcelNodeId)}</p>
      <p>Project ${escapeHtml(engagement.projectType)}</p>
      <p>Jurisdiction ${escapeHtml(engagement.jurisdiction || "from parcel-node")}</p>
      <p>Scope ${escapeHtml(engagement.scopeText || "(none)")}</p>
      <p>Folder ${escapeHtml(engagement.filesFolderId || "(none yet)")}</p>
      <p class="sub">Zero Cotality. Geocode is extinguished. City ${CITY_KEY}.</p>
      <div id="intake-map"></div>
    `;
    await loadMap(document.getElementById("intake-map"), engagement);
    return;
  }
  if (tab === "matrix") {
    const data = await api(`/api/plan-review/engagements/${id}/matrix`);
    const unresolvedOnly = new URL(location.href).searchParams.get("all") !== "1";
    const sections = data.sections || [];
    const groups = new Map();
    for (const s of sections) {
      if (unresolvedOnly && !isUnresolved(s.determination)) continue;
      const key = corpusTitle(s);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const grouped = [...groups.entries()]
      .map(([title, rows]) => {
        const items = rows
          .map((s) => {
            const cls = mxClass(s.determination);
            const analysis = isLicensedIbc(s) ? "" : `<div>${escapeHtml(s.analysis || "")}</div>`;
            return `<div class="mxrow ${cls}">
              <span class="rail"></span>
              <div>
                ${citeChip(s)}
                <div>${escapeHtml(s.heading || "")}</div>
                ${analysis}
                <div class="sub">atom ${escapeHtml(s.sectionAtomId)} · ${escapeHtml(confText(s.confidence))}</div>
                ${s.iccDeepLink ? `<a href="${escapeHtml(s.iccDeepLink)}">ICC deep-link</a>` : ""}
              </div>
              <span class="pill ${cls === "mx-fail" ? "p-crit" : cls === "mx-unc" ? "p-warn" : cls === "mx-pass" ? "p-quiet" : "p-quiet"}">${escapeHtml(s.determination)}</span>
            </div>`;
          })
          .join("");
        return `<section class="mxgroup"><h3 class="mxgroup-title">${escapeHtml(title)}</h3>${items || `<p class="sub">No unresolved rows in this corpus.</p>`}</section>`;
      })
      .join("");
    pane.innerHTML = `<p class="sub">atom-chain ${escapeHtml(data.chainStatus || "")} · bodyVerbatim=${data.bodyVerbatim} · IBC body is not rendered.</p>
      <div class="filterbar">
        <button type="button" class="chip" id="unresolved" aria-pressed="${unresolvedOnly}">Unresolved only</button>
        <button type="button" class="chip" id="allrows" aria-pressed="${!unresolvedOnly}">All</button>
      </div>
      <div class="mx panel">${grouped || `<div class="panel-body sub">No rows.</div>`}</div>
      <div id="matrix-map"></div>`;
    document.getElementById("unresolved").addEventListener("click", () => go(`/engagements/${id}?tab=matrix`));
    document.getElementById("allrows").addEventListener("click", () => go(`/engagements/${id}?tab=matrix&all=1`));
    await loadMap(document.getElementById("matrix-map"), engagement);
    return;
  }
  if (tab === "decide") {
    const [matrix, canned] = await Promise.all([
      api(`/api/plan-review/engagements/${id}/matrix`),
      api("/api/plan-review/canned"),
    ]);
    const templates = canned.templates || [];
    pane.innerHTML = isReviewer()
      ? `<form class="stack panel panel-body" id="override">
          <p class="hint">Override stays disabled until a reason is written. The reason is recorded with a name and a time.</p>
          <select class="inp" name="sectionAtomId">${(matrix.sections || [])
            .map((s) => `<option value="${escapeHtml(s.sectionAtomId)}">${escapeHtml(s.sectionId)} ${escapeHtml(s.determination)}</option>`)
            .join("")}</select>
          <select class="inp" name="determination">
            <option>Pass</option><option>Fail</option><option>Uncertain</option><option>Unchecked</option>
          </select>
          <select class="inp" name="stage">${STAGES.map((s) => `<option ${s === "In Review" ? "selected" : ""}>${s}</option>`).join("")}</select>
          <div class="field">
            <label for="override-reason">Reason</label>
            <textarea class="inp" id="override-reason" name="reason" placeholder="Override reason" required></textarea>
          </div>
          <textarea class="inp" name="analysis" placeholder="Analysis text"></textarea>
          <label>Canned template</label>
          <select class="inp" id="canned"><option value="">(none)</option>${templates
            .map((t) => `<option value="${escapeHtml(t.body)}">${escapeHtml(t.label || t.sectionId)}</option>`)
            .join("")}</select>
          <button type="submit" disabled>Write adjudication</button>
        </form>`
      : `<p class="sub">Observer cannot override.</p>`;
    const cannedSel = document.getElementById("canned");
    if (cannedSel) {
      cannedSel.addEventListener("change", () => {
        if (cannedSel.value) pane.querySelector("[name=analysis]").value = cannedSel.value;
      });
    }
    const form = document.getElementById("override");
    if (form) {
      bindOverrideRequiresReason(form);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const reason = String(fd.get("reason") || "").trim();
        if (!reason) return;
        await api(`/api/plan-review/engagements/${id}/override`, {
          method: "POST",
          body: {
            ...persona(),
            sectionAtomId: fd.get("sectionAtomId"),
            determination: fd.get("determination"),
            reason,
            analysis: fd.get("analysis"),
            stage: fd.get("stage"),
          },
        });
        showToast("Determination recorded");
        go(`/engagements/${id}?tab=matrix`);
      });
    }
    return;
  }
  if (tab === "files") {
    let docs = { documents: [], folderId: engagement.filesFolderId, store: "smart-files" };
    let docsError = "";
    try {
      docs = await api(`/api/plan-review/engagements/${id}/documents`);
    } catch (err) {
      docsError = err.message || "documents_unavailable";
    }
    let picker = null;
    let pickerBasis = "";
    try {
      picker = await api("/api/smart-files/folders", {
        query: { scopeType: "tenant", scopeId: CITY_KEY },
      });
    } catch (err) {
      pickerBasis = err.message || "Smart Files mount unavailable";
    }
    const listed = docs.documents || [];
    const folders = picker?.folders || [];
    const attachBlock = picker && folders.length
      ? `<div class="panel" id="sf-picker">
          <div class="panel-head">Attach from Smart Files</div>
          <div class="panel-body">
            <p class="hint">Picker lists Files the acting tenant can see. No pf_documents. Attach does not write a local blob table.</p>
            <ul class="list">${folders
              .map((f) => `<li>${escapeHtml(f.label || f.folderId)}<div class="mono">${escapeHtml(f.folderId)}</div></li>`)
              .join("")}</ul>
            <p class="basisline" id="sheet-ref">No file selected. Finding sheet reference waits a file id.</p>
          </div>
        </div>`
      : `<div class="honest">
          <h3>Files not attached</h3>
          <p>Documents stay in Smart Files. This host does not own a document table and does not write pf_documents.</p>
          <p class="basisline">Basis: ${escapeHtml(pickerBasis || docsError || "Smart Files folder list empty or mount down")}. Contact Files for the acting tenant.</p>
        </div>`;
    pane.innerHTML = `
      <p class="sub">folder ${escapeHtml(docs.folderId || engagement.filesFolderId || "none")} · store ${escapeHtml(docs.store || "smart-files")}</p>
      <ul class="list">${listed
        .map((f) => `<li>${escapeHtml(f.title || f.entityId)}<div class="mono sheet-id">${escapeHtml(f.entityId)}</div></li>`)
        .join("") || "<li class='sub'>No sheets in the engagement folder yet.</li>"}</ul>
      ${attachBlock}
      ${isReviewer() ? `<div class="share-box">
        <p>Share the applicant view on this plan-review host. Smart Files stores the bytes. Do not send the applicant to smart-files-app.</p>
        <button type="button" id="share">Share applicant view</button>
        <p id="share-out" class="sub" hidden></p>
        <p id="share-link" class="sub" hidden></p>
      </div>` : `<p class="sub">${isApplicant() ? "Applicant view is this plan-review UI. Load files as reviewer, then share the applicant link." : "Observer can see the room. Reviewer attaches from Smart Files."}</p>`}
    `;
    const pickerRoot = document.getElementById("sf-picker");
    if (pickerRoot) {
      pickerRoot.querySelectorAll("li").forEach((li) => {
        li.style.cursor = "pointer";
        li.addEventListener("click", () => {
          const fileId = li.querySelector(".mono")?.textContent || "";
          const ref = document.getElementById("sheet-ref");
          if (ref) ref.textContent = `Sheet reference file id ${fileId}. Access stays with the Files room.`;
        });
      });
    }
    const share = document.getElementById("share");
    if (share) {
      share.addEventListener("click", async () => {
        const out = await api(`/api/plan-review/engagements/${id}/share`, {
          method: "POST",
          body: persona(),
        });
        const url = out.dataRoomUrl || "";
        const outEl = document.getElementById("share-out");
        const linkEl = document.getElementById("share-link");
        outEl.hidden = false;
        outEl.textContent = `folder ${out.folderId || ""} · kind ${out.kind || "data-room"} · store ${out.store || "smart-files"}`;
        linkEl.hidden = false;
        if (url) {
          linkEl.innerHTML = `Applicant view: <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`;
          try {
            await navigator.clipboard.writeText(url);
            linkEl.innerHTML += " (copied)";
          } catch {
            /* clipboard may be blocked; URL is still on screen */
          }
        } else {
          linkEl.textContent = "Share succeeded but no dataRoomUrl. Do not invent a link.";
        }
      });
    }
    return;
  }
  if (tab === "map") {
    pane.innerHTML = `<div id="tab-map"></div>`;
    await loadMap(document.getElementById("tab-map"), engagement);
    return;
  }
  if (tab === "briefing") {
    const matrix = await api(`/api/plan-review/engagements/${id}/matrix`);
    const first = (matrix.sections || [])[0];
    const data = await api(`/api/plan-review/engagements/${id}/briefing`, {
      query: { sectionAtomId: first?.sectionAtomId || "" },
    });
    pane.innerHTML = `<p class="sub">chain status ${escapeHtml(data.status || "")} · pending ${escapeHtml((data.pendingSlots || []).join(","))}</p>
      <ul class="list">${(data.chain || [])
      .map(
        (step) => `<li>
          <div>${escapeHtml(step.role)} · ${escapeHtml(step.slot || "")} · ${escapeHtml(step.atomId || "")}</div>
          <div>${citeChip({ citation: step.citation, sectionId: step.sectionId, bookId: step.bookId })}</div>
          <div class="sub">${escapeHtml(confText(step.confidence))} · ${escapeHtml(step.retrievedAt || "")}</div>
          <p>${escapeHtml(step.note || "")}</p>
        </li>`,
      )
      .join("") || "<li class='sub'>No chain.</li>"}</ul>
      <p class="sub">bodyVerbatim=${data.bodyVerbatim}</p>`;
    return;
  }
  if (tab === "letter") {
    let letter = await api(`/api/plan-review/engagements/${id}/letter`);
    const matrix = await api(`/api/plan-review/engagements/${id}/matrix`);
    const rows = (matrix.sections || [])
      .map((s) => {
        const cls = mxClass(s.determination);
        return `<div class="finding ${cls}">
          <span class="rail"></span>
          <div>
            <div class="mono">${escapeHtml(s.sectionAtomId)}</div>
            <p>${escapeHtml(s.heading || s.citation || "")}</p>
            ${citeChip(s)}
            <span class="pill ${cls === "mx-fail" ? "p-crit" : cls === "mx-unc" ? "p-warn" : "p-quiet"}">${escapeHtml(s.determination)}</span>
          </div>
        </div>`;
      })
      .join("");
    pane.innerHTML = `
      ${isReviewer() ? `<button type="button" id="gen">Generate letter</button>` : ""}
      <div class="panel" id="letter-rows">${rows || "<div class='panel-body sub'>No finding rows.</div>"}</div>
      <div id="letter-out"></div>
    `;
    const out = document.getElementById("letter-out");
    function showLetter(html) {
      out.innerHTML = "";
      if (!html) return;
      const frame = document.createElement("iframe");
      frame.title = "letter";
      frame.style.cssText = "width:100%;min-height:280px;border:1px solid var(--sc-line)";
      frame.srcdoc = html;
      out.appendChild(frame);
    }
    showLetter(letter.html);
    const gen = document.getElementById("gen");
    if (gen) {
      gen.addEventListener("click", async () => {
        letter = await api(`/api/plan-review/engagements/${id}/letter/generate`, {
          method: "POST",
          body: persona(),
        });
        showLetter(letter.html);
      });
    }
  }
}

async function renderLibrary() {
  if (requireGate()) return;
  app.innerHTML = `
    <div class="pagehead"><div><p class="crumb">Work / Plan review</p><h2>Findings library</h2></div></div>
    <form class="stack panel panel-body" id="lib">
      <input class="inp" name="sectionId" value="R311.7" required />
      <button type="submit">Search by section</button>
    </form>
    <div id="hits"></div>
  `;
  async function run(sectionId) {
    const data = await api("/api/plan-review/findings", { query: { sectionId } });
    document.getElementById("hits").innerHTML = `<ul class="list">${(data.findings || [])
      .map(
        (f) =>
          `<li>${escapeHtml(f.parcelNodeId || f.engagementId)} · ${escapeHtml(f.sectionId)} · ${escapeHtml(f.determination)}
           <div class="sub">${escapeHtml(f.engagementId)} · atom ${escapeHtml(f.sectionAtomId)}</div></li>`,
      )
      .join("") || "<li class='sub'>No hits.</li>"}</ul>`;
  }
  document.getElementById("lib").addEventListener("submit", (e) => {
    e.preventDefault();
    run(new FormData(e.target).get("sectionId"));
  });
  await run("R311.7");
}

async function renderCode() {
  if (requireGate()) return;
  app.innerHTML = `
    <div class="pagehead"><div><p class="crumb">Work / Plan review</p><h2>Code library</h2>
      <p class="sub">Licensed IBC: full title, no body. Local UDC may quote. City ${CITY_KEY}.</p></div></div>
    <form class="stack panel panel-body" id="code">
      <select class="inp" name="book">
        <option value="IBC2018P6">2018 International Building Code</option>
        <option value="BASTROP-UDC">Template / Bastrop UDC</option>
        <option value="IPMC2018P2">IPMC 2018</option>
      </select>
      <input class="inp" name="chapter" placeholder="chapter" />
      <input class="inp" name="section" value="R311.7" placeholder="section" />
      <button type="submit">Open</button>
    </form>
    <div id="code-out" class="panel panel-body"></div>
  `;
  async function run(book, chapter, section) {
    const data = await api("/api/plan-review/code", { query: { book, chapter, section } });
    const licensed = /IBC/i.test(data.book || book);
    const out = document.getElementById("code-out");
    const citation = data.citation || (licensed ? `2018 International Building Code Section ${data.section || section}` : `${data.book} ${data.section || section}`);
    const quote = licensed ? "" : data.analysis ? `<p>${escapeHtml(data.analysis)}</p>` : "";
    out.innerHTML = `
      ${citeChip({ bookId: data.book, citation, sectionId: data.section || section })}
      <p>${escapeHtml(data.heading || "")}</p>
      ${quote}
      <p class="sub">bodyVerbatim=${data.bodyVerbatim} · ${licensed ? "IBC body omitted" : "local ordinance may quote"}</p>
      ${data.chapters ? `<p class="sub">chapters ${escapeHtml((data.chapters || []).join(", "))} · sections ${escapeHtml((data.sections || []).join(", "))}</p>` : ""}
      ${data.absence ? `<p class="honest">${escapeHtml(data.absence.basis || data.status || "")}</p>` : ""}
    `;
  }
  document.getElementById("code").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    run(fd.get("book"), fd.get("chapter"), fd.get("section"));
  });
  await run("IBC2018P6", "", "R311.7");
}

async function renderApplicant() {
  const token = new URL(location.href).searchParams.get("token") || "";
  if (!token) {
    app.innerHTML = `
      <div class="pagehead"><div><h2>My requests</h2>
      <p class="sub">Public applicant view. No reviewer name. No matrix.</p></div></div>
      <div class="honest">
        <h3>No share link</h3>
        <p>Open the link the reviewer shared. Status stays in public vocabulary.</p>
      </div>
    `;
    return;
  }
  const data = await api("/api/plan-review/applicant/room", { query: { token } });
  const eng = data.engagement || {};
  const publicStage = /awaiting|applicant/i.test(eng.stage || "") ? "Waiting on you" : /review/i.test(eng.stage || "") ? "In review" : eng.stage || "";
  app.innerHTML = `
    <div class="pagehead"><div><h2>My requests</h2>
    <p class="sub">Plan-review applicant view. Store=${escapeHtml(data.store || "smart-files")}.</p></div></div>
    <div class="panel panel-body">
      <p>Place ${escapeHtml(eng.parcelNodeId || "(not linked)")}</p>
      <p>Status <span class="pill p-info">${escapeHtml(publicStage)}</span></p>
      <p class="sub">folder ${escapeHtml(data.folderId || "none")}</p>
      <ul class="list">${(data.files || [])
        .map((f) => `<li>${escapeHtml(f.title || f.entityId)}<div class="mono">${escapeHtml(f.entityId)}</div></li>`)
        .join("") || "<li class='sub'>No files in this room yet.</li>"}</ul>
      <p class="sub">${escapeHtml(data.note || "")}</p>
    </div>
  `;
}

function markNav() {
  const path = pathOf();
  document.querySelectorAll(".product-switch a").forEach((a) => {
    const href = a.getAttribute("href");
    a.setAttribute("aria-current", href === path || (path === "/" && href === "/queue") ? "true" : "false");
  });
}

async function render() {
  showErr("");
  applyEmbedChrome();
  whoEl.textContent = personaValue() || (pathOf() === "/applicant" ? "applicant" : "staff");
  markNav();
  const path = pathOf();
  const tab = new URL(location.href).searchParams.get("tab") || "matrix";
  try {
    if (path === "/applicant") {
      await renderApplicant();
      return;
    }
    if (path === "/gate") {
      renderGate();
      return;
    }
    if (path === "/queue" || path === "/") {
      await renderQueue();
      return;
    }
    const eng = path.match(/^\/engagements\/([^/]+)$/);
    if (eng) {
      await renderEngagement(eng[1], tab);
      return;
    }
    if (path === "/library") {
      await renderLibrary();
      return;
    }
    if (path === "/code") {
      await renderCode();
      return;
    }
    if (path === "/icc/activity" || path === "/icc") {
      app.innerHTML = `<p>ICC Demo is a separate portal and domain. It is not a path on plan review. City is ${CITY_KEY}.</p><p><a href="/queue">Queue</a></p>`;
      return;
    }
    app.innerHTML = `<p>Unknown route. Use queue, library, code, or applicant.</p>`;
  } catch (err) {
    showErr(err.message);
  }
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a) return;
  const href = a.getAttribute("href");
  if (href && href.startsWith("/") && !a.target) {
    e.preventDefault();
    go(href);
  }
});

window.addEventListener("popstate", render);
render();
