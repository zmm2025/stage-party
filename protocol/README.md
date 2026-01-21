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
- `client:avatar` payload:
  - `{ avatar?: string }`
- `host:lock` payload:
  - `{ locked: boolean }`
- `host:kick` payload:
  - `{ targetId: string }`
- `host:start` payload:
  - `{}`
- `host:config` payload:
  - `{ settings: { allowRejoin?: boolean, allowMidgameJoin?: boolean, maxPlayers?: number | null, maxSpectators?: number | null } }`

### Server -> Client
- `server:event` payload:
  - `{ from: string, receivedAt: number, message: { type: string, payload?: unknown } }`
  - `message.type = "welcome"` payload:
    - `{ sessionId: string, nickname: string, token: string, role: "player" | "spectator", avatar: string, rejoined?: boolean }`
- `joinOrCreate("lobby")` can reject with errors encoded as JSON in the error message:
  - `{ code: "LOBBY_LOCKED", message: string }` when the host locks the lobby.
  - `{ code: "MIDGAME_JOIN_DISABLED", message: string }` when mid-game joins are disabled.
  - `{ code: "LOBBY_FULL", message: string }` when max clients are already connected.
- `server:pong` payload:
  - `{ sentAt: number, receivedAt: number, pingMs: number | null }`
- `lobby:state` payload:
  - `{ count: number, totalCount: number, phase: "lobby" | "in-game", settings: { allowRejoin: boolean, allowMidgameJoin: boolean, lobbyLocked: boolean, maxPlayers: number | null, maxSpectators: number | null }, players: Array<{ id: string, nickname: string, connected: boolean, pingMs: number | null, avatar: string }>, spectatorCount: number, totalSpectatorCount: number, spectators: Array<{ id: string, nickname: string, connected: boolean, pingMs: number | null, avatar: string }> }`
- `lobby:config` payload:
  - `{ settings: { allowRejoin: boolean, allowMidgameJoin: boolean, lobbyLocked: boolean, maxPlayers: number | null, maxSpectators: number | null }, phase: "lobby" | "in-game" }`
- `game:start` payload:
  - `{ startedAt: number, startedBy: string }`
- `host:error` payload:
  - `{ message: string }`
- `server:kick` payload:
  - `{ reason: string }`

## Host data endpoint

- `GET /host-data` returns:
  - `{ joinUrls: string[], qrDataUrl: string }`

## Host control endpoints

- `GET /lobby-settings` returns:
  - `{ settings: { allowRejoin: boolean, allowMidgameJoin: boolean, maxPlayers: number | null, maxSpectators: number | null }, lobbyLocked: boolean, phase: "lobby" | "in-game" }`
- `POST /lobby-settings` accepts:
  - `{ settings?: { allowRejoin?: boolean, allowMidgameJoin?: boolean, maxPlayers?: number | null, maxSpectators?: number | null } }`
- `POST /lobby-lock` accepts:
  - `{ locked: boolean }`
- `POST /lobby-phase` accepts:
  - `{ phase: "lobby" | "in-game" }`

## Lobby environment configuration

- `LOBBY_ALLOW_REJOIN` (boolean): allow clients to rejoin using the stored player token.
- `LOBBY_ALLOW_MIDGAME_JOIN` (boolean): allow joining after the game has started.
- `LOBBY_MAX_PLAYERS` (number): maximum number of player slots (unset = unlimited).
- `LOBBY_MAX_SPECTATORS` (number): maximum number of spectator slots (unset = unlimited).
