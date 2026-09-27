import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAiMessageDto } from './phase2.dto';

const errorsOf = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(CreateAiMessageDto, body))).map((error) => error.property);

describe('CreateAiMessageDto — tuỳ chọn ảnh', () => {
  it('nhận đủ phong cách và tỷ lệ hợp lệ', async () => {
    expect(await errorsOf({ content: 'mèo', kind: 'IMAGE', image_style: 'THREE_D', aspect_ratio: '9:16' })).toEqual([]);
  });

  it('hai trường là tuỳ chọn — client cũ không gửi vẫn qua', async () => {
    expect(await errorsOf({ content: 'mèo', kind: 'IMAGE' })).toEqual([]);
  });

  it('từ chối giá trị ngoài danh sách', async () => {
    expect(await errorsOf({ content: 'mèo', image_style: 'VAN_GOGH', aspect_ratio: '21:9' }))
      .toEqual(expect.arrayContaining(['image_style', 'aspect_ratio']));
  });
});
