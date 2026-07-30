"""Feedback persistence — ORM and SQL repository."""

from qilin.persistence.feedback.model import FeedbackRow
from qilin.persistence.feedback.sql import FeedbackRepository

__all__ = ["FeedbackRepository", "FeedbackRow"]
