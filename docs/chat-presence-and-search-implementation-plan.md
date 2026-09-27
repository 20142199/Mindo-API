# Plan thực thi — trạng thái hoạt động, nhóm ở "Gần đây", tìm kiếm ba tab

Kế hoạch thi công cho [chat-presence-and-search-plan.md](./chat-presence-and-search-plan.md).
Đọc tài liệu thiết kế trước; tài liệu này chỉ nói **làm gì, theo thứ tự nào,
và lấy gì làm bằng chứng đã xong**.

Hai kho:
- `Mindo-API/api` — NestJS + Prisma + Socket.IO, test bằng **vitest** (`npm test`)
- `Mindo-App` — React Native + React Query, test bằng **jest** (`yarn test`)

Bốn giai đoạn xếp theo thứ tự phụ thuộc. **Mỗi giai đoạn ship được độc lập** —
làm xong giai đoạn 1 rồi dừng vẫn là một cải thiện hoàn chỉnh, không để lại
nửa vời.

---

## Giai đoạn 1 — Vá lỗi gốc: `peer_user_id` + chữ cái đầu

Ngắn nhất, giá trị cao nhất. Sửa đúng một trường trong payload backend rồi gỡ
được **ba** triệu chứng: vòng tròn avatar trống, chấm xanh dải "Gần đây" chưa
từng sáng, và `contactId` luôn null khiến mọi thứ hạ nguồn tính sai.

### 1.1 Backend — thêm `peer_user_id` vào dòng hội thoại

**File:** `api/src/chat/chat.service.ts`

Trong `serializeConversationRows` (~dòng 678), thêm một trường cạnh `is_online`:

```ts
peer_user_id: row.type === ConversationType.DIRECT ? peer?.userId ?? null : null,
```

`peer` đã có sẵn ngay trên đó (`const peer = peers[0]`), nên không thêm truy
vấn nào. Nhóm luôn `null`.

**Test** — `api/src/chat/chat.peer-id.test.ts` (mới):
- Dòng DIRECT trả `peer_user_id` bằng id người kia, không phải id của mình.
- Dòng GROUP trả `peer_user_id: null`.
- Hội thoại DIRECT mà người kia đã rời (`leftAt` khác null) → `null`, không nổ.

Bám theo cách dựng giả lập của `chat.publish-conversation.test.ts`.

### 1.2 Backend — ghi tài liệu

**File:** `docs/messaging-api.md` — thêm `peer_user_id` vào bảng mô tả dòng
hội thoại. Tài liệu này đang đúng và đang được dùng, đừng để nó lệch.

### 1.3 App — đọc `peer_user_id` thay vì moi từ `members`

**File:** `src/services/chatApi.ts`

`RawConversation` (~dòng 128) thêm `peer_user_id?: string | null`.

Trong `toConversation` (~dòng 269), thay cả khối `peer`:

```ts
// Bỏ: const peer = raw.members?.find(member => !isMe(member.user_id));
contactId: raw.peer_user_id ?? null,
```

Gỡ luôn khối comment ở dòng 277-281 (khối nói "danh sách không cần nó") — nó
mô tả đúng một hành vi vừa bị thay.

Giữ `memberIds` / `adminIds` đọc từ `raw.members` như cũ: chúng chỉ có nghĩa ở
màn chi tiết, và `getConversation` vẫn gửi `members`.

### 1.4 App — gộp hai hàm chữ cái đầu

`initialsOf` (`chatApi.ts:184-193`) và `initials` (`nameUtils.ts:31-39`) trùng
khít từng dòng. Giữ bản ở `nameUtils`, xoá bản ở `chatApi`, sửa hai chỗ gọi
(`toContact` và `useMessaging.ts:151`) sang import từ `@/utils/nameUtils`.

### 1.5 App — hội thoại tự mang chữ cái đầu

**File:** `src/model/MessagingModel.ts` — `Conversation` thêm:

```ts
/** Chữ cái đầu của `name`, dùng khi `avatar` rỗng */
initials: string;
```

**File:** `src/services/chatApi.ts` — `toConversation` thêm
`initials: initials(raw.title)`.

**File:** `src/screens/MessagesScreen/components/ConversationRow.tsx` — đổi
`initials={contact?.initials}` thành `initials={conversation.initials}`.

Sau thay đổi này `contactsById` chỉ còn phục vụ `formatPreview`. **Đừng gỡ
prop** — `formatPreview` vẫn cần nó để dựng tiền tố tên người gửi trong nhóm.

Cập nhật comment ở `ConversationRow.tsx:63-66` (khối nói về ảnh nhóm) cho khớp
nguồn dữ liệu mới.

**Vì sao lấy từ `name` chứ không từ contact:** tên hội thoại luôn có, kể cả
trong kết quả tìm kiếm nơi danh bạ chưa chắc đã tải xong.

### 1.6 App — test

**File:** `src/screens/MessagesScreen/__tests__/ConversationRow.test.tsx` (mới)
- Hội thoại 1-1 không ảnh → hiện đúng hai chữ cái lấy từ tên hội thoại.
- Hội thoại 1-1 không ảnh **và `contactsById` rỗng** → vẫn hiện chữ cái đầu.
  *Đây chính là ca hỏng hiện tại — ca này phải đỏ trước khi sửa.*
- Hội thoại nhóm không ảnh → icon hai người, không phải chữ.

**File:** `src/services/__tests__/chatApi.test.ts` (đã có) — thêm:
- `toConversation` với `peer_user_id` → `contactId` đúng.
- `toConversation` payload danh sách (không `members`) → `contactId` vẫn đúng.
- `toConversation` GROUP → `contactId: null`.

### Xong khi

```
cd Mindo-API/api && npm test
cd Mindo-App && yarn test && yarn lint
```

Và trên máy thật: người chưa đặt ảnh hiện hai chữ cái trên nền navy ở danh
sách tin nhắn; chấm xanh xuất hiện trong dải "Gần đây" với người đang online.

---

## Giai đoạn 2 — Tìm kiếm ba tab

Độc lập hoàn toàn với presence. Làm được song song giai đoạn 3 nếu cần.

### 2.1 Backend — lọc theo loại hội thoại

**File:** `api/src/chat/chat.dto.ts`

```ts
export class ChatPageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(ConversationType) type?: ConversationType;
}
```

Import `ConversationType` từ `@prisma/client` (file đã import `ChatMessageType`
từ đó).

**File:** `api/src/chat/chat.service.ts` — `listConversations`, thêm vào `where`:

```ts
...(query.type ? { type: query.type } : {}),
```

Không đụng controller: `@Query()` đã bind cả DTO.

### 2.2 Backend — bỏ khớp theo nội dung tin nhắn

Trong cùng khối `OR` của `listConversations`, **xoá** mệnh đề thứ ba:

```ts
{ messages: { some: { deletedAt: null, content: { contains: q, mode: 'insensitive' } } } },
```

Lý do đã nêu trong tài liệu thiết kế: nó trả về hội thoại mà không trả về tin
khớp, màn hình không hiện đoạn trích nào, nên người dùng thấy một hội thoại lạ
nhảy ra không rõ vì sao. Nó cũng là mệnh đề đắt nhất — `ILIKE` quét bảng tin
nhắn, không index.

> **Đây là thay đổi hành vi thấy được.** Chủ dự án đã chốt phạm vi "chỉ tìm
> theo tên". Nếu đổi ý, giữ nguyên mệnh đề và bỏ qua mục 2.2 — phần còn lại
> của giai đoạn vẫn chạy.

Thêm comment tại chỗ ghi rõ vì sao vắng mặt, kèm lối đi cho full-text sau này.

### 2.3 Backend — test

**File:** `api/src/chat/chat.list-filter.test.ts` (mới)
- `type: 'DIRECT'` → `where.type` là `DIRECT`.
- `type: 'GROUP'` → `where.type` là `GROUP`.
- Không truyền `type` → `where` không có khoá `type`.
- Có `q` → `where.OR` đúng **hai** mệnh đề (tiêu đề, tên thành viên), không ba.
- `type` sai (`'BANANA'`) → DTO ném lỗi xác thực.

### 2.4 App — tầng dịch vụ

**File:** `src/services/chatApi.ts`

```ts
export type ConversationTypeFilter = 'DIRECT' | 'GROUP';

export function listConversations(
  page = 1, limit = 20, q?: string, type?: ConversationTypeFilter,
): Promise<Page<Conversation>> { /* thêm `type` vào params */ }
```

`chatKeys.conversationSearch` nhận thêm tham số:

```ts
conversationSearch: (q: string, type?: ConversationTypeFilter) =>
  [...chatKeys.all, 'conversations', 'search', q, type ?? 'all'] as const,
```

Kiểm mọi chỗ gọi `conversationSearch` và sửa theo.

### 2.5 App — hook tìm kiếm

**File:** `src/screens/MessagesScreen/useConversationSearch.ts`

Nhận thêm `type?: ConversationTypeFilter`, truyền xuống `listConversations`
và vào khoá cache. Giữ nguyên debounce 300ms và cờ `pending`.

### 2.6 App — thanh ba tab

**File mới:** `src/screens/MessagesScreen/components/SearchTabs.tsx`

Segmented control tự dựng. **Không** kéo `@react-navigation/material-top-tabs`
vào — đây là UI nội tuyến trong màn hình, không phải navigator, và gói đó hiện
không được dùng ở đâu trong `src/`.

```ts
export type SearchTab = 'all' | 'direct' | 'group';
interface SearchTabsProps {
  value: SearchTab;
  onChange: (tab: SearchTab) => void;
}
```

Ba nhãn từ i18n, tab đang chọn nền navy chữ trắng, còn lại nền `fieldBg` chữ
`secondary`. Dùng token từ `messagingTokens`, không đóng cứng màu.

### 2.7 App — ráp vào màn hình

**File:** `src/screens/MessagesScreen/MessagesScreen.tsx`

- Thêm `const [searchTab, setSearchTab] = useState<SearchTab>('all')`; reset về
  `'all'` trong `useFocusEffect` đang có, cạnh `setKeyword('')`.
- Vẽ `<SearchTabs>` ngay dưới ô tìm kiếm, **chỉ khi** `searching`.
- Một truy vấn duy nhất: `useConversationSearch(keyword, typeOf(searchTab))`
  với `typeOf: all → undefined, direct → 'DIRECT', group → 'GROUP'`.
- Tab **Tất cả** tự tách `search.results` theo `kind` thành hai mục
  `TIN NHẮN` / `NHÓM`, mỗi mục cắt 5 dòng, kèm "Xem tất cả" nhảy sang tab
  tương ứng. **Một request, không phải hai.**
- Tab **Tin nhắn** / **Nhóm**: một danh sách phẳng, không tiêu đề mục.
- **Gỡ mục `LIÊN HỆ KHÁC`** — gỡ luôn `otherContacts` (`:123-141`) và khối
  render (`:283-312`). Đường vào bạn bè chưa từng chat vẫn còn ở nút soạn tin
  (+) → `NewMessageScreen`.
- `localMatches` (bản lọc tại chỗ lấp quãng debounce) phải lọc thêm theo tab
  đang chọn, nếu không tab "Nhóm" sẽ chớp qua vài hội thoại 1-1 trước khi
  server trả lời.

### 2.8 App — i18n

`BaseLanguage.ts`, `vi.ts`, `en.ts`, trong nhánh `messages`:

| khoá | vi | en |
|---|---|---|
| `tab_all` | `Tất cả` | `All` |
| `tab_direct` | `Tin nhắn` | `Messages` |
| `tab_group` | `Nhóm` | `Groups` |
| `section_groups` | `NHÓM` | `GROUPS` |
| `see_all` | `Xem tất cả` | `See all` |

`section_conversations` đã có (`HỘI THOẠI`) — đổi giá trị thành `TIN NHẮN` cho
khớp nhãn tab, giữ nguyên tên khoá.

`section_other_contacts` thành khoá chết sau 2.7 — xoá khỏi cả ba file.
Chạy `yarn i18n:scan` để soát.

### 2.9 App — test

**File:** `src/screens/MessagesScreen/__tests__/SearchTabs.test.tsx` (mới) —
tab đang chọn có style nổi bật; bấm tab khác gọi `onChange` đúng giá trị.

**File:** `__tests__/MessagesScreen.test.tsx` (đã có) — thêm:
- Gõ từ khoá → thanh ba tab hiện ra; xoá từ khoá → biến mất.
- Tab "Nhóm" → `listConversations` được gọi với `type: 'GROUP'`.
- Tab "Tất cả" với kết quả trộn → hiện cả hai tiêu đề mục.
- Tab "Tất cả" mà kết quả chỉ có 1-1 → **không** vẽ tiêu đề mục `NHÓM` rỗng.
- Quay lại màn hình → tab reset về "Tất cả".

### Xong khi

```
cd Mindo-API/api && npm test
cd Mindo-App && yarn test && yarn lint && yarn i18n:scan
```

---

## Giai đoạn 3 — Nhóm vào dải "Gần đây"

Dựa trên giai đoạn 1 (cần `contactId` đúng để mở lại hội thoại cũ).

### 3.1 App — đổi nguồn dải ngang

**File:** `src/screens/MessagesScreen/components/RecentStrip.tsx`

Đổi prop từ `contacts: Contact[]` sang `conversations: Conversation[]`:

```ts
interface RecentStripProps {
  conversations: Conversation[];
  onPress: (conversation: Conversation) => void;
}
```

Mỗi ô: `source={conversation.avatar}`, `initials={conversation.initials}`,
`group={conversation.kind === 'group'}`, tên là `conversation.name`.

Giữ nguyên toàn bộ `styles` — khung 84, ô 64, avatar 60, tên ở y=68. Figma
978:9132 không đổi.

### 3.2 App — chỗ gọi

**File:** `src/screens/MessagesScreen/MessagesScreen.tsx` (~dòng 229)

```tsx
<RecentStrip
  conversations={conversations.slice(0, RECENT_STRIP_SIZE)}
  onPress={c => openConversation(c.id)}
/>
```

`RECENT_STRIP_SIZE = 10`, khai báo cạnh các hằng khác của file.

`conversations` đã sắp giảm dần theo `updatedAt` từ server, nên không cần sắp
lại. Điều hướng cũng gọn hơn hẳn: bấm vào là mở thẳng hội thoại, không còn
nhánh "tìm hội thoại cũ, không có thì sang màn soạn tin".

### 3.3 App — dọn phần thừa

`useMessaging.ts:129-157` dựng `contacts` (có cả khối `onlineOf`) giờ chỉ còn
phục vụ `contactsById` cho `formatPreview`. **Giữ lại** — nhưng sau giai đoạn 1
thì `onlineOf` đã chạy đúng, nên cập nhật khối comment ở `:130-139` cho khớp
thực tế, đừng để nó tiếp tục mô tả một lỗi đã hết.

### 3.4 App — test

`__tests__/MessagesScreen.test.tsx`:
- Dải "Gần đây" hiện hội thoại nhóm.
- Bấm một ô → mở đúng `conversationId` đó.
- Dải cắt ở `RECENT_STRIP_SIZE` ô.
- Đang tìm kiếm → dải ẩn (hành vi cũ, phải giữ).

### Xong khi

`yarn test && yarn lint`, và trên máy thật: nhóm vừa nhắn xuất hiện trong dải
"Gần đây" với icon hai người, bấm vào mở đúng nhóm.

---

## Giai đoạn 4 — Trạng thái hoạt động đầy đủ

Nặng nhất: migration + sự kiện socket mới + đổi API của `Avatar` ở mười hai
chỗ. Làm cuối vì ba giai đoạn trước đã ship được giá trị mà không cần nó.

Ba trạng thái đã chốt:

| Trạng thái | Chấm trong danh sách | Chữ ở header chat |
|---|---|---|
| Đang có socket | Lime `#B4D001` | "Đang hoạt động" |
| Rời đi < 1h | Xám nhạt | "Hoạt động 5 phút trước" |
| Rời đi ≥ 1h | Không vẽ | "Hoạt động 3 ngày trước" |

### 4.1 Backend — cột `lastSeenAt`

**File:** `api/prisma/schema.prisma` — `User` thêm:

```prisma
lastSeenAt DateTime?
```

**Migration:** `api/prisma/migrations/202609270001_user_last_seen/migration.sql`

```sql
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
```

Kiểm tên bảng/cột thật trong migration `202609250001_messaging` trước khi viết
— schema có `@@map` hay không quyết định chữ hoa thường.

**Vì sao Postgres chứ không Redis:** đọc kèm sẵn trong truy vấn `members` đang
có nên không tốn roundtrip, và không bay mất khi Redis bị flush. Redis vẫn giữ
đúng một việc — "ngay lúc này có socket nào đang mở không".

### 4.2 Backend — presence service biết đầu/cuối

**File:** `api/src/chat/chat-presence.service.ts`

Hai hàm đổi kiểu trả về để lớp realtime biết có cần fan-out không — mở ba
thiết bị không được bắn ba lần "vừa online":

```ts
/** `true` nếu đây là socket ĐẦU TIÊN của người này */
async connect(userId: string, socketId: string): Promise<boolean>

/** `true` nếu đây là socket CUỐI CÙNG — lúc đó mới ghi `lastSeenAt` */
async disconnect(userId: string, socketId: string): Promise<boolean>
```

`connect` đọc `SCARD` sau khi `SADD` và trả `=== 1`. `disconnect` đã có sẵn
kiểm tra `SCARD === 0`, chỉ cần trả ra.

Cẩn thận với `safe()` (dòng 54-61): nó nuốt mọi lỗi Redis. Khi Redis chết thì
cả hai hàm phải trả `false` — không fan-out còn hơn fan-out sai.

`disconnect` khi là socket cuối thì ghi `lastSeenAt = new Date()` qua
`PrismaService`. **Cần tiêm `PrismaService` vào service này** — hiện nó chưa có
dependency nào ngoài Redis. Kiểm `chat.module.ts` xem `PrismaModule` đã sẵn
trong scope chưa.

### 4.3 Backend — `getPeerUserIds`

**File:** `api/src/chat/chat.service.ts`, đặt cạnh `getMemberUserIds` (~dòng 443):

```ts
/** Mọi người dùng có chung ít nhất một hội thoại chưa xoá với `userId` */
async getPeerUserIds(userId: string): Promise<string[]>
```

Một truy vấn `conversationMember.findMany` với `where` lồng: hội thoại chưa
xoá, có thành viên là `userId` với `leftAt: null`, lấy `userId` distinct, trừ
chính mình.

Chi phí: một truy vấn mỗi lần connect/disconnect. Rẻ hơn hẳn `typing:start`
đang chạy **hai** truy vấn mỗi lần gõ phím, nên không đáng lo.

### 4.4 Backend — sự kiện `presence:updated`

**File:** `api/src/chat/chat-realtime.service.ts`

Hiện `bindSocket` gọi `void this.presence.connect(...)` kiểu bắn-và-quên
(dòng 168) và `disconnect` cũng vậy (dòng 265-267). Cả hai đổi thành hàm async
có await để đọc được cờ đầu/cuối:

```ts
private async announcePresence(userId: string, isOnline: boolean, lastSeenAt: string | null) {
  const peerIds = await this.chat.getPeerUserIds(userId);
  if (!peerIds.length) return;
  this.io?.to(peerIds.map((id) => this.userRoom(id)))
    .emit('presence:updated', { user_id: userId, is_online: isOnline, last_seen_at: lastSeenAt });
}
```

- Lúc connect: `if (await this.presence.connect(...)) await this.announcePresence(userId, true, null)`
- Lúc disconnect: nếu là socket cuối, lấy mốc vừa ghi rồi
  `announcePresence(userId, false, iso)`

Bọc trong try/catch và log — một lỗi fan-out không được làm hỏng vòng đời
socket.

**Không có khoảng ân hạn:** tắt socket là offline ngay. Chấm xám của mốc < 1h
đã che được nhịp chớp khi người dùng thu app xuống nền.

### 4.5 Backend — `last_seen_at` trong payload

**File:** `api/src/chat/chat.service.ts`

- `memberUserSelect` (dòng 35-42) thêm `lastSeenAt: true`.
- `serializeConversationRows` thêm, cạnh `peer_user_id` của giai đoạn 1:

  ```ts
  last_seen_at: row.type === ConversationType.DIRECT
    ? peer?.user.lastSeenAt?.toISOString() ?? null
    : null,
  ```
- `userProfile` (dòng 762-769) thêm `last_seen_at` để mảng `members[]` của màn
  chi tiết nhóm cũng có.

### 4.6 Backend — test

**File:** `api/src/chat/chat.presence-fanout.test.ts` (mới), theo khuôn
`chat.typing-fanout.test.ts`:
- Socket đầu tiên → bắn `presence:updated` với `is_online: true` tới phòng của
  mọi peer.
- Socket **thứ hai** cùng người → **không** bắn.
- Socket cuối ngắt → ghi `lastSeenAt` và bắn `is_online: false` kèm mốc.
- Còn socket khác đang mở → **không** bắn, **không** ghi `lastSeenAt`.
- Không có peer nào → không gọi `emit`.
- `getPeerUserIds` ném lỗi → không làm hỏng luồng disconnect.

**File:** `chat.peer-id.test.ts` (từ giai đoạn 1) — thêm ca `last_seen_at`
đúng cho DIRECT, `null` cho GROUP.

### 4.7 Backend — tài liệu

`docs/messaging-api.md`: thêm `presence:updated` vào danh sách sự kiện
server→client, và `last_seen_at` vào bảng dòng hội thoại.

### 4.8 App — kiểu và transport

**File:** `src/model/MessagingModel.ts`

```ts
export type Presence = 'online' | 'recent' | 'offline';
```

`Conversation` và `Contact` cùng thêm `lastSeenAt: string | null`. **Giữ
nguyên `online: boolean`** — nó là dữ kiện thô từ server; `Presence` là thứ
suy ra khi vẽ.

**File:** `src/services/chatApi.ts` — `RawConversation`/`RawUser` thêm
`last_seen_at?: string | null`; `toConversation`/`toContact` map sang
`lastSeenAt`.

**File:** `src/services/chatSocket.ts` — thêm vào `ChatSocketEvents` **và**
mảng `SERVER_EVENTS` (thiếu một trong hai là sự kiện không bao giờ tới):

```ts
'presence:updated': {user_id: string; is_online: boolean; last_seen_at: string | null};
```

### 4.9 App — vá cache khi có sự kiện

**File:** `src/screens/MessagesScreen/ChatSocketProvider.tsx`

Thêm một `onChatEvent('presence:updated', ...)` vào mảng đăng ký. Khác với
`patchList` (tra theo `conversationId`), cái này quét theo **người**:

```ts
queryClient.setQueryData<Page<Conversation>>(chatKeys.conversations(), current =>
  current ? {...current, items: current.items.map(c =>
    c.contactId === data.user_id
      ? {...c, online: data.is_online, lastSeenAt: data.last_seen_at}
      : c)} : current);
```

Đây chính là chỗ `peer_user_id` của giai đoạn 1 trả công: không có nó thì
`contactId` luôn `null` và phép so này không bao giờ khớp.

Vá thêm `chatKeys.conversation(id)` nếu đang mở màn chi tiết, để header đổi
ngay chứ không đợi fetch lại.

### 4.10 App — chuỗi hiển thị

**File:** `src/screens/MessagesScreen/messagingFormat.ts`

```ts
/** Ngưỡng "chưa offline hẳn" — dưới mốc này còn vẽ chấm xám */
export const RECENT_WINDOW = HOUR;

export const presenceOf = (
  online: boolean, lastSeenAt: string | null, now = Date.now(),
): Presence => { /* online → 'online'; < RECENT_WINDOW → 'recent'; còn lại 'offline' */ };

/** "Hoạt động 5 phút trước" — chỉ dùng ở header màn chat */
export const formatLastSeen = (iso: string | null, now = Date.now()): string => { /* … */ };
```

Bám đúng bậc thang và các hằng `MINUTE`/`HOUR`/`DAY` của `formatRowTime` ngay
trên đó; đi qua `tr()` + `format()` như mọi hàm khác trong file. `lastSeenAt`
là `null` (server chưa từng ghi) → trả chuỗi rỗng, **không** bịa "vừa xong".

i18n thêm `messages.conversation.active_ago` (`Hoạt động {n} trước` /
`Active {n} ago`), dùng lại các mảnh thời gian của `messages.format`.

### 4.11 App — `Avatar` ba trạng thái

**File:** `src/screens/MessagesScreen/components/Avatar.tsx`

Thay `online?: boolean` bằng `presence?: Presence`. Chấm vẽ khi `'online'`
hoặc `'recent'`, khác nhau ở màu; `'offline'` không vẽ. Giữ nguyên công thức
kích cỡ `Math.round(size * 0.27)` và cách chấm tràn ra ngoài viền — Figma
978:9085 không đổi.

**File:** `messagingTokens.ts` — thêm cạnh `online`:

```ts
/** Chấm "vừa mới đây" — rời đi dưới 1 tiếng, chưa offline hẳn */
recent: '#C3CBD6',
```

**Mười hai chỗ dùng `Avatar` phải sửa theo:** `ConversationRow`, `ChatHeader`,
`RecentStrip`, `NewMessageScreen`, `ContactRow`, `MemberChip`, `MessageBubble`,
`GroupInfoScreen`, `GroupMembersScreen`, `CreateGroupNameScreen`,
`ConversationEmpty`. Chỗ nào không có khái niệm presence thì bỏ hẳn prop —
mặc định `'offline'` là không vẽ chấm, đúng hành vi cũ.

Đây là điểm dễ sót nhất của cả plan. TypeScript bắt được hết nếu prop `online`
bị **xoá** chứ không phải để lại cho tương thích ngược — nên xoá hẳn.

### 4.12 App — header màn chat

**File:** `src/screens/MessagesScreen/ConversationScreen.tsx` (~dòng 392)

Nhánh offline thôi trả chuỗi rỗng, gọi `formatLastSeen(conversation.lastSeenAt)`.
Gỡ khối comment `:385-391` — nó mô tả một giới hạn ("backend không có mốc lần
cuối online") mà giai đoạn này vừa xoá bỏ. Thay bằng ghi chú ngắn về ba trạng
thái.

### 4.13 App — test

**File:** `src/screens/MessagesScreen/__tests__/presence.test.ts` (mới)
- `presenceOf` cho cả ba trạng thái, kèm hai ca sát ngưỡng: 59 phút → `recent`,
  61 phút → `offline`.
- `presenceOf(false, null)` → `offline`.
- `formatLastSeen(null)` → chuỗi rỗng.
- `formatLastSeen` ở mốc phút / giờ / ngày.

**File:** `__tests__/ChatSocketProvider.test.tsx` (đã có)
- `presence:updated` vá đúng hội thoại có `contactId` khớp.
- Không đụng hội thoại của người khác.
- Hội thoại nhóm (`contactId: null`) không bao giờ khớp.

**File:** `__tests__/ConversationScreen.test.tsx` (đã có)
- Online → "Đang hoạt động".
- Offline có mốc → "Hoạt động 5 phút trước".
- Offline không mốc → không hiện dòng phụ.
- Nhóm → vẫn là số thành viên, presence không chen vào.

### Xong khi

```
cd Mindo-API/api && npm test && npx prisma migrate dev
cd Mindo-App && yarn test && yarn lint
```

Kiểm bằng hai tài khoản thật (xem quy ước tài khoản test trong memory):
đóng app máy B → chấm ở máy A chuyển xám trong vài giây; mở header hội thoại
thấy "Hoạt động … trước"; sau một tiếng chấm biến mất.

---

## Rủi ro và điểm dễ sót

| Rủi ro | Xử lý |
|---|---|
| Cache `chatKeys.conversations()` bị vá từ **tám** chỗ, chỗ nào cũng giả định hình dạng `Page<Conversation>` (`useMessaging.ts:58-74`) | Chỉ **thêm** trường, không đổi hình dạng. Thêm thì an toàn, đổi thì hỏng âm thầm. |
| Đổi `Avatar.online` → `presence` sót một trong mười hai chỗ | Xoá hẳn prop cũ thay vì giữ cho tương thích — TypeScript sẽ bắt hết. |
| `avatar_url` là URL ký có hạn, mặc định 900s (`file-storage.service.ts:78-95`) | Đừng cache lâu phía client. Không đổi gì ở plan này, chỉ là điều cần nhớ. |
| Redis chết → `safe()` nuốt lỗi, ai cũng thành offline | Chấp nhận được: `lastSeenAt` ở Postgres nên thoái hoá thành "ai cũng hiện mốc hoạt động cuối", không phải màn hình trắng. |
| Fan-out presence gọi thêm truy vấn mỗi connect/disconnect | Vẫn rẻ hơn `typing:start` đang chạy hai truy vấn mỗi lần gõ phím. Nếu thành vấn đề thì cache `getPeerUserIds` theo TTL ngắn. |
| `unread_count` là N+1, một `count()` mỗi dòng (`chat.service.ts:664`) | **Ngoài phạm vi.** Nhưng thêm tab nhóm nghĩa là thêm lần gọi danh sách — ghi nhận để xử sau. |
| Bỏ mục `LIÊN HỆ KHÁC` (2.7) làm mất đường tìm bạn chưa từng chat | Nút soạn tin (+) → `NewMessageScreen` vẫn liệt kê toàn bộ bạn bè. Không mất chức năng. |

## Quy ước

- Commit message **tiếng Anh**, không gắn dòng ghi công Claude Code.
- Comment trong code tiếng Việt, theo đúng giọng đang có: giải thích **vì sao**
  chứ không thuật lại **cái gì**.
- Gặp comment mô tả một giới hạn mà thay đổi vừa xoá bỏ thì **sửa comment đó**.
  Kho này có vài chỗ như vậy và plan đã chỉ đích danh từng chỗ.

---

# Nhật ký thi công (2026-09-27)

Bốn giai đoạn đã xong. Ghi lại những chỗ THỰC TẾ lệch khỏi kế hoạch, vì đó là
phần đáng đọc lại nhất.

## Lệch so với kế hoạch

| Kế hoạch | Thực tế |
|---|---|
| Sửa avatar trống ở dòng danh sách | Cùng một lỗi gốc còn giấu triệu chứng thứ hai: dòng 1-1 đọc `contact?.avatar` nên **ảnh của người chat 1-1 cũng chưa từng hiện**. Nay cả ảnh lẫn chữ đều đọc từ `conversation`. |
| `toConversation` bỏ hẳn nhánh `members` | Giữ lại làm đường lùi: `raw.peer_user_id ?? peer?.user_id ?? null`. App mới + server cũ vẫn dựng được người kia ở màn chi tiết. |
| Dải "Gần đây" hiện hội thoại gần đây, có cả nhóm | Chủ dự án đổi ý sau khi thấy dải lặp lại đúng danh sách bên dưới: nay là **"Đang hoạt động"**, chỉ hội thoại 1-1 đang online. Nhóm rơi khỏi dải (server không có `is_online` cho nhóm) nhưng vẫn đầy đủ trong danh sách. Không ai online thì ẩn cả nhãn. |
| Đổi `Avatar` ở 12 chỗ gọi | Chỉ 4 chỗ thật sự truyền `online`. |
| `ChatPresenceService` cần sửa module để tiêm Prisma | Không cần: `PrismaModule` là `@Global()`. |
| — | **`nest build` biên dịch cả file test**, nên một chỗ ép kiểu lỏng trong test làm hỏng build production dù `vitest` vẫn xanh. `npm test` xanh không có nghĩa là build được. |
| — | **`this.io` là namespace GỐC.** Client nối vào `/chat` tức `this.namespace`. Bản đầu bắn `presence:updated` vào `this.io` — Socket.IO im lặng, không lỗi, không ai nhận. Unit test vẫn xanh vì nó tiêm đúng cái đối tượng sai. |
| — | **Socket của tiến trình đã chết làm hỏng hẳn presence.** Xem dưới. |

## Socket bỏ lại — lỗi mà unit test không thể bắt

Tập socket trong Redis chỉ được gỡ ở handler `disconnect`. Server bị kill -9,
crash, hay chỉ là khởi động lại lúc dev thì handler đó không chạy, và mọi
socket đang mở nằm lại nguyên một ngày (TTL 86400).

Hậu quả không phải một chấm xanh thừa — nó làm **hỏng hẳn** presence của người
đó: `SCARD` không còn bằng 1 nên không ai được báo họ vừa online, và không bao
giờ về 0 nên không ai được báo họ đã offline. Trên máy dev lúc kiểm tra, hai
tài khoản đã tích **40 id rác** đúng theo cách này, trong khi mọi unit test
vẫn xanh.

Cách xử: mỗi thành viên ghi dạng `{nodeId}|{socketId}`; mỗi tiến trình giữ một
khoá nhịp tim `mindo:chat:node:{nodeId}` TTL 60s và gia hạn mỗi 30s; lúc khởi
động, tiến trình quét bỏ socket của những nodeId không còn khoá. Rác kiểu cũ
(không có `|`) cũng rơi vào diện này nên tự sạch ở lần chạy đầu.

**Hệ quả cần biết:** mỗi lần triển khai, presence của mọi người reset về
offline, và chấm sáng lại khi máy họ nối lại.

## Còn để lại

- ~~**Tìm kiếm không bỏ dấu.**~~ ĐÃ LÀM (2026-09-27, xem dưới).
- **`unread_count` vẫn là N+1** (`chat.service.ts`), một `count()` mỗi dòng.
- **Tìm theo nội dung tin nhắn đã gỡ.** Muốn có lại thì dựng full-text tử tế,
  có index và trả về TIN kèm đoạn trích, chứ không phải hội thoại chứa tin.

---

# Bổ sung: tìm kiếm bỏ dấu (2026-09-27)

Gõ "dau tu" và "Đầu tư" đều phải ra "Đầu tư dài hạn".

**Cách làm.** Mỗi cột tên có một cột song song đã bỏ dấu + hạ chữ thường
(`User.fullNameNormalized`, `User.nicknameNormalized`,
`Conversation.titleNormalized`, `Friendship.aliasNormalized`), do **trigger**
giữ đồng bộ — không phải code ứng dụng, vì tên bị ghi từ nhiều đường (đăng ký,
sửa hồ sơ, admin, tạo nhóm, đổi tên nhóm) và bỏ sót một đường thì cột lệch âm
thầm. Kèm index GIN trigram, nên `LIKE '%x%'` không còn quét bảng.

**Vì sao KHÔNG dùng `unaccent`.** Bản đầu dùng nó và chạy đúng cho tiếng Việt,
kể cả `Đ` → `D`. Nhưng đối chiếu 17 mẫu giữa Postgres và JavaScript lòi ra một
lệch: `unaccent` phiên âm cả dấu câu — gạch dài `–` thành `-` — còn
`normalize('NFD')` bên JS thì không. Một ký tự lệch là tìm không ra, và không
có gì báo.

Cùng một phép biến đổi phải viết hai lần ở hai ngôn ngữ (cột nằm ở CSDL, ô tìm
kiếm nằm ở app), nên phải chọn phép nào DIỄN ĐẠT ĐƯỢC GIỐNG HỆT ở cả hai. NFD
rồi xoá ký tự tổ hợp là phép đó — cả hai đều theo bảng Unicode, không theo một
bảng phiên âm riêng của Postgres. Đã đối chiếu lại 17 mẫu (Việt, Đức, Thổ, Ba
Lan, Pháp): khớp hoàn toàn.

`đ`/`Đ` phải đổi tay ở cả hai phía — nó là ký tự riêng chứ không phải `d` cộng
dấu, nên NFD không tách. Thiếu bước đó thì "dau tu" ra kết quả còn "đầu tư"
thì không: đúng nửa yêu cầu, và nửa hỏng là nửa khó nhận ra hơn.

**Ba nơi phải khớp nhau,** sửa một thì phải sửa cả ba:

| Nơi | Hàm | Việc |
|---|---|---|
| Postgres | `mindo_search_key()` | chuẩn hoá DỮ LIỆU vào cột |
| Backend | `searchKey()` (`chat.domain.ts`) | chuẩn hoá TỪ KHOÁ trước khi so |
| App | `plainText()` (`nameUtils.ts`) | bộ lọc tại chỗ trong lúc chờ server |

`chat.search-key.test.ts` khoá sự tương đương đó bằng các giá trị lấy thẳng từ
Postgres.

**Một test cũ phải sửa theo.** Ca "không vẽ tiêu đề mục rỗng" dựa vào việc
"Đầu tư dài hạn" không chứa chữ `a` — bỏ dấu xong thành "dau tu dai han" thì
có. Nay nó chờ kết quả server chốt lại thay vì bắt trạng thái tạm, đúng thứ nó
định kiểm.
