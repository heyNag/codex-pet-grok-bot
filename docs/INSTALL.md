# Install in Codex Pets

This repository includes two ready-to-install custom-pet bundles:

| Codex surface | Pet shown in the picker | Package ID | Bundle |
| --- | --- | --- | --- |
| Dark | Grok Bot Dark | `grok-bot-dark` | [`../pet/grok-bot-dark/`](../pet/grok-bot-dark/) |
| Light | Grok Bot Light | `grok-bot-light` | [`../pet/grok-bot-light/`](../pet/grok-bot-light/) |

The IDs are intentionally different, so both variants can remain installed on
the same computer. Selecting one does not replace the other.

## Install both variants

1. Clone or download this repository onto the computer running the ChatGPT
   desktop app. The generated `pet.json` and `spritesheet.webp` files are
   already committed; installation does not require a preview server or a
   build.
2. Find the absolute path to the checkout. In a terminal opened at the
   repository root, run:

   ```sh
   pwd
   ```

3. In the ChatGPT desktop app, open **Settings > Pets**, then select
   **Create your own pet**. The app installs its bundled `hatch-pet` skill,
   reloads skills, and opens a new chat.
4. Send the following prompt after replacing `<absolute-repository-path>` with
   the path printed by `pwd`:

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

5. Approve the local installation only after the task reports the two exact IDs,
   `grok-bot-dark` and `grok-bot-light`, and the intended destination paths.
6. When the task finishes, return to **Settings > Pets** and select **Refresh**.
   Both **Grok Bot Dark** and **Grok Bot Light** should appear independently.
7. Choose the variant that contrasts with the current app surface, then enter
   `/pet` or choose **Wake Pet** from the command menu.

The current official [Pets documentation](https://learn.chatgpt.com/docs/pets)
describes the creation, refresh, selection, and wake flow.

## Use from Codex CLI

Compatible custom pets installed on the computer also appear in the interactive
Codex CLI pet picker. Enter `/pets` or `/pet` to open the picker, choose
**Grok Bot Dark** or **Grok Bot Light**, and use `/pets off` to disable the
terminal pet. Terminal rendering requires a compatible terminal as described in
the official Pets documentation.

## Verify the repository before installing

This optional check needs Node.js 22 or newer, but still needs no global server
tool:

```sh
npm ci
npm run qa
```

For interactive inspection and a full pre-commit workflow, use
[LOCAL-TESTING.md](LOCAL-TESTING.md).

## Updating an installed variant

Pull or download the desired repository revision, run the optional verification,
then repeat the **Create your own pet** flow for only the package ID you intend
to update. A same-ID update replaces that local package, so inspect the exact
target and approve only that replacement. Refresh **Settings > Pets** afterward.
This replacement behavior comes from the current bundled desktop packaging
contract; the public Pets documentation does not currently describe a separate
desktop update control.

## Stop using or remove a pet

Choose another pet, enter `/pet` again, or select **Tuck Away Pet** to stop
showing the current pet. The public desktop documentation does not currently
describe deletion of a locally installed custom pet, so this repository does
not publish a destructive uninstall command.

This repository deliberately does not ship an installer or a command that
writes to Codex settings. Installation remains an explicit, reviewable action
inside the desktop app.
