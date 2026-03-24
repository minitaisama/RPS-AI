import { Controller, Get, UseGuards } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('admin')
export class HealthController {
  constructor(private readonly queueService: QueueService) {}

  @Get('metrics')
  @UseGuards(AdminGuard)
  async health() {
    return {
      activeMatches: await this.queueService.getActiveMatchesCount(),
      queueLength: await this.queueService.getQueueLength(),
      timeoutRate: 0,
      fallbackRate: 0,
      completionRate: 0,
      aiLatencyP50: 0,
      aiLatencyP95: 0,
    };
  }
}
