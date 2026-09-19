import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RegisterDto, ResetPasswordDto, VerifyOtpDto } from './auth.dto';

describe('app authentication DTOs', () => {
  it('accepts the registration fields present in the Figma app form without a nickname', async () => {
    const dto = plainToInstance(RegisterDto, {
      full_name: ' Nguyễn Văn An ',
      email: ' AN@Example.com ',
      password: 'Mindo123!',
      confirm_password: 'Mindo123!',
      accept_terms: true,
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.full_name).toBe('Nguyễn Văn An');
    expect(dto.email).toBe('an@example.com');
  });

  it('requires terms acceptance during registration', async () => {
    const dto = plainToInstance(RegisterDto, {
      full_name: 'Nguyễn Văn An',
      email: 'an@example.com',
      password: 'Mindo123!',
      confirm_password: 'Mindo123!',
      accept_terms: false,
    });

    expect((await validate(dto)).some((error) => error.property === 'accept_terms')).toBe(true);
  });

  it('only accepts a six-digit OTP', async () => {
    const dto = plainToInstance(VerifyOtpDto, { email: 'an@example.com', otp: '12A456' });

    expect((await validate(dto)).some((error) => error.property === 'otp')).toBe(true);
  });

  it('accepts the reset-token form used by the final password screen', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      reset_token: 'one-time-token',
      new_password: 'Mindo456!',
      confirm_password: 'Mindo456!',
    });

    expect(await validate(dto)).toHaveLength(0);
  });
});
