import { ValidationError } from '@nestjs/common';

/**
 * Translate `class-validator`'s built-in messages into Vietnamese.
 *
 * They default to English ("password must be longer than or equal to 8
 * characters") and would reach Vietnamese users verbatim. The app cannot
 * translate them either, because it has no way to tell which sentence belongs
 * to which rule.
 *
 * Messages declared on the DTOs themselves (`@Equals(..., { message: '...' })`,
 * `@Matches(..., { message: '...' })`) are already Vietnamese, and
 * `class-validator` puts them in `constraints` like any other rule. We tell
 * them apart by translating only the constraint keys we know; an unknown key
 * keeps whatever sentence it already carries.
 */

/** DTO field name -> how a user would read it */
const TEN_TRUONG: Record<string, string> = {
  email: 'Email',
  password: 'Mật khẩu',
  new_password: 'Mật khẩu mới',
  old_password: 'Mật khẩu hiện tại',
  confirm_password: 'Xác nhận mật khẩu',
  full_name: 'Họ và tên',
  nickname: 'Biệt danh',
  otp: 'Mã xác thực',
  reset_token: 'Phiên đặt lại mật khẩu',
  refresh_token: 'Phiên đăng nhập',
  accept_terms: 'Điều khoản sử dụng',
};

const goiLa = (property: string) => TEN_TRUONG[property] ?? property;

/**
 * Build the Vietnamese sentence for one constraint.
 *
 * `undefined` means the constraint is not recognised — the caller keeps the
 * original sentence, usually the Vietnamese one declared on the DTO.
 */
function dich(key: string, property: string, args: unknown[]): string | undefined {
  const ten = goiLa(property);
  switch (key) {
    case 'isNotEmpty':
    case 'isDefined':
      return `${ten} không được để trống`;
    case 'isEmail':
      return `${ten} không đúng định dạng`;
    case 'isString':
      return `${ten} phải là chuỗi ký tự`;
    case 'isBoolean':
      return `${ten} phải là true hoặc false`;
    case 'isInt':
    case 'isNumber':
      return `${ten} phải là số`;
    case 'minLength':
      return `${ten} phải có ít nhất ${args[0]} ký tự`;
    case 'maxLength':
      return `${ten} không được quá ${args[0]} ký tự`;
    case 'isLength':
      return `${ten} phải có đúng ${args[0]} ký tự`;
    case 'min':
      return `${ten} phải từ ${args[0]} trở lên`;
    case 'max':
      return `${ten} không được quá ${args[0]}`;
    case 'isIn':
      return `${ten} không nằm trong danh sách cho phép`;
    case 'whitelistValidation':
      return `Trường ${property} không được chấp nhận`;
    default:
      return undefined;
  }
}

/**
 * Flatten ValidationPipe's error tree into a list of Vietnamese sentences.
 *
 * `class-validator` nests errors under `children` for objects and arrays, so
 * this recurses; nested field names are joined with dots so the offending
 * field stays traceable.
 */
export function flattenValidationMessages(
  errors: ValidationError[],
  prefix = '',
): string[] {
  const out: string[] = [];

  for (const error of errors) {
    const property = prefix ? `${prefix}.${error.property}` : error.property;

    for (const [key, cauGoc] of Object.entries(error.constraints ?? {})) {
      /* `contexts` would hold the rule's argument (the 8 of `@MinLength(8)`).
         Without it, read the number back out of the original sentence —
         class-validator always embeds it. */
      const soTrongCau = String(cauGoc).match(/\d+/);
      const args = soTrongCau ? [soTrongCau[0]] : [];
      out.push(dich(key, error.property, args) ?? cauGoc);
    }

    if (error.children?.length) {
      out.push(...flattenValidationMessages(error.children, property));
    }
  }

  return out;
}

export default flattenValidationMessages;
