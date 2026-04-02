import { Injectable, Logger } from '@nestjs/common';
import { MatchState, RoundRecord } from '../common/types/game.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async logRound(match: MatchState, round: RoundRecord) {
    const payload = {
        type: 'round_audit',
        matchId: match.matchId,
        roundNumber: round.roundNumber,
        decisions: round.decisions,
        winnerId: round.winnerId,
        score: round.score,
        startedAt: round.startedAt,
        lockedAt: round.lockAt,
        revealedAt: round.revealedAt,
    };
    this.logger.log(JSON.stringify(payload));

    await this.prisma.systemAuditLog.create({
      data: {
        type: 'round_audit',
        matchId: match.matchId,
        details: payload as any,
      },
    });
  }

  async logMatch(match: MatchState) {
    const payload = {
        type: 'match_audit',
        matchId: match.matchId,
        winnerId: match.winnerId,
        finalScore: match.score,
        rounds: match.rounds.length,
        startedAt: match.startedAt,
        endedAt: match.endedAt,
    };
    this.logger.log(JSON.stringify(payload));

    await this.prisma.systemAuditLog.create({
      data: {
        type: 'match_audit',
        matchId: match.matchId,
        details: payload as any,
      },
    });
  }

  async getMatchAudit(matchId: string) {
    return this.prisma.systemAuditLog.findMany({
      where: { matchId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getRecentLogs(limit = 50) {
    return this.prisma.systemAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
