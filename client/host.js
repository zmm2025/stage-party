const statusEl = document.getElementById("status");
const playerCountEl = document.getElementById("player-count");
const playersEl = document.getElementById("players");
const joinListEl = document.getElementById("join-urls");
const qrImg = document.getElementById("qr");
const startButton = document.getElementById("start-game");
const phaseEl = document.getElementById("phase");

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
      startButton.addEventListener("click", () => {
        room.send("host:start");
      });

      room.onMessage("host:error", (payload) => {
        statusEl.textContent = payload?.message || "Unable to start yet.";
      });

      room.onMessage("game:start", () => {
        statusEl.textContent = "Game started.";
      });

      room.onMessage("lobby:config", (config) => {
        updatePhase(config?.phase);
        updateStartButton(config?.settings, { count: 0, allReady: false, phase: config?.phase });
      });

      room.onMessage("lobby:state", (state) => {
        renderPlayers(playersEl, playerCountEl, state);
        updatePhase(state.phase);
        updateStartButton(state.settings, state);
      });
    })
    .catch((error) => {
      console.error(error);
      statusEl.textContent = "Lobby connection failed.";
    });
};

const updatePhase = (phase) => {
  if (phaseEl) {
    phaseEl.textContent = `Phase: ${phase === "in-game" ? "In Game" : "Lobby"}`;
  }
};

const updateStartButton = (settings, state) => {
  if (!startButton) {
    return;
  }
  const requireReady = settings?.requireReady;
  const hasPlayers = (state?.count ?? 0) > 0;
  const canStart =
    state?.phase === "lobby" && hasPlayers && (!requireReady || Boolean(state?.allReady));

  startButton.disabled = !canStart;
  startButton.textContent = state?.phase === "in-game" ? "Game in progress" : "Start Game";
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
