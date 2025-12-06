#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


import ssl

# Monkeypatch for Python 3.10+ where ssl.wrap_socket is removed
if not hasattr(ssl, 'wrap_socket'):
    def wrap_socket(sock, keyfile=None, certfile=None, **kwargs):
        context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        context.load_cert_chain(certfile=certfile, keyfile=keyfile)
        # Bypassing deprecation warning/errors for legacy django-sslserver usage
        return context.wrap_socket(sock, server_side=True)
    ssl.wrap_socket = wrap_socket

def main():
    """Run administrative tasks."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'teams_chat.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
