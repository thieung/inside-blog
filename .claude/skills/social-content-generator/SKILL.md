---
name: social-content-generator
description: Generate social media content (Facebook, X/Twitter) from blog posts in the posts/ folder. Extracts post content, rewrites for each platform's tone and format.
user_invocable: true
command: /social
arguments: "<post-filename> [--platform facebook|x|all]"
---

# Social Content Generator

Generate platform-specific social media content from blog posts.

## Usage

```
/social <post-filename> [--platform facebook|x|all]
```

- `post-filename`: File name in `posts/` folder (e.g., `codex-oauth-pools.html`)
- `--platform`: Target platform. Default: `all` (generates both)

## Instructions

### Step 1: Extract Post Content

Read the HTML file from `posts/<post-filename>`. Extract:
- Title / version tag
- Main problem being solved
- Key features / how it works
- Technical details (but simplify for social)

### Step 2: Generate Content Per Platform

#### Facebook (Vietnamese)

**Tone:** Storytelling tự nhiên, như đang kể cho bạn bè nghe. KHÔNG dùng giọng AI.

**Rules:**
- Viết bằng tiếng Việt
- Mở đầu bằng một câu hook thu hút (đặt vấn đề, hoặc tình huống thực tế)
- Kể theo flow: vấn đề → giải pháp → kết quả
- Nếu có nhiều ý nhỏ cho một ý lớn, xuống dòng với dấu `-` cho từng ý
- Độ dài vừa phải — không quá dài, đủ để người đọc hiểu và muốn tìm hiểu thêm
- Có thể dùng emoji cảm xúc (😅 🔥 💡) nhưng tối đa 3-4 emoji cho cả bài, KHÔNG lạm dụng
- KHÔNG đặt URL trong bài post (thuật toán FB giảm reach cho post có link). URL để riêng trong phần comment
- Kết bài bằng CTA nhẹ nhàng (mời thử, hỏi ý kiến, "link ở comment")
- KHÔNG dùng hashtag quá nhiều, tối đa 2-3 hashtag cuối bài
- KHÔNG viết kiểu marketing/quảng cáo. Viết như đang chia sẻ kinh nghiệm thật

**Format mẫu:**
```
[Câu hook — đặt vấn đề hoặc tình huống thực tế]

[Mô tả vấn đề ngắn gọn]

[Giải pháp — kể cách giải quyết]
- Ý 1
- Ý 2
- Ý 3

[Kết quả / lợi ích]

[CTA nhẹ nhàng — KHÔNG có URL, ghi "link ở comment"]

#hashtag1 #hashtag2
```

**Facebook Comment (chứa URL):**
```
[URL bài viết đầy đủ]
```

#### X / Twitter (English)

**Tone:** Concise, punchy, dev-oriented. Mix of technical credibility and casual energy.

**Rules:**
- Write in English
- Lead with the most compelling technical insight or result
- Use thread format (numbered tweets) if content needs more than 280 chars
- First tweet must stand alone and hook — this is what people see in timeline
- Be specific with numbers, metrics, before/after comparisons
- Use technical terms naturally (developers are the audience)
- Max 2 emojis per tweet, prefer none
- End thread with link to full post
- No corporate-speak. Write like a dev sharing something cool they built
- Okay to use abbreviations common in dev Twitter (e.g., "TIL", "ngl", "fr")

**Format — Single tweet (if fits):**
```
[Key insight or result in one punchy sentence]

[Brief technical detail]

[Link]
```

**Format — Thread:**
```
1/ [Hook — the problem or surprising result]

2/ [How it works — technical but accessible]

3/ [The interesting part — what makes this different]

4/ [Result / metrics / what's next]

Link: [url]
```

### Step 3: Output

Save output to `social/<post-slug>/` directory (create if not exists). Each platform gets its own `.txt` file — plain text, ready to copy-paste directly.

**File structure:**
```
social/
└── <post-slug>/
    ├── facebook-post.txt      # Nội dung bài post (KHÔNG có URL)
    ├── facebook-comment.txt   # URL để paste vào comment đầu tiên
    └── x-post.txt             # Tweet hoặc thread content
```

**Rules:**
- Files are plain `.txt` — no markdown formatting, no headers, no metadata
- Content is exactly what gets pasted onto the platform
- For X threads: separate each tweet with a blank line and `---` separator
- After saving, print file paths and a brief preview of each

### Step 4: Ask for Feedback

After generating, ask the user if they want to:
- Adjust tone (more casual / more technical)
- Shorten or expand
- Regenerate for a specific platform

## Examples

**Input:** `/social codex-oauth-pools.html`

**Output:** Content for both Facebook and X about the Codex OAuth Pools feature.

**Input:** `/social yield-mention-mode.html --platform facebook`

**Output:** Facebook-only content about Yield Mention Mode.
