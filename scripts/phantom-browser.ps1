# Phantom Browser launcher (Windows). Starts the user's installed Brave as an
# isolated Phantom Shield instance with a session-scoped mitmproxy bridge.

[CmdletBinding()]
param(
    [switch]$PrintCmd,
    [int]$Port = 0,
    [string]$Brave = ''
)

$ErrorActionPreference = 'Stop'

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$DataDir    = Join-Path $env:LOCALAPPDATA 'phantom-shield'
$InstallDir = Join-Path $DataDir 'bridge'
$ProfileDir = Join-Path $DataDir 'profile'
$LogDir     = Join-Path $DataDir 'logs'
$PidFile    = Join-Path $DataDir 'bridge.pid'
$LockFile   = Join-Path $DataDir 'phantom.lock'
$MitmCaCer  = Join-Path $env:USERPROFILE '.mitmproxy\mitmproxy-ca-cert.cer'
$MitmCaPem  = Join-Path $env:USERPROFILE '.mitmproxy\mitmproxy-ca-cert.pem'
$ExtDir     = $RepoRoot

function Log($m)  { Write-Host $m }
function Die($m)  { Write-Error $m; exit 1 }

function Find-Brave {
    if ($Brave)        { return $Brave }
    if ($env:BRAVE_BIN) { return $env:BRAVE_BIN }
    $onPath = Get-Command brave -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $cands = @(
        (Join-Path $env:ProgramFiles 'BraveSoftware\Brave-Browser\Application\brave.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'BraveSoftware\Brave-Browser\Application\brave.exe'),
        (Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\Application\brave.exe')
    )
    foreach ($c in $cands) { if ($c -and (Test-Path $c)) { return $c } }
    return $null
}

function Port-Free([int]$p) {
    -not (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

function Pick-Port {
    foreach ($p in 8118, 8119, 8120) { if (Port-Free $p) { return $p } }
    return 0
}

function Resolve-Port {
    if ($Port -ne 0) { return $Port }
    $p = Pick-Port
    if ($p -eq 0) { Die 'no free port in 8118-8120' }
    return $p
}

function Build-BraveCmd($braveExe, $p) {
    return "$braveExe --user-data-dir=`"$ProfileDir`" --load-extension=`"$ExtDir`" " +
           "--proxy-server=127.0.0.1:$p --proxy-bypass-list=127.0.0.1,localhost,<local> " +
           "--no-default-browser-check --no-first-run"
}

function Ensure-Provisioned {
    $mitm = Join-Path $InstallDir 'venv\Scripts\mitmdump.exe'
    if ((Test-Path $mitm) -and (Test-Path (Join-Path $InstallDir 'addon.py')) -and (Test-Path $MitmCaPem)) { return }
    Log 'First run: provisioning the bridge (one-time, may take a minute)...'
    & (Join-Path $PSScriptRoot 'install.ps1') -NoService -NoCa
}

function Ensure-CaTrusted {
    $found = Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -like '*mitmproxy*' }
    if ($found) { return }
    Log 'Trusting the bridge CA in CurrentUser\Root (shared across your Chromium browsers - see docs)...'
    # Import-Certificate (PKI module, present on 5.1+) adds to the user Root
    # store programmatically: no elevation, no interactive trust dialog, and no
    # certutil flag-order quirks. Removable via uninstall.ps1.
    Import-Certificate -FilePath $MitmCaCer -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
}

$script:BridgePid = $null
function Stop-Bridge {
    if ($script:BridgePid) { Stop-Process -Id $script:BridgePid -Force -ErrorAction SilentlyContinue }
    Remove-Item $PidFile, $LockFile -ErrorAction SilentlyContinue
}

function Acquire-Lock {
    if (Test-Path $LockFile) {
        $old = Get-Content $LockFile -ErrorAction SilentlyContinue
        if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
            Die "Phantom is already running (pid $old)"
        }
    }
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    $PID | Out-File -Encoding ascii $LockFile
}

function Bridge-Answers([int]$p) {
    # -SkipCertificateCheck is PowerShell 6+ only; the .cmd runs Windows
    # PowerShell 5.1, so we accept the bridge's mitmproxy cert via the .NET
    # callback instead (works on 5.1 and 6+). -UseBasicParsing avoids the
    # legacy IE-engine dependency on 5.1. The launcher's only HTTPS call is
    # this probe, so trusting all certs for its lifetime is contained.
    try {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
        $h = Invoke-WebRequest -Uri 'https://phantom-shield-bridge.test/probe' -Method Head `
            -Proxy "http://127.0.0.1:$p" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return [bool]$h.Headers['X-Phantom-Bridge-Version']
    } catch { return $false }
}

function Start-Bridge([int]$p) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    $exe = Join-Path $InstallDir 'venv\Scripts\mitmdump.exe'
    $a = "-s `"$(Join-Path $InstallDir 'addon.py')`" --listen-host 127.0.0.1 --listen-port $p --set connection_strategy=lazy"
    $proc = Start-Process -FilePath $exe -ArgumentList $a -PassThru -WindowStyle Hidden `
        -RedirectStandardError (Join-Path $LogDir 'bridge.log')
    $script:BridgePid = $proc.Id
    $proc.Id | Out-File -Encoding ascii $PidFile
    $logPath = Join-Path $LogDir 'bridge.log'
    for ($i = 0; $i -lt 20; $i++) {
        if (Bridge-Answers $p) { return }
        if ($proc.HasExited) {
            if (Test-Path $logPath) { Get-Content $logPath -Tail 20 | Write-Host }
            Die 'bridge process exited during startup'
        }
        Start-Sleep -Milliseconds 500
    }
    if (Test-Path $logPath) { Get-Content $logPath -Tail 20 | Write-Host }
    Die "bridge did not become reachable on port $p"
}

# --- main ---
$braveExe = Find-Brave
if (-not $braveExe) { Die 'Brave not found. Install it (https://brave.com/download) or pass -Brave <path>.' }

if ($PrintCmd) {
    Write-Output (Build-BraveCmd $braveExe (Resolve-Port))
    exit 0
}

try {
    Ensure-Provisioned
    Ensure-CaTrusted
    Acquire-Lock
    $p = Resolve-Port
    Start-Bridge $p
    Log "Phantom ready on 127.0.0.1:$p - launching Brave..."
    & $braveExe "--user-data-dir=$ProfileDir" "--load-extension=$ExtDir" `
        "--proxy-server=127.0.0.1:$p" '--proxy-bypass-list=127.0.0.1,localhost,<local>' `
        '--no-default-browser-check' '--no-first-run' | Out-Null
} finally {
    Stop-Bridge
}
