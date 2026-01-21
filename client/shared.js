const WIFI_ACTIVE_CLASS = "bg-amber-400";
const WIFI_INACTIVE_CLASS = "bg-slate-700";

const updateWifiBars = (wifiEl, level) => {
  if (!wifiEl) {
    return;
  }
  wifiEl.dataset.level = String(level);
  const bars = wifiEl.querySelectorAll("[data-bar]");
  bars.forEach((bar) => {
    const barLevel = Number(bar.getAttribute("data-bar")) || 0;
    bar.classList.toggle(WIFI_ACTIVE_CLASS, barLevel <= level && level > 0);
    bar.classList.toggle(WIFI_INACTIVE_CLASS, barLevel > level || level === 0);
  });
};

window.AppShared = {
  pingLevelFromMs(pingMs) {
    if (typeof pingMs !== "number") {
      return 0;
    }
    if (pingMs < 60) {
      return 4;
    }
    if (pingMs < 120) {
      return 3;
    }
    if (pingMs < 200) {
      return 2;
    }
    return 1;
  },
  ensureColyseus(statusEl) {
    if (typeof Colyseus === "undefined") {
      if (statusEl) {
        statusEl.textContent = "Client library failed to load.";
      }
      return false;
    }
    return true;
  },
  getWsEndpoint() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    return protocol + "://" + location.host;
  },
  renderPlayers(playersEl, countEl, spectatorsEl, spectatorCountEl, state) {
    if (countEl) {
      countEl.textContent = state.count ?? 0;
    }
    if (spectatorCountEl) {
      spectatorCountEl.textContent = state.spectatorCount ?? 0;
    }

    const renderList = (listEl, participants) => {
      if (!listEl) {
        return;
      }

      const fragment = document.createDocumentFragment();
      (participants || []).forEach((player) => {
        const listItem = document.createElement("li");
        listItem.className =
          "flex items-center gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/70 px-3 py-2";

        const playerName = document.createElement("span");
        playerName.className =
          "flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100";

        if (player.avatar) {
          const avatar = document.createElement("span");
          avatar.className =
            "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-base";
          avatar.setAttribute("aria-hidden", "true");
          avatar.textContent = player.avatar;
          playerName.appendChild(avatar);
        }

        const tags = [];
        if (player.connected === false) {
          tags.push("away");
        }
        const suffix = tags.length ? ` (${tags.join(", ")})` : "";
        const nickname = document.createElement("span");
        nickname.className = "text-sm text-slate-100";
        nickname.textContent = `${player.nickname}${suffix}`;
        playerName.appendChild(nickname);

        const level = window.AppShared.pingLevelFromMs(player.pingMs);
        const pingWrap = document.createElement("span");
        pingWrap.className = "ml-auto flex items-center gap-2 text-xs text-slate-200";
        const wifi = document.createElement("span");
        wifi.className = "flex items-end gap-1";
        wifi.setAttribute("aria-label", "Connection strength");

        [2, 3, 4, 5].forEach((height, index) => {
          const bar = document.createElement("span");
          bar.className = `h-${height} w-1 rounded-sm ${WIFI_INACTIVE_CLASS}`;
          bar.setAttribute("data-bar", String(index + 1));
          wifi.appendChild(bar);
        });
        updateWifiBars(wifi, level);

        const pingLabel = document.createElement("span");
        pingLabel.textContent =
          typeof player.pingMs === "number" ? `${Math.round(player.pingMs)}ms` : "--";
        pingWrap.appendChild(wifi);
        pingWrap.appendChild(pingLabel);

        listItem.appendChild(playerName);
        listItem.appendChild(pingWrap);
        fragment.appendChild(listItem);
      });

      listEl.replaceChildren(fragment);
    };

    renderList(playersEl, state.players);
    renderList(spectatorsEl, state.spectators);
  },
  renderJoinUrls(joinListEl, urls) {
    if (joinListEl) {
      joinListEl.innerHTML = urls
        .map(
          (url) =>
            `<li><code class="block rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-slate-200">${url}</code></li>`
        )
        .join("");
    }
  },
  updateWifiBars
};
