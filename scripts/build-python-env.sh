#!/bin/bash
set -euo pipefail

# Build an embedded Python environment for the Electron app.
#
# Downloads a standalone Python build from python-build-standalone,
# creates a venv, and installs all backend dependencies.
# The resulting python-env/ directory is bundled into the Electron app.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ELECTRON_DIR="$PROJECT_ROOT/electron"
PYTHON_ENV_DIR="$ELECTRON_DIR/python-env"

PYTHON_VERSION="3.13"
PYTHON_FULL_VERSION="3.13.2"
ARCH="$(uname -m)"

if [[ "$ARCH" == "arm64" ]]; then
    PLATFORM_TAG="aarch64-apple-darwin"
elif [[ "$ARCH" == "x86_64" ]]; then
    PLATFORM_TAG="x86_64-apple-darwin"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

RELEASE_TAG="20250212"
TARBALL_NAME="cpython-${PYTHON_FULL_VERSION}+${RELEASE_TAG}-${PLATFORM_TAG}-install_only_stripped.tar.gz"
DOWNLOAD_URL="https://github.com/indygreg/python-build-standalone/releases/download/${RELEASE_TAG}/${TARBALL_NAME}"
TEMP_DIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "=== Building Python Environment ==="
echo "Architecture: $ARCH ($PLATFORM_TAG)"
echo "Python: $PYTHON_FULL_VERSION"

# Remove old env if present
if [[ -d "$PYTHON_ENV_DIR" ]]; then
    echo "Removing old python-env..."
    rm -rf "$PYTHON_ENV_DIR"
fi

# Download standalone Python
echo "Downloading standalone Python from python-build-standalone..."
echo "URL: $DOWNLOAD_URL"
curl -fSL --progress-bar -o "$TEMP_DIR/python.tar.gz" "$DOWNLOAD_URL"

echo "Extracting..."
tar xzf "$TEMP_DIR/python.tar.gz" -C "$TEMP_DIR"

# The tarball extracts to python/
EXTRACTED_DIR="$TEMP_DIR/python"
if [[ ! -d "$EXTRACTED_DIR" ]]; then
    echo "Error: Expected extracted directory at $EXTRACTED_DIR"
    ls -la "$TEMP_DIR"
    exit 1
fi

# Move into place
mv "$EXTRACTED_DIR" "$PYTHON_ENV_DIR"
echo "Python installed to $PYTHON_ENV_DIR"

PYTHON_BIN="$PYTHON_ENV_DIR/bin/python${PYTHON_VERSION}"
if [[ ! -f "$PYTHON_BIN" ]]; then
    PYTHON_BIN="$PYTHON_ENV_DIR/bin/python3"
fi

echo "Python binary: $PYTHON_BIN"
"$PYTHON_BIN" --version

# Install pip (standalone builds may not include it)
if ! "$PYTHON_BIN" -m pip --version &>/dev/null; then
    echo "Installing pip..."
    "$PYTHON_BIN" -m ensurepip --upgrade
fi

# Install backend dependencies
echo "Installing backend dependencies..."
"$PYTHON_BIN" -m pip install --upgrade pip
"$PYTHON_BIN" -m pip install -r "$PROJECT_ROOT/backend/requirements.txt"

# Install the debugger module
echo "Installing debugger module..."
"$PYTHON_BIN" -m pip install "$PROJECT_ROOT/debugger"

# Verify claude-agent-sdk and its bundled binary
echo "Verifying claude-agent-sdk..."
"$PYTHON_BIN" -c "import claude_agent_sdk; print(f'claude-agent-sdk installed')"

CLAUDE_BIN=$("$PYTHON_BIN" -c "
from pathlib import Path
import claude_agent_sdk
sdk_dir = Path(claude_agent_sdk.__file__).parent
bundled = sdk_dir / '_bundled' / 'claude'
print(bundled)
")
if [[ -f "$CLAUDE_BIN" ]]; then
    echo "Claude binary found: $CLAUDE_BIN"
    chmod +x "$CLAUDE_BIN"
else
    echo "WARNING: Claude binary not found at $CLAUDE_BIN"
fi

# Clean up build artifacts to reduce size. Drop test packages and any
# stale __pycache__/.pyc from the upstream Python tarball — we want our
# own freshly-compiled bytecode (next step), not whatever the upstream
# build happened to ship.
echo "Cleaning up..."
find "$PYTHON_ENV_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$PYTHON_ENV_DIR" -name "*.pyc" -delete 2>/dev/null || true
find "$PYTHON_ENV_DIR" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find "$PYTHON_ENV_DIR" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true

# Strip parts of the Python distribution we provably don't use at runtime.
# Each removal here has been individually verified — see the audit notes in
# the project plan. Doing this BEFORE compileall would also work, but doing
# it after means the dirs are already definitely-not-imported (compileall
# would have surfaced any backend code that touches them).
#
# Conservative on purpose. NOT removing pip/, babel/locale-data/, pygments
# lexers, or PIL — each had at least one weak import-evidence trail.
echo "Stripping unused Python distribution files..."
# C headers — only needed when building C extensions, never at runtime.
rm -rf "$PYTHON_ENV_DIR/include"
# IDLE editor + Tk GUI toolkit — embedded headless backend has no UI.
rm -rf "$PYTHON_ENV_DIR/lib/python3.13/idlelib"
rm -rf "$PYTHON_ENV_DIR/lib/python3.13/tkinter"
# Pip bootstrap module — backend never installs packages at runtime.
rm -rf "$PYTHON_ENV_DIR/lib/python3.13/ensurepip"
# Educational drawing examples that ship with stdlib — never imported.
rm -rf "$PYTHON_ENV_DIR/lib/python3.13/turtledemo"
# Man pages / desktop-integration files — embedded Python doesn't read these.
rm -rf "$PYTHON_ENV_DIR/share"

# Pre-compile bytecode so cold backend startup skips the parse+compile
# step on every imported .py. Worth ~5-10s on Windows under Defender
# (parsing Python source is parser-bound; loading .pyc is just bytes).
# Concurrency capped at 4 — `-j 0` (all cores) is fine on dev boxes
# but unstable on small CI runners. Failures on individual files are
# survivable (compileall continues on SyntaxError-tagged files used by
# version-shim packages); a non-zero exit here would rather be visible
# than silent so we don't `|| true` the whole thing — but missing .pyc
# is non-fatal at runtime, so a hard fail isn't warranted either.
echo "Pre-compiling bytecode..."
"$PYTHON_BIN" -m compileall -q -j 4 "$PYTHON_ENV_DIR/lib" || \
    echo "WARNING: some files failed to compile; runtime will fall back to in-memory compile."

TOTAL_SIZE=$(du -sh "$PYTHON_ENV_DIR" | cut -f1)
PYC_COUNT=$(find "$PYTHON_ENV_DIR" -name '*.pyc' -type f | wc -l | tr -d ' ')
echo ""
echo "=== Python Environment Ready ==="
echo "Location: $PYTHON_ENV_DIR"
echo "Size: $TOTAL_SIZE ($PYC_COUNT .pyc files)"
echo ""
