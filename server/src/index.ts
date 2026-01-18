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

const port = Number(process.env.PORT ?? 2567);
const app = express();
const clientPath = path.resolve(__dirname, "..", "..", "client");
const vendorPath = path.resolve(__dirname, "..", "node_modules", "colyseus.js", "dist");

const lobbyConfig = {
  requireReady: false,
  allowRejoin: true,
  allowMidgameJoin: false,
  maxPlayers: null,
  maxSpectators: null
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

const isHostRequest = (req: express.Request) => {
  const remoteAddress = req.socket.remoteAddress;
  if (!remoteAddress) {
    return false;
  }
  const normalized = normalizeAddress(remoteAddress);
  return hostAddresses.has(normalized);
};

const requireHost = (req: express.Request, res: express.Response) => {
  if (!isHostRequest(req)) {
    res.status(403).json({ error: "Host access only." });
    return false;
  }
  return true;
};

const resolveLobbyRoom = async () => {
  const activeRoom = LobbyRoom.getActiveRoom();
  if (activeRoom) {
    return activeRoom;
  }
  const rooms = await matchMaker.query({ name: "lobby" });
  if (rooms.length > 0) {
    return matchMaker.getRoomById(rooms[0].roomId) as LobbyRoom | undefined;
  }
  return undefined;
};

const ensureLobbyRoom = async () => {
  const existingRoom = await resolveLobbyRoom();
  if (existingRoom) {
    return existingRoom;
  }
  await matchMaker.createRoom("lobby", { config: lobbyConfig });
  return resolveLobbyRoom();
};

// Static assets (client UI + Colyseus client library).
app.use(express.json());
app.use("/vendor", express.static(vendorPath));
app.use("/client", express.static(clientPath));
app.use(express.static(clientPath));
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Host page and QR payload endpoint.
app.get("/host", (_req, res) => {
  res.sendFile(path.join(clientPath, "host.html"));
});

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

app.post("/lobby/ensure", async (req, res) => {
  if (!requireHost(req, res)) {
    return;
  }
  try {
    const room = await ensureLobbyRoom();
    if (!room) {
      res.status(500).json({ error: "Failed to create lobby room." });
      return;
    }
    res.json({ ok: true, roomId: room.roomId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to ensure lobby room." });
  }
});

app.get("/lobby/state", async (req, res) => {
  if (!requireHost(req, res)) {
    return;
  }
  const room = await resolveLobbyRoom();
  if (!room) {
    res.status(409).json({ error: "Lobby room not created yet." });
    return;
  }
  res.json(room.getStatePayload());
});

app.get("/lobby/config", async (req, res) => {
  if (!requireHost(req, res)) {
    return;
  }
  const room = await resolveLobbyRoom();
  if (!room) {
    res.status(409).json({ error: "Lobby room not created yet." });
    return;
  }
  res.json(room.getConfigPayload());
});

app.put("/lobby/config", async (req, res) => {
  if (!requireHost(req, res)) {
    return;
  }
  const room = await resolveLobbyRoom();
  if (!room) {
    res.status(409).json({ error: "Lobby room not created yet." });
    return;
  }
  const payload = req.body ?? {};
  res.json(room.updateConfig(payload));
});

app.post("/lobby/lock", async (req, res) => {
  if (!requireHost(req, res)) {
    return;
  }
  const room = await resolveLobbyRoom();
  if (!room) {
    res.status(409).json({ error: "Lobby room not created yet." });
    return;
  }
  const locked = Boolean(req.body?.locked);
  room.setLobbyLock(locked);
  res.json({ ok: true, locked });
});

app.post("/lobby/start", async (req, res) => {
  if (!requireHost(req, res)) {
    return;
  }
  const room = await resolveLobbyRoom();
  if (!room) {
    res.status(409).json({ error: "Lobby room not created yet." });
    return;
  }
  const result = room.requestGameStart("http");
  if (!result.ok) {
    res.status(409).json({ error: result.error ?? "Unable to start game." });
    return;
  }
  res.json({ ok: true });
});

app.post("/lobby/kick", async (req, res) => {
  if (!requireHost(req, res)) {
    return;
  }
  const room = await resolveLobbyRoom();
  if (!room) {
    res.status(409).json({ error: "Lobby room not created yet." });
    return;
  }
  const targetId = typeof req.body?.targetId === "string" ? req.body.targetId : "";
  if (!targetId) {
    res.status(400).json({ error: "Missing targetId." });
    return;
  }
  room.requestKickParticipant(targetId);
  res.json({ ok: true, targetId });
});

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server })
});

gameServer.define("lobby", LobbyRoom, { config: lobbyConfig });

// Start HTTP + WebSocket server for rooms and static client.
gameServer.listen(port).then(() => {
  console.log(`Colyseus server listening on http://localhost:${port}`);
});
