# Canonical ReadAny feature rebuild

This checkout is an isolated worktree based on `upstream/main` (`60ca8699`). It
does not modify the existing fork checkout or either installed app. The test APK
uses the existing `preview` variant (`com.readany.app.preview`).

## What was ported

- 63 ordered feature/fix commits through `5cac289a`: Japanese furigana,
  dictionary lookup/import, AnkiDroid export, self-hosted TTS header and cache,
  library folders/shelf/import, paper themes, Web tab and reading companion,
  highlight export, backup/restore, sync extensions, and adaptive UI.
- The final reader features: bionic reading, constrained pen selection,
  highlight colours and controls, and the reader highlight-sync action.
- Native raw-byte SHA-256 for mobile files up to 16 MB, retaining chunked
  hashing for larger books. This avoids the fork's sync UI freeze while keeping
  hashes compatible with desktop.
- The original checkout's uncommitted manual content-hash backfill for legacy
  books, including its progress/cancel UI. This is only run when chosen in the
  library menu, and its 17 focused tests pass.
- The reader toolbar's timer now restarts while controls are touched, so it
  remains available during button and slider use. Reader asset loading has a
  deadline and retry instead of an indefinite spinner, and early JavaScript
  failures are reported to the host bridge.

Four intermediate stylus commits were omitted because their changes were
subsequently reverted. The currently uncommitted foldable WebView config plugins
and render-process reset in the original checkout were not ported. In
particular, this build has no `onLoadStart` readiness reset, which was the
verified cause of intermittent endless spinners and dead page taps.

## Validation so far

- `pnpm --filter @readany/core test`: 92 files / 791 tests passed.
- Mobile `tsc --noEmit`, reader HTML build, and Android release build passed.
- Preview APK installed beside `com.readany.app` and `com.readany.app.dev`.
- A disposable 65 KB EPUB imported into the preview library. Reopening it
  reached the book page, and a page tap advanced progress from 6% to 11%.
- A forced fold via `cmd device_state state 4` recreated the preview app and
  returned to its library. The book reopened while folded. Forced unfolding
  landed on the Honor lock screen, so the physical-hinge folded→unfolded reader
  transition is not yet validated. `cmd device_state state reset` was run.

## Decision before replacing the fork

The tracked app code matches the committed fork plus the native hash fix,
manual hash backfill, toolbar timer, asset retry, and early-error reporter. The
original checkout's uncommitted foldable WebView changes and highlight-rendering
edits remain separate. This port is a testable candidate, not proof that every
feature is free of reader regressions. Compare the preview and canonical apps
with the same EPUB under the physical hinge, then check a larger annotated book
and sync before moving this code into the existing dev package and preserving
its data.
