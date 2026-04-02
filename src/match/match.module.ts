import { Module } from '@nestjs/common';
import { MatchController } from './match.controller';
import { GameModule } from '../game/game.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [GameModule, AuthModule],
  controllers: [MatchController],
})
export class MatchModule {}
