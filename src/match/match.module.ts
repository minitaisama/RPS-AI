import { Module } from '@nestjs/common';
import { MatchController } from './match.controller';
import { GameModule } from '../game/game.module';

@Module({
  imports: [GameModule],
  controllers: [MatchController],
})
export class MatchModule {}
