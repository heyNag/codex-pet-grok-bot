# Install in Codex Pets

This repository ships two independent Codex pet bundles:

| Codex surface | Pet shown in the picker | Package ID | Installed path |
| --- | --- | --- | --- |
| Dark | Grok Bot Dark | `grok-bot-dark` | `$CODEX_HOME/pets/grok-bot-dark` |
| Light | Grok Bot Light | `grok-bot-light` | `$CODEX_HOME/pets/grok-bot-light` |

When `CODEX_HOME` is not set, it defaults to `~/.codex`. The IDs and directory
names are intentionally different, so both variants can remain installed at
the same time.

## Install with one command

Install both variants:

```sh
curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/heyNag/codex-pet-grok-bot/main/install.sh | sh -s -- both
```

Or install only the variant that contrasts with your Codex surface:

```sh
# Dark Codex surface
curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/heyNag/codex-pet-grok-bot/main/install.sh | sh -s -- dark

# Light Codex surface
curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/heyNag/codex-pet-grok-bot/main/install.sh | sh -s -- light
```

No clone, Node.js installation, build, or setup prompt is required. The command
needs `curl` and one of `sha256sum`, `shasum`, or `openssl` for verification.
It also uses the standard `sync` utility to make transaction boundaries durable
before and after an update.

When it finishes, open **Settings > Pets**, select **Refresh**, choose
**Grok Bot Dark** or **Grok Bot Light**, then enter `/pet` or choose
**Wake Pet**.

The one-line channel requires the repository's raw files to be publicly
readable. If access is restricted or you are testing before publication, use
the [manual fallback](#optional-manual-fallback) instead.

## Install and update behavior

The same one-argument command is safe to rerun whenever a new release is
available. For each selected variant it:

- installs the bundle when its exact destination is missing;
- leaves an already-current managed bundle unchanged;
- registers an exact, current bundle that was installed manually; or
- updates an older, unmodified bundle previously managed by this installer.

An update always replaces the same exact destination. It never creates a
numbered, release-suffixed, or otherwise duplicated pet ID.

The bootstrap script is fetched from `main`, but every released script pins its
pet assets to an immutable repository commit. Downloads are staged under
`CODEX_HOME` and checked against embedded byte sizes and SHA-256 hashes before
anything is installed.

Each managed bundle includes a small ownership receipt. The installer replaces
only a matching, unmodified receipt-owned bundle. It refuses symlinked targets,
non-directory collisions, locally modified or unmanaged bundles, and invalid
receipts rather than guessing ownership or overwriting a collision.

Before replacing a managed bundle, the previous directory is temporarily
renamed under:

```text
$CODEX_HOME/pet-backups/.grok-bot-transaction-<timestamp>-<process-id>/.previous-<package-id>-<timestamp>-<process-id>
```

That transaction path is outside `$CODEX_HOME/pets`, so it cannot appear as
another Grok Bot in the pet picker. Once the new bundle passes its final
post-install verification, the temporary previous directory is removed. If
placement or verification fails, the new directory is cleaned up and the
previous directory is renamed back. A copy that cannot be restored or removed
safely is retained at the reported transaction path rather than destroyed.

The installer records a durable transaction journal before it changes an
active pet. If the shell is forcibly killed or the computer loses power, rerun
the same command. A valid interrupted transaction owned by a process that is no
longer running is recovered automatically: an unfinished replacement is rolled
back before the fresh update starts, while a fully verified committed update is
kept and only its temporary files are cleaned. Live, malformed, or unexpected
lock contents are refused for inspection instead of being guessed away.

All selected bundles are verified before the replacement phase begins. It does
not edit Codex settings or touch other pet IDs.

## Explicit update-only command

The ordinary `dark`, `light`, or `both` command already installs or updates as
needed. To require that the selection is installed before doing anything, add
`update`:

```sh
curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/heyNag/codex-pet-grok-bot/main/install.sh | sh -s -- update both
```

Replace `both` with `dark` or `light` to update one variant. The update-only
form stops without installing if a selected destination is missing. Refresh
**Settings > Pets** after an update.

## Optional manual fallback

Use this flow when the raw repository URL is unavailable or when you want to
review every local copy step in the Codex desktop app.

1. Clone or download this repository on the computer running Codex. The ready
   `pet.json` and `spritesheet.webp` files are committed; no build is needed.
2. In the repository root, run `pwd` to get its absolute path.
3. Open **Settings > Pets**, select **Create your own pet**, and wait for the
   setup task to open.
4. Send this prompt after replacing `<absolute-repository-path>`:

   ```text
   Install both existing validated Codex v2 pet bundles from this repository
   without changing them:

   <absolute-repository-path>/pet/grok-bot-dark
   <absolute-repository-path>/pet/grok-bot-light

   Keep each folder name and pet.json ID unchanged so the two pets remain
   separate. Use the existing pet.json and spritesheet.webp files. Do not rebuild
   or edit the source repository. If either destination ID already exists, show
   me that exact conflict and ask before replacing it. Do not modify any other
   pet.
   ```

5. Approve only the two exact IDs and destinations, then return to
   **Settings > Pets** and select **Refresh**.

To install one variant manually, include only its bundle path in the prompt.

## Use from Codex CLI

Compatible custom pets installed on the computer also appear in the interactive
Codex CLI pet picker. Enter `/pets` or `/pet`, choose **Grok Bot Dark** or
**Grok Bot Light**, and use `/pets off` to disable the terminal pet. Terminal
rendering requires a compatible terminal as described in the official
[Pets documentation](https://learn.chatgpt.com/docs/pets).

## Optional repository verification

This check needs Node.js 22 or newer:

```sh
npm ci
npm run qa
```

For interactive inspection and the full pre-commit workflow, see
[LOCAL-TESTING.md](LOCAL-TESTING.md).

## Troubleshooting

- If `curl` reports `404`, confirm the repository is publicly accessible or use
  the manual fallback.
- If the installer reports an unmanaged, modified, symlinked, or invalid
  destination, inspect that exact path. Nothing there was replaced.
- If a previous run was interrupted, rerun the same command first; valid stale
  transaction state is recovered automatically. If the installer instead
  reports a live or inspectable lock, check the exact reported path rather than
  deleting it blindly.
- If the pet is installed but absent from the picker, open
  **Settings > Pets** and select **Refresh** again.

## Stop using or remove a pet

Choose another pet, enter `/pet` again, or select **Tuck Away Pet** to stop
showing the current pet without deleting it.

To remove both installer-managed editions:

```sh
curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/heyNag/codex-pet-grok-bot/main/install.sh | sh -s -- remove both
```

Replace `both` with `dark` or `light` to remove one edition. A selected pet
that is already absent is reported and left unchanged.

Removal preflights every selected active directory before moving anything. It
accepts only the exact `grok-bot-dark` and `grok-bot-light` paths with valid
ownership receipts and unmodified receipt-bound files. Symlinks, unmanaged
directories, local edits, extra files, and non-directory collisions are refused
without deletion.

Owned pets are first renamed into a uniquely named quarantine directly under
`CODEX_HOME`, outside the `pets` directory. If a selected rename fails, pets
already moved during that command are restored to their exact active paths.
After all selected renames succeed, the installer revalidates each quarantined
bundle, removes only its exact three owned files, and removes the empty
quarantine. It does not inspect or delete other pet IDs, existing
`pet-backups`, or ambiguous artifacts.
