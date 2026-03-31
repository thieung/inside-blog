# Phase 7: Admin Dashboard

**Priority:** High | **Effort:** L | **Status:** ⬜
**Depends on:** Phase 2

## Overview
Centralized admin UI at `/admin/` with GitHub API integration. 4 pages: dashboard, review, export, publish.

## Architecture
- Admin pages are Astro pages with **interactive islands** (`client:load`)
- GitHub API calls via `@blog/core/utils/github-api.ts`
- Token stored in `localStorage` (admin setup flow)
- State tracked in `content/status.json` (committed to repo)

## Pages

### 1. `/admin/` — Dashboard Hub
- Overview: count of drafts per status (draft, in-review, approved, needs-update, published)
- Quick links to all admin actions
- Recent activity log (from GitHub commits API)
- Setup: GitHub token input (first-time)

### 2. `/admin/review` — Review Drafts
- Migrate from existing `drafts/review.html`
- Sidebar: list all drafts with status badges
- Main: iframe preview of selected draft
- Actions: "Start Review" → "Approve" or "Needs Update"
- Notes field per draft (stored in localStorage + optionally in status.json)

### 3. `/admin/export` — Social Content Export
- Migrate from existing `social/export.html`
- Post selector, language selector
- Preview thumbnails (iframe)
- Copy-to-clipboard for social text
- Download PNG export

### 4. `/admin/publish` — Publish Approved Drafts
- List approved drafts ready to publish
- Per draft: preview, confirm publish
- **Publish action** (GitHub API):
  1. Read draft file content via API
  2. Create new file at `src/pages/posts/{slug}.astro`
  3. Update `src/data/posts.ts` with new card entry
  4. Update `content/status.json` → status: "published"
  5. Create PR with all changes
  6. Display PR link for manual merge

## Workflow State Machine

```
status.json structure:
{
  "{slug}": {
    "status": "draft" | "in-review" | "approved" | "needs-update" | "published",
    "updated": "2026-03-31",
    "reviewer": "thieunv",
    "notes": "Check zh translations",
    "pr": "https://github.com/.../pull/123"
  }
}
```

### Transitions
```
draft → in-review       (reviewer clicks "Start Review")
in-review → approved    (reviewer clicks "Approve")
in-review → needs-update (reviewer clicks "Needs Update" + adds notes)
needs-update → draft    (author updates content, resubmits)
approved → published    (admin clicks "Publish" → creates PR)
```

## Interactive Islands Pattern
```astro
---
// admin/review.astro — static shell
---
<html>
<head>...</head>
<body>
  <nav><!-- static admin nav --></nav>

  <!-- Interactive review panel — hydrated on client -->
  <ReviewPanel client:load />
</body>
</html>
```

For the interactive parts, use vanilla JS `<script>` tags (no framework dependency needed) or Preact islands if complexity warrants.

**Recommendation:** Start with vanilla JS `<script>` in Astro (same as current review.html approach). Only add Preact if admin UI becomes complex.

## Files to Create
- `sites/inside-goclaw/src/pages/admin/index.astro`
- `sites/inside-goclaw/src/pages/admin/review.astro`
- `sites/inside-goclaw/src/pages/admin/export.astro`
- `sites/inside-goclaw/src/pages/admin/publish.astro`
- `sites/inside-goclaw/src/content/status.json`

## Security
- Admin pages are public (static site) but require GitHub token to perform actions
- Token scoped to repo only (`repo` scope or fine-grained PAT)
- No sensitive data in HTML — all state changes go through GitHub API
- Consider: add simple password gate (hash in localStorage) for admin access

## Success Criteria
- [ ] All 4 admin pages accessible at `/admin/*`
- [ ] GitHub token setup flow works
- [ ] Review workflow: can approve/reject drafts
- [ ] Publish workflow: creates PR via GitHub API
- [ ] Status badges update correctly
- [ ] Export page matches current functionality
