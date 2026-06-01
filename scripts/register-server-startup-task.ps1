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
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask \
  -TaskName $TaskName \
  -Action $action \
  -Trigger $trigger \
  -Settings $settings \
  -Description "Start Bilbingo local server on logon" \
  -Force | Out-Null

Write-Host "[task] Registered task '$TaskName' to start Bilbingo server on logon."

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "[task] Started task '$TaskName'."
}
