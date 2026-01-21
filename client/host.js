const statusEl = document.getElementById("status");
const statusDotEl = document.getElementById("status-dot");
const statusTextEl = document.getElementById("status-text");
const playerCountEl = document.getElementById("player-count");
const playersEl = document.getElementById("players");
const qrImg = document.getElementById("qr");
const startButton = document.getElementById("start-game");
const lockButton = document.getElementById("lock-lobby");
const lockIconEl = document.getElementById("lock-icon");
const lockLabelEl = document.getElementById("lock-label");
const spectatorCountEl = document.getElementById("spectator-count");
const spectatorsEl = document.getElementById("spectators");
const hostCard = document.getElementById("host-card");
const hostBlockedCard = document.getElementById("host-blocked");
const goPlayerButton = document.getElementById("go-player");
const settingsForm = document.getElementById("lobby-settings");
const maxPlayersInput = document.getElementById("max-players");
const maxSpectatorsInput = document.getElementById("max-spectators");
const allowRejoinInput = document.getElementById("allow-rejoin");
const allowMidgameInput = document.getElementById("allow-midgame");

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
let isApplyingSettings = false;
let settingsUpdateTimeout = null;
let settingsReady = false;

const statusStyles = {
  offline: {
    dot: "bg-slate-500 shadow-[0_0_10px_rgba(148,163,184,0.5)]",
    text: "text-slate-200"
  },
  online: {
    dot: "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]",
    text: "text-emerald-100"
  },
  error: {
    dot: "bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.6)]",
    text: "text-rose-100"
  },
  "in-game": {
    dot: "bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.6)]",
    text: "text-sky-100"
  }
};

const setStatus = (state, message) => {
  const styles = statusStyles[state] || statusStyles.offline;
  if (statusTextEl) {
    statusTextEl.textContent = message;
    statusTextEl.className = styles.text;
  } else if (statusEl) {
    statusEl.textContent = message;
  }
  if (statusDotEl) {
    statusDotEl.className = `h-2.5 w-2.5 rounded-full ${styles.dot}`;
  }
};

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
  if (!ensureColyseus(statusTextEl || statusEl)) {
    return;
  }

  const client = new Colyseus.Client(getWsEndpoint());
  client
    .joinOrCreate(roomName, { role: "host" })
    .then((room) => {
      setStatus("online", "Lobby online.");
      registerSettingsHandlers(room);
      lockButton.addEventListener("click", () => {
        lobbyLocked = !lobbyLocked;
        room.send("host:lock", { locked: lobbyLocked });
        updateLockButton();
      });
      startButton.addEventListener("click", () => {
        room.send("host:start");
      });

      room.onMessage("host:error", (payload) => {
        setStatus("error", payload?.message || "Unable to start yet.");
      });

      room.onMessage("game:start", () => {
        setStatus("in-game", "Game started.");
      });

      room.onMessage("lobby:config", (config) => {
        updateStartButton({ count: 0, phase: config?.phase });
        lobbyLocked = Boolean(config?.settings?.lobbyLocked);
        updateLockButton();
        applyLobbySettings(config?.settings);
      });

      room.onMessage("lobby:state", (state) => {
        renderHostList(playersEl, playerCountEl, state.players || [], room, {
          defaultAvatar: DEFAULT_AVATAR
        });
        renderHostList(spectatorsEl, spectatorCountEl, state.spectators || [], room, {
          defaultAvatar: DEFAULT_AVATAR
        });
        updateStartButton(state);
        lobbyLocked = Boolean(state?.settings?.lobbyLocked);
        updateLockButton();
      });
    })
    .catch((error) => {
      console.error(error);
      showHostBlocked();
    });
};

const updateStartButton = (state) => {
  if (!startButton) {
    return;
  }
  const hasPlayers = (state?.count ?? 0) > 0;
  const canStart = state?.phase === "lobby" && hasPlayers;

  startButton.disabled = !canStart;
  startButton.textContent = state?.phase === "in-game" ? "Game in progress" : "Start Game";
  if (state?.phase === "in-game") {
    startButton.title = "Game already in progress.";
  } else if (!hasPlayers) {
    startButton.title = "Waiting for at least one player to join.";
  } else {
    startButton.title = "";
  }
};

const updateLockButton = () => {
  if (!lockButton) {
    return;
  }
  lockButton.disabled = false;
  if (lockLabelEl) {
    lockLabelEl.textContent = lobbyLocked ? "Unlock Lobby" : "Lock Lobby";
  }
  if (lockIconEl) {
    lockIconEl.textContent = lobbyLocked ? "🔒" : "🔓";
  }
};

const attachNumberInputControls = (input, scheduleUpdate) => {
  if (!input) {
    return;
  }

  let lastSpinDirection = null;
  let lastSpinValue = null;

  const getStep = () => {
    const parsed = Number(input.step);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  };

  const parseValue = () => {
    const trimmed = String(input.value ?? "").trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Math.floor(parsed);
  };

  const setValue = (value) => {
    input.value = value === null ? "" : String(value);
  };

  input.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") {
      return;
    }
    const current = parseValue();
    if (current === null) {
      return;
    }
    event.preventDefault();
    if (current <= 0) {
      setValue(null);
    } else {
      setValue(current - 1);
    }
    scheduleUpdate();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp") {
      return;
    }
    const current = parseValue();
    if (current === null) {
      event.preventDefault();
      setValue(0);
      scheduleUpdate();
    }
  });

  input.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const current = parseValue();
      const step = getStep();
      if (event.deltaY < 0) {
        if (current === null) {
          setValue(0);
        } else {
          setValue(current + step);
        }
        scheduleUpdate();
        return;
      }

      if (current === null) {
        return;
      }
      if (current <= 0) {
        setValue(null);
      } else {
        setValue(current - step <= 0 ? 0 : current - step);
      }
      scheduleUpdate();
    },
    { passive: false }
  );

  input.addEventListener("pointerdown", (event) => {
    const rect = input.getBoundingClientRect();
    const spinnerEdge = rect.right - 24;
    if (event.clientX < spinnerEdge) {
      lastSpinDirection = null;
      lastSpinValue = null;
      return;
    }
    lastSpinDirection = event.clientY > rect.top + rect.height / 2 ? "down" : "up";
    lastSpinValue = parseValue();
  });

  input.addEventListener("pointerup", () => {
    lastSpinDirection = null;
    lastSpinValue = null;
  });

  input.addEventListener("input", () => {
    const current = parseValue();
    if (current !== null && current < 0) {
      setValue(null);
      scheduleUpdate();
      return;
    }

    if (
      lastSpinDirection === "down" &&
      lastSpinValue !== null &&
      lastSpinValue <= 0 &&
      (current === null || current <= 0)
    ) {
      setValue(null);
      scheduleUpdate();
    }
  });

  const stepButtons = input.parentElement?.querySelectorAll("button[data-step]") || [];
  stepButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const step = Number(button.getAttribute("data-step")) || 0;
      if (!step) {
        return;
      }
      const current = parseValue();
      if (step > 0) {
        const next = current === null ? 0 : current + step;
        setValue(next);
        scheduleUpdate();
        return;
      }

      if (current === null) {
        return;
      }
      const next = current + step;
      if (next < 0) {
        setValue(null);
      } else {
        setValue(next);
      }
      scheduleUpdate();
    });
  });
};

const registerSettingsHandlers = (room) => {
  if (!settingsForm) {
    return;
  }

  const scheduleUpdate = () => {
    if (isApplyingSettings) {
      return;
    }
    if (!settingsReady) {
      return;
    }
    if (settingsUpdateTimeout) {
      clearTimeout(settingsUpdateTimeout);
    }
    settingsUpdateTimeout = setTimeout(() => {
      const settings = readLobbySettings();
      if (!settings) {
        return;
      }
      room.send("host:config", { settings });
    }, 200);
  };

  settingsForm.addEventListener("input", scheduleUpdate);
  settingsForm.addEventListener("change", scheduleUpdate);

  attachNumberInputControls(maxPlayersInput, scheduleUpdate);
  attachNumberInputControls(maxSpectatorsInput, scheduleUpdate);
};

const readLobbySettings = () => {
  if (
    !maxPlayersInput ||
    !maxSpectatorsInput ||
    !allowRejoinInput ||
    !allowMidgameInput
  ) {
    return null;
  }

  const parseLimit = (raw) => {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return undefined;
    }
    return Math.floor(parsed);
  };

  const settings = {
    allowRejoin: !allowRejoinInput.checked,
    allowMidgameJoin: allowMidgameInput.checked
  };

  const maxPlayers = parseLimit(maxPlayersInput.value);
  if (maxPlayers !== undefined) {
    settings.maxPlayers = maxPlayers;
  }

  const maxSpectators = parseLimit(maxSpectatorsInput.value);
  if (maxSpectators !== undefined) {
    settings.maxSpectators = maxSpectators;
  }

  return settings;
};

const applyLobbySettings = (settings) => {
  if (
    !maxPlayersInput ||
    !maxSpectatorsInput ||
    !allowRejoinInput ||
    !allowMidgameInput
  ) {
    return;
  }

  isApplyingSettings = true;
  if (document.activeElement !== maxPlayersInput) {
    maxPlayersInput.value =
      typeof settings?.maxPlayers === "number" ? String(settings.maxPlayers) : "";
  }
  if (document.activeElement !== maxSpectatorsInput) {
    maxSpectatorsInput.value =
      typeof settings?.maxSpectators === "number" ? String(settings.maxSpectators) : "";
  }
  if (document.activeElement !== allowRejoinInput) {
    allowRejoinInput.checked = !Boolean(settings?.allowRejoin);
  }
  if (document.activeElement !== allowMidgameInput) {
    allowMidgameInput.checked = Boolean(settings?.allowMidgameJoin);
  }
  isApplyingSettings = false;
  settingsReady = true;
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
    setStatus("error", "Failed to load host data.");
    applyHostData(null);
  });
