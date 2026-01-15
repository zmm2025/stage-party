const statusEl = document.getElementById("status");
const joinButton = document.getElementById("join");
const pingButton = document.getElementById("ping");
const logEl = document.getElementById("log");
const nicknameInput = document.getElementById("nickname");
const playerCountEl = document.getElementById("player-count");
const playersEl = document.getElementById("players");
const readyButton = document.getElementById("ready");
const phaseEl = document.getElementById("phase");

const { roomName } = window.AppConfig;
const { ensureColyseus, getWsEndpoint, renderPlayers } = window.AppShared;

let room = null;
let playerToken = localStorage.getItem("lpk_player_token");
let isReady = false;

const connect = async () => {
  if (!ensureColyseus(statusEl)) {
    return;
  }

  joinButton.disabled = true;
  statusEl.textContent = "Connecting...";

  try {
    const client = new Colyseus.Client(getWsEndpoint());
    const nickname = nicknameInput.value.trim();

    room = await client.joinOrCreate(roomName, {
      nickname,
      playerToken: playerToken || undefined
    });
    statusEl.textContent = `Connected: ${room.sessionId}`;
    pingButton.disabled = false;

    room.onMessage("server:event", (message) => {
      logEl.textContent = `Server: ${JSON.stringify(message)}`;
      if (message?.message?.type === "welcome") {
        const token = message.message.payload?.token;
        if (token) {
          playerToken = token;
          localStorage.setItem("lpk_player_token", token);
        }
      }
    });

    room.onMessage("game:start", () => {
      statusEl.textContent = "Game started.";
    });

    room.onMessage("lobby:config", (config) => {
      updatePhase(config?.phase);
      updateReadyUi(config?.settings);
    });

    room.onMessage("lobby:state", (state) => {
      renderPlayers(playersEl, playerCountEl, state);
      updatePhase(state.phase);
      updateReadyUi(state.settings, state);
    });

    pingButton.addEventListener("click", () => {
      room.send("client:event", {
        type: "ping",
        payload: { at: Date.now() }
      });
    });

    readyButton.addEventListener("click", () => {
      if (!room) {
        return;
      }
      isReady = !isReady;
      room.send("client:ready", { ready: isReady });
      updateReadyButton();
    });
  } catch (err) {
    statusEl.textContent = "Connection failed. Is the host running?";
    joinButton.disabled = false;
    console.error(err);
  }
};

joinButton.addEventListener("click", connect);

nicknameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    connect();
  }
});

const updatePhase = (phase) => {
  if (phaseEl) {
    phaseEl.textContent = `Phase: ${phase === "in-game" ? "In Game" : "Lobby"}`;
  }
};

const updateReadyUi = (settings, state) => {
  const requireReady = settings?.requireReady;
  if (!requireReady) {
    readyButton.classList.add("hidden");
    readyButton.disabled = true;
    return;
  }

  readyButton.classList.remove("hidden");
  readyButton.disabled = !room;

  if (state && playerToken) {
    const me = (state.players || []).find((player) => player.id === playerToken);
    if (me) {
      isReady = Boolean(me.ready);
    }
  }

  updateReadyButton();
};

const updateReadyButton = () => {
  if (!readyButton) {
    return;
  }
  readyButton.textContent = isReady ? "Ready (click to unready)" : "Ready up";
};
