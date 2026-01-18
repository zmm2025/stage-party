const statusEl = document.getElementById("status");
const playerCountEl = document.getElementById("player-count");
const playersEl = document.getElementById("players");
const qrImg = document.getElementById("qr");
const startButton = document.getElementById("start-game");
const lockButton = document.getElementById("lock-lobby");
const spectatorCountEl = document.getElementById("spectator-count");
const spectatorsEl = document.getElementById("spectators");
const hostCard = document.getElementById("host-card");
const hostBlockedCard = document.getElementById("host-blocked");
const goPlayerButton = document.getElementById("go-player");

const { roomName, hostDataEndpoint } = window.AppConfig;
const {
  ensureColyseus,
  getWsEndpoint,
  pingLevelFromMs,
  updateWifiBars: applyWifiBars
} = window.AppShared;

const DEFAULT_AVATAR = "\u{1F47E}";
const QR_FALLBACK_ENDPOINT = "https://api.qrserver.com/v1/create-qr-code/";

let lobbyLocked = false;
let primaryJoinUrl = "/";

const showHostBlocked = () => {
  if (hostCard) {
    hostCard.classList.add("hidden");
  }
  if (hostBlockedCard) {
    hostBlockedCard.classList.remove("hidden");
  }
  if (goPlayerButton) {
    goPlayerButton.onclick = () => {
      window.location.href = primaryJoinUrl;
    };
  }
};

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
        updateStartButton(config?.settings, { count: 0, allReady: false, phase: config?.phase });
        lobbyLocked = Boolean(config?.settings?.lobbyLocked);
        updateLockButton();
      });

      room.onMessage("lobby:state", (state) => {
        renderHostList(playersEl, playerCountEl, state.players || [], room, {
          defaultAvatar: DEFAULT_AVATAR
        });
        renderHostList(spectatorsEl, spectatorCountEl, state.spectators || [], room, {
          hideReady: true
        });
        updateStartButton(state.settings, state);
        lobbyLocked = Boolean(state?.settings?.lobbyLocked);
        updateLockButton();
      });
    })
    .catch((error) => {
      console.error(error);
      showHostBlocked();
    });
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

  const fragment = document.createDocumentFragment();
  items.forEach((participant) => {
    const listItem = document.createElement("li");
    listItem.className =
      "flex items-center gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/70 px-3 py-2";

    const playerName = document.createElement("span");
    playerName.className = "flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100";

    const avatarValue = participant.avatar ?? options.defaultAvatar;
    if (avatarValue) {
      const avatar = document.createElement("span");
      avatar.className =
        "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-base";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = avatarValue;
      playerName.appendChild(avatar);
    }

    const tags = [];
    if (!options.hideReady && participant.ready) {
      tags.push("ready");
    }
    if (participant.connected === false) {
      tags.push("away");
    }
    const suffix = tags.length ? ` (${tags.join(", ")})` : "";
    const nickname = document.createElement("span");
    nickname.className = "text-sm text-slate-100";
    nickname.textContent = `${participant.nickname}${suffix}`;
    playerName.appendChild(nickname);

    const level = pingLevelFromMs(participant.pingMs);
    const pingWrap = document.createElement("span");
    pingWrap.className = "ml-auto flex items-center gap-2 text-xs text-slate-200";
    const wifi = document.createElement("span");
    wifi.className = "flex items-end gap-1";
    wifi.setAttribute("aria-label", "Connection strength");

    [2, 3, 4, 5].forEach((height, index) => {
      const bar = document.createElement("span");
      bar.className = `h-${height} w-1 rounded-sm bg-slate-700`;
      bar.setAttribute("data-bar", String(index + 1));
      wifi.appendChild(bar);
    });
    applyWifiBars(wifi, level);

    const pingLabel = document.createElement("span");
    pingLabel.textContent =
      typeof participant.pingMs === "number" ? `${Math.round(participant.pingMs)}ms` : "--";
    pingWrap.appendChild(wifi);
    pingWrap.appendChild(pingLabel);

    const kickButton = document.createElement("button");
    kickButton.className =
      "inline-flex h-7 w-7 items-center justify-center rounded-full border border-rose-500/40 text-xs font-semibold text-rose-300 transition hover:border-rose-400 hover:bg-rose-500/20";
    kickButton.setAttribute("data-kick-id", participant.id);
    kickButton.setAttribute("aria-label", "Kick");
    kickButton.setAttribute("title", "Kick");
    kickButton.textContent = "\u00D7";

    listItem.appendChild(playerName);
    listItem.appendChild(pingWrap);
    listItem.appendChild(kickButton);
    fragment.appendChild(listItem);
  });

  listEl.replaceChildren(fragment);

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

const buildFallbackJoinUrls = () => {
  const origin = window.location.origin || "";
  const joinUrl = origin ? `${origin}/` : "/";
  return [joinUrl];
};

const applyHostData = (data) => {
  const joinUrls = data?.joinUrls?.length ? data.joinUrls : buildFallbackJoinUrls();
  primaryJoinUrl = joinUrls[0] || "/";
  if (qrImg) {
    if (data?.qrDataUrl) {
      qrImg.src = data.qrDataUrl;
    } else {
      const qrUrl = `${QR_FALLBACK_ENDPOINT}?size=240x240&data=${encodeURIComponent(
        primaryJoinUrl
      )}`;
      qrImg.src = qrUrl;
    }
  }
};

fetch(hostDataEndpoint)
  .then((res) => res.json())
  .then((data) => {
    applyHostData(data);
    connectHost();
  })
  .catch((error) => {
    console.error(error);
    statusEl.textContent = "Failed to load host data.";
    applyHostData(null);
  });
