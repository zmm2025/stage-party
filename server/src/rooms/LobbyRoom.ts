import colyseus from "colyseus";
import { randomUUID } from "node:crypto";

const { Room } = colyseus;
type Client = colyseus.Client;

type ClientMessage = {
  type: string;
  payload?: unknown;
};

type PlayerInfo = {
  nickname: string;
  ready: boolean;
  token: string;
  connected: boolean;
};

type LobbyConfig = {
  requireReady: boolean;
  allowRejoin: boolean;
  allowMidgameJoin: boolean;
};

const MAX_NICKNAME_LENGTH = 20;

export class LobbyRoom extends Room {
  private players = new Map<string, PlayerInfo>();
  private sessionToPlayer = new Map<string, string>();
  private hostSessions = new Set<string>();
  private phase: "lobby" | "in-game" = "lobby";
  private config: LobbyConfig = {
    requireReady: false,
    allowRejoin: true,
    allowMidgameJoin: false
  };

  onCreate(options?: { config?: Partial<LobbyConfig> }) {
    this.config = {
      ...this.config,
      ...(options?.config ?? {})
    };

    this.onMessage("client:event", (client, message: ClientMessage) => {
      this.broadcast("server:event", {
        from: client.sessionId,
        receivedAt: Date.now(),
        message
      });
    });

    // Client can rename once connected; hosts are excluded.
    this.onMessage("client:nickname", (client, message: { nickname?: string }) => {
      if (this.hostSessions.has(client.sessionId)) {
        return;
      }

      const playerId = this.sessionToPlayer.get(client.sessionId);
      if (!playerId) {
        return;
      }

      const player = this.players.get(playerId);
      if (!player) {
        return;
      }

      const nickname = this.makeNickname(message.nickname ?? "", client.sessionId, playerId);
      player.nickname = nickname;
      this.broadcastState();
    });

    this.onMessage("client:ready", (client, message: { ready?: boolean }) => {
      if (this.hostSessions.has(client.sessionId)) {
        return;
      }

      const playerId = this.sessionToPlayer.get(client.sessionId);
      if (!playerId) {
        return;
      }

      const player = this.players.get(playerId);
      if (!player) {
        return;
      }

      player.ready = Boolean(message.ready);
      this.broadcastState();
    });

    this.onMessage("host:start", (client) => {
      if (!this.hostSessions.has(client.sessionId)) {
        return;
      }

      if (this.phase !== "lobby") {
        return;
      }

      if (this.config.requireReady && !this.allReady()) {
        client.send("host:error", { message: "Not everyone is ready yet." });
        return;
      }

      this.phase = "in-game";
      this.broadcast("game:start", {
        startedAt: Date.now(),
        startedBy: client.sessionId
      });
      this.broadcastState();
    });
  }

  onAuth(_client: Client, options?: { role?: string; playerToken?: string }) {
    if (options?.role === "host") {
      return true;
    }

    const playerToken = this.getPlayerToken(options);
    const isRejoin = this.config.allowRejoin && playerToken && this.players.has(playerToken);

    if (!this.config.allowMidgameJoin && this.phase === "in-game" && !isRejoin) {
      return false;
    }

    return true;
  }

  onJoin(client: Client, options?: { nickname?: string; role?: string; playerToken?: string }) {
    if (options?.role === "host") {
      this.hostSessions.add(client.sessionId);
      client.send("server:event", {
        from: "server",
        receivedAt: Date.now(),
        message: {
          type: "host:welcome",
          payload: { sessionId: client.sessionId }
        }
      });
      client.send("lobby:config", { settings: this.config, phase: this.phase });
      this.broadcastState();
      return;
    }

    const playerToken = this.getPlayerToken(options);
    const existingPlayer = playerToken ? this.players.get(playerToken) : undefined;

    if (existingPlayer && this.config.allowRejoin) {
      existingPlayer.connected = true;
      this.sessionToPlayer.set(client.sessionId, playerToken);
      client.send("server:event", {
        from: "server",
        receivedAt: Date.now(),
        message: {
          type: "welcome",
          payload: {
            sessionId: client.sessionId,
            nickname: existingPlayer.nickname,
            token: existingPlayer.token,
            rejoined: true,
            ready: existingPlayer.ready
          }
        }
      });
      client.send("lobby:config", { settings: this.config, phase: this.phase });
      this.broadcastState();
      return;
    }

    const nickname = this.makeNickname(options?.nickname ?? "", client.sessionId);
    const token = playerToken || randomUUID();
    const player: PlayerInfo = {
      nickname,
      ready: false,
      token,
      connected: true
    };
    this.players.set(token, player);
    this.sessionToPlayer.set(client.sessionId, token);

    client.send("server:event", {
      from: "server",
      receivedAt: Date.now(),
      message: {
        type: "welcome",
        payload: { sessionId: client.sessionId, nickname, token }
      }
    });
    client.send("lobby:config", { settings: this.config, phase: this.phase });

    this.broadcastState();
  }

  onLeave(client: Client) {
    const playerId = this.sessionToPlayer.get(client.sessionId);
    if (playerId) {
      const player = this.players.get(playerId);
      if (player && this.config.allowRejoin) {
        player.connected = false;
      } else {
        this.players.delete(playerId);
      }
      this.sessionToPlayer.delete(client.sessionId);
    }

    this.hostSessions.delete(client.sessionId);
    this.broadcastState();
  }

  private broadcastState() {
    const allPlayers = [...this.players.entries()].map(([id, info]) => ({
      id,
      nickname: info.nickname,
      ready: info.ready,
      connected: info.connected
    }));
    const connectedPlayers = allPlayers.filter((player) => player.connected);
    const readyCount = connectedPlayers.filter((player) => player.ready).length;

    this.broadcast("lobby:state", {
      players: allPlayers,
      count: connectedPlayers.length,
      totalCount: allPlayers.length,
      readyCount,
      allReady: connectedPlayers.length > 0 && readyCount === connectedPlayers.length,
      phase: this.phase,
      settings: this.config
    });
  }

  private makeNickname(raw: string, sessionId: string, excludePlayerId?: string) {
    const base = raw.trim().replace(/\s+/g, " ").slice(0, MAX_NICKNAME_LENGTH);
    const defaultName = `Player ${sessionId.slice(0, 4).toUpperCase()}`;
    let nickname = base || defaultName;

    const existingNames = new Set(
      [...this.players.entries()]
        .filter(([id]) => id !== excludePlayerId)
        .map(([, info]) => info.nickname.toLowerCase())
    );

    if (!existingNames.has(nickname.toLowerCase())) {
      return nickname;
    }

    let suffix = 2;
    let candidate = `${nickname} ${suffix}`;
    while (existingNames.has(candidate.toLowerCase())) {
      suffix += 1;
      candidate = `${nickname} ${suffix}`;
    }

    return candidate;
  }

  private allReady() {
    const connectedPlayers = [...this.players.values()].filter((player) => player.connected);
    if (connectedPlayers.length === 0) {
      return false;
    }
    return connectedPlayers.every((player) => player.ready);
  }

  private getPlayerToken(options?: { playerToken?: string }) {
    if (!this.config.allowRejoin) {
      return null;
    }
    const token = options?.playerToken;
    if (!token || typeof token !== "string") {
      return null;
    }
    return token.trim() || null;
  }
}
