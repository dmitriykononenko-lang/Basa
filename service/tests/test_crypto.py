import pytest

from app.core.crypto import TokenCipher


def test_round_trip():
    from cryptography.fernet import Fernet

    cipher = TokenCipher(Fernet.generate_key().decode())
    encrypted = cipher.encrypt("amo-access-token-xyz")
    assert encrypted != "amo-access-token-xyz"
    assert cipher.decrypt(encrypted) == "amo-access-token-xyz"


def test_rejects_empty_key():
    with pytest.raises(RuntimeError):
        TokenCipher("")


def test_decrypt_with_wrong_key_fails():
    from cryptography.fernet import Fernet

    k1 = Fernet.generate_key().decode()
    k2 = Fernet.generate_key().decode()
    ciphertext = TokenCipher(k1).encrypt("secret")
    with pytest.raises(RuntimeError):
        TokenCipher(k2).decrypt(ciphertext)
