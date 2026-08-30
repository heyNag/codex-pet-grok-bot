# Local testing

Use this guide to inspect both Grok Bot variants before committing a change.

The build, QA, and browser-preview commands do not install either pet or write
to Codex settings. Local Codex activation is a separate, explicit step.

## 1. Run the portable browser preview

The preview uses the repository's built-in Node server through its `npm` script.

From the repository root:

```sh
cd /path/to/codex-pet-grok-bot
npm ci
npm run qa
npm run preview
```

`npm run preview` stays in the foreground and prints the preview address. Open
[http://localhost:4173](http://localhost:4173) in a browser. On macOS, you can
also open it from a second terminal:

```sh
open http://localhost:4173
```

Keep the first terminal running while you test. Press <kbd>Control</kbd> +
<kbd>C</kbd> in that terminal when you are finished.

### What to inspect

The preview opens in **Compare both** mode, with the two variants driven by one
synchronized controller. Use **Dark Codex** or **Light Codex** when you want a
larger focused view, then return to **Compare both** to check parity:

- `grok-bot-dark`: white bot with black eyes on a dark Codex surface.
- `grok-bot-light`: black bot with white eyes on a light Codex surface.

For each variant, inspect:

- every installed Codex behavior and its animation sequence;
- all 16 pointer-gaze directions;
- all 39 character states;
- all 14 effects and their lossless 60 fps motion studies;
- host timing, animation continuity, and state handoffs.

In **Compare both** mode, every behavior, character-state, gaze, transport,
effect, and atlas control updates both panes together. This makes shape, timing,
alpha, and inverse-color differences easier to spot without trying to
synchronize two browser tabs by hand.

## 2. Test in the actual Codex desktop pet runtime

This step installs local copies of both pet bundles. Complete the browser
review first.

1. In the ChatGPT desktop app, open **Settings > Pets**.
2. Select **Create your own pet**. The app installs its bundled `hatch-pet`
   skill, reloads skills, and opens a new chat for creating or installing a
   custom pet.
3. Run `pwd` from the repository root, then send this prompt after replacing
   `<absolute-repository-path>` with that output:

```text
Install both existing validated Codex v2 pet bundles from this repository
without changing them:

<absolute-repository-path>/pet/grok-bot-dark
<absolute-repository-path>/pet/grok-bot-light

Keep each folder name and pet.json ID unchanged so the two pets remain separate.
Use the existing pet.json and spritesheet.webp files. Do not rebuild or edit the
source repository. If either destination ID already exists, show me that exact
conflict and ask before replacing it. Do not modify any other pet.
```

Preserve the bundle folder names and manifest IDs. Their distinct IDs,
`grok-bot-dark` and `grok-bot-light`, allow both pets to remain installed
without replacing one another.

4. Approve the local installation only after the task reports the exact IDs and
   intended destination paths.
5. When the installation task finishes, return to **Settings > Pets** and
   select **Refresh**.
6. Choose **Grok Bot Dark** while Codex is using its dark theme, then enter
   `/pet` to wake it.
7. Exercise the states below and inspect the matching animation.
8. Repeat with **Grok Bot Light** while Codex is using its light theme.

Codex desktop reports these activity states:

| Status | What to verify |
| --- | --- |
| Running | A task is actively working and the pet plays its active-work choreography. |
| Needs input | A task needs an approval, answer, or decision and the pet plays its waiting-for-input choreography. |
| Ready | A task completed and has unread activity, producing the ready-for-review choreography. |
| Blocked | A task failed or encountered a system error, producing the blocked choreography. |

The current [official Pets documentation](https://learn.chatgpt.com/docs/pets)
describes choosing and waking a pet, custom-pet creation, and the desktop status
meanings.

For the shorter public installation guide, including Codex CLI selection and
updating one theme without replacing the other, see [INSTALL.md](INSTALL.md).

## 3. Check the tree before a follow-up commit

After visual and Codex-runtime approval, run:

```sh
npm run qa
git diff --check
git status --short
```

Review the reported changes and commit only the files you intended to change.
Do not treat a successful build alone as visual approval: inspect both variants
in the browser preview and, for release-bound changes, in the actual Codex
desktop runtime first.
