# RPS Arena MVP — Engineering Spec v1

**Status:** Frozen  
**Source:** MVP_FINAL_SPEC.md + Coach/Lebron reviews + debates  
**Target readers:** Lebron (BE), Bronny (FE)  
**Repo:** `git@github.com:minitaisama/RPS-AI.git`

---

## 1. DB Schema (PostgreSQL / Prisma)

### 1.1 `users`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK, default `gen_random_uuid()` | Internal user ID |
| `wallet_address` | `String` | unique, nullable | Lowercase, 0x-prefixed |
| `display_name` | `String` | nullable, max 32 | |
| `created_at` | `DateTime` | default `now()` | |
| `updated_at` | `DateTime` | @updatedAt | |
| `is_active` | `Boolean` | default `true` | Soft disable |

**Indexes:** `wallet_address` (unique)

### 1.2 `strategies`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK | |
| `user_id` | `UUID` | FK → `users.id`, not null | |
| `name` | `String` | max 64 | Display name |
| `type` | `Enum` | `PRESET`, `CUSTOM` | |
| `preset_key` | `String?` | nullable | `aggressive` / `defensive` / `copycat` / `chaotic` |
| `prompt` | `String?` | nullable, max 500 | User's raw prompt (CUSTOM only) |
| `compiled_js` | `String?` | nullable | Compiled function body (validated JS) |
| `prompt_hash` | `String?` | nullable | SHA-256 of prompt (cache invalidation key) |
| `strategy_version` | `Int` | default 1 | Incremented on each recompile |
| `status` | `Enum` | `DRAFT`, `COMPILING`, `ACTIVE`, `INVALID` | |
| `compile_model` | `String?` | nullable | LLM model used for compile |
| `compile_error` | `String?` | nullable | Last compile error (for retry feedback) |
| `is_active` | `Boolean` | default `false` | User-selected active strategy |
| `smoke_test_passed` | `Boolean` | default `false` | |
| `created_at` | `DateTime` | default `now()` | |
| `updated_at` | `DateTime` | @updatedAt | |

**Indexes:** `(user_id)`, `(user_id, is_active)`, `(user_id, status)`

### 1.3 `matches`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK | |
| `player1_id` | `UUID` | FK → `users.id`, not null | |
| `player2_id` | `UUID` | FK → `users.id`, not null | |
| `winner_id` | `UUID?` | FK → `users.id`, nullable | NULL = draw series |
| `player1_score` | `Int` | default 0 | Rounds won |
| `player2_score` | `Int` | default 0 | Rounds won |
| `total_rounds` | `Int` | default 0 | Rounds played (≤5) |
| `status` | `Enum` | See §2 state machine | |
| `current_round` | `Int` | default 0 | Next round to play (1-indexed when active) |
| `player1_strategy_id` | `UUID?` | FK → `strategies.id` | Pinned at match start |
| `player1_strategy_version` | `Int?` | nullable | Snapshot |
| `player2_strategy_id` | `UUID?` | FK → `strategies.id` | |
| `player2_strategy_version` | `Int?` | nullable | |
| `started_at` | `DateTime?` | nullable | |
| `ended_at` | `DateTime?` | nullable | |
| `created_at` | `DateTime` | default `now()` | |
| `updated_at` | `DateTime` | @updatedAt | |

**Indexes:** `(player1_id)`, `(player2_id)`, `(status, created_at)`, `(winner_id)`

### 1.4 `turns`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK | |
| `match_id` | `UUID` | FK → `matches.id`, not null | |
| `round_number` | `Int` | not null | 1–5 |
| `player_id` | `UUID` | FK → `users.id`, not null | |
| `strategy_id` | `UUID?` | FK → `strategies.id` | |
| `strategy_version` | `Int?` | nullable | |
| `input_snapshot_hash` | `String?` | nullable | SHA-256 of normalized input |
| `raw_output` | `String?` | nullable | What the strategy returned before validation |
| `move` | `Enum` | `ROCK`, `PAPER`, `SCISSORS`, `FALLBACK_RANDOM` | Final validated move |
| `fallback_reason` | `String?` | nullable | `timeout` / `invalid_output` / `execution_error` / `no_strategy` |
| `execution_time_ms` | `Int?` | nullable | V8 isolate execution time |
| `turn_started_at` | `DateTime` | not null | |
| `turn_locked_at` | `DateTime?` | nullable | |
| `created_at` | `DateTime` | default `now()` | |

**Indexes:** `(match_id, round_number)`, `(player_id)`, `(match_id, player_id)`

**Unique:** `(match_id, round_number, player_id)`

### 1.5 `queue_entries`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK | |
| `user_id` | `UUID` | FK → `users.id`, unique, not null | One slot per user |
| `strategy_id` | `UUID?` | FK → `strategies.id` | Strategy to use when matched |
| `status` | `Enum` | `WAITING`, `MATCHED`, `EXPIRED`, `CANCELLED` | |
| `position` | `Int` | not null | FIFO position (managed by Redis) |
| `expires_at` | `DateTime` | not null | `created_at + 120s` |
| `matched_at` | `DateTime?` | nullable | |
| `created_at` | `DateTime` | default `now()` | |

**Indexes:** `(user_id)` (unique), `(status, expires_at)`

### 1.6 `compile_logs` (audit for LLM compile)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `UUID` | PK | |
| `strategy_id` | `UUID` | FK → `strategies.id`, not null | |
| `user_id` | `UUID` | FK → `users.id`, not null | |
| `attempt` | `Int` | not null | 1 or 2 |
| `prompt_hash` | `String` | not null | |
| `model` | `String` | not null | LLM model used |
| `raw_output` | `Text?` | nullable | Raw LLM response |
| `compile_error` | `String?` | nullable | |
| `success` | `Boolean` | not null | |
| `duration_ms` | `Int?` | nullable | |
| `created_at` | `DateTime` | default `now()` | |

---

## 2. Match State Machine

### 2.1 States

```
idle → queued → matched → turn_active → turn_locked → turn_revealed → round_resolved → match_complete
                       ↑                                           │
                       └───────────────────────────────────────────┘
                                           (next round)
```

### 2.2 State Definitions

| State | Description |
|-------|-------------|
| `IDLE` | Default user state. No active match, no queue entry. |
| `QUEUED` | User is in matchmaking queue. Waiting for opponent. |
| `MATCHED` | Opponent found. Match record created. Pre-game setup. |
| `TURN_ACTIVE` | Round in progress. 5s countdown running. AI executing. |
| `TURN_LOCKED` | Both moves computed. Not yet revealed to clients. |
| `TURN_REVEALED` | Both moves sent to clients simultaneously. |
| `ROUND_RESOLVED` | Round winner determined, scores updated. Check if match ends. |
| `MATCH_COMPLETE` | First-to-3 reached or 5 rounds played. Final result available. |

### 2.3 Transitions

| From | To | Trigger | Guard |
|------|----|---------|-------|
| `IDLE` | `QUEUED` | User clicks "Find Match" | User has active strategy (preset or compiled custom). No existing match or queue entry. CCU < 20. Active matches < 10. Compile quota not exceeded. |
| `QUEUED` | `MATCHED` | Another user in queue | 2 users available. Both have valid strategies. |
| `QUEUED` | `IDLE` | Queue expired (120s) | `now() > expires_at` |
| `QUEUED` | `IDLE` | User cancels | |
| `QUEUED` | `IDLE` | User disconnects | Release slot immediately. |
| `MATCHED` | `TURN_ACTIVE` | Server initiates first round | Both players connected. Match record persisted. |
| `TURN_ACTIVE` | `TURN_LOCKED` | Both AI moves computed or timeout | Decision cutoff at T-300ms before countdown end. Both moves resolved (or fallback). |
| `TURN_LOCKED` | `TURN_REVEALED` | Server sends simultaneous reveal | Both moves are computed and persisted. |
| `TURN_REVEALED` | `ROUND_RESOLVED` | Server resolves winner | RPS rules applied. Score updated. |
| `ROUND_RESOLVED` | `TURN_ACTIVE` | Next round | `current_round < 5` AND neither player has score ≥ 3. |
| `ROUND_RESOLVED` | `MATCH_COMPLETE` | Match ends | Either player score = 3, OR `current_round = 5` (check for winner or draw). |
| `TURN_ACTIVE` | `MATCH_COMPLETE` | Player disconnects mid-match | Remaining rounds forfeited. Opponent wins. |
| `MATCH_COMPLETE` | `IDLE` | Player returns to lobby | Final result persisted. Balance settled (if applicable). |

### 2.4 Match Result Logic

```
For each round:
  if move1 == move2 → draw (no score change)
  if (move1=rock, move2=scissors) OR (move1=paper, move2=rock) OR (move1=scissors, move2=paper) → player1 wins
  else → player2 wins

Match winner:
  First to 3 round wins
  If 5 rounds played and scores tied → draw match (winner_id = null)
```

---

## 3. API Contracts

### 3.1 REST Endpoints

#### Auth
```
POST   /v1/auth/wallet/verify    { walletAddress, signature, nonce }
POST   /v1/auth/wallet/login     { walletAddress }          → { accessToken, refreshToken, user }
GET    /v1/auth/me                                          → { user }
POST   /v1/auth/refresh           { refreshToken }          → { accessToken, refreshToken }
DELETE /v1/auth/me                                          → { success: true }
```

#### Strategy
```
GET    /v1/strategies                                     → { strategies[] }
GET    /v1/strategies/:id                                 → { strategy }
POST   /v1/strategies              { name, type, presetKey?, prompt? }
                                                         → { strategy }  (starts compile)
PUT    /v1/strategies/:id          { name?, prompt? }
                                                         → { strategy }  (recompiles if prompt changed)
DELETE /v1/strategies/:id                                → { success }
PUT    /v1/strategies/:id/activate                       → { strategy }  (set as active)
GET    /v1/strategies/active                              → { strategy }  (current active)
POST   /v1/strategies/:id/compile                         → { compileLog }  (manual recompile)
```

#### Match
```
GET    /v1/matches                                         → { matches[], pagination }
GET    /v1/matches/:id                                     → { match, turns[] }
GET    /v1/matches/me                                      → { matches[] }  (my match history)
```

#### Leaderboard
```
GET    /v1/leaderboard?page=1&limit=20                    → { leaderboard[], pagination }
```

#### Admin
```
GET    /v1/admin/metrics                                   → { activeMatches, queueLength, timeoutRate, fallbackRate, completionRate, aiLatencyP50, aiLatencyP95 }
```

### 3.2 Socket.IO Events

#### Client → Server

| Event | Payload | When |
|-------|---------|------|
| `FIND_MATCH` | `{ strategyId? }` | Click "Find Match" in lobby. `strategyId` optional (uses active if omitted). |
| `CANCEL_QUEUE` | `{}` | Cancel matchmaking queue. |
| `MATCH_READY` | `{}` | Confirm ready after MATCH_FOUND (optional timeout auto-ready). |
| `PLAY_AGAIN` | `{}` | Re-queue after match complete. |

#### Server → Client

| Event | Payload | When |
|-------|---------|------|
| `QUEUED` | `{ position: number, estimatedWait: number }` | Entered queue. |
| `QUEUE_POSITION` | `{ position: number }` | Position updated. |
| `MATCH_FOUND` | `{ matchId, opponent: { id, displayName } }` | Opponent found. |
| `GAME_STARTED` | `{ matchId, player1, player2, rounds: 5 }` | Match begins. |
| `TURN_START` | `{ round, countdownMs: 5000 }` | Round countdown begins. |
| `TURN_LOCKED` | `{}` | Both moves computed. |
| `TURN_REVEAL` | `{ round, player1Move, player2Move, winner: 'player1'\|'player2'\|'draw', score: { player1, player2 } }` | Simultaneous reveal. |
| `MATCH_RESULT` | `{ winner: 'player1'\|'player2'\|'draw', finalScore: { player1, player2 }, rounds: [{ round, player1Move, player2Move, winner }] }` | Match over. |
| `QUEUE_EXPIRED` | `{ reason: 'timeout' }` | Queue slot expired. |
| `MATCH_CANCELLED` | `{ reason }` | Match cancelled before start. |
| `OPPONENT_DISCONNECTED` | `{}` | Opponent left mid-match. |
| `ERROR` | `{ code, message }` | General error. |

#### Connection Lifecycle

```
connect          → server validates auth, restores active match/queue state
disconnect       → server marks disconnected, starts forfeit timer (30s)
reconnect        → server restores state, resumes if within window
```

### 3.3 Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `QUEUE_FULL` | 429 | Server at max capacity (20 CCU / 10 matches) |
| `ALREADY_IN_QUEUE` | 409 | User already queued |
| `ALREADY_IN_MATCH` | 409 | User has active match |
| `NO_ACTIVE_STRATEGY` | 400 | No strategy selected or compile failed |
| `STRATEGY_COMPILING` | 409 | Strategy still compiling |
| `STRATEGY_INVALID` | 400 | Compile failed, strategy unusable |
| `COMPILE_QUOTA_EXCEEDED` | 429 | Daily compile limit reached |
| `MATCH_NOT_FOUND` | 404 | Invalid match ID |
| `UNAUTHORIZED` | 401 | Invalid/expired token |

---

## 4. AI Worker Interface

### 4.1 Compile Pipeline

```
User submits prompt
  → POST /v1/strategies (or PUT)
  → Validate prompt (length ≤ 500, content rules)
  → Call LLM with system prompt + user prompt
  → LLM returns JS function body
  → Server wraps in template:
      (input) => { /* LLM output here */ }
  → Compile test: new Function() or vm.Script — syntax check
  → Smoke test: run with 3-5 fixtures
      Fixtures: [{ myHistory: [], opponentHistory: [], currentRound: 1 },
                 { myHistory: ['rock'], opponentHistory: ['paper'], currentRound: 2 },
                 { myHistory: ['rock','paper'], opponentHistory: ['paper','scissors'], currentRound: 3 }]
  → Validate output: must be 'rock' | 'paper' | 'scissors' for every fixture
  → If fail: retry 1x with error feedback to LLM
  → If pass: persist compiled_js + prompt_hash, set status ACTIVE
  → Cache in Redis
```

### 4.2 Compile Request (internal to LLM)

```json
{
  "system": "You generate a JavaScript function body for Rock-Paper-Scissors strategy. Input: { myHistory: string[], opponentHistory: string[], currentRound: number }. Output: exactly 'rock', 'paper', or 'scissors'. Return ONLY the function body, no wrapping.",
  "user": "<user prompt>",
  "max_tokens": 500,
  "temperature": 0.3
}
```

### 4.3 Execute Request (AI Worker ← Game Gateway)

```json
{
  "strategyId": "uuid",
  "strategyVersion": 3,
  "compiledJs": "(input) => { /* ... */ }",
  "input": {
    "myHistory": ["rock", "paper", "scissors"],
    "opponentHistory": ["paper", "rock", "rock"],
    "currentRound": 4
  }
}
```

### 4.4 Execute Response (AI Worker → Game Gateway)

**Success:**
```json
{
  "status": "ok",
  "move": "rock",
  "executionTimeMs": 3
}
```

**Fallback:**
```json
{
  "status": "fallback",
  "move": "paper",
  "reason": "timeout",
  "executionTimeMs": 52
}
```

### 4.5 Error Codes (Worker)

| Code | Meaning | Action |
|------|---------|--------|
| `TIMEOUT` | Execution exceeded 50ms hard cap | Fallback random |
| `INVALID_OUTPUT` | Strategy returned non-rock/paper/scissors | Fallback random |
| `EXECUTION_ERROR` | Strategy threw exception | Fallback random |
| `NO_STRATEGY` | No compiled strategy for player | Fallback random |
| `SANDBOX_ERROR` | Isolate crash or memory exceeded 8MB | Fallback random, recycle isolate |

### 4.6 Worker Constraints

- **Process:** Dedicated worker process (NOT inside NestJS gateway)
- **Runtime:** `isolated-vm` or equivalent V8 isolate
- **Timeout:** 50ms hard cap (kill isolate)
- **Memory:** 8MB per isolate
- **Capabilities:** ZERO. No `require`, `import`, `fetch`, `fs`, `process`, `globalThis` access. Only `input` parameter + pure JS.
- **Pool:** Pre-warmed isolate pool (4-5 isolates). Reuse, don't create per turn.
- **Concurrency:** Max 4-5 concurrent executions (matches 20 CCU target)

---

## 5. Queue System

### 5.1 Architecture

```
Redis Sorted Set (FIFO by timestamp)
Key: rps:queue
Score: timestamp (enqueue time)
Member: userId

+ Redis Hash per entry
Key: rps:queue:entry:{userId}
Fields: { strategyId, status, enqueuedAt, expiresAt }
```

### 5.2 Capacity Rules

| Limit | Value | Enforcement |
|-------|-------|-------------|
| Max CCU | 20 | Redis counter `rps:ccu`. INCR on connect, DECR on disconnect. |
| Max Active Matches | 10 | Redis counter `rps:active_matches`. INCR on MATCHED, DECR on MATCH_COMPLETE. |
| Max AI Workers | 4-5 concurrent | Worker pool size config. |
| One slot per user | 1 | DB unique constraint on `queue_entries.user_id` + Redis check. |

### 5.3 Queue Flow

```
User clicks "Find Match"
  1. Check: user not already in match or queue → else 409
  2. Check: user has active strategy → else 400
  3. Check: CCU < 20 AND active_matches < 10
     a. YES + another user waiting in queue → MATCH immediately
     b. YES + queue empty → MATCH immediately (wait for next user, max 120s)
     c. NO → add to queue (FIFO)
  4. If queued:
     - Set Redis ZADD rps:queue { timestamp, userId }
     - Set Redis HASH rps:queue:entry:{userId}
     - Emit QUEUED with position
     - Start 120s expiry timer
  5. Matchmaking loop (runs every 500ms):
     - Pop 2 users from queue head
     - Validate both still connected + have strategies
     - Create match record
     - Emit MATCH_FOUND to both
     - Transition both to MATCHED state
```

### 5.4 Expiry & Cleanup

- **Queue expiry:** 120s from enqueue. Checked by matchmaking loop.
- **On expiry:** Remove from Redis ZSET + HASH, update DB `queue_entries.status = EXPIRED`, emit `QUEUE_EXPIRED`.
- **On cancel:** Same cleanup, `status = CANCELLED`.
- **On disconnect:** Immediate removal, `status = CANCELLED`, release CCU slot.
- **On match:** Remove from queue, `status = MATCHED`.

### 5.5 Disconnect Handling

| Scenario | Action |
|----------|--------|
| Disconnect while `IDLE` | Decrement CCU. No other action. |
| Disconnect while `QUEUED` | Remove from queue. Release slot. Emit nothing (user offline). |
| Disconnect while `MATCHED` | Start 30s reconnect window. If no reconnect → forfeit match. |
| Disconnect while `IN_MATCH` (turn_active/mid-round) | Complete current round with fallback random for disconnected player. Start 30s reconnect window. If no reconnect → forfeit remaining rounds. |
| Disconnect while `MATCH_COMPLETE` | No action. Decrement CCU. |

### 5.6 Reconnect

```
Reconnect within window:
  1. Auth validate token
  2. Check Redis for active match state: rps:match:{matchId}
  3. If match exists and in progress → restore full state to client
     - Emit current TURN_START or TURN_REVEAL depending on timing
     - Send current score
  4. If no active match → return to IDLE
```

---

## 6. Cache Layer (Redis)

### 6.1 Key Namespace Convention

All keys prefixed with `rps:`

### 6.2 Key Definitions

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `rps:strategy:{userId}:{version}` | String | 24h | Cached compiled JS function body |
| `rps:strategy:active:{userId}` | String | 24h | Currently active strategy version reference |
| `rps:match:{matchId}` | Hash | Match duration + 5min | Ephemeral match state (status, scores, current round, player moves) |
| `rps:queue` | Sorted Set | — | FIFO queue (score=timestamp, member=userId) |
| `rps:queue:entry:{userId}` | Hash | 120s | Queue entry metadata |
| `rps:user:socket:{userId}` | String | — | Current socket ID for user |
| `rps:user:state:{userId}` | String | — | Current user state: `idle`/`queued`/`matched`/`in_match` |
| `rps:ccu` | Counter | — | Current connected users |
| `rps:active_matches` | Counter | — | Current active matches |
| `rps:compile_quota:{userId}:{date}` | Counter | 24h | Daily compile count |
| `rps:rate_limit:{userId}:{endpoint}` | Counter | 60s | Per-user rate limit per endpoint |

### 6.3 Match State Hash Fields

```
rps:match:{matchId}
  status: "turn_active"
  currentRound: 3
  player1Score: 1
  player2Score: 2
  player1Move: "rock"        (encrypted or hidden until reveal)
  player2Move: "paper"       (encrypted or hidden until reveal)
  player1StrategyVersion: 3
  player2StrategyVersion: 1
  turnStartedAt: 1709123456789
```

### 6.4 Invalidation Rules

| Event | Action |
|-------|--------|
| User recompiles strategy | Increment version → new cache key. Old key expires via TTL. `rps:strategy:active:{userId}` updated. |
| User activates different strategy | Update `rps:strategy:active:{userId}` |
| Match starts | Pin `strategyVersion` from active strategy. Cache key frozen for match duration. |
| Match ends | `rps:match:{matchId}` expires (TTL 5min after match_complete) |
| User disconnects | Remove `rps:user:socket:{userId}`. Decrement `rps:ccu`. |
| User reconnects | Set `rps:user:socket:{userId}`. Increment `rps:ccu`. |

### 6.5 Important Rules

- **No `KEYS()` scan.** Use targeted key lookups only.
- **Strategy cache is versioned.** Never mutate in-place.
- **Match state in Redis is ephemeral truth for live gameplay.** DB is source of truth for persistence. Match state flushed to DB on `MATCH_COMPLETE` and on each `ROUND_RESOLVED`.
- **CCU counter** must be accurate. Use `INCR`/`DECR` atomically.

---

## 7. Audit Trail

### 7.1 Per-Turn Record (stored in `turns` table)

Every turn for every player produces one row:

```
{
  match_id,           // which match
  round_number,       // 1-5
  player_id,          // who
  strategy_id,        // which strategy was used
  strategy_version,   // exact version (pinned)
  input_snapshot_hash,// SHA-256 of JSON.stringify(input) — for replay verification
  raw_output,         // exactly what the strategy function returned
  move,               // validated final move (ROCK/PAPER/SCISSORS/FALLBACK_RANDOM)
  fallback_reason,    // null or 'timeout'/'invalid_output'/'execution_error'/'no_strategy'
  execution_time_ms,  // how long the isolate took
  turn_started_at,    // when the turn began
  turn_locked_at      // when moves were locked
}
```

**Queryable patterns:**
- "What did player X's strategy do in round 3?" → `turns` WHERE match_id AND player_id AND round_number
- "How often does fallback trigger?" → `turns` WHERE fallback_reason IS NOT NULL
- "Replay entire match logically" → `turns` WHERE match_id ORDER BY round_number

### 7.2 Per-Match Record (stored in `matches` table)

```
{
  id,
  player1_id,
  player2_id,
  winner_id,              // null for draw
  player1_score,          // rounds won (0-3)
  player2_score,
  total_rounds,           // rounds played (1-5)
  status,                 // match_complete
  player1_strategy_id,    // pinned
  player1_strategy_version,
  player2_strategy_id,
  player2_strategy_version,
  started_at,
  ended_at
}
```

**Plus:** All individual `turns` rows linked by `match_id` give full round-by-round breakdown.

### 7.3 Compile Audit (stored in `compile_logs` table)

Every compile attempt produces one row:

```
{
  strategy_id,
  user_id,
  attempt,           // 1 or 2
  prompt_hash,       // what was compiled
  model,             // which LLM
  raw_output,        // raw LLM response (for debugging)
  compile_error,     // what went wrong
  success,           // boolean
  duration_ms,       // LLM call duration
  created_at
}
```

### 7.4 Dispute Resolution Workflow

1. User complains about match result
2. Query `matches` for match record
3. Query `turns` for all rounds → verify each move, check fallback_reason
4. If strategy seems wrong → query `compile_logs` for that strategy version → verify what was compiled
5. Replay logic locally: same input + same compiled_js = same move (deterministic)
6. Report findings to user

---

## Appendix A: Preset Strategies (hardcoded)

```javascript
// Aggressive — favors rock, varies occasionally
(input) => {
  const r = input.currentRound % 3;
  return ['rock', 'rock', 'scissors'][r];
}

// Defensive — plays what would have beaten opponent's last move
(input) => {
  if (input.opponentHistory.length === 0) return 'rock';
  const last = input.opponentHistory[input.opponentHistory.length - 1];
  return { rock: 'paper', paper: 'scissors', scissors: 'rock' }[last];
}

// Copycat — copies opponent's last move
(input) => {
  if (input.opponentHistory.length === 0) return 'rock';
  return input.opponentHistory[input.opponentHistory.length - 1];
}

// Chaotic — purely random
(input) => {
  return ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)];
}
```

## Appendix B: Timing Budget Per Turn (server-side)

```
Total turn time: 5000ms (countdown)

  T+0ms        TURN_START emitted
  T+0-100ms    Fetch history from Redis/DB
  T+100-150ms  Build input snapshot
  T+150-200ms  Send execute request to AI worker (player 1)
  T+150-200ms  Send execute request to AI worker (player 2)
  T+200-250ms  Worker executes (target <10ms, cap 50ms)
  T+250-300ms  Validate outputs, determine fallback if needed
  T+300ms      HARD CUTOFF — any unresolved move = fallback random
  T+300-400ms  Persist turn records
  T+400ms      TURN_LOCKED
  T+4500ms     TURN_REVEAL (show moves to clients simultaneously)
  T+5000ms     ROUND_RESOLVED (next turn or match end)
```

## Appendix C: Redis Key Expiry Summary

| Key Pattern | TTL | Renewal |
|-------------|-----|---------|
| `rps:strategy:{userId}:{version}` | 24h | On access (sliding) |
| `rps:strategy:active:{userId}` | 24h | On update |
| `rps:match:{matchId}` | 5min after MATCH_COMPLETE | No renewal |
| `rps:queue:entry:{userId}` | 120s | No renewal (auto-expire = queue expiry) |
| `rps:compile_quota:{userId}:{date}` | 24h | No renewal |
| `rps:rate_limit:{userId}:{endpoint}` | 60s | On each request (sliding) |
| `rps:user:socket:{userId}` | — | Manual delete on disconnect |
| `rps:ccu` | — | Never expires (counter) |
| `rps:active_matches` | — | Never expires (counter) |
