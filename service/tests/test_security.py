from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_password_round_trip():
    h = hash_password("super-secret")
    assert h != "super-secret"
    assert verify_password("super-secret", h)
    assert not verify_password("wrong", h)


def test_access_token_round_trip():
    token = create_access_token("user-id-123", "admin")
    payload = decode_token(token)
    assert payload["sub"] == "user-id-123"
    assert payload["role"] == "admin"
    assert payload["type"] == "access"


def test_refresh_token_round_trip():
    token = create_refresh_token("user-id-123")
    payload = decode_token(token)
    assert payload["sub"] == "user-id-123"
    assert payload["type"] == "refresh"


def test_decode_token_rejects_garbage():
    import pytest

    with pytest.raises(ValueError):
        decode_token("not-a-jwt")
