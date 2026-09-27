import { describe, expect, it } from 'vitest';
import { searchKey } from './chat.domain';

/**
 * Chuẩn hoá từ khoá tìm kiếm — bỏ dấu, hạ chữ thường (2026-09-27).
 *
 * Hàm này PHẢI cho ra đúng cùng một chuỗi với `mindo_search_key()` bên
 * Postgres (migration `202609270002_search_normalized`): hàm TS chuẩn hoá TỪ
 * KHOÁ, hàm SQL chuẩn hoá DỮ LIỆU, rồi hai chuỗi được so thẳng với nhau bằng
 * `LIKE`. Lệch một ký tự là tìm không ra, và không có gì báo.
 *
 * Mọi giá trị mong đợi dưới đây lấy từ chính Postgres:
 *
 *     SELECT mindo_search_key('Đầu tư dài hạn');  -- dau tu dai han
 *
 * Bản đầu dùng `unaccent` bên SQL và trượt đúng kiểu này: `unaccent` phiên âm
 * cả dấu câu — gạch dài `–` thành `-` — còn `normalize('NFD')` bên JS thì
 * không đụng tới. Nay cả hai phía cùng dùng NFD nên khớp theo bảng Unicode,
 * không theo một bảng phiên âm riêng của Postgres.
 */

describe('bỏ dấu tiếng Việt', () => {
  it.each([
    ['Đầu tư dài hạn', 'dau tu dai han'],
    ['Nguyễn Hồng Sơn', 'nguyen hong son'],
    ['Cường Đỗ', 'cuong do'],
    ['Hoàng Yến Oanh Ửng', 'hoang yen oanh ung'],
    ['Quỹ ETF – Việt Nam', 'quy etf – viet nam'],
  ])('%s -> %s', (input, expected) => {
    expect(searchKey(input)).toBe(expected);
  });

  /*
    `đ` là một KÝ TỰ RIÊNG, không phải `d` cộng dấu, nên NFD không tách nó ra.
    Thiếu bước đổi tay thì gõ "dau tu" ra kết quả còn gõ "đầu tư" thì không —
    đúng nửa yêu cầu, và nửa hỏng là nửa khó nhận ra hơn.
  */
  it('đổi được cả đ thường lẫn Đ hoa', () => {
    expect(searchKey('đình đám ĐÌNH ĐÁM')).toBe('dinh dam dinh dam');
  });
});

describe('hai chiều đều ra cùng một khoá', () => {
  /* Đây chính là yêu cầu: gõ có dấu hay không dấu đều phải ra. Cách duy nhất
     để điều đó đúng là cả hai cùng quy về một chuỗi. */
  it.each([
    ['Đầu tư', 'dau tu'],
    ['ĐẦU TƯ', 'dau tu'],
    ['đầu tư', 'dau tu'],
    ['Dau Tu', 'dau tu'],
    ['dau tu', 'dau tu'],
  ])('%s -> %s', (input, expected) => {
    expect(searchKey(input)).toBe(expected);
  });
});

describe('không phải tiếng Việt cũng phải khớp Postgres', () => {
  it.each([
    ['Café München Ångström', 'cafe munchen angstrom'],
    ['naïve résumé', 'naive resume'],
    /* `Ł` không tách được bằng NFD nên GIỮ NGUYÊN — Postgres cũng vậy. Khớp
       nhau mới là điều cần, không phải bỏ được mọi dấu trên đời. */
    ['ÖZTÜRK Łukasz', 'ozturk łukasz'],
  ])('%s -> %s', (input, expected) => {
    expect(searchKey(input)).toBe(expected);
  });
});

describe('mép', () => {
  it('cắt khoảng trắng hai đầu', () => {
    expect(searchKey('  Anna  ')).toBe('anna');
  });

  it('chuỗi rỗng không nổ', () => {
    expect(searchKey('')).toBe('');
  });

  it('giữ nguyên khoảng trắng giữa các từ', () => {
    expect(searchKey('Đầu  tư')).toBe('dau  tu');
  });
});
