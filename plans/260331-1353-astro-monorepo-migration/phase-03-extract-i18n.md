# Phase 3: Extract i18n Translations

**Priority:** High | **Effort:** L | **Status:** ⬜
**Depends on:** Phase 2

## Overview
Extract `const T = {...}` from every post into separate JSON files at `sites/inside-goclaw/src/i18n/{slug}.json`.

## Process per Post

1. Open HTML file, locate `const T = { vi: {...}, en: {...}, zh: {...}, ja: {...} }`
2. Copy object to `i18n/{slug}.json`
3. Remove `const T` and `setLang()` from HTML (replaced by `I18nLoader` component)
4. Verify all `data-i18n` keys exist in JSON

## Files to Create

| Source Post | Target JSON |
|---|---|
| `posts/yield-mention-mode.html` | `i18n/yield-mention-mode.json` |
| `posts/codex-oauth-pools.html` | `i18n/codex-oauth-pools.json` |
| `posts/force-directed-knowledge-graphs.html` | `i18n/force-directed-knowledge-graphs.json` |

Plus 12 draft files (same pattern).

## JSON Structure
```json
{
  "vi": {
    "hero_sub": "...",
    "hero_title": "...",
    "s01_title": "...",
    "footer_text": "..."
  },
  "en": { ... },
  "zh": { ... },
  "ja": { ... }
}
```

## Automation
Consider writing a script to extract `const T = {...}` from HTML files:
```bash
# Pseudocode — extract T object from script block
node -e "
  const html = require('fs').readFileSync(process.argv[1], 'utf8');
  const match = html.match(/const T = (\{[\s\S]*?\n\});/);
  if (match) {
    const obj = eval('(' + match[1] + ')');
    console.log(JSON.stringify(obj, null, 2));
  }
" posts/yield-mention-mode.html > i18n/yield-mention-mode.json
```

## Validation
For each post, verify:
- [ ] All `data-i18n` keys in HTML exist in JSON
- [ ] All 4 languages present (vi, en, zh, ja)
- [ ] No HTML-containing values missing `data-i18n-html="1"` attribute
- [ ] Vietnamese default text in HTML matches `vi` translations

## Success Criteria
- [ ] All 15 posts (3 published + 12 drafts) have corresponding JSON
- [ ] `I18nLoader` component correctly loads translations at build time
- [ ] Language switching works in dev mode
