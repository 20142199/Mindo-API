import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateAccountSettingsDto, UpdateProfileDto } from './account.dto';

describe('account DTOs', () => {
  it('accepts and trims the editable profile fields from Figma', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      full_name: ' Nguyễn Văn An ',
      phone_number: ' (+84) 901 234 567 ',
      address: ' Thành phố Hồ Chí Minh ',
      avatar_file_id: 'avatar-file-id',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.full_name).toBe('Nguyễn Văn An');
    expect(dto.address).toBe('Thành phố Hồ Chí Minh');
  });

  it('rejects an invalid phone number', async () => {
    const dto = plainToInstance(UpdateProfileDto, { phone_number: 'abc' });
    expect((await validate(dto)).some((error) => error.property === 'phone_number')).toBe(true);
  });

  it('accepts account preference switches and supported languages', async () => {
    const dto = plainToInstance(UpdateAccountSettingsDto, {
      language: 'vi',
      suspicious_login_alerts: true,
      login_rate_limit_enabled: true,
      in_app_notifications: true,
      email_notifications: false,
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
