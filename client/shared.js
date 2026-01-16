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
  renderPlayers(playersEl, countEl, state) {
    if (countEl) {
      countEl.textContent = state.count ?? 0;
    }
    if (playersEl) {
      playersEl.innerHTML = (state.players || [])
        .map((player) => {
          const avatar = player.avatar
            ? `<span class="avatar" aria-hidden="true">${player.avatar}</span>`
            : "";
          const tags = [];
          if (player.ready) {
            tags.push("ready");
          }
          if (player.connected === false) {
            tags.push("away");
          }
          const suffix = tags.length ? ` (${tags.join(", ")})` : "";
          const ping =
            typeof player.pingMs === "number" ? ` - ${Math.round(player.pingMs)}ms` : "";
          const level = window.AppShared.pingLevelFromMs(player.pingMs);
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
            `<span class="nickname">${player.nickname}${suffix}${ping}</span>` +
            `</span>` +
            `${wifi}` +
            `</li>`
          );
        })
        .join("");
    }
  },
  renderJoinUrls(joinListEl, urls) {
    if (joinListEl) {
      joinListEl.innerHTML = urls.map((url) => `<li><code>${url}</code></li>`).join("");
    }
  }
};
