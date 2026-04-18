---
title: "Multi-Tenant Architecture: Isolated Workspaces trên Shared Infrastructure"
project: goclaw
status: draft
created: 2026-04-14
---

# Multi-Tenant Architecture: Isolated Workspaces trên Shared Infrastructure

GoClaw là một AI agent gateway. Không phải một SaaS đơn giản với một vài bảng user — mà là một hệ thống orchestrating LLM calls, tool executions, agent teams, memory, và real-time messaging channels, tất cả đồng thời, cho nhiều tenants khác nhau. Bài này phân tích cách GoClaw giải quyết bài toán multi-tenancy: từ data segregation ở SQL level, qua Tenant Isolation Layer, đến per-tenant resource quotas và shared infrastructure optimization.

---

## Bài Toán

Khi bạn build một AI gateway cho nhiều clients, câu hỏi đầu tiên không phải là "feature gì" mà là "ai được đọc gì của ai." Một tenant không được nhìn thấy agents của tenant khác. Sessions không được cross-contaminate. LLM provider API keys phải hoàn toàn tách biệt. Và tất cả điều này phải hoạt động trên cùng một PostgreSQL instance, cùng một scheduler, cùng một event bus.

GoClaw hỗ trợ hai deployment modes:

**Mode 1: Personal / Single-Tenant** — GoClaw như một standalone AI backend. Một master tenant, built-in dashboard, không cần config gì thêm. Login bằng gateway token, tạo agents, chat — xong. Mọi data đều nằm dưới "master" tenant mặc định.

**Mode 2: SaaS / Multi-Tenant** — GoClaw là AI engine đằng sau SaaS application của bạn. App của bạn lo auth, billing, UI. GoClaw lo AI. Mỗi tenant hoàn toàn isolated: agents, sessions, memory, teams, providers, files.

Điểm quan trọng: hai modes này không phải hai codebase khác nhau. Đây là cùng một hệ thống, chỉ khác ở cách credentials được resolve. Multi-tenant features activate tự động khi bạn tạo thêm tenants — không cần migration.

---

## Tenant Isolation Layer

Trước khi bất kỳ request nào chạm vào agent engine, nó phải đi qua Tenant Isolation Layer. Layer này resolve `tenant_id` từ credentials và inject vào Go `context.Context`. Từ đây, mọi downstream operation — SQL queries, tool calls, memory lookups — đều carry tenant context theo.

```
HTTP API ──────────────────┐
WebSocket ──────────────── ▶ Tenant Isolation Layer ──▶ Agent Engine
Chat Channels (Telegram...) ┘       │
                                     ▼
                              ctx với tenant_id
                              → SQL WHERE tenant_id = $N
```

Có ba loại connection, mỗi loại resolve tenant theo cách khác nhau:

**HTTP / WebSocket:** Client gửi API key trong `Authorization: Bearer` header. Key này được bind với một `tenant_id` cụ thể lúc tạo key. GoClaw đọc key, lookup tenant từ `api_keys` table, inject vào context. Client không cần gửi tenant header — API key đã carry thông tin đó.

**Chat Channels (Telegram, Discord, Zalo...):** Không có API key. Tenant isolation được baked vào `channel_instances` table lúc channel được register. Khi message đến từ Telegram webhook, Channel Manager lookup instance config và inject tenant context — không cần headers hay tokens.

**Dashboard / Browser Pairing:** Gateway token hoặc browser pairing code. Nếu user ID là owner ID (configured qua `GOCLAW_OWNER_IDS`), họ được cross-tenant access. Còn lại → master tenant hoặc membership-validated tenant hint.

### Fail-Closed Design

Điều quan trọng nhất: missing tenant = error, không bao giờ là unfiltered data. Đây là fail-closed design — nếu tenant context không được resolve, request bị reject ngay, không phải silently return data của tất cả tenants.

Tất cả 40+ tables carry `tenant_id` với NOT NULL constraint. Exception duy nhất: `api_keys.tenant_id` nullable — NULL = system-level cross-tenant key.

---

## Data Segregation: SQL-Level Isolation

Cách thực hiện data segregation đơn giản nhưng chắc chắn: mọi query đều có `WHERE tenant_id = $N`. Không có application-level filtering sau khi fetch — filter xảy ra ở DB level.

```sql
-- Ví dụ: query agents
SELECT * FROM agents WHERE tenant_id = $1 AND ...

-- Ví dụ: query sessions
SELECT * FROM sessions WHERE tenant_id = $1 AND user_id = $2
```

Schema pattern này được replicate qua 40+ tables. V3 stores mới (`evolution`, `vault`, `episodic`, `agent_links`) đều follow cùng pattern:

| Store | Purpose | Tenant Scoping |
|-------|---------|----------------|
| `EvolutionMetrics` | Track agent improvement suggestions | `WHERE tenant_id = $N` |
| `Vault` | Persistent data storage for agents | `WHERE tenant_id = $N` |
| `Episodic` | Episodic memory | `WHERE tenant_id = $N` |
| `AgentLink` | Delegation links between agents | `WHERE tenant_id = $N` |

**Master tenant UUID:** `0193a5b0-7000-7000-8000-000000000001`. Single-tenant deployments dùng UUID này cho tất cả data.

### Identity Propagation Pattern

GoClaw không phải auth provider. Nó trust upstream service để provide user identity qua `X-GoClaw-User-Id` header (opaque, max 255 chars). GoClaw không validate hay interpret format này — nó chỉ dùng làm scoping key.

Cho multi-tenant deployments, convention được recommend:

```
tenant.{tenantId}.user.{userId}
```

Format này đảm bảo natural isolation vì `user_id` được dùng làm scoping key qua tất cả per-user tables: `user_context_files`, `user_agent_profiles`, `sessions`, `traces`, `mcp_user_grants`, `skill_user_grants`.

---

## Per-Tenant Configurations

Mỗi tenant có thể customize environment của mình mà không ảnh hưởng đến tenants khác. Đây là "isolated workspaces" theo nghĩa rộng hơn — không chỉ data, mà cả configuration.

### LLM Providers

Mỗi tenant register API keys và models của riêng mình. Tenant A dùng Claude Opus với Anthropic API key của họ. Tenant B dùng GPT-4o với OpenAI key của họ. GoClaw orchestrate cả hai trên cùng một instance.

### Builtin Tools — 4-Tier Config Overlay

Tool configuration resolve theo 4-tier priority (specific wins):

```
Per-Agent Override
       ↓ (fallback)
Per-Tenant Override  ← tenant bật/tắt tools, override settings
       ↓ (fallback)
Global Config
       ↓ (fallback)
Hardcoded Defaults
```

Overlay được resolve tại Execute time, không phải startup time. Tenant có thể disable một tool globally nhưng vẫn allow một agent cụ thể dùng nó.

### Skills và MCP Servers

Skills có thể enable/disable per tenant qua `skill_tenant_configs` table. MCP servers hỗ trợ hai tiers credentials:

- **Server-level (shared):** Config trong MCP server form, dùng bởi tất cả users
- **User-level (override):** Configured qua "My Credentials", per-user API keys, merge at runtime (user wins on key collision)

Khi `require_user_credentials` enabled, users không có personal credentials không thể dùng MCP server đó — tenant-level enforcement mà không cần custom code.

---

## Resource Quotas

Đây là câu chuyện thực: một Telegram group với 40 members, một bot, hai power users gửi 200+ messages/ngày. Anthropic bill tăng gấp ba. Admin nhìn vào dashboard — không có cách nào limit ai cả.

GoClaw giải quyết bài toán này với hai independent quota systems: channel quota (message volume) và tool budget (per-run cost control).

### Channel Quota: Rolling Windows

Quota checker ngồi trong inbound message pipeline — sau agent resolution, trước scheduling. Nó count top-level traces per user qua ba rolling windows: hour, day, week.

Query dùng PostgreSQL `FILTER` clause để count cả ba windows trong một pass duy nhất:

```sql
SELECT
    COUNT(*) FILTER (WHERE created_at >= $2) AS hour_count,
    COUNT(*) FILTER (WHERE created_at >= $3) AS day_count,
    COUNT(*) FILTER (WHERE created_at >= $4) AS week_count
FROM traces
WHERE user_id = $1 AND parent_trace_id IS NULL AND created_at >= $4
```

Backed bởi partial index:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_traces_quota
ON traces (user_id, created_at DESC)
WHERE parent_trace_id IS NULL AND user_id IS NOT NULL;
```

Khi user exceed limit, consumer short-circuits — không có agent call, không có API cost:

```
Hourly request limit reached (40/40). Please try again later.
```

**Config priority:** Group > Channel > Provider > Default. Một Telegram group của paying customers có thể được limit cao hơn default. Một expensive provider (Claude Opus) có thể bị restrict chặt hơn cheap provider (Haiku).

### Optimistic Increment Trick

Vấn đề naive implementation: check DB, allow request, cache TTL 60 giây. Trong 60 giây đó, user có thể gửi 40 messages — tất cả đều pass vì cached count chưa update.

Fix: sau khi accept một request, ngay lập tức bump cached counts in-memory. DB là source of truth khi cache refresh, nhưng giữa các refresh, in-memory count track đúng pace:

```go
func (qc *QuotaChecker) Increment(userID string) {
    qc.mu.Lock()
    defer qc.mu.Unlock()
    if c, ok := qc.cache[userID]; ok {
        c.hour++
        c.day++
        c.week++
    }
}
```

### Tool Budget: Per-Run Cost Control

Vấn đề thứ hai: agent loop vào spiral — read file, run shell, read file, run shell... 80 tool calls sau, context window full, user nhận được câu trả lời tệ mà tốn 10x chi phí.

Tool budget là soft stop. Config đơn giản: default 25, per-agent override trong config:

```go
// internal/config/config.go
MaxToolCalls int `json:"max_tool_calls,omitempty"` // 0 = unlimited, default 25
```

Khi `TotalToolCalls >= MaxToolCalls`, ToolStage emit `BreakLoop` signal. Pipeline thoát iteration loop và chạy FinalizeStage — output whatever `FinalContent` has been accumulated, không crash, không error:

```go
// internal/pipeline/tool_stage.go
if s.deps.Config.MaxToolCalls > 0 && state.Tool.TotalToolCalls >= s.deps.Config.MaxToolCalls {
    s.result = BreakLoop
}
```

FinalizeStage sau đó flush content, update metadata, trigger post-run summarization — graceful stop, user nhận được partial result thay vì một error message.

Distinction quan trọng: `maxIterations` count LLM round-trips (think-act cycles). `maxToolCalls` count individual tool invocations. Một agent gọi 5 tools parallel = 5 tool calls nhưng chỉ 1 iteration.

### Hot-Reload Quota Config

Version 1: thay đổi quota limits trong config → restart gateway → limits update. Nhưng thay đổi qua Web UI thì sao? UI gọi `config.patch`, update in-memory config và save to disk — nhưng `QuotaChecker` giữ copy của `QuotaConfig` từ startup. UI show new values. Checker enforce old ones.

Fix dùng existing pub/sub infrastructure. Sau mỗi `config.patch` hoặc `config.apply`, `ConfigMethods` broadcast `TopicConfigChanged`:

```go
func (m *ConfigMethods) broadcastChanged() {
    if m.eventBus != nil {
        m.eventBus.Broadcast(bus.Event{
            Name: bus.TopicConfigChanged, Payload: m.cfg,
        })
    }
}
```

Gateway subscribe at startup và feed updated config vào checker:

```go
msgBus.Subscribe("quota-config-reload", func(evt bus.Event) {
    if evt.Name != bus.TopicConfigChanged { return }
    updatedCfg, ok := evt.Payload.(*config.Config)
    if !ok || updatedCfg.Gateway.Quota == nil { return }
    config.MergeChannelGroupQuotas(updatedCfg)
    quotaChecker.UpdateConfig(*updatedCfg.Gateway.Quota)
})
```

Không restart. Không config file watcher race. Same pub/sub bus đang drive cache invalidation giờ cũng carry config changes.

---

## Shared Infrastructure Optimization

"Shared" không có nghĩa là "uncontrolled." GoClaw optimize shared infrastructure ở nhiều levels.

### Scheduler Lanes

Concurrency được control qua lane-based model. Mỗi lane là named worker pool với bounded semaphore:

| Lane | Concurrency | Purpose |
|------|:-----------:|---------|
| `main` | 30 | Primary user chat sessions |
| `subagent` | 50 | Spawned subagents |
| `team` | 100 | Agent team/delegation |
| `cron` | 30 | Scheduled cron jobs |

Per-session queues thêm một level granularity nữa: DMs chạy single-threaded (maxConcurrent=1), Groups cho phép 3 concurrent responses. Khi session history vượt 60% context window, concurrency adaptive throttle xuống 1.

### API Key Security và Tenant Impersonation Prevention

Điểm quan trọng về security: tenant được resolve từ API key binding, không từ client headers. Client không thể claim là một tenant khác bằng cách gửi fake `X-GoClaw-Tenant-Id` header — trừ khi họ dùng system-level key với cross-tenant permission.

Các security measures khác trên shared infrastructure:

- API keys hashed SHA-256 at rest; chỉ prefix được show trong UI
- HMAC-signed file tokens (`?ft=`) — không có gateway token trong URLs
- `TENANT_ACCESS_REVOKED` WS event force immediate UI logout khi tenant access bị revoke
- `store.IsMasterScope(ctx)` + `http.requireMasterScope` guard mọi admin-gated write vào global tables
- Event leakage prevention: 3-mode server-side filter (unscoped admin, scoped admin, regular user)

---

## Tenant Lifecycle

Setup một tenant trong SaaS mode:

```bash
# 1. Tạo tenant
POST /rpc → tenants.create {name: "Acme Corp", slug: "acme"}
# Response: {id: "tenant-uuid", slug: "acme"}

# 2. Add user
POST /rpc → tenants.users.add {tenant_id, user_id: "user-123", role: "admin"}

# 3. Tạo API key
POST /rpc → api_keys.create {tenant_id, scopes: ["operator.read", "operator.write"]}
# Response: {key: "goclaw_sk_abc123..."}

# Store key trong backend config/secrets — không bao giờ gửi ra browser
```

API key scopes control access level:

| Scope | Role | What They Can Do |
|-------|------|-----------------|
| `operator.admin` | admin | Full access — agents, config, API keys, tenants |
| `operator.write` | operator | Chat, create sessions, manage agents |
| `operator.read` | viewer | Read-only listing |
| `operator.provision` | operator | Create tenants + manage tenant users |

Từ đây, mọi request dùng key đó tự động scoped vào Acme Corp. Backend của Acme Corp không cần gửi tenant header — API key carry thông tin đó.

---

## Tổng Kết

Multi-tenancy trong GoClaw không phải một "mode" được bolt-on sau. Nó là architectural foundation: fail-closed tenant resolution ở mọi entry point, `WHERE tenant_id = $N` ở mọi SQL query, per-tenant configuration overlays cho providers/tools/skills, và two-layer quota system (channel volume + tool budget) để protect shared infrastructure.

Pattern nổi bật nhất: **isolation by default, sharing by explicit choice.** Mọi thứ bắt đầu với tenant scope. Cross-tenant access chỉ available với explicit system-level credentials. Shared infrastructure (scheduler, event bus, PostgreSQL) được optimize nhưng không expose raw capacity cho từng tenant.

Kết quả: cùng một GoClaw instance có thể chạy cho Acme Corp (enterprise customer với Claude Opus, 50 agents) và startup nhỏ (Haiku, 3 agents) — cùng code, cùng database, hoàn toàn isolated.
