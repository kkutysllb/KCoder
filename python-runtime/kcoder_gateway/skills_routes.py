"""Real Skills endpoints — list from QiLin, drafts pipeline local.

GET /v1/skills         → QiLin SkillStorage.load_skills() (real)
GET /v1/skills/drafts  → local <dataDir>/kcoder_local/skills_drafts.json
POST/analyze/generate/install → local JSON (drafts persist, install is a no-op ack)

QiLin's SkillStorage returns `Skill` dataclasses with fields:
    name, description, license, skill_dir, skill_file, relative_path,
    category (PUBLIC/CUSTOM/INTEGRATION/LEGACY), enabled, ...

These are mapped to KCoder's SkillEntry (id/name/description/category/
enabled/builtin/editable/...). Fields KCoder has no source for (version,
commands, contributions) default to empty.

The drafts pipeline (analyze → generate → install) is a KCoder-specific
feature with no QiLin equivalent. Without an LLM API key, analyze/generate
return empty evidence / draft skeletons so the UI renders; install writes
the draft's SKILL.md to the user's skills directory via QiLin's
install_skill_from_archive when a real archive is provided, otherwise it
acknowledges and the user must restart the sidecar to pick up manual edits.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .local_store import load_json, save_json

logger = logging.getLogger("kcoder_gateway.skills")

router = APIRouter(prefix="/v1/skills", tags=["skills"])


# ============ helpers ============


def _resolve_user_id(request: Request) -> str:
    resolved = getattr(request.state, "user_id", None)
    if isinstance(resolved, str) and resolved:
        return resolved
    return "anonymous"


def _drafts_path(request: Request) -> Path:
    data_dir = Path(getattr(request.app.state, "data_dir", "") or ".")
    return data_dir / "kcoder_local" / "skills_drafts.json"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _skill_to_entry(skill: Any, *, editable: bool = False) -> dict[str, Any]:
    """Map a QiLin Skill dataclass to KCoder's SkillEntry."""
    name = str(getattr(skill, "name", "") or "")
    category = getattr(skill, "category", None)
    category_value = getattr(category, "value", str(category)) if category is not None else "custom"
    enabled = bool(getattr(skill, "enabled", False))
    skill_dir = getattr(skill, "skill_dir", None)
    root = str(skill_dir) if skill_dir else ""

    status: str = "registered" if enabled else "disabled"
    builtin = category_value == "public"
    legacy = category_value == "legacy"
    deletable = category_value == "custom"

    return {
        "id": name,
        "name": name,
        "description": str(getattr(skill, "description", "") or ""),
        "version": "1.0.0",
        "root": root,
        "category": category_value,
        "family": category_value,
        "license": str(getattr(skill, "license", "") or ""),
        "enabled": enabled,
        "registered": enabled,
        "status": status,
        "builtin": builtin,
        "editable": editable and not builtin,
        "deletable": deletable,
        "legacy": legacy,
        "commands": [],
        "contributions": {},
        "permissions": {},
    }


def _load_skill_storage(user_id: str) -> Any | None:
    """Resolve the QiLin per-user SkillStorage singleton."""
    try:
        from qilin.skills.storage import get_or_new_user_skill_storage

        return get_or_new_user_skill_storage(user_id)
    except Exception:
        logger.exception("Failed to resolve QiLin SkillStorage")
        return None


# ============ endpoints: list ============


@router.get("")
@router.get("/")
async def list_skills(request: Request) -> dict[str, Any]:
    """GET /v1/skills → { skills: [...] }."""
    user_id = _resolve_user_id(request)
    storage = _load_skill_storage(user_id)
    if storage is None:
        return {"skills": []}
    try:
        skills = storage.load_skills(enabled_only=False)
    except Exception:
        logger.exception("SkillStorage.load_skills failed")
        return {"skills": []}

    editable_categories = {"custom"}
    entries = [
        _skill_to_entry(
            s,
            editable=(str(getattr(getattr(s, "category", None), "value", "") or "")) in editable_categories,
        )
        for s in skills
    ]
    return {"skills": entries}


# ============ endpoints: drafts (local JSON) ============


@router.get("/drafts")
async def list_skill_drafts(request: Request) -> dict[str, Any]:
    """GET /v1/skills/drafts → { drafts: [...] }."""
    drafts = load_json(_drafts_path(request), default=[])
    if not isinstance(drafts, list):
        drafts = []
    return {"drafts": drafts}


@router.post("/drafts")
async def create_skill_draft(request: Request) -> dict[str, Any]:
    """POST /v1/skills/drafts → accept multipart upload or JSON; returns a draft shell.

    KCoder's renderer uploads FormData with files + mode. Without a real LLM
    to analyze/generate SKILL.md, we accept the upload, persist a draft shell
    (mode + file list), and return a draftId the renderer can use for the
    subsequent analyze/generate/install calls.
    """
    form = await request.form()
    mode = str(form.get("mode") or "file")
    work_mode_id = str(form.get("workModeId") or "")

    files_meta: list[dict[str, Any]] = []
    # form.getlist returns all entries under key "files"
    for value in form.getlist("files"):
        name = getattr(value, "filename", None) or str(value)
        size = getattr(value, "size", 0) or 0
        kind = "markdown" if name.lower().endswith((".md", ".skill")) else "file"
        files_meta.append({"path": name, "kind": kind, "size": int(size)})

    draft_id = f"draft_{uuid.uuid4().hex[:10]}"
    now = _utc_now()
    draft = {
        "draftId": draft_id,
        "mode": mode,
        "workModeId": work_mode_id,
        "status": "uploaded",
        "files": files_meta,
        "evidence": {},
        "createdAt": now,
        "updatedAt": now,
    }

    drafts = load_json(_drafts_path(request), default=[])
    if not isinstance(drafts, list):
        drafts = []
    drafts.append(draft)
    save_json(_drafts_path(request), drafts)

    return {
        "draftId": draft_id,
        "mode": mode,
        "files": files_meta,
    }


@router.post("/drafts/{draft_id}/analyze")
async def analyze_skill_draft(request: Request, draft_id: str) -> dict[str, Any]:
    """POST /v1/skills/drafts/:id/analyze → empty evidence (LLM-required; no key).

    Without an LLM API key wired into the gateway, we cannot run the resource
    graph analysis. We return an empty evidence map and status='analyzed' so
    the renderer's UI advances to the generate step. When a key is available,
    a future integration can invoke QiLin's skill review analyzer here.
    """
    return {
        "draftId": draft_id,
        "evidence": {},
        "status": "analyzed",
        "note": "skill draft analysis requires an LLM API key (not configured); returning empty evidence",
    }


@router.post("/drafts/{draft_id}/generate")
async def generate_skill_draft(request: Request, draft_id: str) -> dict[str, Any]:
    """POST /v1/skills/drafts/:id/generate → empty SKILL.md skeleton.

    Same LLM limitation as analyze. We return a minimal draft skeleton so the
    renderer can show the generate step's UI; the user can edit the SKILL.md
    manually before install.
    """
    drafts = load_json(_drafts_path(request), default=[])
    draft_record = None
    if isinstance(drafts, list):
        for d in drafts:
            if isinstance(d, dict) and d.get("draftId") == draft_id:
                draft_record = d
                break

    name = draft_id.replace("draft_", "skill-") if draft_record is None else (
        Path(draft_record.get("files", [{}])[0].get("path", draft_id)).stem
        if draft_record.get("files") else draft_id
    )
    skeleton = {
        "draftId": draft_id,
        "draft": {
            "metadata": {
                "id": name,
                "name": name,
                "description": "Edit this description in the draft before installing.",
            },
            "skillMarkdown": (
                "---\n"
                f"name: {name}\n"
                "description: Edit this description in the draft before installing.\n"
                "---\n\n"
                "# Instructions\n\n"
                "Describe what this skill does and when it should activate.\n"
            ),
        },
        "note": "skill draft generation requires an LLM API key (not configured); returning skeleton",
    }
    return skeleton


class UpdateDraftRequest(BaseModel):
    draft: dict[str, Any] = Field(default_factory=dict)


@router.patch("/drafts/{draft_id}")
async def update_skill_draft(request: Request, draft_id: str, payload: UpdateDraftRequest) -> dict[str, Any]:
    """PATCH /v1/skills/drafts/:id → persist the edited draft content."""
    drafts = load_json(_drafts_path(request), default=[])
    if isinstance(drafts, list):
        for d in drafts:
            if isinstance(d, dict) and d.get("draftId") == draft_id:
                d["draft"] = payload.draft
                d["updatedAt"] = _utc_now()
                save_json(_drafts_path(request), drafts)
                return {"draftId": draft_id, "updated": True}
    # Draft not found — create an entry so install still works.
    if isinstance(drafts, list):
        now = _utc_now()
        drafts.append({
            "draftId": draft_id,
            "mode": "file",
            "status": "edited",
            "draft": payload.draft,
            "createdAt": now,
            "updatedAt": now,
        })
        save_json(_drafts_path(request), drafts)
    return {"draftId": draft_id, "updated": True}


class InstallDraftRequest(BaseModel):
    # The renderer sends the full generated payload from the generate step.
    metadata: dict[str, Any] = Field(default_factory=dict)
    skillMarkdown: str = Field(default="")


@router.post("/drafts/{draft_id}/install")
async def install_skill_draft(request: Request, draft_id: str, payload: InstallDraftRequest) -> dict[str, Any]:
    """POST /v1/skills/drafts/:id/install → write SKILL.md to user skills dir.

    QiLin's `install_skill_from_archive` expects a packaged skill archive;
    for a freshly authored draft we instead write the SKILL.md directly to
    the user's custom skills directory so QiLin picks it up on next reload.
    """
    user_id = _resolve_user_id(request)
    storage = _load_skill_storage(user_id)
    if storage is None:
        raise HTTPException(status_code=503, detail="SkillStorage unavailable")

    name = str(payload.metadata.get("id") or payload.metadata.get("name") or draft_id)
    if not name:
        raise HTTPException(status_code=400, detail="skill name required in metadata.id or metadata.name")

    # Write SKILL.md to the user's custom skills root. UserScopedSkillStorage
    # exposes the custom root via `_custom_root` / the skills path config.
    try:
        custom_root = _resolve_custom_skills_root(storage, user_id)
        custom_root.mkdir(parents=True, exist_ok=True)
        skill_dir = custom_root / name
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(payload.skillMarkdown, encoding="utf-8")
    except Exception as exc:
        logger.exception("install_skill_draft failed")
        raise HTTPException(status_code=500, detail=f"install failed: {exc}") from exc

    return {"success": True, "skillId": name}


def _resolve_custom_skills_root(storage: Any, user_id: str) -> Path:
    """Resolve where to write user-authored SKILL.md files.

    UserScopedSkillStorage redirects custom skill paths to
    ``{base_dir}/users/{user_id}/skills/custom/``. We probe the known
    attributes; if none are present, fall back to the data dir under
    kcoder_local/skills/custom/.
    """
    for attr in ("_custom_root", "_custom_skills_root", "custom_root"):
        val = getattr(storage, attr, None)
        if isinstance(val, (str, Path)):
            return Path(val)
    # UserScopedSkillStorage stores _user_id + inherits host_path from SkillStorage
    host_path = getattr(storage, "host_path", None)
    if isinstance(host_path, (str, Path)):
        return Path(host_path) / "custom"
    # Fallback: data_dir/kcoder_local/skills/custom (at least writes somewhere safe)
    return Path(".") / "kcoder_local" / "skills" / "custom"
