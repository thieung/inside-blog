# Project: GoClaw Blog

Static HTML blog for GoClaw. Deployed on Vercel.

## Stack
- Pure HTML/CSS/JS — no build step
- Each post is a self-contained `.html` file in `posts/`
- Each post has its own unique design (fonts, colors, layout)

## Adding a New Post
1. Create `posts/<slug>.html`
2. Add card entry to `index.html` (newest first)
3. Push — Vercel auto-deploys

## i18n (Multilingual)
Every post MUST support 4 languages: **vi** (default), **en**, **zh**, **ja**.

### How it works
- HTML elements use `data-i18n="key"` attributes. Default text in HTML is Vietnamese.
- Add `data-i18n-html="1"` if content contains HTML tags (`<em>`, `<strong>`, `<code>`, etc.)
- Translation object `const T = { vi: {}, en: {...}, zh: {...}, ja: {...} }` in a `<script>` block
- `setLang(lang)` function iterates `[data-i18n]` elements and replaces innerHTML
- Lang is controlled via URL param `?lang=xx` (homepage passes this)
- Lang buttons (`.lang-btn`) are hidden by default, shown when URL param present

### What to i18n
- All user-visible text: headings, paragraphs, labels, table headers, table descriptions, callouts, list items, card labels, subtitles, KPI labels, footer text
- `index.html` card: title, excerpt in all 4 langs using `data-vi`, `data-en`, `data-zh`, `data-ja` (different system from posts)

### What NOT to i18n
- Code blocks and code examples
- Entity type names (person, project, task, etc.)
- Technical identifiers, variable names, API paths
- Mermaid diagram source text

### Key naming convention
Group by section number, use short descriptive names:
```
hero_sub, hero_title
s1_intro, s1_prereq_title, s1_prereq_p1
s2_title, s9_opt8_before
toc_s1, toc_s2
kpi_label_1, kpi_label_2
footer_text
```

## Social Content
Each post has social media content in `social/<slug>/`:
- `facebook-post.txt`, `facebook-comment.txt`
- `x-post.txt`, `threads-post.txt`
- `thumbnail-vi.html`, `thumbnail-en.html` (1200x630 OG images)

## Vietnamese Writing Style (Social Posts)
When writing Vietnamese social posts, translate tech terms to accessible Vietnamese:
- extraction → trích xuất, storage → lưu trữ, visualization → trực quan hóa
- entity → thực thể, relation → quan hệ, confidence scoring → chấm điểm độ tin cậy
- fallback → cơ chế dự phòng, optimizations → cải tiến, memoization → ghi nhớ (add explanation)
- depth traversal → duyệt sâu, max N hops → tối đa N bước nhảy
- Keep as-is: PostgreSQL, pgvector, recursive CTE, KNN, O(1), Map, Three.js, INP
- No double dashes (--), use commas/periods. Use 🔹 for FB list items.
- English posts (X/Twitter) keep original technical terms.

## Directory Structure
```
posts/          — published HTML posts
drafts/         — work-in-progress posts
social/         — social media content per post
plans/          — implementation plans
docs/           — project documentation
```
