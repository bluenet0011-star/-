/* 시간표 도우미 - 화면 스크립트 (빌드 도구 없이 동작) */
"use strict";

// ---------------------------------------------------------------- 상태
const state = {
  projects: [],
  project: null,
  view: "home",
  check: { data: [], timetable: [], summary: null },
  saveTimer: null,
  checkTimer: null,
  saving: "",
  tt: { mode: "class", owner: null, sel: null, undo: [], redo: [] },
  lessonFilter: { text: "", grade: "" },
  teacherSel: null,
  solving: null,
  lastSolve: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`;

// ---------------------------------------------------------------- API
async function api(method, url, body, raw = false) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) {
      opt.body = body;
      opt.headers["Content-Type"] = "application/octet-stream";
    } else {
      opt.body = JSON.stringify(body);
      opt.headers["Content-Type"] = "application/json";
    }
  }
  const res = await fetch(url, opt);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch (_) { /* 무시 */ }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return raw ? res : res.json();
}

function toast(msg, ms = 2600) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), ms);
}

// ---------------------------------------------------------------- 저장/점검
function changed({ rerender = false } = {}) {
  setSave("저장 대기…");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, 700);
  clearTimeout(state.checkTimer);
  state.checkTimer = setTimeout(runCheck, 400);
  if (rerender) render();
}

async function save() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  const p = state.project;
  if (!p) return;
  setSave("저장 중…");
  try {
    const saved = await api("PUT", `/api/projects/${p.id}`, p);
    p.updated_at = saved.updated_at;
    setSave("저장됨");
  } catch (e) {
    setSave("저장 실패: " + e.message, true);
  }
}

async function flushSave() {
  if (state.saveTimer) await save();
}

function setSave(text, error = false) {
  const el = $("#saveState");
  el.textContent = text;
  el.classList.toggle("error", error);
}

async function runCheck() {
  if (!state.project) return;
  try {
    state.check = await api("POST", "/api/check", state.project);
  } catch (e) {
    return;
  }
  renderSidebar();
  if (["check", "timetable", "lessons", "classes"].includes(state.view)) renderContentOnly();
}

// ---------------------------------------------------------------- 도우미
const P = () => state.project;
const days = () => P().settings.days;
const maxPeriods = () => Math.max(0, ...Object.values(P().settings.periods).flat());
const tMap = () => Object.fromEntries(P().teachers.map((t) => [t.id, t]));
const cMap = () => Object.fromEntries(P().classes.map((c) => [c.id, c]));
const sMap = () => Object.fromEntries(P().subjects.map((s) => [s.id, s]));
const rMap = () => Object.fromEntries(P().rooms.map((r) => [r.id, r]));
const lMap = () => Object.fromEntries(P().lessons.map((l) => [l.id, l]));
const classLabel = (c) => (c ? `${c.grade}-${c.name}` : "?");
const subjName = (s) => (s ? s.short || s.name : "?");
const grades = () => [...new Set(P().classes.map((c) => c.grade))].sort((a, b) => a - b);
const periodsFor = (grade, d) => (P().settings.periods[String(grade)] || [])[d] || 0;
const classCap = (c) => days().reduce((a, _, d) => a + periodsFor(c.grade, d), 0);

function subjectColor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 92%)`;
}

function syncPartners(lessonIds) {
  const lm = lMap();
  const groups = new Set(lessonIds.map((id) => lm[id]?.sync).filter(Boolean));
  const out = new Set(lessonIds);
  if (groups.size) P().lessons.forEach((l) => l.sync && groups.has(l.sync) && out.add(l.id));
  return [...out];
}

function lessonHoursPerClass() {
  const out = {};
  const seen = new Set();
  for (const l of P().lessons) {
    for (const c of l.classes) {
      if (l.sync) {
        const k = l.sync + "|" + c;
        if (seen.has(k)) continue;
        seen.add(k);
      }
      out[c] = (out[c] || 0) + (Number(l.hours) || 0);
    }
  }
  return out;
}

function teacherHours() {
  const out = {};
  for (const l of P().lessons) for (const t of l.teachers) out[t] = (out[t] || 0) + (Number(l.hours) || 0);
  return out;
}

// ---------------------------------------------------------------- 선택 팝오버
function openPicker(anchor, items, selected, onChange, { single = false } = {}) {
  const pop = $("#popover");
  const sel = new Set(selected);
  const draw = (q = "") => {
    let html = "";
    let grp = null;
    for (const it of items) {
      if (q && !it.label.includes(q)) continue;
      if (it.group !== undefined && it.group !== grp) {
        grp = it.group;
        html += `<div class="grp">${esc(grp)}</div>`;
      }
      html += `<label><input type="${single ? "radio" : "checkbox"}" name="pk" value="${esc(it.id)}" ${sel.has(it.id) ? "checked" : ""}> ${esc(it.label)}</label>`;
    }
    $(".items", pop).innerHTML = html || `<div class="muted small">항목이 없습니다</div>`;
  };
  pop.innerHTML = `<input class="search" placeholder="검색"><div class="items"></div>`;
  draw();
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - 300) + "px";
  pop.style.top = window.scrollY + r.bottom + 4 + "px";
  pop.hidden = false;
  const search = $(".search", pop);
  search.focus();
  search.oninput = () => draw(search.value.trim());
  pop.onchange = (e) => {
    const id = e.target.value;
    if (single) { sel.clear(); sel.add(id); } else if (e.target.checked) sel.add(id); else sel.delete(id);
    onChange([...sel]);
    if (single) closePicker();
  };
  setTimeout(() => document.addEventListener("mousedown", outside), 0);
  function outside(e) {
    if (!pop.contains(e.target)) { closePicker(); document.removeEventListener("mousedown", outside); }
  }
}
function closePicker() { $("#popover").hidden = true; }

// ---------------------------------------------------------------- 네비게이션
const NAV = [
  { group: "기초자료" },
  { id: "settings", label: "기본 설정", step: 1 },
  { id: "teachers", label: "교사", step: 2 },
  { id: "classes", label: "학급", step: 3 },
  { id: "subjects", label: "과목·특별실", step: 4 },
  { id: "lessons", label: "수업(시수표)", step: 5 },
  { group: "시간표" },
  { id: "check", label: "자료 점검", step: 6 },
  { id: "solve", label: "자동 생성", step: 7 },
  { id: "timetable", label: "시간표 보기·수정", step: 8 },
  { id: "export", label: "내보내기", step: 9 },
];

function go(view) {
  state.view = view;
  closePicker();
  render();
  window.scrollTo(0, 0);
}

function renderSidebar() {
  const nav = $("#sidebar");
  if (!state.project) { nav.innerHTML = `<button class="active" data-go="home"><span class="label">시간표 목록</span></button>`; return; }
  const s = state.check.summary;
  const badge = (id) => {
    if (!s) return "";
    if (id === "check") {
      const e = s.data.error, w = s.data.warning;
      if (e) return `<span class="badge bad">${e}</span>`;
      if (w) return `<span class="badge warn">${w}</span>`;
      return `<span class="badge ok">✓</span>`;
    }
    if (id === "timetable" && P().timetable.length) {
      const e = s.timetable.error;
      return e ? `<span class="badge bad">${e}</span>` : `<span class="badge ok">✓</span>`;
    }
    if (id === "teachers") return `<span class="badge">${P().teachers.length}</span>`;
    if (id === "classes") return `<span class="badge">${P().classes.length}</span>`;
    if (id === "lessons") return `<span class="badge">${P().lessons.length}</span>`;
    return "";
  };
  nav.innerHTML = NAV.map((n) =>
    n.group
      ? `<div class="group">${n.group}</div>`
      : `<button data-go="${n.id}" class="${state.view === n.id ? "active" : ""}"><span><span class="step">${n.step}</span><span class="label">${n.label}</span></span>${badge(n.id)}</button>`
  ).join("");
}

function render() {
  renderSidebar();
  $("#projectTitle").textContent = state.project ? state.project.title : "";
  renderContentOnly();
}

function renderContentOnly() {
  const el = $("#content");
  const views = { home: viewHome, settings: viewSettings, teachers: viewTeachers, classes: viewClasses, subjects: viewSubjects,
    lessons: viewLessons, check: viewCheck, solve: viewSolve, timetable: viewTimetable, export: viewExport };
  const active = document.activeElement;
  const keep = active && active.dataset && active.dataset.keep;
  const caret = keep ? [active.selectionStart, active.selectionEnd] : null;
  el.innerHTML = (views[state.view] || viewHome)();
  if (keep) {
    const again = el.querySelector(`[data-keep="${keep}"]`);
    if (again) { again.focus(); try { again.setSelectionRange(...caret); } catch (_) { /* 숫자 입력 등 */ } }
  }
}

document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (g) {
    if (g.dataset.go === "home") { openHome(); return; }
    go(g.dataset.go);
  }
});

// ---------------------------------------------------------------- 목록(홈)
async function openHome() {
  await flushSave();
  state.project = null;
  state.view = "home";
  state.projects = await api("GET", "/api/projects");
  render();
}

async function openProject(id) {
  state.project = await api("GET", `/api/projects/${id}`);
  state.tt = { mode: "class", owner: null, sel: null, undo: [], redo: [] };
  state.lastSolve = null;
  state.check = { data: [], timetable: [], summary: null };
  state.view = state.project.lessons.length ? (state.project.timetable.length ? "timetable" : "check") : "settings";
  render();
  runCheck();
}

function viewHome() {
  const cards = state.projects.map((p) => `
    <div class="project-card" data-open="${p.id}">
      <h3>${esc(p.title)}</h3>
      <div class="muted small">학급 ${p.classes} · 교사 ${p.teachers}</div>
      <div class="muted small">${p.updated_at ? "수정 " + esc(p.updated_at.replace("T", " ")) : ""}</div>
      <div class="row" style="margin-top:8px"><button class="btn small danger" data-del="${p.id}">삭제</button></div>
    </div>`).join("");
  return `
    <h1>시간표 목록</h1>
    <p class="lead">학기별로 시간표 파일을 만들어 관리합니다. 처음이라면 예제 학교로 둘러보세요.</p>
    <div class="row" style="margin-bottom:16px">
      <button class="btn primary" id="newBlank">새 시간표 만들기</button>
      <button class="btn" id="newSample">예제 학교로 체험하기</button>
      <label class="btn">JSON 파일 불러오기<input type="file" id="importJson" accept=".json" hidden></label>
    </div>
    ${cards ? `<div class="project-list">${cards}</div>` : `<div class="card muted">아직 만든 시간표가 없습니다.</div>`}`;
}

document.addEventListener("click", async (e) => {
  if (state.view !== "home") return;
  const del = e.target.closest("[data-del]");
  if (del) {
    e.stopPropagation();
    if (!confirm("이 시간표 파일을 삭제할까요? (백업은 서버에 남습니다)")) return;
    await api("DELETE", `/api/projects/${del.dataset.del}`);
    return openHome();
  }
  const open = e.target.closest("[data-open]");
  if (open) return openProject(open.dataset.open);
  if (e.target.id === "newBlank") {
    const title = prompt("시간표 이름", `${new Date().getFullYear()}학년도 1학기 시간표`);
    if (!title) return;
    const p = await api("POST", "/api/projects", { title });
    return openProject(p.id);
  }
  if (e.target.id === "newSample") {
    const p = await api("POST", "/api/projects", { sample: true });
    return openProject(p.id);
  }
});

document.addEventListener("change", async (e) => {
  if (e.target.id === "importJson" && e.target.files[0]) {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      const p = await api("POST", "/api/projects/import", data);
      openProject(p.id);
    } catch (err) { toast("불러오기 실패: " + err.message); }
  }
});
