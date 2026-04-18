# Inside GoClaw — 3-Tier Memory: Bộ nhớ phân tầng cho AI Agent

**Series:** Inside GoClaw  
**Version:** v3.3.0  
**Tags:** memory-system, episodic-memory, knowledge-graph, consolidation, auto-inject  
**Date:** April 2026

---

## TL;DR

3-Tier Memory là hệ thống bộ nhớ phân tầng của GoClaw v3: **L0 Working Memory** (context đang active) → **L1 Episodic Memory** (tóm tắt sessions 90 ngày, hybrid searchable) → **L2 Semantic Memory** (Knowledge Graph với temporal facts). Event-driven consolidation pipeline với 4 workers async xử lý: EpisodicWorker → SemanticWorker → DedupWorker → DreamingWorker. Auto-inject tự động recall context mỗi turn mà user không cần làm gì.

---

## 01 — Vấn đề

AI agent mất context sau mỗi cuộc hội thoại.

Hôm nay bạn giải thích dự án A, mai bạn phải giải thích lại từ đầu. Agent không nhớ bạn thích gì, ghét gì, đang làm gì. Đây là vấn đề **context loss** — và nó ảnh hưởng trực tiếp đến trải nghiệm người dùng.

**3 pain points cụ thể:**

1. **No continuity** — Agent không nhớ cuộc hội thoại trước. User phải re-explain context mỗi session mới.
2. **No long-term understanding** — Agent không build được knowledge về user, project, relationships qua thời gian.
3. **No pattern recognition** — Agent không detect được patterns qua nhiều sessions (ví dụ: user thường hỏi về OAuth vào sáng thứ 2).

**Giải pháp naive:** Lưu toàn bộ hội thoại vào database, inject tất cả vào context mỗi lần chat. 

**Vấn đề:** 
- Context window có giới hạn (4K-200K tokens)
- Chi phí API cao (token-based pricing)
- Response chậm (prompt dài = latency cao)
- Noise cao (90% old context không relevant)

GoClaw v3 giải quyết bằng **3-Tier Memory** — hệ thống bộ nhớ phân tầng lấy cảm hứng từ cách bộ nhớ con người hoạt động: Working Memory (cái đang nghĩ) → Episodic Memory (ký ức events) → Semantic Memory (facts đã học).

---

## 02 — Kiến trúc tổng quan

### 3 tầng bộ nhớ

| Tầng | Tên | Storage | Retention | Mục đích |
|------|-----|---------|-----------|----------|
| **L0** | Working Memory | `sessions.messages` | Trong phiên | Context đang active, LLM "nhìn thấy" trực tiếp |
| **L1** | Episodic Memory | `episodic_summaries` | 90 ngày | Tóm tắt sessions, hybrid FTS + vector search |
| **L2** | Semantic Memory | `kg_entities` + `kg_relations` | Lâu dài | Knowledge Graph với temporal validity |

### Data Flow

```
Session đang diễn ra
        ↓
   L0: Working Memory
   (sessions.messages)
        ↓
   Auto-compaction (4K soft threshold)
        ↓
Session kết thúc
        ↓
   [run.completed event]
        ↓
   EpisodicWorker
   ├─ Summarize session (2-4 paragraphs)
   ├─ Generate L0 Abstract (~50 tokens)
   ├─ Extract key topics
   └─ Store in episodic_summaries (90d TTL)
        ↓
   [episodic.created event]
        ↓
   ┌────────────────────────────────────┐
   │                                    │
   ▼                                    ▼
SemanticWorker                    DreamingWorker
(immediate)                       (10m debounce)
   │                                    │
   ├─ Extract entities + relations      ├─ Batch collect unpromoted
   ├─ Set temporal validity             ├─ Filter by recall signals
   └─ Ingest into KG                    ├─ LLM synthesis
        ↓                               └─ Mark promoted
   [entity.upserted event]
        ↓
   DedupWorker
   ├─ Find similar entities (cosine)
   └─ Merge duplicates
```

### Event-Driven Architecture

GoClaw sử dụng **DomainEventBus** cho asynchronous consolidation. Workers subscribe to typed events:

| Event | Listener | Action |
|-------|----------|--------|
| `run.completed` | EpisodicWorker | Create episodic summary |
| `episodic.created` | SemanticWorker | Extract KG facts |
| `episodic.created` (10m debounce) | DreamingWorker | Batch synthesis |
| `entity.upserted` | DedupWorker | Merge duplicates |

**Đặc điểm:**
- **Non-blocking** — User không phải chờ consolidation
- **Idempotent** — Keyed by `source_id` cho dedup, có thể replay events an toàn
- **Fault-tolerant** — Worker fail không block pipeline
- **Configurable per-agent** — Threshold, debounce, enabled flag

---

## 03 — L0: Working Memory

Working Memory là context đang active trong phiên chat hiện tại — những gì LLM "nhìn thấy" trực tiếp trong prompt.

### Storage

```sql
-- Messages stored in sessions table
sessions.messages: JSONB[]  -- Array of conversation messages
```

### Auto-Compaction

Khi context window đầy, GoClaw tự động compact:

| Threshold | Value | Ý nghĩa |
|-----------|-------|---------|
| Soft threshold | 4,000 tokens | Bắt đầu xem xét compaction |
| Context floor | 20,000 tokens | Trigger compaction nếu context > floor |

**Process:**
1. Summarize older messages thành 1 paragraph
2. Replace old messages với summary
3. Inject summary vào system prompt
4. Keep recent messages intact

User không cần làm gì — hệ thống tự quản lý.

### L0 Abstract Generation

Khi session kết thúc, EpisodicWorker extract **L0 Abstract** — một câu ~50 tokens tóm tắt nội dung chính. Abstract này được dùng cho auto-inject ở các session sau.

```go
// internal/consolidation/l0_abstract.go
func generateL0Abstract(summary string) string {
    // Split summary into sentences
    sentences := splitSentences(summary)
    
    // Find first meaningful sentence (≥20 runes)
    for _, s := range sentences {
        if len([]rune(s)) >= 20 {
            // Truncate to 200 runes max
            return truncateRunes(s, 200)
        }
    }
    
    // Fallback: first 200 runes of summary
    return truncateRunes(summary, 200)
}
```

**Ví dụ:**
- **Full summary:** "Alice hỏi về cách implement OAuth2 với refresh tokens. Tôi giải thích flow 3-legged OAuth, so sánh access token vs refresh token, và demo code với golang.org/x/oauth2. Cô ấy đặc biệt quan tâm đến token rotation strategy..."
- **L0 Abstract:** "Discussed OAuth2 implementation with refresh tokens in Go, covering 3-legged flow and token rotation."

---

## 04 — L1: Episodic Memory

Episodic Memory lưu tóm tắt các sessions trong 90 ngày gần đây. Đây là "ký ức ngắn hạn" của agent — không phải raw messages, mà là **summaries** có thể search được.

### Schema

```sql
CREATE TABLE episodic_summaries (
    id             UUID PRIMARY KEY,
    tenant_id      UUID NOT NULL,
    agent_id       UUID NOT NULL,
    user_id        VARCHAR(255) NOT NULL,
    session_key    TEXT NOT NULL,
    
    -- Content
    summary        TEXT NOT NULL,           -- Full 2-4 paragraph summary
    l0_abstract    TEXT,                    -- ~50 token abstract for auto-inject
    key_topics     TEXT[],                  -- Extracted entity names for filtering
    
    -- Search
    embedding      vector(1536),            -- pgvector for semantic search
    tsv            tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', summary)
    ) STORED,
    
    -- Lifecycle
    source_type    TEXT,                    -- "session", "v2_daily", "manual"
    source_id      TEXT,                    -- Dedup key (session_key:compaction_count)
    turn_count     INT,
    token_count    INT,
    
    -- Recall Signals (Phase 10)
    recall_count   INT DEFAULT 0,           -- Times accessed via memory_search
    recall_score   FLOAT8 DEFAULT 0,        -- Running average of hit scores
    last_recalled_at TIMESTAMPTZ,
    
    -- Promotion
    promoted_at    TIMESTAMPTZ,             -- When promoted to long-term (dreaming)
    
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    expires_at     TIMESTAMPTZ,             -- Auto-expiry (90 days default)
    
    UNIQUE(agent_id, user_id, source_id)
);

-- Indexes
CREATE INDEX episodic_agent_user ON episodic_summaries(agent_id, user_id);
CREATE INDEX episodic_created ON episodic_summaries(created_at DESC);
CREATE INDEX episodic_expires ON episodic_summaries(expires_at);
CREATE INDEX episodic_tsvector ON episodic_summaries USING GIN(tsv);
CREATE INDEX episodic_embedding ON episodic_summaries 
    USING HNSW(embedding vector_cosine_ops);
```

### Hybrid Search

Tìm kiếm kết hợp FTS + Vector — giống như Knowledge Vault nhưng optimized cho auto-inject:

**FTS — tìm keyword match:**
```sql
SELECT ..., ts_rank(tsv, plainto_tsquery('simple', $1)) AS fts_score
FROM episodic_summaries
WHERE agent_id = $2 AND user_id = $3
  AND tsv @@ plainto_tsquery('simple', $1)
```

**Vector — tìm semantic match:**
```sql
SELECT ..., 1 - (embedding <=> $1) AS vec_score
FROM episodic_summaries
WHERE agent_id = $2 AND embedding IS NOT NULL
ORDER BY embedding <=> $1 LIMIT $N
```

**Merge với weights:**

| Source | Weight (Auto-inject) | Weight (Tool search) |
|--------|---------------------|---------------------|
| FTS | 0.7 | 0.3 |
| Vector | 0.3 | 0.7 |

Auto-inject ưu tiên FTS (faster, keyword match) vì chạy mỗi turn. Tool search ưu tiên Vector (semantic) vì user explicitly asking.

**Per-user boost:** Entries của cùng user được boost 1.2x (user-specific context quan trọng hơn).

### EpisodicWorker

Xử lý `run.completed` event khi session kết thúc:

```go
// internal/consolidation/episodic_worker.go
func (w *EpisodicWorker) Handle(ctx context.Context, evt domain.Event) error {
    payload := evt.Payload.(SessionCompletedPayload)
    
    // 1. Build source_id for idempotency
    sourceID := fmt.Sprintf("%s:%d", payload.SessionKey, payload.CompactionCount)
    
    // 2. Check if already processed
    exists, _ := w.store.ExistsBySourceID(ctx, sourceID)
    if exists {
        return nil  // Skip duplicate
    }
    
    // 3. Summarize session
    summary := payload.Summary
    if summary == "" && w.llm != nil {
        summary = w.summarizeSession(ctx, payload.Messages)
    }
    
    // 4. Generate L0 Abstract
    l0Abstract := generateL0Abstract(summary)
    
    // 5. Extract entity names (lightweight)
    keyTopics := extractEntityNames(summary)  // Max 20
    
    // 6. Create entry
    entry := &EpisodicSummary{
        TenantID:   payload.TenantID,
        AgentID:    payload.AgentID,
        UserID:     payload.UserID,
        SessionKey: payload.SessionKey,
        Summary:    summary,
        L0Abstract: l0Abstract,
        KeyTopics:  keyTopics,
        SourceType: "session",
        SourceID:   sourceID,
        TurnCount:  payload.TurnCount,
        TokenCount: payload.TokenCount,
        ExpiresAt:  time.Now().Add(90 * 24 * time.Hour),
    }
    
    // 7. Persist
    if err := w.store.Create(ctx, entry); err != nil {
        return err
    }
    
    // 8. Publish downstream event
    w.bus.Publish(domain.Event{
        Type:    "episodic.created",
        Payload: EpisodicCreatedPayload{
            EpisodicID: entry.ID,
            Summary:    summary,
            KeyEntities: keyTopics,
        },
    })
    
    return nil
}
```

---

## 05 — L2: Semantic Memory (Knowledge Graph)

Semantic Memory là Knowledge Graph lưu trữ **structured facts** với temporal validity. Đây là "trí nhớ dài hạn" của agent — không phải summaries, mà là **entities** và **relations** extracted từ conversations.

### Entity Types (7 loại)

| Type | Ví dụ |
|------|-------|
| `person` | Alice, Bob, CEO John |
| `project` | ProjectX, GoClaw, Mobile App |
| `task` | Implement OAuth, Fix bug #123 |
| `event` | Meeting 2026-04-15, Sprint 5 |
| `concept` | OAuth2, Microservices, Clean Architecture |
| `location` | Vietnam, San Francisco, HQ Office |
| `organization` | Anthropic, Google, Team Alpha |

### Relation Types (17 loại)

| Nhóm | Relations |
|------|-----------|
| Người ↔ Công việc | `works_on`, `manages`, `reports_to`, `collaborates_with` |
| Cấu trúc | `belongs_to`, `part_of`, `depends_on`, `blocks` |
| Hành động | `created`, `completed`, `assigned_to`, `scheduled_for` |
| Vị trí | `located_in`, `based_at` |
| Công nghệ | `uses`, `implements`, `integrates_with` |
| Fallback | `related_to` |

### Temporal Validity

Mỗi fact có `valid_from` và `valid_until` — cho phép point-in-time queries:

```sql
-- kg_entities
valid_from     TIMESTAMPTZ DEFAULT NOW(),
valid_until    TIMESTAMPTZ,  -- NULL = still valid

-- Example query: "What was Alice working on in January?"
SELECT e.*, r.relation_type, t.name as target
FROM kg_entities e
JOIN kg_relations r ON e.id = r.source_entity_id
JOIN kg_entities t ON r.target_entity_id = t.id
WHERE e.name = 'Alice'
  AND e.entity_type = 'person'
  AND r.relation_type = 'works_on'
  AND r.valid_from <= '2026-01-31'
  AND (r.valid_until IS NULL OR r.valid_until >= '2026-01-01');
```

### SemanticWorker

Xử lý `episodic.created` event, extract facts từ summary:

```go
// internal/consolidation/semantic_worker.go
func (w *SemanticWorker) Handle(ctx context.Context, evt domain.Event) error {
    payload := evt.Payload.(EpisodicCreatedPayload)
    
    // 1. Extract entities + relations using EntityExtractor
    extraction, err := w.extractor.Extract(ctx, payload.Summary)
    if err != nil {
        return err
    }
    
    // 2. Set temporal validity
    for _, entity := range extraction.Entities {
        entity.ValidFrom = time.Now()
        // ValidUntil = nil (still valid)
    }
    
    // 3. Ingest into Knowledge Graph
    entityIDs, err := w.kgStore.IngestExtraction(ctx, extraction)
    if err != nil {
        return err
    }
    
    // 4. Publish for dedup
    for _, id := range entityIDs {
        w.bus.Publish(domain.Event{
            Type:    "entity.upserted",
            Payload: EntityUpsertedPayload{EntityID: id},
        })
    }
    
    return nil
}
```

### DedupWorker

Xử lý `entity.upserted` event, merge duplicate entities:

```go
// internal/consolidation/dedup_worker.go
func (w *DedupWorker) Handle(ctx context.Context, evt domain.Event) error {
    payload := evt.Payload.(EntityUpsertedPayload)
    
    // 1. Get entity embedding
    entity, _ := w.kgStore.GetEntity(ctx, payload.EntityID)
    
    // 2. Find similar entities (cosine distance < threshold)
    similar, _ := w.kgStore.FindSimilarEntities(ctx, entity.Embedding, 0.85)
    
    // 3. Merge if duplicates found
    for _, dup := range similar {
        if dup.ID != entity.ID {
            w.kgStore.MergeEntities(ctx, entity.ID, dup.ID)
            // Redirect all relations from dup → entity
        }
    }
    
    return nil
}
```

---

## 06 — Auto-Inject

Auto-inject là killer feature của 3-tier memory — nó tự động recall context mỗi turn mà user không cần làm gì.

### Cách hoạt động

Trong pipeline xử lý message (ContextStage), trước khi gọi LLM:

```
User message received
        ↓
Check: Trivial content?
├─ Greeting-only ("hi", "hello") → Skip
├─ Punctuation-only → Skip
└─ < 3 tokens → Skip
        ↓
Build recall query
├─ User message text
├─ + Recent context (last 5 turns)
└─ → Contextual embedding
        ↓
Parallel search (2 channels)
├─ FTS (weight 0.7) — Fast keyword match
└─ Vector (weight 0.3) — Semantic similarity
        ↓
Merge & filter
├─ Normalize scores (max = 1.0)
├─ Apply threshold (0.3)
├─ Per-user boost 1.2x
├─ Limit to 5 entries
└─ Dedup (user copy wins)
        ↓
Format & inject
├─ Extract L0 abstracts
├─ Build "## Memory Context" section
└─ Insert into system prompt
        ↓
LLM call (with memory context)
```

### Implementation

```go
// internal/memory/auto_injector_impl.go
func (a *AutoInjector) Inject(ctx context.Context, params InjectParams) (string, error) {
    // 1. Skip trivial messages
    if a.isTrivial(params.UserMessage) {
        return "", nil
    }
    
    // 2. Build contextual query
    query := a.buildRecallQuery(params.UserMessage, params.RecentContext)
    
    // 3. Search episodic
    results, err := a.episodicStore.Search(ctx, SearchParams{
        Query:      query,
        AgentID:    params.AgentID,
        UserID:     params.UserID,
        TextWeight: 0.7,  // Faster for auto-inject
        VecWeight:  0.3,
        Threshold:  0.3,
        Limit:      5,
    })
    if err != nil {
        return "", err
    }
    
    // 4. Format as memory context
    if len(results) == 0 {
        return "", nil
    }
    
    var sb strings.Builder
    sb.WriteString("## Memory Context\n\n")
    for _, r := range results {
        sb.WriteString(fmt.Sprintf("- %s\n", r.L0Abstract))
    }
    
    // 5. Record metric async
    go a.recordRetrievalMetric(ctx, results)
    
    return sb.String(), nil
}
```

### Configuration

```json
{
  "memory_config": {
    "auto_inject": {
      "enabled": true,
      "threshold": 0.3,
      "max_tokens": 200
    }
  }
}
```

| Param | Default | Tuning |
|-------|---------|--------|
| `enabled` | true | Disable nếu không cần memory |
| `threshold` | 0.3 | Thấp hơn = nhiều context, cao hơn = ít noise |
| `max_tokens` | 200 | Balance context richness vs cost |

---

## 07 — DreamingWorker

DreamingWorker là feature độc đáo của GoClaw v3 — nó "ngủ mơ" để tổng hợp insights từ nhiều sessions.

### Tại sao cần "Dreaming"?

- **Pattern recognition:** Phát hiện patterns qua nhiều sessions
- **Contradiction detection:** Agent A nói X, Agent B nói Y
- **Consensus building:** Nhiều sessions confirm cùng một fact
- **Knowledge evolution:** Facts evolve over time

### Cách hoạt động

```go
// internal/consolidation/dreaming_worker.go
func (w *DreamingWorker) Handle(ctx context.Context, evt domain.Event) error {
    // 1. Debounce check (10 minutes)
    if time.Since(w.lastRun) < 10*time.Minute {
        return nil
    }
    
    // 2. Count unpromoted entries
    count, _ := w.store.CountUnpromoted(ctx, agentID, userID)
    if count < w.config.Threshold {  // Default: 5
        return nil
    }
    
    // 3. Fetch unpromoted, sorted by recall_score
    entries, _ := w.store.ListUnpromotedScored(ctx, ListParams{
        AgentID: agentID,
        UserID:  userID,
        Limit:   10,  // Max batch
    })
    
    // 4. Filter by recall signals
    filtered := w.filterByRecallSignals(entries)
    
    // 5. Format for LLM
    prompt := w.formatEntriesForSynthesis(filtered)
    
    // 6. Call LLM for synthesis
    synthesis, _ := w.llm.Generate(ctx, prompt, GenerateParams{
        MaxTokens:   4096,
        Temperature: 0.3,
    })
    
    // 7. Write synthetic memories to vault
    w.vault.WriteMemory(ctx, synthesis)
    
    // 8. Mark entries as promoted
    for _, e := range filtered {
        w.store.MarkPromoted(ctx, e.ID)
    }
    
    w.lastRun = time.Now()
    return nil
}
```

### Recall Signal Filtering

DreamingWorker không xử lý tất cả entries — nó ưu tiên entries có recall signals cao:

| Condition | Action |
|-----------|--------|
| Never recalled, < 10 days old | Include (fresh content) |
| Rarely recalled, recall_score < 0.2 | Skip (low value) |
| Recently recalled (< 7 days) | Include (high value) |
| recall_count > 3 | Include (frequently accessed) |

### Configuration

```json
{
  "memory_config": {
    "dreaming": {
      "enabled": true,
      "threshold": 5,
      "debounce_minutes": 10,
      "verbose_log": false
    }
  }
}
```

---

## 08 — Tool-Based Access

3 cách agents truy cập memory — từ automatic đến explicit:

### 1. Auto-Inject (Automatic)

- **When:** Mỗi turn, trước LLM call
- **User action:** Không cần
- **Output:** L0 abstracts inject vào system prompt
- **Use case:** Continuous context awareness

### 2. memory_search(query)

Agent gọi tool explicitly khi cần tìm kiếm:

```json
{
  "tool": "memory_search",
  "parameters": {
    "query": "OAuth implementation discussions"
  }
}
```

**Output:** Hybrid search qua L1 (episodic) + L2 (KG), trả về top results với scores.

### 3. memory_expand(id)

Agent cần deep context về một episodic entry cụ thể:

```json
{
  "tool": "memory_expand",
  "parameters": {
    "episodic_id": "abc123-def456-..."
  }
}
```

**Output:** Full summary + linked KG entities + relations.

---

## 09 — Configuration

### Per-Agent Settings

Lưu trong `agents.other_config` JSONB:

```json
{
  "memory_config": {
    "auto_inject": {
      "enabled": true,
      "threshold": 0.3,
      "max_tokens": 200
    },
    "episodic": {
      "ttl_days": 90,
      "retention_policy": "auto-expire"
    },
    "consolidation": {
      "enabled": true
    },
    "dreaming": {
      "enabled": true,
      "threshold": 5,
      "debounce_minutes": 10,
      "verbose_log": false
    }
  }
}
```

### Global Defaults (Hardcoded)

| Parameter | Value | File |
|-----------|-------|------|
| Episodic TTL | 90 days | `episodic_worker.go` |
| L0 abstract max | 200 runes | `l0_abstract.go` |
| Auto-inject threshold | 0.3 | `auto_injector_impl.go` |
| Auto-inject max entries | 5 | `auto_injector_impl.go` |
| Dreaming threshold | 5 entries | `dreaming_worker.go` |
| Dreaming debounce | 10 minutes | `dreaming_worker.go` |
| Dreaming fetch limit | 10 entries | `dreaming_worker.go` |
| Dreaming max tokens | 4,096 | `dreaming_worker.go` |
| Memory flush soft threshold | 4,000 tokens | Bootstrap docs |
| Memory flush context floor | 20,000 tokens | Bootstrap docs |
| Text weight (auto-inject) | 0.7 | `auto_injector_impl.go` |
| Vector weight (auto-inject) | 0.3 | `auto_injector_impl.go` |
| Per-user search boost | 1.2x | `episodic_search.go` |

### Tuning Guidelines

| Scenario | Adjustment |
|----------|------------|
| High-volume agent (100+ sessions/day) | Increase dreaming.debounce_minutes to 30 |
| Sensitive context | Decrease episodic.ttl_days to 30 |
| Low-memory agent | Disable dreaming, reduce auto_inject.max_tokens |
| Premium agent | Increase threshold to 0.4 (higher precision) |

---

## 10 — Use Cases

### Continuity across sessions

**Before 3-Tier Memory:**
```
User: "Như đã nói hôm qua về OAuth..."
Agent: "Tôi không có context về cuộc hội thoại hôm qua."
```

**After 3-Tier Memory:**
```
User: "Như đã nói hôm qua về OAuth..."
Agent: "Bạn đề cập đến OAuth2 với refresh tokens. Tôi đã suggest dùng 
        golang.org/x/oauth2 và bạn quan tâm đến token rotation..."
```

### Long-term project understanding

KG maintain facts qua nhiều tuần/tháng:
- "Alice works_on ProjectX" (valid_from: Jan 2026)
- "Alice reports_to Bob" (valid_from: Feb 2026)
- "ProjectX depends_on AuthService" (valid_from: Jan 2026, valid_until: Mar 2026)

Agent có thể reason: "Alice đang làm ProjectX, report cho Bob. ProjectX trước đây depend AuthService nhưng đã migrate rồi."

### User preference tracking

L2 lưu persistent facts:
- "User prefers Go over Python"
- "User works in timezone UTC+7"
- "User is senior backend engineer"

Auto-inject tự động recall preferences khi relevant.

### Pattern recognition (Dreaming)

DreamingWorker detect patterns:
- "User thường hỏi về OAuth vào sáng thứ 2"
- "3 sessions gần đây đều mention performance issues"
- "User và Alice đang collaborate trên cùng project"

---

## 11 — Key Files

| Component | File | Vai trò |
|-----------|------|---------|
| AutoInjector | `internal/memory/auto_injector_impl.go` | Context-aware search + inject |
| EpisodicWorker | `internal/consolidation/episodic_worker.go` | Session → Episodic summary |
| SemanticWorker | `internal/consolidation/semantic_worker.go` | Episodic → KG extraction |
| DedupWorker | `internal/consolidation/dedup_worker.go` | Entity merging |
| DreamingWorker | `internal/consolidation/dreaming_worker.go` | Batch synthesis |
| L0 Abstract | `internal/consolidation/l0_abstract.go` | Abstract generation |
| EpisodicStore | `internal/store/episodic_store.go` | Interface definition |
| PG Implementation | `internal/store/pg/episodic_summaries.go` | Hybrid search, CRUD |
| Event Bus | `internal/eventbus/` | DomainEventBus wiring |
| Tools | `internal/tools/filesystem.go` | memory_search, memory_expand handlers |

---

## 12 — Design Trade-offs

- **FTS weight 0.7 (auto-inject) vs 0.3 (tool search)** — Auto-inject chạy mỗi turn, cần fast; tool search explicit, cần semantic accuracy.
- **L0 Abstract ~50 tokens** — Balance giữa informativeness và context cost. Quá dài = inject nhiều entries tốn tokens. Quá ngắn = mất context.
- **90-day TTL** — Balance storage cost vs memory depth. Có thể tune per-agent.
- **Dreaming debounce 10 minutes** — Prevent thundering herd khi nhiều sessions end cùng lúc. Có thể tune cho high-volume agents.
- **Cosine threshold 0.85 for dedup** — Conservative — chỉ merge entities thực sự duplicate. Lower threshold = aggressive merging, risk mất distinct entities.
- **Per-user scoping** — Episodic scoped per `(agent_id, user_id)`. User A không thấy memory của User B (privacy).

---

## Kết

3-Tier Memory giải quyết context loss problem của AI agents bằng hierarchical storage: L0 (working) → L1 (episodic, 90d) → L2 (semantic KG). Event-driven consolidation pipeline đảm bảo non-blocking, fault-tolerant processing. Auto-inject tự động recall relevant context mỗi turn — user không cần làm gì.

*GoClaw v3.3.0 — Inside GoClaw Series*
