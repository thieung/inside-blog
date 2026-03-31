# Brainstorm: Astro Monorepo Restructure

**Date:** 2026-03-31
**Status:** Approved → proceed to plan

## Problem Statement
- Blog posts are monolithic HTML files (600-2000+ lines each) with inline CSS, JS, i18n
- i18n translations embedded in each file, not reusable
- Admin tools scattered (drafts/review.html, social/export.html)
- No draft workflow automation
- Future need: multi-series platform (Inside GoClaw, Inside OpenClaw, etc.) on different cloud providers

## Decisions Made

### Stack: Astro (monorepo)
- Output: static HTML (same as current)
- Zero JS to client by default
- Native adapters for Vercel, Cloudflare, Netlify
- Component-based extraction (layouts, i18n, theme)

### Architecture: Monorepo (Option A)
```
blog-platform/
├── packages/core/         ← shared components, i18n, admin utils
├── sites/inside-goclaw/   ← Astro project (Vercel)
├── sites/inside-openclaw/ ← future (Cloudflare)
├── pnpm-workspace.yaml
└── turbo.json
```
Reason: requirement "deploy each series to different cloud" mandates separate sites.

### i18n: Build-time inject (no runtime fetch)
- JSON files per post slug
- Astro injects at build → faster than runtime fetch
- Vietnamese default in HTML, other langs from JSON

### Modularize: i18n + shared JS (CSS stays per-post)
- Extract: i18n-loader, theme-toggle, lang-switcher → shared components
- Keep: CSS inline per post (unique design requirement)

### Admin: GitHub API integration
- Centralized admin dashboard at /admin/
- GitHub token (localStorage) for PR creation, issue creation
- Actions: review, export, approve/publish, needs-update

### Workflow: 4 states
draft → in-review → approved/needs-update → published
- State tracked in drafts/status.json (committed to repo)
- Admin UI reads/writes via GitHub API

## Migration Plan (Phase 1)
1. Scaffold Astro monorepo + inside-goclaw site
2. Create shared BaseLayout, I18nLoader, ThemeToggle components
3. Migrate existing posts (HTML → .astro, extract i18n to JSON)
4. Migrate index.html → index.astro
5. Build admin dashboard (review, export, publish, needs-update)
6. Configure Vercel deployment
7. Verify all existing URLs preserved

## Risks
- Migration effort for 3 published + 12 draft posts
- GitHub API rate limits (mitigated: admin is low-traffic)
- Astro learning curve (mitigated: syntax ≈ HTML)

## Future Phases
- Phase 2: Extract @blog/core package
- Phase 3: Scaffold inside-openclaw
- Phase 4: Content Collections for markdown-based posts
