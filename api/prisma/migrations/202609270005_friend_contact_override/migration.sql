-- Số điện thoại và email RIÊNG mình ghi cho một người bạn — Figma 978:5979.
--
-- Bộ thứ ba theo cùng một khuôn, sau `alias` (tên) và `avatarFileId` (ảnh),
-- và cùng một lý do: hồ sơ là của NGƯỜI KIA. Số họ khai trong tài khoản Mindo
-- có thể trống, hoặc không phải số mình hay gọi. Cuốn danh bạ của tôi thì
-- ghi theo cách tôi biết về họ.
--
-- Một chiều, chỉ mình chủ hàng thấy.
--
-- Không ràng buộc định dạng: đây là ô ghi chú cá nhân, người ta viết
-- "0901 234 567 (nhà)" hay "anna@congty.vn — email cũ" đều hợp lệ với họ.
-- Số dùng để TÌM tài khoản lúc kết bạn vẫn là `User.phoneNormalized`, không
-- liên quan gì tới hai cột này.
--
-- Cuộc gọi cũng không đụng tới đây: `startCall` đi bằng `userId` qua hạ tầng
-- gọi của Mindo, không quay số.
ALTER TABLE "Friendship"
  ADD COLUMN "aliasPhone" TEXT,
  ADD COLUMN "aliasEmail" TEXT;
