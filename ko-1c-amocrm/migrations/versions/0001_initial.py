"""initial schema

Revision ID: 0001
Revises:
Create Date: 2025-01-01 00:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lead_mappings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("order_number_1c", sa.String(100), nullable=False, unique=True),
        sa.Column("amocrm_lead_id", sa.Integer, nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_lead_mappings_order_number_1c", "lead_mappings", ["order_number_1c"])
    op.create_index("ix_lead_mappings_amocrm_lead_id", "lead_mappings", ["amocrm_lead_id"])

    op.create_table(
        "sync_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("direction", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("order_number_1c", sa.String(100), nullable=True),
        sa.Column("amocrm_lead_id", sa.Integer, nullable=True),
        sa.Column("payload", JSONB, nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("attempts", sa.Integer, default=1),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_sync_log_status", "sync_log", ["status"])
    op.create_index("ix_sync_log_order_number_1c", "sync_log", ["order_number_1c"])

    op.create_table(
        "dead_letter",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("direction", sa.String(20), nullable=False),
        sa.Column("order_number_1c", sa.String(100), nullable=True),
        sa.Column("amocrm_lead_id", sa.Integer, nullable=True),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("last_error", sa.Text, nullable=False),
        sa.Column("total_attempts", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("resolved", sa.Boolean, default=False),
    )


def downgrade() -> None:
    op.drop_table("dead_letter")
    op.drop_table("sync_log")
    op.drop_table("lead_mappings")
