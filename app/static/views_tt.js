/* 시간표 화면: 자료 점검, 자동 생성, 시간표 보기·수정, 내보내기 */
"use strict";

// ---------------------------------------------------------------- 자료 점검
function issueList(list) {
  const order = { error: 0, warning: 1, info: 2 };
  const name = { error: "오류", warning: "주의", info: "참고" };
  return `<ul class="issues">${[...list].sort((a, b) => order[a.level] - order[b.level])
    .map((i) => `<li class="${i.level}"><span class="lvl ${i.level}">${name[i.level]}</span>${esc(i.message)}</li>`).join("")}</ul>`;
}

function viewCheck() {
  const c = state.check;
  if (!c.summary) return `<h1>자료 점검</h1><div class="card muted">점검 중…</div>`;
  const s = c.summary.data;
  const verdict = s.error
    ? `<div class="card" style="border-color:var(--bad)"><b style="color:var(--bad)">오류 ${s.error}건</b>을 먼저 고쳐야 시간표를 만들 수 있습니다.</div>`
    : `<div class="card" style="border-color:var(--ok)"><b style="color:var(--ok)">시간표를 만들 준비가 되었습니다.</b> ${s.warning ? `주의 ${s.warning}건은 확인만 하시면 됩니다.` : ""}
       <button class="btn primary" data-go="solve" style="margin-left:8px">자동 생성으로</button></div>`;
  const th = teacherHours();
  const loads = P().teachers.map((t) => th[t.id] || 0);
  return `
    <h1>자료 점검</h1>
    <p class="lead">기초자료를 고칠 때마다 자동으로 다시 점검합니다. 컴시간의 [시간표 작성하기] 같은 준비 단계는 필요 없습니다.</p>
    <div class="stats" style="margin-bottom:16px">
      <div class="stat"><b>${P().classes.length}</b><span>학급</span></div>
      <div class="stat"><b>${P().teachers.length}</b><span>교사</span></div>
      <div class="stat"><b>${P().lessons.length}</b><span>수업</span></div>
      <div class="stat"><b>${P().lessons.reduce((a, l) => a + Number(l.hours), 0)}</b><span>총 수업 시수</span></div>
      <div class="stat"><b>${loads.length ? Math.min(...loads) + "~" + Math.max(...loads) : "-"}</b><span>교사 시수 범위</span></div>
    </div>
    ${verdict}
    ${c.data.length ? issueList(c.data) : `<div class="card muted">발견된 문제가 없습니다.</div>`}`;
}

// ---------------------------------------------------------------- 자동 생성
const PENALTY_LABELS = {
  teacher_three_in_row: "교사 3시간 연속 (구간 수)",
  teacher_lunch_straddle: "교사 점심 전후 연속",
  teacher_day_overload: "교사 하루 수업 과다 (초과 시간)",
  teacher_first_last: "교사 1교시·마지막 교시",
  change_from_previous: "기존 시간표에서 바뀐 칸",
};

function viewSolve() {
  const hasTT = P().timetable.length > 0;
  const locked = P().timetable.filter((p) => p.locked).length;
  const errors = state.check.summary ? state.check.summary.data.error : 0;
  let result = "";
  if (state.solving) {
    result = `<div class="card progress"><div class="spinner"></div><div>시간표를 계산하는 중입니다… <span id="solveElapsed">0</span>초
      <div class="muted small">조건이 많을수록 오래 걸립니다. 최대 ${state.solving.limit}초.</div></div></div>`;
  } else if (state.lastSolve) {
    const r = state.lastSolve;
    const ok = r.status === "optimal" || r.status === "feasible";
    result = `<div class="card" style="border-color:${ok ? "var(--ok)" : "var(--bad)"}">
      <b style="color:${ok ? "var(--ok)" : "var(--bad)"}">${esc(r.message)}</b> <span class="muted small">(${r.seconds.toFixed(1)}초)</span>
      ${ok ? `<table class="grid" style="width:auto;margin-top:10px"><tr><th>품질 항목</th><th class="center">남은 수</th></tr>
        ${Object.entries(r.penalties).map(([k, v]) => `<tr><td>${PENALTY_LABELS[k] || k}</td><td class="center">${v}</td></tr>`).join("")}</table>
        <div class="row" style="margin-top:10px"><button class="btn primary" data-go="timetable">시간표 보기</button></div>` : ""}
      ${r.conflicts?.length ? `<div style="margin-top:10px"><b>충돌하는 조건</b>${issueList(r.conflicts.map((m) => ({ level: "error", message: m })))}</div>` : ""}
    </div>`;
  }
  return `
    <h1>자동 생성</h1>
    <p class="lead">필수 조건(교사·학급·특별실 중복 금지, 배정금지, 동시·연속수업, 고정)은 반드시 지키고,
      [기본 설정]의 품질 기준은 최대한 좋게 맞춥니다. 불가능하면 어떤 조건끼리 충돌하는지 알려 줍니다.</p>
    <div class="card">
      <div class="row">
        <label class="field">최대 계산 시간<select id="solveLimit">
          ${[10, 30, 60, 120, 300].map((s) => `<option value="${s}" ${s === 30 ? "selected" : ""}>${s < 60 ? s + "초" : s / 60 + "분"}</option>`).join("")}</select></label>
        <label class="check" style="align-self:flex-end"><input type="checkbox" id="solveKeep" ${hasTT ? "checked" : "disabled"}> 기존 시간표를 최대한 유지 (바뀐 조건만 반영)</label>
      </div>
      <p class="muted small" style="margin:10px 0">${hasTT ? `현재 시간표가 있습니다. 고정된 칸 ${locked}개는 그대로 둡니다.` : "처음 만드는 시간표입니다."}</p>
      <button class="btn primary" id="runSolve" ${state.solving || errors ? "disabled" : ""}>${hasTT ? "시간표 다시 만들기" : "시간표 만들기"}</button>
      ${errors ? `<span class="muted small" style="margin-left:8px">자료 오류 ${errors}건을 먼저 고쳐 주세요. <a href="#" data-go="check">점검 보기</a></span>` : ""}
    </div>
    ${result}`;
}

async function runSolve(keep, limit) {
  await flushSave();
  state.solving = { start: Date.now(), limit };
  state.lastSolve = null;
  render();
  const timer = setInterval(() => {
    const el = $("#solveElapsed");
    if (el) el.textContent = Math.round((Date.now() - state.solving.start) / 1000);
  }, 500);
  try {
    const r = await api("POST", `/api/projects/${P().id}/solve`, { options: { time_limit: limit, keep_previous: keep }, save: true });
    state.lastSolve = r;
    if (r.status === "optimal" || r.status === "feasible") {
      state.project = await api("GET", `/api/projects/${P().id}`);
      state.tt.undo = [];
      state.tt.redo = [];
    }
  } catch (e) {
    state.lastSolve = { status: "error", message: "오류: " + e.message, seconds: 0, penalties: {}, conflicts: [] };
  } finally {
    clearInterval(timer);
    state.solving = null;
    render();
    runCheck();
  }
}

document.addEventListener("click", (e) => {
  if (state.view !== "solve" || e.target.id !== "runSolve") return;
  const keep = $("#solveKeep").checked;
  if (!keep && P().timetable.length && P().timetable.some((p) => !p.locked) &&
      !confirm("고정하지 않은 칸은 모두 새로 배정됩니다. 계속할까요?")) return;
  runSolve(keep, +$("#solveLimit").value);
});

// ---------------------------------------------------------------- 시간표 모델 도우미
function occIndex(tt = P().timetable) {
  const lm = lMap();
  const cls = new Map(), tch = new Map(), room = new Map(), at = new Map();
  const push = (m, k, v) => { const a = m.get(k); a ? a.push(v) : m.set(k, [v]); };
  for (const pl of tt) {
    const l = lm[pl.lesson];
    if (!l) continue;
    at.set(`${pl.lesson}|${pl.day}|${pl.period}`, pl);
    l.classes.forEach((c) => push(cls, `${c}|${pl.day}|${pl.period}`, l.id));
    l.teachers.forEach((t) => push(tch, `${t}|${pl.day}|${pl.period}`, l.id));
    if (l.room) push(room, `${l.room}|${pl.day}|${pl.period}`, l.id);
  }
  return { cls, tch, room, at };
}

function cellLessons(idx, mode, owner, d, p) {
  return (mode === "class" ? idx.cls : idx.tch).get(`${owner}|${d}|${p}`) || [];
}

function slotOpenFor(lesson, d, p, cm) {
  return lesson.classes.every((c) => cm[c] && p < periodsFor(cm[c].grade, d));
}

function unitCount(ids, lm) {
  // 같은 동시 그룹은 하나로 센다 (분반)
  return new Set(ids.map((i) => lm[i]?.sync || i)).size;
}

function problemsAt(tt, affected) {
  const idx = occIndex(tt), lm = lMap(), tm = tMap(), cm = cMap(), rm = rMap();
  const out = new Set();
  const dn = days();
  for (const { lesson, day: d, period: p } of affected) {
    const l = lm[lesson];
    if (!l) continue;
    const where = `${dn[d]}${p + 1}교시`;
    if (!slotOpenFor(l, d, p, cm)) out.add(`${where}는 수업이 없는 시간`);
    for (const t of l.teachers) {
      const ids = idx.tch.get(`${t}|${d}|${p}`) || [];
      if (ids.length > 1) out.add(`${tm[t]?.name} 교사 ${where} 중복`);
      if (tm[t]?.unavailable.some(([a, b]) => a === d && b === p)) out.add(`${tm[t]?.name} 교사 ${where} 배정금지`);
    }
    for (const c of l.classes) {
      const ids = idx.cls.get(`${c}|${d}|${p}`) || [];
      if (unitCount(ids, lm) > 1) out.add(`${classLabel(cm[c])} ${where} 중복`);
    }
    if (l.room) {
      const ids = idx.room.get(`${l.room}|${d}|${p}`) || [];
      if (ids.length > 1) out.add(`${rm[l.room]?.name} ${where} 중복`);
    }
  }
  return [...out];
}

function neededBlock(lesson) {
  const placed = P().timetable.filter((pl) => pl.lesson === lesson.id);
  const remaining = lesson.hours - placed.length;
  if (remaining <= 0) return 0;
  // 이미 배정된 연속 구간 길이
  const byDay = {};
  placed.forEach((pl) => (byDay[pl.day] = byDay[pl.day] || []).push(pl.period));
  const runs = [];
  Object.values(byDay).forEach((ps) => {
    ps.sort((a, b) => a - b);
    let len = 1;
    for (let i = 1; i <= ps.length; i++) {
      if (i < ps.length && ps[i] === ps[i - 1] + 1) len++;
      else { runs.push(len); len = 1; }
    }
  });
  const need = [...lesson.blocks].filter((b) => b >= 2).sort((a, b) => b - a);
  for (const r of runs) { const i = need.indexOf(r); if (i >= 0) need.splice(i, 1); }
  const size = need.find((b) => b <= remaining);
  return size || 1;
}

function makeSelection(mode, owner, d, p) {
  const idx = occIndex(), lm = lMap();
  const ids = cellLessons(idx, mode, owner, d, p);
  if (!ids.length) return null;
  const lessons = syncPartners(ids);
  let periods = [p];
  if (lessons.some((i) => (lm[i]?.blocks || []).some((b) => b >= 2))) {
    const same = (q) => { const x = cellLessons(idx, mode, owner, d, q); return x.length && ids.every((i) => x.includes(i)); };
    let a = p, b = p;
    while (a > 0 && same(a - 1)) a--;
    while (b < maxPeriods() - 1 && same(b + 1)) b++;
    periods = [];
    for (let q = a; q <= b; q++) periods.push(q);
  }
  return { lessons, day: d, periods };
}

function planMove(sel, d2, p2) {
  const mode = state.tt.mode, owner = state.tt.owner;
  const idx = occIndex();
  const lm = lMap();
  const tt = P().timetable.map((x) => ({ ...x }));
  const byKey = new Map(tt.map((x) => [`${x.lesson}|${x.day}|${x.period}`, x]));
  const size = sel.unplaced ? sel.size : sel.periods.length;
  const tp = Array.from({ length: size }, (_, i) => p2 + i);
  if (tp.at(-1) >= maxPeriods()) return { problems: ["교시 범위를 벗어남"] };
  const affected = [];
  let swap = false;
  const problems = [];

  if (sel.unplaced) {
    for (const q of tp) {
      const there = cellLessons(idx, mode, owner, d2, q).filter((i) => !sel.lessons.includes(i));
      if (there.length) return { problems: ["이미 수업이 있는 칸 (먼저 비우거나 다른 칸 선택)"] };
    }
    for (const lid of sel.lessons) for (const q of tp) {
      const pl = { lesson: lid, day: d2, period: q, locked: false };
      tt.push(pl);
      affected.push(pl);
    }
    return { tt, problems: problemsAt(tt, affected), swap: false };
  }

  const src = sel.periods;
  if (d2 === sel.day && p2 === src[0]) return null;
  if (d2 === sel.day && tp.some((q) => src.includes(q))) return { problems: ["겹치는 위치로는 옮길 수 없음"] };
  // 옮겨갈 자리에 있던 수업들 (맞교환 대상)
  const displaced = new Set();
  tp.forEach((q) => cellLessons(idx, mode, owner, d2, q).forEach((i) => !sel.lessons.includes(i) && displaced.add(i)));
  const others = syncPartners([...displaced]);
  for (const lid of sel.lessons) {
    src.forEach((q, i) => {
      const pl = byKey.get(`${lid}|${sel.day}|${q}`);
      if (!pl) return;
      if (pl.locked) problems.push("고정된 수업 (고정 해제 후 이동)");
      pl.day = d2; pl.period = tp[i];
      affected.push(pl);
    });
  }
  for (const lid of others) {
    tp.forEach((q, i) => {
      const pl = byKey.get(`${lid}|${d2}|${q}`);
      if (!pl || affected.includes(pl)) return;
      if (pl.locked) problems.push("맞교환 대상이 고정됨");
      pl.day = sel.day; pl.period = src[i];
      affected.push(pl);
      swap = true;
    });
  }
  return { tt, problems: [...new Set([...problems, ...problemsAt(tt, affected)])], swap };
}

function pushUndo() {
  state.tt.undo.push(JSON.stringify(P().timetable));
  if (state.tt.undo.length > 100) state.tt.undo.shift();
  state.tt.redo = [];
}
function undo() {
  if (!state.tt.undo.length) return;
  state.tt.redo.push(JSON.stringify(P().timetable));
  P().timetable = JSON.parse(state.tt.undo.pop());
  state.tt.sel = null;
  changed({ rerender: true });
}
function redo() {
  if (!state.tt.redo.length) return;
  state.tt.undo.push(JSON.stringify(P().timetable));
  P().timetable = JSON.parse(state.tt.redo.pop());
  state.tt.sel = null;
  changed({ rerender: true });
}

// ---------------------------------------------------------------- 시간표 보기·수정
function ttOwners(mode) {
  return mode === "teacher"
    ? P().teachers.map((t) => ({ id: t.id, label: t.name }))
    : P().classes.map((c) => ({ id: c.id, label: classLabel(c) }));
}

function conflictKeys() {
  // "owner|d|p" 형태로 오류 칸 모음
  const out = new Set();
  const lm = lMap();
  for (const i of state.check.timetable || []) {
    if (i.level !== "error") continue;
    for (const [d, p] of i.slots) {
      if (i.teacher) out.add(`${i.teacher}|${d}|${p}`);
      if (i.school_class) out.add(`${i.school_class}|${d}|${p}`);
      for (const lid of i.lessons) {
        const l = lm[lid];
        if (!l) continue;
        l.teachers.forEach((t) => out.add(`${t}|${d}|${p}`));
        l.classes.forEach((c) => out.add(`${c}|${d}|${p}`));
      }
    }
  }
  return out;
}

function viewTimetable() {
  const tt = state.tt;
  if (!P().classes.length) return `<h1>시간표</h1><div class="card muted">학급이 없습니다.</div>`;
  if (!P().timetable.length) {
    return `<h1>시간표</h1><div class="card">아직 시간표가 없습니다. <button class="btn primary" data-go="solve">자동 생성하기</button></div>`;
  }
  if (tt.mode === "overview" || tt.mode === "overviewT") return viewOverview();
  const owners = ttOwners(tt.mode);
  if (!owners.some((o) => o.id === tt.owner)) tt.owner = owners[0]?.id;
  const owner = tt.owner;
  const idx = occIndex();
  const lm = lMap(), sm = sMap(), tm = tMap(), cm = cMap(), rm = rMap();
  const s = P().settings;
  const conflicts = conflictKeys();
  const sel = tt.sel;
  const ownerClass = tt.mode === "class" ? cm[owner] : null;
  const ownerTeacher = tt.mode === "teacher" ? tm[owner] : null;
  const unavailable = new Set((ownerTeacher?.unavailable || []).map(([d, p]) => `${d}:${p}`));

  // 이동 가능 여부 미리 계산
  const targets = {};
  if (sel) {
    for (let d = 0; d < days().length; d++) for (let p = 0; p < maxPeriods(); p++) {
      if (ownerClass && p >= periodsFor(ownerClass.grade, d)) continue;
      const plan = planMove(sel, d, p);
      if (!plan) continue;
      targets[`${d}:${p}`] = plan.problems.length ? { cls: "t-bad", tip: plan.problems.join("\n") } : { cls: plan.swap ? "t-swap" : "t-ok", tip: plan.swap ? "클릭하면 맞교환" : "클릭하면 이동" };
    }
  }

  const head = `<tr><th class="period"></th>${days().map((d) => `<th>${d}</th>`).join("")}</tr>`;
  const body = Array.from({ length: maxPeriods() }, (_, p) => {
    const cells = days().map((_, d) => {
      if (ownerClass && p >= periodsFor(ownerClass.grade, d)) return `<td class="closed"></td>`;
      const ids = cellLessons(idx, tt.mode, owner, d, p);
      const classes = [];
      let inner = "";
      let bg = "";
      if (ids.length) {
        const l = lm[ids[0]];
        const locked = ids.some((i) => idx.at.get(`${i}|${d}|${p}`)?.locked);
        const main = subjName(sm[l.subject]);
        const sub = tt.mode === "class"
          ? ids.map((i) => lm[i].teachers.map((t) => tm[t]?.name).join(",")).join(" · ")
          : ids.map((i) => lm[i].classes.map((c) => classLabel(cm[c])).join(",")).join(" · ");
        const subjects = [...new Set(ids.map((i) => subjName(sm[lm[i].subject])))];
        inner = `<div class="subj">${esc(subjects.join("/"))}</div><div class="sub">${esc(sub)}</div>
          ${l.room ? `<div class="room">${esc(rm[l.room]?.name || "")}</div>` : ""}
          ${l.sync ? `<div class="room" title="동시 그룹">⇄ ${esc(l.sync)}</div>` : ""}
          ${locked ? `<span class="lock" title="고정">🔒</span>` : ""}`;
        classes.push("filled");
        bg = `background:${subjectColor(l.subject)}`;
      }
      if (unavailable.has(`${d}:${p}`)) classes.push("unavailable");
      if (conflicts.has(`${owner}|${d}|${p}`)) classes.push("conflict");
      if (sel && !sel.unplaced && sel.day === d && sel.periods.includes(p) && ids.some((i) => sel.lessons.includes(i))) classes.push("selected");
      const tg = targets[`${d}:${p}`];
      if (tg && !classes.includes("selected")) classes.push(tg.cls);
      const tip = tg ? tg.tip : (ids.length ? "클릭해서 선택" : "");
      return `<td data-cell="${d}:${p}" class="${classes.join(" ")}" style="${bg}" title="${esc(tip)}">${inner}</td>`;
    }).join("");
    return `<tr><th class="period">${p + 1}${s.bell[p] ? `<small>${esc(s.bell[p])}</small>` : ""}${p + 1 === s.lunch_after ? `<small>— 점심 —</small>` : ""}</th>${cells}</tr>`;
  }).join("");

  // 옆 패널: 미배정, 선택 정보, 문제
  const placedCount = {};
  P().timetable.forEach((pl) => (placedCount[pl.lesson] = (placedCount[pl.lesson] || 0) + 1));
  const mine = P().lessons.filter((l) => (tt.mode === "class" ? l.classes : l.teachers).includes(owner));
  const unplaced = mine.filter((l) => (placedCount[l.id] || 0) < l.hours);
  const hoursMine = mine.reduce((a, l) => a + Number(l.hours), 0);
  const selInfo = sel ? (() => {
    const l = lm[sel.lessons[0]];
    return `<div class="card small"><b>선택: ${esc(subjName(sm[l.subject]))}</b>
      <div>${esc(sel.lessons.map((i) => lm[i].teachers.map((t) => tm[t]?.name).join(",")).join(" · "))}</div>
      <div class="muted">${esc(sel.lessons.map((i) => lm[i].classes.map((c) => classLabel(cm[c])).join(",")).join(" · "))}</div>
      <p class="muted">초록 칸: 바로 이동 · 주황 칸: 맞교환 · 흐린 칸: 불가 (마우스를 올리면 이유)</p>
      ${sel.unplaced ? "" : `<div class="row"><button class="btn small" id="ttLock">고정/해제 (L)</button><button class="btn small danger" id="ttClear">비우기 (Del)</button></div>`}
      <div class="row" style="margin-top:6px"><button class="btn small" id="ttCancel">선택 취소 (Esc)</button></div></div>`;
  })() : "";
  const ownerIssues = (state.check.timetable || []).filter((i) => i.level !== "info" &&
    (i.teacher === owner || i.school_class === owner || i.lessons.some((x) => mine.some((l) => l.id === x))));

  const idxOwner = owners.findIndex((o) => o.id === owner);
  return `
    <h1>시간표 보기·수정</h1>
    <div class="tt-toolbar">
      <div class="seg">
        <button data-ttmode="class" class="${tt.mode === "class" ? "on" : ""}">학급별</button>
        <button data-ttmode="teacher" class="${tt.mode === "teacher" ? "on" : ""}">교사별</button>
        <button data-ttmode="overview">전체(학급)</button>
        <button data-ttmode="overviewT">전체(교사)</button>
      </div>
      <button class="btn small" data-ttstep="-1" ${idxOwner <= 0 ? "disabled" : ""}>◀</button>
      <select id="ttOwner">${owners.map((o) => `<option value="${o.id}" ${o.id === owner ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>
      <button class="btn small" data-ttstep="1" ${idxOwner >= owners.length - 1 ? "disabled" : ""}>▶</button>
      <span class="muted small">${ownerClass && ownerClass.homeroom ? `담임 ${esc(tm[ownerClass.homeroom]?.name || "")} · ` : ""}${hoursMine}시간</span>
      <div class="grow"></div>
      <button class="btn small" id="ttUndo" ${tt.undo.length ? "" : "disabled"} title="Ctrl+Z">되돌리기</button>
      <button class="btn small" id="ttRedo" ${tt.redo.length ? "" : "disabled"} title="Ctrl+Y">다시</button>
      <button class="btn small" id="ttAuto" title="고정한 칸은 그대로 두고 나머지를 다시 배정">나머지 자동 정리</button>
    </div>
    <div class="tt-wrap">
      <div class="tt-main"><table class="tt">${head}${body}</table>
        <div class="legend" style="margin-top:8px"><span>🔒 고정</span><span><i style="background:#fbeaea"></i>배정금지</span><span><i style="box-shadow:inset 0 0 0 2px var(--bad)"></i>문제 있는 칸</span></div>
      </div>
      <div class="tt-side">
        ${selInfo}
        <div class="card">
          <b>미배정 ${unplaced.length ? `<span class="badge bad">${unplaced.reduce((a, l) => a + l.hours - (placedCount[l.id] || 0), 0)}시간</span>` : `<span class="badge ok">없음</span>`}</b>
          ${unplaced.length ? `<p class="muted small">항목을 누른 뒤 빈 칸을 누르면 배정됩니다.</p>` : ""}
          <ul class="side-list">${unplaced.map((l) => `<li data-unplaced="${l.id}" class="${sel?.unplaced && sel.lessons.includes(l.id) ? "on" : ""}">
            ${esc(subjName(sm[l.subject]))} · ${esc(tt.mode === "class" ? l.teachers.map((t) => tm[t]?.name).join(",") : l.classes.map((c) => classLabel(cm[c])).join(","))}
            <span class="muted">(${l.hours - (placedCount[l.id] || 0)}시간)</span></li>`).join("")}</ul>
        </div>
        ${ownerIssues.length ? `<div class="card"><b>문제</b>${issueList(ownerIssues)}</div>` : ""}
        <div class="card small muted">칸을 눌러 선택한 뒤 옮길 칸을 누르면 이동·맞교환됩니다. 연속수업과 동시수업은 함께 움직입니다.</div>
      </div>
    </div>`;
}

function viewOverview() {
  const tt = state.tt;
  const idx = occIndex();
  const lm = lMap(), sm = sMap(), cm = cMap(), tm = tMap();
  const conflicts = conflictKeys();
  const byTeacher = tt.mode === "overviewT";
  const rows = byTeacher ? P().teachers.map((t) => ({ id: t.id, label: t.name })) : P().classes.map((c) => ({ id: c.id, label: classLabel(c), grade: c.grade }));
  const mp = maxPeriods();
  const head = `<tr><th></th>${days().map((d) => Array.from({ length: mp }, (_, p) => `<th class="${p === 0 ? "daystart" : ""}">${p === 0 ? d : ""}${p + 1}</th>`).join("")).join("")}</tr>`;
  const body = rows.map((r) => `<tr><td class="name" data-ovowner="${r.id}">${esc(r.label)}</td>${days().map((_, d) => Array.from({ length: mp }, (_, p) => {
    const ds = p === 0 ? "daystart" : "";
    if (!byTeacher && p >= periodsFor(r.grade, d)) return `<td class="${ds}" style="background:#eef0f3"></td>`;
    const ids = (byTeacher ? idx.tch : idx.cls).get(`${r.id}|${d}|${p}`) || [];
    if (!ids.length) return `<td class="${ds}"></td>`;
    const l = lm[ids[0]];
    const text = byTeacher ? l.classes.map((c) => { const k = cm[c]; return k ? `${k.grade}${k.name}` : "?"; }).join(",") : subjName(sm[l.subject]);
    const tip = `${subjName(sm[l.subject])} / ${l.teachers.map((t) => tm[t]?.name).join(",")} / ${l.classes.map((c) => classLabel(cm[c])).join(",")}`;
    return `<td class="${ds} ${conflicts.has(`${r.id}|${d}|${p}`) ? "conflict" : ""}" style="background:${subjectColor(l.subject)}" title="${esc(tip)}">${esc(text)}</td>`;
  }).join("")).join("")}</tr>`).join("");
  return `
    <h1>전체 시간표</h1>
    <div class="tt-toolbar"><div class="seg">
      <button data-ttmode="class">학급별</button><button data-ttmode="teacher">교사별</button>
      <button data-ttmode="overview" class="${!byTeacher ? "on" : ""}">전체(학급)</button>
      <button data-ttmode="overviewT" class="${byTeacher ? "on" : ""}">전체(교사)</button></div>
      <span class="muted small">이름을 누르면 해당 시간표로 이동합니다.</span></div>
    <div class="overview"><table class="ov">${head}${body}</table></div>`;
}

function applyPlan(plan) {
  pushUndo();
  P().timetable = plan.tt;
  state.tt.sel = null;
  changed({ rerender: true });
}

document.addEventListener("click", (e) => {
  if (state.view !== "timetable") return;
  const t = e.target;
  const tt = state.tt;
  const mode = t.closest("[data-ttmode]");
  if (mode) {
    const m = mode.dataset.ttmode;
    if ((m === "class" || m === "teacher") && tt.mode !== m) tt.owner = null;
    tt.mode = m; tt.sel = null; render(); return;
  }
  const ov = t.closest("[data-ovowner]");
  if (ov) { tt.mode = tt.mode === "overviewT" ? "teacher" : "class"; tt.owner = ov.dataset.ovowner; tt.sel = null; render(); return; }
  const step = t.closest("[data-ttstep]");
  if (step) {
    const owners = ttOwners(tt.mode);
    const i = owners.findIndex((o) => o.id === tt.owner) + Number(step.dataset.ttstep);
    if (owners[i]) { tt.owner = owners[i].id; tt.sel = null; render(); }
    return;
  }
  if (t.id === "ttUndo") return undo();
  if (t.id === "ttRedo") return redo();
  if (t.id === "ttCancel") { tt.sel = null; render(); return; }
  if (t.id === "ttLock") return toggleLock();
  if (t.id === "ttClear") return clearSel();
  if (t.id === "ttAuto") {
    if (!confirm("고정(🔒)한 칸은 그대로 두고, 나머지를 기존 시간표와 최대한 비슷하게 다시 배정합니다.\n미배정 수업도 함께 채웁니다. 진행할까요?")) return;
    state.view = "solve";
    runSolve(true, 30);
    return;
  }
  const un = t.closest("[data-unplaced]");
  if (un) {
    const l = lMap()[un.dataset.unplaced];
    tt.sel = tt.sel?.unplaced && tt.sel.lessons.includes(l.id) ? null
      : { unplaced: true, lessons: syncPartners([l.id]), size: neededBlock(l) };
    render(); return;
  }
  const cell = t.closest("[data-cell]");
  if (!cell || cell.classList.contains("closed")) return;
  const [d, p] = cell.dataset.cell.split(":").map(Number);
  if (tt.sel) {
    if (cell.classList.contains("selected")) { tt.sel = null; render(); return; }
    const plan = planMove(tt.sel, d, p);
    if (plan && plan.tt && !plan.problems.length) { applyPlan(plan); return; }
    if (plan && plan.problems.length && plan.tt) {
      if (confirm(`이 칸으로 옮기면 문제가 생깁니다:\n- ${plan.problems.join("\n- ")}\n\n그래도 옮길까요?`)) applyPlan(plan);
      return;
    }
    // 옮길 수 없는 칸이면 그 칸을 새로 선택
  }
  tt.sel = makeSelection(tt.mode, tt.owner, d, p);
  render();
});

document.addEventListener("change", (e) => {
  if (state.view === "timetable" && e.target.id === "ttOwner") {
    state.tt.owner = e.target.value; state.tt.sel = null; render();
  }
});

function selPlacements() {
  const sel = state.tt.sel;
  if (!sel || sel.unplaced) return [];
  return P().timetable.filter((pl) => sel.lessons.includes(pl.lesson) && pl.day === sel.day && sel.periods.includes(pl.period));
}
function toggleLock() {
  const pls = selPlacements();
  if (!pls.length) return;
  pushUndo();
  const to = !pls.every((pl) => pl.locked);
  pls.forEach((pl) => (pl.locked = to));
  changed({ rerender: true });
}
function clearSel() {
  const pls = new Set(selPlacements());
  if (!pls.size) return;
  pushUndo();
  P().timetable = P().timetable.filter((pl) => !pls.has(pl));
  state.tt.sel = null;
  changed({ rerender: true });
}

document.addEventListener("keydown", (e) => {
  if (state.view !== "timetable" || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); }
  else if (k === "escape") { state.tt.sel = null; render(); }
  else if (k === "l") toggleLock();
  else if (k === "delete" || k === "backspace") clearSel();
});

// ---------------------------------------------------------------- 내보내기
function viewExport() {
  const id = P().id;
  return `
    <h1>내보내기</h1>
    <p class="lead">엑셀로 내려받아 인쇄하거나, 시간표 파일(JSON)을 다른 컴퓨터로 옮길 수 있습니다.</p>
    <div class="card row">
      <a class="btn primary" href="/api/projects/${id}/export.xlsx">엑셀 시간표 (전체·학급별·교사별)</a>
      <a class="btn" href="/api/projects/${id}/download.json">시간표 파일 백업 (JSON)</a>
    </div>
    <h2>이전 저장본으로 되돌리기</h2>
    <p class="lead">저장할 때마다 이전 상태가 자동 보관됩니다 (최근 30개).</p>
    <div class="card" id="backupList"><button class="btn" id="loadBackups">저장 기록 불러오기</button></div>`;
}

document.addEventListener("click", async (e) => {
  if (state.view !== "export") return;
  if (e.target.id === "loadBackups") {
    await flushSave();
    const list = await api("GET", `/api/projects/${P().id}/backups`);
    $("#backupList").innerHTML = list.length
      ? `<table class="grid"><tr><th>저장 시각</th><th class="center">배정 칸</th><th></th></tr>${list.map((b) =>
        `<tr><td>${esc((b.updated_at || b.name).replace("T", " "))}</td><td class="center">${b.placements}</td>
          <td class="center"><button class="btn small" data-restore="${b.name}">이 상태로 되돌리기</button></td></tr>`).join("")}</table>`
      : `<span class="muted">저장 기록이 없습니다.</span>`;
  }
  const r = e.target.closest("[data-restore]");
  if (r) {
    if (!confirm("현재 상태를 이 저장본으로 되돌릴까요? (현재 상태도 기록에 남습니다)")) return;
    await flushSave();
    state.project = await api("POST", `/api/projects/${P().id}/backups/${r.dataset.restore}/restore`);
    toast("되돌렸습니다.");
    render();
    runCheck();
  }
});

// ---------------------------------------------------------------- 시작
openHome();
