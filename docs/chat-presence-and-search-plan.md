# Trạng thái hoạt động, nhóm ở dải "Gần đây", và tìm kiếm ba tab

Thiết kế cho bốn yêu cầu về màn Tin nhắn. Phạm vi trải hai kho: `Mindo-API`
(NestJS + Prisma + Socket.IO) và `Mindo-App` (React Native + React Query).

---

## Hiện trạng — những gì khảo sát cho thấy

Ba trong bốn yêu cầu hoá ra là **thiếu dữ liệu**, không phải thiếu giao diện.
`Avatar` đã vẽ được cả ba biến thể (ảnh · chữ cái đầu · icon nhóm) lẫn chấm
online; `ConversationRow` đã phân nhánh `kind === 'group'`. Thứ chưa có là số
liệu để đổ vào.

**Một lỗi gốc giải thích phần lớn triệu chứng.** Payload danh sách hội thoại
không kèm `members` — backend chỉ gửi mảng đó ở `GET /conversations/:id`
(`chat.service.ts:717`, `includeMembers` mặc định `false`). Nên ở app:

```ts
// chatApi.ts:269-283
const peer = raw.members?.find(member => !isMe(member.user_id)); // luôn undefined
contactId: raw.type === 'DIRECT' ? peer?.user_id ?? null : null; // luôn null
```

`contactId` luôn `null` kéo theo hai hỏng hóc:

1. `ConversationRow.tsx:70` đọc `contactsById[conversation.contactId]` → không
   bao giờ tra ra ai → `initials` là `undefined` → **vòng tròn navy trống**.
   Đây đúng là thứ yêu cầu 4 mô tả.
2. `useMessaging.ts:140-146` dựng `onlineOf` bằng `.filter(c => c.contactId)`
   → **map luôn rỗng** → mọi liên hệ trong dải "Gần đây" nhận `online: false`.
   Comment ngay trên chỗ đó nói lỗi này đã sửa rồi; thực tế nó chưa từng chạy.

Ngoài ra:

- **Không có `lastSeen` ở bất cứ đâu.** Redis chỉ giữ tập socket id đang mở
  (`mindo:chat:online:<userId>`, `chat-presence.service.ts:16-42`). Không có
  cột nào trong Prisma, không có trường nào trong DTO.
- **Không có sự kiện socket `presence:*`.** Chấm xanh chỉ tươi bằng lần fetch
  REST gần nhất, hoặc ăn ké khi `conversation:updated` tình cờ bắn vì lý do
  khác.
- **Nhóm đã hiện sẵn** trong danh sách chính — cả hai tầng đều không lọc theo
  `kind`. Chỗ thiếu nhóm là **dải ngang "Gần đây"**, vì nó lấy từ danh sách
  bạn bè (`useMessaging.ts:129-157`) chứ không từ hội thoại.
- **Tìm kiếm chưa có tab**, chỉ có hai tiêu đề mục `HỘI THOẠI` / `LIÊN HỆ KHÁC`
  (`MessagesScreen.tsx:247-254, 283-312`).

---

## Quyết định đã chốt

| Điểm | Chốt |
|---|---|
| Nguồn presence | Socket connect/disconnect + Redis |
| Ngưỡng hiển thị | Kiểu Messenger: "5 phút trước", "1 giờ trước", "3 ngày trước" |
| Chỗ đặt trong danh sách | **Chỉ chấm trên avatar**, không chen chữ vào dòng 72pt |
| Phạm vi tìm kiếm | Chỉ theo tên người / tên nhóm |
| Ba tab | Tất cả · Tin nhắn · Nhóm |
| Tab "Tất cả" | Hai mục: Tin nhắn + Nhóm (bỏ mục "Người") |
| Nhóm ở "Gần đây" | Đổi nguồn dải ngang sang hội thoại gần đây |

---

## A. Trạng thái hoạt động

### Chốt một mâu thuẫn nhỏ

Hai lựa chọn hơi vênh nhau: "giống hệt Messenger" (dot-or-nothing, không có
trạng thái trung gian) nhưng yêu cầu gốc lại nói *"dưới 1h thì tính là chưa
offline hẳn"*. Giải bằng cách để **màu chấm** mang trạng thái trung gian, còn
**chữ** thì chỉ hiện ở header màn chat — danh sách giữ nguyên layout Figma:

| Trạng thái | Chấm trong danh sách | Chữ ở header chat |
|---|---|---|
| Đang có socket | Lime `#B4D001` | "Đang hoạt động" |
| Rời đi < 1h | Xám nhạt, cùng kích cỡ | "Hoạt động 5 phút trước" |
| Rời đi ≥ 1h | Không vẽ chấm | "Hoạt động 3 ngày trước" |

Nhóm không bao giờ có chấm.

### Backend

1. **Prisma** — thêm `lastSeenAt DateTime?` vào `User` + migration.

   Chọn Postgres chứ không phải Redis cho mốc này: nó đọc kèm sẵn trong truy
   vấn `members` đang có, không tốn roundtrip nào, và không bay mất khi Redis
   bị flush. Redis vẫn giữ đúng một việc — "ngay lúc này có đang mở socket
   không".

2. **`chat-presence.service.ts`** — khi `SCARD` về 0 trong `disconnect()`,
   ghi `lastSeenAt = now()`. Trả thêm cờ "đây là socket đầu/cuối" để lớp
   realtime biết có cần fan-out không (mở 3 thiết bị không nên bắn 3 lần).

3. **`memberUserSelect`** (`chat.service.ts:35-42`) — thêm `lastSeenAt`.

4. **Serializer** (`chat.service.ts:678-714`) — thêm hai trường vào mỗi dòng:

   ```ts
   peer_user_id: row.type === DIRECT ? peer?.userId ?? null : null,
   last_seen_at: row.type === DIRECT ? peer?.user.lastSeenAt?.toISOString() ?? null : null,
   ```

   `peer_user_id` là mẩu vá lỗi gốc ở đầu tài liệu — nó cấp cho app đúng thứ
   `contactId` đang thiếu, và là khoá để app biết sự kiện presence vừa tới
   thuộc về hội thoại nào.

5. **Sự kiện mới `presence:updated`** — `{ user_id, is_online, last_seen_at }`.

   Bắn khi socket đầu tiên kết nối và khi socket cuối cùng ngắt. Người nhận là
   mọi user có chung ít nhất một hội thoại chưa xoá — một truy vấn
   `getPeerUserIds(userId)` trả về danh sách distinct, rồi
   `io.to(peerIds.map(userRoom)).emit(...)`.

   Giá: một truy vấn mỗi lần connect/disconnect. Rẻ hơn hẳn `typing:start`
   (đang chạy hai truy vấn **mỗi lần gõ phím**), nên không đáng lo.

   Không có khoảng ân hạn: tắt socket là offline ngay. Chấm xám của mốc < 1h
   đã che được nhịp chớp khi người dùng thu app xuống nền.

### App

1. `Conversation` thêm `peerId: string | null` và `lastSeenAt: string | null`;
   `Contact` thêm `lastSeenAt`.
2. `toConversation` lấy `contactId` từ `raw.peer_user_id` thay vì moi từ
   `raw.members` — sửa luôn `onlineOf` ở `useMessaging.ts`, dải "Gần đây" bắt
   đầu có chấm xanh thật.
3. `chatSocket.ts` đăng ký `presence:updated`; `ChatSocketProvider` vá cache
   `chatKeys.conversations()`: mọi hội thoại có `contactId === user_id` được
   cập nhật `online` + `lastSeenAt`.
4. Hàm mới `formatLastSeen(iso)` trong `messagingFormat.ts` — trả chuỗi
   "5 phút trước" / "1 giờ trước" / "3 ngày trước", đi qua `i18n`.
5. `Avatar` đổi `online?: boolean` thành `presence?: 'online' | 'recent' |
   'offline'`; thêm token `msgColor.recent`. Mười hai chỗ dùng `Avatar` cần
   sửa theo — phần lớn là đổi `online={x}` thành `presence={...}`.
6. `ConversationScreen.tsx:392-398` — nhánh offline thôi trả chuỗi rỗng, gọi
   `formatLastSeen`. Gỡ luôn khối comment ở `:385-391` vì nó mô tả một giới
   hạn không còn nữa.

---

## B. Nhóm trong dải "Gần đây"

Đổi nguồn của `RecentStrip` từ **bạn bè** sang **hội thoại gần đây**:
`conversationItems` đã sắp theo `lastMessageAt desc` sẵn, lấy N đầu, nhóm thì
vẽ icon hai người, 1-1 thì ảnh/chữ cái đầu.

Đúng nghĩa chữ "Gần đây" hơn hiện tại: dải đang liệt kê bạn bè theo thứ tự
danh bạ, kể cả người chưa từng nhắn câu nào.

**Đánh đổi:** bạn bè chưa từng chat sẽ rời khỏi dải. Không mất đường vào —
nút soạn tin (+) → `NewMessageScreen` vẫn liệt kê toàn bộ bạn bè.

---

## C. Tìm kiếm ba tab

### Backend

Thêm `type?: 'DIRECT' | 'GROUP'` vào `ChatPageQueryDto` và mệnh đề `where` của
`listConversations`.

**Một đề xuất kèm theo:** bỏ mệnh đề thứ ba trong khối `OR` tìm kiếm hiện tại
(`chat.service.ts:128-137`) — cái đang khớp cả **nội dung tin nhắn**:

```ts
{ messages: { some: { deletedAt: null, content: { contains: q } } } }
```

Nó trả về hội thoại chứ không trả về tin khớp, mà màn hình lại không hiện
đoạn trích nào. Người dùng gõ một chữ rồi thấy một hội thoại lạ nhảy ra, không
có gì giải thích vì sao. Đã chốt phạm vi "chỉ theo tên" thì mệnh đề này nên
đi — nó còn là mệnh đề đắt nhất (không có index full-text lẫn trigram, thuần
`ILIKE` quét bảng tin nhắn). Chờ khi nào làm full-text thật thì dựng lại tử tế
kèm đoạn trích.

### App

- Thanh ba tab (segmented control tự dựng, **không** kéo
  `material-top-tabs` vào — đây là UI nội tuyến trong màn, không phải
  navigator).
- `useConversationSearch(keyword, type)`; khoá cache
  `chatKeys.conversationSearch(q, type)`.
- Tab **Tất cả** gọi **một** request không lọc, rồi tự tách theo `kind` thành
  hai mục `TIN NHẮN` / `NHÓM`, mỗi mục cắt 5 dòng + "Xem tất cả" nhảy sang tab
  tương ứng. Một request, không phải hai.
- Tab **Tin nhắn** → `type=DIRECT`; tab **Nhóm** → `type=GROUP`.
- Gỡ mục `LIÊN HỆ KHÁC`.

---

## D. Chữ cái đầu

- `toConversation` gắn `initials: initialsOf(raw.title)` — tên hội thoại luôn
  có, khác với contact.
- `ConversationRow` đọc `conversation.initials`, thôi phụ thuộc `contactsById`.
  Nhờ vậy dòng hoạt động đúng kể cả trong kết quả tìm kiếm, nơi danh bạ chưa
  chắc đã tải.
- Gộp hai bản trùng khít `initialsOf` (`chatApi.ts:184-193`) và `initials`
  (`nameUtils.ts:31-39`) về một hàm ở `nameUtils`.

---

## Thứ tự làm

1. **D + `peer_user_id`** — sửa lỗi gốc. Ngắn, gỡ luôn cả chữ cái đầu lẫn
   chấm xanh ở dải "Gần đây". Ship được độc lập.
2. **C** — tìm kiếm ba tab. Không đụng gì tới presence.
3. **B** — đổi nguồn dải "Gần đây". Dựa trên bước 1.
4. **A** — presence đầy đủ. Nặng nhất: migration + sự kiện socket mới + sửa
   mười hai chỗ dùng `Avatar`.

## Điểm cần cẩn thận

- Cache `chatKeys.conversations()` bị vá từ **tám** chỗ và chỗ nào cũng giả
  định đúng hình dạng `Page<Conversation>` (`useMessaging.ts:58-74`). Thêm
  trường thì an toàn; đổi hình dạng thì hỏng âm thầm.
- `avatar_url` là URL ký có hạn (mặc định 900s, `file-storage.service.ts:78-95`)
  — đừng cache lâu phía client.
- `safe()` trong `chat-presence.service.ts:54-61` nuốt mọi lỗi Redis. Redis
  chết thì tất cả lặng lẽ thành offline chứ không báo lỗi. Với `lastSeenAt`
  nằm ở Postgres, kịch bản đó thoái hoá thành "ai cũng hiện mốc hoạt động
  cuối", chấp nhận được.
- `unread_count` đang là N+1 (một `count()` mỗi dòng, `chat.service.ts:664`).
  Không thuộc phạm vi lần này, nhưng thêm tab nhóm nghĩa là thêm lần gọi danh
  sách — đáng ghi nhận.
