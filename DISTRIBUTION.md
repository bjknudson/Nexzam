# Sharing a Nexzam build with testers

This is an early beta build for feedback, not a finished release. It isn't
code-signed yet, so macOS will show a warning the first time it's opened.

## Building a copy to share

```bash
source .venv/bin/activate
./scripts/build_backend_binary.sh
cd app/frontend
npm run tauri:build
```

This produces `src-tauri/target/release/bundle/macos/Nexzam.app`. Zip it for
sharing:

```bash
cd src-tauri/target/release/bundle/macos
ditto -c -k --sequesterRsrc --keepParent Nexzam.app Nexzam.zip
```

Send testers `Nexzam.zip`.

## Instructions for testers

1. Unzip `Nexzam.zip` and drag `Nexzam.app` to Applications (or run it from
   wherever you unzipped it).
2. On first launch, macOS will say it can't verify the developer. **Right-click**
   (or Control-click) `Nexzam.app` and choose **Open**, then click **Open**
   again in the dialog that appears. This is only needed once.
3. Click **Open Demo Bank** to try it with sample data, or **Open Bank** to
   open a `.bok` file.

This build has no auto-update mechanism yet — a new build has to be sent
manually for now.
