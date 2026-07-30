"""ORM model registration entry point.

Importing this module ensures all ORM models are registered with
``Base.metadata`` so Alembic autogenerate detects every table.

The actual ORM classes have moved to entity-specific subpackages:
- ``qilin.persistence.thread_meta``
- ``qilin.persistence.run``
- ``qilin.persistence.feedback``
- ``qilin.persistence.user``

``RunEventRow`` remains in ``qilin.persistence.models.run_event`` because
its storage implementation lives in ``qilin.runtime.events.store.db`` and
there is no matching entity directory.
"""

from qilin.persistence.agents.model import AgentRow
from qilin.persistence.channel_connections.model import (
    ChannelConnectionRow,
    ChannelConversationRow,
    ChannelCredentialRow,
    ChannelOAuthStateRow,
)
from qilin.persistence.feedback.model import FeedbackRow
from qilin.persistence.models.run_event import RunEventRow
from qilin.persistence.run.model import RunRow
from qilin.persistence.scheduled_task_runs.model import ScheduledTaskRunRow
from qilin.persistence.scheduled_tasks.model import ScheduledTaskRow
from qilin.persistence.thread_meta.model import ThreadMetaRow
from qilin.persistence.user.model import UserRow
from qilin.persistence.webhook_delivery.model import WebhookDeliveryRow

__all__ = [
    "AgentRow",
    "ChannelConnectionRow",
    "ChannelConversationRow",
    "ChannelCredentialRow",
    "ChannelOAuthStateRow",
    "FeedbackRow",
    "RunEventRow",
    "RunRow",
    "ScheduledTaskRow",
    "ScheduledTaskRunRow",
    "ThreadMetaRow",
    "UserRow",
    "WebhookDeliveryRow",
]
