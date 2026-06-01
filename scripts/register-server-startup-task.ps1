param(
  [string]$TaskName = "Bilbingo Server",
  [switch]$StartNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path

$escapedRepoRoot = $repoRoot.Replace("'", "''")
$command = "Set-Location -LiteralPath '$escapedRepoRoot'; npm run start:server"

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -Command \"$command\""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$currentUserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = $null
foreach ($logonType in @("InteractiveTokenOrPassword", "InteractiveOrPassword", "InteractiveToken", "S4U")) {
  try {
    $principal = New-ScheduledTaskPrincipal -UserId $currentUserId -LogonType $logonType -RunLevel Highest
    break
  } catch {
    # Try next supported enum value on this machine.
  }
}

if ($null -eq $principal) {
  throw "Could not create Scheduled Task principal with a supported logon type."
}
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask \
  -TaskName $TaskName \
  -Action $action \
  -Trigger $trigger \
  -Principal $principal \
  -Settings $settings \
  -Description "Start Bilbingo local server on logon" \
  -Force | Out-Null

Write-Host "[task] Registered task '$TaskName' to start Bilbingo server on logon."

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "[task] Started task '$TaskName'."
}
