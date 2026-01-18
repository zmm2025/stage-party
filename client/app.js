const statusEl = document.getElementById("status");
const joinButton = document.getElementById("join");
const nicknameInput = document.getElementById("nickname");
const avatarSection = document.getElementById("avatar-section");
const avatarPicker = document.getElementById("avatar-picker");
const modeRow = document.querySelector(".mode-row");
const playerCountEl = document.getElementById("player-count");
const playersEl = document.getElementById("players");
const readyButton = document.getElementById("ready");
const pingValueEl = document.getElementById("ping-value");
const pingWifiEl = document.getElementById("ping-wifi");
const nicknameClearButton = document.getElementById("nickname-clear");
const nicknameSaveButton = document.getElementById("nickname-save");
const leaveButton = document.getElementById("leave");
const modeInputs = document.querySelectorAll('input[name="join-mode"]');

const { roomName } = window.AppConfig;
const {
  ensureColyseus,
  getWsEndpoint,
  renderPlayers,
  pingLevelFromMs,
  updateWifiBars: applyWifiBars
} = window.AppShared;

let room = null;
let playerToken = localStorage.getItem("lpk_player_token");
let isReady = false;
let pingInterval = null;
let currentRole = "player";
let currentAvatar = "";
let nicknameValue = "";

const MAX_AVATAR_LENGTH = 8;
const DEFAULT_NICKNAME = nicknameInput?.placeholder?.trim() || "John Doe";
const avatarButtonBaseClasses =
  "flex h-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/80 text-lg text-slate-100 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-amber-400/40";
const avatarButtonSelectedClasses = "border-amber-400 text-amber-200";
const avatarOptions = [
  "\u{1F47E}",
  "\u{1F916}",
  "\u{1F437}",
  "\u{1F42E}",
  "\u{1F438}",
  "\u{1F419}",
  "\u{1F427}",
  "\u{1F422}",
  "\u{1F41D}",
  "\u{1F433}",
  "\u{1F409}",
  "\u{1F989}",
  "\u{1F98A}",
  "\u{1F984}",
  "\u{1F980}",
  "\u{1F4A7}",
  "\u{1F354}",
  "\u{1F34E}",
  "\u{1F355}",
  "\u{1F35F}",
  "\u{1F32E}",
  "\u{1F363}",
  "\u{1F9C0}",
  "\u{1F3B7}",
  "\u{1F3AF}",
  "\u{23F3}",
  "\u{1F48E}",
  "\u{1F511}",
  "\u2764\uFE0F",
  "\u{1F9F2}",
  "\u{1F50B}",
  "\u{1F4A1}",
  "\u{1F9EA}",
  "\u{1F9ED}",
  "\u{1F3AE}",
  "\u{1F9F8}",
  "\u{1F9CA}",
  "\u{1F4E6}",
  "\u{1F680}",
  "\u{1F3B2}",
  "\u{1F9E9}"
];

const buildAvatarPicker = () => {
  if (!avatarPicker) {
    return;
  }
  avatarPicker.innerHTML = "";
  avatarOptions.forEach((avatar) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = avatarButtonBaseClasses;
    button.setAttribute("data-avatar", avatar);
    button.setAttribute("aria-pressed", "false");
    button.textContent = avatar;
    avatarPicker.appendChild(button);
  });
};

buildAvatarPicker();

const parseJoinError = (err) => {
  const message = err?.message ?? "";
  if (typeof message === "string") {
    try {
      const parsed = JSON.parse(message);
      if (parsed && typeof parsed === "object") {
        return {
          code: typeof parsed.code === "string" ? parsed.code : null,
          message: typeof parsed.message === "string" ? parsed.message : null
        };
      }
    } catch (error) {
      console.error("Failed to parse join error", error);
    }
  }
  return { code: null, message: null };
};

const joinErrorMessage = (errorInfo) => {
  switch (errorInfo?.code) {
    case "LOBBY_LOCKED":
      return "Lobby is locked. Ask the host to unlock it.";
    case "MIDGAME_JOIN_DISABLED":
      return "The game is already running. Please wait for the next round.";
    case "LOBBY_FULL":
      return "Lobby is full. Please try again soon.";
    default:
      return null;
  }
};

const connect = async () => {
  if (!ensureColyseus(statusEl)) {
    return;
  }

  joinButton.disabled = true;
  statusEl.textContent = "Connecting...";

  try {
    const client = new Colyseus.Client(getWsEndpoint());
    const nickname = nicknameInput.value.trim() || DEFAULT_NICKNAME;
    if (nicknameInput && !nicknameInput.value.trim()) {
      nicknameInput.value = nickname;
      nicknameValue = nickname;
    }
    const role = getSelectedRole();
    currentRole = role;
    const avatar = normalizeAvatar(getSelectedAvatar());

    room = await client.joinOrCreate(roomName, {
      nickname,
      playerToken: playerToken || undefined,
      role: role === "spectator" ? "spectator" : "player",
      avatar: role === "player" && avatar ? avatar : undefined
    });
    statusEl.textContent = "Connected.";
    updateAvatarUi();
    updateJoinUi();
    updateNicknameControls();

    room.onMessage("server:event", (message) => {
      if (message?.message?.type === "welcome") {
        const token = message.message.payload?.token;
        if (token) {
          playerToken = token;
          localStorage.setItem("lpk_player_token", token);
        }
        if (message.message.payload?.role) {
          currentRole = message.message.payload.role;
        }
        if (message.message.payload?.avatar) {
          currentAvatar = message.message.payload.avatar;
          setSelectedAvatar(currentAvatar);
        }
        if (message.message.payload?.nickname && nicknameInput) {
          nicknameInput.value = message.message.payload.nickname;
          nicknameValue = message.message.payload.nickname;
        }
        updateAvatarUi();
        updateJoinUi();
        updateNicknameControls();
      }
    });

    room.onMessage("server:pong", (payload) => {
      if (pingValueEl) {
        pingValueEl.textContent =
          typeof payload?.pingMs === "number" ? `${Math.round(payload.pingMs)}ms` : "--";
      }
      if (pingWifiEl) {
        const level = pingLevelFromMs(payload?.pingMs);
        applyWifiBars(pingWifiEl, level);
      }
    });

    room.onMessage("server:kick", () => {
      statusEl.textContent = "You were removed by the host.";
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      room.leave();
      room = null;
      updateJoinUi();
      updateNicknameControls();
    });

    room.onMessage("lobby:config", (config) => {
      updateReadyUi(config?.settings);
    });

    room.onMessage("lobby:state", (state) => {
      renderPlayers(playersEl, playerCountEl, state);
      updateReadyUi(state.settings, state);
      updateAvatarUi(state);
    });

    readyButton.addEventListener("click", () => {
      if (!room) {
        return;
      }
      isReady = !isReady;
      room.send("client:ready", { ready: isReady });
      updateReadyButton();
    });

    startPingLoop();
  } catch (err) {
    const errorInfo = parseJoinError(err);
    const joinMessage = joinErrorMessage(errorInfo);
    const rawMessage = err?.message ?? errorInfo?.message ?? "";
    const isLobbyFull =
      typeof rawMessage === "string" && rawMessage.includes("LOBBY_FULL");

    if (isLobbyFull) {
      statusEl.textContent = "Lobby full.";
    } else {
      statusEl.textContent =
        joinMessage ||
        errorInfo?.message ||
        "Connection failed. Is the host running?";
    }
    joinButton.disabled = false;
    console.error(err);
  }
};

joinButton.addEventListener("click", connect);
leaveButton?.addEventListener("click", () => {
  if (!room) {
    return;
  }
  room.leave();
  room = null;
  statusEl.textContent = "Left lobby.";
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  updateJoinUi();
  updateReadyUi();
  updateNicknameControls();
});

nicknameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    if (room) {
      commitNicknameChange();
    } else {
      connect();
    }
  }
});

nicknameInput.addEventListener("blur", () => {
  commitNicknameChange();
});

nicknameInput.addEventListener("change", () => {
  commitNicknameChange();
});

nicknameInput.addEventListener("input", () => {
  updateNicknameControls();
});

nicknameClearButton?.addEventListener("click", () => {
  if (!nicknameInput) {
    return;
  }
  nicknameInput.value = "";
  nicknameInput.focus();
  updateNicknameControls();
});

nicknameSaveButton?.addEventListener("click", () => {
  commitNicknameChange();
});

modeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    currentRole = getSelectedRole();
    updateAvatarUi();
    updateReadyUi();
  });
});

const handleAvatarPickerEvent = (event) => {
  const target =
    event.target instanceof Element ? event.target : event.target?.parentElement || null;
  if (!target) {
    return;
  }
  const button = target.closest("button[data-avatar]");
  if (!button) {
    return;
  }
  commitAvatarChange(button.getAttribute("data-avatar"));
};

const updateJoinUi = () => {
  const isConnected = Boolean(room);
  if (joinButton) {
    joinButton.disabled = isConnected;
  }
  if (leaveButton) {
    leaveButton.classList.toggle("hidden", !isConnected);
    leaveButton.disabled = !isConnected;
  }
  if (modeRow) {
    modeRow.classList.toggle("hidden", isConnected);
  }
  modeInputs.forEach((input) => {
    input.disabled = isConnected;
  });
};

if (avatarPicker) {
  avatarPicker.addEventListener("click", handleAvatarPickerEvent);
  avatarPicker.addEventListener("pointerup", handleAvatarPickerEvent);
}

const updateReadyUi = (settings, state) => {
  const requireReady = settings?.requireReady;
  if (!requireReady) {
    readyButton.classList.add("hidden");
    readyButton.disabled = true;
    return;
  }

  if (currentRole === "spectator") {
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

const normalizeAvatar = (value) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.slice(0, MAX_AVATAR_LENGTH);
};

const getAvatarButtons = () => {
  if (!avatarPicker) {
    return [];
  }
  return avatarPicker.querySelectorAll("button[data-avatar]");
};

const getSelectedAvatar = () => {
  for (const button of getAvatarButtons()) {
    if (button.getAttribute("aria-pressed") === "true") {
      return button.getAttribute("data-avatar") || "";
    }
  }
  return "";
};

const setSelectedAvatar = (avatar) => {
  const buttons = getAvatarButtons();
  if (!buttons.length) {
    return;
  }
  buttons.forEach((button) => {
    const matches = button.getAttribute("data-avatar") === avatar;
    button.classList.toggle("border-amber-400", matches);
    button.classList.toggle("text-amber-200", matches);
    button.classList.toggle("border-slate-700", !matches);
    button.classList.toggle("text-slate-100", !matches);
    button.setAttribute("aria-pressed", matches ? "true" : "false");
  });
};

const commitAvatarChange = (value) => {
  if (currentRole !== "player") {
    return;
  }
  const avatar = normalizeAvatar(value);
  if (!avatar) {
    return;
  }
  setSelectedAvatar(avatar);
  if (avatar === currentAvatar) {
    return;
  }
  currentAvatar = avatar;
  if (room) {
    room.send("client:avatar", { avatar });
  }
};

const commitNicknameChange = () => {
  if (!nicknameInput) {
    return;
  }
  const nextNickname = nicknameInput.value.trim() || DEFAULT_NICKNAME;
  if (nextNickname === nicknameValue) {
    return;
  }
  nicknameInput.value = nextNickname;
  nicknameValue = nextNickname;
  if (room) {
    room.send("client:nickname", { nickname: nextNickname });
  }
  updateNicknameControls();
};

const updateNicknameControls = () => {
  if (!nicknameInput) {
    return;
  }
  const value = nicknameInput.value.trim();
  const canClear = value.length > 0;
  const canSave = Boolean(room) && value.length > 0 && value !== nicknameValue;
  nicknameClearButton?.classList.toggle("hidden", !canClear);
  nicknameSaveButton?.classList.toggle("hidden", !canSave);
};

const updateAvatarUi = (state) => {
  if (!avatarSection || !avatarPicker) {
    return;
  }

  const isPlayer = currentRole === "player";
  avatarSection.classList.toggle("hidden", !isPlayer);
  avatarPicker.classList.toggle("opacity-50", !isPlayer);
  avatarPicker.classList.toggle("pointer-events-none", !isPlayer);
  const buttons = getAvatarButtons();
  buttons.forEach((button) => {
    button.disabled = !isPlayer;
  });

  if (state && isPlayer && playerToken) {
    const me = (state.players || []).find((player) => player.id === playerToken);
    if (me?.avatar && me.avatar !== currentAvatar) {
      currentAvatar = me.avatar;
      setSelectedAvatar(me.avatar);
    }
  }

  if (!currentAvatar) {
    const fallback = normalizeAvatar(getSelectedAvatar());
    if (fallback) {
      currentAvatar = fallback;
    } else if (buttons.length) {
      const first = buttons[0].getAttribute("data-avatar") || "";
      if (first) {
        currentAvatar = first;
        setSelectedAvatar(first);
      }
    }
  }
};

const getSelectedRole = () => {
  for (const input of modeInputs) {
    if (input.checked) {
      return input.value;
    }
  }
  return "player";
};

const sendPing = () => {
  if (!room) {
    return;
  }
  room.send("client:ping", { sentAt: Date.now() });
};

const startPingLoop = () => {
  if (pingInterval) {
    clearInterval(pingInterval);
  }
  pingInterval = setInterval(sendPing, 2000);
  sendPing();
};

updateAvatarUi();
updateJoinUi();
updateNicknameControls();
