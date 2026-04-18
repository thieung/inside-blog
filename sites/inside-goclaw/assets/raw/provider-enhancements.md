---
title: "Provider Enhancements — Multi-Provider, Failover & Cost Optimization"
project: goclaw
status: approved
created: 2026-04-14
---

[←](https://goclaw.thieunv.space/) 01 — Vấn đề

## Một interface, hàng chục backend

Khi bạn chạy một AI gateway thực tế, câu hỏi không còn là "dùng model nào" — mà là "khi model đó sập thì sao?"

OpenAI rate-limit account của bạn vào giờ cao điểm. Anthropic trả về 529 Overloaded. DeepSeek timeout. Ollama local không đủ VRAM. Mỗi provider có một cách thất bại riêng, và nếu gateway không biết phân biệt — mọi lỗi đều trông như nhau.

GoClaw giải quyết điều này bằng cách xây dựng một **provider system** có khả năng:

1. Gom 15+ backend khác nhau sau một interface duy nhất
2. Tự động failover theo từng loại lỗi
3. Giữ nguyên context khi provider bị "ngủ" tạm thời
4. Tính chi phí chính xác ngay cả với extended thinking

---

02 — Kiến trúc

## Provider Interface — Bốn method, vô số backend

Tất cả provider trong GoClaw implement cùng một interface với bốn method:

```
Chat()          // non-streaming — trả về ChatResponse đầy đủ
ChatStream()    // streaming — callback onChunk theo từng token
Name()          // tên provider
DefaultModel()  // model mặc định khi không chỉ định
```

Cả agent loop lẫn phần còn lại của hệ thống chỉ biết đến interface này — không biết backend là Anthropic hay Ollama hay một local binary.

**Sáu loại provider hiện tại:**

| Provider | Giao tiếp | Dùng cho |
|----------|-----------|----------|
| Anthropic | Native HTTP + SSE | Claude API trực tiếp |
| OpenAI-compatible | Generic HTTP client | 15+ endpoint (OpenAI, Groq, DeepSeek, Gemini, Mistral, xAI, Ollama...) |
| Claude CLI | stdio subprocess | Claude CLI binary local |
| Codex | OAuth Responses API | ChatGPT/GPT-5 Codex |
| ACP | JSON-RPC 2.0 stdio | Orchestrate Claude Code, Codex CLI, Gemini CLI như subagent |
| DashScope | OpenAI-compat wrapper | Alibaba Qwen3 series (`qwen3-max`), bao gồm thinking |

**OpenAI-compatible** là provider linh hoạt nhất — bất kỳ endpoint nào hỗ trợ `/v1/chat/completions` đều hoạt động, bao gồm cả Ollama chạy local. Danh sách đầy đủ gồm 14 endpoint: OpenAI, OpenRouter, Groq, DeepSeek, Gemini, Mistral, xAI, MiniMax, Cohere, Perplexity, Ollama, BytePlus, ZAI, Bailian. Cộng với 5 loại provider còn lại, tổng cộng hơn 20 backend được hỗ trợ.

**Schema compatibility:** Các provider khác nhau từ chối những JSON Schema field khác nhau. `CleanSchemaForProvider()` xử lý điều này tự động — Gemini loại bỏ `$ref`, `$defs`, `additionalProperties`, `examples`, `default`; Anthropic loại bỏ `$ref`, `$defs`. Agent dùng tool không cần biết provider nào đang chạy phía sau.

---

03 — Retry

## RetryDo — Logic retry đúng chỗ

Trước khi nói đến failover, GoClaw xử lý transient error ngay tại tầng provider qua `RetryDo[T]` — một generic function với exponential backoff và jitter:

```
Attempt 1: 300ms ± 30ms   → 270–330ms
Attempt 2: 600ms ± 60ms   → 540–660ms
Attempt 3: 1200ms ± 120ms → 1080–1320ms
```

Nếu response có header `Retry-After` (429, 503), giá trị đó thay thế hoàn toàn backoff tính toán. Header được parse dưới cả dạng integer seconds lẫn RFC 1123 date.

**Retryable:** HTTP 429, 500–504, network error, connection reset, EOF, timeout.
**Non-retryable:** HTTP 400, 401, 403, 404 — return ngay lập tức, không retry.

Điểm quan trọng: với **streaming**, `RetryDo` chỉ bao quanh phase kết nối — một khi SSE stream đã bắt đầu chảy, không có retry mid-stream.

---

04 — Phân loại lỗi

## ErrorClassifier — 9 lý do thất bại

Khi retry không đủ, hệ thống cần biết *tại sao* provider thất bại để quyết định bước tiếp theo. `DefaultClassifier` phân loại mọi lỗi thành một trong 9 lý do:

| Reason | Cooldown | Ý nghĩa |
|--------|----------|---------|
| `rate_limit` | 30s | HTTP 429 — quá quota |
| `overloaded` | 60s (có thể tăng 2x) | HTTP 529 hoặc body chứa "overload" |
| `timeout` | 15s | Network error, connection reset |
| `auth` | 10m | HTTP 401/403 — key lỗi tạm thời |
| `auth_permanent` | 1h | Key bị revoke, deactivate |
| `billing` | 5m | Hết credit, insufficient quota |
| `model_not_found` | 1h | Model không tồn tại |
| `format` | 5m | Request format sai (400 + tool_call error) |
| `unknown` | 30s | Không xác định được |

Trường hợp đặc biệt: **context overflow** không phải failover reason — nó trigger auto-compaction (tóm tắt lịch sử) và return ngay, không chuyển sang provider khác.

`DefaultClassifier` có pattern pre-registered cho cả OpenAI và Anthropic. Có thể mở rộng bằng `RegisterPatterns(provider, patterns)`.

---

05 — Cooldown

## CooldownTracker — Bộ nhớ ngắn hạn của provider

`CooldownTracker` là một state machine in-memory theo dõi trạng thái của từng `provider:model` pair:

**Probe interval:** Trong thời gian cooldown, cứ ≥30 giây cho phép một "probe request" để kiểm tra xem provider đã hồi phục chưa. Nếu thành công, cooldown xóa ngay. Nếu thất bại, cooldown tiếp tục.

**Overload escalation:** Sau 5 lần liên tiếp `overloaded`, cooldown tăng 2x (từ 60s lên 120s). Intentionally flat — không exponential để tránh cooldown quá dài.

**TTL tự dọn:** Entry cũ hơn 24 giờ bị xóa. LRU eviction khi đạt maxKeys (mặc định 512). Cleanup được amortize: chỉ scan mỗi 5 phút thay vì mỗi call.

State không persist qua restart — đây là trade-off có chủ ý để tránh complexity.

---

06 — Failover

## RunWithFailover — Hai tầng xử lý lỗi

`RunWithFailover[T]` là orchestrator cuối cùng khi một provider thất bại. Nó hoạt động theo **hai tầng**:

**Tầng 1 — Profile rotation (transient errors):**
Khi lỗi là `rate_limit`, `overloaded`, `timeout`, `auth` — xoay sang profile khác của cùng model. Giới hạn: tối đa 5 lần rotation, tối đa 3 lần vì `overloaded` trước khi leo lên Tầng 2.

**Tầng 2 — Model fallback (permanent errors):**
Khi lỗi là `auth_permanent`, `billing`, `format`, `model_not_found` — bỏ qua toàn bộ profiles còn lại của model hiện tại, nhảy sang model candidate tiếp theo.

```
Candidates:
  {provider: "anthropic", model: "claude-sonnet-4-6", profileID: "key-A"}
  {provider: "anthropic", model: "claude-sonnet-4-6", profileID: "key-B"}
  {provider: "anthropic", model: "claude-haiku-4-5",  profileID: "key-A"}

rate_limit tại key-A  → thử key-B (Tầng 1, cùng model)
auth_permanent tại key-B → nhảy sang claude-haiku (Tầng 2, model khác)
Tất cả exhausted → FailoverSummaryError với toàn bộ attempt log
```

Mỗi attempt được ghi lại đầy đủ (provider, model, lý do, error) để debug. Context cancellation được check trước mỗi candidate.

---

07 — Model Registry

## ModelRegistry — Catalog model với forward-compatibility

`InMemoryRegistry` lưu `ModelSpec` của từng model với đầy đủ metadata:

```
ModelSpec {
  ContextWindow  int      // 128K, 200K, 1M...
  MaxTokens      int      // output limit
  Reasoning      bool     // hỗ trợ extended thinking?
  Vision         bool     // nhận ảnh?
  Cost           {InputPer1M, OutputPer1M, CacheReadPer1M}
}
```

Mặc định được seed sẵn: Claude (opus/sonnet/haiku), GPT-4o, GPT-5.x, o3, o4-mini.

**Forward-compat resolver:** Khi một model ID chưa có trong registry (ví dụ model mới vừa release), provider có thể implement `ForwardCompatResolver` để tự suy ra spec từ template gần nhất. Kết quả được cache lại sau lần resolve đầu tiên.

`CloneFromTemplate` cho phép tạo spec mới bằng cách clone một template có sẵn và patch các field cần thay đổi — giảm boilerplate khi thêm model variant mới.

`EffectiveContextWindow` được resolve một lần duy nhất mỗi pipeline run (trong ContextStage), tránh lookup lặp lại trong PruneStage.

---

08 — Middleware

## Request Middleware — Pipeline biến đổi request

Middleware là một function `(body map[string]any, cfg MiddlewareConfig) map[string]any` — nhận body đã build và trả về body đã biến đổi.

`ComposeMiddlewares` chain nhiều middleware theo thứ tự. **Zero-alloc fast path:** nếu tất cả middleware đều nil, trả về nil ngay — không allocate gì.

**Các middleware hiện có:**

`CacheMiddleware` — Inject `prompt_cache_key` và `prompt_cache_retention` cho native OpenAI endpoint. Silently pass-through cho proxy và non-OpenAI.

`ServiceTierMiddleware` — Inject `service_tier` từ options. Validate per-provider: Anthropic chấp nhận `auto`/`standard_only`; OpenAI chấp nhận `auto`/`default`/`flex`/`priority`. Bỏ qua cho Anthropic OAuth (API từ chối field này).

`FastModeMiddleware` — Map boolean `fast_mode` sang `service_tier`. Anthropic: true→`auto`, false→`standard_only`. OpenAI: true→`priority`. Không override nếu `service_tier` đã được set.

---

09 — Embedding

## Embedding Providers — Vector cho Knowledge Vault

Embedding providers độc lập với LLM providers, được dùng bởi Knowledge Vault và episodic memory.

**OpenAI:** `text-embedding-3-small`, 1536 dims, batch tối đa 2048 texts mỗi call. Retry logic kế thừa từ `RetryDo`.

**Voyage AI:** dùng model `voyage-3-large` (1536 dims native) — không phải `voyage-3` (1024 dims). Model được chọn có chủ ý để khớp pgvector column dimension mà không cần normalization.

1536 dims là constraint cứng của pgvector column trong schema. Nếu model trả về dimension khác, provider báo lỗi ngay thay vì silent truncate.

---

10 — API Key Encryption

## Bảo mật key trong database

Provider cũng có thể được load từ bảng `llm_providers` trong database — không chỉ từ config file. DB providers override config providers cùng tên.

API key được mã hóa AES-256-GCM trước khi lưu:

```
Stored: "aes-gcm:" + base64(nonce + ciphertext + tag)
```

Khi load, hệ thống kiểm tra prefix `aes-gcm:` để quyết định decrypt hay dùng giá trị raw (backward compat với key plaintext cũ). `GOCLAW_ENCRYPTION_KEY` hỗ trợ 3 format: hex 64 chars, base64 44 chars, hoặc raw 32 chars.

---

11 — Tổng kết

## Unified API, production-grade routing

Provider system của GoClaw là một ví dụ thực tế về cách abstract hóa đúng: interface tối giản, implementation đầy đủ, resilience tách biệt khỏi business logic.

**Những gì mỗi layer làm:**

```
Provider Interface    ← agent loop chỉ cần biết đến đây
RetryDo              ← xử lý transient network noise
ErrorClassifier      ← phân loại lỗi thành intent
CooldownTracker      ← ghi nhớ provider nào đang "mệt"
RunWithFailover      ← orchestrate toàn bộ failover strategy
ModelRegistry        ← metadata và cost cho mỗi model
Middleware Pipeline  ← biến đổi request per-provider
```

Kết quả: agent không cần biết provider nào đang phục vụ nó. Nếu Anthropic overloaded, gateway tự xoay sang profile khác. Nếu billing hết, nhảy sang model rẻ hơn. Nếu tất cả thất bại, trả về summary đầy đủ để debug — không mất thông tin.
