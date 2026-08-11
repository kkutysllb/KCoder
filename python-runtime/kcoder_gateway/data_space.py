"""KCoderDataSpace — 用户数据空间统一管理层.

实现《用户数据空间组织设计》（docs/用户数据空间组织设计.md）的 sidecar 侧
核心能力：

1. 解析数据根目录（~/.kcoder 或 KCODER_APP_DATA_DIR）
2. 创建六大子目录（config/runtime/product/cache/logs/backups）
3. 生成 qilin.runtime.yaml（显式绝对路径，修复 SQLite 默认相对路径坑）
4. 解析/创建默认本地用户身份（local-{机器标识短哈希}）
5. v0.1 散落数据的迁移（幂等）

设计参考：KStock 项目 scripts/run_gateway.py 的 _resolve_app_data_root /
_generate_runtime_config / _migrate_legacy_data_root 思路，按 KCoder 的
coding 工具定位调整（sandbox.allow_host_bash=true、product 索引代码片段等）。

调用契约：
    from kcoder_gateway.data_space import KCoderDataSpace
    space = KCoderDataSpace.resolve()
    space.ensure_directories()
    runtime_cfg_path = space.write_runtime_config(template_path)
    user_id = space.ensure_local_user()
    # 然后才启动 QiLin / gateway

不变量：
    - 同一进程多次调用 ensure_directories() / write_runtime_config() 幂等
    - write_runtime_config 已存在时不覆盖（保护用户在 Settings 的改动），
      仅增量合并 tools / subagents.custom_agents 等产品级段
    - 迁移逻辑只在数据根为空且检测到旧位置时触发，绝不覆盖新数据
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import platform
import shutil
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger("kcoder_gateway.data_space")

# 六大子目录（相对数据根）
SUBDIR_CONFIG = "config"
SUBDIR_RUNTIME = "runtime"
SUBDIR_PRODUCT = "product"
SUBDIR_CACHE = "cache"
SUBDIR_LOGS = "logs"
SUBDIR_BACKUPS = "backups"

# runtime/ 内的 QiLin 工作目录
QILIN_HOME_SUBDIR = "runtime/qilin"
QILIN_DATA_SUBDIR = "runtime/qilin/data"
LANGGRAPH_API_SUBDIR = "runtime/langgraph_api"

# 关键配置文件名
SETTINGS_FILE = "kcoder.settings.json"
RUNTIME_CONFIG_FILE = "qilin.runtime.yaml"
MODELS_CONFIG_FILE = "models.yaml"
SECRETS_FILE = "secrets.env"

# 默认用户名（v1：本机单用户）
DEFAULT_USER_ID_PREFIX = "local-"

# Schema 版本
SCHEMA_VERSION = 1


def _resolve_app_data_root() -> Path:
    """解析 KCoder 用户数据根目录（跨平台）。

    优先级：
    1. KCODER_APP_DATA_DIR 环境变量 —— Electron 宿主 / 命令行调试显式指定
    2. 用户主目录 ~/.kcoder —— 产品默认（macOS / Windows / Linux 统一）

    选择 ~/.kcoder 而不是系统 Application Support 目录的原因见设计文档
    "跨平台数据根目录" 段（避免空格、可见可备份、与仓库内调试缓存区分）。
    """
    env_root = os.environ.get("KCODER_APP_DATA_DIR")
    if env_root:
        return Path(env_root).expanduser()
    return Path.home() / ".kcoder"


def _machine_fingerprint() -> str:
    """生成机器安装标识短哈希（8 字符），用于稳定 local-{id} 用户名。

    跨平台：优先取 hostname + platform 标识的 sha256 前 8 位。同一机器多次
    调用结果稳定；不同机器极大概率不同。
    """
    raw = f"{platform.node()}|{platform.system()}|{platform.machine()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8]


class KCoderDataSpace:
    """KCoder 用户数据空间的 sidecar 侧管理器。

    一次解析、多次使用：实例属性 root / config_dir / runtime_dir 等都是绝对
    路径 Path 对象，可直接传给 QiLin config / SQLite / sandbox。
    """

    def __init__(self, root: Path) -> None:
        self.root: Path = root
        self.config_dir: Path = root / SUBDIR_CONFIG
        self.runtime_dir: Path = root / SUBDIR_RUNTIME
        self.product_dir: Path = root / SUBDIR_PRODUCT
        self.cache_dir: Path = root / SUBDIR_CACHE
        self.logs_dir: Path = root / SUBDIR_LOGS
        self.backups_dir: Path = root / SUBDIR_BACKUPS

        # runtime/ 内细分子目录
        self.qilin_home: Path = root / QILIN_HOME_SUBDIR
        self.qilin_data_dir: Path = root / QILIN_DATA_SUBDIR
        self.langgraph_api_dir: Path = root / LANGGRAPH_API_SUBDIR

        # 关键配置文件绝对路径
        self.settings_path: Path = self.config_dir / SETTINGS_FILE
        self.runtime_config_path: Path = self.config_dir / RUNTIME_CONFIG_FILE
        self.models_config_path: Path = self.config_dir / MODELS_CONFIG_FILE
        self.secrets_path: Path = self.config_dir / SECRETS_FILE

        # SQLite 数据库绝对路径
        self.qilin_db_path: Path = self.qilin_data_dir / "qilin.db"
        self.kcoder_db_path: Path = self.product_dir / "kcoder.db"

    @classmethod
    def resolve(cls) -> "KCoderDataSpace":
        """工厂方法：从环境变量 / 默认位置解析数据根并返回实例。"""
        root = _resolve_app_data_root()
        return cls(root)

    def ensure_directories(self) -> None:
        """创建所有子目录（幂等）。

        全部 parents=True, exist_ok=True，重复调用无副作用。
        """
        for d in (
            self.config_dir,
            self.runtime_dir,
            self.product_dir,
            self.cache_dir,
            self.logs_dir,
            self.backups_dir,
            # runtime 细分
            self.qilin_home,
            self.qilin_data_dir,
            self.langgraph_api_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)
        logger.debug("KCoder data space ensured at %s", self.root)

    def ensure_local_user(self) -> str:
        """读取或创建默认本地用户 ID，写入 kcoder.settings.json。

        幂等：文件存在时读出 activeUserId 返回；不存在时生成
        ``local-{机器标识短哈希}`` 并持久化。

        Returns:
            稳定的用户 ID（如 "local-1a2b3c4d"）。
        """
        if self.settings_path.exists():
            try:
                data = json.loads(self.settings_path.read_text(encoding="utf-8"))
                uid = data.get("activeUserId")
                if isinstance(uid, str) and uid:
                    return uid
            except (OSError, json.JSONDecodeError):
                logger.warning("settings file unreadable, regenerating", exc_info=True)

        uid = f"{DEFAULT_USER_ID_PREFIX}{_machine_fingerprint()}"
        payload = {
            "activeUserId": uid,
            "schemaVersion": SCHEMA_VERSION,
            "ui": {"theme": "dark", "sidebarCollapsed": False, "language": "zh-CN"},
        }
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        logger.info("Created default local user: %s", uid)
        return uid

    def write_runtime_config(self, template_path: Path) -> Path:
        """生成 qilin.runtime.yaml，显式写入绝对路径。

        以发布包模板 ``config/qilin.config.yaml`` 为基础，覆盖路径相关字段：
        - ``database.backend`` = sqlite、``database.sqlite_dir`` = 绝对路径
        - ``run_events.backend`` = db（运行事件进数据库）
        - ``skills.path`` = 模板里的相对路径转绝对（相对仓库根）

        关键修复：vendor DatabaseConfig.sqlite_dir 默认值 ``.qilin/data`` 是
        相对 CWD 的，不显式配置就会写到仓库里（KStock 踩过的坑）。

        幂等策略：
        - 文件不存在：从模板生成，写入绝对路径
        - 文件已存在：保留用户配置（Settings 写入的 models 等不覆盖），
          仅增量合并产品级 tools 段（确保内置工具同步）
        """
        try:
            import yaml
        except ImportError as exc:
            raise RuntimeError(
                "PyYAML required for KCoderDataSpace.write_runtime_config"
            ) from exc

        with template_path.open("r", encoding="utf-8") as fh:
            template_cfg: dict[str, Any] = yaml.safe_load(fh) or {}

        if self.runtime_config_path.exists():
            self._merge_runtime_config(template_cfg)
            return self.runtime_config_path

        # 首次生成
        cfg = dict(template_cfg)

        # 持久化层：强制 SQLite 落到用户数据目录的绝对路径
        database = dict(cfg.get("database") or {})
        database["backend"] = "sqlite"
        database["sqlite_dir"] = str(self.qilin_data_dir)
        cfg["database"] = database

        # 运行事件进入数据库
        run_events = dict(cfg.get("run_events") or {})
        run_events["backend"] = "db"
        cfg["run_events"] = run_events

        # 技能根目录转绝对路径（模板里是相对，如 ../skills）
        skills = dict(cfg.get("skills") or {})
        skills_path = skills.get("path") or skills.pop("root", None) or "skills"
        cfg["skills"] = {
            **skills,
            "path": str((template_path.parent.parent / skills_path).resolve()),
        }

        self.runtime_config_path.parent.mkdir(parents=True, exist_ok=True)
        with self.runtime_config_path.open("w", encoding="utf-8") as fh:
            yaml.safe_dump(cfg, fh, allow_unicode=True, sort_keys=False)
        logger.info("Generated runtime config: %s", self.runtime_config_path)
        return self.runtime_config_path

    def _merge_runtime_config(self, template_cfg: dict[str, Any]) -> None:
        """runtime.yaml 已存在时增量合并产品级段。

        - tools 段：直接用模板覆盖（产品级定义权威）
        - 其他段（models/memory/sandbox/database/subagents/...）：保留用户配置
        - skills.path 指向不存在目录时回退到内置技能包
        """
        try:
            import yaml
        except ImportError:
            return

        try:
            with self.runtime_config_path.open("r", encoding="utf-8") as fh:
                existing: dict[str, Any] = yaml.safe_load(fh) or {}
        except (OSError, yaml.YAMLError):
            logger.warning("runtime config unreadable, skipping merge", exc_info=True)
            return

        changed = False

        # 1) tools 段：模板覆盖
        template_tools = template_cfg.get("tools")
        if template_tools and existing.get("tools") != template_tools:
            existing["tools"] = template_tools
            changed = True

        # 2) skills.path 字段迁移 + 失效回退
        existing_skills = dict(existing.get("skills") or {})
        if "path" not in existing_skills and "root" in existing_skills:
            existing_skills["path"] = existing_skills.pop("root")
            existing["skills"] = existing_skills
            changed = True

        skills_path_str = existing_skills.get("path")
        if isinstance(skills_path_str, str) and skills_path_str:
            sp = Path(skills_path_str).expanduser()
            if not sp.is_absolute():
                sp = self.root.parent / sp  # best-effort：相对仓库根
            if not sp.exists():
                template_skills_path = (template_cfg.get("skills") or {}).get("path", "skills")
                bundled = (self.root.parent / template_skills_path).resolve()
                if bundled.is_dir() and existing_skills.get("path") != str(bundled):
                    existing_skills["path"] = str(bundled)
                    existing["skills"] = existing_skills
                    changed = True

        # 3) database.sqlite_dir 修复（旧配置可能指向仓库内）
        existing_db = dict(existing.get("database") or {})
        if existing_db.get("sqlite_dir") != str(self.qilin_data_dir):
            existing_db["backend"] = "sqlite"
            existing_db["sqlite_dir"] = str(self.qilin_data_dir)
            existing["database"] = existing_db
            changed = True

        if changed:
            with self.runtime_config_path.open("w", encoding="utf-8") as fh:
                yaml.safe_dump(existing, fh, allow_unicode=True, sort_keys=False)
            logger.info("Merged runtime config: %s", self.runtime_config_path)

    def write_default_extensions_config(self) -> Path:
        """写入空的 extensions_config.json（MCP server CRUD 初始真源）。

        在 gateway 的 main.py 已有 _ensure_extensions_config 逻辑（自动注册
        worktree-overlay），这里只在数据空间根的 config/ 写一份空骨架，
        作为 MCP 配置 API 的持久化文件。当前 KCoder 仍用仓库内
        extensions_config.json，此方法预留给后续 MCP 配置迁移到用户数据目录。
        """
        path = self.config_dir / "extensions_config.json"
        if path.exists():
            return path
        empty = {"middlewares": [], "mcpServers": {}, "skills": {}}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(empty, indent=2, ensure_ascii=False), encoding="utf-8")
        return path

    def env_vars_for_qilin(self) -> dict[str, str]:
        """构造启动 QiLin / langgraph dev 需要的环境变量。

        这些环境变量让 QiLin 知道数据根、配置文件、扩展配置的位置。Electron
        主进程 spawn sidecar 时把它们注入子进程 env。
        """
        return {
            "KCODER_APP_DATA_DIR": str(self.root),
            "QILIN_HOME": str(self.qilin_home),
            # QILIN_CONFIG_PATH 由 write_runtime_config 返回的路径决定，
            # 调用方在拿到 runtime_config_path 后自行 setdefault。
        }

    def migrate_from_v01(self, repo_root: Path) -> int:
        """从 v0.1 散落布局迁移到统一数据根（幂等）。

        v0.1 数据位置（仓库内）：
        - <repo>/python-runtime/.qilin/          → ~/.kcoder/runtime/qilin/
        - <repo>/python-runtime/.langgraph_api/  → ~/.kcoder/runtime/langgraph_api/
        - <repo>/python-runtime/kcoder_local/    → ~/.kcoder/product/kcoder_local/
        - <repo>/python-runtime/.kcoder_jwt_secret → ~/.kcoder/config/.kcoder_jwt_secret
        - <repo>/python-runtime/config.yaml      → 合并进 ~/.kcoder/config/qilin.runtime.yaml
        - ~/.kcoder/qilin-data/                   → ~/.kcoder/config/legacy-user-data/

        Returns:
            迁移的文件数（0 表示无迁移）。

        迁移规则：
        - 目标已存在时跳过（绝不覆盖新数据）
        - 同卷用 shutil.move（原子 rename），跨卷 fallback 到 copytree + rmtree
        """
        migrated = 0

        # 1) .qilin/ → runtime/qilin/
        src_qilin = repo_root / "python-runtime" / ".qilin"
        if src_qilin.exists() and not any(self.qilin_home.iterdir()):
            migrated += self._move_tree(src_qilin, self.qilin_home)

        # 2) .langgraph_api/ → runtime/langgraph_api/
        src_lg = repo_root / "python-runtime" / ".langgraph_api"
        if src_lg.exists() and not any(self.langgraph_api_dir.iterdir()):
            migrated += self._move_tree(src_lg, self.langgraph_api_dir)

        # 3) kcoder_local/ → product/kcoder_local/
        src_local = repo_root / "python-runtime" / "kcoder_local"
        dst_local = self.product_dir / "kcoder_local"
        dst_local.mkdir(parents=True, exist_ok=True)
        if src_local.exists() and not any(dst_local.iterdir()):
            migrated += self._move_tree(src_local, dst_local)

        # 4) .kcoder_jwt_secret → config/.kcoder_jwt_secret
        src_jwt = repo_root / "python-runtime" / ".kcoder_jwt_secret"
        dst_jwt = self.config_dir / ".kcoder_jwt_secret"
        if src_jwt.exists() and not dst_jwt.exists():
            try:
                shutil.move(str(src_jwt), str(dst_jwt))
                migrated += 1
            except OSError:
                shutil.copy2(str(src_jwt), str(dst_jwt))
                src_jwt.unlink()
                migrated += 1

        if migrated > 0:
            logger.info("Migrated %d items from v0.1 layout to %s", migrated, self.root)
        return migrated

    def _move_tree(self, src: Path, dst: Path) -> int:
        """移动目录树（同卷 rename，跨卷 copytree + rmtree），返回项数。"""
        dst.mkdir(parents=True, exist_ok=True)
        count = 0
        try:
            # 同卷 rename 整个目录最快
            for item in src.iterdir():
                target = dst / item.name
                if target.exists():
                    continue
                shutil.move(str(item), str(target))
                count += 1
        except OSError:
            # 跨卷 fallback
            for item in src.iterdir():
                target = dst / item.name
                if target.exists():
                    continue
                if item.is_dir():
                    shutil.copytree(str(item), str(target))
                    shutil.rmtree(str(item))
                else:
                    shutil.copy2(str(item), str(target))
                    item.unlink()
                count += 1
        return count

    def summary(self) -> dict[str, Any]:
        """返回数据空间摘要（用于 sidecar 协议 workspace.info）。"""
        return {
            "root": str(self.root),
            "config_dir": str(self.config_dir),
            "runtime_dir": str(self.runtime_dir),
            "product_dir": str(self.product_dir),
            "cache_dir": str(self.cache_dir),
            "logs_dir": str(self.logs_dir),
            "qilin_home": str(self.qilin_home),
            "qilin_db_path": str(self.qilin_db_path),
            "kcoder_db_path": str(self.kcoder_db_path),
            "runtime_config_path": str(self.runtime_config_path),
            "settings_path": str(self.settings_path),
        }
