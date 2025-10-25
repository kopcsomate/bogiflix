// === DOM Elements ===
const grid = document.getElementById("grid");
const moviesBtn = document.getElementById("moviesBtn");
const seriesBtn = document.getElementById("seriesBtn");
const search = document.getElementById("search");
const serverUrl = document.getElementById("serverUrl");

const playerOverlay = document.getElementById("playerOverlay");
const playerVideo = document.getElementById("player");
const closeOverlay = document.getElementById("closeOverlay");

// 🔧 Update this when Cloudflare tunnel changes
const API_BASE = "https://tel-ghz-successful-software.trycloudflare.com";

let mode = "movies";          // "movies" | "series"
let allItemsFlat = [];        // [{ name, thumb }]
let progressCache = {};       // { "movies/Category/File.mp4": { time, thumb? } }

// ----- Helpers -----

// Nicely display video file name without path/extension/underscores
function prettyName(fullPath) {
  return fullPath
    .split("/")            // only keep after last slash
    .pop()
    .replace(/\.[^.]+$/, "") // drop .mp4
    .replace(/[_\-]+/g, " ")
    .trim();
}

// Show local server URL in footer
function guessServerURL() {
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}${port ? ":" + port : ""}`;
}
if (serverUrl) {
  serverUrl.textContent = guessServerURL();
}

// Get movie category from path "movies/<cat>/<file>"
function getCategoryFromName(fullPath) {
  const parts = fullPath.split("/");
  if (parts[0] === "movies" && parts.length >= 3) {
    return parts[1]; // ex. "Vígjáték"
  }
  return null;
}

// Group movies into { "Vígjáték": [ {name,thumb}, ...], "Akció": [...] }
function groupMoviesByCategory(items) {
  const groups = {};
  items.forEach((item) => {
    const cat = getCategoryFromName(item.name) || "Egyéb";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });
  return groups;
}

// For series (future): right now we just group them into one row "Sorozatok"
function groupSeries(items) {
  return { Sorozatok: items };
}

// Build a correct public thumbnail URL for Continue Watching
// e.g. "movies/Vígjáték/A_Grand_Budapest_Hotel.mp4"
// -> "/videos/movies/Vígjáték/A_Grand_Budapest_Hotel.jpg"
function guessThumbFromPath(videoPath) {
  const parts = videoPath.split("/");
  if (parts[0] === "movies" && parts.length >= 3) {
    const category = parts[1];
    const fileNoExt = parts.slice(2).join("/").replace(/\.mp4$/i, "");

    // Important: encode each segment separately so accents like "í" work
    return (
      "/videos/" +
      "movies/" +
      encodeURIComponent(category) +
      "/" +
      encodeURIComponent(fileNoExt) +
      ".jpg"
    );
  }

  // For series later you can add per-show cover logic
  return "";
}

// ----- API Calls -----

async function fetchVideos() {
  // Your server exposes /videos/:type (movies or series)
  const res = await fetch(`${API_BASE}/videos/${mode}`, {
    credentials: "include",
  });

  if (res.status === 401) {
    // session invalid --> redirect to backend login
    window.location.href = `${API_BASE}/login`;
    return [];
  }

  if (!res.ok) throw new Error("fetchVideos failed");

  // movies mode returns flat array of { name, thumb? }
  // series mode returns flat array (for now also { name, thumb? })
  return res.json();
}

async function fetchProgress() {
  const res = await fetch(`${API_BASE}/progress`, {
    credentials: "include",
  });
  if (!res.ok) {
    progressCache = {};
    return {};
  }
  const data = await res.json();
  progressCache = data || {};
  return progressCache;
}

// Save playback position when closing player or video ends
async function saveProgress() {
  if (!playerVideo.src) return;

  // playerVideo.src looks like:
  //   https://<tunnel>/stream/<cat>/<file.mp4>       (movies)
  // or https://<tunnel>/stream/<show>/<season>/<file.mp4> (series, future)
  //
  // We only want the part after /stream/ to match server-side key
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

    // refresh continue watching row in memory + UI
    await updateContinueAndRerender();
  } catch (err) {
    console.warn("Progress save failed:", err);
  }
}

// ----- UI Builders -----

function createCard(item) {
  // item = { name: "movies/Vígjáték/A_...mp4", thumb: "/videos/...jpg" }
  const card = document.createElement("article");
  card.className = "bf-card";

  const displayName = prettyName(item.name);

  card.innerHTML = `
    <div class="bf-thumb" style="background-image:url('${item.thumb || ""}')">
      ${!item.thumb ? displayName : ""}
    </div>
    <div class="bf-meta">
      <h3 class="bf-name">${displayName}</h3>
      <button class="bf-btn">Lejátszás</button>
    </div>
  `;

  // Play button opens overlay player
  card.querySelector(".bf-btn").addEventListener("click", () => openPlayer(item));

  return card;
}

function buildSectionDOM(title, items) {
  const section = document.createElement("section");
  section.className = "bf-section";

  section.innerHTML = `
    <h2 class="bf-section-title">${title}</h2>
    <div class="bf-row"></div>
  `;

  const row = section.querySelector(".bf-row");
  items.forEach((it) => {
    row.appendChild(createCard(it));
  });

  return section;
}

// Render page: Continue Watching row first, then categories / series rows
function renderAllSections() {
  grid.innerHTML = "";

  // 1. Continue Watching
  const contEntries = Object.entries(progressCache); // [ [videoPath, {time,...}], ... ]
  if (contEntries.length) {
    const continueItems = contEntries.map(([videoPath, info]) => {
      return {
        name: videoPath,
        thumb: info.thumb || guessThumbFromPath(videoPath),
      };
    });

    const contSec = buildSectionDOM("Megtekintés Folytatása", continueItems);
    grid.appendChild(contSec);
  }

  // 2. Movies mode -> group by category and build each row
  if (mode === "movies") {
    const grouped = groupMoviesByCategory(allItemsFlat);
    Object.keys(grouped).forEach((cat) => {
      const sec = buildSectionDOM(cat, grouped[cat]);
      grid.appendChild(sec);
    });
  }

  // 3. Series mode -> single row for now
  if (mode === "series") {
    const grouped = groupSeries(allItemsFlat); // { Sorozatok: [...] }
    Object.keys(grouped).forEach((label) => {
      const sec = buildSectionDOM(label, grouped[label]);
      grid.appendChild(sec);
    });
  }

  // 4. empty fallback
  if (!grid.children.length) {
    grid.innerHTML = `
      <div style="opacity:.8;text-align:center;margin-top:30px;">
        Nincs tartalom a(z) <b>${mode === "movies" ? "Filmek" : "Sorozatok"}</b> alatt.
      </div>`;
  }
}

// Render a search result row only
function renderSearchResults(query) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    renderAllSections();
    return;
  }

  // search within allItemsFlat
  const matches = allItemsFlat.filter((item) =>
    prettyName(item.name).toLowerCase().includes(needle)
  );

  grid.innerHTML = "";
  const sec = buildSectionDOM("Keresés eredményei", matches);
  grid.appendChild(sec);

  // Also optionally include continue watching matches
  // (we'll keep it simple and not merge them for now)
}

// ----- Player overlay -----

function openPlayer(item) {
  // item.name example:
  //   "movies/Vígjáték/A_Grand_Budapest_Hotel.mp4"

  const parts = item.name.split("/");

  let videoURL = "";

  if (item.name.startsWith("movies/")) {
    // server route: /stream/:category/:name
    // category = parts[1]
    // file = parts.slice(2).join("/")
    const category = parts[1];
    const file = parts.slice(2).join("/");

    // We MUST NOT put /movies/... here. server.js expects just /stream/<cat>/<file>
    videoURL =
      `${API_BASE}/stream/` +
      encodeURIComponent(category) +
      `/` +
      encodeURIComponent(file);
  } else if (item.name.startsWith("series/")) {
    // future series format if/when you add it
    // server route: /stream/:show/:season/:file
    const show = parts[1];
    const season = parts[2];
    const file = parts.slice(3).join("/");

    videoURL =
      `${API_BASE}/stream/` +
      encodeURIComponent(show) +
      `/` +
      encodeURIComponent(season) +
      `/` +
      encodeURIComponent(file);
  }

  // attach to video element
  playerVideo.src = videoURL;

  // auto-resume if we have progress
  const saved = progressCache[item.name];
  if (saved && saved.time > 10) {
    playerVideo.addEventListener(
      "loadedmetadata",
      () => {
        // only seek if still within duration
        if (playerVideo.duration && saved.time < playerVideo.duration) {
          playerVideo.currentTime = saved.time;
        }
      },
      { once: true }
    );
  }

  // show overlay
  playerOverlay.classList.add("open");
  playerOverlay.setAttribute("aria-hidden", "false");

  // Make sure close button is visible
  closeOverlay.style.display = "block";

  // Autoplay
  playerVideo.play().catch(() => {});
}

// Close overlay + save position
function closePlayer() {
  saveProgress(); // async, but no need to await

  playerVideo.pause();
  playerVideo.removeAttribute("src");
  playerVideo.load();

  playerOverlay.classList.remove("open");
  playerOverlay.setAttribute("aria-hidden", "true");
}

closeOverlay.addEventListener("click", closePlayer);
playerVideo.addEventListener("ended", closePlayer);

// Escape key closes overlay
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && playerOverlay.classList.contains("open")) {
    closePlayer();
  }
});

// ----- Search handling -----

if (search) {
  search.addEventListener("input", (e) => {
    renderSearchResults(e.target.value || "");
  });
}

// ----- Mode switching -----

moviesBtn?.addEventListener("click", async () => {
  if (mode === "movies") return;
  mode = "movies";
  moviesBtn.classList.add("active");
  seriesBtn.classList.remove("active");
  await initLoad();
});

seriesBtn?.addEventListener("click", async () => {
  if (mode === "series") return;
  mode = "series";
  seriesBtn.classList.add("active");
  moviesBtn.classList.remove("active");
  await initLoad();
});

// ----- Refresh continue-watching row after save -----

async function updateContinueAndRerender() {
  await fetchProgress();
  renderAllSections();
}

// ----- Initial load -----

async function initLoad() {
  try {
    // load videos (movies or series for current mode)
    const items = await fetchVideos();
    allItemsFlat = items;

    // also load progress so we can render "Megtekintés Folytatása"
    await fetchProgress();

    renderAllSections();
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div style="color:#ff2d55;">Hiba a betöltés során.</div>`;
  }
}

initLoad();
