// === Elements ===
const grid = document.getElementById("grid");
const search = document.getElementById("search");
const serverUrl = document.getElementById("serverUrl");
const moviesBtn = document.getElementById("moviesBtn");
const seriesBtn = document.getElementById("seriesBtn");
const continueGrid = document.getElementById("continueGrid");
const continueSection = document.getElementById("continueSection");

// Overlay player
const playerOverlay = document.getElementById("playerOverlay");
const playerVideo = document.getElementById("player");
const closeOverlay = document.getElementById("closeOverlay"); // our new visible “X” button

const API_BASE = "https://tel-ghz-successful-software.trycloudflare.com"; // 🔧 update this when tunnel changes

let mode = "movies";
let allVideos = [];
let filtered = [];

// --- Helpers ---
const prettyName = (name) =>
  name
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .trim();

function guessServerURL() {
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}${port ? ":" + port : ""}`;
}
serverUrl.textContent = guessServerURL();

// --- Fetch ---
async function fetchVideos() {
  const res = await fetch(`${API_BASE}/videos/${mode}`, { credentials: "include" });
  if (res.status === 401) {
    window.location.href = `${API_BASE}/login`;
    return [];
  }
  if (!res.ok) throw new Error("Fetch failed");
  return res.json();
}

async function fetchProgress() {
  const res = await fetch(`${API_BASE}/progress`, { credentials: "include" });
  if (!res.ok) return {};
  return res.json();
}

// --- Grid Rendering ---
function createCard(v) {
  const div = document.createElement("article");
  div.className = "bf-card";
  div.innerHTML = `
    <div class="bf-thumb" style="background-image:url('${v.thumb || ""}')">
      ${!v.thumb ? prettyName(v.name) : ""}
    </div>
    <div class="bf-meta">
      <h3 class="bf-name">${prettyName(v.name)}</h3>
      <button class="bf-btn" data-name="${v.name}">Lejátszás</button>
    </div>`;
  div.querySelector(".bf-btn").addEventListener("click", () => openPlayer(v));
  return div;
}

function renderGrid(list, targetGrid) {
  targetGrid.innerHTML = "";
  if (!list.length) {
    targetGrid.innerHTML = `<div style="opacity:.8">Nincs tartalom a(z) <b>${mode==="movies"?"Filmek":"Sorozatok"}</b> alatt.</div>`;
    return;
  }
  list.forEach(v => targetGrid.appendChild(createCard(v)));
}

// --- Player Overlay ---
function openPlayer(v) {
  const parts = v.name.split("/");
  let videoURL = "";

  if (v.name.startsWith("movies/")) {
    // movies/Vígjáték/A_Grand_Budapest_Hotel.mp4
    const category = parts[1];
    const file = parts.slice(2).join("/");
    videoURL = `${API_BASE}/stream/${encodeURIComponent(category)}/${encodeURIComponent(file)}`;
  } else if (v.name.startsWith("series/")) {
    // series/Breaking_Bad/Season 1/Episode_1.mp4
    const show = parts[1];
    const season = parts[2];
    const file = parts.slice(3).join("/");
    videoURL = `${API_BASE}/stream/${encodeURIComponent(show)}/${encodeURIComponent(season)}/${encodeURIComponent(file)}`;
  } else {
    videoURL = `${API_BASE}/stream/${encodeURIComponent(v.name)}`;
  }

  // Show overlay + load video
  playerVideo.src = videoURL;
  playerVideo.currentTime = 0;
  playerOverlay.classList.add("open");
  playerOverlay.setAttribute("aria-hidden", "false");

  // Always show close “X” on desktop
  closeOverlay.style.display = "block";

  // Fullscreen for mobile
  const reqFS = playerVideo.requestFullscreen || playerVideo.webkitRequestFullscreen;
  if (reqFS && window.innerWidth < 900) reqFS.call(playerVideo);

  playerVideo.play().catch(() => {});
}

function closePlayer() {
  playerVideo.pause();
  playerVideo.removeAttribute("src");
  playerVideo.load();
  playerOverlay.classList.remove("open");
  playerOverlay.setAttribute("aria-hidden", "true");
  closeOverlay.style.display = "none";
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// X button + ESC close support
closeOverlay.addEventListener("click", closePlayer);
playerVideo.addEventListener("ended", closePlayer);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && playerOverlay.classList.contains("open")) closePlayer();
});

// --- Filter ---
function applyFilter(q) {
  const needle = q.trim().toLowerCase();
  filtered = !needle
    ? allVideos.slice()
    : allVideos.filter(v => prettyName(v.name).toLowerCase().includes(needle));
  renderGrid(filtered, grid);
}
search.addEventListener("input", e => applyFilter(e.target.value));

// --- Mode switch ---
moviesBtn.onclick = () => {
  mode = "movies";
  moviesBtn.classList.add("active");
  seriesBtn.classList.remove("active");
  loadAll();
};
seriesBtn.onclick = () => {
  mode = "series";
  seriesBtn.classList.add("active");
  moviesBtn.classList.remove("active");
  loadAll();
};

// --- Logout ---
document.querySelector(".logout-btn").addEventListener("click", e => {
  e.preventDefault();
  window.location.href = `${API_BASE}/logout`;
});

// --- Init ---
async function loadAll() {
  try {
    allVideos = await fetchVideos();
    filtered = allVideos.slice();
    renderGrid(filtered, grid);

    const progress = await fetchProgress();
    const items = Object.values(progress || {});
    if (items.length) {
      continueSection.classList.remove("hidden");
      renderGrid(items, continueGrid);
    } else continueSection.classList.add("hidden");
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div style="color:#ff2d55;">Hiba a betöltés során.</div>`;
  }
}

loadAll();
