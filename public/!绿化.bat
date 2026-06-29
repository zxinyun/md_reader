@ECHO OFF&PUSHD %~DP0 &TITLE 绿化
Md "%WinDir%\System32\test_permissions" 2>NUL||(Echo.&Echo 请使用右键"以管理员身份运行"!&&Pause >NUL&&Exit)
Rd "%WinDir%\System32\test_permissions" 2>NUL
SetLocal EnableDelayedExpansion

:: 安装前结束相关进程避免清不干净
taskkill /f /im TXP* >NUL 2>NUL
taskkill /f /im tad* >NUL 2>NUL
taskkill /f /im QQP* >NUL 2>NUL
taskkill /f /im QQC* >NUL 2>NUL
taskkill /f /im QQ.exe >NUL 2>NUL

:: 开始清理掉后台相关残留数据文件
del/f/q "%tmp%\*.tvl">NUL 2>NUL
del/f/q "%tmp%\*.tsd">NUL 2>NUL
del/f/q "%tmp%\ts*.dat">NUL 2>NUL
del/f/q "%tmp%\QQSa*.exe">NUL 2>NUL
rd/s/q "%ProgramData%\QQPet"2>NUL
rd/s/q "%AppData%\Tencent\QQ"  2>NUL
rd/s/q "%AppData%\Tencent\Logs"2>NUL
rd/s/q "%AppData%\Tencent\Users"2>NUL
rd/s/q "%AppData%\Tencent\QTalk"2>NUL
rd/s/q "%AppData%\Tencent\QQLite"2>NUL
rd/s/q "%APPDATA%\Tencent\QQDoctor"2>NUL
rd/s/q "%AppData%\Tencent\DeskUpdate"2>NUL
rd/s/q "%ProgramData%\Tencent\QQProtect"2>NUL
rd/s/q "%AppData%\Tencent\AndroidAssist"2>NUL
rd/s/q "%AppData%\Tencent\AndroidServer"2>NUL
rd/s/q "%AppData%\Tencent\QQPhoneManager"2>NUL
rd/s/q "%AppData%\Tencent\QQPhoneAssistant"2>NUL
rd/s/q "%UserProfile%\Documents\Tencent"   2>NUL
rd/s/q "%UserProfile%\My Documents\Tencent"2>NUL
rd/s/q "%UserProFile%\AppData\LocalLow\QQMiniDL"2>NUL
rd/s/q "%AllUsersProfile%\Application Data\QQPet"2>NUL
rd/s/q "%UserProfile%\AppData\Local\Tencent\QQPet"2>NUL
rd/s/q "%USERPROFILE%\Local Settings\Tencent\QQPet"2>NUL
rd/s/q "%USERPROFILE%\Local Settings\QQKartLiveUpdate"2>NUL
rd/s/q "%UserProfile%\Documents\Tencent Files\QPlus"   2>NUL
rd/s/q "%UserProfile%\My Documents\Tencent Files\QPlus"2>NUL
rd/s/q "%AllUsersProfile%\Application Data\Tencent\QQProtect"2>NUL
reg delete HKLM\SYSTEM\CurrentControlSet\services\QQProtect /F>NUL 2>NUL
rd/s/q "%CommonProgramFiles%\Tencent\QQProtect"2>NUL
rd/s/q "%CommonProgramFiles(x86)%\Tencent\QQProtect"2>NUL
for /f "skip=2 tokens=3 delims= " %%i in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" /v personal') do (
       for /f "delims=*" %%j in ('echo %%i') do rd/s/q "%%j\Tencent Files\All Users\QQ\Misc\OperateFace" 2>NUL)

:: 注册下载助手登陆库控件（注：不传递到系统公用库并注册则打开它无法登陆)
:: 放置视频直播下载库组件（注：不传递到系统公用库会导致无法加载资源安装)
if exist Bin\DownloadProxyPS.dll regsvr32 /s Bin\DownloadProxyPS.dll
if "%PROCESSOR_ARCHITECTURE%"=="x86" md "%CommonProgramFiles%\Tencent\TXSSO\Bin"2>NUL
if "%PROCESSOR_ARCHITECTURE%"=="x86" xcopy /i/y/e Bin\TXSSO\Bin "%CommonProgramFiles%\Tencent\TXSSO\Bin">NUL 2>NUL
if "%PROCESSOR_ARCHITECTURE%"=="x86" regsvr32 /s "%CommonProgramFiles%\Tencent\TXSSO\Bin\SSOLUIControl.dll"
if "%PROCESSOR_ARCHITECTURE%"=="x86" reg add HKLM\Software\Tencent\TXSSO /f /v version /d "1.2.4.2" >NUL

If "%PROCESSOR_ARCHITECTURE%"=="AMD64" md "%CommonProgramFiles(x86)%\Tencent\TXSSO\Bin"2>NUL
If "%PROCESSOR_ARCHITECTURE%"=="AMD64" xcopy /i/y/e Bin\TXSSO\Bin "%CommonProgramFiles(x86)%\Tencent\TXSSO\Bin">NUL 2>NUL
If "%PROCESSOR_ARCHITECTURE%"=="AMD64" regsvr32 /s "%CommonProgramFiles(x86)%\Tencent\TXSSO\Bin\SSOLUIControl.dll"
If "%PROCESSOR_ARCHITECTURE%"=="AMD64" reg add HKLM\Software\Wow6432Node\Tencent\TXSSO /f /v version /d "1.2.4.2" >NUL

:: 注册协议：关联网页会话、表情包关联、音乐收听等
if exist Bin\Timwp.dll regsvr32 /s Bin\Timwp.dll
if exist Bin\AppCom.dll regsvr32 /s Bin\AppCom.dll
if exist Bin\Common.dll regsvr32 /s Bin\Common.dll
if exist Bin\CPHelper.dll regsvr32 /s Bin\CPHelper.dll
if exist Bin\TXPFProxy.dll regsvr32 /s Bin\TXPFProxy.dll
if exist Bin\KernelUtil.dll regsvr32 /s Bin\KernelUtil.dll
if exist Bin\TXPlatform.exe Bin\TXPlatform.exe /RegServer
if exist Bin\QQExternal.exe Bin\QQExternal.exe /SetupRegister  

:: 注册谷歌、火狐、Opera 快速登陆控件
regsvr32 /s Bin\TXSSO\Npchrome\npactivex.dll
:: 注册SSO核心库、IE及接口快速登陆控件
regsvr32 /s Bin\TXSSO\Bin\SSOCommon.dll
regsvr32 /s Bin\TXSSO\Bin\npSSOAxCtrlForPTLogin.dll
:: 注册中转站上传，群共享、微云上传控件
:: regsvr32 /s Bin\TXSSO\TXFTN\TXFTNActiveX1.17.dll
regsvr32 /s Plugin\Com.Tencent.NetDisk\Bin\QQDisk\Bin\TXFTNActiveX.dll

:: 替换旧版移动设备图标文件，放置占位阻止下载新图标（去掉注释）

:: md "%AppData%\Tencent\QQ\Misc\CSC\2052\9">NUL 2>NUL
:: echo.> "%AppData%\Tencent\QQ\Misc\CSC\2052\9\18"2>NUL
:: Attrib +r "%AppData%\Tencent\QQ\Misc\CSC\2052\9\18" >NUL 2>NUL

:: 传送QQ便签引导,不传送到后台位置则面板图标无法启动
xcopy /s/i/y Bin\TXSSO\QQApp "%AppData%\Tencent\QQ\QQApp">NUL 2>NUL
:: 解决群应用视频图标不显示
xcopy /s/i/y Misc\GroupAppIcon "%AppData%\Tencent\QQ\Misc\GroupAppIcon">NUL 2>NUL

:: 设置安装路劲,安装视频留言和影音播放等组件下载需要
if "%PROCESSOR_ARCHITECTURE%"=="x86" reg add HKLM\Software\Tencent\QQ2009 /f /v Install /d "%~dp0\" >NUL
If "%PROCESSOR_ARCHITECTURE%"=="AMD64" reg add HKLM\Software\Wow6432Node\Tencent\QQ2009 /f /v Install /d "%~dp0\" >NUL

:: 创建安装版本号,企业类型网页会话需要,CRM组件需保留
if "%PROCESSOR_ARCHITECTURE%"=="x86" reg add HKLM\Software\Tencent\QQ2009 /f /v version /d "54.79.0.18038.0" >NUL
If "%PROCESSOR_ARCHITECTURE%"=="AMD64" reg add HKLM\Software\Wow6432Node\Tencent\QQ2009 /f /v version /d "54.79.0.18038.0" >NUL

:: 判断系统版本号然后去执行添加我的文档自定义路径功能
ver|findstr "5\.[0-9]\.[0-9][0-9]*" > nul && (goto WinXP)
ver|findstr "6\.[0-9]\.[0-9][0-9]*" > nul && (goto Win7+)
ver|findstr "10\.[0-9]\.[0-9][0-9]*" > nul && (goto Win7+)

:WinXP
ECHO.&ECHO.完成! 是否创建桌面快捷方式？
ECHO.&ECHO.是请按任意键，否直接关闭呗！ &&PAUSE >NUL && CLS && GOTO DesktopLnk

:Win7+
:: 生成个人文件夹保存位置配置文件，让Win、Win8或更高版的系统能正常保存自定义路径！
if not exist "%Public%\Documents\Tencent\QQ" md "%Public%\Documents\Tencent\QQ"2>NUL
if not exist "%Public%\Documents\Tencent\QQ\UserDataInfo.ini" echo.>"%Public%\Documents\Tencent\QQ\UserDataInfo.ini"2>NUL
ECHO.&ECHO.完成! 是否创建桌面快捷方式？
ECHO.&ECHO.是请按任意键，否直接关闭呗！ &&PAUSE >NUL && CLS && GOTO DesktopLnk

:DesktopLnk
mshta VBScript:Execute("Set a=CreateObject(""WScript.Shell""):Set b=a.CreateShortcut(a.SpecialFolders(""Desktop"") & ""\腾讯QQ.lnk""):b.TargetPath=""%~dp0Bin\QQ.exe"":b.WorkingDirectory=""%~dp0Bin"":b.Save:close")
ECHO.&ECHO.创建完成，任意键直接退出！ &&PAUSE >NUL && CLS && EXIT