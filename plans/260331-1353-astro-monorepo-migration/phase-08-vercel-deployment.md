# Phase 8: Vercel Deployment

**Priority:** Critical | **Effort:** S | **Status:** ⬜
**Depends on:** Phase 4, Phase 5

## Overview
Configure Vercel to build and deploy the Astro monorepo site.

## Vercel Configuration

### `sites/inside-goclaw/vercel.json`
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" }
      ]
    }
  ]
}
```

### Vercel Project Settings
- **Root Directory:** `sites/inside-goclaw`
- **Build Command:** `pnpm build` (or `cd ../.. && pnpm build --filter=inside-goclaw`)
- **Output Directory:** `dist`
- **Install Command:** `pnpm install`

### `astro.config.mjs` (already in Phase 1)
```js
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'static',
  adapter: vercel(),
  trailingSlash: 'never',
  build: { format: 'file' }  // /posts/slug → /posts/slug.html
});
```

## URL Verification Checklist
- [ ] `/` → homepage
- [ ] `/posts/yield-mention-mode` → post page
- [ ] `/posts/codex-oauth-pools` → post page
- [ ] `/posts/force-directed-knowledge-graphs` → post page
- [ ] `/admin` → admin dashboard
- [ ] `/admin/review` → review page
- [ ] `/admin/export` → export page
- [ ] `/admin/publish` → publish page
- [ ] `?lang=en` redirects to `/en/...`
- [ ] Old bookmarked URLs work via redirects

## Legacy URL Redirects (Critical)

Users may have bookmarked `?lang=xx` URLs. Must 301 redirect to new locale-prefixed URLs.

### Vercel Edge Middleware (`sites/inside-goclaw/middleware.ts`)
```ts
// Astro middleware — runs at request time (edge on Vercel)
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(({ url, redirect }, next) => {
  const lang = url.searchParams.get('lang');
  if (lang && ['en', 'zh', 'ja'].includes(lang)) {
    // Strip ?lang param, redirect to locale-prefixed URL
    const cleanPath = url.pathname; // e.g. /posts/yield-mention-mode
    return redirect(`/${lang}${cleanPath}`, 301);
  }
  // ?lang=vi or no param → default locale, no redirect needed
  if (lang === 'vi') {
    return redirect(url.pathname, 301);
  }
  return next();
});
```

**Note:** This requires `output: 'server'` or `output: 'hybrid'` for middleware. If staying `output: 'static'`, use Vercel redirects instead:

### Alternative: Vercel `vercel.json` redirects (static-compatible)
```json
{
  "redirects": [
    { "source": "/posts/:slug", "has": [{"type": "query", "key": "lang", "value": "en"}], "destination": "/en/posts/:slug", "statusCode": 301 },
    { "source": "/posts/:slug", "has": [{"type": "query", "key": "lang", "value": "zh"}], "destination": "/zh/posts/:slug", "statusCode": 301 },
    { "source": "/posts/:slug", "has": [{"type": "query", "key": "lang", "value": "ja"}], "destination": "/ja/posts/:slug", "statusCode": 301 },
    { "source": "/posts/:slug", "has": [{"type": "query", "key": "lang", "value": "vi"}], "destination": "/posts/:slug", "statusCode": 301 },
    { "source": "/", "has": [{"type": "query", "key": "lang", "value": "en"}], "destination": "/en", "statusCode": 301 },
    { "source": "/", "has": [{"type": "query", "key": "lang", "value": "zh"}], "destination": "/zh", "statusCode": 301 },
    { "source": "/", "has": [{"type": "query", "key": "lang", "value": "ja"}], "destination": "/ja", "statusCode": 301 },
    { "source": "/drafts/review", "destination": "/admin/review", "statusCode": 301 }
  ]
}
```

**Recommended:** Use `vercel.json` redirects — keeps `output: 'static'` (simpler, cheaper, faster).

## Redirect Coverage
| Old URL | New URL |
|---------|---------|
| `/posts/slug?lang=en` | `/en/posts/slug` |
| `/posts/slug?lang=zh` | `/zh/posts/slug` |
| `/posts/slug?lang=ja` | `/ja/posts/slug` |
| `/posts/slug?lang=vi` | `/posts/slug` |
| `/?lang=en` | `/en` |
| `/drafts/review` | `/admin/review` |

## Success Criteria
- [ ] `vercel build` succeeds locally
- [ ] Deploy preview works
- [ ] All existing URLs return 200
- [ ] Security headers present
- [ ] Static assets (favicon, social images) served correctly
