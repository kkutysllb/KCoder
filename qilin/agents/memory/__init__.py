"""Pluggable memory for QiLin.

The shared, backend-agnostic core: the :class:`MemoryManager` contract, the
:func:`get_memory_manager` singleton factory, and :func:`reset_memory_manager`.
Backends live under :mod:`backends` (each self-contained, exposing
``MANAGER_CLASS``); the default QiLinMem backend's functional modules live in
``backends/qilinmem/core/``. Swap backend = drop a ``backends/<name>/`` folder +
set ``MemoryConfig.manager_class`` -- nothing else in qilin changes.

QiLinMem-private symbols (``format_memory_for_injection``, ``get_memory_data``,
``MemoryUpdater``, ``FileMemoryStorage``, ...) are NOT re-exported here -- import
them directly from ``qilin.agents.memory.backends.qilinmem.qilinmem.core.*``.
"""

from qilin.agents.memory.manager import (
    MemoryConflictError,
    MemoryCorruptionError,
    MemoryManager,
    MemoryManagerError,
    get_memory_manager,
    reset_memory_manager,
)

__all__ = [
    "MemoryManager",
    "MemoryManagerError",
    "MemoryConflictError",
    "MemoryCorruptionError",
    "get_memory_manager",
    "reset_memory_manager",
]
