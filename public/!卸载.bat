@ECHO OFF&PUSHD %~DP0 &TITLE 卸载
Rd "%WinDir%\system32\test_permissions" >NUL 2>NUL
Md "%WinDir%\System32\test_permissions" 2>NUL||(Echo 请使用右键管理员身份运行！&&PAUSE >NUL&&EXIT)
Rd "%WinDir%\System32\test_permissions" 2>NUL
SetLocal EnableDelayedExpansion

taskkill /f /im TXP* >NUL 2>NUL
taskkill /f /im tad* >NUL 2>NUL
taskkill /f /im QQP* >NUL 2>NUL
taskkill /f /im QQC* >NUL 2>NUL
taskkill /f /im QQ.exe >NUL 2>NUL

rd/s/q "%ProgramData%\QQPet"2>NUL
rd/s/q "%AppData%\Tencent\QQ"2>NUL
rd/s/q "%AppData%\QXiu Files"2>NUL
rd/s/q "%AppData%\Tencent\TXSSO"2>NUL
rd/s/q "%AppData%\Tencent\STemp"2>NUL
rd/s/q "%AppData%\Tencent\Users"2>NUL
rd/s/q "%AppData%\Tencent\QTalk"2>NUL
rd/s/q "%AppData%\QQAppAssistant"2>NUL
rd/s/q "%AppData%\Tencent\QQMiniDL"2>NUL
rd/s/q "%AppData%\Tencent\DeskUpdate"2>NUL
rd/s/q "%AppData%\Tencent\QzoneMusic"2>NUL
rd/s/q "%AppData%\Tencent\AndroidAssist"2>NUL
rd/s/q "%AppData%\Tencent\QQPhoneManager"2>NUL
rd/s/q "%ProgramData%\Tencent\QQProtect" 2>NUL
rd/s/q "%UserProFile%\AppData\LocalLow\QQMiniDL"2>NUL
rd/s/q "%UserProfile%\AppData\Local\Tencent\Misc"2>NUL
rd/s/q "%AllUsersProfile%\Application Data\QQPet"2>NUL
rd/s/q "%UserProfile%\AppData\Local\Tencent\QQPet"2>NUL
rd/s/q "%USERPROFILE%\Local Settings\Tencent\QQPet"2>NUL
rd/s/q "%USERPROFILE%\Local Settings\QQKartLiveUpdate"2>NUL
rd/s/q "%AllUsersProfile%\Application Data\Tencent\QQProtect"2>NUL
rd/s/q "%CommonProgramFiles%\Tencent\QQProtect"2>NUL
rd/s/q "%CommonProgramFiles(x86)%\Tencent\QQProtect"2>NUL
for /f "skip=2 tokens=3 delims= " %%i in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" /v personal') do (
       for /f "delims=*" %%j in ('echo %%i') do rd/s/q "%%j\Tencent Files\All Users\QQ\Misc\OperateFace" 2>NUL)
       
regsvr32 /s /u Bin\TXSSO\Bin\SSOCommon.dll
regsvr32 /s /u Bin\TXSSO\Npchrome\npactivex.dll
regsvr32 /s /u Bin\TXSSO\Bin\npSSOAxCtrlForPTLogin.dll
if exist Bin\Timwp.dll regsvr32 /s /u Bin\Timwp.dll
if exist Bin\AppCom.dll regsvr32 /s /u Bin\AppCom.dll
if exist Bin\CPHelper.dll regsvr32 /s /u Bin\CPHelper.dll
if exist Bin\TXPFProxy.dll regsvr32 /s /u Bin\TXPFProxy.dll
if exist Bin\KernelUtil.dll regsvr32 /s /u Bin\KernelUtil.dll
if exist Bin\DownloadProxyPS.dll regsvr32 /s /u Bin\DownloadProxyPS.dll
if exist Bin\TXPlatform.exe Bin\TXPlatform.exe /UnregServer
regsvr32 /s /u Plugin\Com.Tencent.NetDisk\Bin\QQDisk\Bin\TXFTNActiveX.dll
if not exist "%Windir%\SysWOW64" regsvr32 /s /u "%CommonProgramFiles%\Tencent\TXSSO\Bin\SSOLUIControl.dll"
if exist "%Windir%\SysWOW64" regsvr32 /s /u "%CommonProgramFiles(x86)%\Tencent\TXSSO\Bin\SSOLUIControl.dll"

reg delete HKLM\Software\Classes\QQPet /F>NUL 2>NUL
reg delete HKCU\Software\Tencent\Plugin /F  >NUL 2>NUL
reg delete HKCU\Software\Tencent\QQ2009 /F  >NUL 2>NUL
reg delete HKLM\Software\Tencent\QQ2009 /F  >NUL 2>NUL
reg delete HKCU\Software\Classes\Tencent /F >NUL 2>NUL
reg delete HKLM\Software\Classes\Tencent /F >NUL 2>NUL
reg delete HKCU\Software\Tencent\QQProtect /F>NUL 2>NUL
reg delete HKCU\Software\Classes\EMOTION.File /F    >NUL 2>NUL
reg delete HKCU\Software\Classes\EMOTION.Package /F >NUL 2>NUL
reg delete HKCU\Software\Tencent\AndroidAssistant /F>NUL 2>NUL
reg delete HKLM\SOFTWARE\Wow6432Node\Classes\QQPet /F>NUL 2>NUL
reg delete HKLM\Software\Wow6432Node\Tencent\QQ2009 /F>NUL 2>NUL
reg delete HKLM\Software\Wow6432Node\Classes\Tencent /F>NUL 2>NUL
reg delete HKLM\SYSTEM\CurrentControlSet\services\QQProtect /F>NUL 2>NUL
ECHO.&ECHO 卸载完成，任意键直接退出！ &&PAUSE >NUL && CLS && EXIT