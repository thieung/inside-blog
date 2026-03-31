# Research: Astro Monorepo Best Practices for Blog Platform Migration

**Date:** 2026-03-31
**Status:** Complete
**Scope:** Monorepo setup, shared components, i18n patterns, deployment, styling, islands architecture

---

## Executive Summary

Astro monorepos using **pnpm workspaces + Turborepo** are production-ready (2025-2026 standard). Your blog can migrate from flat HTML to Astro with URL preservation and add multi-language support without breaking existing routes. Key insight: **your current `data-i18n` attribute pattern is not standard Astro**—either adopt Astro's built-in i18n routing or implement custom runtime translation object injection (both viable).

---

## 1. Astro Monorepo Setup: pnpm + Turborepo

### Architecture
```
monorepo/
├── pnpm-workspace.yaml         # Single workspace root
├── turbo.json                  # Pipeline config (caching, tasks)
├── package.json                # Root dependencies (shared dev tools)
└── packages/
    ├── @blog/core              # Shared Astro components + styles
    ├── @blog/blog-vi           # Vietnamese blog site
    ├── @blog/blog-en           # English blog variant (optional)
    └── ...
```

### Configuration Files

**pnpm-workspace.yaml:**
```yaml
packages:
  - 'packages/*'
```
pnpm creates symlinked node_modules (fastest, most efficient for monorepos).

**turbo.json:**
```json
{
  "pipeline": {
    "build": {
      "outputs": ["dist/**"],
      "cache": true,
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false
    },
    "lint": {
      "outputs": [".eslintcache"]
    }
  }
}
```

### Trade-offs

| Aspect | pnpm + Turborepo | Nx | Lerna |
|--------|-----------------|-------|--------|
| **Setup complexity** | Low—just YAML config | Medium—generators & decorators | Low |
| **Build caching** | Excellent (file-hash based) | Excellent (graph-aware) | Weak |
| **Astro-specific support** | Community examples; works fine | Has Astro plugin | Basic support |
| **Learning curve** | Minimal | Steep (new paradigm) | Minimal |
| **Adoption (2026)** | Standard choice | Enterprise/large teams | Declining |

**Recommendation:** **pnpm + Turborepo** for this migration. Simple, fast, proven with Astro projects. Nx overkill unless you have 20+ packages or need sophisticated CI/CD orchestration.

### Adoption Risk
- **Low:** pnpm is now default Node.js package manager recommendation
- **Community:** Widely used in production (Vercel, Stripe, Astro itself)
- **Breaking changes:** Unlikely—pnpm stable since v7, Turborepo stable since launch

---

## 2. Shared Component Packages: @blog/core

### Astro Publishing (No Build Step!)

Astro components publish **directly without compilation:**
- `.astro` files, `.ts`, `.jsx`, `.css`, `.json` → zero build needed
- Consumer projects import from npm and use components as-is
- Vite handles integration automatically

### Setup: Create @blog/core Package

**packages/@blog/core/package.json:**
```json
{
  "name": "@blog/core",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    "./components/*": "./src/components/*",
    "./styles/*": "./src/styles/*"
  },
  "files": ["src/"]
}
```

**Folder structure:**
```
packages/@blog/core/
├── src/
│   ├── components/
│   │   ├── BlogCard.astro
│   │   ├── PostLayout.astro
│   │   └── ...
│   ├── styles/
│   │   ├── reset.css
│   │   └── typography.css
│   └── i18n/
│       └── translations.ts
```

### Consuming Shared Components in Blog Site

**packages/@blog/blog-vi/astro.config.ts:**
```typescript
import { defineConfig } from 'astro/config';

export default defineConfig({
  vite: {
    ssr: {
      noExternal: ['@blog/core']  // Ensure shared components bundle correctly
    }
  }
});
```

**packages/@blog/blog-vi/src/pages/posts/[slug].astro:**
```astro
---
import { PostLayout } from '@blog/core/components/PostLayout.astro';
import { getTranslations } from '@blog/core/i18n/translations';

const { slug } = Astro.params;
const t = getTranslations('vi');
---

<PostLayout title={post.title}>
  <p>{t('post_author')}: {post.author}</p>
  <slot />
</PostLayout>
```

### Monorepo Issues & Mitigations

| Issue | Root Cause | Solution |
|-------|-----------|----------|
| **Framework integrations don't load** | @astrojs packages not in consumer's package.json | Add to each site's package.json, not root-only |
| **Import paths break on build** | Vite SSR excludes shared code by default | Use `vite.ssr.noExternal: ['@blog/core']` |
| **TypeScript path resolution fails** | tsconfig.json in root doesn't reach packages | Create tsconfig.json in each package |

**Adoption risk:** Low. Astro publish-to-npm is stable and documented. Real-world examples: Astro's own theme packages.

---

## 3. i18n Patterns: Your data-i18n Approach vs. Astro Standards

### Your Current Pattern: Runtime data-i18n Attributes

You currently use:
```html
<p data-i18n="hero_title">Vietnamese text</p>
<script>
const T = { vi: {}, en: {...}, zh: {...}, ja: {...} };
function setLang(lang) {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.innerHTML = T[lang][el.getAttribute('data-i18n')];
  });
}
</script>
```

**Pros:**
- Works in static HTML (no build step)
- Client-side language switching without page reload
- Minimal JavaScript

**Cons:**
- Not standard Astro approach
- Translation objects shipped to client (if large, impacts bundle)
- SEO fragile (search engines may see first language only)
- No type safety

### Option A: Astro's Built-in i18n Routing (v4.0+)

**astro.config.ts:**
```typescript
export default defineConfig({
  i18n: {
    defaultLocale: 'vi',
    locales: ['vi', 'en', 'zh', 'ja'],
    routing: {
      prefixDefaultLocale: false  // /posts/slug vs /vi/posts/slug
    },
    fallback: {
      en: 'vi',  // English falls back to Vietnamese if missing
      zh: 'vi',
      ja: 'vi'
    }
  }
});
```

**Page structure:**
```
src/pages/posts/
├── [slug].astro          # Vietnamese (default)
├── en/[slug].astro       # English
├── zh/[slug].astro       # Chinese
└── ja/[slug].astro       # Japanese
```

**Limitations:**
- URL structure changes: `/posts/slug` (vi) vs `/en/posts/slug` (en) — breaks current URLs
- Language is URL-based, not runtime-switchable
- Requires content duplication (separate pages per language)

**When to use:** If you're willing to restructure URLs and accept language-per-URL model.

### Option B: Custom Runtime Translation Object (Recommended for Your Case)

Keep your `data-i18n` pattern, move to Astro:

**packages/@blog/core/src/i18n/translations.ts:**
```typescript
export const translations = {
  vi: {
    hero_title: 'Đồ thị tri thức hướng dẫn',
    hero_sub: 'Khám phá cấu trúc dữ liệu...',
  },
  en: {
    hero_title: 'Knowledge Graphs Explained',
    hero_sub: 'Explore data structure...',
  },
  zh: {
    hero_title: '知识图谱指南',
    hero_sub: '探索数据结构...',
  },
  ja: {
    hero_title: 'ナレッジグラフの基礎',
    hero_sub: 'データ構造の探索...',
  },
};

export function getTranslations(lang) {
  return translations[lang] || translations.vi;
}
```

**Post template (posts/[slug].astro):**
```astro
---
import { translations } from '@blog/core/i18n/translations';

const { slug } = Astro.params;
const post = await getPost(slug);
---

<article>
  <h1 data-i18n="post_title">{post.title}</h1>
  <p data-i18n="post_author">{post.author}</p>
  <!-- All HTML with data-i18n attributes -->
</article>

<script define:vars={{ translations }}>
function setLang(lang) {
  const t = translations[lang] || translations.vi;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (el.hasAttribute('data-i18n-html')) {
      el.innerHTML = t[key];
    } else {
      el.textContent = t[key];
    }
  });
}
window.setLang = setLang;
</script>
```

**Advantages:**
- Keeps your existing URL structure `/posts/slug` (no migration pain)
- Runtime language switching (no page reload)
- Shared translations across all blog sites
- Can progressively migrate to Astro's built-in i18n later

**Trade-off:** HTML contains all 4 languages, translation object shipped to client. For 500 keys × 4 langs, JSON ~15–25KB gzip.

**Adoption risk:** Low. Custom approach, but simple enough to maintain.

### Option C: astro-i18next or astro-i18n (Third-Party)

| Library | Approach | Hydration | Best For |
|---------|----------|-----------|----------|
| **astro-i18n** | TypeScript-first, type-safe | `client+server` mode | Large projects, complex logic |
| **astro-i18next** | i18next ecosystem (FSBackend + HTTPBackend) | Both server & client | Teams familiar with i18next |
| **Paraglide-Astro** | Runtime functions + locale detection | Server-side focused | SEO-critical, dynamic content |

All support JSON translation files. **Paraglide is newest (2025), designed for Astro islands.**

**When to use:** If you need type safety or plan to scale beyond 1000+ translation keys.

**Adoption risk:** Medium. Third-party dependency; check maintenance status (Paraglide maintained by inlang, active; astro-i18next community-driven).

### **Recommendation: Option B (Custom Runtime)**

Why:
1. **Preserves `/posts/{slug}` URL structure**—critical for your migration
2. **No breaking changes**—existing links stay valid
3. **Minimal complexity**—no new library dependencies
4. **Client-side switching**—matches current user experience
5. **Easy to upgrade**—can migrate to Astro's built-in i18n (v5+) later without site restructure

---

## 4. Astro + Vercel Deployment (@astrojs/vercel)

### Static Configuration

**astro.config.ts:**
```typescript
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/static';

export default defineConfig({
  output: 'static',
  adapter: vercel({
    imageService: true,  // Optional: use Vercel Image Optimization
    imagesConfig: {
      sizes: [320, 640, 1280],
      formats: ['image/avif', 'image/webp']
    }
  })
});
```

**Key facts:**
- `output: 'static'` is the default; Vercel automatically recognizes static builds
- Adapter **not required** if you don't use Vercel-specific services
- If using only static output, deploy `dist/` folder directly

### Vercel.json (Optional, for static)

```json
{
  "buildCommand": "pnpm run build",
  "outputDirectory": "dist",
  "installCommand": "pnpm install"
}
```

### Multi-Package Deploy (Monorepo)

In **vercel.json** at project root:
```json
{
  "projects": {
    "blog-vi": {
      "rootDirectory": "packages/@blog/blog-vi",
      "buildCommand": "pnpm run build --filter @blog/blog-vi"
    },
    "blog-en": {
      "rootDirectory": "packages/@blog/blog-en",
      "buildCommand": "pnpm run build --filter @blog/blog-en"
    }
  }
}
```

Or use Vercel's dashboard to link individual packages to separate deployments.

### Trade-offs

| Feature | Static Adapter | Serverless (output: 'server') |
|---------|---|---|
| **Build time** | Fast (everything pre-rendered) | Medium (generates function stubs) |
| **Cold starts** | None (static files) | ~1s (Lambda cold start) |
| **Dynamic routes** | Pre-computed at build | Generated on-demand |
| **API routes** | Not supported natively | Supported via Astro endpoints |
| **Cost** | Lowest (static hosting) | Higher (serverless invocations) |

**Recommendation:** Stay with `output: 'static'` and `@astrojs/vercel/static` for your blog. It's the fastest, cheapest option and matches your current deployment model.

---

## 5. URL Preservation During Migration

### Current State: `/posts/<slug>.html`
### Target State: `/posts/<slug>` (trailing slash optional)

Astro's file-based routing naturally preserves this:

**File structure:**
```
src/pages/posts/[slug].astro
```

**Generated routes:**
- `/posts/force-directed-knowledge-graphs`
- `/posts/v2-47-0-release`
- (Astro strips `.html` by default)

### Redirect Old HTML Files (if needed)

**astro.config.ts:**
```typescript
export default defineConfig({
  redirects: {
    '/posts/[slug].html': '/posts/[slug]'
  }
});
```

Or in **vercel.json:**
```json
{
  "redirects": [
    { "source": "/posts/:slug(.html)", "destination": "/posts/:slug", "permanent": true }
  ]
}
```

### SEO Impact
- **301 permanent redirects** inform search engines of moved content
- **Preserve slugs exactly** to maintain existing backlinks
- **Build once, serve everywhere** with Astro's static output

**Risk:** None. This is standard migration practice.

---

## 6. Scoped Styles: Per-Page Unique CSS

### How Astro Scoped Styles Work

Astro's `<style>` tag is **scoped by default** using unique `data-astro-cid-*` attributes:

```astro
---
// PostLayout.astro
---

<article>
  <h1>Title</h1>
  <p>Content</p>
</article>

<style>
  h1 {
    font-family: 'Playfair Display', serif;
    color: #2c3e50;
    font-size: 3rem;
  }

  p {
    font-family: 'Inter', sans-serif;
    color: #555;
    line-height: 1.8;
  }
</style>
```

**Compiled output:**
```html
<h1 data-astro-cid-xyz123>Title</h1>
<style>
  h1[data-astro-cid-xyz123] { font-family: ...; }
  p[data-astro-cid-xyz123] { font-family: ...; }
</style>
```

### Per-Page Styling Pattern

Create a layout per post design:

```
src/layouts/
├── PostLayout-v1.astro    # Dark + Serif (v2.47.0 post)
├── PostLayout-v2.astro    # Light + Sans (different post)
└── shared.css             # Global resets only
```

**PostLayout-v1.astro:**
```astro
---
// All styles here are scoped to this component
---

<article class="post-v1">
  <slot />
</article>

<style>
  .post-v1 h1 {
    font-family: 'Playfair Display';
    font-size: 3.5rem;
  }
  /* No leakage to other pages */
</style>
```

### scopedStyleStrategy Configuration

Default (`:where()` wrapper, low specificity):
```typescript
// astro.config.ts
export default defineConfig({
  // default: 'where'
});
```

If you need higher specificity (rarely needed):
```typescript
export default defineConfig({
  scopedStyleStrategy: 'attribute'  // Uses [data-astro-cid-*] directly, no :where()
});
```

**Practical difference:** With `:where()` (default), scoped styles have same specificity as `<style>` tags (simple selectors). With `'attribute'`, they're slightly higher. For blog posts, default is fine.

### Global Styles (Shared Across All Posts)

**src/styles/global.css:**
```css
/* Reset, typography defaults, utility classes */
body {
  font-family: system-ui;
  line-height: 1.5;
}
```

**Imported in layout or root layout:**
```astro
---
import '../styles/global.css';
---
```

**No scoping applied** — these styles affect all pages. Scoped styles override global.

### Trade-off Summary

| Approach | Benefit | Cost |
|----------|---------|------|
| **Scoped per layout** | Zero style leakage, safe experimentation | More files to manage |
| **Global base + scoped overrides** | DRY for common styles, unique per-page flair | Slight CSS overhead |
| **All scoped** | Strictest isolation | Most verbose |

**Recommendation:** Use 1–2 base global resets + scoped styles per layout. Matches your "each post unique design" requirement.

---

## 7. Client-Side Islands: Interactive JS on Static Pages

### client:load Directive

Hydrates component **immediately on page load:**

```astro
---
import GitHubStars from '@blog/core/components/GitHubStars.astro';
---

<GitHubStars client:load repo="withastro/astro" />
```

Compiled to:
```html
<!-- Static HTML for fallback -->
<div id="github-stars">...</div>

<!-- JavaScript hydrates this component -->
<script type="module">
  import { GitHubStars } from '@astrojs/react';
  hydrate(GitHubStars, { props: { repo: 'withastro/astro' } });
</script>
```

### When to Use client:load

**Good use cases:**
- Navigation menu (needs interactivity immediately)
- Call-to-action button above fold
- Real-time GitHub API calls (GitHub stars widget)

**Bad use cases:**
- Below-the-fold content (use `client:visible` instead)
- Non-critical UI (use `client:idle`)
- Static text (leave un-hydrated)

### Performance Impact

| Directive | Hydration Timing | JS Bundle Impact | When to Use |
|-----------|------------------|------------------|------------|
| **client:load** | Immediately | Full component JS | Above-the-fold interactivity |
| **client:idle** | When browser idle | Full component JS | Below-the-fold interactivity |
| **client:visible** | On viewport entry | Full component JS | Lazy-load on scroll |
| **client:only** | Never (SSR skipped) | Framework JS | Framework-specific only |
| None (static) | Never | 0 bytes | Plain HTML/CSS content |

### Example: GitHub Stars Widget

**src/components/GitHubStars.astro:**
```astro
---
// Pure HTML fallback (static)
export interface Props {
  repo: string;
}

const { repo } = Astro.props;
---

<div id="github-stars" data-repo={repo}>
  <p>Loading stars...</p>
</div>

<script define:vars={{ repo }}>
  // Runs on client after hydration
  fetch(`https://api.github.com/repos/${repo}`)
    .then(r => r.json())
    .then(data => {
      document.querySelector('#github-stars').innerHTML =
        `<span>${data.stargazers_count} ⭐</span>`;
    });
</script>

<style>
  #github-stars {
    padding: 1rem;
    background: #f5f5f5;
    border-radius: 4px;
  }
</style>
```

**Usage in post:**
```astro
---
import { GitHubStars } from '@blog/core/components/GitHubStars.astro';
---

<h1>Knowledge Graphs</h1>
<p>Check out the project:</p>
<GitHubStars client:load repo="goclaw/goclaw" />
<p>The above widget loads the live star count from GitHub.</p>
```

### Bundle Size Considerations

- **Static HTML only:** 0 bytes JS
- **With client:load GitHub widget:** ~2–5 KB JS (minimal)
- **With React component + client:load:** ~30–50 KB JS (expensive)

For your blog (mostly static posts with occasional GitHub/API calls), use `client:load` sparingly.

**Adoption risk:** None. Islands are Astro's core pattern, stable since Astro 1.0.

---

## Summary: Recommended Architecture

### Monorepo Setup
✅ **pnpm workspaces + Turborepo**
- Root `pnpm-workspace.yaml` + `turbo.json`
- Packages: `@blog/core`, `@blog/blog-vi`, `@blog/blog-en` (optional)

### Shared Components
✅ **@blog/core package with no build step**
- `.astro` components, CSS, TypeScript utilities
- Consumed via `vite.ssr.noExternal: ['@blog/core']`

### i18n
✅ **Custom runtime translation object (Option B)**
- Preserves `/posts/{slug}` URLs (no migration breaking changes)
- `packages/@blog/core/src/i18n/translations.ts`
- Client-side language switching via `setLang(lang)`
- Minimal ~20KB gzip for all 4 languages

### Deployment
✅ **@astrojs/vercel/static + output: 'static'**
- No adapter needed, but use it for Vercel Image Optimization
- Deploy individual packages from monorepo roots
- Auto-preserve URL structure

### Styling
✅ **Global resets + scoped per-layout CSS**
- Each post layout has unique fonts/colors in scoped `<style>` block
- Zero cross-post style leakage
- No CSS-in-JS overhead

### Interactivity
✅ **client:load for above-the-fold islands only**
- GitHub stars widget, API calls → use `client:load`
- Below-the-fold content → use `client:visible` or `client:idle`
- Fallback HTML for all islands

---

## Trade-off Matrix: Key Decisions

| Decision | Option A | Option B (✅ Recommended) | Option C | Trade-off |
|----------|----------|--------------------------|----------|-----------|
| **Monorepo tool** | Nx | pnpm + Turborepo | Lerna | Simplicity vs. power |
| **i18n approach** | Astro v4 built-in routing | Custom runtime data-i18n | astro-i18next | URL structure vs. features |
| **Shared components** | Publish to npm | Monorepo package | Duplicated | Maintenance burden |
| **Styling** | CSS Modules | Scoped `<style>` (default) | Tailwind | Type safety vs. simplicity |
| **Islands** | Preact (light) | Vanilla JS | React | Bundle size vs. ecosystem |

---

## Adoption Risk Assessment

| Component | Risk Level | Mitigation |
|-----------|-----------|-----------|
| **pnpm workspaces** | Low | Industry standard; Node.js default |
| **Turborepo** | Low | Stable since 1.0; widely adopted |
| **Astro 4.x/5.x** | Low | v4 LTS until mid-2026; v5 already stable |
| **Custom i18n** | Low | Self-contained; no external dependency |
| **@astrojs/vercel** | Low | Official integration; maintained by Astro team |
| **Islands architecture** | None | Core Astro pattern since v1.0 |

**Overall:** Green light for migration. All technologies stable and proven.

---

## Implementation Roadmap (High Level)

1. **Phase 1:** Set up monorepo structure (pnpm-workspace.yaml + turbo.json)
2. **Phase 2:** Create `@blog/core` package with shared components + i18n translations
3. **Phase 3:** Scaffold `@blog/blog-vi` Astro project, migrate posts one-by-one
4. **Phase 4:** Add GitHub stars island (client:load) to showcase islands pattern
5. **Phase 5:** Deploy to Vercel, test language switching, validate URL preservation
6. **Phase 6:** (Future) Migrate to Astro's built-in i18n routing if scaling beyond 4 languages

---

## Unresolved Questions

1. **Multi-site i18n:** Do you plan separate blog sites per language (e.g., separate Vercel deployments) or single site with client-side switching? This affects URL strategy.
2. **Content duplication:** Will posts be duplicated (separate HTML per language) or shared HTML with translations only? Affects content data structure.
3. **Analytics tracking:** How to track language preference changes (for analytics)? Requires middleware or client-side event tracking.
4. **SEO for non-default languages:** If using custom runtime i18n, consider hreflang tags for each language variant to help search engines.
5. **Markdown-based posts:** Will posts be Markdown files (`.md` + frontmatter) or continue as HTML? Markdown gives more flexibility with Astro Content Collections.

---

## Sources

- [Monorepo Architecture Guide 2025 — Feature-Sliced Design](https://feature-sliced.design/blog/frontend-monorepo-explained)
- [pnpm Workspaces Configuration](https://pnpm.io/workspaces)
- [Turborepo Official Docs](https://turbo.build/)
- [Astro Publish to npm](https://docs.astro.build/en/reference/publish-to-npm/)
- [Astro i18n Routing (v4.0+)](https://docs.astro.build/en/guides/internationalization/)
- [Astro i18n Recipe Guide](https://docs.astro.build/en/recipes/i18n/)
- [@astrojs/vercel Adapter](https://docs.astro.build/en/guides/integrations-guide/vercel/)
- [Astro Styling & Scoped Styles](https://docs.astro.build/en/guides/styling/)
- [Astro Islands Architecture](https://docs.astro.build/en/concepts/islands/)
- [Astro Routing Reference](https://docs.astro.build/en/guides/routing/)
- [astro-i18n TypeScript Library — GitHub](https://github.com/Alexandre-Fernandez/astro-i18n)
- [Paraglide Astro Integration](https://inlang.com/m/iljlwzfs/paraglide-astro-i18n)
