-- Tìm kiếm bỏ dấu: gõ "dau tu" phải ra "Đầu tư dài hạn", và gõ "Đầu tư" cũng vậy.
--
-- Cách làm: mỗi cột tên có một cột song song đã bỏ dấu và hạ chữ thường, rồi
-- tìm trên cột đó. Câu truy vấn vì thế vẫn là `LIKE` thường, Prisma diễn đạt
-- được, không phải rơi xuống SQL thô.
--
-- Vì sao TRIGGER chứ không phải cập nhật trong code ứng dụng: tên người và
-- tên nhóm bị ghi từ nhiều chỗ (đăng ký, sửa hồ sơ, admin sửa tài khoản, tạo
-- nhóm, đổi tên nhóm). Bỏ sót một chỗ thì cột lệch âm thầm — không lỗi,
-- không test nào đỏ, chỉ là một cái tên tìm không ra. Trigger thì mọi đường
-- ghi đều đi qua.
--
-- Vì sao TRIGGER chứ không phải GENERATED ALWAYS: cột sinh tự động khiến
-- schema.prisma và CSDL lệch nhau về kiểu cột, và một lần `prisma migrate dev`
-- sau này có thể sinh ra migration đòi bỏ nó đi.

-- Đánh số 0003 chứ không phải 0002: migration `202609270002_friend_alias` của
-- người khác tạo ra cột `Friendship.alias`, mà migration này thêm cột bỏ dấu
-- đi kèm nó. Hai migration cùng số thì thứ tự chạy chỉ còn phụ thuộc vào so
-- chuỗi tên thư mục — đúng được là may, không phải là bảo đảm.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Vì sao KHÔNG dùng `unaccent`:
--
-- Nó chạy đúng cho tiếng Việt, kể cả `Đ` -> `D`. Nhưng nó còn phiên âm cả
-- dấu câu — gạch dài `–` thành `-` chẳng hạn — mà bản JavaScript chuẩn hoá
-- TỪ KHOÁ phía app thì không. Hai bên lệch nhau đúng một ký tự là tìm không
-- ra, và không có gì báo.
--
-- Cùng một phép biến đổi viết hai lần ở hai ngôn ngữ là chuyện phải chấp
-- nhận (cột nằm ở CSDL, ô tìm kiếm nằm ở app), nên chọn phép nào DIỄN ĐẠT
-- ĐƯỢC GIỐNG HỆT ở cả hai. NFD rồi xoá ký tự tổ hợp là phép đó:
-- `String.prototype.normalize('NFD')` bên JS và `normalize(x, NFD)` bên
-- Postgres cho ra cùng một kết quả, vì cùng theo bảng Unicode.
--
-- `đ`/`Đ` phải đổi tay ở cả hai phía: nó là ký tự riêng chứ không phải `d`
-- cộng dấu, nên NFD không đụng tới.
--
-- Xem `searchKey()` trong `src/chat/chat.domain.ts` — sửa một bên thì phải
-- sửa cả bên kia, và `chat.search-key.test.ts` khoá sự tương đương đó.
CREATE OR REPLACE FUNCTION mindo_search_key(value text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS
$$ SELECT lower(translate(regexp_replace(normalize(value, NFD), U&'[\0300-\036F]', '', 'g'), 'đĐ', 'dD')) $$;

ALTER TABLE "User"
  ADD COLUMN "fullNameNormalized" TEXT,
  ADD COLUMN "nicknameNormalized" TEXT;

ALTER TABLE "Conversation" ADD COLUMN "titleNormalized" TEXT;

-- `alias` là tên người dùng tự đặt cho bạn mình, và nó nằm cùng một ô tìm
-- kiếm với họ tên. Bỏ sót nó thì trong cùng một ô, gõ "Bảo" ra mà "Bao" lại
-- không — kiểu không nhất quán khó chịu hơn là không có tính năng.
ALTER TABLE "Friendship" ADD COLUMN "aliasNormalized" TEXT;

CREATE OR REPLACE FUNCTION mindo_user_search_sync() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  NEW."fullNameNormalized" := mindo_search_key(NEW."fullName");
  NEW."nicknameNormalized" := mindo_search_key(NEW."nickname");
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mindo_conversation_search_sync() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  NEW."titleNormalized" := mindo_search_key(NEW."title");
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_search_sync
  BEFORE INSERT OR UPDATE OF "fullName", "nickname" ON "User"
  FOR EACH ROW EXECUTE FUNCTION mindo_user_search_sync();

CREATE OR REPLACE FUNCTION mindo_friendship_search_sync() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  NEW."aliasNormalized" := mindo_search_key(NEW."alias");
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversation_search_sync
  BEFORE INSERT OR UPDATE OF "title" ON "Conversation"
  FOR EACH ROW EXECUTE FUNCTION mindo_conversation_search_sync();

CREATE TRIGGER friendship_search_sync
  BEFORE INSERT OR UPDATE OF "alias" ON "Friendship"
  FOR EACH ROW EXECUTE FUNCTION mindo_friendship_search_sync();

-- Nạp cho dữ liệu đã có.
UPDATE "User" SET
  "fullNameNormalized" = mindo_search_key("fullName"),
  "nicknameNormalized" = mindo_search_key("nickname");
UPDATE "Conversation" SET "titleNormalized" = mindo_search_key("title");
UPDATE "Friendship" SET "aliasNormalized" = mindo_search_key("alias");

-- `LIKE '%x%'` không dùng được index btree. GIN trigram thì dùng được, và đó
-- là khác biệt so với mệnh đề `ILIKE` vừa gỡ khỏi phần tìm nội dung tin nhắn
-- — chỗ đó quét bảng, chỗ này không.
CREATE INDEX "User_fullNameNormalized_trgm_idx" ON "User" USING GIN ("fullNameNormalized" gin_trgm_ops);
CREATE INDEX "User_nicknameNormalized_trgm_idx" ON "User" USING GIN ("nicknameNormalized" gin_trgm_ops);
CREATE INDEX "Conversation_titleNormalized_trgm_idx" ON "Conversation" USING GIN ("titleNormalized" gin_trgm_ops);
CREATE INDEX "Friendship_aliasNormalized_trgm_idx" ON "Friendship" USING GIN ("aliasNormalized" gin_trgm_ops);
