# Protocol

This folder documents client/host/server message formats.

## Lobby messages

### Client -> Server
- `client:event` payload:
  - `{ type: string, payload?: unknown }`
- `client:nickname` payload:
  - `{ nickname?: string }`

### Server -> Client
- `server:event` payload:
  - `{ from: string, receivedAt: number, message: { type: string, payload?: unknown } }`
- `lobby:state` payload:
  - `{ count: number, players: Array<{ id: string, nickname: string }> }`

## Host data endpoint

- `GET /host-data` returns:
  - `{ joinUrls: string[], qrDataUrl: string }`
