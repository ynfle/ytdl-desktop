/**
 * Custom NSIS installer hook for YTDL Desktop (Windows).
 *
 * Adds a second directory picker step ("Choose Data Directory") right after the
 * application install directory page, defaulting to `%USERPROFILE%\ytdl-desktop`
 * (or existing `%USERPROFILE%\YTDL-Desktop`), creates the folder + `videos/`,
 * and writes `%APPDATA%\YTDL Desktop\ytdl-config.json` during installation.
 * That folder is Electron `userData` for productName "YTDL Desktop" (not `ytdl-desktop`).
 *
 * Upgrades into the same install folder replace application files in place.
 * The previous uninstaller is not run, so Start menu shortcuts and taskbar
 * pins stay. Choosing a different install folder still uninstalls the old copy.
 */
!ifndef BUILD_UNINSTALLER
  Var /GLOBAL ytdlDataDir
  # InstallLocation from the previous install, captured before directory pages change $INSTDIR.
  Var /GLOBAL ytdlExistingInstallDir
  # "1" when this run overwrites the previous install folder instead of uninstalling it.
  Var /GLOBAL ytdlPathsMatch

  # Append one installer line to the details pane and to %TEMP%\ytdl-desktop-installer.log.
  Function ytdlLog
    Exch $R0
    Push $R1
    ClearErrors
    FileOpen $R1 "$TEMP\ytdl-desktop-installer.log" a
    IfErrors ytdlLogDone
    FileWrite $R1 "$R0$\r$\n"
    FileClose $R1
    ytdlLogDone:
    Pop $R1
    Pop $R0
  FunctionEnd

  !macro ytdlLogLine MESSAGE
    DetailPrint "${MESSAGE}"
    Push "${MESSAGE}"
    Call ytdlLog
  !macroend

  # Long path, without one trailing slash (except a drive root such as C:\).
  # InstallLocation and $INSTDIR can differ by an 8.3 name or a trailing backslash.
  # Uses StrCmp rather than LogicLib: this file is included before LogicLib.nsh.
  Function ytdlNormalizeDir
    Exch $0
    Push $1
    Push $2
    StrCpy $1 $0 1 -1
    StrCmp $1 "\" 0 ytdlNormLong
    StrLen $2 $0
    IntCmp $2 4 ytdlNormTrim 0 ytdlNormTrim
    Goto ytdlNormLong
    ytdlNormTrim:
      StrCpy $0 $0 -1
    ytdlNormLong:
      ClearErrors
      System::Call 'kernel32::GetLongPathNameW(w r0, w .r1, i ${NSIS_MAX_STRLEN}) i.r2'
      IntCmp $2 0 ytdlNormStrip ytdlNormStrip ytdlNormCopy
    ytdlNormCopy:
      StrCpy $0 $1
    ytdlNormStrip:
      StrCpy $1 $0 1 -1
      StrCmp $1 "\" 0 ytdlNormDone
      StrLen $2 $0
      IntCmp $2 4 ytdlNormTrim2 0 ytdlNormTrim2
      Goto ytdlNormDone
    ytdlNormTrim2:
      StrCpy $0 $0 -1
    ytdlNormDone:
      Pop $2
      Pop $1
      Exch $0
  FunctionEnd

  # If this root's InstallLocation is the folder we are installing into, remove
  # its UninstallString. uninstallOldVersion then returns without deleting files
  # or calling WinShell::UninstAppUserModelId (that call drops the taskbar pin).
  !macro ytdlConsiderInstallRoot ROOT
    ClearErrors
    ReadRegStr $1 ${ROOT} "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    # A failed read must not reuse the previous root's path.
    ${If} ${Errors}
      StrCpy $1 ""
      ClearErrors
    ${EndIf}
    # Older or partial registrations may only have the uninstall command.
    ${If} $1 == ""
      ClearErrors
      ReadRegStr $4 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
      ${If} ${Errors}
        StrCpy $4 ""
        ClearErrors
      ${EndIf}
      ${If} $4 != ""
        Push $4
        Call GetInQuotes
        Pop $4
        ${If} $4 != ""
          Push $4
          Call GetFileParent
          Pop $1
          !insertmacro ytdlLogLine "${ROOT}: InstallLocation empty. Using uninstaller folder '$1'."
        ${EndIf}
      ${EndIf}
    ${EndIf}
    ${If} $1 != ""
      # Remember any registered path for the summary log. $3 is not used by ytdlLog.
      StrCpy $3 $1
      Push $INSTDIR
      Call ytdlNormalizeDir
      Pop $0
      Push $1
      Call ytdlNormalizeDir
      Pop $1
      !insertmacro ytdlLogLine "${ROOT}: comparing install '$0' with registered '$1'."

      System::Call 'kernel32::lstrcmpiW(w "$0", w "$1") i.r2'
      ${If} $2 == 0
        StrCpy $ytdlPathsMatch "1"
        DeleteRegValue ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
        DeleteRegValue ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"
        !ifdef UNINSTALL_REGISTRY_KEY_2
          DeleteRegValue ${ROOT} "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
          DeleteRegValue ${ROOT} "${UNINSTALL_REGISTRY_KEY_2}" "QuietUninstallString"
        !endif
        !insertmacro ytdlLogLine "Matched ${ROOT} install '$1'. Skipping that uninstaller so the taskbar pin stays."
      ${Else}
        !insertmacro ytdlLogLine "${ROOT} install '$1' is a different folder than '$0'."
      ${EndIf}
    ${Else}
      !insertmacro ytdlLogLine "${ROOT}: no previous InstallLocation."
    ${EndIf}
  !macroend

  # Check per-user and per-machine registrations against the final $INSTDIR.
  !macro ytdlSkipUninstallIfSameDir
    StrCpy $ytdlPathsMatch "0"
    StrCpy $3 ""
    !insertmacro ytdlLogLine "YTDL Desktop installer: target folder '$INSTDIR'."
    !insertmacro ytdlConsiderInstallRoot HKCU
    !insertmacro ytdlConsiderInstallRoot HKLM

    ${If} $ytdlPathsMatch == "1"
      !insertmacro ytdlLogLine "In-place upgrade: application files in '$INSTDIR' will be replaced. Shortcuts stay."
    ${ElseIf} $3 == ""
      !insertmacro ytdlLogLine "Fresh install: no previous installation is registered."
    ${Else}
      !insertmacro ytdlLogLine "Install folder changed from '$3'. The previous installation will be uninstalled."
    ${EndIf}
  !macroend

  # Inserted from .onInit, after the previous install path has been loaded into $INSTDIR.
  !macro customInit
    StrCpy $ytdlPathsMatch "0"
    StrCpy $ytdlExistingInstallDir ""
    ReadRegStr $ytdlExistingInstallDir SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    !insertmacro ytdlLogLine "customInit: registered install location '$ytdlExistingInstallDir'."

    # Silent installs never call page pre-functions, and $INSTDIR is already final.
    ${If} ${Silent}
      !insertmacro ytdlLogLine "customInit: silent install, deciding in-place upgrade now."
      !insertmacro ytdlSkipUninstallIfSameDir
    ${EndIf}
  !macroend

  # Inserted after the directory page is compiled and before installUtil.nsh.
  # allowToChangeInstallationDirectory makes electron-builder recreate shortcuts
  # on a normal setup.exe run (it only keeps them for --updated). Undefining it
  # here leaves the directory page in place and lets an existing install keep
  # its shortcuts when the exe is still in the chosen folder.
  !macro customHeader
    !ifdef allowToChangeInstallationDirectory
      !undef allowToChangeInstallationDirectory
      !echo "YTDL Desktop: same-folder upgrades keep shortcuts (taskbar pin stays)"
    !endif
  !macroend

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
    # Point the install page at ytdlInstFilesPre, which still appends the app
    # folder to $INSTDIR and then decides whether this is an in-place upgrade.
    !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
      !undef MUI_PAGE_CUSTOMFUNCTION_PRE
    !endif

    Function ytdlInstFilesPre
      # instFilesPre exists only when the directory page is enabled. This
      # !ifdef is resolved when customPageAfterChangeDir is inserted, which
      # is before customHeader undefines allowToChangeInstallationDirectory.
      !ifdef allowToChangeInstallationDirectory
        Call instFilesPre
      !endif
      !insertmacro ytdlLogLine "ytdlInstFilesPre: install page starting for '$INSTDIR'."
      !insertmacro ytdlSkipUninstallIfSameDir
    FunctionEnd

    !define MUI_PAGE_CUSTOMFUNCTION_PRE ytdlInstFilesPre
  !macroend

  !macro customInstall
    ${If} $ytdlPathsMatch == "1"
      !insertmacro ytdlLogLine "customInstall: overwriting application files in '$INSTDIR'."
    ${Else}
      !insertmacro ytdlLogLine "customInstall: installing into '$INSTDIR'."
    ${EndIf}

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
