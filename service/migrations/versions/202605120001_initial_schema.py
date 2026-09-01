"""initial schema

Revision ID: 202605120001
Revises:
Create Date: 2026-05-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202605120001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column(
            "role",
            sa.Enum("admin", "accountant", "analyst", name="user_role"),
            nullable=False,
            server_default="analyst",
        ),
        sa.Column("full_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "analysts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("amo_user_id", sa.BigInteger(), nullable=True, unique=True),
        sa.Column("default_rate", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("payment_details", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column(
            "status",
            sa.Enum("active", "archived", name="analyst_status"),
            nullable=False,
            server_default="active",
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_analysts_user_id", "analysts", ["user_id"])

    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("amo_deal_id", sa.BigInteger(), nullable=True, unique=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column(
            "analyst_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("analysts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("payment_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column(
            "status",
            sa.Enum("in_progress", "done", "paid", "cancelled", name="project_status"),
            nullable=False,
            server_default="in_progress",
        ),
        sa.Column("amo_status_id", sa.BigInteger(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_projects_analyst_id", "projects", ["analyst_id"])
    op.create_index("ix_projects_status", "projects", ["status"])

    op.create_table(
        "payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "analyst_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("analysts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column(
            "status",
            sa.Enum("accrued", "ready", "paid", "cancelled", name="payment_status"),
            nullable=False,
            server_default="accrued",
        ),
        sa.Column("accrued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_payments_status", "payments", ["status"])
    op.create_index("ix_payments_analyst_id", "payments", ["analyst_id"])
    op.create_index("ix_payments_project_id", "payments", ["project_id"])

    op.create_table(
        "payment_audit",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "payment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("payments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "changed_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("field", sa.String(64), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_payment_audit_payment_id", "payment_audit", ["payment_id"])

    op.create_table(
        "amo_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("amo_task_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("amo_entity_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "analyst_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("analysts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("task_type", sa.Integer(), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("deadline_initial", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deadline_current", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_overdue", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_amo_tasks_analyst_id", "amo_tasks", ["analyst_id"])
    op.create_index("ix_amo_tasks_amo_entity_id", "amo_tasks", ["amo_entity_id"])
    op.create_index("ix_amo_tasks_completed_at", "amo_tasks", ["completed_at"])

    op.create_table(
        "amo_webhook_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(255), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("processed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.UniqueConstraint("idempotency_key", name="uq_amo_webhook_log_idempotency_key"),
    )
    op.create_index("ix_amo_webhook_log_received_at", "amo_webhook_log", ["received_at"])
    op.create_index("ix_amo_webhook_log_event_type", "amo_webhook_log", ["event_type"])
    op.create_index("ix_amo_webhook_log_idempotency_key", "amo_webhook_log", ["idempotency_key"])

    op.create_table(
        "settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("settings")
    op.drop_index("ix_amo_webhook_log_idempotency_key", table_name="amo_webhook_log")
    op.drop_index("ix_amo_webhook_log_event_type", table_name="amo_webhook_log")
    op.drop_index("ix_amo_webhook_log_received_at", table_name="amo_webhook_log")
    op.drop_table("amo_webhook_log")
    op.drop_index("ix_amo_tasks_completed_at", table_name="amo_tasks")
    op.drop_index("ix_amo_tasks_amo_entity_id", table_name="amo_tasks")
    op.drop_index("ix_amo_tasks_analyst_id", table_name="amo_tasks")
    op.drop_table("amo_tasks")
    op.drop_index("ix_payment_audit_payment_id", table_name="payment_audit")
    op.drop_table("payment_audit")
    op.drop_index("ix_payments_project_id", table_name="payments")
    op.drop_index("ix_payments_analyst_id", table_name="payments")
    op.drop_index("ix_payments_status", table_name="payments")
    op.drop_table("payments")
    op.drop_index("ix_projects_status", table_name="projects")
    op.drop_index("ix_projects_analyst_id", table_name="projects")
    op.drop_table("projects")
    op.drop_index("ix_analysts_user_id", table_name="analysts")
    op.drop_table("analysts")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS payment_status")
    op.execute("DROP TYPE IF EXISTS project_status")
    op.execute("DROP TYPE IF EXISTS analyst_status")
    op.execute("DROP TYPE IF EXISTS user_role")
