---
name: blog-pipeline
description: End-to-end blog content pipeline — analyze GoClaw release versions, extract insights, draft visual HTML articles, generate social media content, and queue for review. Orchestrates researcher, frontend-design, and social-content-generator skills.
user_invocable: true
command: /blog
arguments: "[--version vX.Y.Z] [--scan] [--draft <slug>] [--publish <slug>] [--status]"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Bash
  - Agent
  - Skill
---

# Blog Content Pipeline

End-to-end workflow from GoClaw release analysis to published blog post.

## Commands

```
/blog --scan                    # Scan releases, find new blog-worthy topics
/blog --version v2.XX.0         # Analyze specific version, draft article
/blog --version v2.XX.0 --pr URL # Analyze version with specific PR context
/blog --draft <slug>            # Generate full article + social for existing draft
/blog --publish <slug>          # Move draft to posts/, add to index.html, push
/blog --status                  # Show pipeline status (drafts, pending review, published)
```

## Usage Examples

### Example 1: Write blog for a new release with PR
```
/blog --version v2.47.0 --pr https://github.com/nextlevelbuilder/goclaw/pull/572
```
This will:
1. Fetch PR #572 details (title, description, changed files)
2. Read changed files in `../goclaw/` codebase
3. Generate analysis report → `plans/reports/researcher-{date}-v247-analysis.md`
4. Draft visual HTML article → `drafts/<slug>.html`
5. Generate social content → `social/<slug>/` (FB, Threads, X, thumbnails)
6. Post enters review queue → view at `http://localhost:PORT/drafts/review`

### Example 2: Scan for uncovered releases
```
/blog --scan
```
Compares all GoClaw versions against existing posts/drafts, identifies gaps.

### Example 3: Publish an approved draft
```
/blog --publish force-directed-knowledge-graphs
```
Moves draft → posts/, adds to index.html, commits and pushes.

### Review Portal
```bash
# Start server
npx serve . -l 4447
# Open review portal
open http://localhost:4447/drafts/review
# Open social export tool
npx serve social/ -l 4446
open http://localhost:4446/export
```

## Pipeline Stages

### Stage 1: Release Scan (`--scan`)

**Agent:** `researcher`

1. Read GoClaw changelog/tags from `../goclaw/` (git tags, docs/changelog, commit history)
2. Cross-reference with existing posts in `posts/` and `drafts/`
3. For each uncovered version:
   - List ALL notable features
   - Pick best blog topic (visual complexity + technical depth + reader appeal)
   - Flag alternative topics as "upcoming" for future posts
4. Skip bugfix/patch releases
5. Output: report saved to `plans/reports/researcher-{date}-release-scan.md`

**Already covered versions** (check before scanning):
```bash
# Get list of published + draft slugs
ls posts/*.html drafts/*.html 2>/dev/null | xargs grep -l 'version' | head -20
```

### Stage 2: Deep Analysis (`--version vX.Y.Z`)

**Agent:** `researcher`

1. Read the scan report for the target version
2. Deep-dive into GoClaw codebase for the chosen topic:
   - `../goclaw/` — Go source code (grep for relevant functions, structs, handlers)
   - `../goclaw/docs/` — official documentation
3. Extract:
   - Key Go structs and their fields
   - Architecture flow (request → handler → store → response)
   - Configuration options
   - Use cases (real-world scenarios)
4. Output: detailed analysis in `plans/reports/researcher-{date}-{slug}.md`

### Stage 3: Article Draft (`--draft <slug>`)

**Agent:** `fullstack-developer` with `/ck:frontend-design` skill

**Input:** Analysis report from Stage 2

**Output:** `drafts/<slug>.html`

**Design Rules:**
- Read existing posts for style reference — pick ONE, don't replicate
- Create UNIQUE visual style per post (different fonts, colors, aesthetic)
- Each post has its own personality matching the topic

**Mandatory elements:**
- Multi-language: VI/EN/CN/JP with in-page lang switcher (NOT floating)
- Hero section with animated title + version badge
- Visual diagrams (CSS/SVG, no external libs):
  - Architecture/flow diagrams
  - State machines or decision trees
  - Comparison tables
  - Interactive elements (hover effects, CSS animations)
- Code snippets with syntax highlighting (real code from codebase)
- Use cases section (3-4 cards)
- Self-contained HTML (Google Fonts only external dependency)
- Favicon: `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
- Float home button (bottom-left): arrow-left icon, styled to match post theme
- Responsive 390px+ (test with iPhone 12 Pro viewport)
- NO emojis — use inline Lucide SVG icons
- Target: 400-800 lines (concise posts), 800-1200 lines (complex topics)

**Vietnamese translation quality:**
- Don't mix English terms into Vietnamese text unnecessarily
- Technical terms that have no good Vietnamese equivalent stay in English (e.g., "agent", "webhook", "pgvector")
- Avoid awkward literal translations

### Stage 4: Social Content

**Skill:** `/social <slug> --all`

Generates for each post:
- `social/<slug>/facebook-post.txt` — Vietnamese, casual
- `social/<slug>/facebook-comment.txt` — URL only
- `social/<slug>/threads-post.txt` — Vietnamese, shorter than FB
- `social/<slug>/x-post.txt` — English, single long-form post
- `social/<slug>/thumbnail-en.html` — poster 1200×630
- `social/<slug>/thumbnail-vi.html` — poster 1200×630

**Thumbnail design rules:**
- Match the blog post's color scheme and fonts
- Layout: GoClaw icon (48px) + brand top-left, version badge top-right, eyebrow "INSIDE GOCLAW", title, subtitle, tags bottom-left, `goclaw.thieunv.space` bottom-right
- Background watermark: `goclaw-icon.svg` 320px, semi-transparent right side
- Left accent bar: 6px gradient using post accent colors
- Clean poster — NO UI controls, NO scripts
- Icon path: `../goclaw-icon.svg` (relative to `social/<slug>/`)

### Stage 5: Review Queue

After generating, the post enters review state:
- Draft HTML accessible at `drafts/<slug>.html`
- Review portal: serve repo locally → `/drafts/review`
- Review status tracked in portal (pending → approved → published)
- Social export tool: `/social/export` (select post, lang, platform → export PNG)

### Stage 6: Publish (`--publish <slug>`)

1. Move `drafts/<slug>.html` → `posts/<slug>.html`
2. Add entry to `index.html` (newest first, above existing posts)
3. `git add -A && git commit && git push`
4. Vercel auto-deploys

**Index entry template:**
```html
<a class="post-card" href="/posts/<slug>">
  <div class="post-header">
    <span class="post-version">vX.Y.Z</span>
    <span class="post-date">Mon DD, YYYY</span>
  </div>
  <div class="post-body">
    <div class="post-content">
      <div class="post-title">
        <span data-vi>Vietnamese title</span>
        <span data-en hidden>English title</span>
        <span data-zh hidden>Chinese title</span>
        <span data-ja hidden>Japanese title</span>
      </div>
      <p class="post-excerpt">
        <span data-vi>Vietnamese excerpt</span>
        <span data-en hidden>English excerpt</span>
        <span data-zh hidden>Chinese excerpt</span>
        <span data-ja hidden>Japanese excerpt</span>
      </p>
      <div class="post-tags">
        <span class="post-tag">tag1</span>
        <span class="post-tag">tag2</span>
      </div>
    </div>
    <div class="post-arrow"><svg>...</svg></div>
  </div>
</a>
```

## Status (`--status`)

Print current pipeline state:

```
Published (2):
  ✓ v2.34.0  Codex OAuth Pools
  ✓ v2.24.0  Yield Mention Mode

Drafts — Pending Review (11):
  ○ v2.21.0  Image Gallery & Session State
  ○ v2.19.0  Semantic Memory Chunk Overlap
  ...

Uncovered Versions:
  - v2.23.0  (skipped — MCP read-only, niche)
  - v2.22.0  (skipped — stop button, small)
  ...
```

## Project Paths

```
goclaw-blog/
├── posts/               # Published (deployed on Vercel)
├── drafts/              # Pending review (local only on prod, accessible via review portal)
│   └── review.html      # Review portal
├── social/              # Social media content (gitignored, local only)
│   ├── export.html      # Export tool
│   ├── goclaw-icon.svg  # Shared icon
│   └── <slug>/          # Per-post social content
├── plans/reports/       # Research & analysis reports
├── index.html           # Homepage (only published posts listed)
├── goclaw-icon.svg      # Blog icon
├── favicon.svg          # Favicon
└── vercel.json          # Deployment config
```

## Reference: GoClaw Source

```
../goclaw/               # Main Go codebase
├── docs/                # Official documentation (11 chapters)
├── internal/            # Core packages
│   ├── store/           # Database stores (PostgreSQL, SQLite)
│   ├── tools/           # Agent tools
│   └── handler/         # HTTP/WS handlers
└── ui/                  # Frontend (React) + Desktop (Wails)
```

## Orchestration

When running full pipeline (`--version`), chain agents:

```
researcher (analyze) → fullstack-developer (draft HTML) → /social (content + thumbnails)
```

- Each agent gets only relevant context (no full session history)
- Pass analysis report path between stages
- Agents run sequentially (each depends on previous output)
- Social content can run in parallel (text agent + thumbnail agent)
