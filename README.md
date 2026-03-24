# rps-ai-server

Lean NestJS skeleton cho RPS Arena MVP.

## Scope hiện có
- NestJS project skeleton
- Modules: `game`, `strategy`, `queue`, `wallet`, `audit`
- Socket.IO gateway cho match realtime
- Match state machine MVP-first
- AI worker mock = random move generator để test flow
- Docker + `.env.example`

## Match state machine

```text
idle -> queued -> matched -> turn_active -> turn_locked -> turn_revealed -> match_complete
```

- best-of-5
- first to 3 wins
- 5s mỗi turn
- backend authoritative
- simultaneous lock/reveal semantics

## Run local

```bash
cp .env.example .env
npm install
npm run start:dev
```

HTTP server mặc định: `http://localhost:3000`

Socket.IO server mặc định: `ws://localhost:3001`

## Docker

```bash
cp .env.example .env
docker compose up --build
```

## Socket events hiện có

Client emit:
- `queue.join`
- `match.start`
- `match.state.get`

Server emit:
- `queue.joined`
- `match.found`
- `game.started`
- `turn.start`
- `turn.locked`
- `turn.result`
- `match.result`
- `match.state`

## Notes
- Đây là skeleton lean để unblock BE-01/02/03/06 direction.
- Chưa nối DB/Redis/worker thật.
- `strategy` module đang dùng random executor thay AI sandbox thật.
- `wallet` và `audit` module hiện là placeholder service để giữ boundary/module shape đúng MVP.
