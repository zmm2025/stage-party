window.AppShared = {
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
          const tags = [];
          if (player.ready) {
            tags.push("ready");
          }
          if (player.connected === false) {
            tags.push("away");
          }
          const suffix = tags.length ? ` (${tags.join(", ")})` : "";
          return `<li>${player.nickname}${suffix}</li>`;
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
