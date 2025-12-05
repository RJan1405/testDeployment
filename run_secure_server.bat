@echo off
echo Stopping any running python processes...
taskkill /F /IM python.exe >nul 2>&1

echo Starting Secure Teams Chat Server (HTTPS)...
echo Access the site at: https://%COMPUTERNAME%:8001/chat/
echo OR: https://127.0.0.1:8001/chat/
echo.
echo NOTE: You will see a security warning because we are using a self-signed certificate.
echo Click "Advanced" -> "Proceed" (Chrome) or "Show Details" -> "Visit" (Safari).
echo.
python -m daphne -b 0.0.0.0 -e ssl:8001:privateKey=key.pem:certKey=cert.pem teams_chat.asgi:application
pause
