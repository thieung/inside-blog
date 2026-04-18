---
title: "GoClaw V3 — Kiến trúc Pipeline 8 giai đoạn"
project: goclaw
status: approved
created: 2026-04-14
---

01 — Giới thiệu

## V3 Pipeline Engine là gì?

**GoClaw** là một AI agent gateway viết bằng Go, xử lý mọi request từ WebSocket, HTTP API, đến các channel như Telegram, Discord, Zalo. Trước V3, toàn bộ logic xử lý một agent run được dồn vào một hàm monolithic `runLoop()` — dài hàng trăm dòng, khó mở rộng và khó test từng phần riêng lẻ.

**V3 Pipeline Engine** chia `runLoop()` thành **8 stage rõ ràng**, mỗi stage có trách nhiệm độc lập, nhận input từ `RunState` dùng chung và trả về signal điều khiển flow. Toàn bộ business logic vẫn nằm trong `agent` package — pipeline chỉ là bộ khung *thuần orchestration*.

8

Stage rõ ràng

3

Giai đoạn (Setup / Iteration / Finalize)

30

Vòng lặp tối đa

5

Checkpoint mỗi N lần lặp

V3 pipeline hiện là **path duy nhất** — V2 monolithic `runLoop()` đã bị xóa hoàn toàn trong quá trình migration. Flag `v3_pipeline_enabled` trong JSONB vẫn được parse nhưng chỉ để backward compat với data cũ, không có tác dụng điều khiển nữa.

02 — Tổng quan kiến trúc

## Kiến trúc tổng quan

```
Loop.Run(RunRequest)
    │
    └─ runViaPipeline()   ← V3 pipeline path (always enabled)
           │
           ├─ NewRunState(input, workspace, model, provider)
           ├─ NewDefaultPipeline(deps)  ← 8 stages được wire vào đây
           └─ Pipeline.Run(ctx, state)
                  │
                  ├─ SETUP (chạy 1 lần)
                  │   └─ ContextStage
                  │
                  ├─ ITERATION LOOP (tối đa 30 lần)
                  │   ├─ ThinkStage
                  │   ├─ PruneStage  ← có MemoryFlushStage bên trong
                  │   ├─ ToolStage
                  │   ├─ ObserveStage
                  │   └─ CheckpointStage
                  │
                  └─ FINALIZE (chạy 1 lần, context.WithoutCancel)
                      └─ FinalizeStage
```

### Stage interface

Mọi stage đều implement một interface tối giản:

```go
type Stage interface {
    Name() string
    Execute(ctx context.Context, state *RunState) error
}
```

Stage nào cần kiểm soát flow thì implement thêm `StageWithResult`:

```go
type StageWithResult interface {
    Stage
    Result() StageResult  // Continue | BreakLoop | AbortRun
}
```

Ba giá trị của `StageResult`:
- **Continue** — tiếp tục stage tiếp theo
- **BreakLoop** — thoát iteration loop (kết thúc bình thường, ví dụ LLM không gọi tool)
- **AbortRun** — hủy toàn bộ run (lỗi không phục hồi, ví dụ vẫn vượt ngân sách sau compaction)

### RunState — bộ nhớ dùng chung

`RunState` là struct được truyền qua tất cả stage theo dạng pointer. Mỗi stage sở hữu một substate riêng, không đọc/ghi vào vùng dữ liệu của stage khác:

```
RunState
├─ Input *RunInput          — immutable: message, sessionKey, userID, ...
├─ Messages *MessageBuffer  — history + pending + system (thread-safe)
├─ Context  ContextState    — owned by ContextStage
├─ Think    ThinkState      — owned by ThinkStage
├─ Prune    PruneState      — owned by PruneStage
├─ Tool     ToolState       — owned by ToolStage
├─ Observe  ObserveState    — owned by ObserveStage
├─ Compact  CompactState    — owned by CheckpointStage + MemoryFlushStage
└─ Evolution EvolutionState — owned by nudge logic
```

03 — Stage 1: ContextStage

## Stage 1 — ContextStage (Setup, chạy 1 lần)

`ContextStage` là stage duy nhất trong giai đoạn Setup. Nó chuẩn bị toàn bộ ngữ cảnh trước khi vòng lặp iteration bắt đầu, theo 10 bước tuần tự:

```
1. InjectContext        — agentID, userID, agentType, locale vào ctx
2. ResolveContextWindow — tra ModelRegistry để lấy context window chính xác
3. ResolveWorkspace     — 6 kịch bản: default / team lead / team member / dispatch / subagent / cron
4. LoadContextFiles     — agent-level + per-user + fallback bootstrap
5. LoadSessionHistory   — lịch sử session + summary từ store
6. BuildMessages        — system prompt (15+ sections) + history pipeline
7. ComputeOverheadTokens — đếm token system prompt qua TokenCounter
8. EnrichMedia          — resolve media refs, inline descriptions
9. InjectReminders      — team task reminders vào history
10. AutoInject L0       — top-K vault entries từ hybrid search vào system prompt
```

Bước quan trọng nhất là **ResolveContextWindow**: context window được resolve *một lần* tại đây và lưu vào `ContextState.EffectiveContextWindow`. `PruneStage` đọc giá trị này ở mỗi iteration — đảm bảo budget không bị skew dù model thay đổi giữa chừng.

**AutoInject L0** dùng kết quả hybrid search (BM25 + vector) từ Knowledge Vault để inject context liên quan vào system prompt. Để vector search có thể resolve pronoun và implicit reference, nó nhận thêm `recentContext` — nối tối đa 2 user turn gần nhất, cắt ở 300 rune (an toàn cho tiếng Việt/Trung/Nhật).

04 — Stage 2: ThinkStage

## Stage 2 — ThinkStage (Iteration)

`ThinkStage` là stage gọi LLM. Chạy đầu tiên trong mỗi iteration:

```
1. maybeInjectNudge     — inject system message khi đạt 70% / 90% iteration budget
2. BuildFilteredTools   — lọc tool qua PolicyEngine (RBAC)
3. Construct ChatRequest
4. CallLLM              — stream hoặc sync tùy cấu hình
5. AccumulateUsage      — cộng dồn promptTokens, completionTokens, thinkingTokens
6. HandleTruncation     — retry tối đa 3 lần nếu tool call args bị truncate
7. UniqueToolCallIDs    — dedup ID (OpenAI trả 400 nếu duplicate)
8. FlowControl          — không có tool call → BreakLoop; có tool call → Continue
```

**Iteration nudges** là cơ chế phòng vệ khi agent bị kẹt trong vòng lặp dài. Ở 70% budget, system message nhắc nhở "bắt đầu kết thúc". Ở 90%, cảnh báo khẩn: "Giao kết quả ngay". Hai nudge này được track bởi `EvolutionState.Nudge70Sent` / `Nudge90Sent` để không inject trùng.

**Truncation handling** chỉ retry khi tool call arguments bị truncate hoặc JSON malformed — *không* retry khi response text dài (câu trả lời dài là hợp lệ, không phải lỗi).

05 — Stage 3: PruneStage

## Stage 3 — PruneStage (Iteration)

`PruneStage` là "van an toàn" cho context window. Chạy sau ThinkStage, trước khi tool được thực thi:

```
Budget = effectiveContextWindow - overheadTokens - maxTokens - reserveTokens

historyTokens ≤ 70% budget  →  skip
historyTokens > 70% budget  →  Phase 1: soft prune (PruneMessages callback)
historyTokens > 100% budget →  Phase 2: memory flush → LLM compaction (CompactMessages)
Vẫn vượt sau compaction    →  AbortRun
```

**Phase 1 (soft prune)** cắt các message cũ giữ lại phần đầu/cuối. **Phase 2** nghiêm trọng hơn: đầu tiên chạy `MemoryFlushStage` để agent persist memory trước khi history bị xóa, sau đó gọi LLM để tạo summary, thay thế toàn bộ history bằng bản tóm tắt.

`reserveTokens` là buffer an toàn (mặc định 0, khuyến nghị 5–10% context window với reasoning model) để compaction kích hoạt sớm hơn một chút — tránh trường hợp token counter ước tính thấp hơn thực tế trong khi streaming.

06 — Stage 4 & 5: ToolStage + ObserveStage

## Stage 4 — ToolStage (Iteration)

`ToolStage` thực thi tool calls từ ThinkStage. Có hai path:

**Sequential** (1 tool call):
```
ExecuteToolCall(ctx, state, tc) → msgs
```

**Parallel** (nhiều tool calls):
```
Phase 1 (parallel I/O, no state mutation):
    goroutine 1: ExecuteToolRaw(tc1) → (msg1, rawData1)
    goroutine 2: ExecuteToolRaw(tc2) → (msg2, rawData2)
    ...
    wg.Wait()

Phase 2 (sequential state mutation, deterministic order):
    ProcessToolResult(tc1, msg1, rawData1) → msgs
    ProcessToolResult(tc2, msg2, rawData2) → msgs
```

Tách I/O ra khỏi state mutation là quyết định thiết kế quan trọng: tool call có thể chạy song song an toàn vì không đụng vào `RunState`, nhưng kết quả phải được xử lý tuần tự để đảm bảo thứ tự và tính nhất quán.

Điều kiện thoát: `LoopKilled`, read-only streak (agent chỉ đọc không ghi quá nhiều lần), hoặc `MaxToolCalls` bị vượt.

## Stage 5 — ObserveStage (Iteration)

`ObserveStage` xử lý kết quả sau tool execution:

```
1. DrainInjectCh   — collect messages từ subagent results, side effects
2. TrackBlockReplies — đếm intermediate assistant content (cho non-streaming channels)
3. AccumulateFinalContent — nếu không có tool calls → lưu response vào FinalContent
```

`BlockReplies` quan trọng với channel như Zalo, Discord, WhatsApp không hỗ trợ streaming — gateway cần biết đã có bao nhiêu block reply để không duplicate khi deliver.

07 — Stage 6: CheckpointStage

## Stage 6 — CheckpointStage (Iteration)

`CheckpointStage` chạy cuối mỗi iteration, flush pending messages vào session store định kỳ:

```go
// Flush mỗi 5 iteration (configurable)
if iteration == 0 || iteration % checkpointInterval != 0 {
    return nil // skip
}
FlushMessages(ctx, sessionKey, pending)
```

Mục đích: **crash recovery**. Nếu agent chạy 15 iteration rồi crash, 10–15 message cuối vẫn được phục hồi từ database. Lỗi flush ở checkpoint là non-fatal — message đã được `FlushPending()` chuyển vào history, `FinalizeStage` sẽ flush lại ở cuối.

08 — Stage 7 & 8: Finalize

## Stage 7 — MemoryFlushStage (Sub-stage)

`MemoryFlushStage` không nằm trực tiếp trong iteration loop — nó được `PruneStage` gọi khi cần compaction. Nhiệm vụ: chạy memory flush synchronous (tối đa 5 LLM iteration, timeout 90 giây) để agent persist durable memories *trước khi* history bị xóa bởi compaction.

## Stage 8 — FinalizeStage (Finalize, chạy 1 lần)

`FinalizeStage` là stage quan trọng nhất sau vòng lặp. Nó chạy với `context.WithoutCancel` — nghĩa là **không bị cancel** dù user gọi `/stop` hay connection bị ngắt. DB write phải thành công.

10 bước trong FinalizeStage:

```
1.  SanitizeContent       — làm sạch response text
2.  SkillPostscript       — thêm skill evolution nudge (nếu có)
3.  NO_REPLY detection    — detect silent reply trước khi flush
4.  Content fallback      — nếu empty → "..." (channel cần non-empty để deliver)
5.  ContentSuffix dedup   — append image markdown cho WS, tránh duplicate
6.  ForwardMedia merge    — merge media được forward vào kết quả
7.  Media dedup + size    — dedup theo path, populate file sizes
8.  Build assistant msg   — tạo message cuối với MediaRefs đầy đủ
9.  FlushMessages         — atomic flush tất cả pending messages vào session store
10. UpdateMetadata        — cập nhật token usage lên session
    + BootstrapCleanup    — cleanup BOOTSTRAP.md nếu có
    + MaybeSummarize      — trigger auto-summarize async (background goroutine)
    + EmitSessionCompleted → consolidation pipeline (episodic → semantic → dreaming)
    + StripMessageDirectives — xóa [[...]] tags khỏi user-facing content
    + Suppress NO_REPLY   — sau khi đã flush (message persist nhưng không deliver)
```

`EmitSessionCompleted` kick-off toàn bộ memory consolidation pipeline: **Episodic Worker** trích xuất facts, **Semantic Worker** tạo abstracted summaries, **Dreaming Worker** synthesize insights mới từ các memory cluster.

09 — Extensible Hooks

## Extensible Hooks — Dependency Injection Pattern

`PipelineDeps` (deps.go) là struct chứa ~35 callback được wire từ `agent.Loop`:

```go
type PipelineDeps struct {
    // Context
    InjectContext      func(ctx, input) (context.Context, error)
    ResolveWorkspace   func(ctx, input) (*WorkspaceContext, error)
    BuildMessages      func(ctx, input, history, summary) ([]Message, error)
    AutoInject         func(ctx, userMessage, userID, recentContext) (string, error)

    // Think
    BuildFilteredTools func(state) ([]ToolDefinition, error)
    CallLLM            func(ctx, state, req) (*ChatResponse, error)

    // Prune
    PruneMessages      func(msgs, budget) []Message
    CompactMessages    func(ctx, msgs, model) ([]Message, error)

    // Tool
    ExecuteToolCall    func(ctx, state, tc) ([]Message, error)
    ExecuteToolRaw     func(ctx, tc) (Message, any, error)
    ProcessToolResult  func(ctx, state, tc, rawMsg, rawData) []Message

    // Finalize
    SanitizeContent    func(content) string
    MaybeSummarize     func(ctx, sessionKey)
    // ... 25+ callbacks khác
}
```

Thiết kế này cho phép:
- **Test từng stage độc lập** — mock bất kỳ callback nào
- **Business logic không bị leak** vào pipeline package
- **Thay thế từng bộ phận** mà không ảnh hưởng các stage khác (ví dụ đổi compaction strategy)

10 — So sánh V2 vs V3

## Trước V3 vs V3 Pipeline

| Khía cạnh | Trước V3 (monolithic) | V3 Pipeline (hiện tại) |
|-----------|----------------------|------------------------|
| Cấu trúc | 1 hàm `runLoop()` ~600 LOC | 8 stage, mỗi file < 200 LOC |
| Test | Integration test toàn bộ flow | Unit test từng stage độc lập |
| Mở rộng | Sửa thẳng vào runLoop | Thêm stage mới hoặc wrap stage có sẵn |
| Debug | Stack trace dài, khó xác định vị trí | Stage name rõ ràng trong log/trace |
| Flow control | bool/error phức tạp | `StageResult` enum: Continue/BreakLoop/AbortRun |
| Cancel safety | Best-effort | FinalizeStage chạy `context.WithoutCancel` |

**Output backward compatible**: V3 produce cùng `RunResult`. Migration được thực hiện qua `convertRunResult()` adapter.

11 — Kết luận

## Tóm tắt

V3 Pipeline Engine không phải rewrite — đó là *refactoring có kiểm soát*. V2 monolithic `runLoop()` đã được xóa hoàn toàn; V3 pipeline hiện là path duy nhất cho mọi agent run. Với kiến trúc mới:

- Request đi qua 8 stage tường minh thay vì 1 hàm khổng lồ
- Mỗi stage có substate riêng, không share mutable state ngoài quy định
- Flow control qua enum `StageResult` thay vì bool/error phức tạp
- Parallel tool execution an toàn nhờ tách I/O ra khỏi state mutation
- FinalizeStage chạy với `context.WithoutCancel` đảm bảo DB write dù connection bị ngắt
- CheckpointStage giúp crash recovery mỗi 5 iteration

Kiến trúc pipeline là nền tảng để GoClaw tiếp tục mở rộng: memory consolidation, self-evolution metrics, và các stage mới trong tương lai đều có thể được thêm vào mà không phá vỡ flow hiện tại.
