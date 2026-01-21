import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import express from "express";
import colyseus from "colyseus";
import QRCode from "qrcode";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { LobbyRoom } from "./rooms/LobbyRoom.js";

const { Server, matchMaker } = colyseus;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = Number(process.env.PORT ?? 57493);
const app = express();
app.use(express.json());
const clientPath = path.resolve(__dirname, "..", "..", "client");
const vendorPath = path.resolve(__dirname, "..", "node_modules", "colyseus.js", "dist");

const parseEnvBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

const parseEnvNumber = (value: string | undefined) => {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
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

const lobbyConfig: LobbyConfig = {
  allowRejoin: parseEnvBool(process.env.LOBBY_ALLOW_REJOIN, true),
  allowMidgameJoin: parseEnvBool(process.env.LOBBY_ALLOW_MIDGAME_JOIN, false),
  maxPlayers: parseEnvNumber(process.env.LOBBY_MAX_PLAYERS) ?? 8,
  maxSpectators: parseEnvNumber(process.env.LOBBY_MAX_SPECTATORS)
};

const lobbyOptions: {
  config: LobbyConfig;
  lobbyLocked: boolean;
  phase: "lobby" | "in-game";
  onConfigUpdate: (nextConfig: LobbyConfig) => void;
  onStateUpdate: (nextState: LobbyStateSnapshot) => void;
} = {
  config: lobbyConfig,
  lobbyLocked: false,
  phase: "lobby" as "lobby" | "in-game",
  onConfigUpdate: (_nextConfig: typeof lobbyConfig) => {},
  onStateUpdate: (_nextState: LobbyStateSnapshot) => {}
};

const updateLobbyConfig = (nextConfig: typeof lobbyConfig) => {
  lobbyConfig.allowRejoin = nextConfig.allowRejoin;
  lobbyConfig.allowMidgameJoin = nextConfig.allowMidgameJoin;
  lobbyConfig.maxPlayers = nextConfig.maxPlayers;
  lobbyConfig.maxSpectators = nextConfig.maxSpectators;
};

const updateLobbyState = (nextState: { lobbyLocked: boolean; phase: "lobby" | "in-game" }) => {
  lobbyOptions.lobbyLocked = nextState.lobbyLocked;
  lobbyOptions.phase = nextState.phase;
};

lobbyOptions.onConfigUpdate = updateLobbyConfig;
lobbyOptions.onStateUpdate = updateLobbyState;

const normalizeAddress = (address: string) => {
  const trimmed = address.trim();
  const withoutZone = trimmed.includes("%") ? trimmed.split("%")[0] : trimmed;
  if (withoutZone.startsWith("::ffff:")) {
    return withoutZone.slice("::ffff:".length);
  }
  return withoutZone;
};

const getHostAddresses = () => {
  const addresses = new Set<string>(["127.0.0.1", "::1"]);
  const interfaces = os.networkInterfaces();
  for (const details of Object.values(interfaces)) {
    for (const info of details ?? []) {
      if (!info.address) {
        continue;
      }
      addresses.add(normalizeAddress(info.address));
    }
  }
  return addresses;
};

const hostAddresses = getHostAddresses();

const isHostHttpRequest = (req: express.Request) => {
  const remoteAddress = req.socket.remoteAddress;
  if (!remoteAddress) {
    return false;
  }
  return hostAddresses.has(normalizeAddress(remoteAddress));
};

const normalizeLimit = (value: unknown) => {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.floor(parsed);
};

const normalizeConfigUpdate = (raw: Record<string, unknown>) => {
  const update: Partial<typeof lobbyConfig> = {};
  if (typeof raw.allowRejoin === "boolean") {
    update.allowRejoin = raw.allowRejoin;
  }
  if (typeof raw.allowMidgameJoin === "boolean") {
    update.allowMidgameJoin = raw.allowMidgameJoin;
  }
  if ("maxPlayers" in raw) {
    const normalized = normalizeLimit(raw.maxPlayers);
    if (normalized !== undefined) {
      update.maxPlayers = normalized;
    }
  }
  if ("maxSpectators" in raw) {
    const normalized = normalizeLimit(raw.maxSpectators);
    if (normalized !== undefined) {
      update.maxSpectators = normalized;
    }
  }
  return update;
};

const applyConfigUpdate = async (update: Partial<typeof lobbyConfig>) => {
  if (typeof update.allowRejoin === "boolean") {
    lobbyConfig.allowRejoin = update.allowRejoin;
  }
  if (typeof update.allowMidgameJoin === "boolean") {
    lobbyConfig.allowMidgameJoin = update.allowMidgameJoin;
  }
  if ("maxPlayers" in update && update.maxPlayers !== undefined) {
    lobbyConfig.maxPlayers = update.maxPlayers ?? null;
  }
  if ("maxSpectators" in update && update.maxSpectators !== undefined) {
    lobbyConfig.maxSpectators = update.maxSpectators ?? null;
  }

  const rooms = await matchMaker.query({ name: "lobby" });
  const roomId = rooms[0]?.roomId;
  if (roomId) {
    await matchMaker.remoteRoomCall(roomId, "applyConfigUpdate", [update]);
  }
};

const applyStateUpdate = async (update: { lobbyLocked?: boolean; phase?: "lobby" | "in-game" }) => {
  if (typeof update.lobbyLocked === "boolean") {
    lobbyOptions.lobbyLocked = update.lobbyLocked;
  }
  if (update.phase === "lobby" || update.phase === "in-game") {
    lobbyOptions.phase = update.phase;
  }

  const rooms = await matchMaker.query({ name: "lobby" });
  const roomId = rooms[0]?.roomId;
  if (roomId) {
    if (typeof update.lobbyLocked === "boolean") {
      await matchMaker.remoteRoomCall(roomId, "applyLobbyLock", [update.lobbyLocked]);
    }
    if (update.phase) {
      await matchMaker.remoteRoomCall(roomId, "applyPhaseUpdate", [update.phase]);
    }
  }
};

const getLanAddresses = () => {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const details of Object.values(interfaces)) {
    for (const info of details ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        addresses.push(info.address);
      }
    }
  }

  return addresses;
};

const buildJoinUrls = (hostHeader: string, protocol: string) => {
  const envHost = process.env.HOST_ADDRESS || process.env.LAN_HOST;
  if (envHost) {
    const hasPort = /:\d+$/.test(envHost);
    return [`${protocol}://${envHost}${hasPort ? "" : `:${port}`}/`];
  }

  const isLocalhost = /^(localhost|127\.0\.0\.1|::1)(:\d+)?$/i.test(hostHeader);
  if (isLocalhost) {
    const lanAddresses = getLanAddresses();
    if (lanAddresses.length > 0) {
      return lanAddresses.map((address) => `${protocol}://${address}:${port}/`);
    }
  }

  return [`${protocol}://${hostHeader}/`];
};

// Static assets (client UI + Colyseus client library).
app.use("/vendor", express.static(vendorPath));
app.use("/client", express.static(clientPath));
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/lobby-settings", (req, res) => {
  if (!isHostHttpRequest(req)) {
    res.status(403).json({ error: "Host-only endpoint." });
    return;
  }
  res.json({
    settings: { ...lobbyConfig },
    lobbyLocked: lobbyOptions.lobbyLocked,
    phase: lobbyOptions.phase
  });
});

app.post("/lobby-settings", async (req, res) => {
  if (!isHostHttpRequest(req)) {
    res.status(403).json({ error: "Host-only endpoint." });
    return;
  }
  const body = typeof req.body === "object" && req.body ? req.body : {};
  const settings = normalizeConfigUpdate((body.settings as Record<string, unknown>) || body);
  await applyConfigUpdate(settings);
  res.json({
    ok: true,
    settings: { ...lobbyConfig },
    lobbyLocked: lobbyOptions.lobbyLocked,
    phase: lobbyOptions.phase
  });
});

app.post("/lobby-lock", async (req, res) => {
  if (!isHostHttpRequest(req)) {
    res.status(403).json({ error: "Host-only endpoint." });
    return;
  }
  const locked = Boolean(req.body?.locked);
  await applyStateUpdate({ lobbyLocked: locked });
  res.json({ ok: true, lobbyLocked: lobbyOptions.lobbyLocked });
});

app.post("/lobby-phase", async (req, res) => {
  if (!isHostHttpRequest(req)) {
    res.status(403).json({ error: "Host-only endpoint." });
    return;
  }
  const phase = req.body?.phase;
  if (phase !== "lobby" && phase !== "in-game") {
    res.status(400).json({ error: "Invalid phase. Use 'lobby' or 'in-game'." });
    return;
  }
  await applyStateUpdate({ phase });
  res.json({ ok: true, phase: lobbyOptions.phase });
});

// Host page and QR payload endpoint.
app.get(["/host", "/host/"], (_req, res) => {
  res.sendFile(path.join(clientPath, "host.html"));
});

app.use(express.static(clientPath));

app.get("/host-data", async (req, res) => {
  const hostHeader = req.headers.host ?? `localhost:${port}`;
  const protocol = req.protocol;
  const joinUrls = buildJoinUrls(hostHeader, protocol);
  const primaryUrl = joinUrls[0];
  try {
    const qrDataUrl = await QRCode.toDataURL(primaryUrl, { margin: 1, width: 240 });
    const payload: { joinUrls: string[]; qrDataUrl: string } = {
      joinUrls,
      qrDataUrl
    };
    res.json(payload);
  } catch (error) {
    console.error(error);
    res.status(500).send("Failed to generate QR code.");
  }
});

app.get("/lobby-state", async (_req, res) => {
  try {
    const rooms = await matchMaker.query({ name: "lobby" });
    const roomId = rooms[0]?.roomId;
    if (roomId) {
      const state = await matchMaker.remoteRoomCall(roomId, "getStateSnapshot", []);
      res.json(state);
      return;
    }
  } catch (error) {
    console.error(error);
  }

  res.json({
    players: [],
    spectators: [],
    count: 0,
    totalCount: 0,
    spectatorCount: 0,
    totalSpectatorCount: 0,
    phase: lobbyOptions.phase,
    settings: { ...lobbyConfig, lobbyLocked: lobbyOptions.lobbyLocked }
  });
});

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server })
});

gameServer.define("lobby", LobbyRoom, lobbyOptions);

// Start HTTP + WebSocket server for rooms and static client.
gameServer.listen(port).then(() => {
  console.log(`Colyseus server listening on http://localhost:${port}`);
});
