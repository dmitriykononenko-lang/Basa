"""Шифрование секретов (AmoCRM-токенов) в БД."""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class TokenCipher:
    def __init__(self, key: str) -> None:
        if not key:
            raise RuntimeError("TOKEN_ENCRYPTION_KEY is not configured")
        # Fernet ожидает 32 url-safe base64-байт; ошибку выкидываем сразу
        self._fernet = Fernet(key.encode() if isinstance(key, str) else key)

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")

    def decrypt(self, ciphertext: str) -> str:
        try:
            return self._fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
        except InvalidToken as exc:
            raise RuntimeError("Failed to decrypt token: invalid key or tampered data") from exc


cipher = TokenCipher(settings.token_encryption_key)
