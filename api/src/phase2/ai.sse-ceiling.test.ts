import { AiMessageStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgencyService } from './agency.service';
import { AiService } from './ai.service';
import { AuthenticatedRequest } from '../auth/auth.guard';
import { Phase2Controller } from './phase2.controller';

/**
 * Safety net for the SSE ceiling WIRING (2026-09-24).
 *
 * `phase2.domain.test.ts` covers the number; this covers the fact that the
 * stream honours it. The endpoint's only other exit is "no message is PENDING
 * any more", which never arrives for a message whose worker died mid-job or
 * whose job never reached the queue. Without a ceiling the pipe then re-reads
 * the entire conversation once a second, for as long as the client holds the
 * connection — a poll loop with no owner.
 *
 * Both tests below drive the pipe with fake timers, so they assert the shape
 * of the stream rather than waiting three real minutes for it.
 */

const stuck = {
  id: 'conv-1',
  messages: [{ id: 'msg-1', status: AiMessageStatus.PENDING }],
};

function subscribeToEvents(getConversation: () => Promise<unknown>) {
  const controller = new Phase2Controller(
    {} as AgencyService,
    { getConversation } as unknown as AiService,
  );
  const request = { user: { id: 'user-1' } } as unknown as AuthenticatedRequest;

  let completed = false;
  let events = 0;
  const subscription = controller
    .conversationEvents(request, 'conv-1')
    .subscribe({ next: () => { events += 1; }, complete: () => { completed = true; } });

  return { subscription, state: () => ({ completed, events }) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the conversation event stream always ends', () => {
  it('closes a stream whose message never leaves PENDING', async () => {
    const { subscription, state } = subscribeToEvents(() => Promise.resolve(stuck));

    await vi.advanceTimersByTimeAsync(179_000);
    expect(state().completed).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(state().completed).toBe(true);

    subscription.unsubscribe();
  });

  /*
    The ceiling must not become the normal way out: an answer that finishes
    has to end the stream the moment it does, not three minutes later.
  */
  it('still closes as soon as the answer completes', async () => {
    let status: AiMessageStatus = AiMessageStatus.PENDING;
    const { subscription, state } = subscribeToEvents(() =>
      Promise.resolve({ id: 'conv-1', messages: [{ id: 'msg-1', status }] }));

    await vi.advanceTimersByTimeAsync(3_000);
    expect(state().completed).toBe(false);

    status = AiMessageStatus.COMPLETED;
    await vi.advanceTimersByTimeAsync(1_500);

    expect(state().completed).toBe(true);
    // The finished answer is delivered, not swallowed by the close.
    expect(state().events).toBeGreaterThanOrEqual(2);

    subscription.unsubscribe();
  });
});
