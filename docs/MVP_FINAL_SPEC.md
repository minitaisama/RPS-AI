# RPS with AI Prompt — MVP Final Spec

Status: Frozen MVP v1
Domain: `domains/RPS`
Audience: CEO, Coach, Lebron, Bronny, Curry

---

## 1. Product Goal
Ship a small, smooth, understandable MVP for **Rock / Paper / Scissors with AI strategy prompts**.

Primary goals:
- Support **up to 20 CCU** reliably
- Feel **realtime and fair**
- Keep infra and token cost low
- Learn from real users before expanding scope

### Product positioning
**Người chơi set chiến lược bằng prompt, AI đánh thay họ trong trận RPS best-of-5.**

Short English positioning:
> Bring your brain, not your reflexes — RPS Arena where your AI strategy fights for you.

---

## 2. Core MVP Scope

### 2.1 Match format
- 1v1 match
- Best-of-5
- 5-second countdown per turn
- First to 3 wins the match

### 2.2 AI strategy
- User can create AI behavior with a **short prompt**
- Prompt is compiled once into a **strategy version**
- AI plays automatically for the user during the match
- User does **not** manually pick rock/paper/scissors in this MVP

### 2.3 Built-in presets
Provide 4 built-in presets so users can start immediately:
- Aggressive
- Defensive
- Copycat
- Chaotic

### 2.4 Core UX flow
1. User enters lobby
2. User chooses preset or writes prompt
3. System queues/matches the user
4. User enters 1v1 match
5. 5 rounds max, each with 5-second countdown
6. Match ends, result shown, basic history updated

---

## 3. Explicit Scope Down
The MVP is intentionally narrow.

### In scope
- Wallet connect + deposit
- 1v1 best-of-5 RPS
- 5s countdown per turn
- Prompt-driven AI strategy
- 4 presets
- Backend-authoritative game resolution
- Dedicated AI worker process
- Queue when server is full
- Basic lobby
- Basic match history
- Basic leaderboard
- Minimal admin visibility

### Out of scope
- BYOK / user API keys
- External live LLM inference every turn
- Mid-match prompt editing
- Tournament mode
- Spectator mode
- Full replay UI / replay VOD
- Deep analytics
- Marketplace / strategy sharing platform
- Multi-mode beyond 1v1 best-of-5
- Public scripting platform
- Native mobile app
- Roll-da-Dice scope

---

## 4. Realtime / Capacity Targets

### 4.1 Capacity limits
- Max **20 CCU**
- Max **10 active matches**
- Max **4–5 AI executions concurrently**

### 4.2 Queue rules
- Queue is a **guardrail**, not the main experience
- If capacity is available, user enters match immediately
- If full, user enters FIFO queue
- One user may hold only:
  - one active match, or
  - one queue slot
- Queue expiry: ~120 seconds
- Disconnect/idle too long: release slot

### 4.3 Match duration targets
- Target match duration: 30–40 seconds
- Hard max match duration: 60–90 seconds

---

## 5. Technical Gameplay Rules

### 5.1 Backend authoritative
The backend is the single authority for:
- turn start
- move generation
- lock/reveal timing
- round resolution
- score progression
- match completion
- persistence

Frontend only renders:
- countdown
- current score
- round result
- connection state
- final result

### 5.2 Simultaneous lock and reveal
Each turn must follow this flow:
1. `turn_start`
2. backend computes both moves
3. `turn_locked`
4. simultaneous reveal
5. resolve winner and score

This is required for fairness perception.

### 5.3 Strategy version pinning
- Each match pins a fixed `strategy_version` for each player
- Prompt or preset changes do not affect an in-progress match

---

## 6. AI Architecture Decision

### 6.1 Core decision
**Do not call an external LLM live on every turn.**

Instead:
- User submits prompt
- Backend compiles the prompt once into a strategy representation
- Strategy is cached
- Match turns execute that compiled strategy server-side

### 6.2 Why this is frozen
This is the main MVP boundary because it protects:
- latency
- cost
- fairness
- capacity planning
- predictability

### 6.3 Allowed turn inputs
Per turn, a strategy may only read:
- permitted match history window
- its own strategy version/config
- allowed match state inputs

It must not access:
- current hidden opponent move
- server secrets
- filesystem
- network
- process internals
- hidden metadata

---

## 7. Worker / Sandbox Requirements
AI execution must run in a **dedicated worker process**, not inside the main gateway process.

Sandbox requirements:
- hard timeout
- memory cap
- no fs access
- no network access
- no `process`, `require`, or unrestricted globals

Recommended baseline discussed:
- isolated worker process
- isolate memory cap around 8 MB
- execution timeout around 50 ms for the isolated strategy execution path

Note:
- compile-time and run-time are separate concerns
- run-time execution must remain tiny and deterministic enough for 20 CCU smoothness

---

## 8. Timeout / Fallback Policy

### 8.1 Turn timing
- Soft target per AI decision: ~1 second
- Hard max: ~1.5 seconds

### 8.2 On failure
If strategy execution:
- times out
- throws
- returns invalid output
- produces malformed data

Then backend must:
- fallback immediately to random
- continue the match
- record fallback reason

### 8.3 Output validation
Valid outputs are exactly:
- `rock`
- `paper`
- `scissors`

Any other output becomes fallback random.

---

## 9. Fairness / Audit Requirements
MVP still needs enough auditability for disputes.

### 9.1 Per-turn artifact
Store at least:
- `match_id`
- `turn_number`
- `player_id`
- `strategy_version`
- normalized input snapshot or input hash
- raw strategy output
- validated final move
- fallback reason if any
- timestamps

### 9.2 Match-level data
Store at least:
- final winner
- all round outcomes
- score progression
- strategy versions used
- basic timing metadata

### 9.3 Goal
When a user complains, the team must be able to:
- explain what happened
- debug disputes
- replay match logic at backend level
- investigate fairness concerns

Replay UI is not required in MVP.

---

## 10. Wallet / Settlement Boundary
Wallet and deposit are in scope, but **realtime gameplay must not depend on blockchain round-trip timing**.

Rules:
- Realtime match resolution happens in backend game loop
- On-chain settlement receives finalized match outcome
- Blockchain delay/failure must not freeze in-match UX

This separation is required for smooth realtime play.

---

## 11. Infra MVP

### 11.1 Minimum architecture
- 1 backend service
- NestJS v2
- Socket.IO for realtime
- 1 DB for persistent data
- Redis recommended for:
  - queue
  - ephemeral match state
  - compile cache

### 11.2 Minimal admin visibility
Need at least:
- active match count
- queue length
- timeout rate
- fallback rate
- match completion rate
- AI decision latency p50/p95

---

## 12. UX Requirements
To feel smooth, users must always understand current system state.

### Required UI states
- Finding match
- In queue
- Match found
- Turn X/5
- Countdown running
- Round result
- Current score
- Match finished
- Reconnect / disconnected

### UX principles
- Very little copy
- Clear system status
- Result appears immediately after countdown lock
- Queue only shown when actually needed
- User should not need technical understanding to start playing

---

## 13. Cost-Control Guardrails
MVP must actively defend against unnecessary model/compute cost.

Guardrails:
- max 20 CCU
- max 10 active matches
- rate limit matchmaking/join
- rate limit strategy updates
- prompt length limit
- compile quota per user/day if needed
- no BYOK
- no live external model inference every turn

CEO-discussed idea that may be applied later if desired:
- limited free compiles/day/user, then paid or otherwise restricted

This is not required to block MVP implementation, but the architecture should allow it.

---

## 14. Success Criteria
MVP is successful if:
1. User can enter and understand the game quickly
2. User can choose preset or write prompt easily
3. 20 users can play without obvious lag or broken flow
4. Countdown does not stall waiting on AI
5. Timeout/failure does not break the match
6. Audit trail is sufficient for dispute investigation
7. Infra and cost remain lean

---

## 15. Main Risks

### Product risks
- Overpromising “AI” sophistication
- Poor prompts causing users to think the game is dumb
- Queue becoming visible too often and hurting UX

### Technical risks
- Match state race conditions
- Ambiguous timeout/fallback behavior
- Fairness perception issues if reveal/lock behavior is unclear
- Sandbox or worker isolation not being strict enough
- Wallet/settlement coupling accidentally degrading realtime UX

---

## 16. Final Frozen Summary
**RPS Arena MVP** is:
- 1v1 AI-vs-AI best-of-5
- 5s per turn
- backend-authoritative
- prompt-driven AI strategy
- compile once, execute server-side
- no BYOK
- no live LLM per turn
- max 20 CCU
- max 10 active matches
- queue when full
- hard timeout + fallback random
- turn-level audit trail
- wallet/deposit in scope, but settlement separated from realtime match loop

---

## 17. Team Base Recommendation
Use this document as the **single MVP freeze reference** before writing:
- PRD/task cards
- engineering spec
- API contracts
- state machine
- UI implementation
- QA acceptance criteria

Suggested next documents:
1. `ENGINEERING_SPEC_V1.md`
2. `TASK_BREAKDOWN_MVP.md`
3. `API_CONTRACTS_MVP.md`
4. `MATCH_STATE_MACHINE.md`
