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
const closeOverlay = document.getElementById("closeOverlay");

const API_BASE = "https://tel-ghz-successful-software.trycloudflare.com"; // 🔧 change when tunnel changes

let mode = "movies";
let allVideos = [];
let progressCache = {};

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
  const res = await fetch(`${API_BASE}/videos?type=${mode}`, { credentials: "include" });
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
  const data = await res.json();
  progressCache = data;
  return data;
}

// --- Save progress ---
async function saveProgress() {
  if (!playerVideo.src) return;
  const relPath = playerVideo.src.split("/stream/")[1];
  if (!relPath) return;
  const time = Math.floor(playerVideo.currentTime);

  try {
    await fetch(`${API_BASE}/progress`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video: relPath, time }),
    });
    await updateContinueSection(); // refresh dynamically
  } catch (err) {
    console.warn("Progress save failed:", err);
  }
}

// --- Card creation ---
function createCard(v) {
  const div = document.createElement("article");
  div.className = "bf-card";
  div.innerHTML = `
    <div class="bf-thumb" style="background-image:url('${v.thumb || ""}')">
      ${!v.thumb ? prettyName(v.name) : ""}
    </div>
    <div class="bf-meta">
      <h3 class="bf-name">${prettyName(v.name)}</h3>
      <button class="bf-btn">Lejátszás</button>
    </div>
  `;
  div.querySelector(".bf-btn").addEventListener("click", () => openPlayer(v));
  return div;
}

// --- Section rendering ---
function renderSection(title, items) {
  const section = document.createElement("section");
  section.className = "bf-section";
  section.innerHTML = `
    <h2 class="bf-section-title">${title}</h2>
    <div class="bf-row"></div>
  `;
  const row = section.querySelector(".bf-row");
  items.forEach((v) => row.appendChild(createCard(v)));
  return section;
}

function renderAllSections(data) {
  grid.innerHTML = "";

  // Continue Watching first
  const progressEntries = Object.entries(progressCache || {});
  if (progressEntries.length) {
    const continueItems = progressEntries.map(([name, info]) => ({
      name,
      thumb: info.thumb || `/videos/${name.replace(/\.mp4$/, ".jpg")}`,
    }));
    const section = renderSection("Megtekintés folytatása", continueItems);
    grid.appendChild(section);
  }

  // Movie categories
  if (mode === "movies" && data.categories?.length) {
    data.categories.forEach((cat) => {
      const section = renderSection(cat.name, cat.items);
      grid.appendChild(section);
    });
  }

  // Series
  if (mode === "series" && data.shows?.length) {
    const section = renderSection("Sorozatok", data.shows);
    grid.appendChild(section);
  }

  if (!grid.children.length) {
    grid.innerHTML = `<div style="opacity:.8;text-align:center;margin-top:30px;">
      Nincs tartalom a(z) <b>${mode === "movies" ? "Filmek" : "Sorozatok"}</b> alatt.
    </div>`;
  }
}

// --- Player Overlay ---
function openPlayer(v) {
  const parts = v.name.split("/");
  let videoURL = "";

  if (v.name.startsWith("movies/")) {
    const category = parts[1];
    const file = parts.slice(2).join("/");
    videoURL = `${API_BASE}/stream/${encodeURIComponent(category)}/${encodeURIComponent(file)}`;
  } else if (v.name.startsWith("series/")) {
    const show = parts[1];
    const season = parts[2];
    const file = parts.slice(3).join("/");
    videoURL = `${API_BASE}/stream/${encodeURIComponent(show)}/${encodeURIComponent(
      season
    )}/${encodeURIComponent(file)}`;
  }

  playerVideo.src = videoURL;
  playerOverlay.classList.add("open");
  playerOverlay.setAttribute("aria-hidden", "false");
  closeOverlay.style.display = "block";

  // --- Auto-resume feature ---
  const relPath = v.name;
  const progress = progressCache?.[relPath];
  if (progress && progress.time > 10) {
    playerVideo.addEventListener(
      "loadedmetadata",
      () => {
        if (playerVideo.duration > progress.time) playerVideo.currentTime = progress.time;
      },
      { once: true }
    );
  }

  const reqFS = playerVideo.requestFullscreen || playerVideo.webkitRequestFullscreen;
  if (reqFS && window.innerWidth < 900) reqFS.call(playerVideo);

  playerVideo.play().catch(() => {});
}

function closePlayer() {
  saveProgress(); // ✅ save when closing
  playerVideo.pause();
  playerVideo.removeAttribute("src");
  playerVideo.load();
  playerOverlay.classList.remove("open");
  playerOverlay.setAttribute("aria-hidden", "true");
  closeOverlay.style.display = "none";
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

closeOverlay.addEventListener("click", closePlayer);
playerVideo.addEventListener("ended", () => {
  saveProgress();
  closePlayer();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && playerOverlay.classList.contains("open")) closePlayer();
});

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
document.querySelector(".logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  window.location.href = `${API_BASE}/logout`;
});

// --- Continue section refresh ---
async function updateContinueSection() {
  await fetchProgress();
  const data = await fetchVideos();
  renderAllSections(data);
}

// --- Init ---
async function loadAll() {
  try {
    const [data, _] = await Promise.all([fetchVideos(), fetchProgress()]);
    renderAllSections(data);
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div style="color:#ff2d55;">Hiba a betöltés során.</div>`;
  }
}

loadAll();
