"""시간표 프로젝트 데이터 모델.

컴시간은 연속수업/동시수업/특별실/일괄배정/복수교사를 각각 다른 등록부로 관리했지만,
여기서는 모두 하나의 '수업(Lesson)'으로 표현한다.

- 일반 수업: 학급 1개 + 교사 1명
- 합반: 학급 여러 개 + 교사 1명
- 복수교사(코티칭): 학급 1개 + 교사 여러 명
- 동시수업/선택과목 블록/일괄배정: 서로 다른 수업들을 같은 sync 그룹으로 묶음
- 연속수업: blocks (예: [2] 이면 2시간 연속 1회 + 나머지는 1시간씩)
- 특별실: room
- 고정(이동금지): fixed 슬롯 또는 시간표의 locked 배치

슬롯은 [요일 인덱스, 교시 인덱스] (둘 다 0부터) 로 표현한다.
"""

from __future__ import annotations

import math
import uuid
from typing import Optional

from pydantic import BaseModel, Field

Slot = tuple[int, int]


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


class Weights(BaseModel):
    """자동 생성 시 품질 기준(소프트 조건) 가중치. 0이면 고려하지 않는다."""

    teacher_three_in_row: int = Field(10, description="교사 3시간 연속 수업")
    teacher_lunch_straddle: int = Field(2, description="교사 점심 전후 연속 수업")
    teacher_day_overload: int = Field(6, description="교사 하루 수업 과다")
    teacher_first_last: int = Field(0, description="교사 1교시·마지막 교시 몰림")
    change_from_previous: int = Field(3, description="기존 시간표에서 바뀐 칸 (최소 변경 모드)")


class Settings(BaseModel):
    school_name: str = ""
    year: int = 2026
    semester: int = 1
    days: list[str] = Field(default_factory=lambda: ["월", "화", "수", "목", "금"])
    # 학년별 요일별 교시 수. key 는 학년 문자열 ("1", "2", "3")
    periods: dict[str, list[int]] = Field(default_factory=dict)
    lunch_after: int = Field(4, description="몇 교시 후 점심인지")
    bell: list[str] = Field(default_factory=list, description="교시별 시간 (예: 09:00-09:45)")
    block_cross_lunch: bool = Field(False, description="연속수업이 점심시간을 넘어가도 되는지")
    weights: Weights = Field(default_factory=Weights)

    def periods_for(self, grade: int, day: int) -> int:
        row = self.periods.get(str(grade))
        if not row or day >= len(row):
            return 0
        return row[day]

    @property
    def max_periods(self) -> int:
        values = [p for row in self.periods.values() for p in row]
        return max(values) if values else 0


class Teacher(BaseModel):
    id: str = Field(default_factory=lambda: new_id("t"))
    name: str
    unavailable: list[Slot] = Field(default_factory=list, description="수업 불가 슬롯 (배정금지)")
    max_per_day: Optional[int] = Field(None, description="하루 최대 수업 수 (없으면 제한 없음)")
    memo: str = ""


class SchoolClass(BaseModel):
    id: str = Field(default_factory=lambda: new_id("c"))
    grade: int
    name: str  # 예: "1" -> 화면에는 "1-1" 로 표시
    homeroom: Optional[str] = None  # teacher id

    @property
    def label(self) -> str:
        return f"{self.grade}-{self.name}"


class Subject(BaseModel):
    id: str = Field(default_factory=lambda: new_id("s"))
    name: str  # 정식 과목명 (NEIS)
    short: str = ""  # 시간표 표시용 약칭

    @property
    def display(self) -> str:
        return self.short or self.name


class Room(BaseModel):
    id: str = Field(default_factory=lambda: new_id("r"))
    name: str


class Lesson(BaseModel):
    id: str = Field(default_factory=lambda: new_id("l"))
    subject: str  # subject id
    teachers: list[str] = Field(default_factory=list)
    classes: list[str] = Field(default_factory=list)
    hours: int = 1
    blocks: list[int] = Field(default_factory=list, description="연속 블록 크기 목록 (2 이상만), 나머지는 1시간")
    room: Optional[str] = None
    sync: Optional[str] = Field(None, description="같은 값을 가진 수업들은 같은 시간에 배정 (동시수업)")
    fixed: list[Slot] = Field(default_factory=list, description="반드시 이 슬롯에 배정")
    max_per_day: Optional[int] = Field(None, description="하루 최대 배정 횟수(블록 기준). 없으면 자동")

    def block_counts(self) -> dict[int, int]:
        """블록 크기 -> 개수. 1시간 단위도 포함."""
        counts: dict[int, int] = {}
        used = 0
        for b in self.blocks:
            if b >= 2:
                counts[b] = counts.get(b, 0) + 1
                used += b
        singles = self.hours - used
        if singles > 0:
            counts[1] = counts.get(1, 0) + singles
        return counts

    def n_blocks(self) -> int:
        return sum(self.block_counts().values())

    def daily_limit(self, n_days: int) -> int:
        if self.max_per_day:
            return self.max_per_day
        return max(1, math.ceil(self.n_blocks() / max(1, n_days)))


class Placement(BaseModel):
    lesson: str
    day: int
    period: int
    locked: bool = False


class Project(BaseModel):
    id: str = Field(default_factory=lambda: new_id("p"))
    title: str = "새 시간표"
    settings: Settings = Field(default_factory=Settings)
    teachers: list[Teacher] = Field(default_factory=list)
    classes: list[SchoolClass] = Field(default_factory=list)
    subjects: list[Subject] = Field(default_factory=list)
    rooms: list[Room] = Field(default_factory=list)
    lessons: list[Lesson] = Field(default_factory=list)
    timetable: list[Placement] = Field(default_factory=list)
    updated_at: Optional[str] = None

    # --- 조회 도우미 ---
    def teacher_map(self) -> dict[str, Teacher]:
        return {t.id: t for t in self.teachers}

    def class_map(self) -> dict[str, SchoolClass]:
        return {c.id: c for c in self.classes}

    def subject_map(self) -> dict[str, Subject]:
        return {s.id: s for s in self.subjects}

    def room_map(self) -> dict[str, Room]:
        return {r.id: r for r in self.rooms}

    def lesson_map(self) -> dict[str, Lesson]:
        return {l.id: l for l in self.lessons}

    def class_capacity(self, cls: SchoolClass) -> int:
        return sum(self.settings.periods_for(cls.grade, d) for d in range(len(self.settings.days)))

    def slot_open_for_class(self, cls: SchoolClass, day: int, period: int) -> bool:
        return period < self.settings.periods_for(cls.grade, day)
