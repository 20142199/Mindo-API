/**
 * Tuỳ chọn tạo ảnh: phong cách, tỷ lệ, tiêu đề ngắn.
 *
 * Để thành hàm thuần vì ba nơi cùng dùng: DTO kiểm giá trị, `AiService` lưu
 * vào metadata, `AiProviderService` dịch sang tham số của từng nhà cung cấp.
 * Ba nơi mà mỗi nơi tự khai danh sách thì sớm muộn sẽ lệch nhau.
 */
export const AI_IMAGE_STYLES = ['AUTO', 'NATURAL', 'THREE_D', 'ILLUSTRATION'] as const;
export type AiImageStyle = (typeof AI_IMAGE_STYLES)[number];

export const AI_ASPECT_RATIOS = ['1:1', '4:3', '9:16'] as const;
export type AiAspectRatio = (typeof AI_ASPECT_RATIOS)[number];

export const DEFAULT_IMAGE_STYLE: AiImageStyle = 'AUTO';
export const DEFAULT_ASPECT_RATIO: AiAspectRatio = '1:1';

/* Bội số của 64: cỡ mà các model khuếch tán nhận mà không tự cắt xén */
const DIMENSIONS: Record<AiAspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1024, height: 768 },
  '9:16': { width: 768, height: 1344 },
};

/*
  Chỉ dẫn bằng tiếng Anh dù mô tả là tiếng Việt: model ảnh làm theo chỉ dẫn
  phong cách tiếng Anh ổn định hơn hẳn. Nằm ở server để đổi câu chữ mà không
  phải phát hành lại app.
*/
const STYLE_HINTS: Record<AiImageStyle, string | null> = {
  AUTO: null,
  NATURAL: 'Style: natural photograph, realistic lighting and textures.',
  THREE_D: 'Style: 3D render, soft studio lighting, smooth materials, high detail.',
  ILLUSTRATION: 'Style: flat digital illustration, clean lines, simple shapes.',
};

const TITLE_MAX = 60;

export const isImageStyle = (value: unknown): value is AiImageStyle =>
  typeof value === 'string' && (AI_IMAGE_STYLES as readonly string[]).includes(value);

export const isAspectRatio = (value: unknown): value is AiAspectRatio =>
  typeof value === 'string' && (AI_ASPECT_RATIOS as readonly string[]).includes(value);

/** Phiên ảnh cũ không có metadata này — lùi về mặc định chứ không ném */
export const imageStyleOf = (value: unknown): AiImageStyle => (isImageStyle(value) ? value : DEFAULT_IMAGE_STYLE);

export const aspectRatioOf = (value: unknown): AiAspectRatio => (isAspectRatio(value) ? value : DEFAULT_ASPECT_RATIO);

export const imageDimensions = (ratio: AiAspectRatio) => DIMENSIONS[ratio];

export function styledPrompt(prompt: string, style: AiImageStyle): string {
  const hint = STYLE_HINTS[style];
  return hint ? `${prompt.trim()}\n\n${hint}` : prompt.trim();
}

/**
 * Dọn câu trả lời của model thành một tiêu đề.
 *
 * Model hay "trang trí": bọc ngoặc kép, thêm dấu chấm, hoặc giải thích thêm
 * một dòng. Dài quá thì trả `null` chứ không cắt ngang — cắt giữa chữ trông
 * còn tệ hơn mô tả cắt ngắn mà hệ thống đang có sẵn.
 */
export function sanitizeTitle(raw: string | null | undefined): string | null {
  const firstLine = (raw ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  const clean = firstLine
    .replace(/^["'“”«»*#\-\s]+/, '')
    .replace(/["'“”«»*.\s]+$/, '')
    .trim();
  if (!clean || clean.length > TITLE_MAX) return null;
  return clean;
}
