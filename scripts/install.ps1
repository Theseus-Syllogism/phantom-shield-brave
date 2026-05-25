# Phantom Shield bridge installer for Windows.
# Idempotent: re-running on a working setup is a no-op.

[CmdletBinding()]
param(
    [switch]$Check,
    [int]$Port = 8118,
    [switch]$NoCa,
    [switch]$NoService,
    [switch]$VerboseOut
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg)    { Write-Host "==> $msg" }
function Write-Verbose2($m)  { if ($VerboseOut) { Write-Host "    $m" -ForegroundColor DarkGray } }
function Fail($msg)          { Write-Error $msg; exit 1 }

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$InstallDir = Join-Path $env:LOCALAPPDATA 'phantom-shield\bridge'
$LogDir     = Join-Path $env:LOCALAPPDATA 'phantom-shield\logs'
$MitmCaCrt  = Join-Path $env:USERPROFILE '.mitmproxy\mitmproxy-ca-cert.cer'
$MitmCaPem  = Join-Path $env:USERPROFILE '.mitmproxy\mitmproxy-ca-cert.pem'

function Require-Python {
    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) { Fail "Python 3.10+ required. Download: https://www.python.org/downloads/windows/" }
    $ver = & python -c "import sys; print('.'.join(str(x) for x in sys.version_info[:2]))"
    if ([version]$ver -lt [version]'3.10') { Fail "Python 3.10+ required (have $ver)" }
}

function State-InstallDirPresent { Test-Path (Join-Path $InstallDir 'venv\Scripts\mitmdump.exe') }
function State-AddonPresent      { Test-Path (Join-Path $InstallDir 'addon.py') }
function State-PortFree {
    -not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}
function State-ServiceActive {
    $t = Get-ScheduledTask -TaskName 'PhantomShieldBridge' -ErrorAction SilentlyContinue
    if (-not $t) { return $false }
    ($t | Get-ScheduledTaskInfo).LastTaskResult -eq 0 -and -not (State-PortFree)
}
function State-CaTrusted {
    [bool](Get-ChildItem Cert:\CurrentUser\Root, Cert:\LocalMachine\Root -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -like '*mitmproxy*' })
}

function Probe-Bridge {
    # -SkipCertificateCheck is PowerShell 6+ only; this script runs under Windows
    # PowerShell 5.1, so accept the bridge's mitmproxy cert via the .NET callback
    # (works on 5.1 and 6+). -UseBasicParsing avoids the legacy IE-engine path.
    try {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
        $h = Invoke-WebRequest -Uri 'https://phantom-shield-bridge.test/probe' `
            -Method Head -Proxy "http://127.0.0.1:$Port" `
            -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($h.Headers['X-Phantom-Bridge-Version']) { return 0 } else { return 2 }
    } catch { return 1 }
}

if ($Check) {
    if (-not (State-InstallDirPresent)) { Write-Step 'needs install'; exit 10 }
    if (-not (State-AddonPresent))      { Write-Step 'needs install'; exit 10 }
    if (-not (State-ServiceActive))     { Write-Step 'service down'; exit 11 }
    if (-not (State-CaTrusted))         { Write-Step 'CA not trusted'; exit 12 }
    switch (Probe-Bridge) {
        0 { Write-Step 'OK'; exit 0 }
        1 { Write-Step 'service down'; exit 11 }
        2 { Write-Step 'addon outdated'; exit 11 }
    }
}

Require-Python

function Ensure-InstallDir {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Ensure-VenvAndDeps {
    if (State-InstallDirPresent) { Write-Verbose2 'venv already present'; return }
    Write-Step "creating venv at $InstallDir\venv"
    & python -m venv (Join-Path $InstallDir 'venv')
    $pip = Join-Path $InstallDir 'venv\Scripts\pip.exe'
    & $pip install --quiet --upgrade pip
    & $pip install --quiet -r (Join-Path $RepoRoot 'bridge\requirements.txt')
}

function Ensure-AddonPy {
    $src = Join-Path $RepoRoot 'bridge\addon.py'
    $dst = Join-Path $InstallDir 'addon.py'
    if (Test-Path $dst) {
        $a = (Get-FileHash $src).Hash
        $b = (Get-FileHash $dst).Hash
        if ($a -eq $b) { Write-Verbose2 'addon.py already up to date'; return }
    }
    Write-Step 'installing addon.py'
    Copy-Item -Force $src $dst
}

function Ensure-CaGenerated {
    if (Test-Path $MitmCaPem) { Write-Verbose2 'mitmproxy CA already generated'; return }
    Write-Step 'generating mitmproxy CA (first-launch)'
    $exe = Join-Path $InstallDir 'venv\Scripts\mitmdump.exe'
    $p = Start-Process -FilePath $exe -ArgumentList "--listen-port $Port --quiet" -PassThru -WindowStyle Hidden
    for ($i = 0; $i -lt 10; $i++) {
        if (Test-Path $MitmCaPem) { break }
        Start-Sleep -Milliseconds 500
    }
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $MitmCaPem)) { Fail 'CA generation failed' }
}

function Ensure-CaTrusted {
    if ($NoCa) { Write-Step '-NoCa: skipping CA install'; return }
    if (State-CaTrusted) { Write-Verbose2 'CA already trusted'; return }
    Write-Step 'installing CA into LocalMachine\Root (UAC prompt expected)'
    Start-Process -Verb RunAs -Wait -FilePath certutil -ArgumentList @('-addstore', '-f', 'ROOT', $MitmCaCrt)
}

function Ensure-Service {
    if ($NoService) { Write-Step '-NoService: skipping task registration'; return }
    if (State-ServiceActive) { Write-Verbose2 'scheduled task already active'; return }
    Write-Step 'registering scheduled task PhantomShieldBridge'
    $exe  = Join-Path $InstallDir 'venv\Scripts\mitmdump.exe'
    $args = "-s `"$(Join-Path $InstallDir 'addon.py')`" --listen-host 127.0.0.1 --listen-port $Port --set connection_strategy=lazy"
    $action  = New-ScheduledTaskAction -Execute $exe -Argument $args
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName 'PhantomShieldBridge' -Action $action `
        -Trigger $trigger -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName 'PhantomShieldBridge'
}

function Verify-ProxyWorks {
    Write-Step 'smoke test: HEAD probe through the bridge'
    $rc = Probe-Bridge
    if ($rc -eq 0) { Write-Step 'smoke test passed.'; return }
    Write-Warning "smoke test failed (rc=$rc). The bridge is installed but the probe didn't succeed.
Check: Get-ScheduledTask PhantomShieldBridge | Get-ScheduledTaskInfo
       logs under $LogDir\"
}

function Print-NextSteps {
    Write-Host ''
    Write-Host "Done. Bridge installed at:"
    Write-Host "  $InstallDir"
    Write-Host "Listening on 127.0.0.1:$Port"
    Write-Host ''
    Write-Host 'Next: open Brave, click the Phantom Shield extension options,'
    Write-Host "and click 'Apply browser proxy' in the setup card."
}

Write-Step "install dir: $InstallDir  port: $Port"
Ensure-InstallDir
Ensure-VenvAndDeps
Ensure-AddonPy
Ensure-CaGenerated
Ensure-CaTrusted
Ensure-Service

Verify-ProxyWorks
Print-NextSteps
