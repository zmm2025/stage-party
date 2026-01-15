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

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

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

app.use("/vendor", express.static(vendorPath));
app.use(express.static(clientPath));
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/host", async (req, res) => {
  const hostHeader = req.headers.host ?? `localhost:${port}`;
  const protocol = req.protocol;
  const joinUrls = buildJoinUrls(hostHeader, protocol);
  const primaryUrl = joinUrls[0];

  try {
    const qrDataUrl = await QRCode.toDataURL(primaryUrl, { margin: 1, width: 240 });
    const safeJoinUrls = joinUrls.map((url) => `<li><code>${escapeHtml(url)}</code></li>`).join("");

    res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LAN Party Kit - Host</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Space Grotesk", "IBM Plex Sans", system-ui, -apple-system, sans-serif;
      }

      body {
        margin: 0;
        background: #f2f0ea;
        color: #1b1b1b;
        display: grid;
        place-items: center;
        min-height: 100vh;
      }

      .card {
        background: #ffffff;
        border: 2px solid #1b1b1b;
        padding: 24px;
        width: min(460px, 92vw);
        box-shadow: 8px 8px 0 #1b1b1b;
        text-align: center;
      }

      h1 {
        font-size: 24px;
        margin: 0 0 8px;
      }

      p {
        margin: 0 0 12px;
      }

      code {
        display: inline-block;
        background: #f7f3e8;
        padding: 6px 10px;
        border: 1px solid #1b1b1b;
      }

      ul {
        list-style: none;
        padding: 0;
        margin: 0 0 12px;
        display: grid;
        gap: 6px;
      }

      img {
        margin-top: 8px;
        width: 240px;
        height: 240px;
        image-rendering: crisp-edges;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Join the game</h1>
      <p>Scan to join on your phone:</p>
      <img src="${qrDataUrl}" alt="Join QR code" />
      <p>or go to</p>
      <ul>${safeJoinUrls}</ul>
    </div>
  </body>
</html>`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Failed to generate QR code.");
  }
});

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server })
});

gameServer.define("lobby", LobbyRoom);

gameServer.listen(port).then(() => {
  console.log(`Colyseus server listening on http://localhost:${port}`);
});
