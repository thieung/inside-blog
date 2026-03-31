# Phase 5: Migrate Homepage

**Priority:** High | **Effort:** M | **Status:** ⬜
**Depends on:** Phase 2

## Overview
Convert `index.html` (610 lines) to `sites/inside-goclaw/src/pages/index.astro`. Homepage has DIFFERENT i18n system than posts.

## Key Differences from Posts
- Homepage uses `data-vi`, `data-en`, `data-zh`, `data-ja` attributes on card elements
- Posts use `data-i18n="key"` + `const T = {...}`
- Homepage has: nav bar, search, post cards grid, theme toggle, footer

## Migration Approach

### Shared Components Used
- `ThemeToggle.astro`
- `LangSwitcher.astro`

### Homepage-Specific
- Post card grid (unique to homepage)
- Search/filter functionality
- Nav bar with GitHub link
- i18n via data attributes (keep existing pattern — simpler for cards)

### Post Card Data
Consider extracting post metadata to a data file:
```ts
// sites/inside-goclaw/src/data/posts.ts
export const posts = [
  {
    slug: 'force-directed-knowledge-graphs',
    version: 'v2.47.0',
    date: '2026-03-30',
    title: { vi: '...', en: '...', zh: '...', ja: '...' },
    excerpt: { vi: '...', en: '...', zh: '...', ja: '...' },
    color: '#e8a020',
  },
  // ...
];
```

This allows Astro to generate cards at build time with all language variants.

## Files
- **Source:** `index.html`
- **Target:** `sites/inside-goclaw/src/pages/index.astro`
- **New:** `sites/inside-goclaw/src/data/posts.ts` (post metadata)

## Success Criteria
- [ ] Homepage renders identically
- [ ] Post cards show correct language when `?lang=xx`
- [ ] Search/filter works
- [ ] Theme toggle works
- [ ] URL: `/` (unchanged)
