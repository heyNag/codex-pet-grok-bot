# Color system

The character treatment uses exact monochrome opposites according to surface
theme and one six-color accent palette for motion. The Codex v2 asset is a
static WebP, so this repository emits two deterministic pet IDs instead of
attempting runtime theme detection.

## Theme variants

| Repository variant | Manifest ID | Intended surface | Body | Eyes | Keyline |
| --- | --- | --- | --- | --- | --- | --- |
| Dark | `grok-bot-dark` | Dark Codex UI | `#FFFFFF` | `#000000` | `#000000` |
| Light | `grok-bot-light` | Light Codex UI | `#000000` | `#FFFFFF` | `#FFFFFF` |

Geometry, animation timing, effect placement, and accent hues are identical
between variants. Only the body, eye, and keyline values invert. The keyline is
drawn at `1.4` character-coordinate units with `0.13` opacity; it is a
restrained **Codex rasterization aid**, not a glow or new permanent character
outline.

The matching manifests are
[`../pet/grok-bot-dark/pet.json`](../pet/grok-bot-dark/pet.json) and
[`../pet/grok-bot-light/pet.json`](../pet/grok-bot-light/pet.json). Selecting
the right bundle is explicit because neither a manifest nor a WebP atlas can
change its pixels after Codex loads it.

## Exact accent palette

| Repository label | Hex | Use in this adaptation |
| --- | --- | --- |
| Coral | `#F9705C` | warm whirl/ribbon, fleck, and impact phases |
| Blue | `#5B95F0` | cool whirl/ribbon and directional phases |
| Green | `#3FBE86` | ribbon, gather, and completion phases |
| Gold | `#F5B13F` | bright celebration and attention phases |
| Violet | `#9A72EE` | whirl/ribbon and thought phases |
| Teal | `#35C3BD` | whirl/ribbon and progress phases |

The human-readable color names are repository labels. Hex values are shown in
uppercase for repository consistency. No additional accent colors are
introduced. The build-time palette is defined in
[`../src/grok-art.mjs`](../src/grok-art.mjs).

## Color rules

1. **Monochrome carries identity.** Body and eyes stay exact opposites. Accent
   colors do not recolor the canonical blob or become permanent facial detail.
2. **Color belongs to motion.** The six accents appear in supported whirl,
   ribbon, trail, fleck, and completion treatments—not as permanent body or
   face color.
3. **Rear/body/front layering matters.** A ribbon may pass behind and then in
   front of the body to read as a wrap; it must not flatten into a badge pasted
   over the face.
4. **Effects remain sparse outside celebration.** Ordinary idle and work poses
   rely on silhouette and eyes. Full-palette density is reserved for high-energy
   completion beats.
5. **Transparency is clean.** Unused cells and empty pixels are RGBA
   `(0, 0, 0, 0)`; no colored RGB residue is hidden under zero alpha.
6. **`orbit` stays monochrome.** The `orbit` effect is five body-color dots
   with depth conveyed by size and opacity. It is not a six-color satellite
   ring. The opposed two-satellite ambient track is the separate `humming`
   choreography.

## Motion palette usage

The presence of six accent colors does not mean every effect uses every color.
In particular, `orbit` remains monochrome. Celebration can build from sparse
flecks into thick multi-angle rainbow ribbons with rear/front occlusion. The
paired opposed ambient satellites stay monochrome. Neither treatment changes
the palette or the 14-mode morph registry.

See [CHARACTER-SPEC.md](CHARACTER-SPEC.md) for the effect model and
[DESIGN.md](DESIGN.md) for the acting/effect boundary.
