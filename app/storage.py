"""프로젝트 저장소 (JSON 파일). 저장할 때마다 이전 버전을 백업해 되돌릴 수 있게 한다."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path

from .model import Project

MAX_BACKUPS = 30


class Storage:
    def __init__(self, root: str | os.PathLike | None = None):
        self.root = Path(root or os.environ.get("TIMETABLE_DATA", "data"))
        (self.root / "projects").mkdir(parents=True, exist_ok=True)
        (self.root / "backups").mkdir(parents=True, exist_ok=True)

    def _path(self, pid: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_\-]+", pid):
            raise KeyError(pid)
        return self.root / "projects" / f"{pid}.json"

    def list(self) -> list[dict]:
        out = []
        for f in sorted((self.root / "projects").glob("*.json")):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
                out.append({"id": d["id"], "title": d.get("title", ""), "updated_at": d.get("updated_at"),
                            "classes": len(d.get("classes", [])), "teachers": len(d.get("teachers", []))})
            except (OSError, ValueError, KeyError):
                continue
        out.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
        return out

    def load(self, pid: str) -> Project:
        path = self._path(pid)
        if not path.exists():
            raise KeyError(pid)
        return Project.model_validate_json(path.read_text(encoding="utf-8"))

    def save(self, project: Project) -> Project:
        path = self._path(project.id)
        if path.exists():
            self._backup(project.id, path.read_text(encoding="utf-8"))
        project.updated_at = datetime.now().isoformat(timespec="seconds")
        tmp = path.with_suffix(".tmp")
        tmp.write_text(project.model_dump_json(indent=1), encoding="utf-8")
        tmp.replace(path)
        return project

    def delete(self, pid: str) -> None:
        path = self._path(pid)
        if path.exists():
            self._backup(pid, path.read_text(encoding="utf-8"))
            path.unlink()

    def _backup(self, pid: str, text: str) -> None:
        folder = self.root / "backups" / pid
        folder.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        (folder / f"{stamp}.json").write_text(text, encoding="utf-8")
        files = sorted(folder.glob("*.json"))
        for old in files[:-MAX_BACKUPS]:
            old.unlink()

    def backups(self, pid: str) -> list[dict]:
        folder = self.root / "backups" / self._path(pid).stem
        if not folder.exists():
            return []
        out = []
        for f in sorted(folder.glob("*.json"), reverse=True):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
                out.append({"name": f.stem, "updated_at": d.get("updated_at"), "placements": len(d.get("timetable", []))})
            except (OSError, ValueError):
                continue
        return out

    def load_backup(self, pid: str, name: str) -> Project:
        if not re.fullmatch(r"[0-9\-]+", name):
            raise KeyError(name)
        f = self.root / "backups" / self._path(pid).stem / f"{name}.json"
        if not f.exists():
            raise KeyError(name)
        return Project.model_validate_json(f.read_text(encoding="utf-8"))
