import colyseus from "colyseus";
import { randomUUID } from "node:crypto";
import os from "node:os";
import type { IncomingMessage } from "node:http";

const { Room, ServerError } = colyseus;
type Client = colyseus.Client;

type ClientMessage = {
  type: string;
  payload?: unknown;
};

type ParticipantRole = "player" | "spectator";

type ParticipantInfo = {
  nickname: string;
  token: string;
  connected: boolean;
  role: ParticipantRole;
  avatar?: string;
  lastPingMs?: number;
};

type LobbyConfig = {
  allowRejoin: boolean;
  allowMidgameJoin: boolean;
  maxPlayers: number | null;
  maxSpectators: number | null;
};

type LobbyStateSnapshot = {
  lobbyLocked: boolean;
  phase: "lobby" | "in-game";
};

const MAX_NICKNAME_LENGTH = 20;
const MAX_AVATAR_LENGTH = 8;
const DEFAULT_AVATAR = "\u{1F47E}";
const STATE_BROADCAST_MS = 250;

export class LobbyRoom extends Room {
  private participants = new Map<string, ParticipantInfo>();
  private sessionToParticipant = new Map<string, string>();
  private hostSessions = new Set<string>();
  private phase: "lobby" | "in-game" = "lobby";
  private lobbyLocked = false;
  private hostAddresses = new Set<string>();
  private stateDirty = false;
  private stateBroadcastInterval?: NodeJS.Timeout;
  private onConfigUpdate?: (config: LobbyConfig) => void;
  private onStateUpdate?: (state: LobbyStateSnapshot) => void;
  private config: LobbyConfig = {
    allowRejoin: true,
    allowMidgameJoin: false,
    maxPlayers: 8,
    maxSpectators: null
  };

  onCreate(options?: {
    config?: Partial<LobbyConfig>;
    lobbyLocked?: boolean;
    phase?: "lobby" | "in-game";
    onConfigUpdate?: (config: LobbyConfig) => void;
    onStateUpdate?: (state: LobbyStateSnapshot) => void;
  }) {
    this.config = {
      ...this.config,
      ...(options?.config ?? {})
    };
    this.onConfigUpdate = options?.onConfigUpdate;
    this.onStateUpdate = options?.onStateUpdate;
    if (typeof options?.lobbyLocked === "boolean") {
      this.lobbyLocked = options.lobbyLocked;
    }
    if (options?.phase === "lobby" || options?.phase === "in-game") {
      this.phase = options.phase;
    }
    this.hostAddresses = this.getHostAddresses();
    this.stateBroadcastInterval = setInterval(() => {
      if (!this.stateDirty) {
        return;
      }
      this.stateDirty = false;
      this.broadcastState();
    }, STATE_BROADCAST_MS);

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

      const participantId = this.sessionToParticipant.get(client.sessionId);
      if (!participantId) {
        return;
      }

      const participant = this.participants.get(participantId);
      if (!participant) {
        return;
      }

      const nickname = this.makeNickname(
        message.nickname ?? "",
        client.sessionId,
        participant.role,
        participantId
      );
      participant.nickname = nickname;
      this.markStateDirty();
    });

    this.onMessage("client:avatar", (client, message: { avatar?: string }) => {
      if (this.hostSessions.has(client.sessionId)) {
        return;
      }

      const participantId = this.sessionToParticipant.get(client.sessionId);
      if (!participantId) {
        return;
      }

      const participant = this.participants.get(participantId);
      if (!participant) {
        return;
      }

      const avatar = this.normalizeAvatar(message?.avatar);
      if (!avatar) {
        return;
      }

      participant.avatar = avatar;
      this.markStateDirty();
    });

    this.onMessage("client:ping", (client, message: { sentAt?: number }) => {
      const participantId = this.sessionToParticipant.get(client.sessionId);
      if (!participantId) {
        return;
      }

      const participant = this.participants.get(participantId);
      if (!participant) {
        return;
      }

      const sentAt = typeof message.sentAt === "number" ? message.sentAt : null;
      if (sentAt) {
        participant.lastPingMs = Math.max(0, Date.now() - sentAt);
        this.markStateDirty();
      }

      client.send("server:pong", {
        sentAt,
        receivedAt: Date.now(),
        pingMs: participant.lastPingMs ?? null
      });
    });

    this.onMessage("client:leave", (client) => {
      if (this.hostSessions.has(client.sessionId)) {
        return;
      }
      this.removeParticipantBySession(client.sessionId);
    });

    this.onMessage("host:start", (client) => {
      if (!this.hostSessions.has(client.sessionId)) {
        return;
      }

      if (this.phase !== "lobby") {
        return;
      }

      this.phase = "in-game";
      this.persistState();
      this.broadcast("game:start", {
        startedAt: Date.now(),
        startedBy: client.sessionId
      });
      this.markStateDirty();
    });

    this.onMessage("host:lock", (client, message: { locked?: boolean }) => {
      if (!this.hostSessions.has(client.sessionId)) {
        return;
      }

      this.lobbyLocked = Boolean(message.locked);
      this.persistState();
      this.markStateDirty();
    });

    this.onMessage("host:config", (client, message: { settings?: Partial<LobbyConfig> }) => {
      if (!this.hostSessions.has(client.sessionId)) {
        return;
      }

      if (!message?.settings) {
        return;
      }

      this.updateConfig(message.settings);
    });

    this.onMessage("host:kick", (client, message: { targetId?: string }) => {
      if (!this.hostSessions.has(client.sessionId)) {
        return;
      }

      if (!message?.targetId) {
        return;
      }

      this.kickParticipant(message.targetId);
    });
  }

  onAuth(
    _client: Client,
    options?: { role?: string; playerToken?: string },
    request?: IncomingMessage
  ) {
    if (options?.role === "host") {
      return this.isHostRequest(request);
    }

    const role = this.getParticipantRole(options);
    const playerToken = this.getPlayerToken(options);
    const isRejoin = this.config.allowRejoin && playerToken && this.participants.has(playerToken);

    if (this.lobbyLocked && !isRejoin) {
      throw new ServerError(
        4001,
        JSON.stringify({ code: "LOBBY_LOCKED", message: "Lobby is locked." })
      );
    }

    if (
      typeof this.maxClients === "number" &&
      this.maxClients > 0 &&
      this.clients.length >= this.maxClients &&
      !isRejoin
    ) {
      throw new ServerError(
        4002,
        JSON.stringify({ code: "LOBBY_FULL", message: "Lobby is full." })
      );
    }

    if (!this.config.allowMidgameJoin && this.phase === "in-game" && !isRejoin) {
      throw new ServerError(
        4003,
        JSON.stringify({
          code: "MIDGAME_JOIN_DISABLED",
          message: "Joining is disabled once the game starts."
        })
      );
    }

    if (this.isAtCapacity(role) && !isRejoin) {
      throw new ServerError(403, this.getCapacityError(role));
    }

    return true;
  }

  onJoin(
    client: Client,
    options?: { nickname?: string; role?: string; playerToken?: string; avatar?: string }
  ) {
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
      client.send("lobby:config", {
        settings: { ...this.config, lobbyLocked: this.lobbyLocked },
        phase: this.phase
      });
      this.markStateDirty();
      return;
    }

    const role = this.getParticipantRole(options);
    const playerToken = this.getPlayerToken(options);
    const existingParticipant = playerToken ? this.participants.get(playerToken) : undefined;

    if (existingParticipant && playerToken && this.config.allowRejoin) {
      existingParticipant.connected = true;
      if (!existingParticipant.avatar) {
        existingParticipant.avatar = DEFAULT_AVATAR;
      }
      this.sessionToParticipant.set(client.sessionId, playerToken);
      client.send("server:event", {
        from: "server",
        receivedAt: Date.now(),
        message: {
          type: "welcome",
          payload: {
            sessionId: client.sessionId,
            nickname: existingParticipant.nickname,
            token: existingParticipant.token,
            rejoined: true,
            role: existingParticipant.role,
            avatar: existingParticipant.avatar ?? DEFAULT_AVATAR
          }
        }
      });
      client.send("lobby:config", {
        settings: { ...this.config, lobbyLocked: this.lobbyLocked },
        phase: this.phase
      });
      this.markStateDirty();
      return;
    }

    if (this.isAtCapacity(role)) {
      client.leave(4002, this.getCapacityError(role));
      return;
    }

    const nickname = this.makeNickname(options?.nickname ?? "", client.sessionId, role);
    const avatar = this.normalizeAvatar(options?.avatar) ?? DEFAULT_AVATAR;
    const token = playerToken || randomUUID();
    const participant: ParticipantInfo = {
      nickname,
      token,
      connected: true,
      role,
      avatar
    };
    this.participants.set(token, participant);
    this.sessionToParticipant.set(client.sessionId, token);

    client.send("server:event", {
      from: "server",
      receivedAt: Date.now(),
      message: {
        type: "welcome",
        payload: { sessionId: client.sessionId, nickname, token, role, avatar }
      }
    });
    client.send("lobby:config", {
      settings: { ...this.config, lobbyLocked: this.lobbyLocked },
      phase: this.phase
    });

    this.markStateDirty();
  }

  onLeave(client: Client) {
    const participantId = this.sessionToParticipant.get(client.sessionId);
    if (participantId) {
      const participant = this.participants.get(participantId);
      if (participant && this.config.allowRejoin) {
        participant.connected = false;
      } else {
        this.participants.delete(participantId);
      }
      this.sessionToParticipant.delete(client.sessionId);
    }

    this.hostSessions.delete(client.sessionId);
    this.markStateDirty();
  }

  onDispose() {
    if (this.stateBroadcastInterval) {
      clearInterval(this.stateBroadcastInterval);
      this.stateBroadcastInterval = undefined;
    }
  }

  private broadcastState() {
    this.broadcast("lobby:state", this.buildStateSnapshot());
  }

  public getStateSnapshot() {
    return this.buildStateSnapshot();
  }

  private markStateDirty() {
    this.stateDirty = true;
  }

  private makeNickname(
    raw: string,
    sessionId: string,
    role: ParticipantRole,
    excludeParticipantId?: string
  ) {
    const base = raw.trim().replace(/\s+/g, " ").slice(0, MAX_NICKNAME_LENGTH);
    const prefix = role === "spectator" ? "Spectator" : "Player";
    const defaultName = `${prefix} ${sessionId.slice(0, 4).toUpperCase()}`;
    let nickname = base || defaultName;

    const existingNames = new Set(
      [...this.participants.entries()]
        .filter(([id]) => id !== excludeParticipantId)
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

  private getParticipantRole(options?: { role?: string }) {
    return options?.role === "spectator" ? "spectator" : "player";
  }

  private isAtCapacity(role: ParticipantRole) {
    const limit = role === "player" ? this.config.maxPlayers : this.config.maxSpectators;
    if (limit === null) {
      return false;
    }
    const count = [...this.participants.values()].filter(
      (participant) => participant.role === role
    ).length;
    return count >= limit;
  }

  private buildStateSnapshot() {
    const players = [...this.participants.entries()]
      .filter(([, info]) => info.role === "player")
      .map(([id, info]) => ({
        id,
        nickname: info.nickname,
        connected: info.connected,
        pingMs: info.lastPingMs ?? null,
        avatar: info.avatar ?? DEFAULT_AVATAR
      }));
    const spectators = [...this.participants.entries()]
      .filter(([, info]) => info.role === "spectator")
      .map(([id, info]) => ({
        id,
        nickname: info.nickname,
        connected: info.connected,
        pingMs: info.lastPingMs ?? null,
        avatar: info.avatar ?? DEFAULT_AVATAR
      }));

    const connectedPlayers = players.filter((player) => player.connected);

    return {
      players,
      spectators,
      count: connectedPlayers.length,
      totalCount: players.length,
      spectatorCount: spectators.filter((spectator) => spectator.connected).length,
      totalSpectatorCount: spectators.length,
      phase: this.phase,
      settings: { ...this.config, lobbyLocked: this.lobbyLocked }
    };
  }

  private getCapacityError(role: ParticipantRole) {
    return role === "spectator" ? "LOBBY_FULL_SPECTATOR" : "LOBBY_FULL_PLAYER";
  }

  private updateConfig(update: Partial<LobbyConfig>) {
    const next: LobbyConfig = { ...this.config };

    if (typeof update.allowRejoin === "boolean") {
      next.allowRejoin = update.allowRejoin;
    }
    if (typeof update.allowMidgameJoin === "boolean") {
      next.allowMidgameJoin = update.allowMidgameJoin;
    }

    if ("maxPlayers" in update) {
      const normalized = this.normalizeLimit(update.maxPlayers);
      if (normalized !== undefined) {
        next.maxPlayers = normalized;
      }
    }

    if ("maxSpectators" in update) {
      const normalized = this.normalizeLimit(update.maxSpectators);
      if (normalized !== undefined) {
        next.maxSpectators = normalized;
      }
    }

    this.config = next;
    if (this.onConfigUpdate) {
      this.onConfigUpdate({ ...this.config });
    }
    this.markStateDirty();
    this.broadcast("lobby:config", {
      settings: { ...this.config, lobbyLocked: this.lobbyLocked },
      phase: this.phase
    });
  }

  public applyConfigUpdate(update: Partial<LobbyConfig>) {
    this.updateConfig(update);
  }

  public applyLobbyLock(locked: boolean) {
    this.lobbyLocked = Boolean(locked);
    this.persistState();
    this.markStateDirty();
  }

  public applyPhaseUpdate(phase: "lobby" | "in-game") {
    if (phase !== "lobby" && phase !== "in-game") {
      return;
    }
    if (this.phase === phase) {
      return;
    }
    this.phase = phase;
    this.persistState();
    if (phase === "in-game") {
      this.broadcast("game:start", {
        startedAt: Date.now(),
        startedBy: "http"
      });
    }
    this.markStateDirty();
  }

  private normalizeLimit(limit?: number | null) {
    if (limit === null) {
      return null;
    }
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
      return undefined;
    }
    return Math.floor(limit);
  }

  private persistState() {
    if (!this.onStateUpdate) {
      return;
    }
    this.onStateUpdate({
      lobbyLocked: this.lobbyLocked,
      phase: this.phase
    });
  }

  private normalizeAvatar(raw?: string) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) {
      return null;
    }
    return trimmed.slice(0, MAX_AVATAR_LENGTH);
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

  private kickParticipant(token: string) {
    const participant = this.participants.get(token);
    if (!participant) {
      return;
    }

    const sessionId = [...this.sessionToParticipant.entries()].find(
      ([, participantToken]) => participantToken === token
    )?.[0];

    if (sessionId) {
      const client = this.clients.find((entry) => entry.sessionId === sessionId);
      if (client) {
        client.send("server:kick", { reason: "kicked" });
        client.leave(4000, "kicked");
      }
      this.sessionToParticipant.delete(sessionId);
    }

    this.participants.delete(token);
    this.markStateDirty();
  }

  private removeParticipantBySession(sessionId: string) {
    const participantId = this.sessionToParticipant.get(sessionId);
    if (!participantId) {
      return;
    }
    this.participants.delete(participantId);
    this.sessionToParticipant.delete(sessionId);
    this.markStateDirty();
  }

  private isHostRequest(request?: IncomingMessage) {
    const remoteAddress = request?.socket?.remoteAddress;
    if (!remoteAddress) {
      return false;
    }
    const normalized = this.normalizeAddress(remoteAddress);
    return this.hostAddresses.has(normalized);
  }

  private normalizeAddress(address: string) {
    const trimmed = address.trim();
    const withoutZone = trimmed.includes("%") ? trimmed.split("%")[0] : trimmed;
    if (withoutZone.startsWith("::ffff:")) {
      return withoutZone.slice("::ffff:".length);
    }
    return withoutZone;
  }

  private getHostAddresses() {
    const addresses = new Set<string>(["127.0.0.1", "::1"]);
    const interfaces = os.networkInterfaces();
    for (const details of Object.values(interfaces)) {
      for (const info of details ?? []) {
        if (!info.address) {
          continue;
        }
        addresses.add(this.normalizeAddress(info.address));
      }
    }
    return addresses;
  }
}
