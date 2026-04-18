---
title: "GoClaw v2.47.0 — Force-Directed Knowledge Graph Visualization"
source: "https://goclaw.thieunv.space/posts/force-directed-knowledge-graphs"
language: "vi"
word_count: 2061
---

01 — Giới thiệu

## Knowledge Graph là gì trong GoClaw?

**GoClaw** là một multi-tenant AI agent gateway xây dựng trên PostgreSQL. **Knowledge Graph (KG)** được giới thiệu từ **v2.15.0**, cho phép các AI agent xây dựng bộ nhớ ngữ nghĩa lâu dài từ các cuộc hội thoại. Phiên bản v2.47.x mang đến các cải tiến quan trọng về *depth visualization* và *tối ưu hiệu năng*.

Thay vì chỉ nhớ các đoạn chat riêng lẻ, agent có thể hiểu được *mối quan hệ* giữa các thực thể — ai làm gì, dự án nào liên kết với dự án nào, và deadline nào đang đến gần.

3

Tầng kiến trúc

7

Loại thực thể

17

Loại quan hệ

11

API Endpoints

10

Perf Opts

Cài đặt bắt buộc trước khi sử dụng

Để sử dụng Knowledge Graph, bạn cần cấu hình hai thành phần:

1. **Embedding Provider & Model** — KG cần một embedding model để tạo vector cho semantic search và deduplication. Vào **Dashboard → Settings → Embedding**, chọn provider (ví dụ: OpenAI, Anthropic) và model embedding phù hợp (ví dụ: `text-embedding-3-small`). Không có embedding, KG sẽ chỉ dùng Full-Text Search mà không có khả năng tìm kiếm ngữ nghĩa.
2. **Extraction Provider & Model** — Cần chọn LLM provider/model để trích xuất entities và relations từ văn bản. Cấu hình này nằm ngay trên **Dashboard UI**, biểu tượng nằm bên cạnh icon chuyển đổi dark/light mode, ở góc trên bên phải của trang KG.

Knowledge Graph hoạt động qua ba tầng:

1. **Extraction Layer** — Sử dụng LLM để khai thác entities và relations từ văn bản hội thoại, với confidence scoring
2. **Storage Layer** — PostgreSQL với pgvector (embeddings), Full-Text Search (FTS), và hệ thống deduplication tự động
3. **Visualization Layer** — ReactFlow + D3 force-directed graph với hỗ trợ theme, depth visualization, và giới hạn 50 entities cho hiệu năng DOM

02 — Kiến trúc

## Kiến trúc tổng quan

Ctrl/Cmd + wheel để zoom · Kéo để pan · Double-click để fit

Loading…

### Luồng xử lý chính

01Conversations

02LLM Extract

03JSON Parse

04Confidence Filter

05Upsert PG

06Embedding Gen

07Auto-Dedup

03 — Mô hình dữ liệu

## Schema và Entity Types

### Các loại thực thể

person project task event concept location organization

ER Diagram — Quan hệ giữa các bảng cơ sở dữ liệu

Loading…

### Các trường quan trọng

- `external_id` — Định danh canonical do LLM gán (lowercase, hyphen-separated). Unique constraint đảm bảo không trùng lặp trong cùng scope agent+user
- `confidence` — 1.0 = explicit mention, 0.7 = inferred, 0.4 = weakly inferred. Entities dưới 0.75 bị loại bỏ
- `embedding vector(1536)` — pgvector cho semantic search qua HNSW index
- `tsv tsvector` — Full-text search vector với GIN index
- `relation_type` — 17 loại quan hệ được định nghĩa sẵn: `works_on`, `manages`, `reports_to`, `depends_on`, `blocks`, v.v.

04 — Trích xuất thực thể

## Pipeline trích xuất thực thể

Quy trình extraction từ văn bản đến database

Loading…

### Chi tiết các bước

Chunking

Văn bản dài hơn 12,000 ký tự được chia tại ranh giới đoạn văn (`\n\n`). Mỗi chunk được extract độc lập, kết quả được merge lại bằng external\_id.

LLM Extraction

Sử dụng system prompt định nghĩa sẵn 7 entity types và 17 relation types. Temperature = 0 đảm bảo kết quả deterministic. Max tokens: 8192.

JSON Sanitization

Xử lý các lỗi JSON thường gặp từ LLM output: fix số thập phân sai format (`"0. 85"` → `"0.85"`), xoá trailing commas. Chỉ xử lý ký tự ngoài chuỗi quoted để bảo toàn giá trị string.

Transactional Ingest

All-or-nothing: entities và relations được upsert trong một transaction duy nhất. External\_id unique constraint đảm bảo idempotent. Sau upsert, batch embedding được tạo từ `name + description`.

### Relation Types

| Nhóm | Loại quan hệ |
| --- | --- |
| Con người ↔ Công việc | `works_on` `manages` `reports_to` `collaborates_with` |
| Cấu trúc | `belongs_to` `part_of` `depends_on` `blocks` |
| Hành động | `created` `completed` `assigned_to` `scheduled_for` |
| Vị trí | `located_in` `based_at` |
| Công nghệ | `uses` `implements` `integrates_with` |
| Fallback | `related_to` |

05 — Tìm kiếm kết hợp

## Tìm kiếm kết hợp (Hybrid Search)

Kết hợp FTS và Vector Search

Loading…

Tìm kiếm kết hợp sử dụng hai phương pháp song song:

- **FTS (trọng số 0.3)** — Sử dụng `plainto_tsquery('simple', query)` và `ts_rank()` để tìm kiếm theo từ khoá. Nhanh và chính xác cho exact matches
- **Vector (trọng số 0.7)** — Embed câu query, sử dụng HNSW index cho K-Nearest Neighbors. Similarity = `1 - cosine_distance`. Bắt được ngôn ngữ tương đương
- **Fallback** — Nếu embedding provider không khả dụng, sử dụng 100% FTS

06 — Depth Visualization

## Graph Traversal và Depth Visualization

**Đây là tính năng nổi bật của v2.47.x.** Depth visualization cho phép người dùng "khám phá" graph theo các tầng độ sâu — bắt đầu từ một thực thể và di chuyển qua các mối quan hệ để khám phá các thực thể liên quan ở khoảng cách 1, 2, 3 hops.

### Recursive CTE — Nơi cốt lõi

Traversal sử dụng PostgreSQL recursive CTE để đi qua graph:

```
WITH RECURSIVE paths AS (
    -- Anchor: start entity tại depth=1
    SELECT e.*, 1 AS depth,
           ARRAY[e.id::text] AS path,
           ''::text AS via
    FROM kg_entities e
    WHERE e.id = $start_id AND e.agent_id = $agent_id

    UNION ALL

    -- Recursive: đi theo edges, tăng depth, ngăn chu kỳ
    SELECT e.*, p.depth + 1,
           p.path || e.id::text,
           r.relation_type
    FROM paths p
    JOIN kg_relations r ON p.id = r.source_entity_id
    JOIN kg_entities e ON r.target_entity_id = e.id
    WHERE p.depth < $max_depth
      AND NOT e.id::text = ANY(p.path)  -- Ngăn chu kỳ
)
SELECT ... FROM paths WHERE depth > 1
```

**An toàn:** Cycle prevention qua path array. Statement timeout 5 giây ngăn query chạy quá lâu. Max depth cap tại 3 hops.

### Traversal Result

```
interface KGTraversalResult {
  entity: KGEntity      // Dữ liệu thực thể đầy đủ
  depth: number         // Số hops từ thực thể gốc (1, 2, 3)
  path: string[]        // Các entity ID trên đường đi
  via: string           // Loại quan hệ ở hop cuối cùng
}
```

### Minh hoạ Depth Traversal

Bắt đầu từ "Alice" và khám phá các mối quan hệ:

Alice person — start

Project X via: works\_on

Bob via: manages

Acme Corp via: belongs\_to

Task Y via: part\_of (Project X)

Carol via: reports\_to (Bob)

Microservices via: uses (Project X)

Sprint Review via: scheduled\_for (Task Y)

Ho Chi Minh City via: based\_at (Carol)

Mỗi kết quả traversal bao gồm:

- **depth** — Khoảng cách hops từ thực thể bắt đầu
- **path** — Mảng entity IDs tạo breadcrumb cho UI
- **via** — Loại quan hệ đã đi qua ở hop cuối

Frontend hiển thị kết quả theo nhóm depth, với màu sắc theo entity type và breadcrumb path cho mỗi thực thể.

07 — Khử trùng lặp

## Chiến lược khử trùng lặp

Quy trình dedup sau extraction

Loading…

Ngưỡng quyết định

| Ngưỡng | Giá trị | Hành động |
| --- | --- | --- |
| Auto-merge | `>= 0.98` vec + `>= 0.85` name | Tự động merge, giữ entity có confidence cao hơn |
| Candidate | `>= 0.90` vec | Đánh dấu để người dùng review thủ công |
| Skip | `< 0.90` | Không phải duplicate |

Merge Operation

Quy trình merge được thực hiện trong transaction với advisory lock:

1. Xác nhận cả hai entities tồn tại trong scope
2. Re-point tất cả relations từ source sang target
3. Xoá duplicate relations (cùng type và endpoints)
4. Xoá source entity (CASCADE xoá orphans)
5. Cập nhật kg\_dedup\_candidates status → 'merged'

08 — Trực quan hoá đồ thị React

## Interactive 3D Graph Demo

Click vào node để highlight edges (glow + particles chạy dọc edge). Double-click mở chi tiết. Kéo chuột để xoay, scroll để zoom.

person project task event concept location organization

Entities: 21 | Relations: 21

### Force Layout Parameters

| Tham số | Giá trị | Mục đích |
| --- | --- | --- |
| Link distance | `220px` | Khoảng cách lò xo giữa các node liên kết |
| Spring strength | `0.4` | Lực hút giữa các node liên kết |
| Charge | `-300 × mass` | Lực đẩy — ngăn chồng chéo |
| Collision radius | `55px + mass × 5` | Vùng không chồng chéo |
| Entity limit | `50 nodes` | Giới hạn DOM cho hiệu năng |

### Entity Mass (ảnh hưởng kích thước và lực đẩy)

| Entity Type | Mass | Ý nghĩa |
| --- | --- | --- |
| organization | `8` | Node lớn nhất — hub trung tâm |
| project | `6` | Node lớn — kết nối nhiều thành phần |
| person | `4` | Node vừa — người tham gia |
| task | `3` | Node nhỏ — công việc cụ thể |
| Others | `1.5–3` | Node phụ |

### Adaptive Force Params v2.47.3

Force layout tự động scale theo số lượng node thực tế — tighter cho graph nhỏ (<30 nodes), spread cho graph lớn (60+):

| Tham số | <30 nodes | 30–60 | 60+ |
| --- | --- | --- | --- |
| Link distance | `180px` | `220px` | `280px` |
| Charge strength | `-400` | `-300` | `-200` |
| Center pull | `0.15` | `0.1` | `0.05` |
| Collide radius | `45px` | `55px` | `65px` |

### Degree Centrality Selection v2.47.3

Trước đây, API trả entities theo `created_at DESC` — hub nodes cũ có nhiều connections có thể bị loại khỏi GRAPH\_LIMIT. Giờ entities được sort by connection count (degree centrality) trước khi slice, đảm bảo hub nodes luôn xuất hiện trong graph.

**Backend note:** Hiện tại degree ranking chạy client-side trên dữ liệu API trả về. Improvement tiếp theo: thêm `sort=connections` query param ở backend để API trả về entities connected nhất.

### Theme-Aware Rendering

Graph hỗ trợ chuyển đổi theme real-time. Khi theme thay đổi mà data không đổi, chỉ update màu node qua `setNodes` — không re-layout. Khi data thay đổi, full re-layout qua `computeForceLayout`.

09 — Tối ưu hiệu năng

## 10 cải tiến hiệu năng trong v2.47.x

### 1\. O(1) Entity Lookup via Map

```
entities.find(e => e.id === id)
// O(n) mỗi lần selection
```

```
useMemo(() =>
  new Map(entities.map(e => [e.id, e]))
, [entities])
// O(1) lookup
```

### 2\. Pre-computed Edge Style Constants

Trước

Tạo edge style objects mới ở mỗi render → GC pressure khi pan/zoom

Sau

Định nghĩa `EDGE_STYLE_DEFAULT` và `EDGE_STYLE_FADED` một lần — zero allocation

### 3\. EntityNode Memoization

Trước

Re-render tất cả nodes khi pan/zoom

Sau

`memo(EntityNode)` — chỉ re-render khi data thay đổi, skip viewport interactions

### 4\. Force Simulation Tick Cap

Trước

Unbounded ticks → O(n²) cho graph lớn

Sau

Cap ticks bằng `Math.ceil(log(n))` → O(log n) convergence

### 5–7. Các fix bổ sung

| # | Vấn đề | Fix | Version |
| --- | --- | --- | --- |
| 5 | Double fitView (componentDidMount + manual) | Single call trong useEffect | `v2.47.2` |
| 6 | Fetch 200 entities, render 50 (lãng phí API) | Fetch 50 khớp với GRAPH\_LIMIT | `v2.47.2` |
| 7 | Theme change O(n×m) node lookup | Pre-compute entityMap — O(n) total | `v2.47.2` |

### 8\. Deferred Dialog Open v2.47.3

Trước

Node click trigger edge restyle + dialog mount đồng thời — INP **808ms**

Sau

`setTimeout(0)` decouple edge restyle khỏi dialog mount — INP **<100ms**

### 9\. Memoized RelationsTable v2.47.3

Trước

Render toàn bộ relations table cell — **792ms** INP cho entities nhiều relations

Sau

`React.memo` + limit 50 rows ban đầu + nút "Show all" — INP **<100ms**

### 10\. Adaptive Force Params v2.47.3

Trước

Fixed force params — graph <30 nodes quá rải rác, graph lớn quá chật

Sau

Scale link distance, charge, center pull, collide radius theo node count — layout tự nhiên ở mọi kích thước

**Tổng kết:** 10 tối ưu tập trung vào *rendering path* và *interaction responsiveness* — giảm allocation, giảm re-render, deferred dialog mount, adaptive layout, và degree-ranked entity selection. Kết quả: graph 50 nodes render mượt mà với INP <100ms.

10 — Multi-Tenancy

## Multi-Tenancy và Bảo mật

Mọi truy vấn KG đều được filter theo scope:

```
-- Single-tenant mode
WHERE agent_id = $1 AND user_id = $2 AND tenant_id = $3

-- Shared/admin mode (cross-user)
WHERE agent_id = $1 AND tenant_id = $2
```

Helper `scopeClause(ctx, paramIdx)` tự động append tenant filter dựa trên context.

Bảo mật

- **Advisory locks** — Ngăn các merge operations đồng thời trên cùng agent
- **Statement timeout 5s** — Ngăn traversal query chạy quá lâu (graph cycles, graph quá lớn)
- **Parameterized queries** — Tất cả user inputs sử dụng `$1, $2, ...`, không string concatenation
- **RBAC** — Quyền truy cập KG theo role (admin/operator/viewer)

11 — API Reference

## API Reference

| Method | Endpoint | Mục đích |
| --- | --- | --- |
| `GET` | `/v1/agents/{id}/kg/entities` | List/search entities với type filter |
| `GET` | `/v1/agents/{id}/kg/entities/{eid}` | Chi tiết entity + related relations |
| `POST` | `/v1/agents/{id}/kg/entities` | Tạo/cập nhật entity |
| `DELETE` | `/v1/agents/{id}/kg/entities/{eid}` | Xoá entity |
| `GET` | `/v1/agents/{id}/kg/graph` | Graph data cho visualization (limit 50+150) |
| `POST` | `/v1/agents/{id}/kg/traverse` | Depth traversal từ entity (max 3 hops) |
| `POST` | `/v1/agents/{id}/kg/extract` | LLM extraction + inline dedup |
| `GET` | `/v1/agents/{id}/kg/stats` | Entity/relation counts theo type |
| `GET` | `/v1/agents/{id}/kg/dedup` | List pending dedup candidates |
| `POST` | `/v1/agents/{id}/kg/dedup/scan` | Bulk scan tất cả entities cho duplicates |
| `POST` | `/v1/agents/{id}/kg/merge` | Merge source entity vào target |

GoClaw v2.47.x Knowledge Graph
Built with Go · PostgreSQL · pgvector · ReactFlow · D3 · Three.js

[← Back to blog](https://goclaw.thieunv.space/)
