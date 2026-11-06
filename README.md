# Edit with Claude

An editor for content people, running on your dev server. Click any element on the page and type text in place, change a link, or ask Claude to change it ("make this a two-column list", "add a FAQ section below"). Every change can be undone per page, and Claude checks a screenshot after it edits.

Dev only: nothing is added to a build. Claude runs as **Claude Code on your own machine with your own login**, never an API key. It can read and edit project files, but it cannot run shell commands or browse the web.

## Requirements

- [Claude Code](https://claude.com/claude-code) installed (`claude` on the PATH) and logged in.
- Node 22.12 or newer (Astro 7 needs 22.23.4 or newer).

## Setup

Pick the one that fits the project.

**A plain HTML site** (HTML, CSS and JavaScript files, no build tool). Run this in the site's folder:

```bash
npx claude-edit
```

It serves the folder at http://localhost:4321 (`--port` changes the port, `--model` the model). Click **Edit with Claude** at the bottom right.

**Astro** (7 or newer):

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import claudeEdit from 'claude-edit';

export default defineConfig({
  integrations: [claudeEdit()],
});
```

Run `astro dev` and open **Edit with Claude** in the dev toolbar.

**Any other Vite project**:

```js
// vite.config.js
import { defineConfig } from 'vite';
import claudeEdit from 'claude-edit/vite';

export default defineConfig({
  plugins: [claudeEdit()],
});
```

## What you can click

| Project | Click to edit | Ask Claude |
| --- | --- | --- |
| Astro | Everything written in `.astro`, `.md` and `.mdx` files | Yes |
| Plain HTML, or `.html` pages in a Vite project | Everything written in the `.html` files | Yes |
| Elements that JavaScript creates (React, Vue, Svelte components, `document.createElement`) | Not yet | Yes, for the whole page |
| Next.js and other non-Vite dev servers | Not supported | No |

## Options

All of them are optional, and the same for the Astro integration and the Vite plugin (`sources` only matters for Astro).

| Option | Default | What it does |
| --- | --- | --- |
| `model` | `'sonnet'` | The Claude model for the session: `'sonnet'`, `'opus'`, `'haiku'` or a full model id. |
| `guide` | none | A repo-relative file that is added to Claude's instructions, usually your component library's README. Claude uses it to build new sections from your own components. |
| `sources` | `[]` | More repo-relative folders with components your pages import, such as a shared UI package in a monorepo. Your `src/` folder is always included. They feed "Changes N pages". |
| `images` | none | An image library adapter, described below. Without one, the Images view and the pictures you can attach to a message are hidden. |

## What it writes into your repo

- `.claude-edit/`: the undo history and copies of replaced images. It creates its own `.gitignore`.
- `claude-edit-words.txt` at the repo root: the spell check's word list, made the first time someone clicks "Add to the word list". Commit it.

The spell check covers English and Bosnian, Croatian and Serbian pages, taking the language from Astro's `i18n` config. Pages in other languages are not checked.

The repo root is the nearest folder above the Astro project that has `pnpm-workspace.yaml` or `.git`.

## Image library adapter

Most projects don't need this. It is for projects whose sources name images with keys from one image folder, so editors can replace, crop and describe pictures from the page:

```js
{
  dir: 'packages/images',  // the repo-relative folder that holds the image files
  prompt: '- Images are …', // rules Claude follows when it touches images
  create({ root, site, history }) {
    return { list, replace, alt, focus, suggest, attach, attachPath, picture };
  },
}
```

The editor serves these methods at `/__claude-edit/images/*` (same-origin requests only, see `images.mjs`). To show an error message to the editor, throw an error that has `expose: true`. The data each method returns follows what the Images view in `app.js` reads. That contract is not stable yet, so pin the version if you write an adapter.

## Development

```bash
pnpm install
pnpm test
```

The tests run on Node's built-in test runner, with a stand-in `claude` and dev server. They need no network and no Claude login.

## License

MIT
