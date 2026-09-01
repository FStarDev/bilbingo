param(
  [string]$TaskName = "Bilbingo Server"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  throw "Scheduled task '$TaskName' was not found."
}

if ($task.State -eq "Running") {
  Stop-ScheduledTask -TaskName $TaskName
}

Start-ScheduledTask -TaskName $TaskName
Write-Host "[task] Restarted scheduled task '$TaskName'."
