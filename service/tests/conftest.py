from __future__ import annotations

import os
from uuid import uuid4

from cryptography.fernet import Fernet

# Подставляем env до любого импорта приложения, иначе Settings свалится
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://x:x@localhost/x")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("JWT_SECRET", "test-secret-please-replace-me")
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())

import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import JSON


def _portable_metadata():
    """Переписать PG-специфику моделей на типы, переносимые в SQLite."""
    from app.db.base import Base
    import app.models  # noqa: F401 — регистрация всех моделей

    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, postgresql.JSONB):
                col.type = JSON()
            if col.server_default is not None and "gen_random_uuid" in str(col.server_default.arg):
                col.server_default = None
                if col.default is None and col.primary_key:
                    col.default = lambda: uuid4()
    return Base


@pytest.fixture()
def db_session():
    """Чистая in-memory SQLite-сессия с применёнными моделями."""
    Base = _portable_metadata()
    engine = create_engine(
        "sqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    session = Session()
    try:
        yield session
    finally:
        session.close()
