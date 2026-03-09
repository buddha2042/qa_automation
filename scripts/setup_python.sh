#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="${PYTHON_BIN:-python3}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Error: $PYTHON_BIN is not available. Install Python 3.10+ and retry." >&2
  exit 1
fi

if [ ! -d ".venv" ]; then
  "$PYTHON_BIN" -m venv .venv
fi

if [ ! -x ".venv/bin/python3" ]; then
  echo "Error: .venv was created but .venv/bin/python3 is missing." >&2
  exit 1
fi

.venv/bin/python3 -m pip install --upgrade pip
.venv/bin/python3 -m pip install -r requirements.txt

echo "Python setup complete (.venv with requirements installed)."
