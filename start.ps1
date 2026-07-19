# =============================================================================
# start.ps1 -- ONE COMMAND to run the whole platform.
#
# USAGE:
#     .\start.ps1
#
# WHAT IT DOES (in this order):
#   1. Starts Postgres + Redis via `docker compose up -d`
#   2. Waits for Postgres to be ready (max 30s)
#   3. Applies migrations 001..006 if not already applied (idempotent)
#   4. Makes sure apps/api/.env has GITHUB_CALLBACK_URL (needed for OAuth)
#   5. Installs web (npm) and Python (venv + pip) deps if missing
#   6. Launches 4 services in the background:
#        - Go API           (apps/api)        -> :8080
#        - Python AI service (apps/ai-service) -> :8000
#        - Python worker    (apps/worker)       (no port)
#        - Next.js web       (apps/web)         -> :3000
#   7. Tails all 4 log files live in THIS terminal, prefixed with the service
#      name so you can tell them apart.
#   8. Press Ctrl+C once: all 4 services are killed, logs stay in ./logs/
#
# REQS (must already be on PATH):
#   docker, go, python, npm, git, semgrep, pytest
#
# Each service logs to ./logs/<name>.log. Old logs are wiped at startup so
# every run starts clean.
# =============================================================================

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Always operate relative to THIS script, no matter where it's invoked from.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$logs = Join-Path $root "logs"
New-Item -ItemType Directory -Path $logs -Force | Out-Null

# Cluster of background processes we'll need to kill on exit.
$script:procs = @()

function Stop-Tree($processId) {
    # Kill a process AND all its descendants. Windows doesn't do this for us
    # automatically when you Stop-Process a parent, so we walk the tree.
    # NOTE: parameter is named $processId (not $pid) -- $pid is a built-in
    # PowerShell automatic variable and shadowing it trips PSScriptAnalyzer
    # and editors that flag reserved-variable usage.
    $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $processId }
    foreach ($c in $children) { Stop-Tree $c.ProcessId }
    try { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue } catch { }
}

function Stop-AllChildren {
    foreach ($p in $script:procs) {
        if ($p -and -not $p.HasExited) { Stop-Tree $p.Id }
    }
    # Kill orphaned Next.js dev servers that escaped the process tree above.
    # Why: `npm run dev` spawns `next dev` which spawns a detached `node
    # start-server.js` -- Windows reparents the grandchildren, so Stop-Tree
    # on the cmd.exe /c npm wrapper does NOT reach the actual listening
    # process. On the next run that orphan still holds :3000, so the new
    # `next dev` silently binds to :3001 and the browser loads the STALE
    # server (no current CSS/code). Match by command line to be safe: never
    # kill unrelated node.exe the user may have running for other work.
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -like "*next*dev*" -or $_.CommandLine -like "*next\dist\server\lib\start-server*" } |
        ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch { } }
    # Belt + braces: free the ports we're about to bind, regardless of process
    # name. If ANYTHING is listening on 3000/8080/8000, kill its owner.
    foreach ($port in 3000, 8080, 8000) {C:\Users\golde\Desktop\Projects\AI-Code-Review-and-DevSecOps-Agent-Platform\apps\ai-service\.env
    i just want to 
        $owner = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($conn in $owner) {
            try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
    # Best-effort: stop the docker compose stack too (data volumes keep data).
    docker compose down --remove-orphans 2>$null | Out-Null
}
# Always clean up, whether we exit by Ctrl+C or normal completion.
trap { Stop-AllChildren; break }
Register-EngineEvent PowerShell.Exiting -Action { Stop-AllChildren } | Out-Null

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK ($msg) { Write-Host "    [ok] $msg" -ForegroundColor Green }

# -----------------------------------------------------------------------------
# Step 1: bring up Postgres + Redis
# -----------------------------------------------------------------------------
# -----------------------------------------------------------------------------
# Step 0: clear orphaned dev servers / port squatters BEFORE launching anything.
# Why this is required: `npm run dev` (Windows) spawns `next dev`, which spawns
# a DETACHED `node start-server.js`. When the user presses Ctrl+C, our Stop-Tree
# walks child PIDs but the detached node has already been reparented to the
# system and survives -- it keeps holding :3000. The next run's `next dev`
# finds :3000 busy and silently binds to :3001, so the user loads the STALE
# server (yesterday's CSS/code) and thinks "nothing changed." Killing by
# command-line match is safe (won't touch unrelated node work) and cheaper than
# blindly killing anything on :3000 (which we also do as a fallback).
# -----------------------------------------------------------------------------
Write-Step "Clearing orphaned dev servers + freeing ports 3000/8080/8000"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*next*dev*" -or $_.CommandLine -like "*next\dist\server\lib\start-server*" } |
    ForEach-Object {
        Write-Host "    killing orphaned node (PID $($_.ProcessId))"
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
    }
foreach ($port in 3000, 8080, 8000) {
    $owner = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $owner) {
        try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } catch { }
    }
}
Write-OK "Ports free"

# -----------------------------------------------------------------------------
# Step 1: bring up Postgres + Redis
# -----------------------------------------------------------------------------
Write-Step "Starting Postgres + Redis (docker compose up -d)"
docker compose up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose failed -- is Docker Desktop running?" }

# -----------------------------------------------------------------------------
# Step 2: wait for Postgres to accept connections (max 30s)
# -----------------------------------------------------------------------------
Write-Step "Waiting for Postgres to be ready..."
$pgReady = $false
for ($i = 0; $i -lt 30; $i++) {
    $r = docker exec ai-review-postgres pg_isready -U review 2>$null
    if ($LASTEXITCODE -eq 0) { $pgReady = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $pgReady) { throw "Postgres did not become ready in 30s" }
Write-OK "Postgres ready"

# -----------------------------------------------------------------------------
# Step 3: apply migrations 001..006 IF they haven't been already.
# We use the presence of the `findings` table (created last by 006) as the
# "migrations already applied" marker. Cheap and good enough for dev.
# -----------------------------------------------------------------------------
$already = docker exec ai-review-postgres psql -U review -d ai_review -tAc `
    "SELECT to_regclass('public.findings');" 2>$null
if ($already -ne "") {
    Write-OK "Migrations already applied (findings table exists)"
} else {
    Write-Step "Applying migrations 001..006"
    Get-ChildItem "apps/api/migrations" -Filter "*.sql" | Sort-Object Name | ForEach-Object {
        Write-Host "    applying $($_.Name)"
        Get-Content $_.FullName -Raw | docker exec -i ai-review-postgres psql -U review -d ai_review -q
        if ($LASTEXITCODE -ne 0) { throw "migration $($_.Name) failed" }
    }
    Write-OK "Migrations applied"
}

# -----------------------------------------------------------------------------
# Step 4: make sure GITHUB_CALLBACK_URL is in apps/api/.env. The OAuth flow
# in the Next app expects the callback to land on :3000/auth/github/callback,
# so the Go API must advertise THAT URL to GitHub, not its own /auth/ callback.
# We only add the line if it's missing so we don't clobber user edits.
# -----------------------------------------------------------------------------
$apiEnv = "apps/api/.env"
$hasCb = Select-String -Path $apiEnv -Pattern "^GITHUB_CALLBACK_URL=" -Quiet
if (-not $hasCb) {
    Add-Content -Path $apiEnv -Value "`nGITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback"
    Write-OK "Added GITHUB_CALLBACK_URL to apps/api/.env"
} else {
    Write-OK "GITHUB_CALLBACK_URL already configured"
}

# -----------------------------------------------------------------------------
# Step 5: install dependencies that aren't already present.
# We never RE-install -- keeps boot fast on subsequent runs.
# -----------------------------------------------------------------------------
if (-not (Test-Path "apps/web/node_modules")) {
    Write-Step "Installing web deps (first run only)"
    npm install --prefix apps/web
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Write-OK "Web deps installed"
} else { Write-OK "Web node_modules present" }

foreach ($py in @("apps/worker", "apps/ai-service")) {
    $venv = Join-Path $py ".venv"
    if (-not (Test-Path $venv)) {
        Write-Step "Creating venv for $py (first run only)"
        python -m venv $venv
        $pip = Join-Path $venv "Scripts\pip.exe"
        # Pick whichever requirements file the app ships with.
        if (Test-Path (Join-Path $py "requirements.txt")) {
            $req = Join-Path $py "requirements.txt"
        } elseif (Test-Path (Join-Path $py "requirements_template.txt")) {
            $req = Join-Path $py "requirements_template.txt"
        } else {
            $req = $null
        }
        if (-not $req) {
            Write-Host "    (no requirements file in $py -- skipping pip install)"
        } else {
            & $pip install -r $req --quiet
            if ($LASTEXITCODE -ne 0) { throw "pip install failed for $py" }
        }
        Write-OK "Venv ready for $py"
    } else { Write-OK "Venv present for $py" }
}

# -----------------------------------------------------------------------------
# Step 6: wipe old logs and launch the 4 services in the background.
# -----------------------------------------------------------------------------
Get-ChildItem $logs -Filter "*.log" | Remove-Item -Force -ErrorAction SilentlyContinue

function Launch($name, $workdir, $cmd) {
    $out = Join-Path $logs "$name.log"
    # Launch each service via `cmd.exe /c "<cmd>"`. cmd /c blocks until the
    # child (npm/go/python) exits, so the process handle we keep is the actual
    # long-running service process -- the supervisor loop's HasExited check
    # then correctly reflects whether the service is still alive. (Using a
    # powershell.exe -NoExit wrapper left the wrapper alive even after the
    # child died, which masked real crashes; using powershell.exe without
    # -NoExit made the wrapper exit immediately after spawning the child,
    # which made the supervisor tear everything down on startup.)
    $p = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", $cmd `
        -WorkingDirectory $workdir `
        -RedirectStandardOutput $out `
        -RedirectStandardError (Join-Path $logs "$name.err.log") `
        -WindowStyle Hidden `
        -PassThru
    $script:procs += $p
    Write-OK "Started $name (PID $($p.Id)) -> $out"
}

Write-Step "Launching services"
# Commands run under `cmd.exe /c`, so use cmd syntax (no PowerShell `&` call
# operator). Quote paths that may contain spaces.
Launch "api"        "$root\apps\api"        "go run main.go"
Launch "ai-service" "$root\apps\ai-service" """$root\apps\ai-service\.venv\Scripts\python.exe"" -m uvicorn main:app --port 8000"
Launch "worker"     "$root\apps\worker"     """$root\apps\worker\.venv\Scripts\python.exe"" worker.py"
Launch "web"         "$root\apps\web"        "npm run dev"

# -----------------------------------------------------------------------------
# Step 7: tail all 4 log files live with a colored prefix.
# Get-Content -Wait keeps the file open and streams new lines as they arrive.
# We launch one tail job per file, then loop forever until Ctrl+C.
# -----------------------------------------------------------------------------
Write-Step "Tailing logs (Ctrl+C to stop everything)"
Write-Host "    web:        http://localhost:3000" -ForegroundColor Yellow
Write-Host "    api:        http://localhost:8080/health" -ForegroundColor Yellow
Write-Host "    ai-service: http://localhost:8000/docs" -ForegroundColor Yellow
Write-Host ""

$jobs = @{}
foreach ($name in @("api","ai-service","worker","web")) {
    $f = Join-Path $logs "$name.log"
    # Each tail runs in a background runspace; new lines are pushed into a
    # shared queue that the foreground loop drains.
    $job = Start-Job -ScriptBlock {
        param($path, $name)
        Get-Content $path -Wait -Tail 0 | ForEach-Object { "$name|$_" }
    } -ArgumentList $f, $name
    $jobs[$name] = $job
}

try {
    while ($true) {
        $done = $false
        foreach ($name in @($jobs.Keys)) {
            $job = $jobs[$name]
            # Coerce to array so Set-StrictMode doesn't choke on foreach over $null.
            $out = @(Receive-Job $job -ErrorAction SilentlyContinue)
            foreach ($line in $out) {
                # Split "name|message" -- the separator we inserted in the job.
                $i = $line.IndexOf("|")
                $svc = $line.Substring(0, $i)
                $msg = $line.Substring($i + 1)
                $color = switch ($svc) {
                    "api"        { "Cyan" }
                    "ai-service" { "Magenta" }
                    "worker"     { "Yellow" }
                    "web"        { "Green" }
                    default      { "Gray" }
                }
                Write-Host "[$svc] " -ForegroundColor $color -NoNewline
                Write-Host $msg
            }
            if ($job.State -eq "Completed" -or $job.State -eq "Failed") { $done = $true }
        }
        # Only shut down when ALL service wrappers have exited. A single
        # wrapper exiting early is normal on Windows (npm/go spawn detached
        # children and the wrapper returns); tearing everything down on the
        # first exit would kill the still-healthy services. Ctrl+C still works
        # via the trap above.
        $allDead = $true
        foreach ($p in $script:procs) {
            if ($p -and -not $p.HasExited) { $allDead = $false; break }
        }
        if ($allDead -and $script:procs.Count -gt 0) {
            Write-Host "`n[all services exited -- shutting down]" -ForegroundColor Red
            $done = $true
        }
        if ($done) { break }
        Start-Sleep -Milliseconds 250
    }
} finally {
    foreach ($job in $jobs.Values) { Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue }
    Stop-AllChildren
    Write-Host "`nDone. Logs are in ./logs/." -ForegroundColor Cyan
}