const grid = document.getElementById("grid");
const moviesBtn = document.getElementById("moviesBtn");
const seriesBtn = document.getElementById("seriesBtn");
const playerOverlay = document.getElementById("playerOverlay");
const playerVideo = document.getElementById("player");
const closeOverlay = document.getElementById("closeOverlay");
const serverUrl = document.getElementById("serverUrl");

const API_BASE = "https://tel-ghz-successful-software.trycloudflare.com";

let mode = "movies";
let allItemsFlat = [];
let progressCache = {};

const prettyName = (name) =>
  name.split("/").pop().replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ").trim();

function guessServerURL() {
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}${port ? ":" + port : ""}`;
}
serverUrl.textContent = guessServerURL();

function getCategoryFromName(name) {
  const parts = name.split("/");
  if (parts[0] === "movies" && parts.length >= 3) return parts[1];
  return null;
}

function groupMoviesByCategory(items) {
  const groups = {};
  items.forEach((item) => {
    const cat = getCategoryFromName(item.name) || "Egyéb";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });
  return groups;
}

async function fetchVideos() {
  const res = await fetch(`${API_BASE}/videos/${mode}`, { credentials: "include" });
  if (res.status === 401) {
    window.location.href = `${API_BASE}/login`;
    return [];
  }
  if (!res.ok) throw new Error("fetch failed");
  return res.json();
}

async function fetchProgress() {
  const res = await fetch(`${API_BASE}/progress`, { credentials: "include" });
  if (!res.ok) return {};
  const data = await res.json();
  progressCache = data || {};
  return progressCache;
}

async function saveProgress() {
  if (!playerVideo.src) return;
  const relPath = playerVideo.src.split("/stream/")[1];
  if (!relPath) return;
  const time = Math.floor(playerVideo.currentTime);
  await fetch(`${API_BASE}/progress`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video: relPath, time }),
  });
}

function guessThumbFromPath(videoPath) {
  // your thumbnails are in /movies/ not /videos/movies/
  const parts = videoPath.split("/");
  if (videoPath.startsWith("movies/")) {
    const category = parts[1];
    const filename = parts.slice(2).join("/").replace(/\.mp4$/i, "");
    return `/movies/${encodeURIComponent(category)}/${encodeURIComponent(filename)}.jpg`;
  }
  return "";
}

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

function buildSection(title, items) {
  const section = document.createElement("section");
  section.className = "bf-section";
  section.innerHTML = `<h2 class="bf-section-title">${title}</h2><div class="bf-row"></div>`;
  const row = section.querySelector(".bf-row");
  items.forEach((v) => row.appendChild(createCard(v)));
  return section;
}

function renderAll() {
  grid.innerHTML = "";

  // Continue Watching
  const contEntries = Object.entries(progressCache);
  if (contEntries.length) {
    const contItems = contEntries.map(([video, info]) => ({
      name: video,
      thumb: info.thumb || guessThumbFromPath(video),
    }));
    grid.appendChild(buildSection("Megtekintés Folytatása", contItems));
  }

  // Movies
  if (mode === "movies") {
    const grouped = groupMoviesByCategory(allItemsFlat);
    for (const cat of Object.keys(grouped)) {
      grid.appendChild(buildSection(cat, grouped[cat]));
    }
  }
}

function openPlayer(v) {
  const parts = v.name.split("/");
  let videoURL = "";
  if (v.name.startsWith("movies/")) {
    const cat = parts[1];
    const file = parts.slice(2).join("/");
    // 👇 Add leading /movies/
    videoURL = `${API_BASE}/stream/movies/${encodeURIComponent(cat)}/${encodeURIComponent(file)}`;
  }

  playerVideo.src = videoURL;
  const progress = progressCache[v.name];
  if (progress && progress.time > 10) {
    playerVideo.addEventListener(
      "loadedmetadata",
      () => (playerVideo.currentTime = Math.min(progress.time, playerVideo.duration - 5)),
      { once: true }
    );
  }

  playerOverlay.classList.add("open");
  playerOverlay.setAttribute("aria-hidden", "false");
  closeOverlay.style.display = "block";
  playerVideo.play().catch(() => {});
}

function closePlayer() {
  saveProgress();
  playerVideo.pause();
  playerVideo.removeAttribute("src");
  playerVideo.load();
  playerOverlay.classList.remove("open");
  playerOverlay.setAttribute("aria-hidden", "true");
}

closeOverlay.addEventListener("click", closePlayer);
playerVideo.addEventListener("ended", closePlayer);

async function init() {
  try {
    const [items] = await Promise.all([fetchVideos(), fetchProgress()]);
    allItemsFlat = items;
    await fetchProgress();
    renderAll();
  } catch (e) {
    console.error(e);
    grid.innerHTML = `<div style="color:#ff2d55">Hiba a betöltés során.</div>`;
  }
}
init();
