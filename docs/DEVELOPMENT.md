# Development and release verification

This document collects the maintainer workflow behind the generated Grok Bot
bundles. People installing the finished pets do not need these steps; start
with [INSTALL.md](INSTALL.md) instead.

All build, preview, validation, and QA commands are read-only with respect to
Codex settings and local pet directories. Installation is a separate, explicit
invocation of `install.sh`; its tests use disposable `CODEX_HOME` fixtures.

## Requirements

- Node.js 22 or newer for ordinary development, validation, and preview work.
- The npm version selected by the repository's `packageManager` field.
- A local checkout of this repository.

Install the pinned dependencies once:

```sh
npm ci
```

## Build and inspect

```sh
npm run build
npm test
npm run validate
npm run qa
npm run preview
```

`npm run build` regenerates both animated shipping atlases, their static
authoring atlases, and their code-native contact-sheet inspection artifacts.
The separately pinned 60 fps studies use `npm run build:source-motion`.
`npm run qa` is the ordinary
final verification command: it rebuilds the local artifacts, validates both
bundles and every embedded animation page, checks exact theme parity,
regenerates the runtime-faithful lossless previews, runs the negative tests,
and verifies the committed evidence seal. It does not rewrite that seal. The
shared `npm run qa:prepare` prefix performs the same deterministic build and
check chain without checking or writing the final visual-review and evidence
seals.

The browser preview opens both variants side by side, plays the desktop host
cadence, exposes every supported behavior and gaze direction, and includes the
39-state Character Lab plus all 14 effect studies. See
[LOCAL-TESTING.md](LOCAL-TESTING.md) for the visual review checklist and actual
desktop-runtime testing.

The complete host state machine, timing, discovery, rendering, animated-raster,
and performance contract is recorded in
[CODEX-PET-RUNTIME.md](CODEX-PET-RUNTIME.md). Keep that reference synchronized
with runtime-facing changes even when a detail is not needed in the README.

The committed arbitrary-phase report is checked portably with
`npm run qa:phases:check`; this path uses Node only and is part of `npm run qa`.
Maintainers regenerating the complete 27,140,880-trace numeric report
(6,785,220 per renderer path and theme) can run `npm run qa:phases` with
Python 3, NumPy, and Pillow available. Set
`ARBITRARY_PHASE_PYTHON` when that interpreter is not the default `python3`.
Generation is intentionally separate from the portable sealed-report check.
The compressed authored-profile baseline seals every cell and host edge, not
only the weakest family-wide extrema. `--write-baselines` is deliberately only
a reproducibility check: it compares against the current local profiles and
refuses any replacement whose bytes differ from the existing seal. After an
intentional visual change has been reviewed, the distinct
`--replace-baselines-reviewed` mode creates a candidate replacement; review its
per-cell/per-edge profiles, then update the two explicit baseline digests in
the Python and Node checkers before regenerating the normal report. Both write
modes are atomic, reject calibration mode, and refuse to replace the seal
unless the ordinary non-calibration gates already pass.

The runtime panes default to the pixelated `7.04rem` host fallback, measured at
`112.6328125 x 122.015625` CSS px and `225 x 244` device px at DPR2. The size
selector also includes a **96 px · native 1:1** source-detail reference and the
wider supported range. The preview uses the atlas aspect ratio directly and
snaps each visible runtime pane to an integer CSS origin after layout, theme,
size, resize, or scroll changes so the default pixelated sampling phase matches the
host contract. **Smooth inspection** is a diagnostic
view of the authored curves and alpha edge, not a release-acceptance rendering
mode. Switch it off before evaluating runtime continuity, then use the actual
Codex desktop runtime as the final compositor and display-scaling check.

## README showcase

The landing-page animation is rendered from the two committed shipping atlases,
with baked dark and light backgrounds so neither variant disappears against a
GitHub theme. Regenerate it after an intentional atlas change:

```sh
node scripts/build-readme-showcase.mjs
```

The generator writes `preview/readme-showcase.webp` and a small verification
manifest beside it. The test suite verifies the animation dimensions, frame
timing, output hash, and both source-atlas hashes. For an exact regeneration
check, run:

```sh
node scripts/build-readme-showcase.mjs --check
```

## Distribution installer

[`../install.sh`](../install.sh) is the public install and update channel. Its
one-argument `dark`, `light`, or `both` form synchronizes the selected bundle:
it installs a missing copy, leaves a current copy alone, and updates only an
unmodified copy already owned by the installer. The `update` form adds an
update-only precondition and refuses a missing selection.

The script downloaded from `main` must never download pet assets from a moving
branch. `SOURCE_REF` pins the assets to an immutable commit, and the embedded
file sizes and SHA-256 values pin their exact bytes. Each installed bundle gets
an ownership receipt containing its variant, package ID, release, source ref,
and asset hashes. Preserve these checks: they are what let a later run
distinguish a managed, unmodified bundle from a collision or local edit.

When shipping changed pet assets:

1. Commit the validated `pet.json` and `spritesheet.webp` files first.
2. Set `SOURCE_REF` to that asset commit and update `RELEASE`, both embedded
   file sizes, and both SHA-256 hashes in `install.sh`.
3. Exercise install, no-op rerun, managed update, `both`, collision refusal,
   checksum failure, symlink refusal, backup, and rollback behavior through the
   installer tests.
4. Run the complete verification suite before publishing the updated script.

Useful direct checks are:

```sh
sh -n install.sh
node --test test/installer.test.mjs
npm run qa
```

CI runs the installer suite on both macOS and Ubuntu so the public script stays
portable across the default macOS `sh` and a standard Linux `sh`.

The production default source is HTTPS. `GROK_BOT_INSTALL_SOURCE_BASE` exists
only so tests can supply a controlled local source while retaining the same
size and checksum verification. The installer writes exact package IDs under
`$CODEX_HOME/pets`, stages all selected downloads before replacement, preserves
older managed copies temporarily outside the active pets directory for rollback,
removes them after final verification, and refuses symlinked, unmanaged,
modified, or invalid-receipt destinations. Keep the manual app-mediated route
in [INSTALL.md](INSTALL.md) as a fallback, not the primary distribution path.

Every mutating run publishes a strict, atomically replaced transaction journal
before it changes an active pet. The journal distinguishes a prepared
transaction from a fully verified commit and names only exact, marker-owned
staging and rollback directories outside the active `pets` directory. A later
run serializes stale-lock recovery, rolls back a prepared transaction, keeps a
verified committed transaction, and removes its temporary files. Do not weaken
the journal parser, path-component checks, ownership markers, or dead-process
checks. The installer suite fault-injects both catchable termination and
`SIGKILL`; retain those tests whenever the transaction flow changes.

## Release-quality evidence workflow

The evidence under [`../qa/`](../qa/) is intentionally review-sensitive. A
final art change requires all deterministic outputs to be regenerated, followed
by the audited hatch-pet validation, contact-sheet, direction, and GIF tools;
five independent blind direction reviews; and an original-detail visual review
of both themes, all runtime rows, all 39 character states, and all 14 effects.

The portable read-only recheck is:

```sh
npm run qa:official
```

It verifies the resulting seal against the current atlas cells, PNG pixels,
GIF timing tables, continuity reports, and eight pinned official-tool hashes.
It neither requires those tools to be installed nor rewrites the seal.

If a maintainer has genuinely regenerated the official artifacts with the
audited hatch-pet tools, the explicit local reseal is:

```sh
HATCH_PET_SCRIPTS_ROOT=/absolute/path/to/hatch-pet/scripts \
  npm run qa:official -- --seal
```

The path defaults to the bundled ChatGPT macOS hatch-pet scripts when the
environment variable is omitted. Resealing refuses any tool whose bytes do not
match the eight independently pinned hashes.

## Lossless source-motion studies

The source-motion studies are review-sensitive rather than ordinary build
products. Regenerate them only with the repository's pinned Node `v26.8.1`,
Sharp `0.35.4`, libvips `8.18.6`, WebP `1.6.0`, librsvg `2.62.91`,
Cairo `1.18.4`, and Pixman `0.46.4` stack:

```sh
npm run build:source-motion
npm run qa:source-motion
```

The generator checks that full encoder tuple before deleting or writing any
motion artifact. The source-motion QA then verifies all 14 effects in both
themes, exact timing, dimensions, hashes, and the maximum active-frame hold.
The broader Node.js 22-or-newer requirement remains valid for the ordinary pet
build, preview, validation, and tests.

For an intentional reviewed change, run the complete deterministic preparation
before attesting the resulting artifacts:

```sh
npm run qa:prepare
npm run qa:review -- --reviewed-at <completed-review-time-in-canonical-UTC>
```

Only after that review genuinely passes should a maintainer run:

```sh
npm run qa:seal
npm run qa
```

Do not use `qa:seal` merely to silence changed hashes. It records the reviewed
artifacts, independent direction verdicts, motion-study metadata, and final
human/agent visual attestation. Before writing the evidence file, `qa:seal`
reruns the same full `qa:prepare` chain as `npm run qa` and requires the visual
review to remain current. That makes a deterministic artifact or QA-code change
fail before it can be sealed beside an older report. CI rebuilds only the
code-native shipping atlases; font-bearing contact sheets are audited,
committed evidence rather than a cross-platform byte-reproducibility claim.

## Before committing

```sh
npm run qa
git diff --check
git status --short
```

Review the exact changes before committing. A successful build is not visual
approval: inspect both variants in the browser preview and, for release-bound
art changes, in the actual Codex desktop runtime.
