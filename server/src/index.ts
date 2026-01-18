import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import express from "express";
import colyseus from "colyseus";
import QRCode from "qrcode";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { LobbyRoom } from "./rooms/LobbyRoom.js";

const { Server } = colyseus;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = Number(process.env.PORT ?? 2567);
const app = express();
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

const lobbyConfig = {
  requireReady: parseEnvBool(process.env.LOBBY_REQUIRE_READY, false),
  allowRejoin: parseEnvBool(process.env.LOBBY_ALLOW_REJOIN, true),
  allowMidgameJoin: parseEnvBool(process.env.LOBBY_ALLOW_MIDGAME_JOIN, false),
  maxPlayers: parseEnvNumber(process.env.LOBBY_MAX_PLAYERS),
  maxSpectators: parseEnvNumber(process.env.LOBBY_MAX_SPECTATORS)
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

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server })
});

gameServer.define("lobby", LobbyRoom, { config: lobbyConfig });

// Start HTTP + WebSocket server for rooms and static client.
gameServer.listen(port).then(() => {
  console.log(`Colyseus server listening on http://localhost:${port}`);
});
