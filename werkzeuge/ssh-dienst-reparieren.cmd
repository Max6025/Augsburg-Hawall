@echo off
rem Doppelklick auf DIESE Datei.
rem
rem Sie holt sich selbst Administratorrechte (einmal "Ja" im Windows-Dialog) und fuehrt
rem ssh-dienst-reparieren.ps1 aus. Eine .ps1 laesst sich nicht doppelklicken -- Windows oeffnet
rem sie im Editor -- und ohne erhoehte Rechte darf niemand einen Dienst anmelden. Deshalb
rem dieser Starter.
rem
rem Das Fenster bleibt am Ende offen, damit die Meldungen lesbar sind.

setlocal
set "SKRIPT=%~dp0ssh-dienst-reparieren.ps1"

if not exist "%SKRIPT%" (
  echo FEHLER: ssh-dienst-reparieren.ps1 liegt nicht neben dieser Datei.
  echo Beide Dateien muessen im selben Ordner sein.
  pause
  exit /b 1
)

rem Laufen wir schon eleviert? net session gelingt nur mit Administratorrechten.
net session >nul 2>&1
if %errorlevel%==0 goto starten

echo Administratorrechte werden angefordert -- bitte im Windows-Dialog mit "Ja" bestaetigen.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b 0

:starten
powershell -NoProfile -ExecutionPolicy Bypass -File "%SKRIPT%"
echo.
pause
