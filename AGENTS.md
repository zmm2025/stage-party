# AGENTS

## Project summary
LexPlay LAN Framework is a local-first party-game framework for LexPlay / Run Jump Dev.
The goal is a Jackbox-style experience: one host machine runs the game server, players join
via QR on the same Wi-Fi, and phone browsers act as controllers. The framework is designed
so a Unity template can plug in later without requiring paid hosting.

## Architecture diagram (current)
```
   host browser (/host)
          |
          | 1) fetch /host-data (QR + join URLs)
          v
   Node/Express + Colyseus
          |
          | 2) serves / (client) + /vendor + /host
          | 3) WebSocket rooms (lobby)
          v
   player phones (/)
```

## Repo layout
- `server/` Node + Express + Colyseus (authoritative rooms).
- `client/` static phone UI served by the host machine.
- `protocol/` message format documentation.

## Local development
From `server/`:
```
npm install
npm run dev
```

Open `http://localhost:2567/host` on the host machine. Scan the QR with a phone on the same Wi-Fi.

## URLs and endpoints
- `/` phone client
- `/host` host page (QR + player list)
- `/host-data` JSON (QR data + join URLs)
- `/health` JSON health check

## Client behavior
- Join flow: nickname -> `joinOrCreate("lobby")`.
- Server broadcasts `lobby:state` with player list.
- Phone UI can send `client:event` (ping demo).

## Host address override
If the QR should use a specific LAN IP or hostname:
```
set HOST_ADDRESS=192.168.1.50
npm run dev
```

## Lobby configuration
These flags let game teams decide lobby behavior without code changes:
```
set LOBBY_REQUIRE_READY=true
set LOBBY_ALLOW_REJOIN=true
set LOBBY_ALLOW_MIDGAME_JOIN=false
npm run dev
```

The host page (`/host`) shows a QR code for joining and a live player list.
Players join with nicknames and can ready up if `LOBBY_REQUIRE_READY=true`.

## Protocol reference
`protocol/README.md` documents message formats for the lobby and `/host-data` payloads.
