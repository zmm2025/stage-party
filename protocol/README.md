# Protocol

This folder documents client/host/server message formats.

## Lobby messages

### Client -> Server
- `joinOrCreate("lobby")` options:
  - `{ nickname?: string, role?: "player" | "spectator" | "host", playerToken?: string, avatar?: string }`
  - `role: "host"` is only allowed from the server machine.
  - Join can fail with `ServerError` message `LOBBY_FULL_PLAYER` or `LOBBY_FULL_SPECTATOR` when
    the lobby is at capacity for the selected role.
- `client:event` payload:
  - `{ type: string, payload?: unknown }`
- `client:ping` payload:
  - `{ sentAt: number }`
- `client:nickname` payload:
  - `{ nickname?: string }`
- `client:ready` payload:
  - `{ ready?: boolean }`
- `client:avatar` payload:
  - `{ avatar?: string }`
> **Note for Unity integrations:** host controls and lobby configuration are now driven via HTTP
> endpoints (see [Lobby HTTP endpoints](#lobby-http-endpoints)). The WebSocket `host:*` messages
> below are primarily used by the browser host UI.
- `host:lock` payload:
  - `{ locked: boolean }`
- `host:kick` payload:
  - `{ targetId: string }`
- `host:start` payload:
  - `{}`

### Server -> Client
- `server:event` payload:
  - `{ from: string, receivedAt: number, message: { type: string, payload?: unknown } }`
  - `message.type = "welcome"` payload:
    - `{ sessionId: string, nickname: string, token: string, role: "player" | "spectator", avatar?: string, rejoined?: boolean, ready?: boolean }`
- `joinOrCreate("lobby")` can reject with errors encoded as JSON in the error message:
  - `{ code: "LOBBY_LOCKED", message: string }` when the host locks the lobby.
  - `{ code: "MIDGAME_JOIN_DISABLED", message: string }` when mid-game joins are disabled.
  - `{ code: "LOBBY_FULL", message: string }` when max clients are already connected.
- `server:pong` payload:
  - `{ sentAt: number, receivedAt: number, pingMs: number | null }`
- `lobby:state` payload:
  - `{ count: number, totalCount: number, readyCount: number, allReady: boolean, phase: "lobby" | "in-game", settings: { requireReady: boolean, allowRejoin: boolean, allowMidgameJoin: boolean, lobbyLocked: boolean, maxPlayers: number | null, maxSpectators: number | null }, players: Array<{ id: string, nickname: string, ready: boolean, connected: boolean, pingMs: number | null, avatar: string }>, spectatorCount: number, totalSpectatorCount: number, spectators: Array<{ id: string, nickname: string, connected: boolean, pingMs: number | null }> }`
- `lobby:config` payload:
  - `{ settings: { requireReady: boolean, allowRejoin: boolean, allowMidgameJoin: boolean, lobbyLocked: boolean, maxPlayers: number | null, maxSpectators: number | null }, phase: "lobby" | "in-game" }`
- `game:start` payload:
  - `{ startedAt: number, startedBy: string }`
- `host:error` payload:
  - `{ message: string }`
- `server:kick` payload:
  - `{ reason: string }`

## Host data endpoint

- `GET /host-data` returns:
  - `{ joinUrls: string[], qrDataUrl: string }`

## Lobby HTTP endpoints

All endpoints below are intended for Unity host integrations and are restricted to the host machine.

- `POST /lobby/ensure` returns:
  - `{ ok: true, roomId: string }` (creates the lobby room if it does not exist)
- `GET /lobby/state` returns the same payload as the `lobby:state` WebSocket message.
- `GET /lobby/config` returns:
  - `{ settings: { requireReady: boolean, allowRejoin: boolean, allowMidgameJoin: boolean, lobbyLocked: boolean, maxPlayers: number | null, maxSpectators: number | null }, phase: "lobby" | "in-game" }`
- `PUT /lobby/config` accepts:
  - `{ requireReady?: boolean, allowRejoin?: boolean, allowMidgameJoin?: boolean, maxPlayers?: number | null, maxSpectators?: number | null }`
  - returns the updated config payload (same shape as `GET /lobby/config`)
- `POST /lobby/lock` accepts:
  - `{ locked: boolean }`
  - returns `{ ok: true, locked: boolean }`
- `POST /lobby/start` returns:
  - `{ ok: true }` (or `409` with `{ error: string }`)
- `POST /lobby/kick` accepts:
  - `{ targetId: string }`
  - returns `{ ok: true, targetId: string }`

## Lobby configuration sources

Lobby settings are configured through the host UI or the HTTP endpoints above. Environment
variables are no longer used for lobby configuration.
