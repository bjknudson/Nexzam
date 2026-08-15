#!/usr/bin/env bash
# Freeze the FastAPI backend into a standalone binary with PyInstaller.
#
# Run from the repo root:
#   source .venv/bin/activate
#   ./scripts/build_backend_binary.sh
#
# Output: dist/backend/nexzam-backend/ (onedir bundle), which
# src-tauri/tauri.conf.json's bundle.resources maps into the packaged app.

set -euo pipefail

cd "$(dirname "$0")/.."

pyinstaller --name nexzam-backend --onedir --noconfirm \
  --distpath dist/backend --workpath build/backend --specpath build \
  --paths . \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.lifespan.on \
  --hidden-import uvicorn.protocols.http.h11_impl \
  --hidden-import multipart \
  --hidden-import multipart.multipart \
  app/backend/bundle_entrypoint.py

echo "Wrote dist/backend/nexzam-backend/"
