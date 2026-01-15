const statusEl = document.getElementById("status");
const playerCountEl = document.getElementById("player-count");
const playersEl = document.getElementById("players");
const joinListEl = document.getElementById("join-urls");
const qrImg = document.getElementById("qr");

const { roomName, hostDataEndpoint } = window.AppConfig;
const { ensureColyseus, getWsEndpoint, renderPlayers, renderJoinUrls } = window.AppShared;

const connectHost = () => {
  if (!ensureColyseus(statusEl)) {
    return;
  }

  const client = new Colyseus.Client(getWsEndpoint());

  client
    .joinOrCreate(roomName, { role: "host" })
    .then((room) => {
      statusEl.textContent = "Lobby online.";
      room.onMessage("lobby:state", (state) => {
        renderPlayers(playersEl, playerCountEl, state);
      });
    })
    .catch((error) => {
      console.error(error);
      statusEl.textContent = "Lobby connection failed.";
    });
};

fetch(hostDataEndpoint)
  .then((res) => res.json())
  .then((data) => {
    qrImg.src = data.qrDataUrl;
    renderJoinUrls(joinListEl, data.joinUrls || []);
    connectHost();
  })
  .catch((error) => {
    console.error(error);
    statusEl.textContent = "Failed to load host data.";
  });
