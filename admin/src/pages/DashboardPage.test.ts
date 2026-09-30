import { describe, expect, it } from 'vitest';
import { statusDisplay } from '../status';

describe('statusDisplay', () => {
  it('uses a danger treatment for failed internal transactions', () => {
    expect(statusDisplay('FAILED')).toEqual({ label: 'Cần kiểm tra', tone: 'danger' });
  });

  it('uses a warning treatment for pending reviews', () => {
    expect(statusDisplay('PENDING')).toEqual({ label: 'Chờ duyệt', tone: 'warning' });
  });

  it('labels a cancelled deposit or order instead of showing the raw enum in green', () => {
    expect(statusDisplay('CANCELLED')).toEqual({ label: 'Đã huỷ', tone: 'danger' });
  });
});
