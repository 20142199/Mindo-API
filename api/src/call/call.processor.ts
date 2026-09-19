import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CALL_TIMEOUT_QUEUE } from './call.constants';
import { CallService } from './call.service';

@Processor(CALL_TIMEOUT_QUEUE)
export class CallProcessor extends WorkerHost {
  constructor(private readonly calls: CallService) { super(); }

  process(job: Job<{ callId: string }>) {
    return this.calls.expireRingingCall(job.data.callId);
  }
}
