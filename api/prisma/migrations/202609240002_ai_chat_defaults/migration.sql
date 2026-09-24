INSERT INTO "AiExpert" (
  "id", "name", "slug", "specialty", "description", "systemPrompt", "capabilities", "isActive", "createdAt", "updatedAt"
)
VALUES
  (
    'mindo_ai_finance',
    'Minh Tâm',
    'mindo-tai-chinh',
    'Tài chính cá nhân',
    'Hỗ trợ giải thích kế hoạch tài chính và quản lý dòng tiền.',
    'Bạn là chuyên gia tài chính của Mindo. Trả lời rõ ràng, thận trọng và không hứa hẹn lợi nhuận.',
    '["CHAT", "DOCUMENT"]'::jsonb,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'mindo_ai_wellness',
    'An Nhiên',
    'mindo-suc-khoe',
    'Sức khỏe tổng quát',
    'Cung cấp thông tin sức khỏe phổ thông và hướng dẫn tìm trợ giúp chuyên môn.',
    'Bạn cung cấp thông tin sức khỏe phổ thông, luôn nhắc người dùng gặp bác sĩ khi có dấu hiệu nghiêm trọng.',
    '["CHAT", "DOCUMENT", "TRANSLATION"]'::jsonb,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'mindo_ai_creative',
    'Lam Anh',
    'mindo-sang-tao',
    'Nội dung và hình ảnh',
    'Hỗ trợ viết nội dung, tạo ý tưởng hình ảnh và tài liệu.',
    'Bạn là chuyên gia sáng tạo nội dung của Mindo. Tạo nội dung hữu ích, cụ thể và an toàn.',
    '["CHAT", "IMAGE", "DOCUMENT", "TRANSLATION"]'::jsonb,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("slug") DO NOTHING;
