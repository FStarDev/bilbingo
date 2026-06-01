param(
  [string]$TaskName = "Bilbingo Server",
  [switch]$StartNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
  throw "Node.js executable was not found in PATH. Install Node.js machine-wide on the server first."
}

$nodeExe = $nodeCommand.Source
$serverEntry = Join-Path $repoRoot "backend\dist\server.js"

if (-not (Test-Path $serverEntry)) {
  throw "Compiled backend entry not found at '$serverEntry'. Run 'npm run build' first."
}

$escapedRepoRoot = $repoRoot.Replace("'", "''")
$escapedNodeExe = $nodeExe.Replace("'", "''")
$escapedServerEntry = $serverEntry.Replace("'", "''")

$command = "Set-Location -LiteralPath '$escapedRepoRoot'; & '$escapedNodeExe' '$escapedServerEntry'"

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -Command \"$command\""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

$registerTaskParams = @{
  TaskName = $TaskName
  Action = $action
  Trigger = $trigger
  Principal = $principal
  Settings = $settings
  Description = "Start Bilbingo local server on startup"
  Force = $true
}

Register-ScheduledTask @registerTaskParams | Out-Null

Write-Host "[task] Registered task '$TaskName' to start Bilbingo server on startup (SYSTEM account)."

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "[task] Started task '$TaskName'."
}
