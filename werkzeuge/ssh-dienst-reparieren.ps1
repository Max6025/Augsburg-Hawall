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

# KEIN frueher Ausstieg, wenn der Dienst laeuft -- und das war der Fehler der ersten beiden
# Fassungen. Sie schrieben "laeuft bereits, es gibt nichts zu tun" und beendeten sich, womit
# der ganze Netzteil (Lauschadresse, Netzprofil, Firewall) uebersprungen wurde. Genau das ist
# aber die verbleibende Ursache, wenn der Dienst laeuft und trotzdem niemand durchkommt.
#
# "Der Dienst laeuft" beantwortet die Frage "komme ich drauf?" NICHT.
$dienst = Get-Service -Name sshd -ErrorAction SilentlyContinue
$laeuft = ($dienst -and $dienst.Status -eq 'Running')
if ($laeuft) {
  Sagen 'Der Dienst sshd laeuft. Die Registrierung ist also nicht die Ursache.' 'Green'
  Sagen 'Weiter mit dem Netzweg -- dort liegt es dann.' 'Gray'
  Get-Service sshd | Format-List Name, DisplayName, Status, StartType | Out-Host
} elseif ($dienst) {
  Sagen "Dienst ist eingetragen, Status: $($dienst.Status)" 'Yellow'
} else {
  Sagen 'Dienst sshd ist NICHT eingetragen.' 'Yellow'
}

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

# Nur anfassen, was nicht laeuft. Ein laufender Dienst wird nicht neu angemeldet.
if (-not $laeuft) { $laeuft = DienstEinrichten }

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

function ZugangFreiMachen {
  # --- Der Teil, der beim ersten Anlauf gefehlt hat -------------------------------------------
  #
  # Das Skript meldete "sollte gehen", weil etwas auf Port 22 lauschte -- und von aussen kam
  # trotzdem keine Verbindung zustande. Ein lauschender Dienst sagt naemlich NICHTS darueber,
  # ob er auf der Netzwerkadresse lauscht und ob die Firewall jemanden durchlaesst.
  #
  # Drei Dinge muessen zusammenkommen, und jedes einzelne sieht bei Ausfall gleich aus
  # ("Connection timed out"):
  #   1. sshd lauscht auf 0.0.0.0, nicht nur auf 127.0.0.1
  #   2. eine EINGEHENDE Erlaubnis-Regel fuer TCP 22 ist aktiv
  #   3. diese Regel gilt fuer das Profil, in dem das aktuelle Netz steckt

  Titel 'A. Worauf lauscht der Dienst?'
  $lausch = Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue
  if (-not $lausch) {
    Sagen 'Nichts lauscht auf Port 22 -- dann liegt es nicht am Netz.' 'Red'
    return
  }
  $lausch | Select-Object LocalAddress, LocalPort, State | Format-Table -AutoSize | Out-Host
  $adressen = @($lausch | ForEach-Object { $_.LocalAddress })
  $nurLokal = -not ($adressen -contains '0.0.0.0' -or $adressen -contains '::')
  if ($nurLokal) {
    Sagen 'Er lauscht NUR lokal (127.0.0.1 / ::1). Von aussen ist er damit unerreichbar.' 'Yellow'
  } else {
    Sagen 'Er lauscht auf allen Adressen. Gut.' 'Green'
  }

  Titel 'B. Was steht in der sshd_config?'
  $conf = Join-Path $DATEN 'sshd_config'
  $geaendert = $false
  if (Test-Path $conf) {
    $zeilen = Get-Content $conf
    $port = $zeilen | Where-Object { $_ -match '^\s*Port\s+' }
    $listen = $zeilen | Where-Object { $_ -match '^\s*ListenAddress\s+' }
    if ($port) { Sagen ('Port: ' + ($port -join ' | ')) } else { Sagen 'Port: nicht gesetzt (Standard 22)' }
    if ($listen) {
      Sagen ('ListenAddress: ' + ($listen -join ' | ')) 'Yellow'
      # Nur die auf Schleife begrenzten Zeilen stilllegen. Eine bewusst gesetzte
      # ListenAddress auf eine echte Adresse bleibt unberuehrt -- die hat einen Grund.
      $schleife = $listen | Where-Object { $_ -match '127\.0\.0\.1|::1|localhost' }
      if ($schleife) {
        Copy-Item $conf ($conf + '.vor-reparatur') -Force -ErrorAction SilentlyContinue
        $neuZeilen = $zeilen | ForEach-Object {
          if ($_ -match '^\s*ListenAddress\s+' -and $_ -match '127\.0\.0\.1|::1|localhost') {
            '# von ssh-dienst-reparieren.ps1 stillgelegt: begrenzte den Zugang auf dieses Geraet'
            '#' + $_
          } else { $_ }
        }
        Set-Content -Path $conf -Value $neuZeilen -Encoding UTF8
        Sagen 'Auf die Schleifenadresse begrenzte ListenAddress stillgelegt (Sicherung: sshd_config.vor-reparatur).' 'Green'
        $geaendert = $true
      }
    } else { Sagen 'ListenAddress: nicht gesetzt -- er lauscht also auf allen Adressen. Gut.' 'Green' }
  } else { Sagen 'Keine sshd_config gefunden.' 'Yellow' }

  Titel 'C. In welchem Netzprofil steckt das Geraet?'
  $profile = Get-NetConnectionProfile -ErrorAction SilentlyContinue
  if ($profile) {
    $profile | Select-Object Name, InterfaceAlias, NetworkCategory | Format-Table -AutoSize | Out-Host
    Sagen 'Die Firewall-Regel muss fuer DIESE Kategorie gelten.' 'Gray'
  }

  Titel 'D. Firewall-Profile'
  # Der unauffaelligste Grund von allen: Ist im aktiven Profil die Standardregel fuer
  # eingehende Verbindungen "Blockieren" und es gibt keine passende Erlaubnis, laeuft jeder
  # Verbindungsversuch in eine Zeitueberschreitung -- also genau das Bild, das wir sehen.
  Get-NetFirewallProfile -ErrorAction SilentlyContinue |
    Select-Object Name, Enabled, DefaultInboundAction | Format-Table -AutoSize | Out-Host

  Titel 'E. Firewall-Regeln fuer Port 22'
  $alle = @()
  try {
    $alle = Get-NetFirewallRule -Direction Inbound -Enabled True -ErrorAction Stop |
      Where-Object {
        $p = $_ | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
        $p -and ($p.LocalPort -contains '22' -or $p.LocalPort -eq '22')
      }
  } catch { Sagen "Regeln nicht lesbar: $($_.Exception.Message)" 'Yellow' }

  if ($alle) {
    $alle | Select-Object DisplayName, Action, Profile, Enabled | Format-Table -AutoSize | Out-Host
    $blockiert = $alle | Where-Object { $_.Action -eq 'Block' }
    if ($blockiert) {
      Sagen 'ACHTUNG: Es gibt eine BLOCKIEREN-Regel fuer Port 22. Die gewinnt immer gegen jede' 'Red'
      Sagen 'Erlaubnis-Regel. Sie wird hier NICHT angetastet -- wer sie angelegt hat, hatte' 'Red'
      Sagen 'vielleicht einen Grund. Namen bitte weitergeben:' 'Red'
      $blockiert | Select-Object DisplayName, Profile | Format-Table -AutoSize | Out-Host
    }
  } else {
    Sagen 'Keine aktive eingehende Regel fuer Port 22 gefunden. Das ist die Ursache.' 'Yellow'
  }

  Titel 'F. Erlaubnis-Regel sicherstellen (alle Profile)'
  # Eine eigene Regel mit klarem Namen, statt an der von Windows zu drehen: So ist im
  # Nachhinein zu sehen, was von hier kommt -- und sie gilt fuer ALLE Profile, damit ein
  # Wechsel von Privat auf Oeffentlich den Zugang nicht wieder zunagelt.
  $meine = 'Hawall-Eurasburg SSH (Port 22)'
  $vorhanden = Get-NetFirewallRule -DisplayName $meine -ErrorAction SilentlyContinue
  if ($vorhanden) {
    Set-NetFirewallRule -DisplayName $meine -Enabled True -Profile Any -Action Allow -ErrorAction SilentlyContinue
    Sagen 'Eigene Regel war schon da, auf alle Profile gestellt.' 'Green'
  } else {
    try {
      New-NetFirewallRule -DisplayName $meine -Direction Inbound -Protocol TCP -LocalPort 22 `
        -Action Allow -Profile Any -Enabled True `
        -Description 'Eingehender SSH-Zugang, angelegt von ssh-dienst-reparieren.ps1' -ErrorAction Stop | Out-Null
      Sagen 'Eigene Erlaubnis-Regel fuer alle Profile angelegt.' 'Green'
    } catch {
      Sagen "Regel nicht anlegbar: $($_.Exception.Message)" 'Red'
    }
  }
  # Die Windows-eigene Regel, falls vorhanden, ebenfalls auf alle Profile stellen.
  if (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue) {
    Set-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -Enabled True -Profile Any -ErrorAction SilentlyContinue
    Sagen 'Windows-Regel OpenSSH-Server-In-TCP aktiv und auf alle Profile gestellt.' 'Green'
  }

  if ($geaendert) {
    Titel 'G. Dienst neu starten (die Konfiguration wurde geaendert)'
    try {
      Restart-Service sshd -Force -ErrorAction Stop
      Sagen 'Neu gestartet.' 'Green'
      Start-Sleep -Seconds 2
    } catch { Sagen "Neustart fehlgeschlagen: $($_.Exception.Message)" 'Red' }
  }
}

ZugangFreiMachen

function GegenAusfallAbsichern {
  # --- Der Teil, der DIESES Skript vorher nicht hatte -----------------------------------------
  #
  # Am 2026-09-23 auf dem Surface Go nachgemessen: `sc qfailure sshd` meldete
  # RESET_PERIOD 0 und KEINE Aktionen. Der Dienst lief, war auf Automatisch gestellt -- und
  # waere er abgestuerzt, haette ihn niemand neu gestartet. Von aussen sieht das aus wie ein
  # Geraet ohne Netz, und man merkt es erst, wenn man draufmuss.
  #
  # LAEUFT IMMER, auch wenn der Dienst schon laeuft. Die Schritte 1-7 oben werden uebersprungen,
  # sobald sshd laeuft ("Nur anfassen, was nicht laeuft") -- und genau dort stand bisher der
  # Starttyp. Wer nur einen laufenden Dienst hatte, bekam die Absicherung deshalb nie. Das ist
  # derselbe Fehler, an dem die erste Fassung dieses Skripts schon einmal vorbeigelaufen ist.

  Titel 'H. Gegen erneutes Ausfallen absichern'

  try {
    $d = Get-Service -Name sshd -ErrorAction Stop
    if ($d.StartType -ne 'Automatic') {
      Set-Service -Name sshd -StartupType Automatic -ErrorAction Stop
      Sagen 'Starttyp auf Automatisch gestellt.' 'Green'
    } else {
      Sagen 'Starttyp ist Automatisch.' 'Green'
    }
  } catch {
    Sagen "Starttyp nicht pruefbar: $($_.Exception.Message)" 'Yellow'
    return
  }

  # Nach 5 s, nach 20 s, nach 60 s. Danach greift der Zaehler erst nach einem Tag wieder, damit
  # ein dauerhaft kaputter Dienst nicht in einer Endlosschleife neu gestartet wird.
  $vorher = (sc.exe qfailure sshd 2>&1 | Out-String)
  sc.exe failure sshd reset= 86400 actions= restart/5000/restart/20000/restart/60000 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Sagen 'Wiederherstellung gesetzt: Neustart nach 5 s, 20 s, 60 s.' 'Green'
  } else {
    Sagen "Wiederherstellung nicht setzbar (Code $LASTEXITCODE)." 'Yellow'
  }

  # OHNE DAS greift die Wiederherstellung nur bei einem ABSTURZ. Beendet sich sshd mit einem
  # Fehlercode -- der haeufigere Fall, etwa bei einer kaputten sshd_config --, gilt das fuer
  # Windows nicht als Absturz, und es passiert nichts.
  sc.exe failureflag sshd 1 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Sagen 'Gilt auch, wenn der Dienst sich mit einem Fehler beendet.' 'Green'
  } else {
    Sagen "Fehler-Kennzeichen nicht setzbar (Code $LASTEXITCODE)." 'Yellow'
  }

  # Nicht dem Rueckgabewert glauben, sondern nachlesen -- dieselbe Regel wie bei powercfg.
  $nachher = (sc.exe qfailure sshd 2>&1 | Out-String)
  if ($nachher -match 'RESTART') {
    Sagen 'Nachgelesen: Es stehen jetzt Neustart-Aktionen drin.' 'Green'
  } else {
    Sagen 'Nachgelesen: Es stehen KEINE Aktionen drin. Dann hat es nicht gegriffen.' 'Red'
    Write-Host $nachher
  }
}

GegenAusfallAbsichern

Titel 'Ergebnis'

$d = Get-Service -Name sshd -ErrorAction SilentlyContinue
if ($d) { Get-Service sshd | Format-List Name, DisplayName, Status, StartType }

# Nicht dem Rückgabewert glauben, sondern nachsehen, ob wirklich jemand lauscht.
$lauscht = Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue
if ($lauscht) {
  # BEWUSST vorsichtig formuliert. Der erste Anlauf schrieb hier "der Zugang sollte gehen",
  # und von aussen kam trotzdem nichts durch -- ein lauschender Dienst ist kein erreichbarer.
  Sagen 'Auf Port 22 lauscht etwas. Ob von aussen jemand durchkommt, sagen die Abschnitte A bis F.' 'Green'
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
Write-Host 'Die Abschnitte A bis F sind der interessante Teil -- davon bitte einen Screenshot.' -ForegroundColor Cyan
Write-Host 'Fertig. Fenster kann geschlossen werden.' -ForegroundColor Cyan
