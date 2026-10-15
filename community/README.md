# Community presets

Every preset in [`presets/`](./presets) shows up in the **Community** tab of Jumpman.
People can preview it on their own batch before saving it, and fork (remix) it.

## Share your preset

1. In Jumpman, open **Looks → My presets**, then use **⋯ → Export file** on your preset.
   You get a `.jumpman-preset.json` file.
2. Rename it to something short and unique, like `golden-alley.json`, and put it in
   `community/presets/`.
3. Make sure it has an `author` (your GitHub handle) and a short `description`.
   Add a few `tags` such as `warm`, `film`, `portrait` or `night`.
4. Check it: `pnpm presets:validate`
5. Open a pull request titled `feat(presets): add <preset name>`.

## Rules

- Only the [preset schema](../packages/core/src/model/preset.ts) (`jumpman.preset/1`) is accepted.
  The validator removes unknown fields and clamps every value.
- Built-in LUTs (`builtin:*`) can be referenced freely. Custom LUTs must be embedded in
  the preset and must be your own work.
- Use names that don't imply an affiliation with a camera, film or software brand.
