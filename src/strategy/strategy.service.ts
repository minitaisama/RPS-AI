import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Move, PlayerRef, TurnDecision } from '../common/types/game.types';
import { createHash } from 'crypto';
import { StrategyStatus, StrategyType } from '@prisma/client';
import { UpsertStrategyDto } from './dto/upsert-strategy.dto';
import { ApiException } from '../common/http/api-exception';
import { AiService } from '../ai/ai.service';

const MOVES: Move[] = ['rock', 'paper', 'scissors'];
const PRESET_BODIES: Record<string, string> = {
  aggressive: "(input) => { const r = input.currentRound % 3; return ['rock', 'rock', 'scissors'][r]; }",
  defensive:
    "(input) => { if (input.opponentHistory.length === 0) return 'rock'; const last = input.opponentHistory[input.opponentHistory.length - 1]; return { rock: 'paper', paper: 'scissors', scissors: 'rock' }[last]; }",
  copycat:
    "(input) => { if (input.opponentHistory.length === 0) return 'rock'; return input.opponentHistory[input.opponentHistory.length - 1]; }",
  chaotic:
    "(input) => { return ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)]; }",
};

@Injectable()
export class StrategyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly aiService: AiService,
  ) {}

  private get redis() {
    return this.redisService.getClient();
  }

  async listStrategies(userId: string) {
    const strategies = await this.prisma.strategy.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    return { strategies };
  }

  async getStrategy(id: string) {
    const strategy = await this.prisma.strategy.findUnique({ where: { id } });
    if (!strategy) {
      throw new ApiException(404, 'STRATEGY_NOT_FOUND', 'Strategy not found');
    }

    return { strategy };
  }

  async getStrategyForUser(userId: string, id: string) {
    const strategy = await this.prisma.strategy.findFirst({ where: { id, userId } });
    if (!strategy) {
      throw new ApiException(404, 'STRATEGY_NOT_FOUND', 'Strategy not found');
    }

    return { strategy };
  }

  async getActiveStrategy(userId: string) {
    return { strategy: await this.getActiveStrategyForUser(userId) };
  }

  async upsertStrategy(userId: string, dto: UpsertStrategyDto) {
    await this.prisma.strategy.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    const promptHash = dto.prompt ? this.aiService.hashPrompt(dto.prompt) : null;
    const compiledJs = this.resolveCompiledJs(dto);
    const compileModel = dto.type === 'CUSTOM' ? 'pending_manual_compile' : 'preset';
    const status = dto.type === 'CUSTOM' ? StrategyStatus.DRAFT : StrategyStatus.ACTIVE;
    const smokeTestPassed = dto.type === 'CUSTOM' ? false : true;

    const existing = await this.prisma.strategy.findFirst({
      where: {
        userId,
        name: dto.name,
      },
    });

    const strategy = existing
      ? await this.prisma.strategy.update({
          where: { id: existing.id },
          data: {
            name: dto.name,
            type: dto.type as StrategyType,
            presetKey: dto.presetKey,
            prompt: dto.prompt,
            promptHash,
            compiledJs,
            strategyVersion: { increment: dto.prompt || dto.presetKey ? 1 : 0 },
            status,
            compileModel,
            compileError: null,
            smokeTestPassed,
            isActive: true,
          },
        })
      : await this.prisma.strategy.create({
          data: {
            userId,
            name: dto.name,
            type: dto.type as StrategyType,
            presetKey: dto.presetKey,
            prompt: dto.prompt,
            promptHash,
            compiledJs,
            status,
            compileModel,
            compileError: null,
            smokeTestPassed,
            isActive: true,
          },
        });

    if (strategy.compiledJs && strategy.status === StrategyStatus.ACTIVE) {
      await this.cacheStrategy(strategy.userId, strategy.strategyVersion, strategy.compiledJs || '');
      await this.redis.set(
        `rps:strategy:active:${strategy.userId}`,
        JSON.stringify({ strategyId: strategy.id, version: strategy.strategyVersion }),
        'EX',
        60 * 60 * 24,
      );
    }

    return { strategy };
  }

  async updateStrategy(userId: string, id: string, dto: UpsertStrategyDto) {
    const current = await this.prisma.strategy.findFirst({ where: { id, userId } });
    if (!current) {
      throw new ApiException(404, 'STRATEGY_NOT_FOUND', 'Strategy not found');
    }

    const promptHash = dto.prompt ? this.aiService.hashPrompt(dto.prompt) : current.promptHash;
    const compiledJs = dto.type === 'PRESET' || current.type === StrategyType.PRESET ? this.resolveCompiledJs(dto) : current.compiledJs;
    const status = dto.prompt !== undefined && (dto.type === 'CUSTOM' || current.type === StrategyType.CUSTOM)
      ? StrategyStatus.DRAFT
      : StrategyStatus.ACTIVE;
    const smokeTestPassed = status === StrategyStatus.ACTIVE;

    const strategy = await this.prisma.strategy.update({
      where: { id },
      data: {
        name: dto.name ?? current.name,
        type: (dto.type as StrategyType) ?? current.type,
        presetKey: dto.presetKey ?? current.presetKey,
        prompt: dto.prompt ?? current.prompt,
        promptHash,
        compiledJs,
        strategyVersion: { increment: dto.prompt !== undefined || dto.presetKey !== undefined ? 1 : 0 },
        status,
        compileModel: status === StrategyStatus.ACTIVE ? (current.type === StrategyType.PRESET ? 'preset' : current.compileModel) : 'pending_manual_compile',
        compileError: null,
        smokeTestPassed,
      },
    });

    if (strategy.compiledJs && strategy.status === StrategyStatus.ACTIVE) {
      await this.cacheStrategy(strategy.userId, strategy.strategyVersion, strategy.compiledJs || '');
    }
    return { strategy };
  }

  async activateStrategy(userId: string, id: string) {
    const strategy = await this.prisma.strategy.findFirst({ where: { id, userId } });
    if (!strategy) {
      throw new ApiException(404, 'STRATEGY_NOT_FOUND', 'Strategy not found');
    }
    if (strategy.status === StrategyStatus.COMPILING) {
      throw new ApiException(409, 'STRATEGY_COMPILING', 'Strategy is compiling');
    }
    if (strategy.status !== StrategyStatus.ACTIVE) {
      throw new ApiException(400, 'STRATEGY_INVALID', 'Strategy is invalid');
    }

    await this.prisma.strategy.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    const updated = await this.prisma.strategy.update({
      where: { id },
      data: { isActive: true },
    });

    await this.redis.set(
      `rps:strategy:active:${userId}`,
      JSON.stringify({ strategyId: updated.id, version: updated.strategyVersion }),
      'EX',
      60 * 60 * 24,
    );

    return { strategy: updated };
  }

  async deleteStrategy(userId: string, id: string) {
    const strategy = await this.prisma.strategy.findFirst({ where: { id, userId } });
    if (!strategy) {
      throw new ApiException(404, 'STRATEGY_NOT_FOUND', 'Strategy not found');
    }

    await this.prisma.strategy.delete({ where: { id } });
    if (strategy.isActive) {
      await this.redis.del(`rps:strategy:active:${userId}`);
    }

    return { success: true };
  }

  async compileStrategy(userId: string, strategyId: string, promptOverride?: string) {
    const strategy = await this.prisma.strategy.findFirst({ where: { id: strategyId, userId } });
    if (!strategy) {
      throw new ApiException(404, 'STRATEGY_NOT_FOUND', 'Strategy not found');
    }
    if (strategy.type !== StrategyType.CUSTOM) {
      throw new ApiException(400, 'STRATEGY_INVALID', 'Only custom strategies can be compiled');
    }

    const today = new Date().toISOString().slice(0, 10);
    const quotaKey = `rps:compile_quota:${userId}:${today}`;
    const limit = Number(process.env.COMPILE_DAILY_LIMIT || 3);
    const currentQuota = Number((await this.redis.get(quotaKey)) || '0');
    if (currentQuota >= limit) {
      throw new ApiException(429, 'COMPILE_QUOTA_EXCEEDED', 'Daily compile quota exceeded');
    }

    const prompt = promptOverride ?? strategy.prompt;
    if (!prompt) {
      throw new ApiException(400, 'STRATEGY_INVALID', 'Prompt is required for compile');
    }

    await this.prisma.strategy.update({
      where: { id: strategyId },
      data: {
        prompt,
        promptHash: this.aiService.hashPrompt(prompt),
        status: StrategyStatus.COMPILING,
        compileError: null,
      },
    });

    let lastError: string | null = null;
    let compileLog: any = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const compiled = await this.aiService.compilePrompt(prompt, attempt, lastError);
        const compiledJs = this.aiService.ensureValidCompiledJs(compiled.compiledJs);
        await this.runSmokeTests(compiledJs);

        const updated = await this.prisma.strategy.update({
          where: { id: strategyId },
          data: {
            prompt,
            promptHash: this.aiService.hashPrompt(prompt),
            compiledJs,
            strategyVersion: { increment: 1 },
            status: StrategyStatus.ACTIVE,
            compileModel: compiled.model,
            compileError: null,
            smokeTestPassed: true,
          },
        });

        await this.cacheStrategy(updated.userId, updated.strategyVersion, compiledJs);
        await this.redis.set(
          `rps:strategy:active:${updated.userId}`,
          JSON.stringify({ strategyId: updated.id, version: updated.strategyVersion }),
          'EX',
          60 * 60 * 24,
        );
        await this.redis.incr(quotaKey);
        await this.redis.expire(quotaKey, 60 * 60 * 24);

        compileLog = await this.prisma.compileLog.create({
          data: {
            strategyId,
            userId,
            attempt,
            promptHash: this.aiService.hashPrompt(prompt),
            model: compiled.model,
            rawOutput: compiled.rawOutput,
            compileError: null,
            success: true,
            durationMs: compiled.durationMs,
          },
        });

        return { compileLog, strategy: updated };
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'compile_failed';
        compileLog = await this.prisma.compileLog.create({
          data: {
            strategyId,
            userId,
            attempt,
            promptHash: this.aiService.hashPrompt(prompt),
            model: process.env.OPENAI_COMPILE_MODEL || 'gpt-4.1-mini',
            rawOutput: null,
            compileError: lastError,
            success: false,
            durationMs: 0,
          },
        });
      }
    }

    await this.prisma.strategy.update({
      where: { id: strategyId },
      data: {
        status: StrategyStatus.INVALID,
        compileError: lastError,
        smokeTestPassed: false,
      },
    });

    throw new ApiException(400, 'STRATEGY_INVALID', lastError || 'Compile failed after 2 attempts', {
      compileLogId: compileLog?.id,
    });
  }

  async getActiveStrategyForUser(userId: string) {
    return this.prisma.strategy.findFirst({
      where: { userId, isActive: true, status: StrategyStatus.ACTIVE },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async compilePlayerStrategy(userId: string, strategyId?: string | null): Promise<PlayerRef> {
    const strategy = strategyId
      ? await this.prisma.strategy.findFirst({ where: { id: strategyId, userId } })
      : await this.getActiveStrategyForUser(userId);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!strategy) {
      return {
        id: userId,
        displayName: user?.displayName ?? userId,
        strategyId: null,
        strategyVersion: 0,
        strategyName: null,
        strategyPreset: null,
      } as PlayerRef;
    }
    if (strategy.status === StrategyStatus.COMPILING) {
      throw new ApiException(409, 'STRATEGY_COMPILING', 'Strategy is compiling');
    }
    if (strategy.status !== StrategyStatus.ACTIVE || !strategy.compiledJs) {
      throw new ApiException(400, 'STRATEGY_INVALID', 'Strategy is invalid');
    }

    await this.cacheStrategy(strategy.userId, strategy.strategyVersion, strategy.compiledJs || '');

    return {
      id: userId,
      displayName: user?.displayName ?? userId,
      strategyId: strategy.id,
      strategyVersion: strategy.strategyVersion,
      strategyName: strategy.name,
      strategyPreset: strategy.presetKey ?? null,
    } as PlayerRef;
  }

  async execute(player: PlayerRef, roundNumber: number, input: Record<string, unknown>): Promise<TurnDecision> {
    const compiledJs = player.strategyId
      ? await this.getCompiledStrategy(player.id, player.strategyVersion, player.strategyId)
      : null;

    const result = await this.aiService.execute({
      strategyCode: compiledJs,
      history: {
        myHistory: ((input.myHistory as string[]) || []).map(String),
        opponentHistory: ((input.opponentHistory as string[]) || []).map(String),
        currentRound: Number(input.currentRound || roundNumber),
      },
      myStats: (input.myStats as Record<string, unknown>) || {},
      opStats: (input.opStats as Record<string, unknown>) || {},
    });

    const inputSnapshotHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');

    return {
      playerId: player.id,
      strategyId: player.strategyId,
      strategyVersion: player.strategyVersion,
      rawOutput: result.rawOutput || result.move,
      validatedMove: result.move,
      fallbackReason: result.status === 'fallback' ? result.reason || 'execution_error' : null,
      executionTimeMs: result.executionTimeMs,
      decidedAt: new Date().toISOString(),
      inputSnapshotHash,
    };
  }

  private resolveCompiledJs(dto: UpsertStrategyDto) {
    if (dto.type === 'PRESET') {
      return PRESET_BODIES[dto.presetKey || 'chaotic'] || PRESET_BODIES.chaotic;
    }

    return null;
  }

  private async runSmokeTests(compiledJs: string) {
    const fixtures = [
      { myHistory: [], opponentHistory: [], currentRound: 1 },
      { myHistory: ['rock'], opponentHistory: ['paper'], currentRound: 2 },
      { myHistory: ['rock', 'paper'], opponentHistory: ['paper', 'scissors'], currentRound: 3 },
    ];

    for (const fixture of fixtures) {
      const result = await this.aiService.execute({
        strategyCode: compiledJs,
        history: fixture,
        myStats: {},
        opStats: {},
      });
      if (result.status !== 'ok') {
        throw new Error(`SMOKE_TEST_FAILED:${result.reason || 'fallback'}`);
      }
    }
  }

  private async getCompiledStrategy(userId: string, version: number, strategyId: string) {
    const cacheKey = `rps:strategy:${userId}:${version}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return cached;
    }

    const strategy = await this.prisma.strategy.findUnique({ where: { id: strategyId } });
    if (!strategy?.compiledJs) {
      return null;
    }

    await this.cacheStrategy(userId, version, strategy.compiledJs);
    return strategy.compiledJs;
  }

  private async cacheStrategy(userId: string, version: number, compiledJs: string) {
    await this.redis.set(`rps:strategy:${userId}:${version}`, compiledJs, 'EX', 60 * 60 * 24);
  }
}
