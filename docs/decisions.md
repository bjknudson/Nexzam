# Architecture Decision Notes

## ADR-001: Desktop-first local architecture

- **Status:** accepted
- **Decision:** use Tauri shell + local Python service.
- **Why:** low overhead desktop delivery with strong local integration.

## ADR-002: `.bok` as canonical package format

- **Status:** accepted
- **Decision:** `.bok` is a zip container with explicit internal folders/files.
- **Why:** portability, inspectability, and easy backup/versioning.

## ADR-003: Unpack/edit/repack workflow

- **Status:** accepted
- **Decision:** extract to managed working directory, edit unpacked files, repack on save.
- **Why:** safer than in-place zip mutation and easier to validate.

## ADR-004: No auth/encryption in v1

- **Status:** accepted
- **Decision:** rely on local OS security and file permissions.
- **Why:** keeps v1 focused and avoids false security claims.

## ADR-005: Parameterized SVG in schema from v1

- **Status:** accepted
- **Decision:** include SVG variable maps in asset metadata at launch.
- **Why:** enables future template workflows without schema breakage.
