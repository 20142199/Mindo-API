import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

const trimText = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export enum FriendRequestDirection {
  INCOMING = "incoming",
  OUTGOING = "outgoing",
}

export class SendFriendRequestDto {
  @Transform(trimText)
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;
}

/**
 * Đặt / xoá tên gợi nhớ cho một người bạn.
 *
 * Cho phép chuỗi RỖNG, và đó là cách xoá: người dùng xoá trắng ô nhập rồi lưu.
 * Service quy nó về null để cột không lẫn hai thứ "chưa đặt" và "đặt rồi xoá".
 *
 * 50 ký tự: đủ cho một cái tên có dấu, và vẫn vừa một dòng trên máy hẹp nhất.
 */
export class UpdateFriendAliasDto {
  @Transform(trimText)
  @IsString()
  @MaxLength(50)
  alias!: string;

  /*
    Ô ghi chú cá nhân, KHÔNG kiểm định dạng: "0901 234 567 (nhà)" hay
    "anna@congty.vn — email cũ" đều là thứ người ta thật sự viết vào danh bạ.
    Số dùng để TÌM tài khoản lúc kết bạn là `User.phoneNormalized`, không
    liên quan gì tới hai ô này.

    Vắng mặt = không đổi; chuỗi rỗng = xoá.
  */
  @IsOptional() @Transform(trimText) @IsString() @MaxLength(32)
  alias_phone?: string;

  @IsOptional() @Transform(trimText) @IsString() @MaxLength(120)
  alias_email?: string;
}

/**
 * Gán / xoá ảnh riêng mình đặt cho một người bạn.
 *
 * `null` là XOÁ — trở về ảnh hồ sơ của họ (Figma 978:6072 "Xoá ảnh hiện
 * tại"). Khác với `alias` dùng chuỗi rỗng để xoá: chuỗi rỗng không phải một
 * id tệp hợp lệ, nên ở đây `null` nói rõ ý hơn.
 *
 * Tệp phải do CHÍNH người gọi tải lên; service kiểm bằng `assertOwned`.
 */
export class UpdateFriendAvatarDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  avatar_file_id!: string | null;
}

export class FriendListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @Transform(trimText) @IsString() @MaxLength(100) q?: string;
}

export class FriendRequestQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional()
  @IsEnum(FriendRequestDirection)
  direction?: FriendRequestDirection;
}
