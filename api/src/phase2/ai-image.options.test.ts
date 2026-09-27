import { describe, expect, it } from 'vitest';
import {
  aspectRatioOf, imageDimensions, imageStyleOf, sanitizeTitle, styledPrompt,
} from './ai-image.options';

describe('tuỳ chọn tạo ảnh', () => {
  it('mỗi tỷ lệ ra đúng khung, cạnh là bội số của 64', () => {
    expect(imageDimensions('1:1')).toEqual({ width: 1024, height: 1024 });
    expect(imageDimensions('4:3')).toEqual({ width: 1024, height: 768 });
    expect(imageDimensions('9:16')).toEqual({ width: 768, height: 1344 });
  });

  it('giá trị lạ hoặc thiếu lùi về mặc định, không ném', () => {
    /* metadata của phiên ảnh cũ không có hai trường này */
    expect(imageStyleOf(undefined)).toBe('AUTO');
    expect(imageStyleOf('VAN_GOGH')).toBe('AUTO');
    expect(aspectRatioOf(undefined)).toBe('1:1');
    expect(aspectRatioOf('21:9')).toBe('1:1');
    expect(imageStyleOf('THREE_D')).toBe('THREE_D');
    expect(aspectRatioOf('9:16')).toBe('9:16');
  });

  it('AUTO giữ nguyên mô tả; phong cách khác nối thêm chỉ dẫn', () => {
    expect(styledPrompt('  mèo đen  ', 'AUTO')).toBe('mèo đen');
    const styled = styledPrompt('mèo đen', 'THREE_D');
    expect(styled.startsWith('mèo đen')).toBe(true);
    expect(styled).toContain('3D render');
  });

  it('tiêu đề: bỏ ngoặc, dấu chấm, chỉ lấy dòng đầu', () => {
    expect(sanitizeTitle('"Robot Mindo 3D".')).toBe('Robot Mindo 3D');
    expect(sanitizeTitle('“Mèo cao bồi”')).toBe('Mèo cao bồi');
    expect(sanitizeTitle('\n  Quán cà phê Hà Nội\nGiải thích: ...')).toBe('Quán cà phê Hà Nội');
  });

  it('tiêu đề rỗng hoặc dài quá thì trả null để lùi về mô tả cắt ngắn', () => {
    expect(sanitizeTitle('')).toBeNull();
    expect(sanitizeTitle(null)).toBeNull();
    expect(sanitizeTitle('"".')).toBeNull();
    expect(sanitizeTitle('a'.repeat(61))).toBeNull();
  });
});
