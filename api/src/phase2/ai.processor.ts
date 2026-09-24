import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AiService } from './ai.service';

@Processor('ai-response')
export class AiProcessor extends WorkerHost {
  constructor(private readonly ai: AiService) { super(); }

  process(job: Job<{ messageId: string }>) {
    const attempts = Number(job.opts.attempts ?? 1);
    const finalAttempt = job.attemptsMade + 1 >= attempts;
    return this.ai.processMessage(job.data.messageId, finalAttempt);
  }
}
