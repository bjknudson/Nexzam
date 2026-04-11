"""Build samples/demo-bank.bok from the samples/demo-bank directory.

Run:
    python scripts/build_demo_bok.py
"""

from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SAMPLES_DIR = ROOT / "samples"
SOURCE_DIR = SAMPLES_DIR / "demo-bank"
OUTPUT_FILE = SAMPLES_DIR / "demo-bank.bok"


def build_demo_bank_archive() -> None:
    if not SOURCE_DIR.exists():
        raise FileNotFoundError(f"Missing source directory: {SOURCE_DIR}")

    if OUTPUT_FILE.exists():
        OUTPUT_FILE.unlink()

    with zipfile.ZipFile(OUTPUT_FILE, "w", zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(SOURCE_DIR.rglob("*")):
            if file_path.is_file():
                archive.write(file_path, file_path.relative_to(SOURCE_DIR))


if __name__ == "__main__":
    build_demo_bank_archive()
    print(f"Wrote {OUTPUT_FILE}")
