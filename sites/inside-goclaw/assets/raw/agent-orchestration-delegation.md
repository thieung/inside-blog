---
title: "Agent Orchestration & Delegation — Hệ thống điều phối agents trong GoClaw"
project: goclaw
status: approved
created: 2026-04-14
---

01 — Vấn đề

## Một agent không đủ

Khi bạn giao cho một AI agent một tác vụ lớn — "phân tích toàn bộ codebase và viết báo cáo", "nghiên cứu thị trường rồi tạo slide" — agent đó phải làm tuần tự: đọc từng file, ghi chú, tổng hợp, viết. Chậm. Token explode. Context window tràn.

Giải pháp tự nhiên: chia việc cho nhiều agent chạy song song. Nhưng ngay lập tức nảy sinh câu hỏi:

1. **Ai quyết định** chia việc thế nào?
2. **Kết quả** từ các agent con về đâu, về lúc nào?
3. Nếu một agent **bị kẹt**, hệ thống phản ứng ra sao?
4. Các agent cần **phối hợp** với nhau, không chỉ nhận lệnh từ trên xuống?

GoClaw giải quyết bốn câu hỏi này bằng một hệ thống orchestration đầy đủ: hierarchical delegation, parallel dispatch, task dependency graph, inter-agent mailbox, và automatic workload distribution.

---

02 — Ba chế độ hoạt động

## Spawn, Delegate, Team

Mỗi agent trong GoClaw vận hành theo một trong ba chế độ, được hệ thống tự động xác định dựa trên cấu hình:

**ModeSpawn** — Chế độ mặc định. Agent có thể tạo ra các bản sao của chính mình (subagent) để xử lý subtask. Dùng khi không cần phối hợp với agent khác.

**ModeDelegate** — Agent có liên kết đến các agent khác. Dùng tool `delegate` để giao việc cho agent chuyên biệt. Phù hợp khi cần routing tới expert agents.

**ModeTeam** — Chế độ đầy đủ. Agent tham gia một team với lead và members. Có task board chung, mailbox, và workspace chia sẻ.

```
Ưu tiên resolution: Team > Delegate > Spawn
```

Chế độ không phải do người dùng chọn — GoClaw tự phát hiện qua database: kiểm tra bảng `teams` và `agent_links`, inject đúng tool set, đúng context (TEAM.md) vào system prompt.

---

03 — Kiến trúc Team

## Lead và Members

Một team có một **lead** và nhiều **member**. Họ không phải agent giống nhau — họ có vai trò và tool set khác nhau:

```
User
  │
  ▼
Lead Agent ──────────────────────────────┐
  │  Nhận TEAM.md đầy đủ                │
  │  Create tasks → Delegate             │
  │  Tổng hợp kết quả → Trả lời user    │
  └──────┬──────────────┬───────────────┘
         │              │
         ▼              ▼
    Member A        Member B
    Thực thi        Thực thi
    task độc lập    task độc lập
         │              │
         └──────┬───────┘
                ▼
        Lead nhận kết quả
        (batch, single announcement)
```

**Nguyên tắc thiết kế quan trọng:** Members không nhận TEAM.md đầy đủ — chỉ nhận phần "just do the work". Lead mới có đầy đủ orchestration instructions, danh sách teammates, và patterns phối hợp. Lý do: tiết kiệm token cho idle members.

**TEAM.md** là virtual file — không lưu trên disk, được render động từ database mỗi khi agent được resolve, inject vào system prompt qua `<system_context>` tags.

---

04 — Task Board

## Shared task tracker

Task board là trung tâm của hệ thống. Lead tạo task, assign cho member, member claim và thực thi. Mọi thứ đi qua tool `team_tasks`.

### Vòng đời task

```
pending ──────────────────────────────────► in_progress
   │         (claim / assign)                    │
   │                                             │
   ▼                                             ▼
blocked        ◄────────────────────────    in_review
(blocked_by)        (review action)              │
   │                                    approve / reject
   │ (all blockers complete)                     │
   ▼                                   completed / cancelled
pending
```

**8 trạng thái:** pending, in_progress, in_review, completed, failed, cancelled, blocked, stale.

### Atomic claiming

Hai member không thể claim cùng một task. Thực hiện bằng conditional UPDATE ở database level:

```sql
UPDATE tasks
SET status = 'in_progress', owner = $agent
WHERE id = $id AND status = 'pending' AND owner IS NULL
```

Nếu 0 rows affected → người khác đã claim trước. Không cần distributed mutex.

### Mandatory task tracking

Lead **bắt buộc** phải tạo task trước khi delegate. Nếu gọi `spawn(agent="member")` không có task_id → hệ thống từ chối với error message hướng dẫn dùng `team_tasks(action="create", assignee="member")`.

---

05 — Parallel Execution

## Nhiều member, cùng lúc

Lead tạo nhiều task cùng một lượt — hệ thống dispatch song song:

```
Lead tạo task #1 → member_A ───► Member A chạy
Lead tạo task #2 → member_B ───► Member B chạy
Lead tạo task #3 → member_C ───► Member C chạy
                                       │
                              Tất cả hoàn thành
                                       │
                              Lead nhận batch result
                              (một lần announce duy nhất)
```

Kết quả được gom qua `BatchQueue[T]` — generic queue chờ đủ tất cả artifacts trước khi announce. Lead không phải xử lý kết quả từng phần — nhận một lần, synthesis một lần.

### Post-turn dispatch

Tasks được tạo trong lượt của lead được **queue**, dispatch **sau khi lead kết thúc lượt**. Tránh race condition với `blocked_by` setup — không bao giờ dispatch task khi dependency graph chưa hoàn chỉnh.

### Scheduler lanes

```
main   (30) — User chat sessions
subagent (50) — Self-clone subagents  
team  (100) — Team/delegation execution ← nhiều nhất
cron   (30) — Scheduled jobs
```

Team lane có concurrency cao nhất vì parallel delegation là use case chính.

---

06 — Task Dependencies

## blocked_by graph

Tasks có thể khai báo dependency. Khi task A phụ thuộc task B:

```
Task B (phân tích data) ──► Task A (viết báo cáo)
                            status: blocked
                            blocked_by: [task_B_id]
```

Khi B complete → `DispatchUnblockedTasks()` tự động chạy:
1. Tìm tasks có `blocked_by` đã resolved
2. Dispatch task priority cao nhất mỗi owner trước
3. Kết quả của B được append vào dispatch content của A

Member nhận A sẽ thấy context đầy đủ: "Task B đã xong, kết quả là X. Bây giờ làm A dựa trên kết quả đó."

**Cascade cancel:** Cancelled task (qua reject hoặc cancel action) cũng unblock dependents — tránh deadlock khi một task thất bại.

---

07 — Inter-Agent Communication

## Mailbox system

Ngoài task board, members có thể nhắn trực tiếp với nhau qua `team_message`:

| Action | Mô tả |
|--------|-------|
| `send` | Gửi tin cho một teammate cụ thể (theo agent key) |
| `broadcast` | Gửi cho tất cả teammates trừ bản thân |
| `read` | Đọc tin chưa đọc, tự động mark as read |

Message routing qua message bus với prefix `teammate:`. Receiving agent xử lý như một inbound message bình thường — không phải polling, không phải webhook.

**Use cases thực tế:**
- Member → Lead: "Task partially complete, cần clarification về requirements"
- Lead → Member: "Claim task mới trên board"
- Member → Member: Cross-coordination khi hai tasks có overlap

---

08 — Blocker Escalation

## Khi member bị kẹt

Member có thể signal bị blocked bằng blocker comment:

```
team_tasks(action="comment",
           task_id="...",
           text="Cannot find API docs for payment gateway",
           type="blocker")
```

Khi blocker comment được post:

```
1. Task auto-fail (in_progress → failed)
2. EventTeamTaskFailed broadcast
3. Member session cancelled
4. Lead nhận escalation từ system:escalation:
   "Member A bị block ở Task #5: Cannot find API docs.
    Retry với: team_tasks(action='retry', task_id='...')"
```

Lead không phải monitor — được push notification, có đủ context để quyết định retry hay restructure.

**Circuit breaker:** Task auto-fail sau 3 dispatch attempts (`maxTaskDispatches`). Tránh infinite loop khi agent không thể hoàn thành.

---

09 — Workload Distribution

## Automatic, không cần cấu hình thêm

GoClaw tự distribute workload theo priority:

1. **Priority-ordered dispatch** — Task priority cao hơn được dispatch trước
2. **One-at-a-time per owner** — Mỗi agent chỉ nhận 1 task mới mỗi round (sau khi complete task hiện tại)
3. **Concurrency limits** — Cấu hình per-link (mặc định 3 concurrent delegations từ lead đến member) và per-agent (tổng concurrent targeting một agent). Khi vượt, LLM nhận error message với hướng dẫn thử agent khác.
4. **Auto-completion trigger** — Khi member complete task → `DispatchUnblockedTasks()` chạy ngay, không cần lead can thiệp

**Adaptive throttle trong session queue:** Khi session history vượt 60% context window, scheduler tự reduce concurrency về 1 — tránh context overflow làm hỏng quality.

---

10 — Tổng kết

## Hệ thống end-to-end

Từ lúc user nhắn tin đến lúc nhận kết quả:

```
User message
     │
     ▼
Lead Agent (ModeTeam)
     │  Phân tích yêu cầu
     │  Kiểm tra task board (search trước, tránh duplicate)
     │  Tạo tasks → assign members
     │
     ├──► Member A (team lane, isolated session)
     │         Claim task atomically
     │         Thực thi, viết files vào team workspace
     │         Complete → kết quả auto-announce
     │
     ├──► Member B (parallel, cùng lúc)
     │         Blocked nếu cần kết quả A trước
     │         Auto-dispatch khi A complete
     │
     └──► Lead nhận batch result
          Synthesis → Trả lời user
```

**Không cần config phức tạp.** Team setup tự tạo delegation links. TEAM.md tự inject. Tasks tự dispatch. Kết quả tự route về đúng user session — kể cả qua Telegram forum topics hay Feishu thread discussions.

Hệ thống orchestration trong GoClaw được xây dựng để **scale theo chiều ngang** — thêm member vào team là tức thì có thêm capacity, không phải refactor prompt hay logic.
