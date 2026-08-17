#!/usr/bin/env bash
# Build the full release bundle: backend binary, Tauri .app, an ad-hoc
# deep re-sign, and a distributable zip.
#
# Run from the repo root:
#   source .venv/bin/activate
#   ./scripts/package_release.sh
#
# Output: src-tauri/target/release/bundle/macos/Nexzam.app and Nexzam.zip

set -euo pipefail

cd "$(dirname "$0")/.."

./scripts/build_backend_binary.sh

(cd app/frontend && npm run tauri:build)

APP="src-tauri/target/release/bundle/macos/Nexzam.app"

# `tauri build`'s own ad-hoc signing step does not reliably produce a
# valid resource-sealed signature once a large/nested resource (the
# frozen Python backend under Contents/Resources) is bundled in --
# `codesign --verify --deep --strict` fails with "code has no
# resources but signature indicates they must be present", and a
# downloaded copy is reported by Gatekeeper as "damaged" rather than
# merely from an unidentified developer. A local, un-quarantined copy
# launches fine regardless, because that broken seal is only checked
# by the stricter validation path Gatekeeper runs on quarantined
# files -- which is why this doesn't reproduce with a same-machine
# copy. Force a full deep re-sign to regenerate a consistent
# `_CodeSignature/CodeResources` seal covering every bundled file.
echo "Re-signing $APP ..."
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

ZIP_DIR="src-tauri/target/release/bundle/macos"
rm -f "$ZIP_DIR/Nexzam.zip"
(cd "$ZIP_DIR" && ditto -c -k --sequesterRsrc --keepParent Nexzam.app Nexzam.zip)

echo "Wrote $ZIP_DIR/Nexzam.zip"
