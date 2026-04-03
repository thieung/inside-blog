# GoClaw Blog

Astro monorepo blog platform for [GoClaw](https://goclaw.sh). Deployed on Vercel.

## Stack

- **Astro** — static site generator, zero JS to client by default
- **pnpm workspaces + Turborepo** — monorepo management
- **TypeScript** — type-safe components

## Structure

```
├── packages/core/               — shared components (FloatHome, LangSwitcher, ThemeToggle, ScrollReveal), i18n utils
├── sites/inside-goclaw/         — Astro site (→ Vercel)
│   ├── assets/social/           — social media content per post (thumbnails, FB/X/Threads posts)
│   └── src/
│       ├── components/          — page-specific Astro components
│       ├── content/             — content collections
│       ├── drafts/              — draft .astro posts (WIP)
│       ├── i18n/                — translation JSON per post slug
│       ├── layouts/             — base layouts
│       └── pages/               — routes: posts/, en/, zh/, ja/, admin/
├── posts/                       — published static HTML (legacy, pre-migration)
└── plans/                       — implementation plans
```

## Development

```bash
pnpm install
pnpm dev          # start dev server (inside-goclaw)
pnpm build        # production build
```

## Adding a New Post

1. Create `sites/inside-goclaw/src/drafts/<slug>.astro`
2. Add i18n translations in `sites/inside-goclaw/src/i18n/<slug>/`
3. When ready, move to `src/pages/posts/<slug>.astro`
4. Add card entry to `src/pages/index.astro` (newest first)
5. Push — Vercel auto-deploys

## i18n

4 languages: **vi** (default), **en**, **zh**, **ja**. Translations injected at build time from JSON files. Vietnamese is the default in HTML source. Locale routes: `/en/posts/<slug>`, `/zh/posts/<slug>`, `/ja/posts/<slug>`.
