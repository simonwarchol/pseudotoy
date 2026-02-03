# pseudotoy

An interactive playground for editing GLSL fragment shaders used to pseudo-color multi-channel microscopy images. Edit shaders in the browser, compare against a baseline, and share your work via URL.

## Features

- **Live shader editing** — Edit GLSL fragment shaders in a CodeMirror editor with syntax highlighting and line numbers
- **Side-by-side comparison** — View the sRGB baseline (default shader) and your custom shader side by side with synced pan/zoom
- **Compile & validate** — Check shader syntax with the GLSL parser before applying
- **Shareable URLs** — Shaders are encoded in the URL hash; compile to update the URL and share with others
- **Copy link** — One-click copy of the current shader URL

## How it works

The app uses [Viv](https://github.com/hms-dbmi/viv) and deck.gl to render multi-channel OME-TIFF images. A custom deck.gl extension injects your fragment shader at the `DECKGL_MUTATE_COLOR` hook, where you can transform the per-channel intensities before they’re mapped to colors.

The shader is split at the `// Injection point:` marker:
- **Fragment shader** — Uniforms, helper functions, and the `mutate_color` function
- **Injection code** — The snippet that runs per-fragment (reads `rgba`, calls `mutate_color`, writes back to `rgba`)

## Development

```bash
pnpm install
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173). The app loads a sample OME-TIFF and redirects to a URL with the default shader encoded.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start dev server |
| `pnpm run build` | Build for production |
| `pnpm run preview` | Preview production build |
| `pnpm run lint` | Run ESLint |

## Deployment

The app deploys to GitHub Pages on push to `main`. Ensure:

1. **Settings → Pages** — Source is set to **GitHub Actions**
2. The repo name matches the `base` in `vite.config.ts` (default: `/pseudotoy/`)

The site will be available at `https://<username>.github.io/pseudotoy/`.

## Tech stack

- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vite.dev/)
- [Viv](https://github.com/hms-dbmi/viv) — Multi-channel image visualization
- [deck.gl](https://deck.gl/) — WebGL rendering
- [CodeMirror](https://codemirror.net/) — Code editor
- [@shaderfrog/glsl-parser](https://github.com/ShaderFrog/glsl-parser) — GLSL syntax validation

## License

MIT
