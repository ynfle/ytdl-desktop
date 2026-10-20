/**
 * Custom NSIS installer hook for YTDL Desktop (Windows).
 *
 * Adds a second directory picker step ("Choose Data Directory") right after the
 * application install directory page, defaulting to `%USERPROFILE%\ytdl-desktop`
 * (or existing `%USERPROFILE%\YTDL-Desktop`), creates the folder + `videos/`,
 * and writes `%APPDATA%\YTDL Desktop\ytdl-config.json` during installation.
 * That folder is Electron `userData` for productName "YTDL Desktop" (not `ytdl-desktop`).
 */
!ifndef BUILD_UNINSTALLER
  Var /GLOBAL ytdlDataDir

  !macro customPageAfterChangeDir
    !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
      !undef MUI_PAGE_CUSTOMFUNCTION_PRE
    !endif

    Function ytdlDataDirPagePre
      ${if} ${isUpdated}
        Abort
      ${endif}

      ${If} $ytdlDataDir == ""
        ReadRegStr $ytdlDataDir HKCU "Software\com.ytdl.desktop" "DataDir"
      ${EndIf}

      ${If} $ytdlDataDir == ""
        ${If} ${FileExists} "$PROFILE\ytdl-desktop\channels.txt"
        ${OrIf} ${FileExists} "$PROFILE\ytdl-desktop\videos"
          StrCpy $ytdlDataDir "$PROFILE\ytdl-desktop"
        ${ElseIf} ${FileExists} "$PROFILE\YTDL-Desktop\channels.txt"
        ${OrIf} ${FileExists} "$PROFILE\YTDL-Desktop\videos"
          StrCpy $ytdlDataDir "$PROFILE\YTDL-Desktop"
        ${Else}
          StrCpy $ytdlDataDir "$PROFILE\ytdl-desktop"
        ${EndIf}
      ${EndIf}
    FunctionEnd

    !define MUI_PAGE_CUSTOMFUNCTION_PRE ytdlDataDirPagePre
    !define MUI_PAGE_HEADER_TEXT "Choose Data Directory"
    !define MUI_PAGE_HEADER_SUBTEXT "Choose where YTDL Desktop stores your subscriptions and downloaded media."
    !define MUI_DIRECTORYPAGE_TEXT_TOP "YTDL Desktop will store channels.txt, playlists.txt, podcasts.txt, download archives, and your videos/ library in the following folder.$\r$\n$\r$\nTo use a different folder, click Browse and select another folder. Click Install to start the installation."
    !define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Data Directory"
    !define MUI_DIRECTORYPAGE_VARIABLE $ytdlDataDir
    !insertmacro MUI_PAGE_DIRECTORY

    # MUI_PAGE_DIRECTORY consumes and !undefs MUI_PAGE_CUSTOMFUNCTION_PRE.
    # A bare !undef warns (6155), and makensis treats warnings as errors.
    # Restore instFilesPre so the install page still appends the app folder to $INSTDIR.
    !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
      !undef MUI_PAGE_CUSTOMFUNCTION_PRE
    !endif
    !ifdef allowToChangeInstallationDirectory
      !define MUI_PAGE_CUSTOMFUNCTION_PRE instFilesPre
    !endif
  !macroend

  !macro customInstall
    # Updates keep the data dir already stored in userData. Rewriting it here
    # would replace a chosen folder with the default because the page was skipped.
    ${ifNot} ${isUpdated}
      ${If} $ytdlDataDir == ""
        StrCpy $ytdlDataDir "$PROFILE\ytdl-desktop"
      ${EndIf}

      # Ensure data root and videos/ directory exist on disk
      CreateDirectory "$ytdlDataDir"
      CreateDirectory "$ytdlDataDir\videos"

      # Save in HKCU so subsequent installer runs remember the user's choice
      WriteRegStr HKCU "Software\com.ytdl.desktop" "DataDir" "$ytdlDataDir"

      # Escape backslash and quote for JSON.
      StrCpy $R1 $ytdlDataDir
      StrCpy $R2 ""
      StrLen $R3 $R1
      StrCpy $R4 0
      ${While} $R4 < $R3
        StrCpy $R5 $R1 1 $R4
        ${If} $R5 == "\"
          StrCpy $R2 "$R2\\"
        ${ElseIf} $R5 == "$\""
          StrCpy $R2 "$R2\$\""
        ${Else}
          StrCpy $R2 "$R2$R5"
        ${EndIf}
        IntOp $R4 $R4 + 1
      ${EndWhile}

      # Must match Electron userData for productName "YTDL Desktop".
      # Unicode NSIS writes UTF-16LE; the app accepts that encoding.
      SetShellVarContext current
      CreateDirectory "$APPDATA\YTDL Desktop"
      FileOpen $R0 "$APPDATA\YTDL Desktop\ytdl-config.json" w
      ${IfNot} ${Errors}
        FileWrite $R0 "{$\r$\n  $\"dataDir$\": $\"$R2$\"$\r$\n}$\r$\n"
        FileClose $R0
      ${EndIf}
    ${endif}
  !macroend
!endif
