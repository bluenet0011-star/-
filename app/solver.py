"""OR-Tools CP-SAT 기반 시간표 자동 생성.

필수 조건(반드시 지킴)
- 교사/학급/특별실 중복 금지 (동시 그룹의 분반은 한 학급이 여러 수업에 동시에 있어도 됨)
- 학년별 요일별 교시 수 안에서만 배정
- 연속수업 블록, 하루 배정 횟수 제한
- 교사 배정금지 시간, 교사 하루 최대 수업
- 고정 슬롯(수업의 fixed, 시간표의 locked 배치)
- 동시 그룹은 같은 시간에 배정

품질 조건(가중치로 최소화) — settings.weights
- 교사 3시간 연속, 점심 전후 연속, 하루 수업 과다, 1교시/마지막 교시
- 최소 변경 모드: 기존 시간표에서 바뀐 칸

해가 없으면 가정(assumption) 기반으로 서로 충돌하는 조건 묶음을 찾아 알려준다.
"""

from __future__ import annotations

import math
import time
from collections import defaultdict
from typing import Optional

from ortools.sat.python import cp_model
from pydantic import BaseModel, Field

from .checker import check_data
from .model import Lesson, Placement, Project


class SolveOptions(BaseModel):
    time_limit: float = Field(30.0, description="최대 계산 시간(초)")
    keep_previous: bool = Field(False, description="기존 시간표에서 최소한만 바꾸기")
    workers: int = 8
    seed: int = 0


class SolveResult(BaseModel):
    status: str  # optimal | feasible | infeasible | unknown | invalid
    message: str
    timetable: list[Placement] = Field(default_factory=list)
    objective: Optional[float] = None
    penalties: dict[str, int] = Field(default_factory=dict)
    conflicts: list[str] = Field(default_factory=list, description="해가 없을 때 서로 충돌하는 조건 설명")
    seconds: float = 0.0


class _Builder:
    def __init__(self, project: Project, options: SolveOptions, with_assumptions: bool):
        self.p = project
        self.o = options
        self.m = cp_model.CpModel()
        self.s = project.settings
        self.n_days = len(self.s.days)
        self.with_assumptions = with_assumptions
        self.assumptions: dict[int, str] = {}  # literal index -> 설명
        self.lits: list[cp_model.IntVar] = []
        self.cm = project.class_map()
        self.tm = project.teacher_map()
        self.sm = project.subject_map()
        # z[(lesson, size)] -> {(d, p): var}  블록 시작 변수
        self.z: dict[tuple[str, int], dict[tuple[int, int], cp_model.IntVar]] = {}
        self.penalty_terms: dict[str, list] = defaultdict(list)

    # ---- 도우미 ----
    def label(self, l: Lesson) -> str:
        subj = self.sm[l.subject].display if l.subject in self.sm else "?"
        classes = ", ".join(self.cm[c].label for c in l.classes if c in self.cm)
        return f"{subj}({classes})"

    def guard(self, text: str):
        """조건 묶음을 켜고 끄는 가정 리터럴. 진단 모드가 아니면 None."""
        if not self.with_assumptions:
            return None
        lit = self.m.NewBoolVar(text)
        self.assumptions[lit.Index()] = text
        self.lits.append(lit)
        return lit

    def add(self, ct, lit):
        if lit is not None:
            ct.OnlyEnforceIf(lit)

    def day_periods(self, l: Lesson, d: int) -> int:
        """수업의 모든 학급이 공통으로 가진 교시 수."""
        values = [self.s.periods_for(self.cm[c].grade, d) for c in l.classes if c in self.cm]
        return min(values) if values else 0

    def lunch_ok(self, start: int, size: int) -> bool:
        if self.s.block_cross_lunch or size < 2 or self.s.lunch_after <= 0:
            return True
        last = start + size - 1
        return not (start < self.s.lunch_after <= last)

    # ---- 변수 ----
    def build_vars(self):
        # 동시 그룹의 대표 수업: 같은 그룹 수업들은 시작 변수를 공유한다.
        self.rep: dict[str, str] = {}
        by_sync: dict[str, list[Lesson]] = defaultdict(list)
        for l in self.p.lessons:
            if l.sync:
                by_sync[l.sync].append(l)
        self.sync_groups = by_sync
        for g, ls in by_sync.items():
            for l in ls:
                self.rep[l.id] = ls[0].id

        lm = self.p.lesson_map()
        for l in self.p.lessons:
            if l.id in self.rep and self.rep[l.id] != l.id:
                continue  # 대표 수업의 변수를 공유
            members = [lm[i] for i in self.rep if self.rep[i] == l.id] if l.id in self.rep else [l]
            for size, count in l.block_counts().items():
                starts = {}
                for d in range(self.n_days):
                    dp = min(self.day_periods(m, d) for m in members)
                    for p in range(dp - size + 1):
                        if self.lunch_ok(p, size):
                            starts[(d, p)] = self.m.NewBoolVar(f"z_{l.id}_{size}_{d}_{p}")
                self.z[(l.id, size)] = starts

    def rep_id(self, l: Lesson) -> str:
        return self.rep.get(l.id, l.id)

    def occ(self, l: Lesson, d: int, p: int):
        """수업 l 이 (d, p) 에 있으면 1 인 선형식."""
        rid = self.rep_id(l)
        terms = []
        for size in l.block_counts():
            starts = self.z.get((rid, size), {})
            for q in range(max(0, p - size + 1), p + 1):
                v = starts.get((d, q))
                if v is not None:
                    terms.append(v)
        return sum(terms) if terms else 0

    # ---- 조건 ----
    def build_constraints(self):
        lm = self.p.lesson_map()
        max_p = self.s.max_periods
        n_days = self.n_days

        # 동시 그룹 구조가 다르면 공유 변수로 표현할 수 없으므로 미리 거른다.
        for g, ls in self.sync_groups.items():
            shapes = {tuple(sorted(l.block_counts().items())) for l in ls}
            if len(shapes) > 1:
                raise ValueError(f"동시 그룹 '{g}'의 수업들의 시수/연속 구성이 서로 다릅니다.")

        # 1) 블록 개수 + 하루 횟수 제한
        for l in self.p.lessons:
            if self.rep_id(l) != l.id:
                continue
            for size, count in l.block_counts().items():
                starts = self.z[(l.id, size)]
                if len(starts) < count:
                    lit = self.guard(f"{self.label(l)}의 연속 {size}시간 수업")
                    # 넣을 자리가 모자람 → 가정이 있으면 이 가정이 거짓이 되어야 함
                    if lit is not None:
                        self.m.AddBoolOr([lit.Not()])
                    else:
                        self.m.AddBoolOr([])  # 불가능
                    continue
                self.m.Add(sum(starts.values()) == count)
            limit = l.daily_limit(n_days)
            lit = self.guard(f"{self.label(l)}의 하루 최대 {limit}회 제한")
            for d in range(n_days):
                day_starts = [v for size in l.block_counts() for (dd, _), v in self.z[(l.id, size)].items() if dd == d]
                if len(day_starts) > limit:
                    self.add(self.m.Add(sum(day_starts) <= limit), lit)
            # 같은 수업이 같은 칸에 두 번 들어가지 않음
            for d in range(n_days):
                for p in range(max_p):
                    e = self.occ(l, d, p)
                    if not isinstance(e, int):
                        self.m.Add(e <= 1)

        # 2) 교사 중복 금지 (동시 그룹이라도 교사는 각자 1개)
        by_teacher: dict[str, list[Lesson]] = defaultdict(list)
        for l in self.p.lessons:
            for t in l.teachers:
                by_teacher[t].append(l)
        for t, ls in by_teacher.items():
            for d in range(n_days):
                for p in range(max_p):
                    terms = [self.occ(l, d, p) for l in ls]
                    terms = [x for x in terms if not isinstance(x, int)]
                    if len(terms) > 1:
                        self.m.Add(sum(terms) <= 1)

        # 3) 학급 중복 금지 — 같은 동시 그룹은 한 번만 센다(분반)
        by_class: dict[str, dict[str, Lesson]] = defaultdict(dict)
        for l in self.p.lessons:
            for c in l.classes:
                by_class[c].setdefault(self.rep_id(l), l)
        for c, units in by_class.items():
            for d in range(n_days):
                for p in range(max_p):
                    terms = [self.occ(l, d, p) for l in units.values()]
                    terms = [x for x in terms if not isinstance(x, int)]
                    if len(terms) > 1:
                        self.m.Add(sum(terms) <= 1)

        # 4) 특별실 중복 금지
        by_room: dict[str, list[Lesson]] = defaultdict(list)
        for l in self.p.lessons:
            if l.room:
                by_room[l.room].append(l)
        rm = self.p.room_map()
        for r, ls in by_room.items():
            lit = self.guard(f"특별실 '{rm[r].name if r in rm else r}' 중복 금지")
            for d in range(n_days):
                for p in range(max_p):
                    terms = [self.occ(l, d, p) for l in ls]
                    terms = [x for x in terms if not isinstance(x, int)]
                    if len(terms) > 1:
                        self.add(self.m.Add(sum(terms) <= 1), lit)

        # 5) 교사 배정금지 / 하루 최대
        for t, ls in by_teacher.items():
            teacher = self.tm.get(t)
            if not teacher:
                continue
            if teacher.unavailable:
                lit = self.guard(f"{teacher.name} 교사의 배정금지 시간")
                for d, p in teacher.unavailable:
                    for l in ls:
                        e = self.occ(l, d, p)
                        if not isinstance(e, int):
                            self.add(self.m.Add(e == 0), lit)
            if teacher.max_per_day:
                lit = self.guard(f"{teacher.name} 교사의 하루 최대 {teacher.max_per_day}시간")
                for d in range(n_days):
                    terms = [self.occ(l, d, p) for l in ls for p in range(max_p)]
                    terms = [x for x in terms if not isinstance(x, int)]
                    if terms:
                        self.add(self.m.Add(sum(terms) <= teacher.max_per_day), lit)

        # 6) 고정 슬롯 (수업 fixed + 시간표 locked)
        fixed: dict[str, set[tuple[int, int]]] = defaultdict(set)
        for l in self.p.lessons:
            for d, p in l.fixed:
                fixed[l.id].add((d, p))
        for pl in self.p.timetable:
            if pl.locked and pl.lesson in lm:
                fixed[pl.lesson].add((pl.day, pl.period))
        for lid, slots in fixed.items():
            l = lm[lid]
            lit = self.guard(f"{self.label(l)}의 고정 시간")
            for d, p in slots:
                e = self.occ(l, d, p)
                if isinstance(e, int):
                    if lit is not None:
                        self.m.AddBoolOr([lit.Not()])
                    else:
                        self.m.AddBoolOr([])
                else:
                    self.add(self.m.Add(e == 1), lit)

    # ---- 목적함수 ----
    def build_objective(self):
        w = self.s.weights
        n_days, max_p = self.n_days, self.s.max_periods
        by_teacher: dict[str, list[Lesson]] = defaultdict(list)
        for l in self.p.lessons:
            for t in l.teachers:
                by_teacher[t].append(l)

        for t, ls in by_teacher.items():
            total = sum(l.hours for l in ls)
            busy = {}
            for d in range(n_days):
                for p in range(max_p):
                    terms = [self.occ(l, d, p) for l in ls]
                    terms = [x for x in terms if not isinstance(x, int)]
                    busy[(d, p)] = sum(terms) if terms else None

            if w.teacher_three_in_row:
                for d in range(n_days):
                    for p in range(max_p - 2):
                        window = [busy[(d, p + i)] for i in range(3)]
                        if any(x is None for x in window):
                            continue
                        v = self.m.NewBoolVar("")
                        self.m.Add(sum(window) - 2 <= v)
                        self.penalty_terms["teacher_three_in_row"].append(v)

            la = self.s.lunch_after
            if w.teacher_lunch_straddle and 0 < la < max_p:
                for d in range(n_days):
                    a, b = busy[(d, la - 1)], busy[(d, la)]
                    if a is None or b is None:
                        continue
                    v = self.m.NewBoolVar("")
                    self.m.Add(a + b - 1 <= v)
                    self.penalty_terms["teacher_lunch_straddle"].append(v)

            if w.teacher_day_overload and total:
                target = math.ceil(total / max(1, n_days)) + 1
                for d in range(n_days):
                    day = [busy[(d, p)] for p in range(max_p) if busy[(d, p)] is not None]
                    if len(day) <= target:
                        continue
                    v = self.m.NewIntVar(0, max_p, "")
                    self.m.Add(sum(day) - target <= v)
                    self.penalty_terms["teacher_day_overload"].append(v)

            if w.teacher_first_last:
                for d in range(n_days):
                    for p in (0, max_p - 1):
                        if busy[(d, p)] is not None:
                            self.penalty_terms["teacher_first_last"].append(busy[(d, p)])

        if self.o.keep_previous and self.p.timetable and w.change_from_previous:
            prev: dict[str, set[tuple[int, int]]] = defaultdict(set)
            for pl in self.p.timetable:
                prev[pl.lesson].add((pl.day, pl.period))
            for l in self.p.lessons:
                if self.rep_id(l) != l.id:
                    continue
                for d in range(n_days):
                    for p in range(max_p):
                        if (d, p) in prev.get(l.id, set()):
                            continue
                        e = self.occ(l, d, p)
                        if not isinstance(e, int):
                            self.penalty_terms["change_from_previous"].append(e)

        weights = w.model_dump()
        obj = []
        for key, terms in self.penalty_terms.items():
            if weights.get(key):
                obj.append(weights[key] * sum(terms))
        if obj:
            self.m.Minimize(sum(obj))

    def add_hints(self):
        """기존 시간표를 초기해로 알려주면 재계산이 빨라진다."""
        if not self.p.timetable:
            return
        prev: dict[str, set[tuple[int, int]]] = defaultdict(set)
        for pl in self.p.timetable:
            prev[pl.lesson].add((pl.day, pl.period))
        for (lid, size), starts in self.z.items():
            have = prev.get(lid, set())
            for (d, p), v in starts.items():
                inside = all((d, p + i) in have for i in range(size))
                before = (d, p - 1) in have if size > 1 else False
                self.m.AddHint(v, 1 if inside and not before else 0)

    def extract(self, solver: cp_model.CpSolver) -> list[Placement]:
        lm = self.p.lesson_map()
        locked = {(pl.lesson, pl.day, pl.period) for pl in self.p.timetable if pl.locked}
        out: list[Placement] = []
        for (rid, size), starts in self.z.items():
            members = [i for i in self.rep if self.rep[i] == rid] if rid in self.rep else [rid]
            for (d, p), v in starts.items():
                if solver.Value(v):
                    for lid in members:
                        for i in range(size):
                            out.append(Placement(lesson=lid, day=d, period=p + i,
                                                 locked=(lid, d, p + i) in locked or (d, p + i) in {tuple(x) for x in lm[lid].fixed}))
        out.sort(key=lambda x: (x.day, x.period, x.lesson))
        return out


_STATUS = {
    cp_model.OPTIMAL: "optimal",
    cp_model.FEASIBLE: "feasible",
    cp_model.INFEASIBLE: "infeasible",
    cp_model.MODEL_INVALID: "invalid",
    cp_model.UNKNOWN: "unknown",
}


def solve(project: Project, options: Optional[SolveOptions] = None) -> SolveResult:
    options = options or SolveOptions()
    t0 = time.time()
    errors = [i.message for i in check_data(project) if i.level == "error"]
    if errors:
        return SolveResult(status="invalid", message="기초자료에 오류가 있어 시간표를 만들 수 없습니다. 먼저 고쳐 주세요.",
                           conflicts=errors, seconds=time.time() - t0)
    b = _Builder(project, options, with_assumptions=False)
    try:
        b.build_vars()
        b.build_constraints()
    except ValueError as e:
        return SolveResult(status="invalid", message=str(e), seconds=time.time() - t0)
    b.build_objective()
    b.add_hints()

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = options.time_limit
    solver.parameters.num_search_workers = options.workers
    solver.parameters.random_seed = options.seed
    code = solver.Solve(b.m)
    status = _STATUS.get(code, "unknown")

    if status in ("optimal", "feasible"):
        penalties = {k: int(sum(solver.Value(t) for t in terms)) for k, terms in b.penalty_terms.items()}
        msg = "최적 시간표를 찾았습니다." if status == "optimal" else "조건을 모두 만족하는 시간표를 찾았습니다. (시간을 늘리면 품질이 더 좋아질 수 있습니다)"
        return SolveResult(status=status, message=msg, timetable=b.extract(solver),
                           objective=solver.ObjectiveValue() if b.penalty_terms else 0,
                           penalties=penalties, seconds=time.time() - t0)

    if status == "infeasible":
        conflicts = diagnose(project, min(options.time_limit, 20.0))
        msg = "모든 조건을 동시에 만족하는 시간표가 없습니다."
        if conflicts:
            msg += " 아래 조건들이 서로 충돌합니다. 하나를 완화해 보세요."
        return SolveResult(status=status, message=msg, conflicts=conflicts, seconds=time.time() - t0)

    return SolveResult(status=status, message="제한 시간 안에 시간표를 찾지 못했습니다. 계산 시간을 늘리거나 조건을 줄여 보세요.",
                       seconds=time.time() - t0)


def diagnose(project: Project, time_limit: float = 20.0) -> list[str]:
    """해가 없을 때 서로 충돌하는 조건 묶음을 찾는다."""
    b = _Builder(project, SolveOptions(time_limit=time_limit), with_assumptions=True)
    try:
        b.build_vars()
        b.build_constraints()
    except ValueError as e:
        return [str(e)]
    if not b.lits:
        return ["교사/학급 중복 금지와 요일별 교시 수만으로도 배정이 불가능합니다. 학급 시수 합계와 교사 시수를 확인하세요."]
    b.m.AddAssumptions(b.lits)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = 1
    code = solver.Solve(b.m)
    if code != cp_model.INFEASIBLE:
        if code in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return []
        return ["충돌 원인을 제한 시간 안에 찾지 못했습니다."]
    core = solver.SufficientAssumptionsForInfeasibility()
    reasons = [b.assumptions[i] for i in core if i in b.assumptions]
    if not reasons:
        return ["교사/학급 중복 금지와 요일별 교시 수만으로도 배정이 불가능합니다. 학급 시수 합계와 교사 시수를 확인하세요."]
    return reasons
