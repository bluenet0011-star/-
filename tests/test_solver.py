from app.checker import check_data, check_timetable
from app.model import Lesson, Placement, Project, Room, SchoolClass, Settings, Subject, Teacher
from app.solver import SolveOptions, solve


def small_project() -> Project:
    """2개 학급, 교사 4명, 4+4+3 = 11교시 (수업 9시간, 여유 2칸)."""
    p = Project(settings=Settings(days=["월", "화", "수"], periods={"1": [4, 4, 3]}, lunch_after=2))
    p.classes = [SchoolClass(id="a", grade=1, name="1"), SchoolClass(id="b", grade=1, name="2")]
    p.subjects = [Subject(id=s, name=s) for s in ("국어", "수학", "과학", "체육")]
    p.teachers = [Teacher(id=t, name=t) for t in ("T1", "T2", "T3", "T4")]
    for c in ("a", "b"):
        p.lessons += [
            Lesson(id=f"kor_{c}", subject="국어", teachers=["T1"], classes=[c], hours=3),
            Lesson(id=f"mat_{c}", subject="수학", teachers=["T2"], classes=[c], hours=3),
            Lesson(id=f"sci_{c}", subject="과학", teachers=["T3"], classes=[c], hours=2, blocks=[2]),
        ]
    # 합반 체육 1시간
    p.lessons.append(Lesson(id="pe", subject="체육", teachers=["T4"], classes=["a", "b"], hours=1))
    return p


def errors(issues):
    return [i for i in issues if i.level == "error"]


def test_small_solves_without_conflicts():
    p = small_project()
    assert not errors(check_data(p))
    r = solve(p, SolveOptions(time_limit=10, workers=4))
    assert r.status in ("optimal", "feasible"), r.message
    p.timetable = r.timetable
    assert not errors(check_timetable(p))
    # 연속수업이 실제로 붙어 있는지
    sci = sorted((pl.day, pl.period) for pl in r.timetable if pl.lesson == "sci_a")
    assert sci[0][0] == sci[1][0] and sci[1][1] == sci[0][1] + 1


def test_teacher_unavailable_respected():
    p = small_project()
    banned = {(0, 0), (0, 1), (1, 0)}  # T1 월 1·2교시, 화 1교시 불가
    p.teachers[0].unavailable = sorted(banned)
    r = solve(p, SolveOptions(time_limit=10, workers=4))
    assert r.status in ("optimal", "feasible"), r.conflicts
    kor = [(pl.day, pl.period) for pl in r.timetable if pl.lesson.startswith("kor")]
    assert not banned & set(kor)


def test_sync_group_split_class():
    """두 학급을 두 수준으로 나눈 동시수업: 같은 시간에 배정되고 학급 중복으로 보지 않는다."""
    p = small_project()
    p.lessons = [l for l in p.lessons if not l.id.startswith("mat")]
    for l in p.lessons:
        l.blocks = []  # 연속수업까지 겹치면 이 작은 예제는 풀 수 없다
    p.teachers.append(Teacher(id="T5", name="T5"))
    p.lessons += [
        Lesson(id="mat_hi", subject="수학", teachers=["T2"], classes=["a", "b"], hours=3, sync="수준별"),
        Lesson(id="mat_lo", subject="수학", teachers=["T5"], classes=["a", "b"], hours=3, sync="수준별"),
    ]
    assert not errors(check_data(p))
    r = solve(p, SolveOptions(time_limit=10, workers=4))
    assert r.status in ("optimal", "feasible"), r.message
    hi = {(pl.day, pl.period) for pl in r.timetable if pl.lesson == "mat_hi"}
    lo = {(pl.day, pl.period) for pl in r.timetable if pl.lesson == "mat_lo"}
    assert hi == lo and len(hi) == 3
    p.timetable = r.timetable
    assert not errors(check_timetable(p))


def test_room_shared():
    p = small_project()
    p.rooms = [Room(id="lab", name="과학실")]
    for l in p.lessons:
        if l.id.startswith("sci"):
            l.room = "lab"
    r = solve(p, SolveOptions(time_limit=10, workers=4))
    assert r.status in ("optimal", "feasible")
    slots = [(pl.day, pl.period) for pl in r.timetable if pl.lesson.startswith("sci")]
    assert len(slots) == len(set(slots))


def test_locked_placement_kept():
    p = small_project()
    p.timetable = [Placement(lesson="pe", day=1, period=2, locked=True)]
    r = solve(p, SolveOptions(time_limit=10, workers=4))
    assert r.status in ("optimal", "feasible")
    pe = [(pl.day, pl.period) for pl in r.timetable if pl.lesson == "pe"]
    assert pe == [(1, 2)]


def test_infeasible_reports_conflict():
    p = small_project()
    # 체육 교사가 모든 시간 불가 → 합반 체육을 넣을 수 없음
    p.teachers[3].unavailable = [(d, q) for d in range(3) for q in range(4)]
    r = solve(p, SolveOptions(time_limit=10, workers=4))
    assert r.status in ("infeasible", "invalid")
    assert any("T4" in c for c in r.conflicts), r.conflicts


def test_fixed_conflict_diagnosed():
    p = small_project()
    # 같은 교사의 두 수업을 같은 칸에 고정 → 해 없음, 원인은 고정 시간
    p.lessons[0].fixed = [(0, 0)]  # kor_a
    p.lessons[3].fixed = [(0, 0)]  # kor_b
    r = solve(p, SolveOptions(time_limit=10, workers=4))
    assert r.status == "infeasible"
    assert any("고정" in c for c in r.conflicts), r.conflicts


def test_data_check_hours_mismatch():
    p = small_project()
    p.lessons = [l for l in p.lessons if l.id != "kor_a"]
    codes = {i.code for i in check_data(p)}
    assert "class_hours" in codes


def test_keep_previous_changes_little():
    p = small_project()
    r1 = solve(p, SolveOptions(time_limit=10, workers=4))
    p.timetable = r1.timetable
    r2 = solve(p, SolveOptions(time_limit=10, workers=4, keep_previous=True))
    assert {(x.lesson, x.day, x.period) for x in r1.timetable} == {(x.lesson, x.day, x.period) for x in r2.timetable}
