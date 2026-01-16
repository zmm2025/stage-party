const statusEl = document.getElementById("status");
const playerCountEl = document.getElementById("player-count");
const playersEl = document.getElementById("players");
const joinListEl = document.getElementById("join-urls");
const qrImg = document.getElementById("qr");
const startButton = document.getElementById("start-game");
const phaseEl = document.getElementById("phase");
const lockButton = document.getElementById("lock-lobby");
const spectatorCountEl = document.getElementById("spectator-count");
const spectatorsEl = document.getElementById("spectators");

const { roomName, hostDataEndpoint } = window.AppConfig;
const { ensureColyseus, getWsEndpoint, renderJoinUrls, pingLevelFromMs } = window.AppShared;

let lobbyLocked = false;

const connectHost = () => {
  if (!ensureColyseus(statusEl)) {
    return;
  }

  const client = new Colyseus.Client(getWsEndpoint());

  client
    .joinOrCreate(roomName, { role: "host" })
    .then((room) => {
      statusEl.textContent = "Lobby online.";
      lockButton.addEventListener("click", () => {
        lobbyLocked = !lobbyLocked;
        room.send("host:lock", { locked: lobbyLocked });
        updateLockButton();
      });
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
        lobbyLocked = Boolean(config?.settings?.lobbyLocked);
        updateLockButton();
      });

      room.onMessage("lobby:state", (state) => {
        renderHostList(playersEl, playerCountEl, state.players || [], room);
        renderHostList(spectatorsEl, spectatorCountEl, state.spectators || [], room, {
          hideReady: true
        });
        updatePhase(state.phase);
        updateStartButton(state.settings, state);
        lobbyLocked = Boolean(state?.settings?.lobbyLocked);
        updateLockButton();
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

const updateLockButton = () => {
  if (!lockButton) {
    return;
  }
  lockButton.disabled = false;
  lockButton.textContent = lobbyLocked ? "Unlock Lobby" : "Lock Lobby";
};

const renderHostList = (listEl, countEl, items, room, options = {}) => {
  if (countEl) {
    const connectedCount = items.filter((item) => item.connected).length;
    countEl.textContent = connectedCount;
  }
  if (!listEl) {
    return;
  }

  listEl.innerHTML = items
    .map((participant) => {
      const avatar = participant.avatar
        ? `<span class="avatar" aria-hidden="true">${participant.avatar}</span>`
        : "";
      const tags = [];
      if (!options.hideReady && participant.ready) {
        tags.push("ready");
      }
      if (participant.connected === false) {
        tags.push("away");
      }
      const suffix = tags.length ? ` (${tags.join(", ")})` : "";
      const ping =
        typeof participant.pingMs === "number" ? ` - ${Math.round(participant.pingMs)}ms` : "";
      const level = pingLevelFromMs(participant.pingMs);
      const wifi =
        `<span class="wifi" data-level="${level}" aria-label="Connection strength">` +
        `<span class="bar b1"></span>` +
        `<span class="bar b2"></span>` +
        `<span class="bar b3"></span>` +
        `<span class="bar b4"></span>` +
        `</span>`;
      return (
        `<li class="list-item">` +
        `<span class="player-name">` +
        `${avatar}` +
        `<span class="nickname">${participant.nickname}${suffix}${ping}</span>` +
        `</span>` +
        `${wifi}` +
        `<button class="kick" data-kick-id="${participant.id}">Kick</button>` +
        `</li>`
      );
    })
    .join("");

  listEl.onclick = (event) => {
    const button = event.target.closest("button[data-kick-id]");
    if (!button) {
      return;
    }
    const targetId = button.getAttribute("data-kick-id");
    if (targetId) {
      room.send("host:kick", { targetId });
    }
  };
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
