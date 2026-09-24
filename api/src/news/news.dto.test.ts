import 'reflect-metadata';
import { NewsContentType, NewsFeedbackType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ListNewsDto, NewsFeedbackDto, SaveNewsArticleDto, SetNewsInterestsDto } from './news.dto';

describe('news DTOs', () => {
  it('transforms and validates article pagination', async () => {
    const dto = plainToInstance(ListNewsDto, { page: '2', limit: '15', type: NewsContentType.ARTICLE });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(15);
  });

  it('rejects invalid news article URLs and short content', async () => {
    const dto = plainToInstance(SaveNewsArticleDto, { title: 'Tin Mindo', slug: 'tin-mindo', summary: 'Mô tả', content: 'Quá ngắn', image_url: ':// đường dẫn lỗi' });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['content', 'image_url']));
  });

  it('accepts the three feedback actions used by the app menu', async () => {
    for (const type of [NewsFeedbackType.NOT_INTERESTED, NewsFeedbackType.HIDE_TOPIC, NewsFeedbackType.REPORT]) {
      expect(await validate(plainToInstance(NewsFeedbackDto, { type, reason: 'Nội dung không phù hợp' }))).toHaveLength(0);
    }
  });

  it('limits the number of selected interests', async () => {
    const dto = plainToInstance(SetNewsInterestsDto, { topic_ids: Array.from({ length: 21 }, (_, index) => `topic-${index}`) });
    expect((await validate(dto)).some((error) => error.property === 'topic_ids')).toBe(true);
  });
});
