# RPS Arena MVP — Task Breakdown

Status: Active
Spec reference: `MVP_FINAL_SPEC.md`
Repo: https://github.com/ROCK-PAPER-SCISOR/RPS-AI

---

## Stream 1 — Backend Core (Lebron / be-agent)

### BE-01: Codebase Gap Audit
**Title:** Audit v2 codebase gaps vs MVP spec
**Description:** Map every MVP spec requirement to v2 code. List what exists, what's missing, what needs port from v1.
**Assignee:** Lebron
**Effort:** 4h
**Dependencies:** —
**Acceptance:** Document with checklist: ✅ exists / ❌ missing / 🔄 needs port, per MVP spec section.

### BE-02: Best-of-5 Game Loop
**Title:** Implement best-of-5 match state machine
**Description:** Replace single-round logic with multi-round state machine: round index, score progression, first-to-3 winner, match completion.
**Assignee:** Lebron
**Effort:** 2d
**Dependencies:** BE-01
**Acceptance:** Match runs 5 rounds max, score tracked correctly, first-to-3 ends match, all round results persisted.

### BE-03: Turn Timing + Simultaneous Reveal
**Title:** Implement 5s countdown + simultaneous lock/reveal
**Description:** Server controls turn_start → compute both moves → turn_locked → simultaneous reveal. Decision cutoff at T-300ms before countdown end.
**Assignee:** Lebron
**Effort:** 1.5d
**Dependencies:** BE-02
**Acceptance:** Both moves computed before reveal, neither player sees opponent's move before lock, timing stays within 5s budget.

### BE-04: AI Strategy Module — Compile
**Title:** Implement prompt→strategy compile pipeline
**Description:** User submits prompt → LLM compiles to JS function body → wrap in server template → syntax check → smoke test (3-5 fixtures) → cache in Redis. Max 2 compile attempts.
**Assignee:** Lebron
**Effort:** 3d
**Dependencies:** BE-01
**Acceptance:** Valid prompt compiles to cached JS, invalid prompt returns clear error, compile-on-save (not on match start), retry with error feedback works.

### BE-05: AI Strategy Module — Execute
**Title:** Implement V8 isolate execution in dedicated worker
**Description:** Separate worker process (not NestJS main). Isolate pool, 50ms hard timeout, 8MB memory cap, zero-capability sandbox. Fallback to random on any failure.
**Assignee:** Lebron
**Effort:** 3d
**Dependencies:** BE-04
**Acceptance:** Strategy executes in <50ms, timeout/random fallback triggers reliably, no fs/network/process access from isolate, worker crash doesn't kill gateway.

### BE-06: Socket.IO Match Flow
**Title:** Implement full match WebSocket event flow
**Description:** Events: MATCH_FOUND → GAME_STARTED → TURN_START → TURN_LOCKED → TURN_RESULT → MATCH_RESULT + QUEUE state events (QUEUED, QUEUE_POSITION). Disconnect/rejoin support.
**Assignee:** Lebron
**Effort:** 2d
**Dependencies:** BE-02, BE-03
**Acceptance:** All UI states from MVP spec section 12 are reachable via Socket.IO events, reconnect restores match state.

### BE-07: Queue System
**Title:** Implement FIFO queue with capacity guardrails
**Description:** Max 10 active matches, 20 CCU. FIFO queue when full. One user = one active match OR one queue slot. 120s queue expiry. Disconnect releases slot.
**Assignee:** Lebron
**Effort:** 1.5d
**Dependencies:** BE-02
**Acceptance:** Queue enforces max capacity, FIFO ordering correct, expiry + disconnect release slots, no duplicate slots per user.

### BE-08: Audit Trail Persistence
**Title:** Implement per-turn + per-match audit logging
**Description:** Store per turn: match_id, turn_number, player_id, strategy_version, input hash, raw output, validated move, fallback reason, timestamps. Per match: winner, round outcomes, score progression, timing.
**Assignee:** Lebron
**Effort:** 1.5d
**Dependencies:** BE-02, BE-05
**Acceptance:** Every turn produces a queryable audit record; any match can be replayed logically from stored data.

### BE-09: Disconnect/Forfeit/Rejoin
**Title:** Implement robust disconnect handling
**Description:** Port and harden disconnect/forfeit/rejoin flow from v1. Idle timeout releases slot. Rejoin restores match state from Redis.
**Assignee:** Lebron
**Effort:** 1.5d
**Dependencies:** BE-06, BE-07
**Acceptance:** Disconnect mid-match → opponent wins remaining rounds OR match forfeited after timeout; rejoin within window restores state.

### BE-10: Strategy Presets
**Title:** Implement 4 built-in AI strategy presets
**Description:** Hardcoded strategies: Aggressive, Defensive, Copycat, Chaotic. Each is a pre-compiled JS function registered at boot.
**Assignee:** Lebron
**Effort:** 0.5d
**Dependencies:** BE-05
**Acceptance:** All 4 presets selectable, each produces valid moves, no LLM compile needed for presets.

### BE-11: Rate Limiting + Cost Guardrails
**Title:** Implement rate limits per MVP spec section 13
**Description:** Rate limit matchmaking join, strategy updates, prompt length cap. Compile quota (3 free/day suggested).
**Assignee:** Lebron
**Effort:** 1d
**Dependencies:** BE-04, BE-07
**Acceptance:** Rate limits enforced, prompt length capped, compile quota tracked, excess requests rejected with clear error.

### BE-12: Admin Metrics Endpoint
**Title:** Implement minimal admin visibility
**Description:** Endpoint returning: active match count, queue length, timeout rate, fallback rate, match completion rate, AI decision latency p50/p95.
**Assignee:** Lebron
**Effort:** 0.5d
**Dependencies:** BE-07, BE-08
**Acceptance:** Single endpoint returns all required metrics, updated in near-realtime.

---

## Stream 2 — Frontend (Bronny / fe-agent)

### FE-01: FE Codebase Review
**Title:** Review rps-web-client current state
**Description:** Map existing components, routes, Socket.IO integration, state management. Identify what to keep vs rebuild for MVP.
**Assignee:** Bronny
**Effort:** 4h
**Dependencies:** —
**Acceptance:** Document listing reusable components, dead code, and components needing rewrite for AI strategy MVP.

### FE-02: Lobby UI
**Title:** Implement lobby page with strategy selection
**Description:** Strategy picker (4 presets + custom prompt input), "Find Match" button. Clean, minimal, clear CTAs.
**Assignee:** Bronny
**Effort:** 2d
**Dependencies:** FE-01
**Acceptance:** User can select preset or type custom prompt, see strategy preview, click find match. No wallet required to browse lobby.

### FE-03: Queue State Display
**Title:** Implement queue waiting UI
**Description:** Show queue position, estimated wait, cancel button. Only visible when actually queued (not default state).
**Assignee:** Bronny
**Effort:** 0.5d
**Dependencies:** FE-02, BE-07 (Socket events)
**Acceptance:** Queue position updates in real-time, cancel removes from queue, queue UI hidden when not queued.

### FE-04: Match UI — Countdown + Score
**Title:** Implement match view with turn countdown and score
**Description:** Show both players, round counter (X/5), score, 5s countdown animation per turn. Backend-authoritative — no client-side move selection.
**Assignee:** Bronny
**Effort:** 2.5d
**Dependencies:** FE-01, BE-06 (Socket events)
**Acceptance:** Countdown runs smoothly, score updates per round, round result appears immediately after countdown lock, match result shown at end.

### FE-05: Match Result + History
**Title:** Implement match result screen and basic history
**Description:** Win/lose/draw display, round-by-round breakdown, "Play Again" button. Link to match history list.
**Assignee:** Bronny
**Effort:** 1.5d
**Dependencies:** FE-04
**Acceptance:** Match result shows all round outcomes, play again re-queues, history accessible from profile.

### FE-06: Wallet Connect Flow
**Description:** Wallet connect via existing wagmi/ConnectKit setup. Deposit/withdraw flows. Balance display in lobby and match.
**Assignee:** Bronny
**Effort:** 1.5d
**Dependencies:** FE-02
**Acceptance:** Wallet connects, balance displays correctly, deposit/withdraw flows work, disconnect handled gracefully.

### FE-07: Connection State + Reconnect
**Title:** Implement connection status and reconnect UX
**Description:** Show connected/disconnected state. Auto-reconnect with match state restoration. Clear messaging on disconnect.
**Assignee:** Bronny
**Effort:** 1d
**Dependencies:** FE-04, BE-09
**Acceptance:** Disconnect shown immediately, reconnect restores match state if within window, no stale UI after reconnect.

### FE-08: Responsive + Polish
**Title:** Responsive layout and visual polish
**Description:** Mobile-friendly layout, animations for countdown/results, loading states, empty states. Consistent with existing design system.
**Assignee:** Bronny
**Effort:** 2d
**Dependencies:** FE-04, FE-05
**Acceptance:** Works on mobile (320px+) and desktop, all states have visual feedback, no layout breaks.

---

## Stream 3 — Infra + Contracts (Lebron backup)

### IN-01: DB Schema + Migrations
**Title:** Design and implement MVP database schema
**Description:** Extend Prisma schema for: best-of-5 match rounds, strategy versions, audit trail tables, compile history. Migration scripts.
**Assignee:** Lebron
**Effort:** 1.5d
**Dependencies:** BE-01
**Acceptance:** Schema supports all MVP data requirements (section 9), migration runs clean, indexes on hot queries.

### IN-02: Redis State Schema
**Title:** Define Redis keys/structures for match state
**Description:** Design Redis keys for: active matches, queue, user→room mapping, strategy cache, compile cache. Replace `keys()` scan with proper key patterns.
**Assignee:** Lebron
**Effort:** 0.5d
**Dependencies:** BE-07
**Acceptance:** All Redis operations use targeted key lookups (no `keys()` scan), TTLs set, naming convention documented.

### IN-03: Docker + Environment Config
**Title:** Update docker-compose for MVP requirements
**Description:** Add AI worker service container, Redis config, environment variables for all new services. Separate dev/staging/prod configs.
**Assignee:** Lebron
**Effort:** 0.5d
**Dependencies:** BE-05
**Acceptance:** `docker-compose up` starts all services (gateway, worker, redis, postgres), all services connect and healthy.

### IN-04: Contract Integration Review
**Title:** Review and validate contract-v1 integration with MVP
**Description:** Verify GameFund deposit/withdraw flow works with new match/settlement flow. Ensure settlement is separated from realtime match (spec section 10). Update EIP-712 signing if needed.
**Assignee:** Lebron
**Effort:** 1d
**Dependencies:** BE-02, IN-01
**Acceptance:** Deposit works, withdrawal after match settlement works, blockchain delay never blocks in-match UX, signed withdrawals valid.

---

## Dependency Graph (simplified)

```
Stream 1:  BE-01 → BE-02 → BE-03 → BE-06
                 ↘         ↗
                  BE-05 (from BE-04)
                 ↗
Stream 2:  FE-01 → FE-02 → FE-03, FE-06
                 ↘
                  FE-04 → FE-05 → FE-08
                           ↘
                            FE-07

Stream 3:  IN-01 (from BE-01)
           IN-02 (from BE-07)
           IN-03 (from BE-05)
           IN-04 (from BE-02, IN-01)
```

## Parallelism Notes

- **Stream 1 + Stream 2** start simultaneously after BE-01 and FE-01 complete.
- **Stream 3** tasks are small and can be picked up by Lebron between Stream 1 tasks or by a backup.
- **Critical path:** BE-04 → BE-05 → BE-06 (AI strategy is the longest lead item).
- **FE can proceed** with mock Socket events until BE-06 delivers real events.

## Total Effort Estimate

| Stream | Tasks | Estimate |
|--------|-------|----------|
| Backend Core | 12 | ~18d |
| Frontend | 8 | ~11d |
| Infra + Contracts | 4 | ~3.5d |
| **Total** | **24** | **~32.5d** (parallel = ~18-20d wall time) |
