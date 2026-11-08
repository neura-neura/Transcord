; Only Transcord's executable can block a Transcord installation or removal.
; The upstream path-prefix check can report another app in the selected directory.
!include "nsProcess.nsh"

!macro customCheckAppRunning
  IfFileExists "$INSTDIR\vesktop.exe" 0 +3
    MessageBox MB_OK|MB_ICONSTOP "Choose a separate folder for Transcord. This folder contains Vesktop." /SD IDOK
    Abort

  transcordCheck:
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${nsProcess::Unload}
    ${If} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Transcord is running. Quit Transcord from its tray menu, then click Retry." /SD IDCANCEL IDRETRY transcordCheck
      Abort
    ${EndIf}
!macroend
