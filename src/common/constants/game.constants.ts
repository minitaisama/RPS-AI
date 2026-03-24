export const SOCKET_EVENTS = {
  FIND_MATCH: 'queue.join',
  CANCEL_QUEUE: 'queue.cancel',
  MATCH_READY: 'match.ready',
  PLAY_AGAIN: 'play.again',
  MATCH_STATE_GET: 'match.state.get',
  QUEUE_STATUS: 'queue.status',
  MATCH_CANCELLED: 'match.cancelled',
  MATCH_FOUND: 'match.found',
  GAME_STARTED: 'game.started',
  TURN_START: 'turn.start',
  TURN_LOCKED: 'turn.locked',
  TURN_REVEAL: 'turn.result',
  MATCH_RESULT: 'match.result',
  MATCH_STATE: 'match.state',
  ERROR: 'error',
  OPPONENT_DISCONNECTED: 'opponent.disconnected',
} as const;

export const MATCH_DEFAULTS = {
  TURN_MS: Number(process.env.MATCH_TURN_MS || 5000),
  LOCK_BUFFER_MS: Number(process.env.TURN_LOCK_BUFFER_MS || 300),
  MAX_ROUNDS: Number(process.env.MATCH_MAX_ROUNDS || 5),
  WIN_SCORE: Number(process.env.MATCH_WIN_SCORE || 3),
  QUEUE_EXPIRY_SECONDS: Number(process.env.QUEUE_EXPIRY_SECONDS || 120),
  MAX_CCU: Number(process.env.MAX_CCU || 20),
  MAX_ACTIVE_MATCHES: Number(process.env.MAX_ACTIVE_MATCHES || 10),
  RECONNECT_WINDOW_MS: 30_000,
};
