@echo off
chcp 65001 >nul
title Aethelion — Canli Simsek ve Yayin Baslatici
color 0b

set "PROJECT_DIR=C:\Users\Korhan\Desktop\AG Korhan\Lightning"
set "OBS_DIR=C:\Users\Korhan\Desktop\OBS-Studio-32.2.2-Windows-x64\bin\64bit"
set "OBS_EXE=obs64.exe"

cd /d "%PROJECT_DIR%"

echo ===================================================================
echo       ⚡ AETHELION — PLANETARY LIGHTNING OBSERVATORY ⚡
echo                  YAYIN VE SUNUCU KONTROL MERKEZI
echo ===================================================================
echo.

:: 1. LOCALHOST KONTROLU VE OTOMATIK BASLATMA
echo [1/3] Localhost Sunucusu (Port 3005) Kontrol Ediliyor...
curl.exe -s -o NUL http://localhost:3005
if %ERRORLEVEL% equ 0 (
    echo       [OK] Localhost (Port 3005) zaten calisiyor.
) else (
    echo       [!] Localhost kapali tespit edildi. Otomatik baslatiliyor...
    start "Aethelion-Vite-Server" /min cmd /k "cd /d "%PROJECT_DIR%" && npx vite --port 3005"
    
    echo       [>] Sunucunun ayaga kalkmasi bekleniyor...
    :wait_loop
    ping -n 2 127.0.0.1 >nul
    curl.exe -s -o NUL http://localhost:3005
    if %ERRORLEVEL% neq 0 (
        echo       ... baglanti bekleniyor ...
        goto wait_loop
    )
    echo       [OK] Localhost (Port 3005) basariyla acildi ve yanit veriyor!
)

:: 2. 24 SAATLIK CANLI TELEMETRI ARSIVI ESZAMANLAMA
echo.
echo [2/3] VPS Sunucusundan 24 Saatlik Arsiv Eszamanlaniyor (10-15 sn)...
call npm run sync:vps >nul 2>&1
echo       [OK] Telemetri arsivi guncellendi.

:: 3. OBS STUDIO KONTROLU VE BASLATMA
echo.
echo [3/3] OBS Studio Kontrol Ediliyor...
tasklist | findstr /i "%OBS_EXE%" >nul
if %ERRORLEVEL% equ 0 (
    echo       [OK] OBS Studio acik ve aktif durumda.
) else (
    echo       [!] OBS Studio calismiyor. Otomatik aciliyor...
    start "" /d "%OBS_DIR%" "%OBS_DIR%\%OBS_EXE%"
    echo       [OK] OBS Studio baslatildi!
)

echo.
echo ===================================================================
echo   ⚡ HER SEY HAZIR! ⚡
echo   - 3D Dunya Kuresi: http://localhost:3005 (Aktif)
echo   - OBS Tarayici Goruntusu: Senkronize Edildi
echo   - Bu pencereyi kapatabilirsiniz, yayin kesintisiz devam eder.
echo ===================================================================
echo.
ping -n 4 127.0.0.1 >nul
exit
