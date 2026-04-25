# Build an embedded Windows Python environment for the Electron app.
#
# Downloads a standalone CPython build for Windows from python-build-standalone,
# installs backend deps, and leaves it under electron\python-env\.
# Bundled into the .exe installer by electron-builder via extraResources.

$ErrorActionPreference = 'Stop'

$ScriptDir   = Split-Path -Parent $PSCommandPath
$ProjectRoot = Split-Path -Parent $ScriptDir
$ElectronDir = Join-Path $ProjectRoot 'electron'
$PythonEnvDir = Join-Path $ElectronDir 'python-env'

$PythonVersion     = '3.13'
$PythonFullVersion = '3.13.2'
$ReleaseTag        = '20250212'
$PlatformTag       = 'x86_64-pc-windows-msvc-shared'
$Tarball           = "cpython-$PythonFullVersion+$ReleaseTag-$PlatformTag-install_only_stripped.tar.gz"
$DownloadUrl       = "https://github.com/indygreg/python-build-standalone/releases/download/$ReleaseTag/$Tarball"

Write-Host "=== Building Windows Python Environment ==="
Write-Host "Architecture: x64 ($PlatformTag)"
Write-Host "Python: $PythonFullVersion"

if (Test-Path $PythonEnvDir) {
    Write-Host "Removing old python-env..."
    Remove-Item -Recurse -Force $PythonEnvDir
}

$TempDir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "openswarm-pyenv-$([guid]::NewGuid())") -Force
try {
    $ArchivePath = Join-Path $TempDir.FullName 'python.tar.gz'
    Write-Host "Downloading standalone Python..."
    Write-Host "URL: $DownloadUrl"
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ArchivePath -UseBasicParsing

    Write-Host "Extracting..."
    # tar is built-in on Windows 10+ (bsdtar) and handles .tar.gz natively.
    & tar -xzf $ArchivePath -C $TempDir.FullName
    if ($LASTEXITCODE -ne 0) { throw "tar extract failed" }

    $Extracted = Join-Path $TempDir.FullName 'python'
    if (-not (Test-Path $Extracted)) {
        Get-ChildItem $TempDir.FullName | Format-Table | Out-String | Write-Host
        throw "Expected extracted directory at $Extracted"
    }

    Move-Item -Path $Extracted -Destination $PythonEnvDir
    Write-Host "Python installed to $PythonEnvDir"
} finally {
    if (Test-Path $TempDir.FullName) {
        Remove-Item -Recurse -Force $TempDir.FullName
    }
}

$PythonBin = Join-Path $PythonEnvDir 'python.exe'
if (-not (Test-Path $PythonBin)) { throw "python.exe not found at $PythonBin" }

Write-Host "Python binary: $PythonBin"
& $PythonBin --version

# Ensure pip is present
& $PythonBin -m pip --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing pip..."
    & $PythonBin -m ensurepip --upgrade
    if ($LASTEXITCODE -ne 0) { throw "ensurepip failed" }
}

Write-Host "Installing backend dependencies..."
& $PythonBin -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }
& $PythonBin -m pip install -r (Join-Path $ProjectRoot 'backend\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw "pip install requirements failed" }

Write-Host "Installing debugger module..."
& $PythonBin -m pip install (Join-Path $ProjectRoot 'debugger')
if ($LASTEXITCODE -ne 0) { throw "pip install debugger failed" }

Write-Host "Verifying claude-agent-sdk..."
& $PythonBin -c "import claude_agent_sdk; print('claude-agent-sdk installed')"
if ($LASTEXITCODE -ne 0) { throw "claude-agent-sdk verification failed" }

# Cleanup. Drop test packages and any stale __pycache__/.pyc from the
# upstream tarball — we want our own freshly-compiled bytecode (next
# step), not whatever the upstream build happened to ship.
Write-Host "Cleaning up..."
Get-ChildItem -Path $PythonEnvDir -Recurse -Force -Directory `
    | Where-Object { $_.Name -in @('__pycache__','tests','test') } `
    | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $PythonEnvDir -Recurse -Force -Filter '*.pyc' `
    | Remove-Item -Force -ErrorAction SilentlyContinue

# Strip parts of the Python distribution we provably don't use at runtime.
# Each removal here has been individually verified — conservative on purpose.
# NOT removing pip/, babel/locale-data/, pygments lexers, or PIL — each had
# at least one weak import-evidence trail.
Write-Host "Stripping unused Python distribution files..."
$ToStrip = @(
    (Join-Path $PythonEnvDir 'include'),                          # C headers — never used at runtime
    (Join-Path $PythonEnvDir 'lib\python3.13\idlelib'),           # IDLE editor — headless backend has no GUI
    (Join-Path $PythonEnvDir 'lib\python3.13\tkinter'),           # Tk GUI toolkit — same
    (Join-Path $PythonEnvDir 'lib\python3.13\ensurepip'),         # Pip bootstrap — backend never installs at runtime
    (Join-Path $PythonEnvDir 'lib\python3.13\turtledemo'),        # Educational drawing examples
    (Join-Path $PythonEnvDir 'share')                             # Man pages / desktop integration
)
foreach ($p in $ToStrip) {
    if (Test-Path $p) { Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue }
}

# Pre-compile bytecode so cold backend startup skips parse+compile on
# every imported .py. Worth ~5-10s on Windows under Defender (parsing
# Python source is parser-bound; loading .pyc is just bytes). We cap
# concurrency at 4 — `-j 0` (all cores) is fine on dev boxes but
# unstable on small CI runners. Missing .pyc is non-fatal at runtime
# (Python falls back to in-memory compile), so we warn rather than fail.
Write-Host "Pre-compiling bytecode..."
& $PythonBin -m compileall -q -j 4 (Join-Path $PythonEnvDir 'lib')
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: some files failed to compile; runtime will fall back to in-memory compile." -ForegroundColor Yellow
}

$Size = (Get-ChildItem -Path $PythonEnvDir -Recurse -File `
    | Measure-Object -Property Length -Sum).Sum
$SizeMB = [math]::Round($Size / 1MB, 1)
$PycCount = (Get-ChildItem -Path $PythonEnvDir -Recurse -File -Filter '*.pyc' | Measure-Object).Count

Write-Host ""
Write-Host "=== Python Environment Ready ==="
Write-Host "Location: $PythonEnvDir"
Write-Host ("Size: {0} MB ({1} .pyc files)" -f $SizeMB, $PycCount)
Write-Host ""
