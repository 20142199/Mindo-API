import { CallStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { callDurationSeconds, callStatusLabels, isTerminalCallStatus } from './call.domain';

describe('call domain', () => {
  it('calculates duration from accepted time only', () => {
    expect(callDurationSeconds(new Date('2026-09-19T01:00:00.000Z'), new Date('2026-09-19T01:02:05.900Z'))).toBe(125);
    expect(callDurationSeconds(null, new Date())).toBe(0);
  });

  it('distinguishes active and terminal states', () => {
    expect(isTerminalCallStatus(CallStatus.RINGING)).toBe(false);
    expect(isTerminalCallStatus(CallStatus.ACCEPTED)).toBe(false);
    expect(isTerminalCallStatus(CallStatus.COMPLETED)).toBe(true);
    expect(isTerminalCallStatus(CallStatus.MISSED)).toBe(true);
  });

  it('provides the Vietnamese states used by the app', () => {
    expect(callStatusLabels[CallStatus.RINGING]).toBe('Đang gọi');
    expect(callStatusLabels[CallStatus.MISSED]).toBe('Cuộc gọi nhỡ');
  });
});
