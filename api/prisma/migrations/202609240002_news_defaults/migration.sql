INSERT INTO "NewsTopic" ("id", "name", "slug", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
  ('news-topic-real-estate', 'Bất động sản', 'bat-dong-san', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-topic-macro', 'Vĩ mô', 'vi-mo', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-topic-legal', 'Pháp lý', 'phap-ly', true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-topic-blockchain', 'Blockchain', 'blockchain', true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-topic-digital-assets', 'Tài sản số', 'tai-san-so', true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-topic-stocks', 'Chứng khoán', 'chung-khoan', true, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-topic-wealth', 'Quản trị tài sản', 'quan-tri-tai-san', true, 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-topic-startup', 'Khởi nghiệp', 'khoi-nghiep', true, 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-topic-personal-finance', 'Tài chính cá nhân', 'tai-chinh-ca-nhan', true, 9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-topic-industrial-property', 'Bất động sản công nghiệp', 'bat-dong-san-cong-nghiep', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-topic-energy', 'Năng lượng và môi trường', 'nang-luong-moi-truong', true, 11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "NewsExpert" ("id", "name", "slug", "specialty", "bio", "initials", "isVerified", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
  ('news-expert-bds-360', 'Bất động sản 360', 'bat-dong-san-360', 'Bất động sản & Đầu tư', 'Phân tích thị trường căn hộ và cơ hội đầu tư.', 'BĐ', true, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-expert-cashflow', 'Vốn & Dòng tiền', 'von-dong-tien', 'Tài chính cá nhân', 'Kiến thức quản lý dòng tiền rõ ràng, dễ áp dụng.', 'VD', true, true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-expert-project-legal', 'Pháp lý dự án', 'phap-ly-du-an', 'Pháp lý & Thủ tục', 'Cập nhật quy định, thủ tục và rủi ro pháp lý dự án.', 'PL', true, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-expert-digital-vn', 'Tài sản số Việt Nam', 'tai-san-so-viet-nam', 'Tài sản số', 'Thông tin thị trường tài sản số dành cho nhà đầu tư Việt.', 'TS', true, true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-expert-smart-money', 'Dòng tiền thông minh', 'dong-tien-thong-minh', 'Đầu tư & Dòng tiền', 'Phân tích xu hướng dòng tiền và quản trị rủi ro.', 'DT', true, true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('news-expert-portfolio', 'Quản trị danh mục', 'quan-tri-danh-muc', 'Quản trị tài sản', 'Xây dựng và cân bằng danh mục theo mục tiêu dài hạn.', 'QT', true, true, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
