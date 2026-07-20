!macro preInit
  nsExec::ExecToStack `taskkill /f /im "通用阅读器.exe"`
  nsExec::ExecToStack `taskkill /f /im "通用阅读器.exe" 2>nul`
  Sleep 500
!macroend
