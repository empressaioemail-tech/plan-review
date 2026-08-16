const PERSONAS = [
  { orgId: "icc-demo", userId: "reviewer", label: "Reviewer / icc-demo" },
  { orgId: "icc-demo", userId: "observer", label: "Observer / icc-demo" },
  { orgId: "icc-demo", userId: "applicant", label: "Applicant / icc-demo" },
];
const STAGES = ["Submitted", "In Review", "Approved", "Approved with Conditions", "Denied"];
const ICC_ACTOR = "did:hauska:actor:org:icc";

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

function isObserver() {
  return personaValue() === "icc-demo/observer";
}

function setPersona(value) {
  localStorage.setItem("pr_persona", value);
  document.cookie = `pr_persona=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
}

function go(path) {
  history.pushState({}, "", path);
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.includes(",") ? s.slice(s.indexOf(",") + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
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

function requireGate(next) {
  if (!personaValue()) {
    go("/gate");
    return true;
  }
  return false;
}

function renderGate() {
  app.innerHTML = `
    <h2>Gate</h2>
    <p class="sub">Pick a persona. Unauthed ICC content is refused.</p>
    <form class="stack" id="gate">
      <select name="persona">
        ${PERSONAS.map((p) => `<option value="${p.orgId}/${p.userId}">${p.label}</option>`).join("")}
      </select>
      <button type="submit">Enter</button>
    </form>
  `;
  document.getElementById("gate").addEventListener("submit", (e) => {
    e.preventDefault();
    setPersona(new FormData(e.target).get("persona"));
    if (isObserver()) go("/icc/activity");
    else if (isApplicant()) go("/applicant");
    else go("/queue");
  });
}

async function renderQueue() {
  if (requireGate()) return;
  const data = await api("/api/plan-review/queue");
  const buckets = STAGES.map((stage) => {
    const items = (data.engagements || []).filter((e) => e.stage === stage);
    const n = data.counts?.[stage] ?? items.length;
    return `<div class="card">
      <h3>${escapeHtml(stage)}</h3>
      <p class="meta">${n}</p>
      <ul class="list">${items
        .map(
          (e) =>
            `<li><a href="/engagements/${e.id}">${escapeHtml(e.parcelNodeId)}</a>
             <div class="meta">${escapeHtml(e.id)} · ${escapeHtml(e.projectType)} · cotality ${e.cotalityCalls ?? 0}</div></li>`,
        )
        .join("") || "<li class='meta'>Empty</li>"}</ul>
    </div>`;
  }).join("");
  app.innerHTML = `
    <h2>Queue</h2>
    <p class="sub">Total ${data.total ?? 0}. Click an engagement to open intake / matrix.</p>
    ${isReviewer() ? `<form class="stack" id="intake">
      <h3>Intake</h3>
      <input name="parcelNodeId" value="48021:28286" required />
      <input name="projectType" value="new-single-family" required />
      <textarea name="scope" placeholder="Optional scope"></textarea>
      <button type="submit">Start review</button>
    </form>` : "<p class='sub'>Observer is read-only on intake.</p>"}
    <div class="grid">${buckets}</div>
  `;
  const form = document.getElementById("intake");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const created = await api("/api/plan-review/intake", {
        method: "POST",
        body: { ...persona(), parcelNodeId: fd.get("parcelNodeId"), projectType: fd.get("projectType"), scope: fd.get("scope") },
      });
      go(`/engagements/${created.id}`);
    });
  }
}

function tabs(id, current) {
  const items = [
    ["intake", "Intake"],
    ["matrix", "Matrix"],
    ["decide", "Decide"],
    ["files", "Files"],
    ["map", "Map"],
    ["briefing", "Briefing"],
    ["letter", "Letter"],
  ];
  return `<div class="tabs">${items
    .map(
      ([k, label]) =>
        `<button type="button" data-tab="${k}" ${current === k ? 'aria-current="true"' : ""}>${label}</button>`,
    )
    .join("")}</div>`;
}

async function renderEngagement(id, tab) {
  if (requireGate()) return;
  const engagement = await api(`/api/plan-review/engagements/${id}`);
  const pane = document.createElement("div");
  pane.id = "pane";
  app.innerHTML = `
    <p class="sub"><a href="/queue">Queue</a></p>
    <h2>${escapeHtml(engagement.parcelNodeId)}</h2>
    <p class="meta">${escapeHtml(engagement.id)} · ${escapeHtml(engagement.stage)} · ${escapeHtml(engagement.jurisdiction || "")} · type ${escapeHtml(engagement.projectType)} · cotality ${engagement.cotalityCalls ?? 0}</p>
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
      <p class="sub">Zero Cotality. Geocode is extinguished.</p>
      <div id="intake-map"></div>
    `;
    await loadMap(document.getElementById("intake-map"), engagement);
    return;
  }
  if (tab === "matrix") {
    const data = await api(`/api/plan-review/engagements/${id}/matrix`);
    pane.innerHTML = `<p class="meta">atom-chain ${escapeHtml(data.chainStatus || "")} · bodyVerbatim=${data.bodyVerbatim}</p>
      <ul class="list">${(data.sections || [])
      .map((s) => {
        const uncertain = /uncertain|unchecked/i.test(s.determination || "") ? "uncertain" : "";
        return `<li>
          <div class="${uncertain}">${escapeHtml(s.citation || s.sectionId)} — ${escapeHtml(s.determination)}</div>
          <div>${escapeHtml(s.heading || "")}</div>
          <div>${escapeHtml(s.analysis || "")}</div>
          <div class="meta">atom ${escapeHtml(s.sectionAtomId)} · ${escapeHtml(confText(s.confidence))} · book ${escapeHtml(s.bookId || "")}</div>
          ${s.iccDeepLink ? `<a href="${escapeHtml(s.iccDeepLink)}">ICC deep-link</a>` : ""}
        </li>`;
      })
      .join("")}</ul>
      <div id="matrix-map"></div>`;
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
      ? `<form class="stack" id="override">
          <select name="sectionAtomId">${(matrix.sections || [])
            .map((s) => `<option value="${escapeHtml(s.sectionAtomId)}">${escapeHtml(s.sectionId)} ${escapeHtml(s.determination)}</option>`)
            .join("")}</select>
          <select name="determination">
            <option>Pass</option><option>Fail</option><option>Uncertain</option><option>Unchecked</option>
          </select>
          <select name="stage">${STAGES.map((s) => `<option ${s === "In Review" ? "selected" : ""}>${s}</option>`).join("")}</select>
          <textarea name="reason" placeholder="Override reason" required></textarea>
          <textarea name="analysis" placeholder="Analysis text"></textarea>
          <label>Canned template</label>
          <select id="canned"><option value="">(none)</option>${templates
            .map((t) => `<option value="${escapeHtml(t.body)}">${escapeHtml(t.label || t.sectionId)}</option>`)
            .join("")}</select>
          <button type="submit">Write adjudication</button>
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
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        await api(`/api/plan-review/engagements/${id}/override`, {
          method: "POST",
          body: {
            ...persona(),
            sectionAtomId: fd.get("sectionAtomId"),
            determination: fd.get("determination"),
            reason: fd.get("reason"),
            analysis: fd.get("analysis"),
            stage: fd.get("stage"),
          },
        });
        go(`/engagements/${id}?tab=matrix`);
      });
    }
    return;
  }
  if (tab === "files") {
    const docs = await api(`/api/plan-review/engagements/${id}/documents`);
    pane.innerHTML = `
      <p class="meta">folder ${escapeHtml(docs.folderId || engagement.filesFolderId || "none")} · store ${escapeHtml(docs.store || "smart-files")}</p>
      <ul class="list">${(docs.documents || [])
        .map((f) => `<li>${escapeHtml(f.title || f.entityId)}<div class="meta">${escapeHtml(f.entityId)}</div></li>`)
        .join("") || "<li class='meta'>No sheets yet.</li>"}</ul>
      ${isReviewer() ? `<form class="stack" id="upload"><input type="file" name="file" required /><button type="submit">Upload to this engagement</button></form>
      <div class="share-box">
        <p>Share the applicant view on this plan-review host. Smart Files stores the bytes. Do not send the applicant to smart-files-app.</p>
        <button type="button" id="share">Share applicant view</button>
        <p id="share-out" class="meta" hidden></p>
        <p id="share-link" class="sub" hidden></p>
      </div>` : `<p class="sub">${isApplicant() ? "Applicant view is this plan-review UI. Load files as reviewer, then share the applicant link." : "Observer can see the room. Reviewer loads files here."}</p>`}
    `;
    const form = document.getElementById("upload");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const file = form.file.files[0];
        const bytesBase64 = await fileToBase64(file);
        await api(`/api/plan-review/engagements/${id}/documents`, {
          method: "POST",
          body: {
            ...persona(),
            title: file.name,
            contentType: file.type || "application/octet-stream",
            bytesBase64,
          },
        });
        go(`/engagements/${id}?tab=files`);
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
    pane.innerHTML = `<p class="meta">chain status ${escapeHtml(data.status || "")} · pending ${escapeHtml((data.pendingSlots || []).join(","))}</p>
      <ul class="list">${(data.chain || [])
      .map(
        (step) => `<li>
          <div>${escapeHtml(step.role)} · ${escapeHtml(step.slot || "")} · ${escapeHtml(step.atomId || "")}</div>
          <div>${escapeHtml(step.citation || "")}</div>
          <div class="meta">${escapeHtml(confText(step.confidence))} · ${escapeHtml(step.retrievedAt || "")}</div>
          <p>${escapeHtml(step.note || "")}</p>
        </li>`,
      )
      .join("") || "<li class='meta'>No chain.</li>"}</ul>
      <p class="meta">bodyVerbatim=${data.bodyVerbatim}</p>`;
    return;
  }
  if (tab === "letter") {
    let letter = await api(`/api/plan-review/engagements/${id}/letter`);
    pane.innerHTML = `
      ${isReviewer() ? `<button type="button" id="gen">Generate letter</button>` : ""}
      <div id="letter-out"></div>
    `;
    const out = document.getElementById("letter-out");
    function showLetter(html) {
      out.innerHTML = "";
      if (!html) {
        out.innerHTML = "<p class='sub'>No letter yet.</p>";
        return;
      }
      const frame = document.createElement("iframe");
      frame.title = "letter";
      frame.style.cssText = "width:100%;min-height:420px;border:1px solid #ddd";
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
    <h2>Findings library</h2>
    <form class="stack" id="lib">
      <input name="sectionId" value="R311.7" required />
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
           <div class="meta">${escapeHtml(f.engagementId)} · atom ${escapeHtml(f.sectionAtomId)}</div></li>`,
      )
      .join("") || "<li class='meta'>No hits.</li>"}</ul>`;
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
    <h2>Code library</h2>
    <form class="stack" id="code">
      <select name="book">
        <option value="IBC2018P6">IBC 2018</option>
        <option value="BASTROP-UDC">Bastrop UDC</option>
        <option value="IPMC2018P2">IPMC 2018</option>
      </select>
      <input name="chapter" placeholder="chapter" />
      <input name="section" value="R311.7" placeholder="section" />
      <button type="submit">Open</button>
    </form>
    <pre id="code-out" class="meta"></pre>
  `;
  async function run(book, chapter, section) {
    const data = await api("/api/plan-review/code", { query: { book, chapter, section } });
    document.getElementById("code-out").textContent = JSON.stringify(data, null, 2);
    if (data.chapters) {
      const nav = document.createElement("p");
      nav.className = "sub";
      nav.textContent = `chapters ${data.chapters.join(", ")} · sections ${(data.sections || []).join(", ")}`;
      document.getElementById("code-out").before(nav);
    }
  }
  document.getElementById("code").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    run(fd.get("book"), fd.get("chapter"), fd.get("section"));
  });
  await run("IBC2018P6", "", "R311.7");
}

async function renderActivity() {
  if (requireGate()) return;
  const data = await api("/api/icc/activity", { query: { actorDid: ICC_ACTOR } });
  const summary = data.summary || { n: 0, amount: 0, bySource: [] };
  const sources = (summary.bySource || [])
    .map((s) => `${s.source} ${s.n}/${s.amount}`)
    .join(" · ");
  const rows = data.rows || [];
  app.innerHTML = `
    <h2>ICC activity portal</h2>
    <p>This is ICC's view of plan-review citations. Command Center is not this portal. The activity table is the store for this demo.</p>
    <p class="sub">Actor ${escapeHtml(data.actorDid)} · host ${escapeHtml(data.host || "plan-review")} · store ${escapeHtml(data.store || "plan-review-activity")}</p>
    <div class="grid">
      <div class="card"><h3>Fixture rate</h3><p>${escapeHtml(String(data.fixtureRate ?? 0.01))}</p><p class="meta">${escapeHtml(data.rateLabel || "")}</p></div>
      <div class="card"><h3>Accrued</h3><p>${escapeHtml(String(summary.n))} rows</p><p class="meta">amount ${escapeHtml(String(summary.amount))}</p></div>
      <div class="card"><h3>Books</h3><p>IBC 2018 ${escapeHtml(data.entitled?.IBC2018P6 || "live")}</p><p class="meta">IPMC 2018 ${escapeHtml(data.entitled?.IPMC2018P2 || "typed-absence")}</p></div>
      <div class="card"><h3>Sources</h3><p class="meta">${escapeHtml(sources || "none")}</p></div>
    </div>
    <table class="activity">
      <thead>
        <tr>
          <th>When</th><th>Source</th><th>Book</th><th>Section</th><th>Engagement</th><th>Rate</th><th>Amount</th><th>Tier</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows
            .map((r) => {
              const eng = r.engagementId
                ? `<a href="/engagements/${escapeHtml(r.engagementId)}">${escapeHtml(r.engagementId.slice(0, 8))}</a>`
                : "";
              return `<tr>
                <td class="meta">${escapeHtml(r.createdAt || "")}</td>
                <td>${escapeHtml(r.source || "")}</td>
                <td>${escapeHtml(r.bookId || "")}</td>
                <td>${escapeHtml(r.sectionId || "")}</td>
                <td>${eng}</td>
                <td>${escapeHtml(String(r.rate ?? ""))}</td>
                <td>${escapeHtml(String(r.amount ?? ""))}</td>
                <td>${escapeHtml(r.tier || "")}</td>
              </tr>`;
            })
            .join("") || `<tr><td colspan="8" class="meta">No rows yet. Reviewer work and MCP Codex calls accrue here. Planner does not seed them.</td></tr>`
        }
      </tbody>
    </table>
    <p class="footer">${escapeHtml(data.ipmcResidual || "IPMC 2018 not ingested (G-41)")}.
      Purge selectors: sourceAdapter=${escapeHtml(data.purge?.sourceAdapter || "icc-code-connect")},
      jurisdictionTenant=${escapeHtml(data.purge?.jurisdictionTenant || "icc-model-code")}.
      Not a customer-facing surface. ${escapeHtml(data.note || "")}</p>
  `;
  document.querySelectorAll(".activity a[href^='/engagements/']").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      go(a.getAttribute("href"));
    });
  });
}

async function renderApplicant() {
  const token = new URL(location.href).searchParams.get("token") || "";
  if (!token) {
    app.innerHTML = `
      <h2>Applicant</h2>
      <p>This is the plan-review applicant view. Open the link the reviewer shared. Smart Files is the file store, not this screen's host.</p>
      <p class="sub">No token. Ask the reviewer to share the applicant view from the Files tab.</p>
    `;
    return;
  }
  const data = await api("/api/plan-review/applicant/room", { query: { token } });
  const eng = data.engagement || {};
  app.innerHTML = `
    <h2>Applicant</h2>
    <p class="sub">Plan-review applicant view. Store=${escapeHtml(data.store || "smart-files")}. Host=${escapeHtml(data.host || "plan-review")}.</p>
    <p>Parcel ${escapeHtml(eng.parcelNodeId || "(not linked)")} · ${escapeHtml(eng.jurisdiction || "")} · stage ${escapeHtml(eng.stage || "")}</p>
    <p class="meta">folder ${escapeHtml(data.folderId || "none")}</p>
    <ul class="list">${(data.files || [])
      .map((f) => `<li>${escapeHtml(f.title || f.entityId)}<div class="meta">${escapeHtml(f.entityId)}</div></li>`)
      .join("") || "<li class='meta'>No files in this room yet. The reviewer loads them in plan review.</li>"}</ul>
    <p class="sub">${escapeHtml(data.note || "")}</p>
  `;
}

async function render() {
  showErr("");
  whoEl.textContent = personaValue() || (pathOf() === "/applicant" ? "applicant" : "not gated");
  const path = pathOf();
  const tab = new URL(location.href).searchParams.get("tab") || "intake";
  const iccNav = document.querySelector('nav a[href="/icc/activity"]');
  if (iccNav) iccNav.hidden = isApplicant() || path === "/applicant";
  try {
    if (path === "/applicant") {
      await renderApplicant();
      return;
    }
    if (path === "/gate" || path === "/") {
      renderGate();
      return;
    }
    if (path === "/queue") {
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
      if (isApplicant()) {
        app.innerHTML = `<p>Applicant does not see ICC activity.</p><p><a href="/queue">Queue</a></p>`;
        return;
      }
      await renderActivity();
      return;
    }
    app.innerHTML = `<p>Unknown route. Use queue, library, code, applicant, or ICC activity.</p>`;
  } catch (err) {
    showErr(err.message);
    if (err.status === 401 && path.startsWith("/icc")) {
      app.innerHTML = `<p>Unauthed ICC content refused.</p><p><a href="/gate">Gate</a></p>`;
    }
  }
}

document.querySelectorAll("nav a").forEach((a) => {
  a.addEventListener("click", (e) => {
    const href = a.getAttribute("href");
    if (href && href.startsWith("/")) {
      e.preventDefault();
      go(href);
    }
  });
});

window.addEventListener("popstate", render);
render();
