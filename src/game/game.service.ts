import { Injectable } from '@nestjs/common';
import { MatchRepository } from './models/match.repository';
import { MatchStateMachineService } from './engine/match-state-machine.service';
import { MatchState, RoundRecord } from '../common/types/game.types';
import { QueuePlayerDto } from './dto/queue-player.dto';
import { StrategyService } from '../strategy/strategy.service';
import { RedisService } from '../redis/redis.service';
import { MATCH_DEFAULTS } from '../common/constants/game.constants';
import { WalletService } from '../wallet/wallet.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class GameService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly matchStateMachine: MatchStateMachineService,
    private readonly strategyService: StrategyService,
    private readonly redisService: RedisService,
    private readonly walletService: WalletService,
    private readonly auditService: AuditService,
  ) {}

  private get redis() {
    return this.redisService.getClient();
  }

  async createMatchFromQueue(players: [QueuePlayerDto, QueuePlayerDto]): Promise<MatchState> {
    const compiledPlayers = [
      await this.strategyService.compilePlayerStrategy(players[0].playerId, players[0].strategyId),
      await this.strategyService.compilePlayerStrategy(players[1].playerId, players[1].strategyId),
    ] as const;

    await Promise.all([
      this.walletService.lockStake(players[0].playerId, '10'),
      this.walletService.lockStake(players[1].playerId, '10'),
    ]);

    const match = this.matchStateMachine.createMatch(compiledPlayers as any);
    await this.cacheMatchState(match);
    return this.matchRepository.save(match);
  }

  async beginRound(matchId: string): Promise<MatchState> {
    const match = await this.getMatch(matchId);
    if (!match) {
      throw new Error(`Match ${matchId} not found`);
    }

    const updated = await this.matchStateMachine.beginRound(match);
    await this.cacheMatchState(updated);
    return this.matchRepository.save(updated);
  }

  async lockRound(matchId: string): Promise<{ match: MatchState; round: RoundRecord }> {
    const match = await this.getMatch(matchId);
    if (!match) {
      throw new Error(`Match ${matchId} not found`);
    }

    const payload = await this.matchStateMachine.lockRound(match);
    await this.cacheMatchState(payload.match, payload.round);
    await this.matchRepository.save(payload.match);
    return payload;
  }

  async revealRound(matchId: string, round: RoundRecord): Promise<MatchState> {
    const match = await this.getMatch(matchId);
    if (!match) {
      throw new Error(`Match ${matchId} not found`);
    }

    const updated = this.matchStateMachine.revealRound(match, round);
    await this.auditService.logRound(updated, round);
    
    if (updated.status === 'match_complete' && updated.winnerId) {
      const loserId = updated.players.find(p => p.id !== updated.winnerId)?.id || '';
      await this.walletService.settleMatch(updated.winnerId, loserId, '10');
      await this.auditService.logMatch(updated);
    }
    
    await this.cacheMatchState(updated, round);
    return this.matchRepository.save(updated);
  }

  async forfeitMatch(matchId: string, winnerId: string) {
    const match = await this.getMatch(matchId);
    if (!match) {
      throw new Error(`Match ${matchId} not found`);
    }

    match.winnerId = winnerId;
    match.status = 'match_complete';
    match.endedAt = new Date().toISOString();
    match.updatedAt = match.endedAt;
    match.score[winnerId] = Math.max(match.score[winnerId] || 0, MATCH_DEFAULTS.WIN_SCORE);
    
    const loserId = match.players.find(p => p.id !== winnerId)?.id || '';
    await this.walletService.settleMatch(winnerId, loserId, '10');
    await this.auditService.logMatch(match);
    
    await this.cacheMatchState(match);
    return this.matchRepository.save(match);
  }

  async cancelMatch(matchId: string) {
    const match = await this.getMatch(matchId);
    if (!match) {
      throw new Error(`Match ${matchId} not found`);
    }

    match.winnerId = null;
    match.status = 'match_complete';
    match.score = Object.fromEntries(match.players.map((player) => [player.id, 0]));
    match.endedAt = new Date().toISOString();
    match.updatedAt = match.endedAt;
    await this.cacheMatchState(match);
    return this.matchRepository.save(match);
  }

  async getMatch(matchId: string): Promise<MatchState | undefined> {
    return this.matchRepository.findById(matchId);
  }

  async getMatchDetail(matchId: string) {
    return this.matchRepository.findDetailedById(matchId);
  }

  async getUserMatches(userId: string, page = 1, limit = 20) {
    return this.matchRepository.findByUserId(userId, page, limit);
  }

  async getLeaderboard(page = 1, limit = 20) {
    return this.matchRepository.getLeaderboard(page, limit);
  }

  async getActiveMatchForUser(userId: string) {
    return this.matchRepository.findActiveByUserId(userId);
  }

  async restoreMatchStateForUser(userId: string) {
    const match = await this.getActiveMatchForUser(userId);
    if (!match) {
      return null;
    }

    return {
      matchId: match.matchId,
      status: match.status,
      score: match.score,
      round: match.currentRound,
      players: match.players,
      rounds: match.rounds,
    };
  }

  private async cacheMatchState(match: MatchState, round?: MatchState['rounds'][number]) {
    const [player1, player2] = match.players;
    await this.redis.hset(`rps:match:${match.matchId}`, {
      status: match.status,
      currentRound: String(match.currentRound),
      player1Id: player1.id,
      player2Id: player2.id,
      player1Score: String(match.score[player1.id] || 0),
      player2Score: String(match.score[player2.id] || 0),
      player1StrategyVersion: String(player1.strategyVersion),
      player2StrategyVersion: String(player2.strategyVersion),
      turnStartedAt: round?.startedAt || match.updatedAt,
      player1Move: round?.decisions?.[0]?.validatedMove || '',
      player2Move: round?.decisions?.[1]?.validatedMove || '',
    });
    await this.redis.expire(`rps:match:${match.matchId}`, 60 * 10);
  }
}
