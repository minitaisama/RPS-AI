import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SOCKET_EVENTS, MATCH_DEFAULTS } from '../../common/constants/game.constants';
import { QueueService } from '../../queue/queue.service';
import { QueuePlayerDto } from '../dto/queue-player.dto';
import { GameService } from '../game.service';
import { JwtService } from '@nestjs/jwt';
import { ApiException } from '../../common/http/api-exception';

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length) {
    return origins;
  }

  return ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];
}

@WebSocketGateway(Number(process.env.WS_PORT || 3001), {
  cors: { origin: parseAllowedOrigins(), credentials: true },
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly queueService: QueueService,
    private readonly gameService: GameService,
    private readonly jwtService: JwtService,
  ) {}

  afterInit() {
    // socket auth handled in connection lifecycle
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        throw new Error('JWT_SECRET is required');
      }
      const payload = this.jwtService.verify(token, {
        secret,
      }) as { sub: string };
      client.data.userId = payload.sub;
      await this.queueService.incrementCCU(payload.sub, client.id);
      await this.restoreClientState(client);
      await this.emitQueuePosition(payload.sub);
    } catch {
      client.emit(SOCKET_EVENTS.ERROR, { code: 'UNAUTHORIZED', message: 'Invalid socket auth' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      return;
    }

    const activeMatch = await this.gameService.getActiveMatchForUser(userId);
    if (activeMatch) {
      const opponent = activeMatch.players.find((player) => player.id !== userId);
      if (opponent) {
        await this.queueService.scheduleReconnect(activeMatch.matchId, userId, opponent.id);
        await this.queueService.setUserState(userId, 'reconnecting');
        await this.emitToUser(opponent.id, SOCKET_EVENTS.OPPONENT_DISCONNECTED, {});
        setTimeout(async () => {
          const reconnectState = await this.queueService.getReconnectState(activeMatch.matchId);
          if (!reconnectState) {
            return;
          }

          const disconnectedUsers = new Set((reconnectState.disconnectedUsers || '').split(',').filter(Boolean));
          if (disconnectedUsers.size >= 2 || reconnectState.cancelled === 'true') {
            const cancelled = await this.gameService.cancelMatch(activeMatch.matchId);
            await this.queueService.clearReconnectState(activeMatch.matchId);
            await this.queueService.decrementActiveMatches();
            await Promise.all(cancelled.players.map((player) => this.queueService.setUserState(player.id, 'idle')));
            await Promise.all(
              cancelled.players.map((player) =>
                this.emitToUser(player.id, SOCKET_EVENTS.MATCH_CANCELLED, { reason: 'both_disconnected' }),
              ),
            );
            return;
          }

          if (!disconnectedUsers.has(userId)) {
            return;
          }

          const forfeited = await this.gameService.forfeitMatch(activeMatch.matchId, opponent.id);
          await this.queueService.clearReconnectState(activeMatch.matchId);
          await this.queueService.decrementActiveMatches();
          await Promise.all(forfeited.players.map((player) => this.queueService.setUserState(player.id, 'idle')));
          await this.emitMatchResult(activeMatch.matchId, forfeited);
        }, MATCH_DEFAULTS.RECONNECT_WINDOW_MS);
      }
    } else {
      await this.queueService.cancel(userId).catch(() => undefined);
      await this.emitQueuePositions();
    }

    await this.queueService.decrementCCU(userId);
  }

  @SubscribeMessage(SOCKET_EVENTS.FIND_MATCH)
  async handleQueueJoin(@ConnectedSocket() client: Socket, @MessageBody() payload: Partial<QueuePlayerDto>) {
    const playerId = client.data.userId as string;

    try {
      const queued = await this.queueService.enqueue({
        playerId,
        strategyId: payload?.strategyId,
      } as QueuePlayerDto);
      client.emit(SOCKET_EVENTS.QUEUE_STATUS, {
        action: 'queued',
        position: queued.position,
        estimatedWait: queued.estimatedWait,
      });
      await this.emitQueuePositions();

      const expired = await this.queueService.getExpiredQueueEntries();
      for (const entry of expired) {
        await this.queueService.expireUserQueueEntry(entry.userId);
        await this.emitToUser(entry.userId, SOCKET_EVENTS.QUEUE_STATUS, {
          action: 'expired',
          reason: entry.reason,
        });
      }

      const pair = await this.queueService.tryMatch();
      if (!pair) {
        return queued;
      }

      const match = await this.gameService.createMatchFromQueue(pair);
      const roomId = `match:${match.matchId}`;
      const sockets = await this.resolvePairSockets(pair.map((item) => item.playerId));
      sockets.forEach((socket) => socket?.join(roomId));

      await this.queueService.incrementActiveMatches();
      await Promise.all(match.players.map((player) => this.queueService.setUserState(player.id, 'in_match')));

      await this.emitMatchFound(match.matchId, match.players[0].id, match.players[1]);
      await this.emitMatchFound(match.matchId, match.players[1].id, match.players[0]);

      this.server.to(roomId).emit(SOCKET_EVENTS.GAME_STARTED, {
        matchId: match.matchId,
        player1: {
          id: match.players[0].id,
          displayName: match.players[0].displayName,
          walletAddress: match.players[0].walletAddress,
        },
        player2: {
          id: match.players[1].id,
          displayName: match.players[1].displayName,
          walletAddress: match.players[1].walletAddress,
        },
        rounds: 5,
      });

      void this.runMatchLoop(roomId, match.matchId);
      return queued;
    } catch (error) {
      this.emitApiError(client, error);
      throw error;
    }
  }

  @SubscribeMessage(SOCKET_EVENTS.CANCEL_QUEUE)
  async cancelQueue(@ConnectedSocket() client: Socket) {
    const result = await this.queueService.cancel(client.data.userId as string);
    await this.emitQueuePositions();
    return result;
  }

  @SubscribeMessage(SOCKET_EVENTS.MATCH_READY)
  async matchReady(@ConnectedSocket() client: Socket, @MessageBody() payload?: Partial<QueuePlayerDto>) {
    return this.playAgain(client, payload || {});
  }

  @SubscribeMessage(SOCKET_EVENTS.PLAY_AGAIN)
  async playAgain(@ConnectedSocket() client: Socket, @MessageBody() payload: Partial<QueuePlayerDto>) {
    return this.handleQueueJoin(client, payload || {});
  }

  @SubscribeMessage(SOCKET_EVENTS.MATCH_STATE_GET)
  async getMatchState(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId?: string }) {
    const userId = client.data.userId as string;
    const matchState = payload?.matchId
      ? await this.gameService.getMatch(payload.matchId)
      : await this.gameService.restoreMatchStateForUser(userId);

    if (matchState) {
      client.emit(SOCKET_EVENTS.MATCH_STATE, matchState);
    }

    return matchState;
  }

  private async runMatchLoop(roomId: string, matchId: string) {
    while (true) {
      const match = await this.gameService.getMatch(matchId);
      if (!match || match.status === 'match_complete' || match.currentRound >= match.bestOf) {
        break;
      }

      const active = await this.gameService.beginRound(matchId);
      this.server.to(roomId).emit(SOCKET_EVENTS.TURN_START, {
        round: active.currentRound,
        countdownMs: MATCH_DEFAULTS.TURN_MS,
      });

      const { round } = await this.gameService.lockRound(matchId);
      await this.delay(MATCH_DEFAULTS.TURN_MS - MATCH_DEFAULTS.LOCK_BUFFER_MS);

      this.server.to(roomId).emit(SOCKET_EVENTS.TURN_LOCKED, {});

      const revealed = await this.gameService.revealRound(matchId, round);
      const [left] = round.decisions;
      this.server.to(roomId).emit(SOCKET_EVENTS.TURN_REVEAL, {
        round: round.roundNumber,
        player1Move: round.decisions[0]?.validatedMove,
        player2Move: round.decisions[1]?.validatedMove,
        winner:
          round.winnerId === null
            ? 'draw'
            : round.winnerId === left.playerId
              ? 'player1'
              : 'player2',
        score: {
          player1: revealed.score[revealed.players[0].id] || 0,
          player2: revealed.score[revealed.players[1].id] || 0,
        },
      });

      await this.delay(MATCH_DEFAULTS.LOCK_BUFFER_MS);

      if (revealed.status === 'match_complete') {
        await this.emitMatchResult(matchId, revealed);
        await this.queueService.decrementActiveMatches();
        await Promise.all(revealed.players.map((player) => this.queueService.setUserState(player.id, 'idle')));
        break;
      }
    }
  }

  private async restoreClientState(client: Socket) {
    const userId = client.data.userId as string;
    const activeMatch = await this.gameService.getActiveMatchForUser(userId);
    if (!activeMatch) {
      const queuePosition = await this.getQueuePosition(userId);
      if (queuePosition) {
        client.emit(SOCKET_EVENTS.QUEUE_STATUS, {
          action: 'queued',
          position: queuePosition,
          estimatedWait: 5,
        });
      }
      return;
    }

    const reconnectState = await this.queueService.getReconnectState(activeMatch.matchId);
    if (reconnectState) {
      const disconnectedUsers = new Set((reconnectState.disconnectedUsers || '').split(',').filter(Boolean));
      if (disconnectedUsers.has(userId)) {
        disconnectedUsers.delete(userId);
        if (disconnectedUsers.size === 0) {
          await this.queueService.clearReconnectState(activeMatch.matchId);
        } else {
          await this.queueService.scheduleReconnect(
            activeMatch.matchId,
            Array.from(disconnectedUsers)[0],
            activeMatch.players.find((player) => player.id !== Array.from(disconnectedUsers)[0])?.id || '',
          );
        }
      }
    }

    client.join(`match:${activeMatch.matchId}`);
    client.emit(SOCKET_EVENTS.MATCH_STATE, {
      matchId: activeMatch.matchId,
      status: activeMatch.status,
      score: activeMatch.score,
      round: activeMatch.currentRound,
      players: activeMatch.players,
      rounds: activeMatch.rounds,
    });

    if (activeMatch.status === 'match_complete' && activeMatch.winnerId === null) {
      client.emit(SOCKET_EVENTS.MATCH_CANCELLED, { reason: 'both_disconnected' });
    }
  }

  private async emitMatchFound(matchId: string, userId: string, opponent: any) {
    await this.emitToUser(userId, SOCKET_EVENTS.MATCH_FOUND, {
      matchId,
      opponent: {
        id: opponent.id,
        displayName: opponent.displayName,
        walletAddress: opponent.walletAddress,
        strategy: {
          name: opponent.strategyName,
          preset: opponent.strategyPreset,
        },
      },
    });
  }

  private async emitMatchResult(matchId: string, revealed: any) {
    const roomId = `match:${matchId}`;
    this.server.to(roomId).emit(SOCKET_EVENTS.MATCH_RESULT, {
      status: 'match_complete',
      winner:
        revealed.winnerId === null
          ? 'draw'
          : revealed.winnerId === revealed.players[0].id
            ? 'player1'
            : 'player2',
      finalScore: {
        player1: revealed.score[revealed.players[0].id] || 0,
        player2: revealed.score[revealed.players[1].id] || 0,
      },
      rounds: revealed.rounds.map((item: any) => ({
        round: item.roundNumber,
        player1Move: item.decisions[0]?.validatedMove,
        player2Move: item.decisions[1]?.validatedMove,
        winner:
          item.winnerId === null
            ? 'draw'
            : item.winnerId === revealed.players[0].id
              ? 'player1'
              : 'player2',
      })),
    });
  }

  private extractToken(client: Socket) {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) {
      return authToken;
    }

    throw new Error('Missing token');
  }

  private async resolvePairSockets(playerIds: string[]) {
    const sockets = await Promise.all(
      playerIds.map(async (userId) => {
        const socketId = await this.queueService.getUserSocketId(userId);
        if (!socketId) {
          return null;
        }
        return this.server.sockets.sockets.get(socketId) || null;
      }),
    );
    return sockets;
  }

  private async emitToUser(userId: string, event: string, payload: unknown) {
    const socketId = await this.queueService.getUserSocketId(userId);
    if (!socketId) {
      return;
    }
    this.server.to(socketId).emit(event, payload);
  }

  private async emitQueuePositions() {
    const positions = await this.queueService.getQueuePositions();
    await Promise.all(
      positions.map(async ({ socketId, position }) => {
        if (!socketId) {
          return;
        }
        this.server.to(socketId).emit(SOCKET_EVENTS.QUEUE_STATUS, {
          action: 'position_update',
          position,
        });
      }),
    );
  }

  private async emitQueuePosition(userId: string) {
    const position = await this.getQueuePosition(userId);
    if (!position) {
      return;
    }
    await this.emitToUser(userId, SOCKET_EVENTS.QUEUE_STATUS, {
      action: 'position_update',
      position,
    });
  }

  private async getQueuePosition(userId: string) {
    return this.queueService.getQueuePosition(userId);
  }

  private emitApiError(client: Socket, error: unknown) {
    if (error instanceof ApiException) {
      const response = error.getResponse() as any;
      client.emit(SOCKET_EVENTS.ERROR, response.error);
      return;
    }

    client.emit(SOCKET_EVENTS.ERROR, { code: 'INTERNAL_ERROR', message: 'Unexpected error' });
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
