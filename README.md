# LexPlay LAN Framework

Local-first party-game framework for LexPlay / Run Jump Dev. The goal is a Jackbox-style experience: one host machine runs the game server, players join via QR on the same Wi-Fi, and phone browsers act as controllers. The framework is designed to plug into a Unity template later without requiring paid hosting.

## Quick start

From `server/`:

```
npm install
npm run dev
```

Open `http://localhost:2567/host` on the host machine. Scan the QR with a phone on the same Wi-Fi.

## Repo layout

- `server/` Node + Express + Colyseus (authoritative rooms)
- `client/` static phone UI served by the host machine
- `protocol/` message format documentation

## Documentation

- Developer-focused details (endpoints, environment flags, lobby behavior, architecture diagram) live in `AGENTS.md`.
- Protocol message formats are documented in `protocol/README.md`.

## Project status

Early development. Next planned steps include Unity host integration and the first game flow.
