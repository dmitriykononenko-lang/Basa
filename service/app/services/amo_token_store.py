"""Хранение OAuth-токенов AmoCRM в settings (зашифровано)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.core.crypto import cipher
from app.models import Setting

TOKEN_SETTINGS_KEY = "amo_oauth_tokens"


@dataclass
class AmoTokens:
    access_token: str
    refresh_token: str
    expires_at: datetime

    def is_expired(self, slack_seconds: int = 300) -> bool:
        return datetime.now(timezone.utc) + timedelta(seconds=slack_seconds) >= self.expires_at


def save_tokens(db: Session, access_token: str, refresh_token: str, expires_in: int) -> None:
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
    value = {
        "access_token": cipher.encrypt(access_token),
        "refresh_token": cipher.encrypt(refresh_token),
        "expires_at": expires_at.isoformat(),
    }
    row = db.get(Setting, TOKEN_SETTINGS_KEY)
    if row is None:
        row = Setting(key=TOKEN_SETTINGS_KEY, value=value)
        db.add(row)
    else:
        row.value = value
    db.commit()


def load_tokens(db: Session) -> Optional[AmoTokens]:
    row = db.get(Setting, TOKEN_SETTINGS_KEY)
    if row is None or not row.value:
        return None
    raw = row.value
    return AmoTokens(
        access_token=cipher.decrypt(raw["access_token"]),
        refresh_token=cipher.decrypt(raw["refresh_token"]),
        expires_at=datetime.fromisoformat(raw["expires_at"]),
    )
