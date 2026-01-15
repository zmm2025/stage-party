# LexPlay LAN Framework

Local-first party-game framework for LexPlay / Run Jump Dev.

- Host runs a local Colyseus server (authoritative rooms)
- Players join via QR code on the same Wi-Fi
- Phone clients run in the browser (custom UI per game)

## Local dev

From `server/`:

```
npm install
npm run dev
```

Open `http://localhost:2567/host` to show the join QR.

## Host address override

If the QR should use a specific LAN IP or hostname:

```
set HOST_ADDRESS=192.168.1.50
npm run dev
```

Status: In early development.
