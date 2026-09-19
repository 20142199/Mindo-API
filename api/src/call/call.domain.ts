import { CallStatus } from '@prisma/client';

export const ACTIVE_CALL_STATUSES: CallStatus[] = [CallStatus.RINGING, CallStatus.ACCEPTED];
export const TERMINAL_CALL_STATUSES: CallStatus[] = [
  CallStatus.COMPLETED,
  CallStatus.REJECTED,
  CallStatus.CANCELLED,
  CallStatus.MISSED,
  CallStatus.FAILED,
];

export const callStatusLabels: Record<CallStatus, string> = {
  [CallStatus.RINGING]: 'Đang gọi',
  [CallStatus.ACCEPTED]: 'Đang diễn ra',
  [CallStatus.COMPLETED]: 'Đã kết thúc',
  [CallStatus.REJECTED]: 'Đã từ chối',
  [CallStatus.CANCELLED]: 'Đã huỷ',
  [CallStatus.MISSED]: 'Cuộc gọi nhỡ',
  [CallStatus.FAILED]: 'Thất bại',
};

export function callDurationSeconds(acceptedAt: Date | null, endedAt: Date) {
  if (!acceptedAt) return 0;
  return Math.max(0, Math.floor((endedAt.getTime() - acceptedAt.getTime()) / 1000));
}

export function isTerminalCallStatus(status: CallStatus) {
  return TERMINAL_CALL_STATUSES.includes(status);
}
