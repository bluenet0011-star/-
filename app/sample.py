"""체험·테스트용 예제 학교 (중학교 3개 학년 × 6학급)."""

from __future__ import annotations

from .model import Lesson, Project, Room, SchoolClass, Settings, Subject, Teacher

_SURNAMES = "김이박최정강조윤장임한오서신권황안송류홍"
_GIVEN = ["민준", "서연", "도윤", "지우", "하준", "서윤", "시우", "하은", "주원", "지민",
          "예준", "수아", "지호", "채원", "건우", "다은", "현우", "은서", "우진", "유나",
          "선우", "지아", "연우", "소율", "정우", "윤서", "승현", "민서", "준서", "예린",
          "태윤", "가은", "은우", "하린", "시윤", "나은"]

# 과목, 약칭, 주당 시수, 교사 수, 연속 블록
_PLAN = [
    ("국어", "국어", 4, 4, []),
    ("수학", "수학", 4, 4, []),
    ("영어", "영어", 4, 4, []),
    ("사회", "사회", 3, 3, []),
    ("과학", "과학", 4, 4, []),
    ("체육", "체육", 3, 3, []),
    ("음악", "음악", 2, 2, []),
    ("미술", "미술", 2, 2, [2]),
    ("기술·가정", "기가", 2, 2, []),
    ("도덕", "도덕", 2, 2, []),
    ("정보", "정보", 1, 1, []),
]


def _bell(n: int, start="09:00", minutes=45, rest=10, lunch_after=4, lunch=60) -> list[str]:
    h, m = map(int, start.split(":"))
    t = h * 60 + m
    out = []
    for i in range(n):
        out.append(f"{t // 60:02d}:{t % 60:02d}-{(t + minutes) // 60:02d}:{(t + minutes) % 60:02d}")
        t += minutes + (lunch if i + 1 == lunch_after else rest)
    return out


def sample_project() -> Project:
    per_day = [7, 7, 6, 7, 6]  # 합계 33
    settings = Settings(
        school_name="컴퓨터중학교(예제)",
        periods={"1": per_day, "2": per_day, "3": per_day},
        lunch_after=4,
        bell=_bell(7),
    )
    p = Project(title="2026학년도 1학기 예제 시간표", settings=settings)

    names = iter(f"{_SURNAMES[i % len(_SURNAMES)]}{_GIVEN[i % len(_GIVEN)]}" for i in range(200))

    for g in (1, 2, 3):
        for n in range(1, 7):
            p.classes.append(SchoolClass(id=f"c{g}{n}", grade=g, name=str(n)))
    classes = p.classes

    subj = {}
    for name, short, *_ in _PLAN:
        s = Subject(id=f"s_{short}", name=name, short=short)
        subj[name] = s
        p.subjects.append(s)
    cha = Subject(id="s_창체", name="창의적 체험활동", short="창체")
    p.subjects.append(cha)

    lab = Room(id="r_lab", name="과학실")
    art = Room(id="r_art", name="미술실")
    p.rooms += [lab, art]

    subject_teachers: dict[str, list[Teacher]] = {}
    for name, short, hours, n_teachers, blocks in _PLAN:
        ts = [Teacher(id=f"t_{short}{i + 1}", name=next(names)) for i in range(n_teachers)]
        subject_teachers[name] = ts
        p.teachers += ts
        chunk = len(classes) / n_teachers
        for idx, c in enumerate(classes):
            t = ts[min(n_teachers - 1, int(idx / chunk))]
            room = None
            lesson_blocks = list(blocks)
            if name == "과학" and c.grade == 3:
                room, lesson_blocks = lab.id, [2]
            if name == "미술" and c.grade == 3:
                room = art.id
            p.lessons.append(Lesson(id=f"l_{short}_{c.id}", subject=subj[name].id, teachers=[t.id],
                                    classes=[c.id], hours=hours, blocks=lesson_blocks, room=room))

    # 담임 배정 + 창체(학년별 동시 배정)
    homeroom_pool = [t for name in ("국어", "수학", "영어", "사회", "과학", "체육", "도덕", "기술·가정", "음악", "미술")
                     for t in subject_teachers[name]]
    for c, t in zip(classes, homeroom_pool):
        c.homeroom = t.id
        p.lessons.append(Lesson(id=f"l_창체_{c.id}", subject=cha.id, teachers=[t.id], classes=[c.id],
                                hours=2, sync=f"{c.grade}학년 창체"))

    # 2학년 1·2반 영어 수준별 이동수업: 2개 반을 3개 수준으로 나눠 3명이 동시에 수업
    p.lessons = [l for l in p.lessons if l.id not in ("l_영어_c21", "l_영어_c22")]
    levels = [("상", subject_teachers["영어"][1]), ("중", subject_teachers["영어"][2]), ("하", subject_teachers["영어"][3])]
    for tag, t in levels:
        p.lessons.append(Lesson(id=f"l_영어수준_{tag}", subject=subj["영어"].id, teachers=[t.id],
                                classes=["c21", "c22"], hours=4, sync="2학년 1·2반 영어 수준별"))

    # 시간강사: 월·화·수만 출근
    part_timer = subject_teachers["정보"][0]
    part_timer.memo = "시간강사 (월·화·수 출근)"
    part_timer.unavailable = [(d, q) for d in (3, 4) for q in range(7)]
    return p
