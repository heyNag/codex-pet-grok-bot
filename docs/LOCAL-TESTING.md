# Local testing

Use this guide to inspect both Grok Bot variants before committing a change.

The build, QA, and browser-preview commands do not install either pet or write
to Codex settings. Local Codex activation is a separate, explicit step.

## 1. Run the portable browser preview

For experimental motion and edge comparisons, see the separate
[quality study](QUALITY-STUDY.md). Its candidates do not replace the shipping
bundles or install anything.

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

**Inspect frame** pauses the host-cell controller and swaps only the preview
pane to the static authoring atlas, so Previous/Next can inspect the exact key
poses. **Play fluid** restores the real animated shipping atlas. This inspection
swap is a preview tool; neither static authoring atlas is installed as a
fallback.

The renderer panel starts at the pixelated `7.04rem` host fallback, measured as
a `225 x 244` device-pixel footprint at DPR2. The preview keeps each visible
pet on an integer CSS origin while panes, sizes, and the viewport change so the
pixelated sample phase stays aligned with the host, including during scrolling.
Choose **96 px · native 1:1** only when source detail needs to be inspected
without resampling.

Use the **Pet size** control for the full scale review:

- `80 px`, `112 px`, `144 px`, and `224 px` exercise the optional integer-size
  range; none is an exact substitute for the `7.04rem` fallback;
- `96 px · native 1:1` is the source-detail reference, where one `192 px`
  source-cell width maps exactly to `192` physical display pixels; and
- **Smooth inspection** changes only the browser's filtering. It helps inspect
  the authored curves and edge treatment, but it does not represent the current
  Codex renderer and must be off for the host-faithful sign-off pass.

At the `7.04rem` fallback, watch the whole loop and its repeat boundary—not
just a paused frame. Confirm that the silhouette stays coherent, eye shapes
morph without popping, attached gestures remain connected, and neither theme
shows a different cadence or occupied area.

## 2. Test this checkout in the actual Codex desktop pet runtime

This step installs local copies of both pet bundles. Complete the browser
review first. It uses the manual creation flow intentionally so a maintainer can
test uncommitted files from the current checkout; ordinary users should use the
one-line path in [INSTALL.md](INSTALL.md).

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
7. At DPR2, leave the pet on its `7.04rem` fallback for the final runtime
   review. Use `96 px` only as the one-to-one source-detail comparison.
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

The actual Codex pass is the final rendering decision. The local preview can
faithfully reproduce the known size, filtering, cadence, and frame handoffs,
but only the desktop runtime verifies the complete compositor and the selected
machine's display scaling. Do not sign off an art change using only **Smooth
inspection** or only a paused Character Lab frame.

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
