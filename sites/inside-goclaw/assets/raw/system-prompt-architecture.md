---
title: "System Prompt Architecture — Kiến trúc system prompt modular với composable blocks, dynamic injection và cache-aware assembly"
project: goclaw
status: approved
created: 2026-04-14
---

# Inside GoClaw — System Prompt Architecture: Kiến trúc system prompt modular

**Series:** Inside GoClaw  
**Tags:** system-prompt, prompt-engineering, modular-design, caching, composable-blocks  
**Date:** April 2026

---

## TL;DR

System Prompt Architecture của GoClaw là một pipeline lắp ghép từ các **composable prompt blocks** độc lập. Mỗi section là một Go function trả về `[]string`. `BuildSystemPrompt(cfg SystemPromptConfig)` ghép tất cả lại theo thứ tự cố định, gated bởi `PromptMode` (full / task / minimal / none). Một **cache boundary marker** chia prompt thành 2 phần: stable (cache được với Anthropic) và dynamic (per-turn, không cache). Provider có thể inject thêm qua `PromptContributor` interface mà không sửa core logic. Toàn bộ pipeline chạy qua `ContextStage` — một stage trong agentic loop — trước khi LLM được gọi.

---

## 01 — Vấn đề

Khi bạn build một AI agent production, system prompt không đơn giản là một string dài.

Nó phải đáp ứng nhiều yêu cầu xung đột nhau:

**Về nội dung:**
- Agent main user cần hướng dẫn đầy đủ: tools, memory, skills, safety, persona
- Subagent background job chỉ cần subset nhỏ — inject toàn bộ vừa tốn token vừa confuse
- Heartbeat monitor cần prompt cực kỳ slim
- Cron job cần instructions khác hoàn toàn với interactive agent

**Về performance:**
- Token nhiều = latency cao + chi phí cao
- Mỗi request gọi LLM — nếu prompt thay đổi mỗi lần → không cache được
- Anthropic prompt caching tiết kiệm 90% chi phí cho stable content — nhưng phải biết phần nào stable

**Về maintainability:**
- Prompt logic rải rác trong codebase là nightmare
- Provider A cần reasoning format, Provider B cần plain text — phải swap mà không break core
- Predefined agent vs open agent cần framing khác nhau cho context files

Naive approach: một string template khổng lồ với hàng trăm `if/else`. Không scale.

GoClaw giải quyết bằng **composable prompt blocks** — kiến trúc lắp ghép modular.

---

## 02 — Kiến trúc tổng quan

### Layers trong pipeline

```
RunRequest (user message)
        ↓
   ContextStage.Execute()
   ├── InjectContext()         → enriches Go context (agent/tenant/user values)
   ├── ResolveContextWindow()  → model-specific token budget
   ├── ResolveWorkspace()      → workspace path
   ├── LoadContextFiles()      → SOUL.md, AGENTS.md, USER.md, BOOTSTRAP.md
   ├── LoadSessionHistory()    → past messages + session summary
   └── BuildMessages()
           ↓
       buildMessages()
           ↓
       BuildSystemPrompt(cfg SystemPromptConfig)
           ↓
       [section blocks assembled]
           ↓
   System Message → LLM API Call
```

Toàn bộ prompt construction xảy ra một lần trong `ContextStage` — trước iteration loop đầu tiên. Các turns sau (tool calls) không rebuild lại prompt.

### Tại sao tách stage riêng?

`ContextStage` chạy **once** ở setup. Sau đó `ThinkStage`, `ToolStage`, `PruneStage`... chạy trong vòng lặp. Tách biệt này đảm bảo:
- System prompt không bị rebuild mỗi tool call (expensive)
- `OverheadTokens` được tính chính xác một lần → `PruneStage` có budget ổn định
- Context values (agent/tenant/user) được inject vào Go `context.Context` và persist qua toàn bộ run

---

## 03 — PromptMode: 4 mức độ chi tiết

GoClaw định nghĩa 4 mode:

| Mode | Dành cho | Sections included |
|------|----------|-------------------|
| `PromptFull` | Main agent, interactive | Tất cả: tooling, safety, skills, memory, persona, spawn... |
| `PromptTask` | Enterprise automation | Lean: tooling, safety, execution bias, skills search, memory slim |
| `PromptMinimal` | Subagent, cron | Core only: tooling, workspace, pinned skills |
| `PromptNone` | Identity-only contexts | Identity line only |

**3-layer resolution** — không hardcode, resolve theo priority:

```
Layer 1: Runtime override (hardcoded trong code gọi)
Layer 2: Auto-detect từ session key
    - IsHeartbeatSession()  → cap at Minimal
    - IsSubagentSession()   → cap at Task
    - IsCronSession()       → cap at Task
Layer 3: Agent config (từ database)
Layer 4: Default = Full
```

Ví dụ thực tế: một subagent được spawn để chạy background task. Session key có phần rest bắt đầu bằng `subagent:` (format: `agent:{agentId}:subagent:{...}`). `resolvePromptMode()` tự động detect → cap tại `PromptTask`. Agent config trong DB có thể override xuống `Minimal` nếu muốn. Nhưng runtime không thể override *lên* Full nếu auto-detect thấy subagent.

Hàm `minMode(a, b)` enforce điều này: luôn chọn mode restrictive hơn.

---

## 04 — Composable Section Blocks

`BuildSystemPrompt(cfg SystemPromptConfig)` là một function ~270 dòng ghép `[]string` theo thứ tự cố định. Mỗi section là một call riêng biệt:

```go
// Thứ tự assembly (simplified)
lines = append(lines, identityLine...)
lines = append(lines, bootstrapBlock...)        // if BOOTSTRAP.md present
lines = append(lines, buildPersonaSection()...) // SOUL.md (primacy zone)
lines = append(lines, buildToolingSection()...)
lines = append(lines, buildExecutionBiasSection()...)
lines = append(lines, buildToolCallStyleSection()...)
lines = append(lines, buildSafetySection()...)
lines = append(lines, buildSkillsSection()...)
lines = append(lines, buildWorkspaceSection()...)
lines = append(lines, buildMemoryRecallSection()...)
lines = append(lines, buildProjectContextSection(stableFiles)...)

// === CACHE BOUNDARY ===
lines = append(lines, CacheBoundaryMarker)

lines = append(lines, buildTimeSection()...)    // dynamic: date thay đổi mỗi ngày
lines = append(lines, extraContext...)
lines = append(lines, buildProjectContextSection(dynamicFiles)...) // USER.md
lines = append(lines, buildRuntimeSection()...)
lines = append(lines, buildPersonaReminder()...) // recency reinforcement
```

**Mỗi section builder** là một pure function không có side effects:

```go
func buildExecutionBiasSection() []string {
    return []string{
        "## Execution Bias",
        "",
        "If the user asks you to do work, start doing it in the same turn.",
        "Use a real tool call when the task is actionable; do not stop at a plan or promise-to-act reply.",
        "Commentary-only turns are incomplete when tools are available and the next action is clear.",
        "",
    }
}
```

Approach này có một số lợi ích quan trọng:

- **Test từng section độc lập** — `TestMinimalModeExclusions` verify Skills section không xuất hiện khi mode=Minimal
- **Thêm section mới** không làm break existing sections
- **Order được kiểm soát** — không phụ thuộc vào map iteration order
- **Deterministic output** — cùng input → cùng output → cache hit

### Gating pattern

Mỗi section có gating condition riêng:

```go
// Skills: full + task mode, không có khi bootstrap
if (isFull || isTask) && !cfg.IsBootstrap && (cfg.SkillsSummary != "" || cfg.HasSkillSearch) {
    lines = append(lines, buildSkillsSection(...)...)
}

// Sandbox: full mode only
if isFull && !cfg.IsBootstrap && cfg.SandboxEnabled {
    lines = append(lines, buildSandboxSection(cfg)...)
}

// Memory: 3 biến thể tùy mode
if cfg.HasMemory {
    if isFull { lines = append(lines, buildMemoryRecallSection(...)...) }
    else if isTask { lines = append(lines, buildMemoryRecallSlimSection(...)...) }
    else if isMinimal { lines = append(lines, buildMemoryRecallMinimalSection()...) }
}
```

---

## 05 — Cache Boundary: Chia stable vs dynamic

Đây là insight quan trọng nhất về cost optimization.

**Vấn đề:** Anthropic prompt caching hoạt động theo hash của prompt text. Nếu prompt thay đổi mỗi request → không cache được → pay full price mỗi lần.

**Thực tế trong GoClaw:** 80-90% system prompt là stable — agent config, tooling instructions, safety rules, skills, AGENTS.md. Chỉ có một số phần thay đổi: ngày giờ hiện tại, USER.md (per-user), extra context per-turn.

**Giải pháp:** Cache boundary marker:

```go
const CacheBoundaryMarker = "<!-- GOCLAW_CACHE_BOUNDARY -->"
```

Anthropic provider split tại marker:

```go
func splitSystemPromptForCache(content string) []map[string]any {
    idx := strings.Index(content, CacheBoundaryMarker)
    if idx == -1 {
        // Fallback: cache toàn bộ (backwards compat)
        return []map[string]any{
            {"type": "text", "text": content, "cache_control": {"type": "ephemeral"}},
        }
    }
    stable := strings.TrimSpace(content[:idx])
    dynamic := strings.TrimSpace(content[idx+len(CacheBoundaryMarker):])
    
    blocks := []map[string]any{
        {"type": "text", "text": stable, "cache_control": {"type": "ephemeral"}},
    }
    if dynamic != "" {
        blocks = append(blocks, map[string]any{"type": "text", "text": dynamic})
        // dynamic block: không có cache_control → không cache
    }
    return blocks
}
```

### Stable vs Dynamic context files

Context files cũng được chia 2 nhóm theo cùng logic:

**Stable** (đặt trước boundary, ít thay đổi):
- `AGENTS.md` — agent operational rules
- `TOOLS.md` — tool usage guidance
- `USER_PREDEFINED.md` — baseline user-handling rules
- `CAPABILITIES.md` — domain expertise

**Dynamic** (đặt sau boundary, thay đổi theo user/session):
- `USER.md` — per-user profile (name, timezone, preferences)
- `BOOTSTRAP.md` — first-run onboarding (xóa sau khi complete)
- Virtual files: `DELEGATION.md`, `TEAM.md` (system-injected mỗi turn)

### Determinism là bắt buộc

Để cache hoạt động, output phải deterministic. Tool names được sort trước khi inject:

```go
// Sort tool names for deterministic output — critical for prompt caching.
sortedTools := slices.Clone(toolNames)
slices.Sort(sortedTools)
for _, name := range sortedTools {
    // ...
}
```

Time section dùng date-only (không có HH:MM:SS) để không bust cache mỗi giây:

```go
func buildTimeSection() []string {
    now := time.Now()
    return []string{
        fmt.Sprintf("Current date: %s (UTC)", now.UTC().Format("2006-01-02 Monday")),
        "",
    }
}
```

Unit test `TestTimeSectionDateOnly` verify điều này — nếu ai đó vô tình thêm time component, CI sẽ fail.

---

## 06 — Provider Contributions: Customize mà không sửa core

Khác nhau giữa các LLM provider đôi khi cần inject logic riêng vào prompt. GoClaw giải quyết bằng `PromptContributor` interface:

```go
type PromptContribution struct {
    StablePrefix     string            // trước cache boundary
    DynamicSuffix    string            // sau cache boundary
    SectionOverrides map[string]string // override section bằng ID
}

type PromptContributor interface {
    PromptContribution() *PromptContribution
}
```

Provider implement interface → `BuildSystemPrompt` type-assert khi build:

```go
func (cfg SystemPromptConfig) sectionContent(id string, defaultFn func() []string) []string {
    if cfg.ProviderContribution != nil {
        if override, ok := cfg.ProviderContribution.SectionOverrides[id]; ok {
            return []string{override}
        }
    }
    return defaultFn()
}
```

### Ví dụ thực tế: GPT reasoning format

GPT-5.4 cần `<think>...</think>` tags trong output. Provider inject qua `StablePrefix`:

```go
contribution := &PromptContribution{
    StablePrefix: "## Reasoning Format\nUse <think>...</think> before each response.",
}
```

`StablePrefix` được inject **trước** cache boundary → nó là một phần của stable cache block.

`DynamicSuffix` inject **sau** boundary — dùng cho per-turn context như user locale, conversation metadata.

### Section IDs có thể override

Chỉ 2 sections được phép override:
- `execution_bias` — cách agent quyết định dùng tools vs trả lời trực tiếp
- `tool_call_style` — narration style, cách mention tool names

**Safety section bị blocked** — không provider nào được override safety rules. Đây là hard constraint trong code, không phải convention.

---

## 07 — Persona Primacy & Recency Reinforcement

LLM có xu hướng bị ảnh hưởng bởi đầu và cuối của context (primacy + recency bias). GoClaw khai thác điều này để giữ persona nhất quán.

### Primacy: SOUL.md đặt trước

Persona files (SOUL.md, IDENTITY.md) được inject ngay sau identity line — trước tooling, trước safety, trước mọi thứ khác:

```go
// 1.7. # Persona — full+task get full persona (SOUL.md+IDENTITY.md), minimal/none skip
personaFiles, otherFiles := splitPersonaFiles(cfg.ContextFiles)
if (isFull || isTask) && len(personaFiles) > 0 {
    lines = append(lines, buildPersonaSection(personaFiles, cfg.AgentType)...)
}

// ... (tooling, safety, skills, workspace, memory...)

// 16. Recency reinforcements — full mode only
if isFull && !cfg.IsBootstrap {
    if len(personaFiles) > 0 {
        lines = append(lines, buildPersonaReminder(personaFiles, cfg.AgentType, cfg.ProviderType)...)
    }
}
```

### Recency: SOUL Echo cho GPT

Anthropic/Claude đọc và nhớ system prompt đầu tốt. GPT có recency bias mạnh hơn — sau prompt dài, nó "quên" instructions ở đầu.

GoClaw detect provider type và inject SOUL echo ở cuối cho GPT:

```go
func needsSOULEcho(providerType string) bool {
    lower := strings.ToLower(providerType)
    switch {
    case lower == "openai" || lower == "codex":
        return true
    case strings.Contains(lower, "chatgpt"):
        return true
    }
    return false
}
```

SOUL echo extract `## Style` và `## Vibe` sections từ SOUL.md, inject dưới dạng:

```
SOUL echo (write like this): Playful, curious, slightly chaotic | Never corporate-speak
```

~20 tokens. Đủ để GPT "nhớ" tone ở generation point.

---

## 08 — Context-Aware Assembly: Mỗi agent khác nhau

`SystemPromptConfig` có 50+ fields. Một số context-aware behaviors thú vị:

### Bootstrap detection

Khi `BOOTSTRAP.md` có trong context files → agent đang ở first-run. Prompt switch sang slim mode tự động:

```go
if cfg.IsBootstrap {
    // Open agents: chỉ có write_file, không có skills/MCP/team/spawn
    lines = append(lines, "## FIRST RUN — MANDATORY", ...)
}
```

Sau khi user hoàn thành onboarding, `BOOTSTRAP.md` bị cleanup. Lần request tiếp theo: không còn bootstrap mode.

### Predefined vs Open agent

Predefined agents (pre-configured personas) wrap context files với `<internal_config>` tag:

```xml
<internal_config name="SOUL.md">
...agent persona content...
</internal_config>
```

Open agents (user-configurable) dùng `<context_file>` tag. Framing khác nhau → model treat content khác nhau → confidentiality instructions hoạt động hiệu quả hơn.

### Group chat detection

```go
if isFull && cfg.PeerKind == "group" {
    lines = append(lines, buildGroupChatReplyHint()...)
}
```

Group chat inject hint: không reply khi người dùng đang nói với người khác, dù message là reply to agent's message.

ChatTitle được sanitize (strip quotes, newlines, truncate 100 chars) để prevent prompt injection từ group admin đổi tên group.

### Orchestration mode

Agent có 3 orchestration modes: Spawn → Delegate → Team. Mỗi mode unlock thêm tools và sections:

- `ModeSpawn`: hide `delegate` + `team_tasks`  
- `ModeDelegate`: `## Delegation Targets` section với danh sách agent keys
- `ModeTeam`: `## Team Workspace` + `## Team Members` sections

---

## 09 — PromptBuilder Interface: Hướng tới template engine

`PromptBuilder` interface được thiết kế cho future extensibility:

```go
type PromptBuilder interface {
    Build(cfg PromptConfig) (string, error)
}
```

`PromptConfig` dùng **bool-gated section blocks** thay vì 50+ fields của `SystemPromptConfig`:

```go
type PromptConfig struct {
    Identity     bool
    Persona      bool
    Instructions bool
    Tools        bool
    Skills       bool
    Team         bool
    Workspace    bool
    Memory       bool
    Sandbox      bool
    Orchestration bool
    
    // Data payloads per section
    IdentityData       IdentityData
    PersonaContent     string
    ToolsData          ToolsSectionData
    // ...
    
    Mode            PromptMode
    ProviderVariant string // "" = default, "codex", "dashscope"
}
```

`BridgePromptBuilder` hiện tại map `PromptConfig` → `SystemPromptConfig` → `BuildSystemPrompt()`. Đây là bridge pattern — giữ backward compat với v2 logic trong khi expose v3 interface.

Khi cần (A/B testing, provider-specific templates), swap `BridgePromptBuilder` bằng `TemplatePromptBuilder` mà không thay đổi gì ở pipeline layer.

---

## 10 — Tổng kết

| Concept | Giải pháp GoClaw |
|---------|-----------------|
| Multi-agent diversity | PromptMode (full/task/minimal/none) với 3-layer resolution |
| Token cost | Cache boundary chia stable/dynamic, tool names sorted, date-only format |
| Provider differences | PromptContributor interface (StablePrefix, DynamicSuffix, SectionOverrides) |
| Persona consistency | Primacy (SOUL.md trước) + Recency (echo ở cuối, GPT-only) |
| Maintainability | Section builders as pure functions, gated by mode flags |
| Extensibility | PromptBuilder interface, bridge pattern → template engine khi cần |

Điểm mấu chốt: prompt không phải string, mà là **assembly output**. Mỗi section là một component độc lập, có thể test và swap. Caching không phải afterthought — nó được design vào core với marker, sorted output, và file classification.

---

## Đọc thêm

- `internal/agent/systemprompt.go` — `BuildSystemPrompt()` + section builders
- `internal/agent/prompt_config_types.go` — `PromptConfig` block types
- `internal/providers/prompt_contribution.go` — `PromptContributor` interface
- `internal/pipeline/context_stage.go` — runtime injection pipeline
- `internal/providers/anthropic_request.go` — `splitSystemPromptForCache()`
