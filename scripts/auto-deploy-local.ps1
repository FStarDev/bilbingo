param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [string]$BackendServiceName = "",
  [string]$ScheduledTaskName = "",
  [string]$RestartCommand = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")

Push-Location $repoRoot
try {
  Write-Host "[deploy] Checking for updates in $repoRoot"

  git rev-parse --is-inside-work-tree | Out-Null
  git fetch --prune

  $upstream = (git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null).Trim()
  if (-not $upstream) {
    throw "No upstream branch configured. Set tracking branch first (for example: git branch --set-upstream-to origin/main)."
  }

  $localHead = (git rev-parse HEAD).Trim()
  $remoteHead = (git rev-parse $upstream).Trim()

  if ($localHead -eq $remoteHead) {
    Write-Host "[deploy] No new commits. Nothing to deploy."
    exit 0
  }

  Write-Host "[deploy] New commit detected. Pulling latest changes from $upstream"

  $dependencyChangeFiles = @(
    "package.json",
    "package-lock.json",
    "backend/package.json",
    "backend/package-lock.json"
  )

  $dependencyChanges = git diff --name-only $localHead $remoteHead -- $dependencyChangeFiles
  $dependenciesChanged = @($dependencyChanges).Count -gt 0

  git pull --ff-only

  if ($SkipInstall) {
    Write-Host "[deploy] Skipping npm install (explicit SkipInstall flag)."
  } elseif ($dependenciesChanged) {
    Write-Host "[deploy] Installing dependencies"
    npm install
  } else {
    Write-Host "[deploy] Skipping npm install (no dependency file changes detected)."
  }

  if (-not $SkipBuild) {
    Write-Host "[deploy] Building frontend + backend"
    npm run build
  }

  if ($BackendServiceName) {
    $service = Get-Service -Name $BackendServiceName -ErrorAction SilentlyContinue
    if ($null -eq $service) {
      throw "Service '$BackendServiceName' was not found."
    }

    Write-Host "[deploy] Restarting Windows service: $BackendServiceName"
    Restart-Service -Name $BackendServiceName -Force
  } elseif ($ScheduledTaskName) {
    $task = Get-ScheduledTask -TaskName $ScheduledTaskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
      throw "Scheduled task '$ScheduledTaskName' was not found."
    }

    Write-Host "[deploy] Restarting scheduled task: $ScheduledTaskName"
    if ($task.State -eq "Running") {
      Stop-ScheduledTask -TaskName $ScheduledTaskName
    }
    Start-ScheduledTask -TaskName $ScheduledTaskName
  } elseif ($RestartCommand) {
    Write-Host "[deploy] Running restart command"
    Invoke-Expression $RestartCommand
  } else {
    Write-Host "[deploy] Deploy completed. No restart action configured."
  }

  Write-Host "[deploy] Done"
} finally {
  Pop-Location
}
