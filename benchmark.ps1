# =============================================================================
# benchmark.ps1 -- Run all platform benchmarks and print a summary table.
#
# PREREQS:
#   1. The platform is already running (.\start.ps1 in another terminal).
#   2. `hey` is installed:  go install github.com/rakyll/hey@latest
#   3. Postgres has at least a few analysis_runs rows (run send_webhook.py
#      a couple times first so /api/analyses isn't empty).
#   4. Benchmark 8 needs a worker running the current worker.py -- it reads
#      the patch_verify_seconds Prometheus metric (added with METRICS_PORT).
#
# USAGE:
#   .\benchmark.ps1                  # run everything (default 20 webhooks)
#   .\benchmark.ps1 -Count 50        # use 50 webhooks for more confidence
#   .\benchmark.ps1 -Only api        # just the API throughput test
#   .\benchmark.ps1 -Only e2e        # just webhook accept + end-to-end latency
#   .\benchmark.ps1 -Only ai         # just AI latency from Prometheus
#   .\benchmark.ps1 -Only scale      # automated 1-vs-3-worker scaling test
#   .\benchmark.ps1 -Only patch      # patch verification timing (Prometheus)
# =============================================================================
param(
    [ValidateSet("all","api","e2e","scale","ai","patch")]
    [string]$Only = "all",
    [int]$Count = 20
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$results = @()
$spawnedProcs = @()

function Row($name, $value, $unit, $notes) {
    $results += [pscustomobject]@{
        Metric = $name; Value = $value; Unit = $unit; Notes = $notes
    }
}

# Helper: fetch /api/analyses once and return the runs as an array (never $null,
# even when the API returns JSON `null` for an empty table).
function Get-Analyses {
    $content = (Invoke-WebRequest "http://localhost:8080/api/analyses" -UseBasicParsing -Headers (Get-ApiHeaders)).Content
    $runs = $content | ConvertFrom-Json
    if (-not $runs) { return @() }
    return @($runs)
}

# Helper: highest run id currently in the DB (so we can tell OUR new runs apart
# from older ones). 0 when the table is empty or the API is unreachable.
function Get-MaxRunId {
    try {
        $existing = Get-Analyses
        if ($existing.Count -gt 0) {
            return ($existing | Measure-Object -Property id -Maximum).Maximum
        }
    } catch {}
    return 0
}

# Helper: read GITHUB_WEBHOOK_SECRET from apps/api/.env (fallback: dev default
# used by send_webhook.py). Needed to sign Benchmark 3's probe webhooks.
function Get-WebhookSecret {
    $envFile = Join-Path $root "apps\api\.env"
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match "^GITHUB_WEBHOOK_SECRET=" } | Select-Object -First 1
        if ($line) { return ($line -split "=", 2)[1].Trim() }
    }
    return "testsecret123"
}

function Get-ApiKey {
    $envFile = Join-Path $root "apps\api\.env"
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match "^API_KEY=" } | Select-Object -First 1
        if ($line) { return ($line -split "=", 2)[1].Trim() }
    }
    return $env:API_KEY
}

function Get-ApiHeaders {
    $key = Get-ApiKey
    if ($key) { return @{ "X-API-Key" = $key } }
    return @{}
}

# Helper: GitHub-style HMAC-SHA256 hex signature for a request body.
function Get-WebhookSignature($secret, $body) {
    $hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($secret))
    $hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))
    return "sha256=" + ([BitConverter]::ToString($hash) -replace "-", "").ToLower()
}

# Helper: sum a Prometheus histogram's _sum/_count across every reachable
# worker metrics endpoint (9090..9092). The scale test's extra workers serve
# metrics on 9091/9092, so aggregating avoids undercounting their samples.
# NOTE: TimeoutSec is generous (10s) because the worker's metrics server runs
# in a daemon thread that starves under the GIL while a job is mid-process --
# a busy worker can take several seconds to answer /metrics. Dead ports still
# fail fast (connection refused is instant on localhost).
function Get-MetricTotals($metric) {
    $sum = 0.0; $cnt = 0.0
    foreach ($port in 9090..9092) {
        try {
            $m = (Invoke-WebRequest "http://localhost:$port/metrics" -UseBasicParsing -TimeoutSec 10).Content
            $s = [regex]::Match($m, [regex]::Escape($metric) + "_sum\s+([\d.eE+-]+)")
            $c = [regex]::Match($m, [regex]::Escape($metric) + "_count\s+([\d.eE+-]+)")
            if ($s.Success -and $c.Success) {
                $sum += [double]::Parse($s.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
                $cnt += [double]::Parse($c.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
            }
        } catch {}
    }
    return @{ Sum = $sum; Count = $cnt }
}

# Helper: poll /api/analyses until $numJobs runs with id > $maxBefore reach a
# terminal state (completed/failed). Returns the array of new runs.
function Wait-Runs($numJobs, $maxBefore, $timeoutMin = 15) {
    $pollStart = Get-Date
    $newRuns = @()
    while ($true) {
        Start-Sleep -Seconds 5
        $all = Get-Analyses
        $newRuns = @($all | Where-Object { $_.id -gt $maxBefore })
        $terminal = @($newRuns | Where-Object { $_.status -in @("completed","failed") })
        Write-Host "    progress: $($terminal.Count)/$numJobs finished ($($newRuns.Count) created)" -ForegroundColor Gray
        if ($terminal.Count -ge $numJobs) { break }
        if (((Get-Date) - $pollStart).TotalMinutes -gt $timeoutMin) {
            Write-Host "    Timeout: only $($terminal.Count)/$numJobs finished after $timeoutMin min" -ForegroundColor Yellow
            break
        }
    }
    return $newRuns
}

# Helper: per-job latency from DB timestamps (NOT wall-clock / count, which is
# just 1/throughput). For each run we GET /api/analyses/{id} and compute:
#   e2e  = completed_at - created_at   (queued -> done; the honest e2e latency,
#                                     including time spent waiting in Redis)
#   proc = completed_at - started_at   (pure worker processing time)
function Get-RunLatencies($runs) {
    $e2e = @(); $proc = @(); $firstStarted = $null; $lastCompleted = $null
    foreach ($run in $runs) {
        try {
            $d = (Invoke-WebRequest "http://localhost:8080/api/analyses/$($run.id)" -UseBasicParsing -Headers (Get-ApiHeaders)).Content | ConvertFrom-Json
            if (-not $d.completed_at) { continue }
            $created   = [DateTimeOffset]::Parse($run.created_at, [Globalization.CultureInfo]::InvariantCulture)
            $completed = [DateTimeOffset]::Parse($d.completed_at, [Globalization.CultureInfo]::InvariantCulture)
            $e2e += ($completed - $created).TotalSeconds
            if ($d.started_at) {
                $started = [DateTimeOffset]::Parse($d.started_at, [Globalization.CultureInfo]::InvariantCulture)
                $proc += ($completed - $started).TotalSeconds
                if (-not $firstStarted -or $started -lt $firstStarted) { $firstStarted = $started }
            }
            if (-not $lastCompleted -or $completed -gt $lastCompleted) { $lastCompleted = $completed }
        } catch {}
    }
    return @{ E2e = $e2e; Proc = $proc; FirstStarted = $firstStarted; LastCompleted = $lastCompleted }
}

# Helper: throughput over the ACTIVE window (first job started -> last job
# completed). The wall-clock number is diluted by the serial `python
# send_webhook.py` firing time (~0.5s per job); this one isn't.
function Get-ActiveThroughput($r) {
    if ($r.Completed -gt 0 -and $r.Lat.FirstStarted -and `
        ($r.Lat.LastCompleted -gt $r.Lat.FirstStarted)) {
        return $r.Completed / ($r.Lat.LastCompleted - $r.Lat.FirstStarted).TotalMinutes
    }
    return $null
}

# Helper: fire N webhooks and wait for them all to finish, tracking by run ID.
# Returns a hashtable with completed/failed/created/elapsed counts plus Lat
# (per-job latencies from DB timestamps).
function Run-E2E($numJobs) {
    $maxBefore = Get-MaxRunId

    Write-Host "    Firing $numJobs webhooks..." -ForegroundColor Gray
    $start = Get-Date
    for ($i = 0; $i -lt $numJobs; $i++) {
        python send_webhook.py 2>&1 | Out-Null
    }

    Write-Host "    Waiting for all $numJobs jobs to finish..." -ForegroundColor Gray
    $newRuns = Wait-Runs $numJobs $maxBefore
    $elapsed = (Get-Date) - $start

    $completed = @($newRuns | Where-Object { $_.status -eq "completed" }).Count
    $failed    = @($newRuns | Where-Object { $_.status -eq "failed" }).Count

    return @{
        Completed = $completed
        Failed    = $failed
        Created   = $newRuns.Count
        Elapsed   = $elapsed
        NewRuns   = $newRuns
        Lat       = (Get-RunLatencies $newRuns)
    }
}

# Baseline for Benchmark 5: captured before this script fires any jobs, so the
# AI latency average can be reported for THIS run instead of cumulatively
# since worker start. (With -Only ai no jobs are fired and we fall back to
# the cumulative numbers.)
$aiBaseline = Get-MetricTotals "ai_review_latency_seconds"

# -----------------------------------------------------------------------------
# Benchmark 1+2: API throughput + p99 latency
# -----------------------------------------------------------------------------
if ($Only -in @("all","api")) {
    Write-Host "`n==> Benchmark 1+2: API throughput + latency (hey)" -ForegroundColor Cyan
    $hey = "$env:USERPROFILE\go\bin\hey.exe"
    if (-not (Test-Path $hey)) { $hey = "hey" }
    $heyArgs = @("-n", "5000", "-c", "50")
    $apiKey = Get-ApiKey
    if ($apiKey) { $heyArgs += @("-H", "X-API-Key: $apiKey") }
    $heyArgs += "http://localhost:8080/api/analyses"
    $out = & $hey @heyArgs 2>&1 | Out-String

    $rps = ([regex]::Match($out, "Requests/sec:\s+([\d.]+)")).Groups[1].Value

    $p99 = $null
    foreach ($pattern in @(
        "99% in ([\d.]+) secs",
        "99%\s+in\s+([\d.]+)\s*s",
        "99%\s+([\d.]+)\s*s",
        "p99\s+([\d.]+)"
    )) {
        $m = [regex]::Match($out, $pattern)
        if ($m.Success) { $p99 = $m.Groups[1].Value; break }
    }
    if (-not $p99) {
        $latencyLine = ($out -split "`n" | Where-Object { $_ -match "99%" } | Select-Object -First 1)
        if ($latencyLine) {
            $nums = [regex]::Matches($latencyLine, "([\d.]+)")
            if ($nums.Count -gt 0) { $p99 = $nums[$nums.Count - 1].Value }
        }
    }

    Row "API throughput"  $rps  "req/s" "hey -n 5000 -c 50"
    Row "API p99 latency" $p99  "secs"  "same run"
    Write-Host "    RPS: $rps   p99: ${p99}s"
    if (-not $p99) {
        Write-Host "    (couldn't auto-parse p99 -- raw hey output below)" -ForegroundColor Yellow
        $out -split "`n" | Where-Object { $_ -match "Latency|99%|Response time" } | ForEach-Object {
            Write-Host "    $_" -ForegroundColor Yellow
        }
    }
}

# -----------------------------------------------------------------------------
# Benchmark 3: Webhook accept time -- VALID signature, REAL accept path.
# (The old version sent "sha256=invalid" and measured the 401 REJECT path.)
# Each sample is a genuinely accepted webhook (HMAC verify + DB inserts +
# Redis LPUSH), timed with curl's own %{time_total} so curl.exe process
# startup isn't counted. Accepted jobs are drained afterwards so they don't
# pollute Benchmark 4's throughput measurement.
# -----------------------------------------------------------------------------
if ($Only -in @("all","e2e")) {
    Write-Host "`n==> Benchmark 3: Webhook accept time (valid HMAC, real enqueue)" -ForegroundColor Cyan
    $secret = Get-WebhookSecret
    $acceptSamples = 5   # every sample creates a REAL job; 5 keeps the drain quick
    $times = @()
    $maxBefore = Get-MaxRunId
    $bodyFile = Join-Path $env:TEMP "benchmark3_body.json"

    for ($i = 0; $i -lt $acceptSamples; $i++) {
        # Unique head SHA per sample: the API dedupes on (repo, pr, commit_sha)
        # with ON CONFLICT DO NOTHING, so identical payloads would be dropped.
        $sha = "bench3_$([guid]::NewGuid().ToString('N'))"
        $payload = @{
            action = "opened"
            pull_request = @{
                number = 1; title = "Benchmark accept-time probe"
                head = @{ sha = $sha; ref = "main" }
                user = @{ login = "goldenk23" }
            }
            repository = @{
                id = 123; name = "AI-Code-Review-and-DevSecOps-Agent-Platform"
                full_name = "goldenk23/AI-Code-Review-and-DevSecOps-Agent-Platform"
                owner = @{ login = "goldenk23" }
            }
        } | ConvertTo-Json -Depth 6 -Compress
        # Sign EXACTLY the bytes we send: write the body to a file and post it
        # with --data-binary (PowerShell 5.1 mangles embedded quotes in -d args).
        [IO.File]::WriteAllText($bodyFile, $payload)
        $sig = Get-WebhookSignature $secret $payload

        $out = "$(curl.exe -s -o NUL -w "%{http_code} %{time_total}" -X POST http://localhost:8080/webhooks/github `
            -H "Content-Type: application/json" `
            -H "X-GitHub-Event: pull_request" `
            -H "X-Hub-Signature-256: $sig" `
            --data-binary "@$bodyFile")".Trim()
        $parts = $out -split "\s+"
        $code = $parts[0]
        if ($code -eq "200" -and $parts.Count -ge 2) {
            $times += [double]::Parse($parts[1], [Globalization.CultureInfo]::InvariantCulture) * 1000
        } else {
            Write-Host "    WARNING: sample $($i+1) got HTTP $code (expected 200) -- check GITHUB_WEBHOOK_SECRET" -ForegroundColor Yellow
        }
    }
    Remove-Item $bodyFile -Force -ErrorAction SilentlyContinue

    if ($times.Count -gt 0) {
        $avg = ($times | Measure-Object -Average).Average
        $min = ($times | Measure-Object -Minimum).Minimum
        $max = ($times | Measure-Object -Maximum).Maximum
        Row "Webhook accept time (avg)" ("{0:N1}" -f $avg) "ms" "valid HMAC, real enqueue, $($times.Count) samples"
        Row "Webhook accept time (min)" ("{0:N1}" -f $min) "ms" "best case"
        Row "Webhook accept time (max)" ("{0:N1}" -f $max) "ms" "worst case"
        Write-Host "    avg: $([math]::Round($avg,1)) ms   min: $([math]::Round($min,1)) ms   max: $([math]::Round($max,1)) ms"

        # Drain the accepted jobs so they don't delay Benchmark 4's jobs.
        Write-Host "    Draining $($times.Count) accepted jobs before the next benchmark..." -ForegroundColor Gray
        Wait-Runs $times.Count $maxBefore 5 | Out-Null
    } else {
        Write-Host "    No successful samples -- is the API up and the secret correct?" -ForegroundColor Red
    }
}

# -----------------------------------------------------------------------------
# Benchmark 4+6: End-to-end job latency + worker throughput (1 worker)
# -----------------------------------------------------------------------------
if ($Only -in @("all","e2e")) {
    Write-Host "`n==> Benchmark 4+6: End-to-end latency + throughput ($Count webhooks, 1 worker)" -ForegroundColor Cyan
    $r = Run-E2E $Count
    $mins = $r.Elapsed.TotalMinutes

    Row "Jobs created"     $r.Created   "count" "$Count sent"
    Row "Jobs completed"   $r.Completed "count" "$Count sent"
    Row "Jobs failed"      $r.Failed    "count" "$Count sent"
    Row "Wall-clock time"  ("{0:N1}" -f $r.Elapsed.TotalSeconds) "s" "$Count jobs, 1 worker"

    if ($r.Completed -gt 0) {
        $jobsPerMin = $r.Completed / $mins
        Row "Worker throughput (1 worker)" ("{0:N2}" -f $jobsPerMin) "jobs/min" "$($r.Completed) completed, wall-clock"

        $activeTput = Get-ActiveThroughput $r
        if ($activeTput) {
            Row "Worker throughput (active window)" ("{0:N2}" -f $activeTput) "jobs/min" "excludes webhook-firing time"
        }

        if ($r.Lat.E2e.Count -gt 0) {
            $avgE2e = ($r.Lat.E2e | Measure-Object -Average).Average
            $maxE2e = ($r.Lat.E2e | Measure-Object -Maximum).Maximum
            Row "End-to-end latency (avg)" ("{0:N1}" -f $avgE2e) "s" "queued->done, per job, $($r.Lat.E2e.Count) jobs"
            Row "End-to-end latency (max)" ("{0:N1}" -f $maxE2e) "s" "last job in the queue waits longest"
        }
        if ($r.Lat.Proc.Count -gt 0) {
            $avgProc = ($r.Lat.Proc | Measure-Object -Average).Average
            Row "Worker processing time (avg)" ("{0:N1}" -f $avgProc) "s" "started->done, per job"
        }

        Write-Host "    $($r.Completed) completed, $($r.Failed) failed in $([math]::Round($mins,2)) min" -ForegroundColor Green
        Write-Host "    Throughput: $([math]::Round($jobsPerMin,2)) jobs/min (wall-clock)" -ForegroundColor Green
        if ($activeTput) { Write-Host "    Throughput: $([math]::Round($activeTput,2)) jobs/min (active window)" -ForegroundColor Green }
        if ($r.Lat.E2e.Count -gt 0) {
            Write-Host "    E2E latency: avg $([math]::Round($avgE2e,1))s, max $([math]::Round($maxE2e,1))s per job" -ForegroundColor Green
        }
        if ($r.Lat.Proc.Count -gt 0) {
            Write-Host "    Processing time: avg $([math]::Round($avgProc,1))s per job" -ForegroundColor Green
        }
    } else {
        Row "Worker throughput" "N/A" "" "0 completed -- pipeline is broken!"
        Write-Host "    0 jobs completed! Check:" -ForegroundColor Red
        Write-Host "    docker exec ai-review-postgres psql -U review -d ai_review -c `"SELECT id,status,error FROM analysis_runs ORDER BY id DESC LIMIT $Count;`"" -ForegroundColor Red
    }
}

# -----------------------------------------------------------------------------
# Benchmark 5: AI review latency (Prometheus, aggregated across all worker
# metrics endpoints 9090..9092; diffed against the script-start baseline so
# the average covers THIS benchmark run when jobs were fired).
# -----------------------------------------------------------------------------
if ($Only -in @("all","ai")) {
    Write-Host "`n==> Benchmark 5: AI review latency (Prometheus)" -ForegroundColor Cyan
    $tot = Get-MetricTotals "ai_review_latency_seconds"
    $dCnt = $tot.Count - $aiBaseline.Count
    if ($dCnt -gt 0) {
        $avg = ($tot.Sum - $aiBaseline.Sum) / $dCnt
        Row "AI review latency (avg)" ("{0:N2}" -f $avg) "s" "$([int]$dCnt) calls during this benchmark"
        Write-Host "    avg: $([math]::Round($avg,2)) s over $([int]$dCnt) calls (this benchmark run)"
    } elseif ($tot.Count -gt 0) {
        $avg = $tot.Sum / $tot.Count
        Row "AI review latency (avg)" ("{0:N2}" -f $avg) "s" "$([int]$tot.Count) samples, cumulative since worker start"
        Write-Host "    avg: $([math]::Round($avg,2)) s over $([int]$tot.Count) calls (cumulative since worker start)"
    } else {
        Write-Host "    no AI calls yet -- run a webhook first" -ForegroundColor Yellow
    }
}

# -----------------------------------------------------------------------------
# Benchmark 7: Scaling speedup (AUTOMATED 1 vs 3 workers)
# -----------------------------------------------------------------------------
# Spawns 2 extra worker processes in the background (using the project venv
# python like start.ps1 does, each with its own METRICS_PORT so their
# Prometheus samples stay visible), runs the e2e test with 3 workers, kills
# them, and computes the speedup ratio vs 1 worker. Speedup prefers the
# active-window throughput (undiluted by serial webhook firing).
# -----------------------------------------------------------------------------
if ($Only -in @("all","scale")) {
    Write-Host "`n==> Benchmark 7: Scaling speedup (automated 1 vs 3 workers)" -ForegroundColor Cyan
    $scaleCount = 30   # 30 jobs is enough to see the scaling effect

    # Step 1: baseline with 1 worker (the one already running from start.ps1)
    Write-Host "    [1/3] Baseline: 1 worker, $scaleCount webhooks..." -ForegroundColor Gray
    $r1 = Run-E2E $scaleCount
    if ($r1.Completed -eq 0) {
        Write-Host "    Baseline failed (0 completed). Fix the pipeline first." -ForegroundColor Red
        break
    }
    $throughput1 = $r1.Completed / $r1.Elapsed.TotalMinutes
    $active1 = Get-ActiveThroughput $r1
    Write-Host "    1 worker: $([math]::Round($throughput1,2)) jobs/min (wall-clock)" -ForegroundColor Green

    # Step 2: spawn 2 extra workers in the background. Use the venv python
    # (system python may lack psycopg2/redis/prometheus_client -- a silently
    # dead "worker" would fake a 1-worker result), give each its own metrics
    # port, and capture their output so crashes are visible afterwards.
    Write-Host "    [2/3] Spawning 2 extra workers (WORKER_ID=2,3; METRICS_PORT=9091,9092)..." -ForegroundColor Gray
    $workerDir = Join-Path $root "apps\worker"
    $venvPy = Join-Path $workerDir ".venv\Scripts\python.exe"
    $py = if (Test-Path $venvPy) { $venvPy } else { "python" }
    $logsDir = Join-Path $root "logs"
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

    $env:WORKER_ID = "2"; $env:METRICS_PORT = "9091"
    $p2 = Start-Process -FilePath $py -ArgumentList "worker.py" `
        -WorkingDirectory $workerDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logsDir "worker2.log") `
        -RedirectStandardError  (Join-Path $logsDir "worker2.err.log")
    $spawnedProcs += $p2
    $env:WORKER_ID = "3"; $env:METRICS_PORT = "9092"
    $p3 = Start-Process -FilePath $py -ArgumentList "worker.py" `
        -WorkingDirectory $workerDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logsDir "worker3.log") `
        -RedirectStandardError  (Join-Path $logsDir "worker3.err.log")
    $spawnedProcs += $p3
    $env:WORKER_ID = $null; $env:METRICS_PORT = $null   # don't leak into our own shell
    Start-Sleep -Seconds 3   # give them time to connect to Redis

    $alive = 0
    foreach ($s in @(@{ Proc = $p2; N = 2 }, @{ Proc = $p3; N = 3 })) {
        if ($s.Proc.HasExited) {
            Write-Host "    WARNING: spawned worker $($s.N) (PID $($s.Proc.Id)) already exited -- see logs\worker$($s.N).err.log" -ForegroundColor Yellow
        } else { $alive++ }
    }
    Write-Host "    Spawned worker 2 (PID $($p2.Id)) and worker 3 (PID $($p3.Id)) -- $alive/2 alive" -ForegroundColor Gray
    if ($alive -lt 2) {
        Write-Host "    Fewer than 2 extra workers are running; the speedup below is NOT a real 3-worker measurement." -ForegroundColor Yellow
    }

    # Step 3: run the same test with 3 workers
    Write-Host "    [3/3] Scaling test: 3 workers, $scaleCount webhooks..." -ForegroundColor Gray
    $r3 = Run-E2E $scaleCount
    $throughput3 = $r3.Completed / $r3.Elapsed.TotalMinutes
    $active3 = Get-ActiveThroughput $r3
    Write-Host "    3 workers: $([math]::Round($throughput3,2)) jobs/min (wall-clock)" -ForegroundColor Green

    # Kill the extra workers
    foreach ($p in $spawnedProcs) {
        try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    $spawnedProcs = @()

    # Compute speedup -- prefer the active-window ratio (the wall-clock one is
    # diluted by serial webhook firing in BOTH runs, compressing the ratio).
    if ($throughput1 -gt 0) {
        Row "Throughput (1 worker)"  ("{0:N2}" -f $throughput1) "jobs/min" "$($r1.Completed) completed, wall-clock"
        Row "Throughput (3 workers)" ("{0:N2}" -f $throughput3) "jobs/min" "$($r3.Completed) completed, wall-clock"
        if ($active1) { Row "Throughput (1 worker, active)"  ("{0:N2}" -f $active1) "jobs/min" "excludes firing time" }
        if ($active3) { Row "Throughput (3 workers, active)" ("{0:N2}" -f $active3) "jobs/min" "excludes firing time" }

        $speedup = $null; $basis = ""
        if ($active1 -and $active3 -and $active1 -gt 0) {
            $speedup = $active3 / $active1; $basis = "active-window"
        } else {
            $speedup = $throughput3 / $throughput1; $basis = "wall-clock"
        }
        Row "Scaling speedup" ("{0:N2}x" -f $speedup) "ratio" "3 workers / 1 worker, $basis basis"
        Write-Host "    Speedup: $([math]::Round($speedup,2))x (3 workers vs 1, $basis)" -ForegroundColor Green

        if ($r1.Lat.E2e.Count -gt 0 -and $r3.Lat.E2e.Count -gt 0) {
            $e1 = ($r1.Lat.E2e | Measure-Object -Average).Average
            $e3 = ($r3.Lat.E2e | Measure-Object -Average).Average
            Row "E2E latency (1 worker)"  ("{0:N1}" -f $e1) "s" "avg queued->done"
            Row "E2E latency (3 workers)" ("{0:N1}" -f $e3) "s" "avg queued->done"
            Write-Host "    E2E latency: $([math]::Round($e1,1))s -> $([math]::Round($e3,1))s per job" -ForegroundColor Green
        }
    }
}

# -----------------------------------------------------------------------------
# Benchmark 8: Patch verification time (Prometheus)
# -----------------------------------------------------------------------------
# verify_patch() in worker.py times every patch it applies+tests into the
# patch_verify_seconds histogram. We fire up to 3 webhooks until one produces
# AI-suggested patches, then read the avg off /metrics (diffed against a
# baseline taken now, so only this benchmark's verifications count).
# NOTE: needs a worker running the current worker.py -- an older worker has
# no patch_verify_seconds metric and we'll say so instead of guessing.
# -----------------------------------------------------------------------------
if ($Only -in @("all","patch")) {
    Write-Host "`n==> Benchmark 8: Patch verification time (Prometheus)" -ForegroundColor Cyan
    $patchBase = Get-MetricTotals "patch_verify_seconds"
    $found = $false

    for ($attempt = 1; $attempt -le 3 -and -not $found; $attempt++) {
        Write-Host "    Firing webhook $attempt/3 (looking for AI-suggested patches)..." -ForegroundColor Gray
        $r = Run-E2E 1
        if ($r.Completed -eq 0) {
            Write-Host "    job failed -- cannot measure patch verification on a failed run" -ForegroundColor Yellow
            continue
        }
        $runId = ($r.NewRuns | Measure-Object -Property id -Maximum).Maximum
        $patchCount = 0
        try {
            $out = docker exec ai-review-postgres psql -U review -d ai_review -tAc `
                "SELECT COUNT(*) FROM findings WHERE run_id = $runId AND suggested_patch IS NOT NULL AND suggested_patch != '';" 2>$null
            if ($out) { $patchCount = [int]($out.Trim()) }
        } catch { $patchCount = 0 }

        if ($patchCount -gt 0) {
            $found = $true
            $tot = Get-MetricTotals "patch_verify_seconds"
            $dSum = $tot.Sum - $patchBase.Sum
            $dCnt = $tot.Count - $patchBase.Count
            if ($dCnt -gt 0) {
                $avg = $dSum / $dCnt
                Row "Patch verification (avg)" ("{0:N2}" -f $avg) "s" "$([int]$dCnt) patches, run #$runId"
                Write-Host "    avg: $([math]::Round($avg,2)) s over $([int]$dCnt) patch verifications (run #$runId)" -ForegroundColor Green
            } else {
                Row "Patch verification" "N/A" "" "$patchCount patches but no metric -- restart the worker"
                Write-Host "    Found $patchCount patches in run #${runId}, but no patch_verify_seconds samples." -ForegroundColor Yellow
                Write-Host "    The running worker predates the metric -- restart the platform (.\start.ps1)." -ForegroundColor Yellow
            }
        } else {
            Write-Host "    No patches in run #${runId}." -ForegroundColor Gray
        }
    }

    if (-not $found) {
        Write-Host "    No AI-suggested patches in 3 runs. Patch verification only runs when the AI suggests a fix." -ForegroundColor Yellow
        Row "Patch verification" "N/A" "" "no patches in 3 attempts"
    }
}

# Clean up any spawned processes on exit
if ($spawnedProcs.Count -gt 0) {
    foreach ($p in $spawnedProcs) {
        try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
}

# -----------------------------------------------------------------------------
# Summary table
# -----------------------------------------------------------------------------
if ($results.Count -gt 0) {
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host " BENCHMARK SUMMARY" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    $results | Format-Table -AutoSize
    Write-Host "Copy these numbers into your resume bullet." -ForegroundColor Green
}
