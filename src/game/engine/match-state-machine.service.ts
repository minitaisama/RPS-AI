import { Injectable } from '@nestjs/common';
import { MATCH_DEFAULTS } from '../../common/constants/game.constants';
import { MatchState, Move, PlayerRef, RoundRecord, TurnDecision } from '../../common/types/game.types';
import { StrategyService } from '../../strategy/strategy.service';

@Injectable()
export class MatchStateMachineService {
  constructor(private readonly strategyService: StrategyService) {}

  createMatch(players: [PlayerRef, PlayerRef]): MatchState {
    const now = new Date().toISOString();
    return {
      matchId: crypto.randomUUID(),
      status: 'matched',
      players,
      bestOf: MATCH_DEFAULTS.MAX_ROUNDS,
      winScore: MATCH_DEFAULTS.WIN_SCORE,
      currentRound: 0,
      rounds: [],
      score: Object.fromEntries(players.map((player) => [player.id, 0])),
      winnerId: null,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
    };
  }

  async beginRound(match: MatchState): Promise<MatchState> {
    match.currentRound += 1;
    match.status = 'turn_active';
    match.updatedAt = new Date().toISOString();
    return match;
  }

  async lockRound(match: MatchState): Promise<{ match: MatchState; round: RoundRecord }> {
    const startedAt = new Date();
    const round: RoundRecord = {
      roundNumber: match.currentRound,
      state: 'turn_active',
      startedAt: startedAt.toISOString(),
      lockAt: new Date(startedAt.getTime() + MATCH_DEFAULTS.TURN_MS - MATCH_DEFAULTS.LOCK_BUFFER_MS).toISOString(),
      decisions: [],
      winnerId: null,
      score: { ...match.score },
    };

    const history = match.rounds.flatMap((item) => item.decisions);
    const decisions = await Promise.all(
      match.players.map((player, index) => {
        const ownHistory = history
          .filter((decision) => decision.playerId === player.id)
          .map((decision) => decision.validatedMove);
        const opponentId = match.players[index === 0 ? 1 : 0].id;
        const opponentHistory = history
          .filter((decision) => decision.playerId === opponentId)
          .map((decision) => decision.validatedMove);

        return this.strategyService.execute(player, round.roundNumber, {
          myHistory: ownHistory,
          opponentHistory,
          currentRound: round.roundNumber,
        });
      }),
    );

    round.decisions = decisions;
    round.state = 'turn_locked';
    match.status = 'turn_locked';
    match.updatedAt = new Date().toISOString();

    return { match, round };
  }

  revealRound(match: MatchState, round: RoundRecord): MatchState {
    round.winnerId = this.resolveRoundWinner(round.decisions);
    round.revealedAt = new Date().toISOString();
    round.state = 'turn_revealed';
    match.status = 'turn_revealed';

    if (round.winnerId) {
      match.score[round.winnerId] += 1;
    }

    round.score = { ...match.score };
    match.rounds.push(round);

    const winnerId = this.resolveMatchWinner(match);
    if (winnerId || match.currentRound >= match.bestOf) {
      match.status = 'match_complete';
      match.winnerId = winnerId;
      match.endedAt = new Date().toISOString();
    } else {
      match.status = 'round_resolved';
    }

    match.updatedAt = new Date().toISOString();
    return match;
  }

  private resolveRoundWinner(decisions: TurnDecision[]): string | null {
    const [left, right] = decisions;
    if (left.validatedMove === right.validatedMove) {
      return null;
    }

    const beats: Record<Move, Move> = {
      rock: 'scissors',
      paper: 'rock',
      scissors: 'paper',
    };

    return beats[left.validatedMove] === right.validatedMove ? left.playerId : right.playerId;
  }

  private resolveMatchWinner(match: MatchState): string | null {
    return Object.entries(match.score).find(([, score]) => score >= match.winScore)?.[0] || null;
  }
}
