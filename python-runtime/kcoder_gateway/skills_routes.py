"""Skills endpoints — list / toggle / delete / install.

GET    /v1/skills                    → QiLin SkillStorage.load_skills()
PUT    /v1/skills/{name}/enabled     → toggle PUBLIC (extensions_config) or
                                        CUSTOM/LEGACY (per-user state)
DELETE /v1/skills/{name}             → delete custom skill from disk
POST   /v1/skills/install-from-file  → install .skill ZIP archive
POST   /v1/skills/install-from-npm   → install from npm pkg / GitHub URL /
                                        local directory

QiLin's SkillStorage returns `Skill` dataclasses with fields:
    name, description, license, skill_dir, skill_file, relative_path,
    category (PUBLIC/CUSTOM/INTEGRATION/LEGACY), enabled, ...

These are mapped to KCoder's SkillEntry (id/name/description/category/
enabled/builtin/editable/...). Fields KCoder has no source for (version,
commands, contributions) default to empty.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger("kcoder_gateway.skills")

router = APIRouter(prefix="/v1/skills", tags=["skills"])


# ============ helpers ============


def _resolve_user_id(request: Request) -> str:
    resolved = getattr(request.state, "user_id", None)
    if isinstance(resolved, str) and resolved:
        return resolved
    return "anonymous"


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


# ============ helpers: extensions_config / custom root ============


def _resolve_config_path() -> Path | None:
    """解析 extensions_config.json 路径（同 mcp_routes 逻辑）."""
    env_path = os.environ.get("QILIN_EXTENSIONS_CONFIG_PATH")
    if env_path:
        p = Path(env_path)
        if p.exists():
            return p
    runtime_dir = Path(__file__).resolve().parent.parent
    fallback = runtime_dir / "extensions_config.json"
    if fallback.exists():
        return fallback
    return None


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    """原子写 JSON：temp file + os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fp:
            json.dump(data, fp, indent=2, ensure_ascii=False)
            fp.write("\n")
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


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
    host_path = getattr(storage, "host_path", None)
    if isinstance(host_path, (str, Path)):
        return Path(host_path) / "custom"
    return Path(".") / "kcoder_local" / "skills" / "custom"


def _write_public_skill_state(skill_name: str, enabled: bool) -> None:
    """Read-modify-write a PUBLIC skill's enabled state in extensions_config.json.

    Blocking filesystem IO — callers should dispatch via ``asyncio.to_thread``.
    """
    config_path = _resolve_config_path()
    if config_path is None:
        raise HTTPException(status_code=503, detail="extensions_config.json path unresolved")
    try:
        from qilin.config.extensions_config import (
            SkillStateConfig,
            get_extensions_config,
            reload_extensions_config,
        )

        extensions_config = get_extensions_config().model_copy(deep=True)
        extensions_config.skills[skill_name] = SkillStateConfig(enabled=enabled)
        config_data = extensions_config.to_file_dict()
        _atomic_write_json(config_path, config_data)
        reload_extensions_config()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to write PUBLIC skill state")
        raise HTTPException(status_code=500, detail=f"Failed to update skill state: {exc}") from exc


# ============ endpoints: toggle enabled ============


class ToggleSkillRequest(BaseModel):
    enabled: bool


@router.put("/{skill_name}/enabled")
async def toggle_skill_enabled(request: Request, skill_name: str, payload: ToggleSkillRequest) -> dict[str, Any]:
    """PUT /v1/skills/{name}/enabled → toggle skill enabled state.

    PUBLIC skills → global extensions_config.json (shared state).
    CUSTOM/LEGACY skills → per-user _skill_states.json (isolated state).
    """
    user_id = _resolve_user_id(request)
    storage = _load_skill_storage(user_id)
    if storage is None:
        raise HTTPException(status_code=503, detail="SkillStorage unavailable")

    try:
        skills = storage.load_skills(enabled_only=False)
    except Exception:
        logger.exception("SkillStorage.load_skills failed")
        raise HTTPException(status_code=500, detail="Failed to load skills")

    skill = next((s for s in skills if s.name == skill_name), None)
    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")

    category_value = getattr(getattr(skill, "category", None), "value", "")

    if category_value == "public":
        await asyncio.to_thread(_write_public_skill_state, skill_name, payload.enabled)
    else:
        # CUSTOM / LEGACY → per-user state
        set_state = getattr(storage, "set_skill_enabled_state", None)
        if set_state is not None:
            await asyncio.to_thread(set_state, skill_name, payload.enabled)
        else:
            # Fallback: write to extensions_config.json
            await asyncio.to_thread(_write_public_skill_state, skill_name, payload.enabled)

    # Reload + return updated entry
    try:
        skills = storage.load_skills(enabled_only=False)
    except Exception:
        logger.exception("SkillStorage.load_skills reload failed")
        raise HTTPException(status_code=500, detail="Failed to reload skills")

    updated = next((s for s in skills if s.name == skill_name), None)
    if updated is None:
        raise HTTPException(status_code=500, detail=f"Failed to reload skill '{skill_name}'")

    editable = category_value == "custom"
    return _skill_to_entry(updated, editable=editable)


# ============ endpoints: delete ============


@router.delete("/{skill_name}")
async def delete_skill(request: Request, skill_name: str) -> dict[str, Any]:
    """DELETE /v1/skills/{name} → delete a custom skill from disk.

    Only CUSTOM-category skills can be deleted.
    """
    user_id = _resolve_user_id(request)
    storage = _load_skill_storage(user_id)
    if storage is None:
        raise HTTPException(status_code=503, detail="SkillStorage unavailable")

    try:
        skills = storage.load_skills(enabled_only=False)
    except Exception:
        logger.exception("SkillStorage.load_skills failed")
        raise HTTPException(status_code=500, detail="Failed to load skills")

    skill = next((s for s in skills if s.name == skill_name), None)
    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")

    category_value = getattr(getattr(skill, "category", None), "value", "")
    if category_value != "custom":
        raise HTTPException(status_code=403, detail=f"Only custom skills can be deleted; '{skill_name}' is {category_value}")

    try:
        await asyncio.to_thread(storage.delete_custom_skill, skill_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("delete_custom_skill failed")
        raise HTTPException(status_code=500, detail=f"Failed to delete skill: {exc}") from exc

    return {"success": True, "skillId": skill_name}


# ============ endpoints: install from file ============


class InstallFileRequest(BaseModel):
    path: str


@router.post("/install-from-file")
async def install_from_file(request: Request, payload: InstallFileRequest) -> dict[str, Any]:
    """POST /v1/skills/install-from-file → install .skill ZIP archive.

    Delegates to QiLin's ``ainstall_skill_from_archive`` which runs the full
    security scan pipeline (safe_extract + _scan_skill_archive_contents_or_raise).
    """
    user_id = _resolve_user_id(request)
    storage = _load_skill_storage(user_id)
    if storage is None:
        raise HTTPException(status_code=503, detail="SkillStorage unavailable")

    archive_path = Path(payload.path)
    if not archive_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {payload.path}")
    if archive_path.suffix != ".skill":
        raise HTTPException(status_code=400, detail="File must have .skill extension")

    try:
        result = await storage.ainstall_skill_from_archive(str(archive_path))
        return {"success": True, "skill_name": result.get("skill_name", archive_path.stem)}
    except Exception as exc:
        logger.exception("install_from_file failed")
        raise HTTPException(status_code=500, detail=f"Install failed: {exc}") from exc


# ============ endpoints: install from npm / GitHub / local path ============


class InstallNpmRequest(BaseModel):
    source: str


def _find_skill_md(root: Path) -> Path | None:
    """Recursively search for SKILL.md under root."""
    for current_root, _dir_names, file_names in os.walk(root):
        if "SKILL.md" in file_names:
            return Path(current_root) / "SKILL.md"
    return None


def _parse_skill_name_from_frontmatter(skill_md_path: Path) -> str | None:
    """Extract the ``name`` field from a SKILL.md YAML frontmatter."""
    try:
        content = skill_md_path.read_text(encoding="utf-8")
    except OSError:
        return None
    # Match frontmatter block between --- delimiters
    match = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return None
    frontmatter = match.group(1)
    # Extract name: value
    for line in frontmatter.splitlines():
        m = re.match(r"^name:\s*(.+?)\s*$", line)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    return None


def _install_skill_dir_contents(src_dir: Path, skill_md: Path, custom_root: Path) -> str:
    """Copy skill files from src_dir/skill_md.parent into custom_root/<name>/.

    Returns the skill name. Uses the ``name`` field from frontmatter; if
    absent, falls back to the parent directory name.
    """
    name = _parse_skill_name_from_frontmatter(skill_md) or skill_md.parent.name
    # Sanitize: lowercase, hyphens only (QiLin validate_skill_name convention)
    name = re.sub(r"[^a-z0-9-]", "-", name.lower()).strip("-")
    name = re.sub(r"-+", "-", name)
    if not name:
        name = skill_md.parent.name.lower()

    dest = custom_root / name
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)

    # Copy the skill directory (skill_md.parent) contents into dest
    src_skill_dir = skill_md.parent
    for item in src_skill_dir.iterdir():
        target = dest / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)
    return name


def _install_from_local_dir(source: str, custom_root: Path) -> str:
    """Install skill from a local directory path."""
    src = Path(source)
    if not src.is_dir():
        raise ValueError(f"Path is not a directory: {source}")
    skill_md = _find_skill_md(src)
    if skill_md is None:
        raise ValueError(f"No SKILL.md found under {source}")
    return _install_skill_dir_contents(src, skill_md, custom_root)


def _install_via_npm_pack(source: str, custom_root: Path) -> str:
    """Install skill via ``npm pack`` → unpack tgz → find SKILL.md → copy.

    Works for npm registry packages and GitHub URLs (npm pack supports both).
    """
    tmpdir = tempfile.mkdtemp(prefix="npm-skill-")
    try:
        result = subprocess.run(
            ["npm", "pack", source, "--pack-destination", tmpdir],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if result.returncode != 0:
            raise ValueError(f"npm pack failed: {result.stderr.strip()}")

        # Find the produced .tgz
        tgz_files = list(Path(tmpdir).glob("*.tgz"))
        if not tgz_files:
            raise ValueError("npm pack produced no archive")
        tgz = tgz_files[0]

        # Extract tgz (npm packs use a 'package/' prefix)
        extract_dir = Path(tmpdir) / "extracted"
        extract_dir.mkdir(exist_ok=True)
        shutil.unpack_archive(str(tgz), str(extract_dir), "gztar")

        # Find SKILL.md (typically under package/ subdir)
        skill_md = _find_skill_md(extract_dir)
        if skill_md is None:
            raise ValueError(f"No SKILL.md found in npm package '{source}'")

        return _install_skill_dir_contents(extract_dir, skill_md, custom_root)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@router.post("/install-from-npm")
async def install_from_npm(request: Request, payload: InstallNpmRequest) -> dict[str, Any]:
    """POST /v1/skills/install-from-npm → install from npm pkg / GitHub URL / local dir.

    Detection logic:
    - Local directory (os.path.isdir) → direct copy
    - Otherwise (npm package name, GitHub URL) → npm pack → extract → copy
    """
    user_id = _resolve_user_id(request)
    storage = _load_skill_storage(user_id)
    if storage is None:
        raise HTTPException(status_code=503, detail="SkillStorage unavailable")

    custom_root = _resolve_custom_skills_root(storage, user_id)
    custom_root.mkdir(parents=True, exist_ok=True)

    source = payload.source.strip()
    if not source:
        raise HTTPException(status_code=400, detail="source is required")

    def _do_install() -> str:
        if os.path.isdir(source):
            return _install_from_local_dir(source, custom_root)
        return _install_via_npm_pack(source, custom_root)

    try:
        skill_name = await asyncio.to_thread(_do_install)
        return {"success": True, "skill_name": skill_name}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("install_from_npm failed")
        raise HTTPException(status_code=500, detail=f"Install failed: {exc}") from exc
