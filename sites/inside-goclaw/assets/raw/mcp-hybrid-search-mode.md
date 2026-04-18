---
title: "GoClaw v2.56.0 — MCP Hybrid Search Mode"
source: "https://goclaw.thieunv.space/posts/mcp-hybrid-search-mode"
language: "vi"
word_count: 2170
---

01 — Giới thiệu

## MCP Hybrid Search Mode là gì?

**GoClaw** hỗ trợ kết nối nhiều MCP server cùng lúc, mỗi server cung cấp hàng chục tool (database query, file ops, messaging, v.v.). Khi tổng số tool vượt quá **40**, hệ thống không thể nhồi mô tả tất cả vào system prompt — sẽ tốn quá nhiều token và gây nhiễu cho LLM.

**Hybrid Search Mode** giải quyết bài toán này: giữ **40 tool phổ biến nhất** inline trong registry (LLM thấy ngay mô tả), đẩy phần còn lại vào **BM25 search index** để khám phá theo nhu cầu qua `mcp_tool_search`. Kết quả: cân bằng giữa *khả năng khám phá* và *hiệu quả token*.

40

Inline Tools

BM25

Search Algorithm

3

Phase Locking

60

Skill Inline

200

Desc Max Chars

Tính năng hoạt động qua ba tầng:

1. **Partitioning Layer** — Khi agent khởi động, `maybeEnterSearchMode()` phân chia tool thành inline (giữ trong registry) và deferred (lưu trong bộ nhớ)
2. **Discovery Layer** — BM25 index được xây dựng từ tên server + tên tool + mô tả. LLM gọi `mcp_tool_search` với keyword tiếng Anh để tìm tool
3. **Activation Layer** — Tool tìm được sẽ được kích hoạt ngay lập tức (3-phase locking) và sẵn sàng gọi trong cùng lượt

02 — Vấn đề

## Tại sao cần Hybrid Mode?

Mỗi MCP server có thể cung cấp 10–50 tool. Một agent kết nối 3–5 server dễ dàng vượt 100 tool. Mỗi tool cần mô tả trong system prompt (~50 token/tool) → **5,000+ token** chỉ cho danh sách tool — chiếm một phần đáng kể context window.

Trước v2.56.0 — All-or-Nothing

Khi vượt ngưỡng, **tất cả** tool bị ẩn khỏi registry. LLM phải gọi `mcp_tool_search` cho mọi thao tác — kể cả tool phổ biến như query database.

v2.56.0 — Hybrid Mode

**40 tool đầu tiên** giữ inline (có mô tả). Phần còn lại defer → tìm qua BM25. Tool phổ biến luôn sẵn sàng, tool hiếm vẫn khám phá được.

**Quan trọng:** Thứ tự tool được xác định bởi thứ tự đăng ký từ các MCP server. Server kết nối trước sẽ có tool được ưu tiên inline — vì vậy hãy sắp xếp server theo mức độ sử dụng thường xuyên.

03 — Kiến trúc Hybrid

## Kiến trúc phân tách Inline / Deferred

Ctrl/Cmd + wheel để zoom · Kéo để pan · Double-click để fit

Loading…

### Cấu trúc dữ liệu Manager

Manager là trung tâm điều phối. Sau khi vào hybrid mode, state gồm:

Inline (Registry)

40 tool đầu — registered trong `tools.Registry`, thuộc group `"mcp"`. LLM thấy mô tả (truncated 200 ký tự) trong system prompt. Gọi trực tiếp, không cần tìm kiếm.

Deferred (BM25 Index)

Tool thừa — lưu trong `deferredTools map[string]*BridgeTool`. Không có trong registry, không có mô tả trong prompt. Tìm thấy qua `mcp_tool_search` → kích hoạt theo nhu cầu.

type Manager struct { mu sync.RWMutex servers map\[string\]\*serverState registry \*tools.Registry // Search mode: deferred tools not registered in registry deferredTools map\[string\]\*BridgeTool // registeredName → BridgeTool activatedTools map\[string\]struct{} // tracks activated tool names searchMode bool }

### Thuật toán phân tách

Hàm `maybeEnterSearchMode()` chạy sau khi tất cả MCP server đã load xong. Logic: xây dựng một `deferSet` chứa tên tool từ index 40 trở đi, sau đó duyệt qua từng server, giữ lại tool inline và di chuyển tool dư vào `deferredTools`:

func (m \*Manager) maybeEnterSearchMode() { allNames:= m.ToolNames() if len(allNames) <\= mcpToolInlineMaxCount { return // Stay in simple mode } // Build set of names to defer (beyond threshold) deferSet:= make(map\[string\]struct{}, len(allNames)-mcpToolInlineMaxCount) for \_, name:= range allNames\[mcpToolInlineMaxCount:\] { deferSet\[name\] = struct{}{} } // For each server, partition tools into kept vs deferred for serverName:= range m.servers { var kept \[\]string for \_, name:= range toolNames { if \_, shouldDefer:= deferSet\[name\];!shouldDefer { kept = append(kept, name) continue } // Move to deferredTools, unregister from registry if bt, ok:= m.registry.Get(name); ok { if bridge, ok:= bt.(\*BridgeTool); ok { m.deferredTools\[name\] = bridge m.registry.Unregister(name) } } } // Update per-server tool list to only kept inline tools m.servers\[serverName\].toolNames = kept } // Update "mcp" group + enable search mode inlineNames:= allNames\[:mcpToolInlineMaxCount\] tools.RegisterToolGroup("mcp", inlineNames) m.searchMode = true }

04 — BM25 Search

## BM25 Search Engine

**BM25** (Best Matching 25) là thuật toán xếp hạng văn bản cổ điển trong lĩnh vực truy xuất thông tin. GoClaw sử dụng BM25 để xếp hạng các tool deferred dựa trên keyword query từ LLM.

### Xây dựng Index

Mỗi tool deferred được biểu diễn thành một "tài liệu" gồm: `server_name + tool_name + description`. Ví dụ tool `query` trên server `postgres`:

"postgres query query a postgres database with SQL" → tokens: \["postgres", "query", "database", "with", "sql"\]

### Tokenization

Quy trình token hóa: chuyển thành chữ thường → loại bỏ dấu câu (giữ chữ cái và số) → tách theo khoảng trắng → lọc token đơn ký tự. Ví dụ: `"create-github-issue"` → `["create", "github", "issue"]`.

func tokenizeMCP(text string) \[\]string { lower:= strings.ToLower(text) cleaned:= strings.Map(func(r rune) rune { if unicode.IsLetter(r) || unicode.IsDigit(r) { return r } return ' ' }, lower) fields:= strings.Fields(cleaned) var tokens \[\]string for \_, f:= range fields { if len(f) \> 1 { tokens = append(tokens, f) } } return tokens }

### Công thức BM25

Với mỗi query token, BM25 tính điểm kết hợp **IDF** (từ hiếm có trọng số cao hơn) và **TF** (tần suất xuất hiện trong tài liệu, với saturation):

// N = total indexed tools, dfTerm = docs containing this term // termFreq = frequency in this doc, dl = doc length, avgDL = avg length idf:= math.Log((N - dfTerm + 0.5) / (dfTerm + 0.5) + 1) numerator:= termFreq \* (k1 + 1) denominator:= termFreq + k1\*(1 - b + b\*dl/avgDL) score += idf \* numerator / denominator // k1 = 1.2 (saturation), b = 0.75 (length normalization)

01 Tokenize Query

02 TF per Doc

03 IDF Weighting

04 Score & Rank

05 Top-K Results

Tham số BM25

| Tham số | Giá trị | Ý nghĩa |
| --- | --- | --- |
| `k1` | 1.2 | Saturation — hạn chế ảnh hưởng của tần suất lặp từ. Giá trị cao = phân biệt mạnh hơn giữa TF cao/thấp |
| `b` | 0.75 | Length normalization — 0 = bỏ qua độ dài, 1 = chuẩn hóa hoàn toàn. 0.75 là trung bình cổ điển |
| `maxResults` | 5 | Số tool trả về tối đa mỗi lần tìm kiếm |

05 — System Prompt

## Thiết kế System Prompt

Điểm khác biệt lớn nhất của hybrid mode: **cả hai section** xuất hiện đồng thời trong system prompt. LLM vừa thấy danh sách tool inline (với mô tả ngắn), vừa biết rằng còn tool khác có thể tìm qua search.

Section 1: MCP Tools (prefer over core tools)

Liệt kê từng tool inline với mô tả (truncated ở **200 ký tự**). Format: `- mcp_server__tool: description...`

\## MCP Tools (prefer over core tools) External tool integrations (MCP servers). \*\*When an MCP tool overlaps with a core tool, always prefer the MCP tool.\*\* - mcp\_postgres\_\_query: Query a PostgreSQL database with raw SQL... - mcp\_slack\_\_send\_message: Send a message to a Slack channel... -... (up to 40 tools)

Section 2: Additional MCP Tools (use mcp\_tool\_search to discover)

Hướng dẫn LLM dùng `mcp_tool_search` để khám phá tool không có trong danh sách inline. Tool tìm được sẽ kích hoạt ngay lập tức.

\## Additional MCP Tools (use mcp\_tool\_search to discover) Additional external tool integrations are available beyond those listed above. Use \`mcp\_tool\_search\` to discover them. 1. Before performing external operations, run \`mcp\_tool\_search\` with descriptive English keywords. 2. Matching tools are activated immediately and can be called right away in the same turn. 3. If no match found, proceed with other available tools.

// 4.5. MCP Tools — skip during bootstrap if!isMinimal &&!cfg.IsBootstrap { if len(cfg.MCPToolDescs) \> 0 { lines = append(lines, buildMCPToolsInlineSection(cfg.MCPToolDescs)...) } if cfg.HasMCPToolSearch { lines = append(lines, buildMCPToolsSearchSection()...) } }

**Anti-hallucination:** Hướng dẫn optional parameters được bổ sung ví dụ WRONG/RIGHT cụ thể vì một số model (GPT-5.4) bỏ qua hướng dẫn bằng lời và tự điền giá trị giả vào mọi field optional.

06 — Kích hoạt Tool

## Quy trình kích hoạt 3-Phase

Khi LLM gọi `mcp_tool_search`, kết quả BM25 trả về danh sách tool khớp. Các tool này cần được di chuyển từ `deferredTools` vào `registry`. Thao tác này sử dụng **3-phase locking** để tránh deadlock giữa Manager lock và Registry lock.

Ctrl/Cmd + wheel để zoom · Kéo để pan · Double-click để fit

Loading…

Phase 1: Read Lock — Thu thập

Giữ `RLock` trên Manager. Duyệt danh sách tên, kiểm tra tool có trong `deferredTools` và chưa có trong registry. Thu thập `[]*BridgeTool` cần kích hoạt. Giải phóng RLock.

Phase 2: No Lock — Đăng ký

Không giữ lock nào trên Manager. Gọi `registry.Register(bt)` cho mỗi tool. Điều này tránh deadlock vì Registry có lock riêng.

Phase 3: Write Lock — Cập nhật

Giữ `WLock` trên Manager. Xóa tool khỏi `deferredTools`, thêm vào `activatedTools`. Cập nhật tool group `"mcp"` với danh sách mới. Giải phóng WLock.

func (m \*Manager) ActivateTools(names \[\]string) { // Phase 1: collect tools to activate (read lock) m.mu.RLock() toActivate:= make(\[\]\*BridgeTool, 0, len(names)) for \_, name:= range names { if bt, ok:= m.deferredTools\[name\]; ok { if \_, exists:= m.registry.Get(name);!exists { toActivate = append(toActivate, bt) } } } m.mu.RUnlock() if len(toActivate) == 0 { return } // Phase 2: register in registry (no Manager lock held) var activated \[\]string for \_, bt:= range toActivate { if \_, exists:= m.registry.Get(bt.Name());!exists { m.registry.Register(bt) activated = append(activated, bt.Name()) } } if len(activated) == 0 { return } // Phase 3: update internal state (write lock) m.mu.Lock() for \_, name:= range activated { delete(m.deferredTools, name) m.activatedTools\[name\] = struct{}{} } activeNames:= make(\[\]string, 0, len(m.activatedTools)) for n:= range m.activatedTools { activeNames = append(activeNames, n) } m.mu.Unlock() tools.RegisterToolGroup("mcp", activeNames) }

07 — Lazy Activation

## Kích hoạt trực tiếp theo tên

LLM không bắt buộc phải gọi `mcp_tool_search` trước. Nếu LLM biết tên tool (qua context trước đó hoặc kiến thức sẵn có), nó có thể gọi thẳng tool deferred bằng tên. Agent loop sẽ thử **lazy activation**:

registryName:= l.resolveToolCallName(tc.Name) if allowedTools!= nil &&!allowedTools\[registryName\] { // Attempt lazy activation if l.tools.TryActivateDeferred(registryName) { // Tool moved to registry, now allowed allowedTools\[registryName\] = true } else { result = tools.ErrorResult("tool not allowed") } } if result == nil { result = l.tools.ExecuteWithContext(ctx, registryName,...) }

Hàm `TryActivateDeferred()` trong Registry gọi callback đến Manager's `ActivateToolIfDeferred()`, di chuyển tool từ deferred vào registry nếu tồn tại. Quá trình hoàn toàn trong suốt với LLM — tool được kích hoạt và thực thi trong cùng một lượt.

Lợi ích

- **Không cần search trước** — LLM đã biết tên tool từ conversation context? Gọi thẳng, không mất thêm một lượt
- **Transparent** — Tool activation xảy ra ẩn bên trong, LLM không cần biết tool đang ở trạng thái inline hay deferred
- **Thread-safe** — `ActivateToolIfDeferred()` sử dụng write lock để đảm bảo an toàn khi nhiều goroutine gọi đồng thời

08 — Skill Inline

## Nâng Skill Inline Count 40 → 60

Song song với MCP hybrid mode, v2.56.0 cũng nâng ngưỡng inline cho **skills** (một hệ thống tương tự nhưng dành cho prompt-based tools) từ 40 lên 60. Lý do: skill descriptions thường ngắn hơn MCP tool descriptions, nên **token limit mới là bottleneck thực sự**, không phải số lượng.

Trước

`skillInlineMaxCount = 40`  
Nhiều skill hữu ích bị đẩy sang search mode dù vẫn thừa token budget

Sau

`skillInlineMaxCount = 60`  
Nhiều skill hơn inline, vẫn giữ token budget dưới 5,000 token nhờ check kép

Skill inline mode sử dụng **kiểm tra kép**: cả số lượng skill LẪN estimated tokens phải dưới ngưỡng:

const ( skillInlineMaxCount = 60 // max skills to inline skillInlineMaxTokens = 5000 // max estimated tokens ) estimatedTokens:= totalChars / 4 if len(filtered) <\= skillInlineMaxCount && estimatedTokens <\= skillInlineMaxTokens { // Inline mode — build XML summary in system prompt } else { // Search mode — use skill\_search to discover }

09 — Cấu hình

## Tham chiếu cấu hình

Tất cả giá trị cấu hình đều là hằng số compile-time. Bảng dưới liệt kê đầy đủ:

| Hằng số | File | Giá trị | Mục đích |
| --- | --- | --- | --- |
| `mcpToolInlineMaxCount` | manager.go | 40 | Ngưỡng kích hoạt hybrid search mode cho MCP tools |
| `mcpToolDescMaxLen` | systemprompt\_sections.go | 200 | Ký tự tối đa cho mô tả tool inline (~50 token) |
| `skillInlineMaxCount` | loop\_history.go | 60 | Ngưỡng kích hoạt search mode cho skills |
| `skillInlineMaxTokens` | loop\_history.go | 5000 | Token budget tối đa cho skill descriptions inline |
| `k1` | bm25\_index.go | 1.2 | BM25 term frequency saturation |
| `b` | bm25\_index.go | 0.75 | BM25 document length normalization |

**Ghi chú:** Hiện tại các giá trị là hằng số cố định. Trong tương lai có thể expose qua cấu hình per-agent để admin tinh chỉnh ngưỡng inline theo nhu cầu sử dụng cụ thể.

### File tham chiếu

| File | Vai trò |
| --- | --- |
| internal/mcp/manager.go | Hybrid mode orchestration, 3-phase activation |
| internal/mcp/bm25\_index.go | BM25 indexing & scoring |
| internal/mcp/mcp\_tool\_search.go | Search tool implementation + index rebuild |
| internal/agent/systemprompt\_sections.go | Inline + search section builders |
| internal/agent/loop\_history.go | Skill inline threshold + prompt building |
| internal/agent/loop.go | Lazy activation check in agent loop |

GoClaw v2.56.0 MCP Hybrid Search Mode  
Built with Go · BM25 · MCP Protocol
