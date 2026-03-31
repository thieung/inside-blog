# Phase 6: Migrate Drafts

**Priority:** Medium | **Effort:** L | **Status:** ⬜
**Depends on:** Phase 3

## Overview
Convert 12 draft HTML files to `.astro`. Same pattern as Phase 4 but files go to `src/drafts/` (not `src/pages/posts/`).

## Draft Placement Strategy
Drafts should NOT be public pages. Two options:

**Option A (recommended):** Store in `src/drafts/` directory (not under `pages/`). Admin review page loads them via dynamic import or fetch.

**Option B:** Store under `pages/drafts/{slug}.astro` but use middleware/redirect to restrict access.

→ **Go with Option A** — drafts are not public until published (moved to `pages/posts/`).

## Drafts to Migrate (12 files)

| Slug | Lines | Notes |
|---|---|---|
| agent-teams-task-board | 1205 | Large — consider sub-components |
| browser-automation-resource-limits | 311 | |
| desktop-edition-goclaw-lite | 1120 | Large |
| embedding-dimensions-multi-provider | 509 | |
| file-upload-workspace | 471 | |
| force-directed-knowledge-graphs | 2038 | Largest — already published version exists |
| image-gallery-session-state | 563 | |
| knowledge-graph-integration | 1318 | Large |
| realtime-team-task-notifications | 340 | |
| semantic-memory-chunk-overlap | 335 | |
| system-settings-dashboard | 540 | |
| task-lifecycle-state-machine | 334 | |

## Migration per Draft
Same as Phase 4 pattern:
1. Extract i18n → `i18n/{slug}.json` (done in Phase 3)
2. Convert HTML → `.astro` with shared components
3. Keep unique CSS per draft

## Publish Workflow
When a draft is approved, it gets:
1. Moved from `src/drafts/{slug}.astro` → `src/pages/posts/{slug}.astro`
2. Card added to `src/data/posts.ts`
3. Status updated in `status.json`

## Success Criteria
- [ ] All 12 drafts converted to .astro format
- [ ] Drafts NOT accessible as public pages
- [ ] Admin review page can load draft content
- [ ] i18n working for each draft
