import { Injectable } from '@nestjs/common';
import { MatchStatus, Prisma, TurnMove } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchState } from '../../common/types/game.types';

@Injectable()
export class MatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(match: MatchState): Promise<MatchState> {
    const player1 = match.players[0];
    const player2 = match.players[1];

    await this.prisma.match.upsert({
      where: { id: match.matchId },
      update: {
        status: this.toDbStatus(match.status),
        currentRound: match.currentRound,
        player1Score: match.score[player1.id] || 0,
        player2Score: match.score[player2.id] || 0,
        totalRounds: match.rounds.length,
        winnerId: match.winnerId,
        player1StrategyId: player1.strategyId || null,
        player1StrategyVersion: player1.strategyVersion,
        player2StrategyId: player2.strategyId || null,
        player2StrategyVersion: player2.strategyVersion,
        startedAt: match.startedAt ? new Date(match.startedAt) : undefined,
        endedAt: match.endedAt ? new Date(match.endedAt) : match.status === 'match_complete' ? new Date() : undefined,
      },
      create: {
        id: match.matchId,
        player1Id: player1.id,
        player2Id: player2.id,
        status: this.toDbStatus(match.status),
        currentRound: match.currentRound,
        player1Score: match.score[player1.id] || 0,
        player2Score: match.score[player2.id] || 0,
        totalRounds: match.rounds.length,
        winnerId: match.winnerId,
        player1StrategyId: player1.strategyId || null,
        player1StrategyVersion: player1.strategyVersion,
        player2StrategyId: player2.strategyId || null,
        player2StrategyVersion: player2.strategyVersion,
        startedAt: match.startedAt ? new Date(match.startedAt) : new Date(),
        endedAt: match.endedAt ? new Date(match.endedAt) : match.status === 'match_complete' ? new Date() : null,
      },
    });

    for (const round of match.rounds) {
      for (const decision of round.decisions) {
        await this.prisma.turn.upsert({
          where: {
            matchId_roundNumber_playerId: {
              matchId: match.matchId,
              roundNumber: round.roundNumber,
              playerId: decision.playerId,
            },
          },
          update: {
            strategyId: decision.strategyId || null,
            strategyVersion: decision.strategyVersion,
            inputSnapshotHash: decision.inputSnapshotHash || null,
            rawOutput: decision.rawOutput,
            move: this.toTurnMove(decision.validatedMove, decision.fallbackReason),
            fallbackReason: decision.fallbackReason,
            executionTimeMs: decision.executionTimeMs,
            turnStartedAt: new Date(round.startedAt),
            turnLockedAt: new Date(round.lockAt),
          },
          create: {
            matchId: match.matchId,
            roundNumber: round.roundNumber,
            playerId: decision.playerId,
            strategyId: decision.strategyId || null,
            strategyVersion: decision.strategyVersion,
            inputSnapshotHash: decision.inputSnapshotHash || null,
            rawOutput: decision.rawOutput,
            move: this.toTurnMove(decision.validatedMove, decision.fallbackReason),
            fallbackReason: decision.fallbackReason,
            executionTimeMs: decision.executionTimeMs,
            turnStartedAt: new Date(round.startedAt),
            turnLockedAt: new Date(round.lockAt),
          },
        });
      }
    }

    return match;
  }

  async findById(matchId: string): Promise<MatchState | undefined> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        turns: {
          orderBy: [{ roundNumber: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!match) {
      return undefined;
    }

    const roundsMap = new Map<number, MatchState['rounds'][number]>();
    for (const turn of match.turns) {
      const existing = roundsMap.get(turn.roundNumber) || {
        roundNumber: turn.roundNumber,
        state: 'turn_revealed' as const,
        startedAt: turn.turnStartedAt.toISOString(),
        lockAt: (turn.turnLockedAt || turn.turnStartedAt).toISOString(),
        revealedAt: (turn.turnLockedAt || turn.turnStartedAt).toISOString(),
        decisions: [],
        winnerId: null,
        score: {
          [match.player1Id]: match.player1Score,
          [match.player2Id]: match.player2Score,
        },
      };

      existing.decisions.push({
        playerId: turn.playerId,
        strategyId: turn.strategyId,
        strategyVersion: turn.strategyVersion || 1,
        rawOutput: turn.rawOutput || 'rock',
        validatedMove: this.fromTurnMove(turn.move),
        fallbackReason: turn.fallbackReason,
        executionTimeMs: turn.executionTimeMs || 0,
        decidedAt: turn.createdAt.toISOString(),
        inputSnapshotHash: turn.inputSnapshotHash || undefined,
      });
      roundsMap.set(turn.roundNumber, existing);
    }

    const rounds = Array.from(roundsMap.values()).sort((a, b) => a.roundNumber - b.roundNumber);

    const player1 = await this.prisma.user.findUnique({ where: { id: match.player1Id } });
    const player2 = await this.prisma.user.findUnique({ where: { id: match.player2Id } });
    const player1Strategy = match.player1StrategyId
      ? await this.prisma.strategy.findUnique({ where: { id: match.player1StrategyId } })
      : null;
    const player2Strategy = match.player2StrategyId
      ? await this.prisma.strategy.findUnique({ where: { id: match.player2StrategyId } })
      : null;

    return {
      matchId: match.id,
      status: this.fromDbStatus(match.status),
      players: [
        {
          id: match.player1Id,
          displayName: player1?.displayName ?? player1?.walletAddress ?? match.player1Id,
          walletAddress: player1?.walletAddress ?? null,
          strategyId: match.player1StrategyId,
          strategyVersion: match.player1StrategyVersion || 1,
          strategyName: player1Strategy?.name ?? null,
          strategyPreset: player1Strategy?.presetKey ?? null,
        },
        {
          id: match.player2Id,
          displayName: player2?.displayName ?? player2?.walletAddress ?? match.player2Id,
          walletAddress: player2?.walletAddress ?? null,
          strategyId: match.player2StrategyId,
          strategyVersion: match.player2StrategyVersion || 1,
          strategyName: player2Strategy?.name ?? null,
          strategyPreset: player2Strategy?.presetKey ?? null,
        },
      ],
      bestOf: 5,
      winScore: 3,
      currentRound: match.currentRound,
      rounds,
      score: {
        [match.player1Id]: match.player1Score,
        [match.player2Id]: match.player2Score,
      },
      winnerId: match.winnerId,
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString(),
      startedAt: match.startedAt?.toISOString(),
      endedAt: match.endedAt?.toISOString(),
    };
  }

  async findDetailedById(matchId: string) {
    return this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        turns: { orderBy: [{ roundNumber: 'asc' }, { createdAt: 'asc' }] },
        player1: true,
        player2: true,
        winner: true,
      },
    });
  }

  async findByUserId(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [matches, total] = await this.prisma.$transaction([
      this.prisma.match.findMany({
        where: {
          OR: [{ player1Id: userId }, { player2Id: userId }],
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.match.count({
        where: {
          OR: [{ player1Id: userId }, { player2Id: userId }],
        },
      }),
    ]);

    return { matches, pagination: { page, limit, total } };
  }

  async findActiveByUserId(userId: string) {
    const match = await this.prisma.match.findFirst({
      where: {
        OR: [{ player1Id: userId }, { player2Id: userId }],
        status: {
          in: [
            MatchStatus.MATCHED,
            MatchStatus.TURN_ACTIVE,
            MatchStatus.TURN_LOCKED,
            MatchStatus.TURN_REVEALED,
            MatchStatus.ROUND_RESOLVED,
          ],
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!match) {
      return undefined;
    }

    return this.findById(match.id);
  }

  async getLeaderboard(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const rows = await this.prisma.match.groupBy({
      by: ['winnerId'],
      where: { winnerId: { not: null } },
      _count: { winnerId: true },
      orderBy: { _count: { winnerId: 'desc' } },
      skip,
      take: limit,
    });

    const userIds = rows.map((row) => row.winnerId).filter(Boolean) as string[];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } } });
    const userMap = new Map(users.map((user) => [user.id, user]));

    return rows.map((row) => ({
      userId: row.winnerId,
      walletAddress: userMap.get(row.winnerId || '')?.walletAddress || null,
      displayName: userMap.get(row.winnerId || '')?.displayName || null,
      wins: row._count.winnerId,
    }));
  }

  private toDbStatus(status: MatchState['status']): MatchStatus {
    const mapping: Record<MatchState['status'], MatchStatus> = {
      idle: MatchStatus.IDLE,
      queued: MatchStatus.QUEUED,
      matched: MatchStatus.MATCHED,
      turn_active: MatchStatus.TURN_ACTIVE,
      turn_locked: MatchStatus.TURN_LOCKED,
      turn_revealed: MatchStatus.TURN_REVEALED,
      round_resolved: MatchStatus.ROUND_RESOLVED,
      match_complete: MatchStatus.MATCH_COMPLETE,
    };
    return mapping[status];
  }

  private fromDbStatus(status: MatchStatus): MatchState['status'] {
    return status.toLowerCase() as MatchState['status'];
  }

  private toTurnMove(move: 'rock' | 'paper' | 'scissors', fallbackReason: string | null): TurnMove {
    if (fallbackReason) {
      return TurnMove.FALLBACK_RANDOM;
    }

    const mapping: Record<'rock' | 'paper' | 'scissors', TurnMove> = {
      rock: TurnMove.ROCK,
      paper: TurnMove.PAPER,
      scissors: TurnMove.SCISSORS,
    };
    return mapping[move];
  }

  private fromTurnMove(move: TurnMove): 'rock' | 'paper' | 'scissors' {
    const mapping: Record<TurnMove, 'rock' | 'paper' | 'scissors'> = {
      [TurnMove.ROCK]: 'rock',
      [TurnMove.PAPER]: 'paper',
      [TurnMove.SCISSORS]: 'scissors',
      [TurnMove.FALLBACK_RANDOM]: 'rock',
    };
    return mapping[move];
  }
}
