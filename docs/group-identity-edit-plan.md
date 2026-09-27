# Sửa tên và ảnh nhóm từ màn nhắn tin nhóm

Màn nhắn tin nhóm phải cho đổi tên nhóm và ảnh nhóm, đi theo đúng khuôn bấm
của màn nhắn tin 1-1. Phần lớn đường đi đã có sẵn ở cả hai repo; việc của lần
này là vá những chỗ luồng nhóm còn hụt so với luồng 1-1, không dựng màn mới.

## Sáu điều đã chốt

1. **Thay đổi CHUNG cho cả nhóm.** Sửa thẳng `Conversation.title` /
   `Conversation.avatarFileId` — mọi thành viên đều thấy. "Flow tương tự 1-1"
   là nói về CÁCH BẤM, không phải về ngữ nghĩa: luồng 1-1 ghi đè riêng tư một
   chiều (`Friendship.alias` / `Friendship.avatarFileId`, người kia không hề
   biết), còn nhóm thì không có chuyện đó. Không thêm cột ghi đè nào trên
   `ConversationMember`.
2. **Chỉ admin/owner sửa được.** Giữ `assertManager` ở API và điều kiện
   `isAdmin` ẩn dòng ở app. Đây là chỗ CỐ Ý lệch khỏi luồng 1-1 (ở đó ai cũng
   sửa được, vì sửa xong chỉ mình thấy).
3. **Giữ hai lớp điểm vào.** Chạm header → Thông tin nhóm → "Đổi tên nhóm" —
   sâu đúng bằng luồng 1-1 (chạm header → Chi tiết liên hệ → bút chì → Sửa
   liên hệ). Không thêm lối tắt ở ba chấm, không gộp vào Thông tin nhóm.
4. **Có tin hệ thống cho cả tên và ảnh**, và đổi cả hai cùng lúc thì GỘP một
   tin chứ không bắn hai. Đứng cùng hàng với thêm/xoá/rời thành viên: mọi
   thay đổi chung đều để lại dấu vết.
5. **Sheet ảnh đủ ba lựa chọn** (Thư viện / Máy ảnh / Xoá ảnh hiện tại), dùng
   lại `ImageSourceSheet` như `EditContactScreen`. Kéo theo: API phải nhận
   `avatar_file_id: null`.
6. **Cả tên và ảnh đều chờ nút Lưu** — một lần gọi PATCH, một tin hệ thống.
   Đây là chỗ thứ hai cố ý lệch khỏi luồng 1-1: ở `EditContactScreen`, chọn
   ảnh là lưu NGAY kèm toast, chỉ tên mới chờ nút Lưu. Làm vậy ở nhóm thì đổi
   cả hai sẽ hiện hai tin hệ thống liền nhau, trái điều 4. Đổi lại, thoát giữa
   đường là mất ảnh vừa chọn, nên phải có cảnh báo "bỏ thay đổi?" khi bấm Back.

## Hiện trạng, đã kiểm từng chỗ

Có sẵn và ĐÚNG, không đụng tới:

- `PATCH investor/chat/groups/:conversationId` đã nhận cả `title` và
  `avatar_file_id`; `chatApi.updateGroup` bên app cũng vậy.
- `RenameGroupScreen` đã có cả ô tên (điền sẵn, có nút xoá nhanh, đếm 50 ký
  tự) và khối ảnh xem trước.
- `ChatHeader` đã hiện ảnh nhóm thật.
- `titleNormalized` **tự lo bằng trigger** `conversation_search_sync`
  (`202609270003_search_normalized`, `BEFORE INSERT OR UPDATE OF "title"`).
  Đổi tên qua `conversation.update` là cột bỏ dấu tự khớp — không có việc gì
  phải làm ở tầng ứng dụng, và cũng KHÔNG được thêm, vì thêm là hai nơi cùng
  ghi một cột.

Còn hụt:

| Chỗ | Vấn đề |
| --- | --- |
| `chat.service.ts` `updateGroup` | `if (!dto.title && !dto.avatar_file_id) throw` — `null` là giá trị falsy, nên đường xoá ảnh bị chặn ngay ở cửa. Câu `update` cũng chỉ ghi giá trị truthy. |
| `chat.service.ts` `updateGroup` | Không sinh tin hệ thống, trong khi `createGroup` / `addMembers` / `removeMember` / `leaveGroup` đều có. |
| `useGroupPhotoPicker` | Chỉ `pickImageAsset('library')` — không chụp được ảnh, không xoá được ảnh. |
| `RenameGroupScreen` | Bấm Lưu là `goBack()` ngay, bắn HAI lời gọi rời nhau (`renameGroup` + `setGroupAvatar`), không `await`, không toast, không cảnh báo khi Back. |
| `chatApi.updateGroup` | `...(patch.avatarFileId ? {avatar_file_id: ...} : {})` — không có cách nào gửi `null` xuống. |
| `GroupInfoScreen` | Khối tên+ảnh ở đỉnh vẽ cứng `<IconUsers size={48} />`, không bao giờ hiện ảnh nhóm thật dù đã có. |

## Việc ở Mindo-API

**`api/src/chat/chat.dto.ts`** — `UpdateGroupConversationDto.avatar_file_id`
nhận `null`, theo đúng khuôn `UpdateFriendAvatarDto`:

```ts
@IsOptional() @ValidateIf((_, value) => value !== null)
@IsString() @MaxLength(64) avatar_file_id?: string | null;
```

**`api/src/chat/chat.service.ts`** — `updateGroup`:

- Phân biệt "không gửi" với "gửi null": cửa vào xét `dto.title === undefined
  && dto.avatar_file_id === undefined`, câu `update` xét `'avatar_file_id' in
  dto` thay vì truthy. `assertOwned` + kiểm `image/` chỉ chạy khi có id thật.
- Đọc hàng hiện tại trước khi ghi, để biết có thay đổi THẬT hay không: đặt
  lại đúng cái tên đang có, hoặc xoá ảnh của nhóm vốn không có ảnh, thì không
  sinh tin hệ thống nào.
- Một tin gộp, dựng theo những gì thực sự đổi:
  - cả hai: `"{X} đã đổi tên nhóm thành {Y} và đổi ảnh nhóm"`
  - chỉ tên: `"{X} đã đổi tên nhóm thành {Y}"`
  - chỉ đặt/đổi ảnh: `"{X} đã đổi ảnh nhóm"`
  - chỉ xoá ảnh: `"{X} đã xoá ảnh nhóm"`
- Trả về `{ ...getConversation(...), system_message }` như `addMembers`.

**`api/src/chat/chat.controller.ts`** — sau `publishConversation`, phát tin hệ
thống nếu có, theo đúng khuôn `removeMember` (`if (data.system_message)`).

**`docs/messaging-api.md`** — dòng 142: nói rõ `avatar_file_id: null` là xoá
ảnh, chỉ admin/owner gọi được, và mỗi lần đổi sinh một tin hệ thống.

## Việc ở Mindo-App

**`src/services/chatApi.ts`** — `updateGroup` nhận `avatarFileId?: string |
null` và gửi được `null` (`'avatarFileId' in patch` thay vì truthy).

**`src/screens/MessagesScreen/useGroupPhotoPicker.ts`** — `pick(source:
ImageSource)` thay vì chỉ thư viện, thêm `clear()` cho hàng xoá. Ba trạng
thái ảnh mà `RenameGroupScreen` cần phân biệt: *giữ nguyên* (`undefined`),
*ảnh mới* (`fileId`), *xoá* (`null`).

**`src/screens/MessagesScreen/RenameGroupScreen.tsx`** —
`ImageSourceSheet` + `useImageHandoffScrim` như `EditContactScreen` (sheet đó
đã né sẵn lỗi bàn giao của iOS: mở thư viện trong lúc modal còn đang gỡ thì
lời gọi bị nuốt). Hàng "Xoá ảnh hiện tại" chỉ hiện khi nhóm đang có ảnh. Bấm
Lưu: MỘT lời gọi `actions.updateGroupIdentity(id, {title?, avatarFileId?})`,
`await` rồi mới `goBack()`, toast thành công / lỗi. Bấm Back khi đang có thay
đổi chưa lưu thì hỏi lại bằng `ConfirmDialog` (đã có trong `components/`).

**`src/screens/MessagesScreen/useMessagingActions.ts`** — thay
`renameGroup` + `setGroupAvatar` bằng một `updateGroupIdentity`. Cả hai hiện
chỉ có `RenameGroupScreen` gọi, nên không còn chỗ nào hỏng.

**`src/screens/MessagesScreen/GroupInfoScreen.tsx`** — khối đỉnh hiện ảnh
nhóm thật, rơi về `IconUsers` khi chưa có ảnh.

**`src/i18n/vi.ts` + `en.ts`** — nhãn tiêu đề sheet, hàng xoá ảnh, toast lưu
xong, và câu hỏi bỏ thay đổi.

## Test

API — thêm `api/src/chat/chat.update-group.test.ts`:

- `avatar_file_id: null` xoá ảnh thật (trước đây bị cửa vào chặn).
- Đổi cả tên và ảnh sinh ĐÚNG MỘT tin hệ thống.
- Đặt lại đúng tên đang có thì không sinh tin nào.
- Thành viên thường bị `assertManager` chặn.

App — mở rộng `__tests__/groupPhoto.test.tsx`: chụp ảnh, xoá ảnh, một lời gọi
PATCH duy nhất khi đổi cả hai, hỏi lại khi Back giữa đường. Và
`__tests__/GroupInfoScreen.test.tsx`: khối đỉnh hiện ảnh nhóm khi có.

## Ngoài phạm vi

- Ghi đè tên/ảnh nhóm riêng cho từng người (điều 1 đã loại).
- Nới quyền cho thành viên thường (điều 2 đã loại).
- Lối tắt sửa ở ba chấm hoặc sửa tại chỗ trong Thông tin nhóm (điều 3 đã loại).
- Đổi ảnh/tên nhóm theo thời gian thực cho người đang mở màn khác:
  `publishConversation` hiện có đã lo, không mở rộng thêm.
