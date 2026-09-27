-- Tên gợi nhớ do người dùng tự đặt cho một người bạn.
--
-- Đặt trên "Friendship" chứ không trên "User": `nickname` trong "User" là tên
-- do CHÍNH chủ tài khoản đặt cho mình, ai nhìn cũng thấy như nhau. Còn cột này
-- là tên riêng của một phía — A gọi B là "Sếp" thì B không hề biết, và hàng
-- B→A vẫn trống.
--
-- Nullable: chưa đặt thì để null, app rơi về nickname rồi mới tới họ tên. Xoá
-- tên gợi nhớ cũng là ghi null chứ không phải chuỗi rỗng.
ALTER TABLE "Friendship" ADD COLUMN "alias" TEXT;
