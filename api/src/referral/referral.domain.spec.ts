import { describe, expect, it } from 'vitest';
import { isReferralCodeShape, referralCode } from './referral.domain';

/**
 * `isReferralCodeShape` là lưới chặn của một lỗ hổng thật, không phải validation
 * cho đẹp — xem chú thích của hàm. Nên bộ test này soi đúng hai chiều:
 *
 *   - mọi mã HỢP LỆ phải lọt (nếu không, người dùng thật bị chặn oan)
 *   - mọi ký tự ĐẠI DIỆN phải bị chặn (nếu không, lỗ hổng mở lại)
 */

describe('isReferralCodeShape · mã hợp lệ phải lọt', () => {
  it('mã người dùng do BE sinh ra', () => {
    /* Sinh thật chứ không chép tay: đổi bảng chữ cái trong `referralCode` mà
       quên nới hàm này thì ca đỏ ngay. */
    for (let i = 0; i < 50; i += 1) {
      expect(isReferralCodeShape(referralCode('MD'))).toBe(true);
    }
  });

  it('mã đầu nhánh hệ thống', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(isReferralCodeShape(referralCode('SYS'))).toBe(true);
    }
  });

  it('mã đại lý dạng DL + base36 viết hoa', () => {
    expect(isReferralCodeShape(`DL${Date.now().toString(36).toUpperCase()}427`)).toBe(true);
  });

  it('cuid của DỮ LIỆU CŨ vẫn phải lọt', () => {
    /* Tài khoản tạo trước khi BE đổi sang mã `MD…` mang cuid làm mã giới thiệu.
       Chặn nhầm nhóm này là cắt hoa hồng của người dùng thật. */
    expect(isReferralCodeShape('cmud2sray0001p6sw4yj9l530')).toBe(true);
  });

  it('không phân biệt hoa thường — BE tra không phân biệt thì đây cũng vậy', () => {
    expect(isReferralCodeShape('MDWBRMZK8X')).toBe(true);
    expect(isReferralCodeShape('mdwbrmzk8x')).toBe(true);
    expect(isReferralCodeShape('MdWbRmZk8X')).toBe(true);
  });
});

describe('isReferralCodeShape · ký tự đại diện phải bị chặn', () => {
  /*
    Đây là phần đáng giá. `%` đứng một mình từng đăng ký THÀNH CÔNG trên API
    thật và gắn người đăng ký vào nhánh của một tài khoản xa lạ.
  */
  it('MỘT dấu phần trăm — đúng chuỗi đã khai thác được', () => {
    expect(isReferralCodeShape('%')).toBe(false);
  });

  it('gạch dưới là ký tự đại diện MỘT KÝ TỰ của ILIKE, cũng phải chặn', () => {
    expect(isReferralCodeShape('_')).toBe(false);
    expect(isReferralCodeShape('MDWBRMZK8_')).toBe(false);
  });

  it('ký tự đại diện lẫn trong mã trông có vẻ thật', () => {
    expect(isReferralCodeShape('MD%')).toBe(false);
    expect(isReferralCodeShape('%MDWBRMZK8X%')).toBe(false);
    expect(isReferralCodeShape('cmud2sray%')).toBe(false);
  });

  it('chuỗi rỗng và khoảng trắng', () => {
    expect(isReferralCodeShape('')).toBe(false);
    expect(isReferralCodeShape(' ')).toBe(false);
    expect(isReferralCodeShape('MD WBRMZK8X')).toBe(false);
  });

  it('các ký tự lạ khác — dấu nháy, gạch chéo ngược, xuống dòng', () => {
    expect(isReferralCodeShape("MD'")).toBe(false);
    expect(isReferralCodeShape('MD\\')).toBe(false);
    expect(isReferralCodeShape('MD\nWBRMZK8X')).toBe(false);
  });

  it('chuỗi quá dài bị chặn — không để ai bắt CSDL quét chuỗi khổng lồ', () => {
    expect(isReferralCodeShape('A'.repeat(64))).toBe(true);
    expect(isReferralCodeShape('A'.repeat(65))).toBe(false);
  });
});
