# Protocol

This folder documents client/host/server message formats.

## Lobby messages

### Client -> Server
- `client:event` payload:
  - `{ type: string, payload?: unknown }`
- `client:nickname` payload:
  - `{ nickname?: string }`
- `client:ready` payload:
  - `{ ready?: boolean }`
- `host:start` payload:
  - `{}`

### Server -> Client
- `server:event` payload:
  - `{ from: string, receivedAt: number, message: { type: string, payload?: unknown } }`
  - `message.type = "welcome"` payload:
    - `{ sessionId: string, nickname: string, token: string, rejoined?: boolean, ready?: boolean }`
- `lobby:state` payload:
  - `{ count: number, totalCount: number, readyCount: number, allReady: boolean, phase: "lobby" | "in-game", settings: { requireReady: boolean, allowRejoin: boolean, allowMidgameJoin: boolean }, players: Array<{ id: string, nickname: string, ready: boolean, connected: boolean }> }`
- `lobby:config` payload:
  - `{ settings: { requireReady: boolean, allowRejoin: boolean, allowMidgameJoin: boolean }, phase: "lobby" | "in-game" }`
- `game:start` payload:
  - `{ startedAt: number, startedBy: string }`
- `host:error` payload:
  - `{ message: string }`

## Host data endpoint

- `GET /host-data` returns:
  - `{ joinUrls: string[], qrDataUrl: string }`
