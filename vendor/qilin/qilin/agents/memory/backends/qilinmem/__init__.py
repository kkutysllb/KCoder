"""QiLinMem backend -- the default memory manager (self-contained).

Holds its own manager class (:mod:`qilin_mem`) plus a ``core/`` folder with
the five functional modules (storage / queue / updater / prompt /
message_processing). All QiLinMem-private logic lives here; the shared
package top only carries the contract + factory + thin entry points.
"""

from .qilin_mem import QiLinMem

#: The :class:`~qilin.agents.memory.manager.MemoryManager` subclass this
#: backend exposes. Discovered by the factory's ``_scan_backends`` drop-in
#: mechanism under the folder name ``qilinmem``.
MANAGER_CLASS = QiLinMem
