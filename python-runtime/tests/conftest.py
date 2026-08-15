"""KCoder gateway / engine 本地补丁的单测夹具。

python-runtime 为 rootdir 运行 pytest：kcoder_gateway 从当前目录可导入，
qilin 经 ``-e ../vendor/qilin`` 已装入 venv。本文件只做公共 patch 助手。
"""

from __future__ import annotations

from unittest.mock import patch


def patch_permission_config(mode: str, approved: list[str] | None = None):
    """patch PermissionMiddleware 读到的 configurable（permission_mode/approved_ops）。"""
    configurable = {"permission_mode": mode}
    if approved:
        configurable["approved_ops"] = approved
    return patch(
        "qilin.agents.middlewares.permission_middleware.get_config",
        return_value={"configurable": configurable},
    )
