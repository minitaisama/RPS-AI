import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { QueueModule } from '../queue/queue.module';
import { AdminGuard } from '../common/guards/admin.guard';

@Module({
  imports: [QueueModule],
  controllers: [HealthController],
  providers: [AdminGuard],
})
export class HealthModule {}
