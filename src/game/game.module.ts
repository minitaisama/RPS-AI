import { Module } from '@nestjs/common';
import { GameGateway } from './gateway/game.gateway';
import { GameService } from './game.service';
import { MatchRepository } from './models/match.repository';
import { MatchStateMachineService } from './engine/match-state-machine.service';
import { StrategyModule } from '../strategy/strategy.module';
import { QueueModule } from '../queue/queue.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [StrategyModule, QueueModule, AuditModule, AuthModule, WalletModule],
  providers: [GameGateway, GameService, MatchRepository, MatchStateMachineService],
  exports: [GameService],
})
export class GameModule {}
