// === Elements ===
const grid = document.getElementById("grid");
const search = document.getElementById("search");
const serverUrl = document.getElementById("serverUrl");
const moviesBtn = document.getElementById("moviesBtn");
const seriesBtn = document.getElementById("seriesBtn");

// Overlay player
const playerOverlay = document.getElementById("playerOverlay");
const playerVideo = document.getElementById("player");
const closeOverlay = document.getElementById("closeOverlay");

const API_BASE = "https://tel-ghz-successful-software.trycloudflare.com"; // 🔧 update when tunnel changes

let mode = "movies";          // "movies" | "series"
let allItemsFlat = [];        // raw items from /videos/:type
let progressCache = {};       // from /progress

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

// Get category (movies/<category>/file.mp4)
function getCategoryFromName(name) {
  const parts = name.split("/");
  if (parts[0] === "movies" && parts.length >= 3) {
    return parts[1]; // e.g. "Vígjáték"
  }
  return null;
}

// Group flat movie array into { categoryName: [items...] }
function groupMoviesByCategory(items) {
  const groups = {};
  items.forEach((item) => {
    const cat = getCategoryFromName(item.name) || "Egyéb";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });
  return groups; // { "Vígjáték": [ ... ], "Akció": [ ... ] }
}

// Series: if backend returns flat list like ["series/Breaking_Bad", ...],
// we just put them all under "Sorozatok".
function makeSeriesGroup(items) {
  return { Sorozatok: items };
}

// --- API calls ---
async function fetchVideos() {
  // this matches your current backend route definition
  const res = await fetch(`${API_BASE}/videos/${mode}`, { credentials: "include" });
  if (res.status === 401) {
    window.location.href = `${API_BASE}/login`;
    return [];
  }
  if (!res.ok) throw new Error("Fetch videos failed");
  return res.json(); // returns flat array
}

async function fetchProgress() {
  const res = await fetch(`${API_BASE}/progress`, { credentials: "include" });
  if (!res.ok) return {};
  const data = await res.json();
  progressCache = data || {};
  return progressCache;
}

// save watch position in backend
async function saveProgress() {
  if (!playerVideo.src) return;
  // playerVideo.src looks like .../stream/<category>/<file> (movies)
  // or .../stream/<show>/<season>/<file> (series)
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
    // refresh continue watching row in UI
    await updateContinueAndRerender();
  } catch (err) {
    console.warn("Progress save failed:", err);
  }
}

// --- Card / Section builders ---
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

function buildSectionDOM(sectionTitle, items) {
  const section = document.createElement("section");
  section.className = "bf-section";
  section.innerHTML = `
    <h2 class="bf-section-title">${sectionTitle}</h2>
    <div class="bf-row"></div>
  `;
  const row = section.querySelector(".bf-row");
  items.forEach((item) => row.appendChild(createCard(item)));
  return section;
}

// Render all content rows into #grid
function renderAllSections() {
  const container = grid;
  container.innerHTML = "";

  // 1) "Continue watching" row
  const progressEntries = Object.entries(progressCache || {});
  if (progressEntries.length) {
    // Convert from progressCache { "movies/Cat/File.mp4": {time, thumb} } → cards
    const continueItems = progressEntries.map(([videoPath, info]) => {
      return {
        name: videoPath,
        thumb: info.thumb || guessThumbFromPath(videoPath),
      };
    });
    const contSec = buildSectionDOM("Megtekintés folytatása", continueItems);
    container.appendChild(contSec);
  }

  // 2) Content rows
  if (mode === "movies") {
    // group by category
    const grouped = groupMoviesByCategory(allItemsFlat); // { "Vígjáték": [...], "Akció": [...] }
    Object.keys(grouped).forEach((catName) => {
      const sec = buildSectionDOM(catName, grouped[catName]);
      container.appendChild(sec);
    });
  } else {
    // mode === "series"
    const grouped = makeSeriesGroup(allItemsFlat); // { "Sorozatok": [...] }
    Object.keys(grouped).forEach((title) => {
      const sec = buildSectionDOM(title, grouped[title]);
      container.appendChild(sec);
    });
  }

  // 3) If nothing rendered
  if (!container.children.length) {
    container.innerHTML = `
      <div style="opacity:.8;text-align:center;margin-top:30px;">
        Nincs tartalom a(z) <b>${mode === "movies" ? "Filmek" : "Sorozatok"}</b> alatt.
      </div>`;
  }
}

// helper: guess thumbnail path for continue watching items
function guessThumbFromPath(videoPath) {
  // videoPath like "movies/Vígjáték/A_Grand_Budapest_Hotel.mp4"
  // we try /videos/movies/Vígjáték/A_Grand_Budapest_Hotel.jpg
  if (videoPath.startsWith("movies/")) {
    const parts = videoPath.split("/");
    const cat = parts[1];
    const fileMP4 = parts.slice(2).join("/");
    const base = fileMP4.replace(/\.mp4$/i, "");
    return `/videos/movies/${encodeURIComponent(cat)}/${encodeURIComponent(base)}.jpg`;
  }
  // for series you could add cover or per-episode thumb logic later
  return "";
}

// --- Player Overlay + auto-resume ---
function openPlayer(v) {
  // Build correct stream URL from v.name
  const parts = v.name.split("/");
  let videoURL = "";

  if (v.name.startsWith("movies/")) {
    // movies/<cat>/<file>
    const category = parts[1];
    const file = parts.slice(2).join("/");
    videoURL = `${API_BASE}/stream/${encodeURIComponent(category)}/${encodeURIComponent(file)}`;
  } else if (v.name.startsWith("series/")) {
    // series/<show>/<season>/<file>
    const show = parts[1];
    const season = parts[2];
    const file = parts.slice(3).join("/");
    videoURL = `${API_BASE}/stream/${encodeURIComponent(show)}/${encodeURIComponent(season)}/${encodeURIComponent(file)}`;
  }

  playerVideo.src = videoURL;

  // --- Auto-resume:
  // lookup v.name in progressCache (keys are same format "movies/Category/File.mp4")
  const saved = progressCache[v.name];
  if (saved && saved.time > 10) {
    playerVideo.addEventListener(
      "loadedmetadata",
      () => {
        if (playerVideo.duration > saved.time) {
          playerVideo.currentTime = saved.time;
        }
      },
      { once: true }
    );
  }

  // Show overlay
  playerOverlay.classList.add("open");
  playerOverlay.setAttribute("aria-hidden", "false");
  closeOverlay.style.display = "block";

  // Fullscreen on mobile only
  const reqFS = playerVideo.requestFullscreen || playerVideo.webkitRequestFullscreen;
  if (reqFS && window.innerWidth < 900) {
    reqFS.call(playerVideo);
  }

  playerVideo.play().catch(() => {});
}

function reallyCloseOverlay() {
  playerOverlay.classList.remove("open");
  playerOverlay.setAttribute("aria-hidden", "true");
  closeOverlay.style.display = "none";
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

// when user closes / video ends
function closePlayer() {
  saveProgress(); // async, but we don't await, it's fine
  playerVideo.pause();
  playerVideo.removeAttribute("src");
  playerVideo.load();
  reallyCloseOverlay();
}

// events
closeOverlay.addEventListener("click", closePlayer);
playerVideo.addEventListener("ended", closePlayer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && playerOverlay.classList.contains("open")) {
    closePlayer();
  }
});

// --- Search filter ---
// We'll just filter the currently loaded allItemsFlat and re-render sections
// in a simplified way: show a single "Keresés eredményei" row if there's a query.
function applyFilter(q) {
  const needle = q.trim().toLowerCase();

  if (!needle) {
    // if search box empty, show normal layout again
    renderAllSections();
    return;
  }

  // filter items
  const filtered = allItemsFlat.filter((item) =>
    prettyName(item.name).toLowerCase().includes(needle)
  );

  grid.innerHTML = "";
  const sec = buildSectionDOM("Keresés eredményei", filtered);
  grid.appendChild(sec);
}
search.addEventListener("input", (e) => applyFilter(e.target.value));

// --- Mode switching ---
moviesBtn.onclick = () => {
  if (mode === "movies") return;
  mode = "movies";
  moviesBtn.classList.add("active");
  seriesBtn.classList.remove("active");
  initLoad();
};
seriesBtn.onclick = () => {
  if (mode === "series") return;
  mode = "series";
  seriesBtn.classList.add("active");
  moviesBtn.classList.remove("active");
  initLoad();
};

// --- Logout ---
document.querySelector(".logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  window.location.href = `${API_BASE}/logout`;
});

// --- Refresh progress row + re-render UI after saving position
async function updateContinueAndRerender() {
  await fetchProgress();
  renderAllSections();
}

// --- Initial load ---
async function initLoad() {
  try {
    // load both videos and progress
    const [items, _prog] = await Promise.all([fetchVideos(), fetchProgress()]);
    allItemsFlat = items; // array of {name, thumb}
    renderAllSections();
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div style="color:#ff2d55;">Hiba a betöltés során.</div>`;
  }
}

// kickstart
initLoad();
