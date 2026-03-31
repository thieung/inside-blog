# Phase 1: Scaffold Monorepo

**Priority:** Critical | **Effort:** S | **Status:** ⬜

## Overview
Initialize pnpm workspace + Turborepo monorepo with `sites/inside-goclaw` Astro project.

## Implementation Steps

1. **Init monorepo root**
   ```bash
   mkdir blog-platform && cd blog-platform
   pnpm init
   ```

2. **Create `pnpm-workspace.yaml`**
   ```yaml
   packages:
     - 'packages/*'
     - 'sites/*'
   ```

3. **Create `turbo.json`**
   ```json
   {
     "$schema": "https://turbo.build/schema.json",
     "tasks": {
       "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
       "dev": { "cache": false, "persistent": true },
       "check": { "dependsOn": ["^build"] }
     }
   }
   ```

4. **Root `package.json` scripts**
   ```json
   {
     "private": true,
     "scripts": {
       "dev": "turbo dev --filter=inside-goclaw",
       "build": "turbo build",
       "check": "turbo check"
     },
     "devDependencies": {
       "turbo": "^2"
     }
   }
   ```

5. **Scaffold Astro site**
   ```bash
   mkdir -p sites/inside-goclaw
   cd sites/inside-goclaw
   pnpm create astro@latest . --template minimal --no-install
   ```

6. **Configure `astro.config.mjs`**
   ```js
   import { defineConfig } from 'astro/config';
   import vercel from '@astrojs/vercel';

   export default defineConfig({
     output: 'static',
     adapter: vercel(),
     trailingSlash: 'never',
     i18n: {
       defaultLocale: 'vi',
       locales: ['vi', 'en', 'zh', 'ja'],
       routing: { prefixDefaultLocale: false }
     }
   });
   ```

7. **Create directory structure**
   ```
   sites/inside-goclaw/src/
   ├── layouts/
   ├── pages/
   │   ├── posts/
   │   └── admin/
   ├── drafts/
   ├── i18n/
   └── content/
   ```

8. **Copy static assets**
   - `favicon.svg` → `public/favicon.svg`
   - `goclaw-icon.svg` → `public/goclaw-icon.svg`
   - `social/` → `public/social/`

9. **Verify**: `pnpm dev` starts successfully

## Files to Create
- `blog-platform/package.json`
- `blog-platform/pnpm-workspace.yaml`
- `blog-platform/turbo.json`
- `blog-platform/.gitignore`
- `blog-platform/sites/inside-goclaw/` (Astro scaffold)

## Success Criteria
- [ ] `pnpm install` succeeds
- [ ] `pnpm dev` starts Astro dev server
- [ ] `pnpm build` produces static output in `dist/`
