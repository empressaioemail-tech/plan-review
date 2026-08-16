const PERSONAS = [
  { orgId: "icc-demo", userId: "reviewer", label: "Reviewer / icc-demo" },
  { orgId: "icc-demo", userId: "observer", label: "Observer / icc-demo" },
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
    go("/queue");
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
    `;
    return;
  }
  if (tab === "matrix") {
    const data = await api(`/api/plan-review/engagements/${id}/matrix`);
    pane.innerHTML = `<ul class="list">${(data.sections || [])
      .map((s) => {
        const uncertain = /uncertain|unchecked/i.test(s.determination || "") ? "uncertain" : "";
        return `<li>
          <div class="${uncertain}">${escapeHtml(s.citation || s.sectionId)} — ${escapeHtml(s.determination)}</div>
          <div>${escapeHtml(s.heading || "")}</div>
          <div>${escapeHtml(s.analysis || "")}</div>
          <div class="meta">atom ${escapeHtml(s.sectionAtomId)} · ${escapeHtml(confText(s.confidence))} · bodyVerbatim=${data.bodyVerbatim}</div>
          ${s.iccDeepLink ? `<a href="${escapeHtml(s.iccDeepLink)}">ICC deep-link</a>` : ""}
        </li>`;
      })
      .join("")}</ul>`;
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
      ${isReviewer() ? `<form class="stack" id="upload"><input type="file" name="file" required /><button type="submit">Upload to Smart Files</button></form>` : ""}
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
    return;
  }
  if (tab === "map") {
    pane.innerHTML = `
      <p>Parcel ${escapeHtml(engagement.parcelNodeId)}</p>
      <p class="sub">E6 map compose is not mounted on this host. Import from hauska-map in a clean worktree. Dirty hauska-map is property-explorer. This pane does not fake a boundary.</p>
    `;
    return;
  }
  if (tab === "briefing") {
    const matrix = await api(`/api/plan-review/engagements/${id}/matrix`);
    const first = (matrix.sections || [])[0];
    const data = await api(`/api/plan-review/engagements/${id}/briefing`, {
      query: { sectionAtomId: first?.sectionAtomId || "" },
    });
    pane.innerHTML = `<ul class="list">${(data.chain || [])
      .map(
        (step) => `<li>
          <div>${escapeHtml(step.role)} · ${escapeHtml(step.atomId)}</div>
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
  app.innerHTML = `
    <h2>ICC activity</h2>
    <p class="sub">Actor ${escapeHtml(data.actorDid)} · ${escapeHtml(data.rateLabel || "")}</p>
    <ul class="list">${(data.rows || [])
      .map(
        (r) =>
          `<li>${escapeHtml(r.source)} · ${escapeHtml(r.bookId || "")} ${escapeHtml(r.sectionId || "")}
           <div class="meta">${escapeHtml(r.id)} · rate ${r.rate} · ${escapeHtml(r.createdAt || "")}</div></li>`,
      )
      .join("") || "<li class='meta'>No rows yet.</li>"}</ul>
    <p class="footer">${escapeHtml(data.ipmcResidual || "IPMC 2018 not ingested (G-41)")}.
      Purge selectors: sourceAdapter=${escapeHtml(data.purge?.sourceAdapter || "icc-code-connect")},
      jurisdictionTenant=${escapeHtml(data.purge?.jurisdictionTenant || "icc-model-code")}.
      Not a customer-facing surface. PoC fixture, not a quoted SaaS price.</p>
  `;
}

async function render() {
  showErr("");
  whoEl.textContent = personaValue() || "not gated";
  const path = pathOf();
  const tab = new URL(location.href).searchParams.get("tab") || "intake";
  try {
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
    if (path === "/icc/activity") {
      await renderActivity();
      return;
    }
    app.innerHTML = `<p>Unknown route. Use queue, library, code, or ICC activity.</p>`;
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
if (!personaValue() && pathOf() !== "/gate") {
  if (pathOf().startsWith("/icc")) {
    /* middleware already 401s unauthed /icc; if we got here, no cookie in localStorage */
  }
}
render();
