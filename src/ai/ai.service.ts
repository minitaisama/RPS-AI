import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { fork, ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';

export type AiWorkerInput = {
  strategyCode?: string | null;
  history: {
    myHistory: string[];
    opponentHistory: string[];
    currentRound: number;
  };
  myStats?: Record<string, unknown>;
  opStats?: Record<string, unknown>;
};

export type AiWorkerResult = {
  status: 'ok' | 'fallback';
  move: 'rock' | 'paper' | 'scissors';
  reason?: string;
  executionTimeMs: number;
  rawOutput?: string;
};

@Injectable()
export class AiService implements OnModuleDestroy {
  private worker: ChildProcess | null = null;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: AiWorkerResult) => void;
      reject: (reason?: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor() {
    this.ensureWorker();
  }

  async execute(input: AiWorkerInput): Promise<AiWorkerResult> {
    this.ensureWorker();
    const id = randomUUID();
    const timeoutMs = Number(process.env.AI_WORKER_TIMEOUT_MS || 50);
    const memoryLimitMb = Number(process.env.AI_WORKER_MEMORY_MB || 8);

    return new Promise<AiWorkerResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          status: 'fallback',
          move: this.randomMove(),
          reason: 'timeout',
          executionTimeMs: timeoutMs,
          rawOutput: 'worker_timeout',
        });
      }, timeoutMs + 10);

      this.pending.set(id, { resolve, reject, timer });
      this.worker?.send({ id, ...input, timeoutMs, memoryLimitMb });
    });
  }

  async compilePrompt(prompt: string, attempt: number, previousError?: string | null) {
    const startedAt = Date.now();
    const model = process.env.OPENAI_COMPILE_MODEL || 'gpt-4.1-mini';
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      const compiled = this.compilePromptHeuristically(prompt);
      return {
        compiledJs: compiled,
        rawOutput: compiled,
        model: `${model}:heuristic-fallback`,
        durationMs: Date.now() - startedAt,
      };
    }

    const system = 'You generate a JavaScript function for Rock-Paper-Scissors. Return ONLY a full arrow function like (input) => { ... } that returns exactly one of: rock, paper, scissors. No markdown.';
    const user = previousError
      ? `User prompt: ${prompt}\n\nPrevious compile error: ${previousError}\n\nFix it and return only the function.`
      : `User prompt: ${prompt}\n\nReturn only the function.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OPENAI_COMPILE_FAILED[attempt=${attempt}]: ${body}`);
    }

    const json = (await response.json()) as any;
    const rawOutput = json?.choices?.[0]?.message?.content?.trim();
    if (!rawOutput) {
      throw new Error(`OPENAI_EMPTY_OUTPUT[attempt=${attempt}]`);
    }

    return {
      compiledJs: this.normalizeCompiledJs(rawOutput),
      rawOutput,
      model,
      durationMs: Date.now() - startedAt,
    };
  }

  hashPrompt(prompt: string) {
    return createHash('sha256').update(prompt).digest('hex');
  }

  ensureValidCompiledJs(compiledJs: string) {
    const normalized = this.normalizeCompiledJs(compiledJs);
    // syntax check only
    // eslint-disable-next-line no-new-func
    new Function(`return (${normalized});`)();
    return normalized;
  }

  private ensureWorker() {
    if (this.worker && !this.worker.killed) {
      return;
    }

    const cwd = process.cwd();
    const candidatePaths = [resolve(cwd, 'dist/src/ai/ai-worker.js'), resolve(cwd, 'dist/ai/ai-worker.js')];
    const workerPath = candidatePaths.find((candidate) => {
      try {
        return existsSync(candidate);
      } catch {
        return false;
      }
    });

    if (!workerPath) {
      console.error(`[AiService] AI_WORKER_NOT_FOUND: cwd=${cwd}, candidates=${candidatePaths.join(', ')}`);
      throw new Error(`AI_WORKER_NOT_FOUND: cwd=${cwd}, candidates=${candidatePaths.join(', ')}`);
    }

    console.log(`[AiService] Spawning AI worker from: ${workerPath}`);
    this.worker = fork(workerPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    this.worker.on('message', (message: any) => {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      pending.resolve({
        status: message.status,
        move: message.move,
        reason: message.reason,
        executionTimeMs: message.executionTimeMs,
        rawOutput: message.rawOutput,
      });
    });

    this.worker.on('exit', () => {
      this.worker = null;
      for (const [id, pending] of this.pending.entries()) {
        clearTimeout(pending.timer);
        pending.resolve({
          status: 'fallback',
          move: this.randomMove(),
          reason: 'sandbox_error',
          executionTimeMs: Number(process.env.AI_WORKER_TIMEOUT_MS || 50),
          rawOutput: 'worker_exit',
        });
        this.pending.delete(id);
      }
    });
  }

  private normalizeCompiledJs(rawOutput: string) {
    const trimmed = rawOutput.trim().replace(/^```(?:javascript|js)?/i, '').replace(/```$/i, '').trim();
    if (trimmed.startsWith('(input) =>') || trimmed.startsWith('input =>') || trimmed.startsWith('function')) {
      return trimmed;
    }
    return `(input) => { ${trimmed} }`;
  }

  private compilePromptHeuristically(prompt: string) {
    const normalized = prompt.toLowerCase();
    if (normalized.includes('copy') || normalized.includes('mirror')) {
      return "(input) => { if (!input.opponentHistory?.length) return 'rock'; return input.opponentHistory[input.opponentHistory.length - 1]; }";
    }
    if (normalized.includes('counter') || normalized.includes('beat')) {
      return "(input) => { const last = input.opponentHistory?.[input.opponentHistory.length - 1]; if (!last) return 'rock'; return { rock: 'paper', paper: 'scissors', scissors: 'rock' }[last] || 'rock'; }";
    }
    if (normalized.includes('random') || normalized.includes('chaotic')) {
      return "(input) => { return ['rock','paper','scissors'][Math.floor(Math.random() * 3)]; }";
    }
    return "(input) => { const round = Number(input.currentRound || 1); return ['rock', 'paper', 'scissors'][(round - 1) % 3]; }";
  }

  private randomMove(): 'rock' | 'paper' | 'scissors' {
    const moves: Array<'rock' | 'paper' | 'scissors'> = ['rock', 'paper', 'scissors'];
    return moves[Math.floor(Math.random() * moves.length)] || 'rock';
  }

  async onModuleDestroy() {
    if (this.worker && !this.worker.killed) {
      this.worker.kill();
    }
  }
}
