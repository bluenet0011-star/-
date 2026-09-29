"""기초자료 점검과 시간표 점검.

솔버와 독립적으로 동작하므로 수동으로 수정한 시간표도 같은 기준으로 검사할 수 있다.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Optional

from pydantic import BaseModel, Field

from .model import Project


class Issue(BaseModel):
    level: str  # "error" | "warning" | "info"
    code: str
    message: str
    slots: list[tuple[int, int]] = Field(default_factory=list)
    lessons: list[str] = Field(default_factory=list)
    teacher: Optional[str] = None
    school_class: Optional[str] = None


def _names(project: Project):
    tm, cm, sm = project.teacher_map(), project.class_map(), project.subject_map()

    def teacher(tid):
        return tm[tid].name if tid in tm else f"(없는 교사 {tid})"

    def klass(cid):
        return cm[cid].label if cid in cm else f"(없는 학급 {cid})"

    def subject(sid):
        return sm[sid].display if sid in sm else f"(없는 과목 {sid})"

    return teacher, klass, subject


def check_data(project: Project) -> list[Issue]:
    """시간표 생성 전에 기초자료의 문제를 찾는다."""
    issues: list[Issue] = []
    s = project.settings
    n_days = len(s.days)
    tm, cm, sm, rm = project.teacher_map(), project.class_map(), project.subject_map(), project.room_map()
    teacher, klass, subject = _names(project)

    if n_days == 0:
        issues.append(Issue(level="error", code="no_days", message="요일이 설정되지 않았습니다."))
    grades = sorted({c.grade for c in project.classes})
    for g in grades:
        row = s.periods.get(str(g))
        if not row or len(row) != n_days:
            issues.append(Issue(level="error", code="no_periods",
                                message=f"{g}학년 요일별 교시 수가 설정되지 않았습니다."))

    # 참조 무결성
    for l in project.lessons:
        label = subject(l.subject)
        if l.subject not in sm:
            issues.append(Issue(level="error", code="bad_ref", message=f"수업 {l.id}: 과목이 없습니다.", lessons=[l.id]))
        for t in l.teachers:
            if t not in tm:
                issues.append(Issue(level="error", code="bad_ref", message=f"{label}: 없는 교사가 지정되어 있습니다.", lessons=[l.id]))
        for c in l.classes:
            if c not in cm:
                issues.append(Issue(level="error", code="bad_ref", message=f"{label}: 없는 학급이 지정되어 있습니다.", lessons=[l.id]))
        if l.room and l.room not in rm:
            issues.append(Issue(level="error", code="bad_ref", message=f"{label}: 없는 특별실이 지정되어 있습니다.", lessons=[l.id]))
        if not l.classes:
            issues.append(Issue(level="error", code="no_class", message=f"{label}: 학급이 지정되지 않았습니다.", lessons=[l.id]))
        if not l.teachers:
            issues.append(Issue(level="warning", code="no_teacher", message=f"{label} ({', '.join(klass(c) for c in l.classes)}): 교사가 지정되지 않았습니다.", lessons=[l.id]))
        if l.hours <= 0:
            issues.append(Issue(level="error", code="bad_hours", message=f"{label}: 시수가 0 이하입니다.", lessons=[l.id]))
        if sum(b for b in l.blocks if b >= 2) > l.hours:
            issues.append(Issue(level="error", code="bad_blocks", message=f"{label}: 연속 블록 합계가 시수보다 큽니다.", lessons=[l.id]))
        if any(b > s.max_periods for b in l.blocks):
            issues.append(Issue(level="error", code="bad_blocks", message=f"{label}: 연속 블록이 하루 교시 수보다 깁니다.", lessons=[l.id]))
        if l.n_blocks() > n_days * l.daily_limit(n_days):
            issues.append(Issue(level="error", code="daily_limit", message=f"{label}: 하루 최대 {l.daily_limit(n_days)}회로는 {l.n_blocks()}회를 배정할 수 없습니다.", lessons=[l.id]))

    # 동시 그룹: 같은 시수/블록 구조여야 하고 학급·교사가 겹치면 안 됨
    groups: dict[str, list] = defaultdict(list)
    for l in project.lessons:
        if l.sync:
            groups[l.sync].append(l)
    for g, ls in groups.items():
        shapes = {tuple(sorted(l.block_counts().items())) for l in ls}
        if len(shapes) > 1:
            issues.append(Issue(level="error", code="sync_shape",
                                message=f"동시 그룹 '{g}': 묶인 수업들의 시수(또는 연속 블록)가 서로 다릅니다.",
                                lessons=[l.id for l in ls]))
        # 같은 학급이 여러 수업에 들어가는 것은 분반(수준별·선택과목)이라 정상이지만,
        # 같은 교사가 두 수업에 들어가면 동시에 배정할 수 없다.
        seen_t: dict[str, int] = defaultdict(int)
        for l in ls:
            for t in l.teachers:
                seen_t[t] += 1
        for t, n in seen_t.items():
            if n > 1:
                issues.append(Issue(level="error", code="sync_overlap", message=f"동시 그룹 '{g}': {teacher(t)} 교사가 같은 시간에 두 수업에 들어갑니다.", lessons=[l.id for l in ls], teacher=t))

    # 학급별 시수 합계 vs 요일별 교시 (분반된 동시 그룹은 한 번만 센다)
    class_hours: dict[str, int] = defaultdict(int)
    counted_sync: set[tuple[str, str]] = set()
    for l in project.lessons:
        for c in l.classes:
            if l.sync:
                key = (l.sync, c)
                if key in counted_sync:
                    continue
                counted_sync.add(key)
            class_hours[c] += l.hours
    for c in project.classes:
        cap = project.class_capacity(c)
        have = class_hours.get(c.id, 0)
        if have != cap:
            level = "error" if have > cap else "warning"
            issues.append(Issue(level=level, code="class_hours",
                                message=f"{c.label}: 수업 시수 합계 {have}시간 / 요일별 교시 합계 {cap}시간" + (" (빈 교시가 생깁니다)" if have < cap else " (넘칩니다)"),
                                school_class=c.id))

    # 교사별 시수 vs 가능한 슬롯
    teacher_hours: dict[str, int] = defaultdict(int)
    for l in project.lessons:
        for t in l.teachers:
            teacher_hours[t] += l.hours
    day_periods = [max((s.periods_for(g, d) for g in grades), default=0) for d in range(n_days)]
    open_slots = {(d, p) for d in range(n_days) for p in range(day_periods[d])}
    for t in project.teachers:
        free = len(open_slots - set(map(tuple, t.unavailable)))
        if t.max_per_day:
            free = min(free, t.max_per_day * n_days)
        if teacher_hours.get(t.id, 0) > free:
            issues.append(Issue(level="error", code="teacher_hours",
                                message=f"{t.name}: 수업 {teacher_hours[t.id]}시간인데 가능한 칸은 {free}칸뿐입니다.",
                                teacher=t.id))
        if teacher_hours.get(t.id, 0) == 0:
            issues.append(Issue(level="info", code="teacher_idle", message=f"{t.name}: 배정된 수업이 없습니다.", teacher=t.id))

    # 특별실 사용 시간 vs 한 주 교시 수
    room_hours: dict[str, int] = defaultdict(int)
    for l in project.lessons:
        if l.room:
            room_hours[l.room] += l.hours
    for r, h in room_hours.items():
        if r in rm and h > len(open_slots):
            issues.append(Issue(level="error", code="room_hours",
                                message=f"특별실 '{rm[r].name}': 사용 시간 {h}시간이 한 주 교시 수 {len(open_slots)}보다 많습니다."))

    # 고정 슬롯 유효성
    for l in project.lessons:
        for d, p in l.fixed:
            for c in l.classes:
                if c in cm and not project.slot_open_for_class(cm[c], d, p):
                    issues.append(Issue(level="error", code="bad_fixed",
                                        message=f"{subject(l.subject)}: 고정 슬롯 {s.days[d] if d < n_days else d}{p + 1}교시는 {klass(c)}의 수업 시간이 아닙니다.",
                                        lessons=[l.id], slots=[(d, p)]))
    return issues


def occupancy(project: Project):
    """(요일, 교시) -> 배정된 수업 id 목록 을 교사/학급/특별실별로 계산."""
    lm = project.lesson_map()
    by_teacher: dict[tuple[str, int, int], list[str]] = defaultdict(list)
    by_class: dict[tuple[str, int, int], list[str]] = defaultdict(list)
    by_room: dict[tuple[str, int, int], list[str]] = defaultdict(list)
    for pl in project.timetable:
        l = lm.get(pl.lesson)
        if not l:
            continue
        for t in l.teachers:
            by_teacher[(t, pl.day, pl.period)].append(l.id)
        for c in l.classes:
            by_class[(c, pl.day, pl.period)].append(l.id)
        if l.room:
            by_room[(l.room, pl.day, pl.period)].append(l.id)
    return by_teacher, by_class, by_room


def check_timetable(project: Project) -> list[Issue]:
    """현재 시간표(project.timetable)의 문제를 찾는다."""
    issues: list[Issue] = []
    s = project.settings
    n_days = len(s.days)
    lm, cm, tm, rm = project.lesson_map(), project.class_map(), project.teacher_map(), project.room_map()
    teacher, klass, subject = _names(project)
    by_teacher, by_class, by_room = occupancy(project)

    def slot_name(d, p):
        return f"{s.days[d] if d < n_days else d}{p + 1}교시"

    # 같은 동시 그룹은 한 학급이 여러 수업(분반)에 동시에 있어도 정상
    def real_conflict(lesson_ids):
        syncs = {lm[i].sync for i in lesson_ids}
        return not (len(syncs) == 1 and None not in syncs)

    for (t, d, p), ids in by_teacher.items():
        if len(ids) > 1:
            issues.append(Issue(level="error", code="teacher_clash", message=f"{teacher(t)}: {slot_name(d, p)}에 수업이 {len(ids)}개 겹칩니다.",
                                slots=[(d, p)], lessons=ids, teacher=t))
    for (c, d, p), ids in by_class.items():
        if len(ids) > 1 and real_conflict(ids):
            issues.append(Issue(level="error", code="class_clash", message=f"{klass(c)}: {slot_name(d, p)}에 수업이 {len(ids)}개 겹칩니다.",
                                slots=[(d, p)], lessons=ids, school_class=c))
    for (r, d, p), ids in by_room.items():
        if len(ids) > 1:
            issues.append(Issue(level="error", code="room_clash", message=f"{rm[r].name if r in rm else r}: {slot_name(d, p)}에 {len(ids)}개 수업이 겹칩니다.",
                                slots=[(d, p)], lessons=ids))

    placed: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for pl in project.timetable:
        placed[pl.lesson].append((pl.day, pl.period))

    for l in project.lessons:
        slots = placed.get(l.id, [])
        n = len(slots)
        label = f"{subject(l.subject)} ({', '.join(klass(c) for c in l.classes)})"
        if n < l.hours:
            issues.append(Issue(level="error", code="unplaced", message=f"{label}: {l.hours - n}시간 미배정", lessons=[l.id]))
        elif n > l.hours:
            issues.append(Issue(level="error", code="overplaced", message=f"{label}: {n - l.hours}시간 초과 배정", lessons=[l.id]))
        for c in l.classes:
            if c in cm:
                for d, p in slots:
                    if not project.slot_open_for_class(cm[c], d, p):
                        issues.append(Issue(level="error", code="outside_hours", message=f"{label}: {slot_name(d, p)}는 {klass(c)}의 수업 시간이 아닙니다.", lessons=[l.id], slots=[(d, p)]))
        for t in l.teachers:
            if t in tm:
                bad = set(map(tuple, tm[t].unavailable)) & set(slots)
                for d, p in sorted(bad):
                    issues.append(Issue(level="error", code="teacher_unavailable", message=f"{teacher(t)}: 배정금지 시간 {slot_name(d, p)}에 수업이 있습니다.", lessons=[l.id], slots=[(d, p)], teacher=t))
        for d, p in l.fixed:
            if (d, p) not in slots:
                issues.append(Issue(level="error", code="fixed_moved", message=f"{label}: 고정 시간 {slot_name(d, p)}에 배정되지 않았습니다.", lessons=[l.id], slots=[(d, p)]))
        # 연속 블록 / 하루 배정 횟수
        per_day: dict[int, list[int]] = defaultdict(list)
        for d, p in slots:
            per_day[d].append(p)
        runs = []
        for d, ps in per_day.items():
            ps.sort()
            start = prev = ps[0]
            for p in ps[1:]:
                if p == prev + 1:
                    prev = p
                    continue
                runs.append((d, start, prev - start + 1))
                start = prev = p
            runs.append((d, start, prev - start + 1))
        want = sorted(l.block_counts().items())
        if n == l.hours and any(b >= 2 for b in l.blocks):
            have: dict[int, int] = defaultdict(int)
            for _, _, ln in runs:
                have[ln] += 1
            if sorted(have.items()) != want:
                issues.append(Issue(level="warning", code="block_broken", message=f"{label}: 연속수업 구성이 설정과 다릅니다.", lessons=[l.id]))
        limit = l.daily_limit(n_days)
        runs_per_day: dict[int, int] = defaultdict(int)
        for d, _, _ in runs:
            runs_per_day[d] += 1
        for d, cnt in runs_per_day.items():
            if cnt > limit:
                issues.append(Issue(level="warning", code="same_day", message=f"{label}: {s.days[d]}요일에 {cnt}번 들어갑니다.", lessons=[l.id], slots=[(d, p) for p in per_day[d]]))

    # 동시 그룹 시간 일치
    groups: dict[str, list[str]] = defaultdict(list)
    for l in project.lessons:
        if l.sync:
            groups[l.sync].append(l.id)
    for g, ids in groups.items():
        sets = {i: set(placed.get(i, [])) for i in ids}
        base = next(iter(sets.values()))
        if any(v != base for v in sets.values()):
            issues.append(Issue(level="error", code="sync_broken", message=f"동시 그룹 '{g}'의 수업 시간이 서로 다릅니다.", lessons=ids))

    # 품질(권장) 점검: 교사 3시간 연속, 하루 과다
    for t in project.teachers:
        busy = {(d, p) for (tt, d, p) in by_teacher if tt == t.id}
        for d in range(n_days):
            ps = sorted(p for (dd, p) in busy if dd == d)
            run = 1
            for i in range(1, len(ps)):
                run = run + 1 if ps[i] == ps[i - 1] + 1 else 1
                if run == 3:
                    issues.append(Issue(level="info", code="three_in_row", message=f"{t.name}: {s.days[d]}요일 3시간 이상 연속 수업", teacher=t.id, slots=[(d, p) for p in ps]))
            if t.max_per_day and len(ps) > t.max_per_day:
                issues.append(Issue(level="error", code="teacher_day_max", message=f"{t.name}: {s.days[d]}요일 수업 {len(ps)}시간 (최대 {t.max_per_day})", teacher=t.id))
    return issues


def summarize(issues: list[Issue]) -> dict:
    out = {"error": 0, "warning": 0, "info": 0}
    for i in issues:
        out[i.level] = out.get(i.level, 0) + 1
    return out
