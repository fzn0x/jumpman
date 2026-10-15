# Contributing to Jumpman

Thanks for helping make batch photo editing better for everyone. All kinds of contributions are welcome:
bug reports, features, docs, translations, design feedback and community presets.

## Ground rules

- Be kind. This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md).
- Discuss big changes in an issue first, so nobody's work is wasted.
- Photos never leave the user's device. Changes that upload, track or phone home won't be accepted.

## Development setup

You need [Node.js](https://nodejs.org) 22.12 or newer and [pnpm](https://pnpm.io) 10.

```sh
git clone https://github.com/fzn0x/jumpman.git
cd jumpman
pnpm install        # also installs the git hooks
pnpm dev            # web app on http://localhost:5173
pnpm dev:site       # landing page
```

| Command | What it does |
| --- | --- |
| `pnpm test` | Unit tests for the editing engine (Vitest) |
| `pnpm typecheck` | TypeScript 7 across all packages |
| `pnpm lint` / `pnpm lint:fix` | Biome lint and format |
| `pnpm build` | Production builds of the web app and the site |
| `pnpm presets:validate` | Checks every community preset |
| `pnpm --filter @jumpman/web build:android` | Builds the web app and syncs it into the Android project |

## Project layout

```
packages/core       Pure TypeScript engine: edit model, color science, analysis, file formats (tested)
packages/renderer   WebGL2 renderer that mirrors the core CPU pipeline
apps/web            React 19 PWA + Capacitor Android app
apps/site           Astro landing page and community preset gallery
community/presets   Presets contributed by the community
brand               Logo and wordmark
```

The CPU pipeline in `packages/core/src/color/pipeline.ts` is the reference for every pixel operation.
If you change a formula there, change the GLSL in `packages/renderer/src/shaders.ts` the same way.

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org) and small, focused commits.
A git hook runs commitlint and Biome for you.

```
feat(core): add luminance range masks
fix(web): keep the dial value when switching photos
docs: explain xmp import
```

Common types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`.
Scopes are optional; use the package or area you touched (`core`, `renderer`, `web`, `site`, `mobile`, `presets`, ...).

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change, with tests where it makes sense (`packages/core` changes should always have tests).
3. Run `pnpm lint && pnpm typecheck && pnpm test`.
4. Open a pull request and describe what changed and why. Screenshots help for UI changes.

## Sharing a preset

See [community/README.md](./community/README.md). Your preset shows up in everyone's Community tab once merged.

## Releases

Maintainers tag `vX.Y.Z` on `main`. The release workflow builds the self-hostable web bundle and the
Android APK and attaches them to the GitHub release.
