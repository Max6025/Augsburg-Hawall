# OpenSSH-Server auf diesem Gerät wieder anmelden.
#
# ANLASS
#
# Am 2026-09-23 war der SSH-Zugang zum Wandpanel plötzlich weg. Befund: `Get-Service *ssh*`
# zeigte nur den ssh-agent (das ist der CLIENT-Agent für ausgehende Verbindungen, für
# eingehende bedeutungslos), `sshd` fehlte in der Dienstliste - aber
# %SystemRoot%\System32\OpenSSH\sshd.exe war da.
#
# Also nicht deinstalliert, sondern nur die Dienst-Registrierung verloren. Das passiert bei
# Windows-Funktions-Updates: Die Dateien bleiben, der Eintrag im Dienstverzeichnis geht mit.
# Ein Neustart hilft dagegen NICHT - Windows kann nichts starten, was nicht eingetragen ist.
#
# WAS DIESES SKRIPT TUT
#
#   1. Nachsehen. Läuft der Dienst schon, wird nichts angefasst.
#   2. Sichern. C:\ProgramData\ssh (Konfiguration, Rechnerschlüssel,
#      administrators_authorized_keys) wird ins Benutzerprofil kopiert, BEVOR etwas geändert
#      wird. Dort liegen die hinterlegten Schlüssel - die will niemand verlieren.
#   3. Den Dienst anmelden (New-Service). Der schonende Weg: Es wird nichts entfernt.
#   4. Fehlt die Konfiguration oder ein Rechnerschlüssel, wird beides angelegt.
#   5. Firewall-Regel für Port 22 prüfen und bei Bedarf anlegen.
#   6. Auf "Automatisch" stellen und starten.
#   7. Nur wenn der Start scheitert: Das Windows-Feature aus- und wieder einbauen. Dieser Weg
#      ist gründlicher und greift tiefer ein, deshalb steht er hinten und nicht vorn.
#   8. Zum Schluss prüfen, ob wirklich etwas auf Port 22 lauscht - und nicht dem
#      Rückgabewert glauben.
#
# Mehrfaches Ausführen ist gefahrlos: Jeder Schritt sieht erst nach, ob er nötig ist.

# KODIERUNG: Diese Datei ist UTF-8 MIT BOM gespeichert, und das muss so bleiben.
# Windows PowerShell 5.1 -- das ist die Fassung, die auf dem Panel laeuft -- liest eine .ps1
# ohne BOM als ANSI. Jeder Umlaut in den Meldungen wird dann zu Kauderwelsch, und im
# schlimmsten Fall bricht die Datei mitten in einer Zeichenkette ab. Wer sie in einem Editor
# nachbearbeitet, achtet auf "UTF-8 mit BOM".

$ErrorActionPreference = 'Continue'

function Sagen($text, $farbe = 'Gray') { Write-Host $text -ForegroundColor $farbe }
function Titel($text) { Write-Host ''; Write-Host $text -ForegroundColor Cyan }

$OPENSSH = Join-Path $env:SystemRoot 'System32\OpenSSH'
$SSHD = Join-Path $OPENSSH 'sshd.exe'
$DATEN = Join-Path $env:ProgramData 'ssh'

Titel '1. Lage prüfen'

$dienst = Get-Service -Name sshd -ErrorAction SilentlyContinue
if ($dienst -and $dienst.Status -eq 'Running') {
  Sagen 'Der Dienst sshd läuft bereits. Es gibt nichts zu tun.' 'Green'
  Get-Service sshd | Format-List Name, DisplayName, Status, StartType
  return
}
if ($dienst) { Sagen "Dienst ist eingetragen, Status: $($dienst.Status)" 'Yellow' }
else { Sagen 'Dienst sshd ist NICHT eingetragen.' 'Yellow' }

if (-not (Test-Path $SSHD)) {
  Sagen "sshd.exe fehlt ($SSHD)." 'Yellow'
  Sagen 'Das Programm ist also auch weg - dann hilft nur der gründliche Weg (Schritt 7).' 'Yellow'
} else {
  Sagen "sshd.exe ist vorhanden: $SSHD" 'Green'
}

Titel '2. Schlüssel und Konfiguration sichern'

if (Test-Path $DATEN) {
  $ziel = Join-Path $env:USERPROFILE ('ssh-daten-sicherung-' + (Get-Date -Format 'yyyyMMdd-HHmm'))
  try {
    Copy-Item $DATEN $ziel -Recurse -Force -ErrorAction Stop
    Sagen "Gesichert nach: $ziel" 'Green'
    $wichtig = Join-Path $DATEN 'administrators_authorized_keys'
    if (Test-Path $wichtig) { Sagen 'administrators_authorized_keys ist dabei.' 'Green' }
  } catch {
    Sagen "Sicherung nicht möglich: $($_.Exception.Message)" 'Yellow'
    Sagen 'Es wird trotzdem weitergemacht - Schritt 3 entfernt nichts.' 'Yellow'
  }
} else {
  Sagen "$DATEN gibt es nicht - es ist also auch nichts zu sichern." 'Gray'
}

function DienstEinrichten {
  Titel '3. Dienst anmelden'
  if (Get-Service -Name sshd -ErrorAction SilentlyContinue) {
    Sagen 'Eintrag ist schon da, wird nicht neu angelegt.' 'Gray'
  } elseif (Test-Path $SSHD) {
    try {
      New-Service -Name sshd -BinaryPathName "`"$SSHD`"" `
        -DisplayName 'OpenSSH SSH Server' -StartupType Automatic `
        -Description 'SSH-Zugang zu diesem Gerät (OpenSSH Server).' -ErrorAction Stop | Out-Null
      Sagen 'Dienst angemeldet.' 'Green'
    } catch {
      Sagen "Anmelden fehlgeschlagen: $($_.Exception.Message)" 'Red'
    }
  } else {
    Sagen 'Ohne sshd.exe lässt sich kein Dienst anmelden.' 'Yellow'
  }

  Titel '4. Konfiguration und Rechnerschlüssel'
  if (-not (Test-Path $DATEN)) { New-Item -ItemType Directory -Path $DATEN -Force | Out-Null }
  $conf = Join-Path $DATEN 'sshd_config'
  $vorlage = Join-Path $OPENSSH 'sshd_config_default'
  if (-not (Test-Path $conf)) {
    if (Test-Path $vorlage) {
      Copy-Item $vorlage $conf -Force
      Sagen 'sshd_config aus der Windows-Vorlage angelegt.' 'Green'
    } else {
      Sagen 'Keine sshd_config und keine Vorlage gefunden.' 'Yellow'
    }
  } else { Sagen 'sshd_config ist vorhanden.' 'Green' }

  if (-not (Get-ChildItem $DATEN -Filter 'ssh_host_*_key' -ErrorAction SilentlyContinue)) {
    $keygen = Join-Path $OPENSSH 'ssh-keygen.exe'
    if (Test-Path $keygen) {
      & $keygen -A | Out-Null
      Sagen 'Rechnerschlüssel erzeugt.' 'Green'
      Sagen 'ACHTUNG: Der Fingerabdruck des Geräts ist damit neu. Beim nächsten Verbinden' 'Yellow'
      Sagen 'meldet der Client eine geänderte Kennung - das ist dann kein Angriff.' 'Yellow'
    }
  } else { Sagen 'Rechnerschlüssel sind vorhanden - der Fingerabdruck bleibt gleich.' 'Green' }

  Titel '5. Firewall'
  $regel = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
  if ($regel) {
    # `Enabled` ist ein Aufzaehlungstyp (True/False), kein Wahrheitswert: `-not` darauf
    # ist nicht verlaesslich, deshalb der ausdrueckliche Vergleich.
    if ($regel.Enabled -ne 'True') { Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP'; Sagen 'Regel war aus, ist jetzt an.' 'Green' }
    else { Sagen 'Regel ist vorhanden und aktiv.' 'Green' }
  } else {
    try {
      New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' `
        -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction Stop | Out-Null
      Sagen 'Regel für Port 22 angelegt.' 'Green'
    } catch {
      Sagen "Regel konnte nicht angelegt werden: $($_.Exception.Message)" 'Yellow'
    }
  }

  Titel '6. Starten'
  try {
    Set-Service -Name sshd -StartupType Automatic -ErrorAction Stop
    Sagen 'Starttyp: Automatisch - er kommt nach jedem Neustart von selbst mit.' 'Green'
  } catch { Sagen "Starttyp nicht setzbar: $($_.Exception.Message)" 'Yellow' }
  try {
    Start-Service -Name sshd -ErrorAction Stop
    Sagen 'Dienst gestartet.' 'Green'
  } catch { Sagen "Start fehlgeschlagen: $($_.Exception.Message)" 'Red' }

  $d = Get-Service -Name sshd -ErrorAction SilentlyContinue
  return ($d -and $d.Status -eq 'Running')
}

$laeuft = DienstEinrichten

if (-not $laeuft) {
  Titel '7. Gründlicher Weg: Windows-Feature aus- und wieder einbauen'
  Sagen 'Der schonende Weg hat nicht gereicht. Jetzt wird das optionale Feature neu gebaut.' 'Yellow'
  try {
    $feature = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' -ErrorAction Stop
    Sagen "Feature-Status: $($feature.State)"
    if ($feature.State -eq 'Installed') {
      Remove-WindowsCapability -Online -Name $feature.Name -ErrorAction Stop | Out-Null
      Sagen 'Feature entfernt.'
    }
    Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' -ErrorAction Stop | Out-Null
    Sagen 'Feature eingebaut.' 'Green'
    $laeuft = DienstEinrichten
  } catch {
    Sagen "Feature-Weg fehlgeschlagen: $($_.Exception.Message)" 'Red'
  }
}

Titel 'Ergebnis'

$d = Get-Service -Name sshd -ErrorAction SilentlyContinue
if ($d) { Get-Service sshd | Format-List Name, DisplayName, Status, StartType }

# Nicht dem Rückgabewert glauben, sondern nachsehen, ob wirklich jemand lauscht.
$lauscht = Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue
if ($lauscht) {
  Sagen 'Auf Port 22 lauscht jetzt etwas. Der Zugang sollte gehen.' 'Green'
  $lauscht | Select-Object LocalAddress, LocalPort, State | Format-Table -AutoSize
  Sagen ''
  Sagen ('Zum Verbinden: ssh ' + $env:USERNAME + '@' + (
    (Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
      Select-Object -First 1 -ExpandProperty IPAddress)))
} else {
  Sagen 'Es lauscht nichts auf Port 22. Der Dienst läuft also nicht wirklich.' 'Red'
  Sagen 'Die Zeilen oben sagen, an welchem Schritt es lag - die bitte weitergeben.' 'Red'
}

Write-Host ''
Write-Host 'Fertig. Fenster kann geschlossen werden.' -ForegroundColor Cyan
