# Phantom Shield bridge uninstaller for Windows.

[CmdletBinding()]
param(
    [switch]$RemoveCa,
    [switch]$Purge
)

$ErrorActionPreference = 'Stop'
# Parent data dir: holds the bridge venv AND the Phantom Browser launcher's
# isolated profile + logs. -Purge removes all of it.
$DataDir = Join-Path $env:LOCALAPPDATA 'phantom-shield'

function Stop-Bridge {
    $t = Get-ScheduledTask -TaskName 'PhantomShieldBridge' -ErrorAction SilentlyContinue
    if ($t) {
        Stop-ScheduledTask  -TaskName 'PhantomShieldBridge' -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName 'PhantomShieldBridge' -Confirm:$false
    }
}

function Remove-Ca {
    $certs = Get-ChildItem Cert:\CurrentUser\Root, Cert:\LocalMachine\Root |
        Where-Object { $_.Subject -like '*mitmproxy*' }
    foreach ($c in $certs) {
        Remove-Item -Path "Cert:\LocalMachine\Root\$($c.Thumbprint)" -ErrorAction SilentlyContinue
        Remove-Item -Path "Cert:\CurrentUser\Root\$($c.Thumbprint)" -ErrorAction SilentlyContinue
    }
}

Stop-Bridge
if ($RemoveCa) { Remove-Ca }
if ($Purge -and (Test-Path $DataDir)) { Remove-Item -Recurse -Force $DataDir }

Write-Host ''
Write-Host "Uninstall complete. Open the Phantom Shield extension options and"
Write-Host "click 'Clear' in the setup card to revert Brave's proxy setting."
