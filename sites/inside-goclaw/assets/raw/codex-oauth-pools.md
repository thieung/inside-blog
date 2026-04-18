---
title: "GoClaw v2.34.0 — Codex OAuth Pools"
source: "https://goclaw.thieunv.space/posts/codex-oauth-pools"
language: "vi"
word_count: 599
---

[←](https://goclaw.thieunv.space/) 01 — Vấn đề

## Rate limit theo từng account

OpenAI giới hạn rate limit theo từng tài khoản subscription. Với 3–5 tài khoản Codex, bạn phải xoay xở thủ công.

1

Chuyển đổi thủ công khi hết quota

2

Không biết account nào còn dư

3

Không aggregate được throughput

Với team 5–10 người dùng chung gateway, vấn đề nhân lên gấp bội.

02 — Cách hoạt động

## Bốn bước thiết lập

01

#### Đăng ký OAuth

Mỗi tài khoản Codex/ChatGPT thành một named provider riêng biệt. GoClaw lưu refresh token, tự xử lý token refresh.

02

#### Tạo Pool

Chọn provider owner, thêm members vào codex\_pool.extra\_provider\_names.

03

#### Chọn Strategy

Cấu hình cách phân bổ request: primary first, round robin, hoặc priority order.

04

#### Agent Inherit

Set override\_mode: "inherit" — agent tự nhận pool config từ provider.

### Pool Validation

✓ Không tự tham chiếu ✓ Mỗi member một pool ✓ Owner ≠ member ✓ Cùng type chatgpt\_oauth

03 — Kiến trúc

## Request pipeline

GoClaw Gateway — Request Flow

Tin nhắn

→

Agent Loop

→

Resolver

→

Routing Engine

↓

Codex OAuth Pool

codex-pro-1

35%

healthy

codex-pro-2

85%

healthy

codex-team

10%

degraded

04 — Routing

## Ba chiến lược phân bổ

| Strategy | Hành vi |
| --- | --- |
| `primary_first` | Luôn dùng owner trước, failover sang member khi lỗi |
| `round_robin` | Xoay vòng đều giữa tất cả accounts trong pool |
| `priority_order` | Dùng theo thứ tự ưu tiên, tự chuyển khi account gặp lỗi |

05 — Điểm đặc biệt

## Inherited Routing Defaults

Agent inherit routing config từ provider — cấu hình một lần, tất cả agents tự hưởng.

#### Provider

"codex-main"

Pool owner

codex-backup

codex-team

round\_robin

inherit

#### Agent

"assistant"

Provider: codex-main

Override: inherit

(không cần cấu hình pool)

- ✓ **Cấu hình một lần tại provider level** — tất cả agents dùng provider đó đều được hưởng
- ✓ Thay đổi pool membership? Sửa ở provider, agents tự cập nhật
- ✓ Agent vẫn có thể override nếu cần — `override_mode: "custom"`

06 — Monitoring

## Quota real-time

GoClaw gọi OpenAI Usage API để lấy quota cho mỗi account trong pool.

Pool Dashboard

codex-pro-165%healthy

5h: 35% remainweekly: 80% used

codex-pro-215%healthy

5h: 92% remainweekly: 25% used

codex-team90%degraded

5h: resets in 2h 15mweekly: resets in 3d 4h

● 2 healthy △ 1 degradedStrategy: round\_robinLast → codex-pro-2 (2m ago)

07 — Health

## Auto-failover tracking

Gateway track health mỗi account qua tracing data. Khi một account liên tục lỗi, routing engine tự chuyển sang account khác.

Success Rate

94%

Request thành công

Health Score

87

Điểm tổng hợp

Consec. Failures

0

Lỗi liên tiếp

State

OK

healthy

08 — Security

## Access control

Chỉ **admin/operator** quản lý pool

Viewer: dashboard **read-only**

**Tenant isolation** — không leak cross-tenant

Badge **needs\_reauth** khi token hết hạn

09 — Use Cases

## Thực tế triển khai

##### Trước v2.34.0

- Admin rotate key thủ công khi hết quota
- Tạo 3 agents riêng, user tự chọn → UX kém

##### Sau v2.34.0

1. 3 accounts OAuth → 3 named providers
2. Pool `round_robin`
3. Agent set `inherit`
4. 8 users, 1 agent, tự phân bổ đều
5. Dashboard quota real-time

##### Priority Order

- `codex-heavy` (Pro) → agent xử lý task nặng
- `codex-light` (Plus) → agent chat thường
- Heavy trước, fallback sang light khi hết quota

10 — Internals

## Tóm tắt kỹ thuật

| Component | File | Vai trò |
| --- | --- | --- |
| Pool Validation | chatgpt\_oauth\_pool\_validation.go | Validate graph: không cycle, không sở hữu kép |
| Pool HTTP API | agents\_codex\_pool.go | CRUD pool config, activity, health |
| Quota Fetcher | oauth/openai\_quota.go | OpenAI Usage API, parse quota windows |
| Quota Transport | oauth/openai\_quota\_transport.go | HTTP transport + auth injection |
| Token Mgmt | oauth/token.go | Refresh token, metadata backfill |
| Routing | agent/resolver.go | Resolve provider theo strategy |
| Store Types | store/agent\_store.go | Constants, routing config structs |
| Dashboard | agent-codex-pool-page.tsx | Pool management UI |
| Quota UI | chatgpt-oauth-quota-\*.tsx | Bars, badges, readiness |
