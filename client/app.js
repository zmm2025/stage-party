const statusEl = document.getElementById("status");
const joinButton = document.getElementById("join");
const pingButton = document.getElementById("ping");
const logEl = document.getElementById("log");
const nicknameInput = document.getElementById("nickname");
const playerCountEl = document.getElementById("player-count");
const playersEl = document.getElementById("players");

const { roomName } = window.AppConfig;
const { ensureColyseus, getWsEndpoint, renderPlayers } = window.AppShared;

let room = null;

const connect = async () => {
  if (!ensureColyseus(statusEl)) {
    return;
  }

  joinButton.disabled = true;
  statusEl.textContent = "Connecting...";

  try {
    const client = new Colyseus.Client(getWsEndpoint());
    const nickname = nicknameInput.value.trim();

    room = await client.joinOrCreate(roomName, { nickname });
    statusEl.textContent = `Connected: ${room.sessionId}`;
    pingButton.disabled = false;

    room.onMessage("server:event", (message) => {
      logEl.textContent = `Server: ${JSON.stringify(message)}`;
    });

    room.onMessage("lobby:state", (state) => {
      renderPlayers(playersEl, playerCountEl, state);
    });

    pingButton.addEventListener("click", () => {
      room.send("client:event", {
        type: "ping",
        payload: { at: Date.now() }
      });
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
