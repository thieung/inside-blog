---
title: "Self-Evolution Engine — Hệ thống tự tiến hóa cho AI Agents trong GoClaw"
project: goclaw
status: draft
created: 2026-04-14
slug: self-evolution-engine
---

01 — Giới thiệu

## Self-Evolution Engine là gì?

Hầu hết các AI agent hôm nay hoạt động theo một vòng lặp cố định: nhận input → suy nghĩ → trả lời. Khi workflow phức tạp lặp đi lặp lại, agent vẫn phải "học lại từ đầu" mỗi lượt, không nhớ rằng mình đã làm điều này hàng chục lần trước.

**Self-Evolution Engine** trong GoClaw giải quyết bài toán này với ba cơ chế bổ trợ nhau:

| Cơ chế | Mục tiêu | Cách hoạt động |
|--------|----------|----------------|
| **Self-Evolution** (SOUL.md) | Điều chỉnh phong cách giao tiếp | Agent dùng `write_file` cập nhật SOUL.md sau mỗi cuộc trò chuyện |
| **Skill Learning Loop** | Đóng gói workflow lặp lại thành skill | Postscript + budget nudge → user consent → `skill_manage(create)` |
| **Metrics & Suggestion Engine** | Tự động phát hiện cơ hội cải thiện | Cron job phân tích 7-day metrics → tạo suggestion cho admin review |

Ba tầng này tạo ra một vòng phản hồi khép kín: agent học từ interactions, tích lũy thành skill, và hệ thống metrics liên tục theo dõi hiệu quả để đề xuất tinh chỉnh.

---

02 — Vấn đề

## Tại sao agent truyền thống không thể cải thiện?

Một agent thông thường không có bộ nhớ dài hạn về *cách nó làm việc*. Nó biết về kiến thức qua training, nhưng không biết rằng:

- Trong 2 tuần qua, tool `web_search` thất bại 80% lần gọi
- 15 session liên tiếp, nó lặp đi lặp lại cùng 5-bước workflow để viết báo cáo
- User luôn nói "bạn giải thích hơi kỹ thuật quá" nhưng không có gì thay đổi

Không có cơ chế nào để:
1. **Nhớ pattern** — workflow nào hiệu quả, tool nào hay fail
2. **Phản ánh** — nhận ra sự lặp lại và đóng gói nó
3. **Thích nghi** — điều chỉnh hành vi dựa trên feedback thực tế

GoClaw giải quyết từng bài toán trên bằng một cơ chế riêng biệt.

---

03 — Self-Evolution: SOUL.md

## Tầng 1 — Tiến hóa phong cách với SOUL.md

### SOUL.md là gì?

Mỗi predefined agent trong GoClaw có một file cấu hình nhân cách `SOUL.md` — định nghĩa tone, giọng văn, cách phản hồi. Khi `self_evolve = true`, agent được phép tự cập nhật file này để tinh chỉnh phong cách giao tiếp theo thời gian.

Không cần tool riêng — agent dùng chính `write_file` tool vốn có, được intercepted bởi `ContextFileInterceptor` để route write operations vào PostgreSQL thay vì filesystem. Điều khác biệt là interceptor này kiểm soát chặt chẽ những gì được phép ghi.

Ngoài `SOUL.md`, agent cũng có thể cập nhật `CAPABILITIES.md` — file định nghĩa domain expertise và kỹ năng kỹ thuật — khi `self_evolve=true`.

### Giới hạn an toàn

System prompt tiêm vào section `## Self-Evolution` khi `self_evolve=true`:

```
You may update SOUL.md to refine communication style (tone, voice, vocabulary, response style).

What you CAN evolve:
- Tone, voice, and manner of speaking
- Response style and formatting preferences
- Vocabulary and phrasing patterns
- Interaction patterns based on user feedback

What you MUST NOT change:
- Your name, identity, or contact information
- Your core purpose or role
- Any content in IDENTITY.md or AGENTS.md (these remain locked)
```

Giới hạn này được enforced ở nhiều tầng:

| Tầng | File | Cơ chế |
|------|------|--------|
| System prompt | `systemprompt.go` | CAN/MUST NOT guidance |
| Context File Interceptor | `context_file_interceptor.go` | Chỉ SOUL.md mới writable |
| File locking | - | IDENTITY.md, AGENTS.md luôn read-only |

Agent chỉ có thể thay đổi *cách* nó nói chuyện, không thể thay đổi *nó là ai*. Chi phí token: ~95 token/request.

---

04 — Skill Learning Loop

## Tầng 2 — Skill Learning Loop: Đóng gói workflow thành Skill

### Luồng hoạt động

Khi một predefined agent hoàn thành một task phức tạp (nhiều tool calls), hệ thống không để workflow đó biến mất. Có ba điểm chạm trong agent loop:

```
Admin bật skill_evolve = true
    ↓
System prompt: hướng dẫn SHOULD/SHOULD NOT tạo skill
    ↓
Agent xử lý task (think → act → observe)
    ↓
Budget milestone?
    ├── ≥ 70% iterations → ephemeral nudge (nhẹ)
    └── ≥ 90% iterations → ephemeral nudge (moderate)
    ↓
Task hoàn thành
    ↓
totalToolCalls ≥ skill_nudge_interval (default: 15)?
    ├── Không → response bình thường
    └── Có → Postscript: "Save as skill? or skip?"
              ↓
         User reply
              ├── "skip" → không làm gì
              └── "save as skill" → agent gọi skill_manage(create)
                                    → Skill tạo + auto-granted
                                    → Sẵn sàng từ lượt sau
```

### Budget Nudges — Nhắc nhở giữa chừng

Hai ephemeral nudge được inject vào giữa agent loop khi ngưỡng iteration bị đạt:

**70% budget:**
```
[System] You are at 70% of your iteration budget. Consider whether any
patterns from this session would make a good skill.
```

**90% budget:**
```
[System] You are at 90% of your iteration budget. If this session involved
reusable patterns, consider saving them as a skill before completing.
```

Đây là ephemeral messages — không được persist vào session history, không tốn token về sau. Vai trò: nhắc agent *suy nghĩ về khả năng tái sử dụng* trong khi vẫn còn iteration budget.

### Postscript — Lời đề nghị cuối bài

Khi `totalToolCalls >= skill_nudge_interval`, agent tự động append vào cuối response:

```
---
_This task involved several steps. Want me to save the process as a
reusable skill? Reply "save as skill" or "skip"._
```

Điểm quan trọng: **không có skill nào được tạo mà không có sự đồng ý tường minh của user.** Postscript chỉ là lời đề nghị. User phải reply "save as skill" thì agent mới gọi `skill_manage(create)`.

### skill_manage Tool

Khi user đồng ý, agent gọi `skill_manage` để tạo skill từ content string (SKILL.md body):

| Action | Params | Mô tả |
|--------|--------|-------|
| `create` | `content` (SKILL.md) | Tạo skill mới từ workflow |
| `patch` | `slug`, `find`, `replace` | Cập nhật một phần skill đã tạo |
| `delete` | `slug` | Xóa mềm, move vào `.trash/` |

Skill được tạo đi qua pipeline:
1. Size check (≤ 100KB)
2. Security scan (25 regex rules — xem phần bảo mật)
3. Parse frontmatter
4. Slug validation + system skill conflict check
5. Write SKILL.md vào versioned directory
6. DB insert với advisory lock
7. Auto-grant + dependency scan

### Tool Gating

Khi `skill_evolve = false`, `skill_manage` hoàn toàn ẩn với LLM:
- Bị filter khỏi `toolDefs` trước khi gửi lên provider
- Bị filter khỏi `toolNames` trong system prompt

Tool vẫn tồn tại trong shared registry (admin thấy), nhưng agent không có awareness về nó.

---

05 — Metrics & Suggestion Engine

## Tầng 3 — Metrics-Driven Suggestions: Cải thiện dựa trên dữ liệu

### Kiến trúc thu thập metrics

Trong quá trình agent hoạt động, GoClaw ghi lại ba loại metrics:

| Loại | Dữ liệu thu thập | Ví dụ |
|------|-----------------|-------|
| **tool** | invocation_count, success_rate, failure_count, avg_duration_ms | `web_search` gọi 150 lần, 85% thành công |
| **retrieval** | recall_rate, precision, relevance_score, query_count | Knowledge vault: 200 queries, 18% usage rate |
| **feedback** | rating, sentiment, effectiveness_score | User abort/rephrase pattern |

Metrics aggregate theo **7-day rolling window** để phân tích pattern ổn định.

### SuggestionEngine — Ba quy tắc phân tích

`SuggestionEngine` chạy như một cron job hàng ngày, áp dụng pluggable rules lên aggregated metrics:

```
Metrics Aggregation (7-day window)
    ↓
Rule Evaluation
    ├─ LowRetrievalUsageRule    → knowledge recall thấp → tăng threshold
    ├─ ToolFailureRule          → tool hay fail → xem xét fix/disable
    └─ RepeatedToolRule         → tool gọi quá nhiều → cân nhắc tạo skill
    ↓
Suggestion Creation (status: pending)
    ↓
Admin Review → Approve / Reject / Rollback
```

**LowRetrievalUsageRule:** Trigger khi `usage_rate < 0.2` trên 50+ queries — nghĩa là knowledge vault trả về kết quả nhưng agent dùng dưới 20%. Đề xuất: tăng retrieval threshold để lọc ketat hơn.

**ToolFailureRule:** Trigger khi `success_rate < 0.1` trên 20+ calls — tool fail hơn 90% lần gọi. Đề xuất: review config hoặc disable tool.

**RepeatedToolRule:** Trigger khi một tool được gọi hơn 100 lần/tuần với success rate > 50%. Đề xuất: tạo skill để đóng gói pattern. Hệ thống còn tự generate `skill_draft` template để admin khởi động nhanh.

### Duplicate Prevention

Mỗi suggestion được identify bằng composite key `(type, metric_key)`. Nếu đã có pending suggestion cùng type + metric key, rule bị skip. Điều này tránh spam suggestion cho cùng một vấn đề.

---

06 — Auto-Adapt Guardrails

## Guardrails — Giới hạn an toàn cho tự động thích nghi

Admin có thể bật auto-apply suggestions với guardrails để kiểm soát mức độ thay đổi:

| Guardrail | Default | Mục đích |
|-----------|---------|----------|
| `max_delta_per_cycle` | 0.1 | Giới hạn mức thay đổi tham số mỗi chu kỳ |
| `min_data_points` | 100 | Cần đủ data trước khi apply (tránh overfitting) |
| `rollback_on_drop_pct` | 20.0 | Auto-rollback nếu quality metric giảm >20% |
| `locked_params` | `[]` | Params không cho phép auto-thay đổi |

### Flow khi apply suggestion

Ví dụ: Admin approve suggestion `low_retrieval_usage` (raise retrieval threshold):

1. System kiểm tra: `min_data_points` đủ? Parameter không locked? Delta ≤ 0.1?
2. Snapshot baseline values vào `suggestion.parameters._baseline`
3. Apply: `retrieval_threshold = current + max_delta_per_cycle` (capped tại 0.95)
4. Update suggestion status → `applied`
5. Monitor: nếu usage_rate drop >20% → auto-rollback → status → `rolled_back`

Rollback sử dụng baseline đã lưu để restore chính xác giá trị trước đó.

### Hiện tại chỉ threshold suggestions mới support auto-apply

Các loại suggestion khác (`tool_failure`, `repeated_tool`) là **informational only** — hệ thống tạo suggestion để admin đọc và quyết định thủ công. Lý do: thay đổi tool config hoặc tạo skill có tác động rộng hơn, cần human judgment.

---

07 — Storage & Versioning

## Versioning Skills: Immutable Directory per Version

Mỗi lần create hoặc patch skill đều tạo một version mới trong filesystem:

```
skills-store/
├── my-workflow-skill/
│   ├── 1/
│   │   └── SKILL.md
│   └── 2/          ← patch tạo version mới
│       ├── SKILL.md
│       └── scripts/ (copy từ v1)
└── .trash/
    └── old-skill.1710000000  ← soft-deleted
```

**Concurrency control:** `pg_advisory_xact_lock` keyed on FNV-64a hash của slug — serialize concurrent version creation cho cùng một skill. Database dùng `ON CONFLICT(slug) DO UPDATE` + `RETURNING id` để handle upserts atomically.

---

08 — Security Model

## Bảo mật 4 tầng cho Skill Mutations

Mọi thao tác tạo/sửa/xóa skill đều đi qua 4 tầng kiểm tra:

```
Mutation request
    ↓
Layer 1: Content Guard (guard.go)
    └── 25 regex rules, hard-reject on ANY violation
    ↓
Layer 2: Ownership Check
    └── Chỉ owner hoặc admin mới được sửa
    ↓
Layer 3: System Skill?
    └── is_system=true → không thể sửa qua bất kỳ path nào
    ↓
Layer 4: Filesystem Safety
    └── symlink / path traversal / size exceeded → reject
    ↓
Mutation applied
```

**Content Guard** quét line-by-line SKILL.md content với 25 regex rules trong 6 category:

| Category | Ví dụ bị chặn |
|----------|--------------|
| Destructive shell | `rm -rf /`, fork bomb, `dd of=/dev/`, `shred` |
| Code injection | `curl \| bash`, `eval$(...)`, `python -c exec()` |
| Credential exfil | `/etc/passwd`, `.ssh/id_rsa`, `AWS_SECRET_ACCESS_KEY` |
| Path traversal | `../../../` deep traversal |
| SQL injection | `DROP TABLE`, `TRUNCATE TABLE`, `DROP DATABASE` |
| Privilege escalation | `sudo`, world-writable `chmod`, `chown root` |

---

09 — Skill Grants & Visibility

## Grants: Kiểm soát ai dùng được skill nào

Khi skill được tạo, `visibility` ban đầu là `private`. Ngay lập tức, `GrantToAgent` được gọi tự động để grant cho agent tạo skill — và quá trình grant này **auto-promote** visibility từ `private` → `internal`. Từ đó agent có thể dùng skill, và admin có thể promote tiếp:

```
Tạo skill → private (momentarily)
    ↓
Auto-grant cho creating agent → internal (agent có thể dùng)
    ↓
GrantToAgent / GrantToUser → internal (mở thêm cho agents/users khác)
    ↓
Admin promotes → public (all agents)
```

Grant/revoke qua HTTP API (`/v1/skills/{id}/grants/agent`) và WebSocket RPC. System skills (`is_system=true`) luôn `public` và không thể bị revoke.

---

10 — Token Cost

## Chi phí Token

Toàn bộ hệ thống evolution được thiết kế để minimize token overhead:

| Component | Khi nào active | ~Tokens | Persist? |
|-----------|---------------|---------|---------|
| Self-evolve section | `self_evolve=true` | ~95 | Mỗi request |
| Skill creation guidance | `skill_evolve=true` | ~135 | Mỗi request |
| `skill_manage` tool definition | `skill_evolve=true` | ~290 | Mỗi request |
| Budget nudge 70% | iter ≥ 70% của max | ~31 | Không (ephemeral) |
| Budget nudge 90% | iter ≥ 90% của max | ~48 | Không (ephemeral) |
| Postscript | toolCalls ≥ interval | ~35 | Có (in session) |

**Tổng overhead per-request khi skill learning bật:** ~305 tokens (skill guidance ~135 + nudges ~79 + postscript ~35 = steady components). Tool definition của `skill_manage` (~290 tokens) được tính riêng vào tool list. Khi cả hai tính năng disabled (default), overhead = 0.

---

11 — Cấu hình

## Tham chiếu cấu hình

Tất cả settings lưu trong `agents.other_config` JSONB:

```json
{
  "self_evolve": true,
  "skill_evolve": true,
  "skill_nudge_interval": 15,
  "evolution_enabled": true,
  "evolution_guardrails": {
    "max_delta_per_cycle": 0.1,
    "min_data_points": 100,
    "rollback_on_drop_pct": 20.0,
    "locked_params": ["security_level"]
  }
}
```

**Quan trọng:** Cả `self_evolve` và `skill_evolve` chỉ hoạt động với **predefined agents**. Open agents luôn nhận `false` bất kể cài đặt trong DB — enforced tại resolver level.

### File tham chiếu

| File | Vai trò |
|------|---------|
| `internal/agent/systemprompt.go` | `buildSelfEvolveSection()`, `buildSkillsSection()` |
| `internal/agent/loop_finalize.go` | Postscript injection |
| `internal/agent/loop_types.go` | `skillNudgeInterval`, state flags |
| `internal/agent/loop_pipeline_callbacks.go` | Postscript content builder |
| `internal/agent/resolver.go` | Predefined-only enforcement |
| `internal/agent/suggestion_engine.go` | `SuggestionEngine`, `Analyze()`, `AnalyzeAll()` |
| `internal/agent/suggestion_rules.go` | `LowRetrievalUsageRule`, `ToolFailureRule`, `RepeatedToolRule` |
| `internal/agent/evolution_guardrails.go` | `CheckGuardrails`, `ApplySuggestion`, `RollbackSuggestion` |
| `internal/tools/skill_manage.go` | `skill_manage` tool (create/patch/delete) |
| `internal/tools/context_file_interceptor.go` | SOUL.md write validation |
| `internal/skills/guard.go` | Content security scanner (25 rules) |
| `internal/store/pg/skills_crud.go` | Version creation với advisory lock |
| `internal/store/pg/evolution_metrics.go` | Metrics CRUD + aggregation |
| `internal/store/pg/evolution_suggestions.go` | Suggestions CRUD + status updates |
| `cmd/gateway_evolution_cron.go` | Daily cron scheduler |

---

12 — Kết luận

## Ba vòng lặp tiến hóa

Self-Evolution Engine không phải một tính năng đơn lẻ — đó là ba vòng phản hồi hoạt động ở ba timescale khác nhau:

**Conversation-level** (SOUL.md): Sau mỗi cuộc trò chuyện, agent có thể điều chỉnh giọng nói, phong cách phản hồi. Thay đổi nhỏ nhưng tích lũy theo thời gian thành một "nhân cách" thật sự phản ánh user preference.

**Session-level** (Skill Learning): Khi một workflow phức tạp lặp lại, agent không phải reinvent the wheel. Nó có thể đóng gói workflow thành một skill có thể tái sử dụng — với sự đồng ý của user.

**System-level** (Metrics & Suggestions): Cron job hàng ngày phân tích hành vi trên 7-day window, tự động phát hiện pattern bất thường (tool hay fail, knowledge không được dùng, workflow lặp lại), và đề xuất cải thiện có cơ sở dữ liệu.

Ba tầng này cùng nhau tạo ra agents không chỉ thực thi task mà còn *cải thiện theo thời gian* — từ phong cách giao tiếp đến kho skill đến tham số hệ thống.
