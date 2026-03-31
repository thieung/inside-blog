# Phase 4: Migrate Published Posts

**Priority:** Critical | **Effort:** L | **Status:** ⬜
**Depends on:** Phase 3

## Overview
Convert 3 published HTML posts to `.astro` files. Each post keeps unique CSS, uses shared components.

## Migration Pattern per Post

### Before (HTML)
```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <link href="fonts..." rel="stylesheet">
  <style>/* 200-500 lines unique CSS */</style>
</head>
<body>
  <a class="float-home" href="/">←</a>
  <div class="lang-btns">...</div>
  <!-- content with data-i18n attributes -->
  <script>
    const T = { vi: {...}, en: {...}, ... };
    function setLang(lang) { ... }
    // URL param handling
  </script>
</body>
</html>
```

### After (.astro) — using Astro built-in i18n
```astro
---
import FloatHome from '@blog/core/components/FloatHome.astro';
import LangSwitcher from '@blog/core/components/LangSwitcher.astro';
import ThemeToggle from '@blog/core/components/ThemeToggle.astro';
import ScrollReveal from '@blog/core/components/ScrollReveal.astro';
import { getTranslation } from '@blog/core/utils/i18n-helpers';
import translations from '../../i18n/yield-mention-mode.json';

const locale = Astro.currentLocale || 'vi';
const t = getTranslation(translations, locale);
---
<html lang={locale} data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>...</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link href="fonts..." rel="stylesheet">
</head>
<body>
  <FloatHome />
  <LangSwitcher slug="yield-mention-mode" />
  <ThemeToggle />

  <!-- Build-time i18n — text injected directly, no data-i18n needed -->
  <h1><Fragment set:html={t.hero_title} /></h1>
  <p>{t.hero_sub}</p>

  <ScrollReveal />
</body>
</html>

<style is:global>
  /* Unique CSS for this post — use is:global for :root vars */
  :root { --accent: #e8a020; /* ... */ }
</style>

<style>
  /* Scoped CSS (auto-scoped by Astro) */
  .hero { /* ... */ }
</style>
```

**Key change:** Text now injected at build time via `{t.key}` or `<Fragment set:html={t.key} />` (for HTML content). No `data-i18n` attributes, no client JS for language switching.

Astro generates:
- `/posts/yield-mention-mode` (vi)
- `/en/posts/yield-mention-mode` (en)
- `/zh/posts/yield-mention-mode` (zh)
- `/ja/posts/yield-mention-mode` (ja)
```

## Posts to Migrate

### 1. `yield-mention-mode` (614 lines)
- **Source:** `posts/yield-mention-mode.html`
- **Target:** `sites/inside-goclaw/src/pages/posts/yield-mention-mode.astro`
- **Unique:** Chat simulation, flow diagram
- **Fonts:** Google Fonts (specific to post)

### 2. `codex-oauth-pools` (726 lines)
- **Source:** `posts/codex-oauth-pools.html`
- **Target:** `sites/inside-goclaw/src/pages/posts/codex-oauth-pools.astro`
- **Unique:** Architecture diagrams, code blocks
- **Fonts:** Google Fonts (specific to post)

### 3. `force-directed-knowledge-graphs` (2042 lines)
- **Source:** `posts/force-directed-knowledge-graphs.html`
- **Target:** `sites/inside-goclaw/src/pages/posts/force-directed-knowledge-graphs.astro`
- **Unique:** Knowledge graph visualization, interactive elements
- **Fonts:** Space Grotesk, JetBrains Mono
- **Note:** Largest file — consider splitting into sub-components if HTML sections are reusable

## CSS Strategy
- `:root` custom properties → `<style is:global>` (must be global to cascade)
- `[data-theme="light"]` overrides → same `is:global` block
- Component-specific styles → regular `<style>` (Astro auto-scopes)
- Media queries → keep in same style block as related styles

## URL Preservation
- `pages/posts/yield-mention-mode.astro` → `/posts/yield-mention-mode`
- Matches current `/posts/yield-mention-mode.html` with `cleanUrls: true`
- Astro `trailingSlash: 'never'` matches current Vercel config

## Success Criteria
- [ ] All 3 posts render identically to current HTML versions
- [ ] i18n works with `?lang=en`, `?lang=zh`, `?lang=ja`
- [ ] Theme toggle works (dark/light)
- [ ] URLs unchanged: `/posts/yield-mention-mode`, `/posts/codex-oauth-pools`, `/posts/force-directed-knowledge-graphs`
- [ ] No runtime JS beyond what's needed (setLang, theme)
