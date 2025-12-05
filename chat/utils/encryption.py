from cryptography.fernet import Fernet
from django.conf import settings

# settings.FERNET_KEY must be a base64 urlsafe key string, e.g. Fernet.generate_key().decode()
f = Fernet(settings.FERNET_KEY.encode())

def encrypt_message(text: str) -> bytes:
    return f.encrypt(text.encode())

def decrypt_message(token: bytes) -> str:
    return f.decrypt(token).decode()
