---
name: Astro Monorepo Migration — Phase 1
status: pending
created: 2026-03-31
branch: main
blockedBy: []
blocks: []
---

# Astro Monorepo Migration — Phase 1

Migrate goclaw-blog from pure static HTML to Astro monorepo. Extract shared components, separate i18n, build admin dashboard with GitHub API workflow.

## Context
- Brainstorm: `plans/reports/brainstorm-260331-1353-astro-monorepo-restructure.md`
- Scout: codebase-scout analysis (inline)
- Research: `plans/reports/researcher-260331-1353-astro-monorepo-patterns.md`

## Target Structure
```
blog-platform/
├── packages/
│   └── core/                    # @blog/core — shared components
│       ├── src/
│       │   ├── components/
│       │   │   ├── I18nLoader.astro
│       │   │   ├── LangSwitcher.astro
│       │   │   ├── ThemeToggle.astro
│       │   │   ├── FloatHome.astro
│       │   │   └── ScrollReveal.astro
│       │   ├── utils/
│       │   │   ├── i18n-helpers.ts
│       │   │   └── github-api.ts
│       │   └── index.ts
│       └── package.json
├── sites/
│   └── inside-goclaw/           # Astro site (Vercel)
│       ├── astro.config.mjs
│       ├── src/
│       │   ├── layouts/
│       │   │   └── PostLayout.astro
│       │   ├── pages/
│       │   │   ├── index.astro
│       │   │   ├── posts/
│       │   │   │   ├── yield-mention-mode.astro
│       │   │   │   ├── codex-oauth-pools.astro
│       │   │   │   └── force-directed-knowledge-graphs.astro
│       │   │   └── admin/
│       │   │       ├── index.astro
│       │   │       ├── review.astro
│       │   │       ├── export.astro
│       │   │       └── publish.astro
│       │   ├── drafts/          # Draft .astro files
│       │   ├── i18n/            # Translation JSON files
│       │   │   ├── yield-mention-mode.json
│       │   │   ├── codex-oauth-pools.json
│       │   │   └── ...
│       │   └── content/
│       │       └── status.json  # Draft workflow state
│       └── public/
│           ├── favicon.svg
│           ├── goclaw-icon.svg
│           └── social/          # Thumbnails & social content
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## Phases

| # | Phase | Priority | Effort | Status |
|---|-------|----------|--------|--------|
| 1 | [Scaffold monorepo](phase-01-scaffold-monorepo.md) | Critical | S | ⬜ |
| 2 | [Shared core package](phase-02-shared-core-package.md) | Critical | M | ⬜ |
| 3 | [Extract i18n translations](phase-03-extract-i18n.md) | High | L | ⬜ |
| 4 | [Migrate published posts](phase-04-migrate-published-posts.md) | Critical | L | ⬜ |
| 5 | [Migrate homepage](phase-05-migrate-homepage.md) | High | M | ⬜ |
| 6 | [Migrate drafts](phase-06-migrate-drafts.md) | Medium | L | ⬜ |
| 7 | [Admin dashboard](phase-07-admin-dashboard.md) | High | L | ⬜ |
| 8 | [Vercel deployment](phase-08-vercel-deployment.md) | Critical | S | ⬜ |

## Dependencies
```
Phase 1 → Phase 2 → Phase 3 → Phase 4
                               Phase 5
                               Phase 6
Phase 2 → Phase 7
Phase 4,5 → Phase 8
```

## Success Criteria
- All existing post URLs preserved (`/posts/{slug}`)
- All 4 languages working via Astro built-in i18n (vi default no prefix, /en/ /zh/ /ja/ prefixed)
- Each post retains unique design (fonts, colors, layout)
- Admin dashboard functional with GitHub API
- Draft workflow: draft → in-review → approved/needs-update → published
- Vercel deployment working
- Zero runtime JS for static posts (Astro islands only for interactive)

## Risks
- Large post migration (2000+ LOC files) — mitigated: mostly copy-paste HTML into .astro
- Astro scoped styles may conflict with `:root` vars — use `is:global` for CSS custom properties
- GitHub API rate limits — admin is low traffic, acceptable
