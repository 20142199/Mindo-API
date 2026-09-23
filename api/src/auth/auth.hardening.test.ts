import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ChangePasswordDto, LoginDto, RegisterDto } from './auth.dto';
import { flattenValidationMessages } from '../common/validation-messages';

/**
 * Safety net for the auth hardening pass (2026-09-23).
 *
 * All four changes below are easy to undo by accident, because each one looks
 * either like dead code or like a missing check:
 *
 *   1. `LoginDto` deliberately carries NO password length rule. Adding
 *      `@MinLength(8)` back leaks the password policy at the login screen and
 *      tells an attacker that "too short" differs from "wrong".
 *   2. `RegisterDto` is the opposite and must keep that rule. The two DTOs no
 *      longer inherit from each other, so it is easy to change one and forget
 *      the other.
 *   3. `ChangePasswordDto` shares its field names with `ResetPasswordDto`.
 *   4. ValidationPipe messages have to come back in Vietnamese.
 */

const login = (password: string) =>
  plainToInstance(LoginDto, { email: 'an@example.com', password });

const register = (password: string) =>
  plainToInstance(RegisterDto, {
    full_name: 'Nguyễn Văn An',
    email: 'an@example.com',
    password,
    confirm_password: password,
    accept_terms: true,
  });

describe('login does not constrain password length', () => {
  it('accepts a short password so the service can answer "wrong credentials"', async () => {
    expect(await validate(login('abc'))).toHaveLength(0);
  });

  it('still requires a password to be present', async () => {
    const errors = await validate(plainToInstance(LoginDto, { email: 'an@example.com' }));

    expect(errors.some((error) => error.property === 'password')).toBe(true);
  });

  it('still validates the email format', async () => {
    const errors = await validate(plainToInstance(LoginDto, { email: 'not-an-email', password: 'abc' }));

    expect(errors.some((error) => error.property === 'email')).toBe(true);
  });
});

describe('registration keeps the password length policy', () => {
  it('rejects a password shorter than eight characters', async () => {
    const errors = await validate(register('abc'));

    expect(errors.some((error) => error.property === 'password')).toBe(true);
  });

  it('accepts a password of eight characters or more', async () => {
    expect(await validate(register('Mindo123!'))).toHaveLength(0);
  });

  it('applies a different password rule from login, on purpose', async () => {
    const short = 'abc';

    expect(await validate(login(short))).toHaveLength(0);
    expect((await validate(register(short))).length).toBeGreaterThan(0);
  });
});

describe('ChangePasswordDto matches ResetPasswordDto', () => {
  const valid = {
    old_password: 'CurrentPass1',
    new_password: 'BrandNewPass1',
    confirm_password: 'BrandNewPass1',
  };

  it('accepts all three fields', async () => {
    expect(await validate(plainToInstance(ChangePasswordDto, valid))).toHaveLength(0);
  });

  it('requires confirm_password, which the endpoint did not accept before', async () => {
    const { confirm_password, ...missing } = valid;
    const errors = await validate(plainToInstance(ChangePasswordDto, missing));

    expect(errors.some((error) => error.property === 'confirm_password')).toBe(true);
  });

  it('rejects a new password shorter than eight characters', async () => {
    const errors = await validate(
      plainToInstance(ChangePasswordDto, { ...valid, new_password: 'abc', confirm_password: 'abc' }),
    );

    expect(errors.some((error) => error.property === 'new_password')).toBe(true);
  });

  it('no longer carries a `password` field, which read like the current one', () => {
    expect('password' in new ChangePasswordDto()).toBe(false);
  });
});

describe('ValidationPipe messages are Vietnamese', () => {
  it('translates the length rule instead of leaking English', async () => {
    const messages = flattenValidationMessages(await validate(register('abc')));

    expect(messages.join(' ')).toContain('ít nhất 8 ký tự');
    expect(messages.join(' ')).not.toContain('must be longer');
  });

  it('names the field the way a user reads it, not the variable name', async () => {
    const messages = flattenValidationMessages(
      await validate(
        plainToInstance(ChangePasswordDto, { old_password: 'x', new_password: 'abc', confirm_password: 'abc' }),
      ),
    );

    expect(messages.join(' ')).toContain('Mật khẩu mới');
    expect(messages.join(' ')).not.toContain('new_password');
  });

  it('translates the email format error', async () => {
    const messages = flattenValidationMessages(
      await validate(plainToInstance(LoginDto, { email: 'not-an-email', password: 'abc' })),
    );

    expect(messages.join(' ')).toContain('không đúng định dạng');
  });

  it('leaves messages declared on the DTO untouched', async () => {
    /* `@Equals(true, { message: '...' })` on `accept_terms` is already Vietnamese. */
    const messages = flattenValidationMessages(
      await validate(
        plainToInstance(RegisterDto, {
          full_name: 'Nguyễn Văn An',
          email: 'an@example.com',
          password: 'Mindo123!',
          confirm_password: 'Mindo123!',
          accept_terms: false,
        }),
      ),
    );

    expect(messages.join(' ')).toContain('Điều khoản sử dụng');
  });
});
