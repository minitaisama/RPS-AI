import { Module } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { StrategyController } from './strategy.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [PrismaModule, RedisModule, AiModule],
  providers: [StrategyService],
  controllers: [StrategyController],
  exports: [StrategyService],
})
export class StrategyModule {}
