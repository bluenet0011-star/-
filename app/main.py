"""웹 서버: REST API + 화면(정적 파일).

실행: uvicorn app.main:app --reload
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .checker import check_data, check_timetable, summarize
from .excel_io import HoursTableError, export_timetable, hours_table_template, import_hours_table
from .model import Project, new_id
from .sample import sample_project
from .solver import SolveOptions, solve
from .storage import Storage

STATIC = Path(__file__).parent / "static"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

app = FastAPI(title="시간표 도우미")
store = Storage()


def _load(pid: str) -> Project:
    try:
        return store.load(pid)
    except KeyError:
        raise HTTPException(404, "시간표 파일을 찾을 수 없습니다.")


def _download_headers(name: str) -> dict:
    from urllib.parse import quote
    return {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"}


class NewProject(BaseModel):
    title: str = "새 시간표"
    sample: bool = False


@app.get("/api/projects")
def list_projects():
    return store.list()


@app.post("/api/projects")
def create_project(body: NewProject):
    p = sample_project() if body.sample else Project(title=body.title)
    p.id = new_id("p")
    if not body.sample:
        p.settings.periods = {"1": [7, 7, 6, 7, 6], "2": [7, 7, 6, 7, 6], "3": [7, 7, 6, 7, 6]}
    return store.save(p)


@app.post("/api/projects/import")
def import_project(project: Project):
    project.id = new_id("p")
    return store.save(project)


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    return _load(pid)


@app.put("/api/projects/{pid}")
def put_project(pid: str, project: Project):
    project.id = pid
    return store.save(project)


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    store.delete(pid)
    return {"ok": True}


@app.get("/api/projects/{pid}/backups")
def list_backups(pid: str):
    return store.backups(pid)


@app.post("/api/projects/{pid}/backups/{name}/restore")
def restore_backup(pid: str, name: str):
    try:
        p = store.load_backup(pid, name)
    except KeyError:
        raise HTTPException(404, "백업을 찾을 수 없습니다.")
    p.id = pid
    return store.save(p)


@app.post("/api/check")
def check(project: Project):
    data = check_data(project)
    tt = check_timetable(project) if project.timetable else []
    return {"data": data, "timetable": tt, "summary": {"data": summarize(data), "timetable": summarize(tt)}}


class SolveRequest(BaseModel):
    options: SolveOptions = SolveOptions()
    save: bool = True


@app.post("/api/projects/{pid}/solve")
def solve_project(pid: str, req: Optional[SolveRequest] = Body(None)):
    req = req or SolveRequest()
    p = _load(pid)
    result = solve(p, req.options)
    if req.save and result.status in ("optimal", "feasible"):
        p.timetable = result.timetable
        store.save(p)
    return result


@app.post("/api/projects/{pid}/import-hours")
async def import_hours(pid: str, request: Request, replace: bool = True):
    p = _load(pid)
    data = await request.body()
    if not data:
        raise HTTPException(400, "파일이 비어 있습니다.")
    try:
        stats = import_hours_table(data, p, replace=replace)
    except HoursTableError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # 손상된 파일 등
        raise HTTPException(400, f"엑셀 파일을 읽을 수 없습니다: {e}")
    store.save(p)
    return {"stats": stats, "project": p}


@app.get("/api/projects/{pid}/export.xlsx")
def export_xlsx(pid: str):
    p = _load(pid)
    return Response(export_timetable(p), media_type=XLSX, headers=_download_headers(f"{p.title}.xlsx"))


@app.get("/api/projects/{pid}/download.json")
def download_json(pid: str):
    p = _load(pid)
    return Response(p.model_dump_json(indent=1), media_type="application/json",
                    headers=_download_headers(f"{p.title}.json"))


@app.get("/api/template.xlsx")
def template():
    return Response(hours_table_template(), media_type=XLSX, headers=_download_headers("교사별시수표_양식.xlsx"))


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
