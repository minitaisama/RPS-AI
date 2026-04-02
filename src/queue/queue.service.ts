import { HttpStatus, Injectable } from '@nestjs/common';
import { QueuePlayerDto } from '../game/dto/queue-player.dto';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { MATCH_DEFAULTS } from '../common/constants/game.constants';
import { QueueEntryStatus, StrategyStatus, MatchStatus } from '@prisma/client';
import { ApiException } from '../common/http/api-exception';

const UUID_V4_LIKE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class QueueService {
  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private get redis() {
    return this.redisService.getClient();
  }

  async enqueue(player: QueuePlayerDto) {
    if (!this.isValidUserId(player.playerId)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'INVALID_PLAYER_ID', 'Invalid player id');
    }

    const alreadyQueued = await this.redis.zscore('rps:queue', player.playerId);
    if (alreadyQueued !== null) {
      throw new ApiException(HttpStatus.CONFLICT, 'ALREADY_IN_QUEUE', 'User already in queue');
    }

    const activeMatch = await this.prisma.match.findFirst({
      where: {
        OR: [{ player1Id: player.playerId }, { player2Id: player.playerId }],
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
      select: { id: true },
    });
    if (activeMatch) {
      throw new ApiException(HttpStatus.CONFLICT, 'ALREADY_IN_MATCH', 'User already in match');
    }

    const activeStrategy = player.strategyId
      ? await this.prisma.strategy.findFirst({
          where: {
            id: player.strategyId,
            userId: player.playerId,
          },
        })
      : await this.prisma.strategy.findFirst({
          where: {
            userId: player.playerId,
            isActive: true,
          },
          orderBy: { updatedAt: 'desc' },
        });

    if (activeStrategy?.status === StrategyStatus.COMPILING) {
      throw new ApiException(HttpStatus.CONFLICT, 'STRATEGY_COMPILING', 'Strategy is compiling');
    }
    if (activeStrategy && (activeStrategy.status !== StrategyStatus.ACTIVE || !activeStrategy.compiledJs)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'STRATEGY_INVALID', 'Strategy is invalid');
    }

    const ccu = await this.getCCU();
    const activeMatches = await this.getActiveMatchesCount();
    if (ccu >= MATCH_DEFAULTS.MAX_CCU || activeMatches >= MATCH_DEFAULTS.MAX_ACTIVE_MATCHES) {
      throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, 'QUEUE_FULL', 'Server at capacity');
    }

    const now = Date.now();
    const expiresAt = new Date(now + MATCH_DEFAULTS.QUEUE_EXPIRY_SECONDS * 1000);
    await this.redis.zadd('rps:queue', now, player.playerId);
    await this.redis.hset(`rps:queue:entry:${player.playerId}`, {
      strategyId: activeStrategy?.id ?? '',
      status: QueueEntryStatus.WAITING,
      enqueuedAt: String(now),
      expiresAt: expiresAt.toISOString(),
    });
    await this.redis.expire(`rps:queue:entry:${player.playerId}`, MATCH_DEFAULTS.QUEUE_EXPIRY_SECONDS);
    await this.redis.set(`rps:user:state:${player.playerId}`, 'queued');

    const position = await this.redis.zrank('rps:queue', player.playerId);
    await this.prisma.queueEntry.upsert({
      where: { userId: player.playerId },
      update: {
        strategyId: activeStrategy?.id ?? null,
        status: QueueEntryStatus.WAITING,
        position: (position ?? 0) + 1,
        expiresAt,
      },
      create: {
        userId: player.playerId,
        strategyId: activeStrategy?.id ?? null,
        status: QueueEntryStatus.WAITING,
        position: (position ?? 0) + 1,
        expiresAt,
      },
    });

    await this.broadcastQueuePositions();

    return {
      position: (position ?? 0) + 1,
      estimatedWait: 5,
      queued: true,
      strategyId: activeStrategy?.id ?? null,
    };
  }

  async cancel(userId: string) {
    if (!this.isValidUserId(userId)) {
      return { success: true };
    }

    await this.redis.zrem('rps:queue', userId);
    await this.redis.del(`rps:queue:entry:${userId}`);
    await this.redis.set(`rps:user:state:${userId}`, 'idle');
    await this.prisma.queueEntry.updateMany({
      where: { userId },
      data: { status: QueueEntryStatus.CANCELLED },
    });
    await this.broadcastQueuePositions();
    return { success: true };
  }

  async tryMatch(): Promise<[QueuePlayerDto, QueuePlayerDto] | null> {
    await this.expireEntries();
    const players = await this.getValidQueuedUserIds(0, 1);
    if (players.length < 2) {
      return null;
    }

    const [playerA, playerB] = players;
    await this.redis.zrem('rps:queue', playerA, playerB);

    const entryA = await this.redis.hgetall(`rps:queue:entry:${playerA}`);
    const entryB = await this.redis.hgetall(`rps:queue:entry:${playerB}`);

    await this.redis.del(`rps:queue:entry:${playerA}`);
    await this.redis.del(`rps:queue:entry:${playerB}`);
    await this.redis.set(`rps:user:state:${playerA}`, 'matched');
    await this.redis.set(`rps:user:state:${playerB}`, 'matched');

    const matchedAt = new Date();
    await this.prisma.queueEntry.updateMany({
      where: { userId: { in: [playerA, playerB] } },
      data: { status: QueueEntryStatus.MATCHED, matchedAt },
    });

    await this.broadcastQueuePositions();

    return [
      { playerId: playerA, strategyId: entryA.strategyId || undefined },
      { playerId: playerB, strategyId: entryB.strategyId || undefined },
    ];
  }

  async getQueuePositions() {
    const ids = await this.getValidQueuedUserIds(0, -1);
    return Promise.all(
      ids.map(async (userId, index) => ({
        userId,
        socketId: await this.getUserSocketId(userId),
        position: index + 1,
      })),
    );
  }

  async getQueuePosition(userId: string) {
    const rank = await this.redis.zrank('rps:queue', userId);
    return rank === null ? null : rank + 1;
  }

  async getExpiredQueueEntries() {
    const ids = await this.redis.zrange('rps:queue', 0, -1);
    const now = Date.now();
    const expired: Array<{ userId: string; reason: 'timeout' }> = [];

    for (const rawUserId of ids) {
      const userId = rawUserId?.trim();
      if (!this.isValidUserId(userId)) {
        if (userId) {
          await this.redis.zrem('rps:queue', userId);
          await this.redis.del(`rps:queue:entry:${userId}`);
        }
        continue;
      }

      const key = `rps:queue:entry:${userId}`;
      const entry = await this.redis.hgetall(key);
      const exists = Object.keys(entry).length > 0;
      const ttl = await this.redis.ttl(key);
      const expiresAt = entry.expiresAt ? new Date(entry.expiresAt).getTime() : 0;

      if (!exists || ttl === -2 || (expiresAt && expiresAt <= now)) {
        expired.push({ userId, reason: 'timeout' });
      }
    }

    return expired;
  }

  async expireUserQueueEntry(userId: string) {
    if (!this.isValidUserId(userId)) {
      return;
    }

    await this.redis.zrem('rps:queue', userId);
    await this.redis.del(`rps:queue:entry:${userId}`);
    await this.redis.set(`rps:user:state:${userId}`, 'idle');
    await this.prisma.queueEntry.updateMany({
      where: { userId },
      data: { status: QueueEntryStatus.EXPIRED },
    });
    await this.broadcastQueuePositions();
  }

  async incrementCCU(userId: string, socketId: string) {
    if (!this.isValidUserId(userId)) {
      return;
    }

    const existingSocket = await this.redis.get(`rps:user:socket:${userId}`);
    await this.redis.set(`rps:user:socket:${userId}`, socketId);
    if (!existingSocket) {
      await this.redis.incr('rps:ccu');
    }
    const currentState = await this.redis.get(`rps:user:state:${userId}`);
    await this.redis.set(`rps:user:state:${userId}`, currentState || 'idle');
  }

  async decrementCCU(userId?: string) {
    if (userId) {
      const existingSocket = await this.redis.get(`rps:user:socket:${userId}`);
      await this.redis.del(`rps:user:socket:${userId}`);
      if (!existingSocket) {
        return;
      }
      const currentState = await this.redis.get(`rps:user:state:${userId}`);
      if (!currentState || currentState === 'idle') {
        await this.redis.del(`rps:user:state:${userId}`);
      }
    }
    const current = Number((await this.redis.get('rps:ccu')) || '0');
    if (current > 0) {
      await this.redis.decr('rps:ccu');
    }
  }

  async getCCU() {
    return Number((await this.redis.get('rps:ccu')) || '0');
  }

  async incrementActiveMatches() {
    await this.redis.incr('rps:active_matches');
  }

  async decrementActiveMatches() {
    const current = Number((await this.redis.get('rps:active_matches')) || '0');
    if (current > 0) {
      await this.redis.decr('rps:active_matches');
    }
  }

  async getActiveMatchesCount() {
    return Number((await this.redis.get('rps:active_matches')) || '0');
  }

  async getQueueLength() {
    return this.redis.zcard('rps:queue');
  }

  async getUserSocketId(userId: string) {
    if (!this.isValidUserId(userId)) {
      return null;
    }

    return this.redis.get(`rps:user:socket:${userId}`);
  }

  async getUserState(userId: string) {
    if (!this.isValidUserId(userId)) {
      return null;
    }

    return this.redis.get(`rps:user:state:${userId}`);
  }

  async setUserState(userId: string, state: string) {
    if (!this.isValidUserId(userId)) {
      return;
    }

    await this.redis.set(`rps:user:state:${userId}`, state);
  }

  async scheduleReconnect(matchId: string, disconnectedUserId: string, opponentUserId: string) {
    const key = `rps:match:disconnect:${matchId}`;
    const state = await this.redis.hgetall(key);
    const disconnectedUsers = new Set((state.disconnectedUsers || '').split(',').filter(Boolean));
    disconnectedUsers.add(disconnectedUserId);
    await this.redis.hset(key, {
      disconnectedUsers: Array.from(disconnectedUsers).join(','),
      disconnectedUserId,
      opponentUserId,
      disconnectedAt: String(Date.now()),
      expiresAt: String(Date.now() + MATCH_DEFAULTS.RECONNECT_WINDOW_MS),
      cancelled: disconnectedUsers.size >= 2 ? 'true' : 'false',
    });
    await this.redis.expire(key, Math.ceil(MATCH_DEFAULTS.RECONNECT_WINDOW_MS / 1000));
  }

  async getReconnectState(matchId: string) {
    const state = await this.redis.hgetall(`rps:match:disconnect:${matchId}`);
    return Object.keys(state).length ? state : null;
  }

  async clearReconnectState(matchId: string) {
    await this.redis.del(`rps:match:disconnect:${matchId}`);
  }

  private async expireEntries() {
    const expired = await this.getExpiredQueueEntries();
    for (const entry of expired) {
      await this.expireUserQueueEntry(entry.userId);
    }
  }

  private async broadcastQueuePositions() {
    const positions = await this.getQueuePositions();
    await Promise.all(
      positions.map(async ({ userId, position }) => {
        if (!this.isValidUserId(userId)) {
          return;
        }

        await this.prisma.queueEntry.updateMany({
          where: { userId },
          data: { position },
        });
      }),
    );
  }

  private async getValidQueuedUserIds(start: number, stop: number) {
    const ids = await this.redis.zrange('rps:queue', start, stop);
    const validIds: string[] = [];

    for (const rawUserId of ids) {
      const userId = rawUserId?.trim();
      if (!this.isValidUserId(userId)) {
        if (userId) {
          await this.redis.zrem('rps:queue', userId);
          await this.redis.del(`rps:queue:entry:${userId}`);
        }
        continue;
      }

      validIds.push(userId);
    }

    return validIds;
  }

  private isValidUserId(userId?: string | null): userId is string {
    return typeof userId === 'string' && UUID_V4_LIKE_REGEX.test(userId.trim());
  }
}
