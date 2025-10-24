// === Elements ===
const grid = document.getElementById("grid");
const search = document.getElementById("search");
const serverUrl = document.getElementById("serverUrl");

const modal = document.getElementById("playerModal");
const closeModalBtn = document.getElementById("closeModal");
const playerTitle = document.getElementById("playerTitle");
const videoEl = document.getElementById("player");
const backdrop = document.getElementById("modalBackdrop");


 const API_BASE = "https://mon-across-dietary-msie.trycloudflare.com  ";


// === Helpers ===
const prettyName = (name) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function guessServerURL() {
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}${port ? ":" + port : ""}`;
}

function setServerURLLabel() {
  serverUrl.textContent = guessServerURL();
}

// === API ===
async function fetchVideos() {
  const res = await fetch(`${API_BASE}/videos`, { credentials: "include" });

  // 👇 If not logged in, open the backend login page
  if (res.status === 401) {
    window.location.href = `${API_BASE}/login`;
    return [];
  }

  if (!res.ok) throw new Error("Failed to fetch videos");

  const data = await res.json();
  return data.map((name) => ({ id: encodeURIComponent(name), name }));
}


// === UI builders ===
function createCard(v) {
  const div = document.createElement("article");
  div.className = "bf-card";
  div.innerHTML = `
    <div class="bf-thumb" aria-hidden="true">${prettyName(v.name)}</div>
    <div class="bf-meta">
      <h3 class="bf-name" title="${v.name}">${prettyName(v.name)}</h3>
      <div class="bf-actions">
        <button class="bf-btn" data-id="${v.id}" data-name="${v.name}">Lejátszás</button>
      </div>
    </div>
  `;
  const btn = div.querySelector(".bf-btn");
  btn.addEventListener("click", () => openPlayer(v));
  return div;
}

function renderGrid(list) {
  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `
      <div style="opacity:.8">
        Nincsenek videók. Helyezz néhány <code>.mp4</code> fájlt a <code>videos</code> mappába.
      </div>`;
    return;
  }
  list.forEach((v) => grid.appendChild(createCard(v)));
}

// === Player ===
function openPlayer(v) {
  playerTitle.textContent = prettyName(v.name);
  videoEl.src = `${API_BASE}/stream/${v.name}`;
  videoEl.currentTime = 0;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  videoEl.play().catch(() => {});
}

function closePlayer() {
  videoEl.pause();
  videoEl.removeAttribute("src");
  videoEl.load();
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

// === Event handlers ===
closeModalBtn.addEventListener("click", closePlayer);
backdrop.addEventListener("click", closePlayer);
document.addEventListener("keydown", (e) => {
  // ESC closes modal if open
  if (e.key === "Escape" && modal.classList.contains("open")) {
    closePlayer();
  }

  // ESC clears search if modal not open
  else if (e.key === "Escape" && !modal.classList.contains("open")) {
    if (search && search.value.trim().length > 0) {
      search.value = "";
      applyFilter("");
      search.focus();
    }
  }
});

// === Search filtering ===
let allVideos = [];
let filtered = [];

function applyFilter(q) {
  const needle = q.trim().toLowerCase();
  if (!needle) filtered = allVideos.slice();
  else filtered = allVideos.filter((v) =>
    prettyName(v.name).toLowerCase().includes(needle)
  );
  renderGrid(filtered);
}

// Attach listener safely
if (search) {
  search.addEventListener("input", (e) => {
    const query = e.target.value || "";
    applyFilter(query);
  });
}

// === Init ===
(async function init() {
  setServerURLLabel();
  try {
    allVideos = await fetchVideos();
    filtered = allVideos.slice();
    renderGrid(filtered);
    //if (search) search.focus(); // focus automatically
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div style="color:#ff2d55;">Failed to load library.</div>`;
  }
})();
