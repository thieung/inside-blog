# Phase 2: Shared Core Package

**Priority:** Critical | **Effort:** M | **Status:** ⬜
**Depends on:** Phase 1

## Overview
Create `@blog/core` package with reusable Astro components extracted from common patterns across all posts.

## Key Insights (from codebase scout)
- All posts share: `setLang()`, float-home button, lang-switcher, URL param handling
- 5+ posts share: theme toggle (dark/light)
- 2+ posts share: scroll reveal IntersectionObserver
- Each post has UNIQUE: fonts, colors, layout → CSS stays per-post

## Components to Create

### 1. `i18n-helpers.ts` (replaces I18nLoader component)
Using Astro built-in i18n — no client-side loader needed. Translations injected at build time.
```ts
// utils/i18n-helpers.ts
import type { TranslationMap, Lang } from './types';

export function getTranslation(translations: TranslationMap, locale: string): Record<string, string> {
  const lang = (locale || 'vi') as Lang;
  return translations[lang] || translations.vi;
}

export function getLocalizedUrl(slug: string, locale: string, defaultLocale = 'vi'): string {
  const base = `/posts/${slug}`;
  return locale === defaultLocale ? base : `/${locale}${base}`;
}
```
Posts use `Astro.currentLocale` + this helper to get translations at build time. No data-i18n attributes needed.

### 2. `LangSwitcher.astro`
```astro
---
// Generates links to same page in other locales
interface Props { langs?: string[], slug: string }
const { langs = ['vi', 'en', 'zh', 'ja'], slug } = Astro.props;
const currentLocale = Astro.currentLocale || 'vi';

function localizedHref(lang: string) {
  const base = `/posts/${slug}`;
  return lang === 'vi' ? base : `/${lang}${base}`;
}
---
<div class="lang-switcher">
  {langs.map(lang => (
    <a class:list={['lang-btn', { active: lang === currentLocale }]}
       href={localizedHref(lang)}>
      {lang.toUpperCase()}
    </a>
  ))}
</div>
```
Links navigate to locale-prefixed URLs (Astro routing handles the rest).

### 3. `ThemeToggle.astro`
```astro
<button class="theme-toggle" onclick="toggleTheme()" aria-label="Toggle theme">
  <span class="icon-sun">☀</span>
  <span class="icon-moon">☾</span>
</button>
<script>
  function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    html.setAttribute('data-theme', current === 'light' ? 'dark' : 'light');
    localStorage.setItem('theme', html.getAttribute('data-theme'));
  }
  // Restore saved theme
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
</script>
```

### 4. `FloatHome.astro`
```astro
---
interface Props { href?: string }
const { href = '/' } = Astro.props;
---
<a class="float-home" href={href} aria-label="Home">
  ←
</a>
<style>
  .float-home {
    position: fixed; top: 20px; left: 20px; z-index: 100;
    width: 44px; height: 44px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: var(--surface, #1a1a1a);
    border: 1px solid var(--border, #333);
    color: var(--text, #e0e0e0);
    text-decoration: none; font-size: 18px;
    transition: opacity 0.2s;
  }
  .float-home:hover { opacity: 0.8; }
</style>
```

### 5. `ScrollReveal.astro`
```astro
<script>
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
</script>
```

### 6. `utils/i18n-helpers.ts`
```ts
export interface TranslationMap {
  vi: Record<string, string>;
  en: Record<string, string>;
  zh: Record<string, string>;
  ja: Record<string, string>;
}

export type Lang = 'vi' | 'en' | 'zh' | 'ja';

export function getLangFromUrl(url: URL): Lang {
  const lang = url.searchParams.get('lang') as Lang;
  return ['vi', 'en', 'zh', 'ja'].includes(lang) ? lang : 'vi';
}
```

### 7. `utils/github-api.ts`
```ts
// GitHub API wrapper for admin dashboard
export class GitHubClient {
  constructor(private token: string, private owner: string, private repo: string) {}

  async createPR(title: string, head: string, base: string, body: string) { ... }
  async createIssue(title: string, body: string, labels: string[]) { ... }
  async getFileContent(path: string) { ... }
  async updateFile(path: string, content: string, message: string, sha: string) { ... }
}
```

## Package Config

**`packages/core/package.json`:**
```json
{
  "name": "@blog/core",
  "version": "0.1.0",
  "exports": {
    "./components/*": "./src/components/*",
    "./utils/*": "./src/utils/*"
  }
}
```

**Site references it via:**
```json
{ "dependencies": { "@blog/core": "workspace:*" } }
```

## Files to Create
- `packages/core/package.json`
- `packages/core/src/components/I18nLoader.astro`
- `packages/core/src/components/LangSwitcher.astro`
- `packages/core/src/components/ThemeToggle.astro`
- `packages/core/src/components/FloatHome.astro`
- `packages/core/src/components/ScrollReveal.astro`
- `packages/core/src/utils/i18n-helpers.ts`
- `packages/core/src/utils/github-api.ts`
- `packages/core/src/index.ts`

## Success Criteria
- [ ] `@blog/core` importable from `inside-goclaw`
- [ ] Components render correctly in Astro dev
- [ ] TypeScript types compile
- [ ] No runtime JS shipped for static components (only script tags)
