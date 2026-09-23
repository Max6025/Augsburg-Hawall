; Modern Standby am Geraet abschalten.
;
; Warum ueberhaupt: Auf einem Modern-Standby-Geraet ist das ABSCHALTEN DES BILDSCHIRMS der
; Ausloeser fuer den Standby -- kein Leerlauf-Timeout. Gemessen am 2026-09-22 auf dem Surface Go:
; In derselben Sekunde, in der die Nachtsperre das Panel abschaltete, begann Connected Standby
; (Kernel-Power 506). Eine ES_SYSTEM_REQUIRED-Anforderung haelt diesen Uebergang nicht auf, und
; gegen den Desktop Activity Moderator, der kurz darauf die Anwendung suspendiert, hilft sie
; auch nicht. Folge: Nachts ist der Setup-Server weg, der Waechter steht, und die Regel
; "Beruehrung pausiert zwei Minuten" kann nicht feuern, weil sie im Takt lebt.
;
; PlatformAoAcOverride = 0 schaltet Modern Standby ab; das Geraet nutzt danach klassischen
; S3-Schlaf, und ES_SYSTEM_REQUIRED greift wieder. Wirksam wird es erst nach einem NEUSTART.
;
; ZWEI DINGE, DIE HIER BEWUSST SO SIND:
;
; 1. KEIN UAC-Dialog, niemals. Der Wert liegt unter HKLM und braucht erhoehte Rechte, die eine
;    Per-User-Installation nicht hat. Trotzdem wird hier nicht nachgefragt: Ein Update laeuft
;    still (electron-updater ruft den Installer mit /S), und ein UAC-Dialog auf einem Wandpanel,
;    vor dem niemand steht, waere ein Update, das fuer immer haengt. Klappt der Schreibzugriff
;    nicht, uebernimmt die App -- sie fragt genau dann nach, wenn jemand vor dem Geraet steht
;    (siehe control/modernstandby.js).
; 2. Der Wert wird beim Deinstallieren wieder entfernt. Was der Installer am System aendert,
;    nimmt er zurueck; ein Geraet soll nicht dauerhaft anders schlafen, weil hier mal eine
;    Anwendung lag.

!include "LogicLib.nsh"

; Riegel gegen doppeltes Einbinden: Ein zweites !define waere ein Compilerfehler, und ein
; Compilerfehler hier heisst: kein Release. Die Kosten dafuer sind zwei Zeilen.
!ifndef AOAC_SCHLUESSEL
  !define AOAC_SCHLUESSEL "SYSTEM\CurrentControlSet\Control\Power"
  !define AOAC_WERT "PlatformAoAcOverride"
!endif

!macro customInstall
  ClearErrors
  ReadRegDWORD $0 HKLM "${AOAC_SCHLUESSEL}" "${AOAC_WERT}"
  ${If} ${Errors}
  ${OrIf} $0 != 0
    ; Nur der direkte Weg. Gelingt er, lief der Installer eleviert (manueller Start oder
    ; perMachine) -- dann ist es hier erledigt und die App muss nicht mehr nachfragen.
    ClearErrors
    WriteRegDWORD HKLM "${AOAC_SCHLUESSEL}" "${AOAC_WERT}" 0
    ${If} ${Errors}
      DetailPrint "Modern Standby konnte nicht abgeschaltet werden (keine erhoehten Rechte) -- die App fragt spaeter nach."
    ${Else}
      DetailPrint "Modern Standby abgeschaltet -- wirksam nach dem naechsten Neustart."
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ClearErrors
  DeleteRegValue HKLM "${AOAC_SCHLUESSEL}" "${AOAC_WERT}"
  ${If} ${Errors}
    DetailPrint "Modern Standby blieb abgeschaltet (keine erhoehten Rechte zum Zuruecknehmen)."
  ${EndIf}
!macroend
