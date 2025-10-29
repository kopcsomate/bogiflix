const grid = document.getElementById("grid");
const moviesBtn = document.getElementById("moviesBtn");
const seriesBtn = document.getElementById("seriesBtn");
const search = document.getElementById("search");
const serverUrl = document.getElementById("serverUrl");

const playerOverlay = document.getElementById("playerOverlay");
const playerVideo = document.getElementById("player");
const closeOverlay = document.getElementById("closeOverlay");


const API_BASE = "https://ground-analyzed-electronic-tuesday.trycloudflare.com";

let mode = "movies";
let allItemsFlat = [];
let progressCache = {};


const prettyName = (fullPath) =>
  fullPath
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .trim();

const guessServerURL = () => {
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}${port ? ":" + port : ""}`;
};
if (serverUrl) serverUrl.textContent = guessServerURL();

function normalizeVideoPath(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}


async function fetchVideos() {
  const res = await fetch(`${API_BASE}/videos/${mode}`, { credentials: "include" });
  if (res.status === 401) window.location.href = `${API_BASE}/login`;
  if (!res.ok) throw new Error("fetchVideos failed");
  return res.json();
}

async function fetchProgress() {
  const res = await fetch(`${API_BASE}/progress`, { credentials: "include" });
  if (!res.ok) return {};
  const data = await res.json();
  const fixed = {};
  Object.entries(data || {}).forEach(([k, v]) => (fixed[normalizeVideoPath(k)] = v));
  progressCache = fixed;
  return fixed;
}


const getCategoryFromName = (path) => path.split("/")[1] || "Egyéb";

function groupMovies(items) {
  const groups = {};
  items.forEach((it) => {
    const cat = getCategoryFromName(it.name);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(it);
  });
  return groups;
}


function guessThumbFromPath(videoPath) {
  const norm = normalizeVideoPath(videoPath);
  const parts = norm.split("/");
  if (parts[0] === "movies" && parts.length >= 3) {
    const cat = parts[1];
    const file = parts.slice(2).join("/").replace(/\.mp4$/i, "");
    return `/videos/movies/${encodeURIComponent(cat)}/${encodeURIComponent(file)}.jpg`;
  }
  return "";
}


function createCard(item, isContinue = false) {
  const div = document.createElement("article");
  div.className = "bf-card";
  const title = prettyName(item.name);
  const thumb = item.thumb || guessThumbFromPath(item.name);

  div.innerHTML = `
    <div class="bf-thumb" style="background-image:url('${thumb}')">
      ${!thumb ? title : ""}
    </div>
    <div class="bf-meta">
      <h3 class="bf-name">${title}</h3>
      <button class="bf-btn">Lejátszás</button>
      ${isContinue ? '<button class="bf-del-progress-btn">Folytatás törlése</button>' : ""}
    </div>
  `;


  div.querySelector(".bf-btn").addEventListener("click", () => openPlayer(item));


  if (isContinue) {
    const delBtn = div.querySelector(".bf-del-progress-btn");
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await fetch(`${API_BASE}/progress`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ video: item.name }),
        });
        await fetchProgress();
        renderAll(); 
      } catch (err) {
        console.error("Failed to delete progress:", err);
      }
    });
  }

  return div;
}

function buildSection(title, items, isContinue = false) {
  const section = document.createElement("section");
  section.className = "bf-section";
  section.innerHTML = `<h2 class="bf-section-title">${title}</h2><div class="bf-row"></div>`;
  const row = section.querySelector(".bf-row");
  items.forEach((it) => row.appendChild(createCard(it, isContinue)));
  return section;
}

function renderAll() {
  grid.innerHTML = "";


  const cont = Object.entries(progressCache);
  if (cont.length) {
    const unique = {};
    cont.forEach(([k, v]) => {
      if (!unique[k]) unique[k] = v;
    });
    const continueItems = Object.keys(unique).map((k) => ({
      name: k,
      thumb: guessThumbFromPath(k),
    }));
    grid.appendChild(buildSection("Megtekintés Folytatása", continueItems, true));
  }


  if (mode === "movies") {
    const groups = groupMovies(allItemsFlat);
    Object.keys(groups).forEach((cat) => grid.appendChild(buildSection(cat, groups[cat])));
  }


  if (!grid.children.length) {
    grid.innerHTML = `<div style="text-align:center;opacity:.7;">Nincs tartalom.</div>`;
  }
}


function openPlayer(item) {
  const norm = normalizeVideoPath(item.name);
  const parts = norm.split("/");

  let videoURL = "";
  if (norm.startsWith("movies/")) {
    const category = parts[1];
    const file = parts.slice(2).join("/");
    videoURL = `${API_BASE}/stream/${encodeURIComponent(category)}/${encodeURIComponent(file)}`;
  }

  playerVideo.src = videoURL;
  const saved = progressCache[norm];
  if (saved?.time > 10) {
    playerVideo.addEventListener(
      "loadedmetadata",
      () => {
        if (playerVideo.duration && saved.time < playerVideo.duration)
          playerVideo.currentTime = saved.time;
      },
      { once: true }
    );
  }

  playerOverlay.classList.add("open");
  playerVideo.play().catch(() => {});
}

async function closePlayer() {
  if (playerVideo.src) {
    const rel = playerVideo.src.split("/stream/")[1];
    if (rel) {
      try {
        await fetch(`${API_BASE}/progress`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            video: decodeURIComponent(rel),
            time: Math.floor(playerVideo.currentTime),
          }),
        });
      } catch (e) {
        console.warn("progress save failed", e);
      }
    }
  }

  playerVideo.pause();
  playerVideo.removeAttribute("src");
  playerVideo.load();
  playerOverlay.classList.remove("open");

  await fetchProgress();
  renderAll();
}

closeOverlay.addEventListener("click", closePlayer);
playerVideo.addEventListener("ended", closePlayer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && playerOverlay.classList.contains("open")) closePlayer();
});


search?.addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) return renderAll();
  const matches = allItemsFlat.filter((i) =>
    prettyName(i.name).toLowerCase().includes(q)
  );
  grid.innerHTML = "";
  grid.appendChild(buildSection("Keresés eredményei", matches));
});


moviesBtn?.addEventListener("click", async () => {
  mode = "movies";
  moviesBtn.classList.add("active");
  seriesBtn.classList.remove("active");
  await initLoad();
});
seriesBtn?.addEventListener("click", async () => {
  mode = "series";
  seriesBtn.classList.add("active");
  moviesBtn.classList.remove("active");
  await initLoad();
});


async function initLoad() {
  try {
    allItemsFlat = await fetchVideos();
    await fetchProgress();
    renderAll();
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div style="color:#ff2d55;">Hiba a betöltés során.</div>`;
  }
}

initLoad();
