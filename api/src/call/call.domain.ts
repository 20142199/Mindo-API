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

/**
 * Giới hạn đổ chuông, đọc từ `CALL_RINGING_TIMEOUT_MS`.
 *
 * Sàn 15 giây là để chặn cấu hình sai chứ không phải sở thích: dưới mức đó,
 * một lần mạng chậm bình thường cũng đủ khiến cuộc gọi bị đánh dấu nhỡ trước
 * khi người nhận kịp thấy màn hình đổ chuông.
 */
export const DEFAULT_RINGING_TIMEOUT_MS = 60_000;
export const MIN_RINGING_TIMEOUT_MS = 15_000;

export function resolveRingingTimeoutMs(raw: string | undefined) {
  const value = Number(raw ?? DEFAULT_RINGING_TIMEOUT_MS);
  return Number.isFinite(value) && value >= MIN_RINGING_TIMEOUT_MS ? value : DEFAULT_RINGING_TIMEOUT_MS;
}

/**
 * Cuộc gọi này đã đổ chuông quá hạn chưa?
 *
 * Tách ra khỏi service vì đây là LƯỚI AN TOÀN cho job BullMQ
 * `expire-ringing-call`, và một lưới an toàn thì phải tự kiểm chứng được.
 *
 * Vì sao cần lưới: `initiate` đặt job hẹn giờ trong `try/catch` rồi **đi
 * tiếp** nếu đặt hỏng. Redis chết đúng lúc đó thì không còn gì chuyển cuộc
 * gọi sang `MISSED` — người gọi ngồi nhìn màn "Đang gọi" vĩnh viễn, và tệ hơn
 * là cả hai bên kẹt luôn ở trạng thái "đang bận" nên không gọi được cho ai
 * nữa. `incoming`/`active` có quét, nhưng `get` — thứ duy nhất màn gọi hỏi —
 * thì không.
 *
 * Mốc so sánh là `ringingAt`, không phải `createdAt`: hai cột này bằng nhau
 * lúc tạo, nhưng `ringingAt` mới là thứ mang nghĩa "bắt đầu đổ chuông".
 */
export function isRingingExpired(
  call: { status: CallStatus; ringingAt: Date },
  now: Date,
  timeoutMs: number,
) {
  if (call.status !== CallStatus.RINGING) return false;
  return call.ringingAt.getTime() <= now.getTime() - timeoutMs;
}
