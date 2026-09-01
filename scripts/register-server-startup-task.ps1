param(
  [string]$TaskName = "Bilbingo Server",
  [switch]$StartNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Auto-elevate to admin if not already running elevated.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]$identity
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $psArgs = "-ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -TaskName `"$TaskName`""
  if ($StartNow) { $psArgs += " -StartNow" }
  Start-Process powershell -Verb RunAs -ArgumentList $psArgs
  exit
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
  throw "Node.js was not found in PATH. Install Node.js and try again."
}

$nodeExe = $nodeCommand.Source
$serverEntry = Join-Path $repoRoot "backend\dist\server.js"

if (-not (Test-Path $serverEntry)) {
  throw "Compiled backend not found at '$serverEntry'. Run 'npm run build' first."
}

$currentUserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

# Use XML-based task definition to avoid PowerShell enum compatibility issues.
# InteractiveToken means: run only when this user is logged on, no password required.
$xmlEscapedNode = [System.Security.SecurityElement]::Escape($nodeExe)
$xmlEscapedEntry = [System.Security.SecurityElement]::Escape($serverEntry)
$xmlEscapedRoot = [System.Security.SecurityElement]::Escape($repoRoot)
$xmlEscapedUser = [System.Security.SecurityElement]::Escape($currentUserId)

$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$xmlEscapedUser</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$xmlEscapedUser</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
  </Settings>
  <Actions>
    <Exec>
      <Command>$xmlEscapedNode</Command>
      <Arguments>$xmlEscapedEntry</Arguments>
      <WorkingDirectory>$xmlEscapedRoot</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

Register-ScheduledTask -TaskName $TaskName -Xml $taskXml -Force | Out-Null

Write-Host "[task] Registered '$TaskName' - starts Bilbingo server when '$currentUserId' logs on."

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "[task] Started task '$TaskName'."
}
