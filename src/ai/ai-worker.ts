import vm from 'node:vm';

type Move = 'rock' | 'paper' | 'scissors';

type WorkerRequest = {
  id: string;
  strategyCode?: string | null;
  history?: {
    myHistory?: string[];
    opponentHistory?: string[];
    currentRound?: number;
  };
  myStats?: Record<string, unknown>;
  opStats?: Record<string, unknown>;
  timeoutMs?: number;
  memoryLimitMb?: number;
};

type WorkerResponse = {
  id: string;
  status: 'ok' | 'fallback';
  move: Move;
  reason?: string;
  executionTimeMs: number;
  rawOutput?: string;
};

const MOVES: Move[] = ['rock', 'paper', 'scissors'];
const DEFAULT_TIMEOUT_MS = 50;
const DEFAULT_MEMORY_MB = 8;

function randomMove(): Move {
  return MOVES[Math.floor(Math.random() * MOVES.length)] || 'rock';
}

function normalizeMove(value: unknown): Move | null {
  if (value === 'rock' || value === 'paper' || value === 'scissors') {
    return value;
  }
  return null;
}

async function runInIsolatedVm(request: WorkerRequest): Promise<WorkerResponse> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ivm = require('isolated-vm');
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryLimitMb = request.memoryLimitMb ?? DEFAULT_MEMORY_MB;
  const startedAt = Date.now();
  const isolate = new ivm.Isolate({ memoryLimit: memoryLimitMb });
  const context = await isolate.createContext();
  const jail = context.global;

  try {
    await jail.set('globalThis', jail.derefInto());
    await context.evalClosure(
      `
        globalThis.__runner = function(strategyCode, input) {
          const fn = eval('(' + strategyCode + ')');
          return fn(input);
        };
      `,
      [],
      { timeout: timeoutMs },
    );

    const runner = await jail.get('__runner', { reference: true });
    const input = {
      myHistory: request.history?.myHistory || [],
      opponentHistory: request.history?.opponentHistory || [],
      currentRound: request.history?.currentRound || 1,
      history: request.history || {},
      myStats: request.myStats || {},
      opStats: request.opStats || {},
    };

    const rawOutput = await runner.apply(undefined, [request.strategyCode || '', input], {
      timeout: timeoutMs,
      arguments: { copy: true },
      result: { copy: true },
    });

    const move = normalizeMove(rawOutput);
    const executionTimeMs = Date.now() - startedAt;
    if (!move) {
      return {
        id: request.id,
        status: 'fallback',
        move: randomMove(),
        reason: 'invalid_output',
        executionTimeMs,
        rawOutput: String(rawOutput),
      };
    }

    return {
      id: request.id,
      status: 'ok',
      move,
      executionTimeMs,
      rawOutput: String(rawOutput),
    };
  } finally {
    isolate.dispose();
  }
}

function runInNodeVm(request: WorkerRequest): WorkerResponse {
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const input = Object.freeze({
    myHistory: Object.freeze([...(request.history?.myHistory || [])]),
    opponentHistory: Object.freeze([...(request.history?.opponentHistory || [])]),
    currentRound: request.history?.currentRound || 1,
    history: Object.freeze({ ...(request.history || {}) }),
    myStats: Object.freeze({ ...(request.myStats || {}) }),
    opStats: Object.freeze({ ...(request.opStats || {}) }),
  });

  const context = vm.createContext(Object.freeze({ input }));
  const script = new vm.Script(`(${request.strategyCode || '(input) => "rock"'})(input)`, {
    filename: 'strategy-sandbox.js',
  });

  const rawOutput = script.runInContext(context, { timeout: timeoutMs });
  const move = normalizeMove(rawOutput);
  const executionTimeMs = Date.now() - startedAt;

  if (!move) {
    return {
      id: request.id,
      status: 'fallback',
      move: randomMove(),
      reason: 'invalid_output',
      executionTimeMs,
      rawOutput: String(rawOutput),
    };
  }

  return {
    id: request.id,
    status: 'ok',
    move,
    executionTimeMs,
    rawOutput: String(rawOutput),
  };
}

async function execute(request: WorkerRequest): Promise<WorkerResponse> {
  if (!request.strategyCode) {
    return {
      id: request.id,
      status: 'fallback',
      move: randomMove(),
      reason: 'no_strategy',
      executionTimeMs: 0,
      rawOutput: '',
    };
  }

  try {
    try {
      return await runInIsolatedVm(request);
    } catch {
      return runInNodeVm(request);
    }
  } catch (error) {
    const reason = error instanceof Error && /Script execution timed out|timed out/i.test(error.message)
      ? 'timeout'
      : 'execution_error';

    return {
      id: request.id,
      status: 'fallback',
      move: randomMove(),
      reason,
      executionTimeMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      rawOutput: error instanceof Error ? error.message : 'worker_error',
    };
  }
}

process.on('message', async (message: WorkerRequest) => {
  const response = await execute(message);
  if (process.send) {
    process.send(response);
  }
});
