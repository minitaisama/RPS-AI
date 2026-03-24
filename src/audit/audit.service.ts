import { Injectable, Logger } from '@nestjs/common';
import { MatchState, RoundRecord } from '../common/types/game.types';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  logRound(match: MatchState, round: RoundRecord) {
    this.logger.log(
      JSON.stringify({
        type: 'round_audit',
        matchId: match.matchId,
        roundNumber: round.roundNumber,
        decisions: round.decisions,
        winnerId: round.winnerId,
        score: round.score,
        startedAt: round.startedAt,
        lockedAt: round.lockAt,
        revealedAt: round.revealedAt,
      }),
    );
  }

  logMatch(match: MatchState) {
    this.logger.log(
      JSON.stringify({
        type: 'match_audit',
        matchId: match.matchId,
        winnerId: match.winnerId,
        finalScore: match.score,
        rounds: match.rounds.length,
        startedAt: match.startedAt,
        endedAt: match.endedAt,
      }),
    );
  }
}
