import { CallStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  TERMINAL_CALL_STATUSES,
  callDurationSeconds,
  callStatusLabels,
  isRingingExpired,
  isTerminalCallStatus,
  resolveRingingTimeoutMs,
} from './call.domain';

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

/**
 * Safety net for the ringing-timeout recovery (2026-09-24).
 *
 * `initiate` schedules the BullMQ `expire-ringing-call` job inside a
 * try/catch and carries on when scheduling fails. That is the right call —
 * losing the timer should not cost the user the call — but it only holds if
 * something else can still retire a forgotten RINGING row. These rules are
 * that something else, so they must not quietly drift.
 */
describe('ringing timeout configuration', () => {
  it('falls back to 60s when the variable is absent', () => {
    expect(resolveRingingTimeoutMs(undefined)).toBe(60_000);
  });

  it('accepts a longer timeout', () => {
    expect(resolveRingingTimeoutMs('90000')).toBe(90_000);
  });

  it('refuses a timeout below the 15s floor', () => {
    expect(resolveRingingTimeoutMs('5000')).toBe(60_000);
    expect(resolveRingingTimeoutMs('0')).toBe(60_000);
    expect(resolveRingingTimeoutMs('-1')).toBe(60_000);
  });

  it('refuses a value that is not a number at all', () => {
    expect(resolveRingingTimeoutMs('soon')).toBe(60_000);
    expect(resolveRingingTimeoutMs('')).toBe(60_000);
  });
});

describe('ringing expiry', () => {
  const now = new Date('2026-09-24T10:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('expires a call that has been ringing past the timeout', () => {
    expect(isRingingExpired({ status: CallStatus.RINGING, ringingAt: ago(61_000) }, now, 60_000)).toBe(true);
  });

  it('leaves a call that is still within the timeout', () => {
    expect(isRingingExpired({ status: CallStatus.RINGING, ringingAt: ago(59_000) }, now, 60_000)).toBe(false);
  });

  it('expires exactly on the boundary', () => {
    expect(isRingingExpired({ status: CallStatus.RINGING, ringingAt: ago(60_000) }, now, 60_000)).toBe(true);
  });

  /*
    The important half. An ACCEPTED call is a conversation in progress: an
    over-eager sweep here would hang up on two people mid-sentence, which is
    far worse than the bug being fixed.
  */
  it('never touches a call that is not ringing', () => {
    const long = ago(3_600_000);
    for (const status of [CallStatus.ACCEPTED, ...TERMINAL_CALL_STATUSES]) {
      expect(isRingingExpired({ status, ringingAt: long }, now, 60_000)).toBe(false);
    }
  });
});
