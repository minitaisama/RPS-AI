export type Move = 'rock' | 'paper' | 'scissors';

export type MatchStatus =
  | 'idle'
  | 'queued'
  | 'matched'
  | 'turn_active'
  | 'turn_locked'
  | 'turn_revealed'
  | 'round_resolved'
  | 'match_complete';

export interface StrategyRef {
  id: string | null;
  version: number;
  type?: 'PRESET' | 'CUSTOM';
  presetKey?: string | null;
  compiledJs?: string | null;
}

export interface PlayerRef {
  id: string;
  displayName?: string | null;
  walletAddress?: string | null;
  strategyId?: string | null;
  strategyVersion: number;
  strategyName?: string | null;
  strategyPreset?: string | null;
}

export interface TurnDecision {
  playerId: string;
  strategyId?: string | null;
  strategyVersion: number;
  rawOutput: string;
  validatedMove: Move;
  fallbackReason: string | null;
  executionTimeMs: number;
  decidedAt: string;
  inputSnapshotHash?: string;
}

export interface RoundRecord {
  roundNumber: number;
  state: Extract<MatchStatus, 'turn_active' | 'turn_locked' | 'turn_revealed'>;
  startedAt: string;
  lockAt: string;
  revealedAt?: string;
  decisions: TurnDecision[];
  winnerId: string | null;
  score: Record<string, number>;
}

export interface MatchState {
  matchId: string;
  status: MatchStatus;
  players: [PlayerRef, PlayerRef];
  bestOf: number;
  winScore: number;
  currentRound: number;
  rounds: RoundRecord[];
  score: Record<string, number>;
  winnerId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
}
