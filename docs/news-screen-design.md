# Màn Tin tức — thiết kế lại theo Figma và nối API thật

Figma: `Tin tức · Redesign` (node `1058:11954`), 10 khung, gồm 4 màn:

| Màn | Khung Figma |
| --- | --- |
| Danh sách (tab Tin tức) | `Tin tức · Danh sách` (Tất cả + chip lĩnh vực), `Tin tức · Dành cho bạn`, `… Dành cho bạn - Chưa chọn lĩnh vực`, `Tin tức · Menu bài viết` |
| Tìm kiếm | `Tin tức · Tìm kiếm` |
| Chi tiết | `Tin tức · Chi tiết` (AI chưa chạy), `… AI đang chạy`, `… AI đã tóm tắt`, `… AI hết lượt` |
| Chọn lĩnh vực | `Tin tức · Danh mục` |

Phạm vi: cả **Mindo-API** và **Mindo-App**, làm trong một lượt.

## Quyết định đã chốt

1. **Nút "Tóm tắt bằng AI" mở khoá bản đã có sẵn.** Mỗi bài đã qua bước AI biên tập
   đều có sẵn 4–5 ý trong `aiSummary`. Bấm nút thì trừ 1 lượt và mở bản đó; mở lại
   bài đó sau này thì không trừ nữa. Không gọi LLM khi bấm. Bài không có tóm tắt
   (bài admin tự viết) thì ẩn thẻ AI.
2. **Hạn mức riêng cho tin tức, tính theo tháng (giờ Việt Nam), có cộng thêm theo Peer.**
   Dùng lại khuôn của quota chat AI (`AI_DAILY_MESSAGE_LIMIT` + `AI_DAILY_LIMIT_PER_PEER`)
   nhưng tách hẳn ra. Nút "Mua thêm Peer để tăng hạn mức" mở `PeerListScreen`.
3. **AI gán lĩnh vực cho bài lúc biên tập.** Chỉ chọn trong các lĩnh vực đang bật;
   giá trị không hợp lệ thì coi là không có. Chỉ các bài biên tập **từ nay trở đi**
   mới được gán; bài cũ muốn có lĩnh vực thì admin cho biên tập lại.
4. **Làm "Ẩn tin từ <nguồn>" bằng loại phản hồi mới `HIDE_SOURCE`.** Bài không có
   nguồn thì menu không hiện mục này. Ẩn xong thì hiện toast và gỡ bài khỏi danh
   sách. Không có nút hoàn tác, vì thiết kế không có chỗ nào để quản lý những gì đã ẩn.

### Các chỗ tôi tự quyết (nếu không hợp thì báo để đổi)

- **Số lượt:** mặc định 10 lượt/tháng, mỗi Peer cộng thêm **5** lượt. Đọc từ env
  `NEWS_AI_SUMMARY_MONTHLY_LIMIT` và `NEWS_AI_SUMMARY_LIMIT_PER_PEER`. Con số 5 là tôi đặt tạm.
- **Tab mặc định khi mở màn là "Dành cho bạn".** Người mới chưa chọn lĩnh vực sẽ
  thấy ngay trạng thái trống có nút "Chọn lĩnh vực quan tâm". Thiết kế không có màn
  hướng dẫn bắt buộc, nên trạng thái trống này chính là lời mời chọn lĩnh vực.
- **Ẩn một lĩnh vực thì cũng bỏ nó khỏi danh sách quan tâm; chọn lại nó ở màn Chọn
  lĩnh vực thì hết ẩn.** Không làm thế thì sẽ có mâu thuẫn: lĩnh vực vừa "quan tâm"
  vừa "bị ẩn". Và màn Chọn lĩnh vực trở thành chỗ hoàn tác việc ẩn lĩnh vực. Ẩn
  nguồn thì vẫn không có đường hoàn tác (đúng như quyết định 4).
- **Chip lĩnh vực ở tab "Tất cả"** gồm chip "Tất cả" và mọi lĩnh vực đang bật, trừ
  những lĩnh vực người dùng đã ẩn.
- **Màn Chọn lĩnh vực không có nút quay lại** (theo thiết kế). Người dùng thoát bằng
  vuốt cạnh hoặc nút back của Android. Phải chọn ít nhất 1 lĩnh vực thì nút
  "Khám phá" mới bấm được. Mở màn lên thì các lĩnh vực đang quan tâm được chọn sẵn.
- **Nút "Chia sẻ"** mở hộp chia sẻ của hệ điều hành, gửi tiêu đề kèm `source_url`
  nếu bài có. Mindo chưa có trang web đọc bài để gửi link.
- **Bỏ nút AI nổi (`AiLauncher`) ở tab Tin tức** vì thiết kế mới không có.
- Những trạng thái thiết kế không vẽ: đang tải danh sách, lỗi mạng, và "đã có lĩnh
  vực nhưng chưa có bài". Tôi dùng các component sẵn có (`Loading`, `ErrorView`,
  một dòng chữ trống) và không tự vẽ thêm.

## Hiện trạng đã kiểm

**API** (`api/src/news`) đã có gần đủ:

- danh sách bài có lọc theo lĩnh vực và phân trang (`GET news/articles?topic=&page=&q=`)
- chi tiết bài (`GET news/articles/:idOrSlug`)
- danh sách lĩnh vực (`GET news/topics`)
- lĩnh vực quan tâm (`GET news/me`, `PATCH news/me/interests`)
- phản hồi `HIDE_TOPIC` / `NOT_INTERESTED` / `REPORT` (`POST news/articles/:id/feedback`)
- lượt thích

Những chỗ còn thiếu hoặc sai:

| Chỗ | Vấn đề |
| --- | --- |
| Tab "Dành cho bạn" | Chưa có cách lọc bài theo các lĩnh vực người dùng quan tâm. |
| Tên nguồn ("CafeF · 2 giờ") | `articleView` chỉ trả `source` cho admin. |
| `ai_summary` | Đang trả cho **mọi người** ở danh sách, chi tiết và tìm kiếm. Nếu không giấu đi thì hạn mức vô nghĩa. |
| Hạn mức và mở khoá tóm tắt | Chưa có gì. |
| Ẩn nguồn | Chưa có `HIDE_SOURCE`. |
| **Lọc bài bị ẩn** | **Lỗi có sẵn, đã chạy thử để xác nhận:** `topicId: { notIn: [...] }` sinh ra SQL `"topicId" NOT IN (...)`, mà điều kiện này loại luôn mọi dòng có `topicId` là NULL. Trên DB local: 218 bài, ẩn một lĩnh vực bất kỳ thì còn **0** bài. Nghĩa là người dùng ẩn một lĩnh vực xong thì mọi bài chưa có lĩnh vực biến mất theo. `sourceId` sẽ bị đúng lỗi này nếu làm ẩn nguồn theo cùng cách. |
| Lĩnh vực của bài | Crawler lấy lĩnh vực từ `NewsSource.topicId`, mà mọi nguồn đều NULL; bước AI biên tập cũng không phân loại. |

**Dữ liệu local:** 217 bài DRAFT chưa qua biên tập, chưa có lĩnh vực; 1 bài
PUBLISHED. Muốn thử trên máy thì phải biên tập rồi xuất bản vài bài qua admin.

**App** (`src/screens/NewsScreen`): đang bám thiết kế cũ (`889:1151`) và dữ liệu hoàn
toàn là mock (`newsApi.ts`). `newsService.ts`, `model/NewsModel` và
`mocks/fixtures/news.ts` là code chết, chỉ trỏ lẫn nhau.

**Đang có phiên khác làm song song:** cả hai repo vừa bị chuyển sang nhánh
`feat/image-generation*`, và nhánh đó đang sửa `ai.service.ts`. Vì vậy việc này làm
trong **worktree riêng**, nhánh `feat/news-redesign` tách từ `origin/main`:
`Mindo-API-news` và `Mindo-App-news`. Tôi cũng không đụng vào `ai.service.ts`. Đoạn
đếm Peer (`nftAsset.count`) chỉ có một dòng nên chép lại bên tin tức, thay vì tách
ra dùng chung.

## API

### Migration

- `NewsFeedbackType` thêm giá trị `HIDE_SOURCE`.
- `NewsArticleFeedback` thêm cột `sourceId String?`, quan hệ tới `NewsSource`
  (`onDelete: SetNull`) và index `(userId, type)`, dùng giống cột `topicId` đã có.
- Bảng mới `NewsAiSummaryUnlock(userId, articleId, createdAt)`, khoá chính
  `(userId, articleId)`, index `(userId, createdAt)`. Mỗi dòng là một lần mở khoá
  một bài, tức là một lượt. Đếm số dòng trong tháng là ra số lượt đã dùng; khoá
  chính bảo đảm mỗi bài chỉ trừ một lần.

### `NewsService`

- **Lọc bài bị ẩn (sửa lỗi):** đổi thành `OR: [{ topicId: null }, { topicId: { notIn } }]`,
  và làm tương tự cho `sourceId`. Gom vào một hàm `visibleFor(hidden)` để danh sách
  và trang chủ dùng chung.
- **`listArticles`** thêm tham số `feed=all|for_you`. Với `for_you`: chỉ lấy bài
  có `topicId` thuộc các lĩnh vực người dùng quan tâm. Chưa đăng nhập thì trả 401.
  Chưa chọn lĩnh vực nào thì trả danh sách rỗng; app tự hiện trạng thái trống dựa
  vào `me.interests`, không dựa vào việc danh sách rỗng.
- **`articleView` bản công khai:**
  - thêm `source: { id, name } | null` và `has_ai_summary`;
  - `ai_summary` luôn là `null` ở danh sách và tìm kiếm;
  - ở chi tiết, `ai_summary` chỉ có giá trị khi người dùng đã mở khoá bài đó, kèm
    `ai_summary_unlocked`.
  - Bản admin giữ nguyên.
- **`feedback`:**
  - `HIDE_SOURCE` lưu thêm `sourceId`. Bài không có nguồn thì trả 400.
  - `HIDE_TOPIC` thì xoá luôn lĩnh vực đó khỏi `NewsUserInterest`.
- **`setInterests`:** lĩnh vực nào được chọn thì xoá các dòng `HIDE_TOPIC` của người
  dùng ứng với lĩnh vực đó.
- **`profile` (`GET news/me`):** thêm `hidden_topic_ids`, để app bỏ các chip lĩnh
  vực đã ẩn.
- **Hạn mức:**
  - `aiSummaryUsage(userId)` trả `{used, limit, remaining, can_use, period: 'monthly', timezone, reset_at, base_limit, peer_owned, peer_bonus_per_item, peer_bonus_limit}`,
    cùng dạng với `GET investor/ai/usage`.
  - Tháng tính từ 00:00 ngày 1 theo giờ Việt Nam (UTC+7).
- **`unlockAiSummary(userId, articleId)`:**
  - Bài phải đã xuất bản và có `aiSummary`, nếu không thì trả 404 hoặc 400.
  - Đã mở khoá bài này rồi → trả lại bản tóm tắt, `charged: false`.
  - Chưa mở khoá → chạy trong một transaction có
    `pg_advisory_xact_lock(hashtext(userId))`: đếm số lượt tháng này, hết lượt thì
    trả `BadRequestException` có `code: 'NEWS_AI_SUMMARY_LIMIT_REACHED'` (cùng kiểu
    với `AI_DAILY_LIMIT_REACHED`), còn lượt thì tạo dòng mở khoá.
  - Khoá advisory để hai lần bấm cùng lúc không vượt được hạn mức.
  - Kết quả trả về: `{article_id, ai_summary, charged, usage}`.

### Controller

- `GET  news/me/ai-summary-usage` — cần đăng nhập
- `POST news/articles/:id/ai-summary` — cần đăng nhập
- `GET  news/articles` nhận thêm `feed`

### AI biên tập gán lĩnh vực

- `createEditorialDraft` nhận danh sách lĩnh vực đang bật (`slug`, `name`).
  - Schema JSON thêm `topic_slug`; phía Gemini ràng buộc bằng `enum`, phía DeepSeek
    thì dặn trong prompt.
  - Kết quả thêm `topicSlug`. Slug không nằm trong danh sách thì thành `null`.
- `editorializeArticleById` chỉ gán `topicId` khi bài **chưa có** lĩnh vực, không
  bao giờ đè lựa chọn của admin.

### Tài liệu và cấu hình

- `.env.example`: thêm `NEWS_AI_SUMMARY_MONTHLY_LIMIT=10` và
  `NEWS_AI_SUMMARY_LIMIT_PER_PEER=5`.

## App

### Dữ liệu — `src/services/newsApi.ts` (viết lại, bỏ mock)

- Các hàm: `getTopics`, `getNewsMe`, `getArticles({feed, topic, q, page})`,
  `getArticle`, `setInterests`, `hideTopic`, `hideSource`, `getAiSummaryUsage`,
  `unlockAiSummary`.
- Mỗi hàm map dữ liệu thô sang model của app, và bọc lỗi qua `call()` theo khuôn
  `chatApi`.
- `relativeAge(iso)` trả ra "2 giờ", "1 ngày"… (thiết kế ghi không có chữ "trước").
- Xoá `newsService.ts`, `model/NewsModel.ts` và `mocks/fixtures/news.ts` (code chết).

### Màn hình

- **`NewsScreen`** (tab, viết lại):
  - header gồm tiêu đề, nút tìm kiếm và nút lĩnh vực;
  - segmented "Dành cho bạn | Tất cả"; hàng chip lĩnh vực chỉ hiện ở "Tất cả";
  - danh sách thẻ bài dùng `useInfiniteQuery`, kéo để tải lại, cuộn để tải tiếp;
  - trạng thái chưa chọn lĩnh vực;
  - menu "⋯" nổi, có lớp mờ phía sau.
- **`NewsSearchScreen`** (mới): ô tìm kiếm tự focus, có nút xoá.
  - Gọi `articles?q=` sau 300ms kể từ lần gõ cuối, cần ít nhất 2 ký tự. Dùng
    endpoint này vì nó có phân trang, có tổng số kết quả, và bỏ qua bài bị ẩn.
    `news/search` không làm được hai việc sau.
  - Dòng "N kết quả cho '…'", sau đó là danh sách dòng bài có ảnh nhỏ.
- **`NewsDetailScreen`** (mới):
  - nhãn lĩnh vực, nguồn và thời gian, tiêu đề, **thẻ AI**, ảnh, nội dung, thanh
    đáy có nút Chia sẻ;
  - thẻ AI có 5 trạng thái: chưa chạy / đang chạy / đã tóm tắt / hết lượt / đã mở
    khoá từ trước.
- **`NewsTopicsScreen`** (mới): chọn nhiều lĩnh vực, dòng "Đã chọn N lĩnh vực…",
  nút "Khám phá". Lưu xong thì quay về tab Tin tức ở "Dành cho bạn".
- Đăng ký 3 route mới trong `RootStackParamList`.

### Cache (React Query)

- Mở khoá xong → làm mới `usage` và chi tiết bài.
- Ẩn lĩnh vực hoặc nguồn → gỡ bài ra khỏi mọi trang của danh sách đang cache, rồi
  làm mới `me`.
- Lưu lĩnh vực → làm mới `me` và danh sách "Dành cho bạn".

### i18n

- Thêm khoá mới dưới `news` ở cả `vi`, `en` và `BaseLanguage`.

## Test

**API (Vitest)**

- lọc bài bị ẩn vẫn giữ bài có `topicId` hoặc `sourceId` là NULL (khoá lỗi `NOT IN`);
- `feed=for_you` chỉ lấy bài thuộc lĩnh vực quan tâm; chưa chọn lĩnh vực thì rỗng;
- `ai_summary` không lọt ra ở danh sách, tìm kiếm, hay ở chi tiết khi chưa mở khoá;
- mở khoá: lần đầu trừ lượt; lần sau `charged: false` và không tạo dòng mới; hết
  lượt thì có `code`; bài không có tóm tắt thì trả lỗi;
- hạn mức: cửa sổ tháng theo UTC+7, cộng thêm theo Peer;
- `HIDE_SOURCE` lưu `sourceId`, bài không có nguồn thì trả 400;
- `HIDE_TOPIC` xoá lĩnh vực khỏi danh sách quan tâm; chọn lại thì hết ẩn;
- AI biên tập: slug hợp lệ thì gán, không hợp lệ thì `null`, không đè lĩnh vực đã có.

**App (Jest + Testing Library)**

- map dữ liệu API và `relativeAge`;
- `NewsScreen`: chuyển tab; chip chỉ có ở "Tất cả"; trạng thái trống khi chưa có
  lĩnh vực; menu ẩn thì gọi đúng API và gỡ bài; bài không nguồn thì không có mục
  "Ẩn tin từ";
- `NewsDetailScreen`: từng trạng thái thẻ AI; hết lượt thì nút bị khoá và "Mua
  thêm Peer" mở `PeerListScreen`; bài không có tóm tắt thì ẩn thẻ;
- `NewsTopicsScreen`: chưa chọn gì thì khoá "Khám phá"; lưu gửi đúng danh sách id;
- `NewsSearchScreen`: dưới 2 ký tự thì không gọi API; dòng đếm kết quả.

## Ngoài phạm vi

- Tìm kiếm không phân biệt dấu ("bat dong san" khớp "bất động sản"): phải thêm cột
  chuẩn hoá và trigger như bên chat.
- Trang web đọc bài để chia sẻ link Mindo.
- Quản lý hoặc hoàn tác các nguồn đã ẩn.
- Gán lĩnh vực cho 217 bài cũ: admin cho biên tập lại.
- Nút thích bài: thiết kế chỉ hiện số lượt thích, không có nút.
- `GET news/home`, chuyên gia, "Sóng" (video): API vẫn giữ, app mới chưa dùng.
