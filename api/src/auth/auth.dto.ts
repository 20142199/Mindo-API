import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trimText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Fields shared by login and registration, WITHOUT `password`.
 *
 * The two flows enforce different password rules, so each declares that field
 * itself: registration requires at least 8 characters, login does not — see
 * `LoginDto`.
 */
class AuthBaseDto {
  @Transform(normalizeEmail) @IsEmail() email!: string;
  @IsOptional() @IsBoolean() remember_me?: boolean;
  @IsOptional() @IsString() fcm_token?: string;
  @IsOptional() @IsString() device_info?: string;
  @IsOptional() @IsIn(['mobile', 'desktop', 'tablet', 'unknown']) device_type?: string;
  @IsOptional() @IsString() device_location?: string;
}

/*
  NO length rule on the password here. Enforcing one at login would:
    - leak the password policy to people without an account;
    - tell an attacker that "too short" differs from "wrong", narrowing the
      search space;
    - surface ValidationPipe's raw text instead of our own message.
  Every wrong password, whatever its length, returns the same "Email hoặc mật
  khẩu không đúng". The length policy applies to REGISTRATION and PASSWORD
  CHANGE.
*/
export class LoginDto extends AuthBaseDto {
  @IsString() password!: string;
}

export class RegisterDto extends AuthBaseDto {
  /* Registration is where the length policy has to hold. */
  @IsString() @MinLength(8) password!: string;
  @Transform(trimText) @IsString() @MinLength(2) full_name!: string;
  @IsString() @MinLength(8) confirm_password!: string;
  @IsBoolean() @Equals(true, { message: 'Bạn cần đồng ý Điều khoản sử dụng và Chính sách bảo mật' }) accept_terms!: boolean;
  @IsOptional() @Transform(trimText) @IsString() @MinLength(2) nickname?: string;
  @IsOptional() @Transform(trimText) @IsString() ref_by?: string;
}

export class EmailDto {
  @Transform(normalizeEmail) @IsEmail() email!: string;
}

export class VerifyOtpDto extends EmailDto {
  @IsString() @Length(6, 6) @Matches(/^\d{6}$/, { message: 'OTP phải gồm đúng 6 chữ số' }) otp!: string;
}

export class ResetPasswordDto {
  @IsString() reset_token!: string;
  @IsString() @MinLength(8) new_password!: string;
  @IsString() @MinLength(8) confirm_password!: string;
}

/* Same field names as `ResetPasswordDto`: two endpoints that both set a new
   password should call it the same thing. The new-password field used to be
   named `password`, which read like the current one. */
export class ChangePasswordDto {
  @IsString() old_password!: string;
  @IsString() @MinLength(8) new_password!: string;
  @IsString() @MinLength(8) confirm_password!: string;
}

export class RefreshDto {
  @IsString() refresh_token!: string;
  @IsOptional() @IsString() access_token?: string;
}
