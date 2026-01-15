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
        .map((player) => `<li>${player.nickname}</li>`)
        .join("");
    }
  },
  renderJoinUrls(joinListEl, urls) {
    if (joinListEl) {
      joinListEl.innerHTML = urls.map((url) => `<li><code>${url}</code></li>`).join("");
    }
  }
};
