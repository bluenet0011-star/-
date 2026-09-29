/* 기초자료 화면: 기본 설정, 교사, 학급, 과목·특별실, 수업(시수표) */
"use strict";

// ---------------------------------------------------------------- 기본 설정
const WEIGHT_LABELS = {
  teacher_three_in_row: "교사 3시간 연속 수업 피하기",
  teacher_lunch_straddle: "교사 점심 전후 연속 수업 피하기",
  teacher_day_overload: "교사 하루 수업 몰림 피하기",
  teacher_first_last: "교사 1교시·마지막 교시 줄이기",
  change_from_previous: "(최소 변경 모드) 기존 시간표 유지",
};
const ALL_DAYS = ["월", "화", "수", "목", "금", "토"];

function viewSettings() {
  const s = P().settings;
  const gs = [...new Set([...grades(), ...Object.keys(s.periods).map(Number)])].sort((a, b) => a - b);
  const rows = gs.map((g) => {
    const row = s.periods[String(g)] || [];
    const total = row.reduce((a, b) => a + (+b || 0), 0);
    return `<tr><th>${g}학년</th>${days().map((_, d) => `<td class="center"><input class="num" type="number" min="0" max="12" data-period="${g}:${d}" value="${row[d] ?? 0}"></td>`).join("")}<td class="center"><b>${total}</b></td></tr>`;
  }).join("");
  const bell = Array.from({ length: maxPeriods() }, (_, p) =>
    `<label class="field">${p + 1}교시<input class="short" data-bell="${p}" value="${esc(s.bell[p] || "")}" placeholder="09:00-09:45"></label>`).join("");
  const weights = Object.entries(WEIGHT_LABELS).map(([k, label]) =>
    `<tr><td>${label}</td><td class="center"><input class="num" type="number" min="0" max="100" data-weight="${k}" value="${s.weights[k] ?? 0}"></td></tr>`).join("");
  return `
    <h1>기본 설정</h1>
    <p class="lead">학교 정보와 학년별 요일별 교시 수를 정합니다. 수정하면 바로 저장·반영됩니다.</p>
    <div class="card"><div class="row">
      <label class="field grow">시간표 이름<input data-title value="${esc(P().title)}" data-keep="title"></label>
      <label class="field grow">학교명<input data-set="school_name" value="${esc(s.school_name)}" data-keep="school"></label>
      <label class="field">학년도<input class="num" type="number" data-set="year" value="${s.year}"></label>
      <label class="field">학기<select data-set="semester"><option ${s.semester == 1 ? "selected" : ""}>1</option><option ${s.semester == 2 ? "selected" : ""}>2</option></select></label>
    </div></div>

    <h2>수업 요일</h2>
    <div class="card row">${ALL_DAYS.map((d) => `<label class="check"><input type="checkbox" data-day="${d}" ${days().includes(d) ? "checked" : ""}> ${d}</label>`).join("")}</div>

    <h2>학년별 요일별 교시 수</h2>
    <div class="card">
      <table class="grid" style="width:auto"><tr><th></th>${days().map((d) => `<th class="center">${d}</th>`).join("")}<th class="center">합계</th></tr>${rows}</table>
      <div class="row" style="margin-top:10px"><button class="btn small" id="addGrade">학년 추가</button>
      <span class="muted small">학급 시수 합계가 이 합계와 같아야 빈 교시 없이 채워집니다.</span></div>
    </div>

    <h2>일과 시간</h2>
    <div class="card">
      <div class="row">
        <label class="field">점심 시간<select data-set="lunch_after">${Array.from({ length: maxPeriods() }, (_, i) => `<option value="${i + 1}" ${s.lunch_after == i + 1 ? "selected" : ""}>${i + 1}교시 후</option>`).join("")}</select></label>
        <label class="field">1교시 시작<input class="short" id="bellStart" value="09:00"></label>
        <label class="field">수업(분)<input class="num" type="number" id="bellLen" value="45"></label>
        <label class="field">쉬는 시간(분)<input class="num" type="number" id="bellRest" value="10"></label>
        <label class="field">점심(분)<input class="num" type="number" id="bellLunch" value="60"></label>
        <button class="btn" id="bellAuto" style="align-self:flex-end">자동 계산</button>
      </div>
      <div class="row" style="margin-top:12px">${bell}</div>
      <label class="check" style="margin-top:12px"><input type="checkbox" data-set-bool="block_cross_lunch" ${s.block_cross_lunch ? "checked" : ""}> 연속수업이 점심시간을 넘어가도 됨</label>
    </div>

    <h2>자동 생성 품질 기준</h2>
    <p class="lead">숫자가 클수록 더 강하게 피합니다. 0이면 고려하지 않습니다. (중복·배정금지 같은 필수 조건은 항상 지킵니다)</p>
    <div class="card"><table class="grid" style="width:auto"><tr><th>기준</th><th>가중치</th></tr>${weights}</table></div>`;
}

document.addEventListener("input", (e) => {
  if (state.view !== "settings") return;
  const t = e.target, s = P().settings;
  if (t.dataset.title !== undefined) { P().title = t.value; $("#projectTitle").textContent = t.value; changed(); }
  else if (t.dataset.set === "school_name") { s.school_name = t.value; changed(); }
  else if (t.dataset.bell !== undefined) { s.bell[+t.dataset.bell] = t.value; changed(); }
});

document.addEventListener("change", (e) => {
  if (state.view !== "settings") return;
  const t = e.target, s = P().settings;
  if (t.dataset.set === "year" || t.dataset.set === "semester" || t.dataset.set === "lunch_after") { s[t.dataset.set] = +t.value; changed(); }
  else if (t.dataset.setBool) { s[t.dataset.setBool] = t.checked; changed(); }
  else if (t.dataset.period) {
    const [g, d] = t.dataset.period.split(":");
    const row = s.periods[g] || (s.periods[g] = days().map(() => 0));
    row[+d] = Math.max(0, +t.value || 0);
    changed({ rerender: true });
  } else if (t.dataset.weight) { s.weights[t.dataset.weight] = Math.max(0, +t.value || 0); changed(); }
  else if (t.dataset.day) {
    const on = ALL_DAYS.filter((d) => ($(`[data-day="${d}"]`).checked));
    // 요일이 바뀌면 교시 배열을 새 요일 순서에 맞춘다
    const old = s.days;
    for (const g of Object.keys(s.periods)) {
      const row = s.periods[g];
      s.periods[g] = on.map((d) => (old.includes(d) ? row[old.indexOf(d)] ?? 0 : (d === "토" ? 0 : 6)));
    }
    s.days = on;
    changed({ rerender: true });
  }
});

document.addEventListener("click", (e) => {
  if (state.view !== "settings") return;
  const s = P().settings;
  if (e.target.id === "addGrade") {
    const g = Math.max(0, ...Object.keys(s.periods).map(Number)) + 1;
    s.periods[String(g)] = days().map(() => 7);
    changed({ rerender: true });
  }
  if (e.target.id === "bellAuto") {
    const [h, m] = $("#bellStart").value.split(":").map(Number);
    const len = +$("#bellLen").value, rest = +$("#bellRest").value, lunch = +$("#bellLunch").value;
    let t = h * 60 + m;
    const fmt = (x) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
    s.bell = Array.from({ length: maxPeriods() }, (_, i) => {
      const v = `${fmt(t)}-${fmt(t + len)}`;
      t += len + (i + 1 === s.lunch_after ? lunch : rest);
      return v;
    });
    changed({ rerender: true });
  }
});

// ---------------------------------------------------------------- 교사
function viewTeachers() {
  const hours = teacherHours();
  const sel = state.teacherSel && tMap()[state.teacherSel];
  const rows = P().teachers.map((t, i) => `
    <tr class="${sel && sel.id === t.id ? "sel" : ""}">
      <td class="center muted">${i + 1}</td>
      <td><input data-t="${t.id}" data-f="name" value="${esc(t.name)}" data-keep="tn${t.id}"></td>
      <td class="center">${hours[t.id] || 0}</td>
      <td class="center"><button class="btn small ${sel && sel.id === t.id ? "on" : ""}" data-avail="${t.id}">${t.unavailable.length ? `금지 ${t.unavailable.length}칸` : "설정"}</button></td>
      <td class="center"><input class="num" type="number" min="0" data-t="${t.id}" data-f="max_per_day" value="${t.max_per_day ?? ""}" placeholder="-"></td>
      <td><input data-t="${t.id}" data-f="memo" value="${esc(t.memo)}" data-keep="tm${t.id}"></td>
      <td class="center"><button class="icon-btn" data-tdel="${t.id}" title="삭제">✕</button></td>
    </tr>`).join("");
  let editor = `<div class="card muted">왼쪽 목록에서 [설정]을 누르면 그 교사의 배정금지 시간을 편집할 수 있습니다.</div>`;
  if (sel) {
    const off = new Set(sel.unavailable.map(([d, p]) => `${d}:${p}`));
    editor = `<div class="card"><b>${esc(sel.name)}</b> 선생님 배정금지 시간
      <p class="muted small">칸을 누르면 수업 불가(빨강)로 바뀝니다. 요일/교시 머리글을 누르면 한 줄 전체가 바뀝니다.</p>
      <table class="avail"><tr><th></th>${days().map((d, di) => `<th data-aday="${di}">${d}</th>`).join("")}</tr>
      ${Array.from({ length: maxPeriods() }, (_, p) => `<tr><th data-aper="${p}">${p + 1}</th>${days().map((_, d) => `<td data-acell="${d}:${p}" class="${off.has(`${d}:${p}`) ? "off" : ""}">${off.has(`${d}:${p}`) ? "✕" : ""}</td>`).join("")}</tr>`).join("")}
      </table>
      <div class="row" style="margin-top:8px"><button class="btn small" data-aclear>모두 해제</button></div></div>`;
  }
  return `
    <h1>교사</h1>
    <p class="lead">교사 이름과 수업 불가 시간(배정금지)을 관리합니다. 시수는 [수업] 화면에서 자동 계산됩니다.</p>
    <div class="row" style="margin-bottom:12px">
      <button class="btn primary" id="addTeacher">교사 추가</button>
      <button class="btn" id="pasteTeachers">이름 여러 명 붙여넣기</button>
    </div>
    <div class="row top">
      <div class="grow" style="min-width:420px"><table class="grid">
        <tr><th>#</th><th>이름</th><th class="center">시수</th><th class="center">배정금지</th><th class="center">하루 최대</th><th>메모</th><th></th></tr>
        ${rows || `<tr><td colspan="7" class="muted">교사가 없습니다.</td></tr>`}
      </table></div>
      <div style="width:420px">${editor}</div>
    </div>`;
}

document.addEventListener("input", (e) => {
  if (state.view !== "teachers") return;
  const t = e.target;
  if (t.dataset.t && (t.dataset.f === "name" || t.dataset.f === "memo")) {
    tMap()[t.dataset.t][t.dataset.f] = t.value;
    changed();
  }
});
document.addEventListener("change", (e) => {
  if (state.view !== "teachers") return;
  const t = e.target;
  if (t.dataset.t && t.dataset.f === "max_per_day") {
    tMap()[t.dataset.t].max_per_day = t.value ? Math.max(1, +t.value) : null;
    changed();
  }
});
document.addEventListener("click", (e) => {
  if (state.view !== "teachers") return;
  const t = e.target;
  if (t.id === "addTeacher") {
    const id = uid("t");
    P().teachers.push({ id, name: `교사${P().teachers.length + 1}`, unavailable: [], max_per_day: null, memo: "" });
    changed({ rerender: true });
    setTimeout(() => $(`[data-t="${id}"][data-f="name"]`)?.select(), 0);
  } else if (t.id === "pasteTeachers") {
    const text = prompt("교사 이름을 한 줄에 한 명씩 (또는 쉼표로 구분) 붙여넣으세요");
    if (!text) return;
    const names = text.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    const have = new Set(P().teachers.map((x) => x.name));
    names.filter((n) => !have.has(n)).forEach((name) => P().teachers.push({ id: uid("t"), name, unavailable: [], max_per_day: null, memo: "" }));
    changed({ rerender: true });
  } else if (t.dataset.tdel) {
    const id = t.dataset.tdel, name = tMap()[id].name;
    const used = P().lessons.filter((l) => l.teachers.includes(id)).length;
    if (!confirm(`${name} 교사를 삭제할까요?${used ? `\n(수업 ${used}개에서 빠집니다)` : ""}`)) return;
    P().teachers = P().teachers.filter((x) => x.id !== id);
    P().lessons.forEach((l) => (l.teachers = l.teachers.filter((x) => x !== id)));
    P().classes.forEach((c) => c.homeroom === id && (c.homeroom = null));
    changed({ rerender: true });
  } else if (t.dataset.avail) {
    state.teacherSel = state.teacherSel === t.dataset.avail ? null : t.dataset.avail;
    render();
  } else if (t.closest("table.avail") && state.teacherSel) {
    const teacher = tMap()[state.teacherSel];
    const set = new Set(teacher.unavailable.map(([d, p]) => `${d}:${p}`));
    const toggle = (keys) => {
      const allOff = keys.every((k) => set.has(k));
      keys.forEach((k) => (allOff ? set.delete(k) : set.add(k)));
    };
    const cell = t.closest("[data-acell]");
    if (cell) toggle([cell.dataset.acell]);
    else if (t.dataset.aday !== undefined) toggle(Array.from({ length: maxPeriods() }, (_, p) => `${t.dataset.aday}:${p}`));
    else if (t.dataset.aper !== undefined) toggle(days().map((_, d) => `${d}:${t.dataset.aper}`));
    else return;
    teacher.unavailable = [...set].map((k) => k.split(":").map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    changed({ rerender: true });
  } else if (t.dataset.aclear !== undefined && state.teacherSel) {
    tMap()[state.teacherSel].unavailable = [];
    changed({ rerender: true });
  }
});

// ---------------------------------------------------------------- 학급
function viewClasses() {
  const hours = lessonHoursPerClass();
  const tm = tMap();
  const byGrade = grades().map((g) => {
    const cls = P().classes.filter((c) => c.grade === g);
    return `<div class="card">
      <div class="row"><b>${g}학년</b><span class="muted small">${cls.length}개 학급</span>
        <div class="spacer grow"></div>
        <button class="btn small" data-cadd="${g}">학급 추가</button></div>
      <table class="grid" style="margin-top:8px">
        <tr><th>학급</th><th>반 이름</th><th>담임</th><th class="center">수업 시수 / 교시 합계</th><th></th></tr>
        ${cls.map((c) => {
          const have = hours[c.id] || 0, cap = classCap(c);
          const cls2 = have === cap ? "ok" : have > cap ? "bad" : "warn";
          return `<tr><td class="nowrap">${classLabel(c)}</td>
            <td><input class="short" data-c="${c.id}" data-f="name" value="${esc(c.name)}" data-keep="cn${c.id}"></td>
            <td><div class="chips" data-homeroom="${c.id}">${c.homeroom && tm[c.homeroom] ? `<span class="chip">${esc(tm[c.homeroom].name)}</span>` : `<span class="placeholder">선택</span>`}</div></td>
            <td class="center"><span class="badge ${cls2}">${have} / ${cap}</span></td>
            <td class="center"><button class="icon-btn" data-cdel="${c.id}">✕</button></td></tr>`;
        }).join("")}
      </table></div>`;
  }).join("");
  return `
    <h1>학급</h1>
    <p class="lead">학년별 학급과 담임을 관리합니다. 반 이름은 숫자가 아니어도 됩니다 (예: 인문1).</p>
    <div class="card row">
      <label class="field">학년<input class="num" type="number" id="bulkGrade" value="${(grades().at(-1) || 0) + 1}" min="1"></label>
      <label class="field">학급 수<input class="num" type="number" id="bulkCount" value="6" min="1"></label>
      <button class="btn primary" id="bulkAdd" style="align-self:flex-end">학년 학급 한 번에 만들기</button>
    </div>
    ${byGrade || `<div class="card muted">학급이 없습니다. 위에서 학년과 학급 수를 넣어 만드세요.</div>`}`;
}

function addClass(grade, name) {
  P().classes.push({ id: uid("c"), grade, name: String(name), homeroom: null });
  P().classes.sort((a, b) => a.grade - b.grade || (parseInt(a.name) || 0) - (parseInt(b.name) || 0) || a.name.localeCompare(b.name));
  const s = P().settings;
  if (!s.periods[String(grade)]) s.periods[String(grade)] = days().map(() => 7);
}

document.addEventListener("input", (e) => {
  if (state.view !== "classes") return;
  const t = e.target;
  if (t.dataset.c && t.dataset.f === "name") { cMap()[t.dataset.c].name = t.value; changed(); }
});
document.addEventListener("click", (e) => {
  if (state.view !== "classes") return;
  const t = e.target;
  if (t.id === "bulkAdd") {
    const g = +$("#bulkGrade").value, n = +$("#bulkCount").value;
    if (!g || !n) return;
    const have = new Set(P().classes.filter((c) => c.grade === g).map((c) => c.name));
    for (let i = 1; i <= n; i++) if (!have.has(String(i))) addClass(g, i);
    changed({ rerender: true });
  } else if (t.dataset.cadd) {
    const g = +t.dataset.cadd;
    const nums = P().classes.filter((c) => c.grade === g).map((c) => parseInt(c.name) || 0);
    addClass(g, Math.max(0, ...nums) + 1);
    changed({ rerender: true });
  } else if (t.dataset.cdel) {
    const id = t.dataset.cdel;
    const used = P().lessons.filter((l) => l.classes.includes(id)).length;
    if (!confirm(`${classLabel(cMap()[id])} 학급을 삭제할까요?${used ? `\n(수업 ${used}개에서 빠집니다)` : ""}`)) return;
    P().classes = P().classes.filter((c) => c.id !== id);
    P().lessons.forEach((l) => (l.classes = l.classes.filter((x) => x !== id)));
    changed({ rerender: true });
  } else if (t.closest("[data-homeroom]")) {
    const el = t.closest("[data-homeroom]");
    const c = cMap()[el.dataset.homeroom];
    const items = [{ id: "", label: "(없음)" }, ...P().teachers.map((x) => ({ id: x.id, label: x.name }))];
    openPicker(el, items, [c.homeroom || ""], ([v]) => { c.homeroom = v || null; changed({ rerender: true }); }, { single: true });
  }
});

// ---------------------------------------------------------------- 과목·특별실
function viewSubjects() {
  const used = {};
  P().lessons.forEach((l) => (used[l.subject] = (used[l.subject] || 0) + 1));
  const roomUse = {};
  P().lessons.forEach((l) => l.room && (roomUse[l.room] = (roomUse[l.room] || 0) + Number(l.hours)));
  return `
    <h1>과목·특별실</h1>
    <p class="lead">정식 과목명은 NEIS에 등록된 이름과 같게, 약칭은 시간표 칸에 보일 짧은 이름입니다. 약칭 글자 수 제한은 없습니다.</p>
    <div class="row top">
      <div class="grow" style="min-width:420px">
        <div class="row" style="margin-bottom:8px"><b>과목</b><button class="btn small" id="addSubject">과목 추가</button></div>
        <table class="grid"><tr><th>정식 과목명</th><th>약칭</th><th class="center">수업 수</th><th></th></tr>
        ${P().subjects.map((s) => `<tr>
          <td><input data-s="${s.id}" data-f="name" value="${esc(s.name)}" data-keep="sn${s.id}"></td>
          <td><input class="short" data-s="${s.id}" data-f="short" value="${esc(s.short)}" data-keep="ss${s.id}" style="background:${subjectColor(s.id)}"></td>
          <td class="center">${used[s.id] || 0}</td>
          <td class="center"><button class="icon-btn" data-sdel="${s.id}">✕</button></td></tr>`).join("")}
        </table>
      </div>
      <div style="width:360px">
        <div class="row" style="margin-bottom:8px"><b>특별실</b><button class="btn small" id="addRoom">특별실 추가</button></div>
        <table class="grid"><tr><th>이름</th><th class="center">주당 사용</th><th></th></tr>
        ${P().rooms.map((r) => `<tr>
          <td><input data-r="${r.id}" value="${esc(r.name)}" data-keep="rn${r.id}"></td>
          <td class="center">${roomUse[r.id] || 0}시간</td>
          <td class="center"><button class="icon-btn" data-rdel="${r.id}">✕</button></td></tr>`).join("") || `<tr><td colspan="3" class="muted">없음</td></tr>`}
        </table>
        <p class="muted small">특별실을 쓰는 수업은 [수업] 화면에서 지정합니다. 같은 특별실은 같은 시간에 한 수업만 들어갑니다.</p>
      </div>
    </div>`;
}

document.addEventListener("input", (e) => {
  if (state.view !== "subjects") return;
  const t = e.target;
  if (t.dataset.s) { sMap()[t.dataset.s][t.dataset.f] = t.value; changed(); }
  if (t.dataset.r) { rMap()[t.dataset.r].name = t.value; changed(); }
});
document.addEventListener("click", (e) => {
  if (state.view !== "subjects") return;
  const t = e.target;
  if (t.id === "addSubject") { P().subjects.push({ id: uid("s"), name: "새 과목", short: "" }); changed({ rerender: true }); }
  else if (t.id === "addRoom") { P().rooms.push({ id: uid("r"), name: "새 특별실" }); changed({ rerender: true }); }
  else if (t.dataset.sdel) {
    const id = t.dataset.sdel;
    const n = P().lessons.filter((l) => l.subject === id).length;
    if (n && !confirm(`이 과목을 쓰는 수업 ${n}개도 함께 삭제됩니다. 계속할까요?`)) return;
    const gone = new Set(P().lessons.filter((l) => l.subject === id).map((l) => l.id));
    P().lessons = P().lessons.filter((l) => !gone.has(l.id));
    P().timetable = P().timetable.filter((pl) => !gone.has(pl.lesson));
    P().subjects = P().subjects.filter((s) => s.id !== id);
    changed({ rerender: true });
  } else if (t.dataset.rdel) {
    const id = t.dataset.rdel;
    P().rooms = P().rooms.filter((r) => r.id !== id);
    P().lessons.forEach((l) => l.room === id && (l.room = null));
    changed({ rerender: true });
  }
});

// ---------------------------------------------------------------- 수업(시수표)
function lessonMatches(l, f, tm, cm, sm) {
  if (f.grade && !l.classes.some((c) => String(cm[c]?.grade) === f.grade)) return false;
  if (!f.text) return true;
  const hay = [subjName(sm[l.subject]), sm[l.subject]?.name, ...l.teachers.map((t) => tm[t]?.name), ...l.classes.map((c) => classLabel(cm[c])), l.sync || ""].join(" ");
  return f.text.split(/\s+/).every((w) => hay.includes(w));
}

function viewLessons() {
  const tm = tMap(), cm = cMap(), sm = sMap(), rm = rMap();
  const f = state.lessonFilter;
  const hours = lessonHoursPerClass();
  const syncs = [...new Set(P().lessons.map((l) => l.sync).filter(Boolean))];
  const list = P().lessons.filter((l) => lessonMatches(l, f, tm, cm, sm));
  const bar = P().classes.map((c) => {
    const have = hours[c.id] || 0, cap = classCap(c);
    return `<span class="${have === cap ? "" : have > cap ? "bad" : "warn"}" title="수업 시수 / 교시 합계">${classLabel(c)} ${have}/${cap}</span>`;
  }).join("");
  const rows = list.map((l) => `<tr>
    <td><select data-l="${l.id}" data-f="subject" style="background:${subjectColor(l.subject)}">${P().subjects.map((s) => `<option value="${s.id}" ${s.id === l.subject ? "selected" : ""}>${esc(subjName(s))}</option>`).join("")}</select></td>
    <td><div class="chips" data-lpick="teachers" data-l="${l.id}">${l.teachers.map((t) => `<span class="chip">${esc(tm[t]?.name || "?")}</span>`).join("") || `<span class="placeholder">교사 선택</span>`}</div></td>
    <td><div class="chips" data-lpick="classes" data-l="${l.id}">${l.classes.map((c) => `<span class="chip">${esc(classLabel(cm[c]))}</span>`).join("") || `<span class="placeholder">학급 선택</span>`}</div></td>
    <td class="center"><input class="num" type="number" min="1" data-l="${l.id}" data-f="hours" value="${l.hours}"></td>
    <td class="center"><input class="short" data-l="${l.id}" data-f="blocks" value="${l.blocks.join(",")}" placeholder="없음" title="예: 2 → 2시간 연속 1회, 2,2 → 2시간 연속 2회" data-keep="lb${l.id}"></td>
    <td><select data-l="${l.id}" data-f="room"><option value="">-</option>${P().rooms.map((r) => `<option value="${r.id}" ${r.id === l.room ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></td>
    <td><input data-l="${l.id}" data-f="sync" list="syncList" value="${esc(l.sync || "")}" placeholder="-" data-keep="ls${l.id}"></td>
    <td class="center nowrap"><button class="icon-btn" data-ldup="${l.id}" title="복제" style="color:var(--accent)">⧉</button><button class="icon-btn" data-ldel="${l.id}" title="삭제">✕</button></td>
  </tr>`).join("");
  return `
    <h1>수업(시수표)</h1>
    <p class="lead">한 줄이 하나의 수업입니다. 학급을 여러 개 고르면 <b>합반</b>, 교사를 여러 명 고르면 <b>복수교사</b>,
      같은 <b>동시 그룹</b> 이름을 넣은 수업들은 같은 시간에 배정됩니다 (수준별 이동수업·선택과목·창체 일괄배정).</p>
    <div class="card">
      <div class="row">
        <button class="btn primary" id="addLesson">수업 추가</button>
        <label class="btn">교사별 시수표 엑셀 가져오기<input type="file" id="importHours" accept=".xlsx" hidden></label>
        <a class="btn" href="/api/template.xlsx">양식 내려받기</a>
        <div class="grow"></div>
        <select id="lfGrade"><option value="">전체 학년</option>${grades().map((g) => `<option value="${g}" ${f.grade == g ? "selected" : ""}>${g}학년</option>`).join("")}</select>
        <input id="lfText" placeholder="과목·교사·학급 검색" value="${esc(f.text)}" data-keep="lf">
      </div>
      <div class="hours-bar" style="margin-top:10px">${bar}</div>
    </div>
    <datalist id="syncList">${syncs.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
    <table class="grid">
      <tr><th>과목</th><th>교사</th><th>학급</th><th class="center">주당 시수</th><th class="center">연속</th><th>특별실</th><th>동시 그룹</th><th></th></tr>
      ${rows || `<tr><td colspan="8" class="muted">수업이 없습니다. [수업 추가] 또는 엑셀 가져오기를 이용하세요.</td></tr>`}
    </table>
    <p class="muted small">${list.length} / ${P().lessons.length}개 수업 표시</p>`;
}

function removeLessonPlacements(ids) {
  const gone = new Set(ids);
  P().timetable = P().timetable.filter((pl) => !gone.has(pl.lesson));
}

document.addEventListener("input", (e) => {
  if (state.view !== "lessons") return;
  const t = e.target;
  if (t.id === "lfText") { state.lessonFilter.text = t.value.trim(); renderContentOnly(); return; }
  if (!t.dataset.l) return;
  const l = lMap()[t.dataset.l];
  if (t.dataset.f === "sync") { l.sync = t.value.trim() || null; changed(); }
  if (t.dataset.f === "blocks") {
    l.blocks = t.value.split(/[,\s]+/).map(Number).filter((x) => x >= 2);
    changed();
  }
});
document.addEventListener("change", async (e) => {
  if (state.view !== "lessons") return;
  const t = e.target;
  if (t.id === "lfGrade") { state.lessonFilter.grade = t.value; renderContentOnly(); return; }
  if (t.id === "importHours" && t.files[0]) {
    if (P().lessons.length && !confirm("가져오면 기존 교사·학급·과목·수업·시간표가 모두 새 자료로 바뀝니다. 계속할까요?")) { t.value = ""; return; }
    await flushSave();
    try {
      const res = await api("POST", `/api/projects/${P().id}/import-hours`, t.files[0]);
      state.project = res.project;
      const s = res.stats;
      toast(`가져오기 완료: 교사 ${s.teachers}명, 학급 ${s.classes}개, 과목 ${s.subjects}개, 수업 ${s.lessons}개`, 4000);
      render();
      runCheck();
    } catch (err) { toast("가져오기 실패: " + err.message, 5000); }
    return;
  }
  if (!t.dataset.l) return;
  const l = lMap()[t.dataset.l];
  if (t.dataset.f === "subject") { l.subject = t.value; changed({ rerender: true }); }
  if (t.dataset.f === "room") { l.room = t.value || null; changed(); }
  if (t.dataset.f === "hours") {
    l.hours = Math.max(1, +t.value || 1);
    removeLessonPlacements([l.id]);
    changed({ rerender: true });
  }
  if (t.dataset.f === "blocks" || t.dataset.f === "sync") renderContentOnly();
});
document.addEventListener("click", (e) => {
  if (state.view !== "lessons") return;
  const t = e.target;
  if (t.id === "addLesson") {
    if (!P().subjects.length) { toast("먼저 [과목·특별실]에서 과목을 추가하세요."); return; }
    P().lessons.unshift({ id: uid("l"), subject: P().subjects[0].id, teachers: [], classes: [], hours: 1, blocks: [], room: null, sync: null, fixed: [], max_per_day: null });
    changed({ rerender: true });
  } else if (t.dataset.ldel) {
    removeLessonPlacements([t.dataset.ldel]);
    P().lessons = P().lessons.filter((l) => l.id !== t.dataset.ldel);
    changed({ rerender: true });
  } else if (t.dataset.ldup) {
    const src = lMap()[t.dataset.ldup];
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid("l");
    copy.classes = [];
    copy.fixed = [];
    P().lessons.splice(P().lessons.indexOf(src) + 1, 0, copy);
    changed({ rerender: true });
  } else if (t.closest("[data-lpick]")) {
    const el = t.closest("[data-lpick]");
    const l = lMap()[el.dataset.l];
    const field = el.dataset.lpick;
    const items = field === "teachers"
      ? P().teachers.map((x) => ({ id: x.id, label: x.name }))
      : P().classes.map((c) => ({ id: c.id, label: classLabel(c), group: `${c.grade}학년` }));
    openPicker(el, items, l[field], (ids) => {
      l[field] = ids;
      changed();
      const tm = tMap(), cm = cMap();
      el.innerHTML = ids.map((i) => `<span class="chip">${esc(field === "teachers" ? tm[i]?.name : classLabel(cm[i]))}</span>`).join("") || `<span class="placeholder">선택</span>`;
    });
  }
});
