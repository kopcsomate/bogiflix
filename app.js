// ===== app.js =====

// 🔴 IMPORTANT: update this URL whenever you restart your Cloudflare tunnel
const API_BASE = "https://tel-ghz-successful-software.trycloudflare.com";

// --- DOM refs ---
const grid = document.getElementById("grid");
const cont = document.getElementById("continue");
const search = document.getElementById("search");
const serverUrl = document.getElementById("serverUrl");

const tabs = document.querySelectorAll(".bf-tab");

const modal = document.getElementById("playerModal");
const closeModalBtn = document.getElementById("closeModal");
const videoEl = document.getElementById("player");

const epModal = document.getElementById("episodeModal");
const epCloseBtn = document.getElementById("closeEpisodeModal");
const showTitleEl = document.getElementById("showTitle");
const seasonSelect = document.getElementById("seasonSelect");
const episodeList = document.getElementById("episodeList");

// --- State ---
let activeType = "movies"; // "movies" | "series"
let allItems = [];         // list of cards for current tab
let filteredItems = [];    // after search filter
let serverProgress = {};   // { videoUrl: { time, thumb }, ... }
let currentPlaylist = [];  // [{ url, title, thumb }, ...] for autoplay
let currentPlaylistIndex = 0;
let lastOpenedShow = null; // full show object when viewing episodes
let progressSyncInterval = null;

// --- Utils ---
function prettyName(name) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// get local LAN URL into footer
function guessServerURL() {
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}${port ? ":" + port : ""}`;
}
if (serverUrl) {
  serverUrl.textContent = guessServerURL();
}

// resume time: prefer serverProgress, fall back to localStorage
function getResumeTime(url) {
  if (serverProgress[url] && typeof serverProgress[url].time === "number") {
    return serverProgress[url].time;
  }
  const local = localStorage.getItem("progress::" + url);
  return local ? parseFloat(local) || 0 : 0;
}

// save playback progress locally
function saveLocalProgress(url, time) {
  localStorage.setItem("progress::" + url, String(time));
}

// sync playback progress to server AND local
function syncProgressToServer(url, time, thumbUrl) {
  saveLocalProgress(url, time);

  fetch(`${API_BASE}/progress`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video: url,
      time,
      thumb: thumbUrl || null,
    }),
  })
    .then(r => r.ok ? r.json() : null)
    .then(() => {
      // also update our in-memory copy so Continue Watching updates instantly
      serverProgress[url] = {
        time,
        thumb: thumbUrl || (serverProgress[url] ? serverProgress[url].thumb : null),
      };
      renderContinueWatching();
    })
    .catch(() => {});
}

// clear entry from serverProgress (delete button)
function deleteProgressOnServer(url) {
  return fetch(`${API_BASE}/progress`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video: url }),
  });
}

// builds /stream URL for a movie
function buildMovieStreamURL(category, fileName) {
  return `${API_BASE}/stream/${encodeURIComponent(category)}/${encodeURIComponent(fileName)}`;
}

// builds /stream URL for an episode
function buildEpisodeStreamURL(showSlug, seasonName, fileName) {
  return `${API_BASE}/stream/${encodeURIComponent(showSlug)}/${encodeURIComponent(seasonName)}/${encodeURIComponent(fileName)}`;
}

// --- Fetch current library (movies or series) ---
async function fetchLibrary(type) {
  const res = await fetch(`${API_BASE}/videos?type=${type}`, {
    credentials: "include",
  });

  if (res.status === 401) {
    // not logged in on backend → bounce to backend login
    window.location.href = `${API_BASE}/login`;
    return [];
  }

  const data = await res.json();

  if (type === "movies") {
    // Flatten categories into a list of movie items
    const out = [];
    (data.categories || []).forEach((cat) => {
      const catName = cat.name;
      (cat.items || []).forEach((it) => {
        // build its stream URL and card data
        out.push({
          kind: "movie",
          title: prettyName(it.name),
          rawName: it.name,
          category: catName,
          thumbUrl: it.thumb || null,
          streamUrl: buildMovieStreamURL(catName, it.name),
        });
      });
    });
    return out;
  }

  if (type === "series") {
    // Each show is a card
    return (data.shows || []).map((show) => ({
      kind: "show",
      showTitle: show.title,
      slug: show.slug,
      thumbUrl: show.thumb || null,
      seasons: show.seasons || [],
    }));
  }

  return [];
}

// --- Render main content cards ---
function createMovieCard(movie) {
  const div = document.createElement("article");
  div.className = "bf-card";

  const thumbHTML = movie.thumbUrl
    ? `<img src="${movie.thumbUrl}" alt="${movie.title} borító" />`
    : movie.title;

  div.innerHTML = `
    <div class="bf-thumb">${thumbHTML}</div>
    <div class="bf-meta">
      <h3 class="bf-name" title="${movie.title}">${movie.title}</h3>
      <div class="bf-actions">
        <button class="bf-btn bf-play-btn">Lejátszás</button>
      </div>
    </div>
  `;

  div.querySelector(".bf-play-btn").addEventListener("click", () => {
    playSingleVideo(movie);
  });

  return div;
}

function createShowCard(show) {
  const div = document.createElement("article");
  div.className = "bf-card";

  const thumbHTML = show.thumbUrl
    ? `<img src="${show.thumbUrl}" alt="${show.showTitle} borító" />`
    : show.showTitle;

  div.innerHTML = `
    <div class="bf-thumb">${thumbHTML}</div>
    <div class="bf-meta">
      <h3 class="bf-name" title="${show.showTitle}">${show.showTitle}</h3>
      <div class="bf-actions">
        <button class="bf-btn bf-episodes-btn">Epizódok</button>
      </div>
    </div>
  `;

  div.querySelector(".bf-episodes-btn").addEventListener("click", () => {
    openEpisodePicker(show);
  });

  return div;
}

function renderGrid(list) {
  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `
      <div style="opacity:.8">
        Nincs tartalom a(z) <b>${activeType === "movies" ? "Filmek" : "Sorozatok"}</b> alatt.
      </div>`;
    return;
  }

  list.forEach((item) => {
    if (item.kind === "movie") {
      grid.appendChild(createMovieCard(item));
    } else {
      grid.appendChild(createShowCard(item));
    }
  });
}

// --- Continue Watching section ---
function renderContinueWatching() {
  cont.innerHTML = "";

  const entries = Object.entries(serverProgress || {});
  if (!entries.length) {
    // nothing watched yet → hide section
    return;
  }

  // Section title
  const h2 = document.createElement("h2");
  h2.textContent = "Folytatás megtekintése";
  cont.appendChild(h2);

  // Container
  const listDiv = document.createElement("div");
  listDiv.className = "bf-continue-list";

  // Each entry in progress: videoURL => {time, thumb}
  entries.forEach(([videoUrl, data]) => {
    const { time, thumb } = data || {};
    const minutes = Math.floor((time || 0) / 60);

    // Derive fallback title from url (the last file/segment)
    // e.g. /stream/Karácsony/Polar_Expressz.mp4 → Polar_Expressz.mp4 → Polar Expressz
    let fallbackTitle = decodeURIComponent(videoUrl.split("/").pop() || "");
    fallbackTitle = prettyName(fallbackTitle);

    const card = document.createElement("article");
    card.className = "bf-card";

    const thumbHTML = thumb
      ? `<img src="${thumb}" alt="${fallbackTitle} borító" />`
      : fallbackTitle;

    card.innerHTML = `
      <div class="bf-thumb">${thumbHTML}</div>
      <div class="bf-meta">
        <h3 class="bf-name" title="${fallbackTitle}">${fallbackTitle}</h3>
        <div class="bf-actions">
          <button class="bf-btn bf-continue-play">Lejátszás (${minutes} perc)</button>
          <button class="bf-remove bf-continue-remove">Törlés</button>
        </div>
      </div>
    `;

    // Play button resumes that URL
    card.querySelector(".bf-continue-play").addEventListener("click", () => {
      // fake "movie" object to reuse openPlayer()
      playDirectUrl(videoUrl, thumb || null);
    });

    // Delete button
    card.querySelector(".bf-continue-remove").addEventListener("click", async () => {
      await deleteProgressOnServer(videoUrl);
      delete serverProgress[videoUrl];
      renderContinueWatching();
    });

    listDiv.appendChild(card);
  });

  cont.appendChild(listDiv);
}

// --- Episode picker modal (for series) ---
function openEpisodePicker(show) {
  lastOpenedShow = show;

  showTitleEl.textContent = show.showTitle || "Sorozat";

  // Fill seasons dropdown
  seasonSelect.innerHTML = "";
  show.seasons.forEach((s, idx) => {
    const opt = document.createElement("option");
    opt.value = idx.toString();
    opt.textContent = s.season || `Évad ${idx + 1}`;
    seasonSelect.appendChild(opt);
  });

  // Build episode list for first season by default
  buildEpisodeListForSeason(show, 0);

  // Open modal
  epModal.classList.add("open");
  epModal.setAttribute("aria-hidden", "false");
}

function closeEpisodePicker() {
  epModal.classList.remove("open");
  epModal.setAttribute("aria-hidden", "true");
}

function buildEpisodeListForSeason(show, seasonIdx) {
  const sIdx = parseInt(seasonIdx, 10);
  const seasonData = show.seasons[sIdx];
  const { season, episodes } = seasonData;

  episodeList.innerHTML = "";

  // Build playlist for autoplay: all eps in this season, in order
  currentPlaylist = episodes.map((ep) => {
    const epUrl = buildEpisodeStreamURL(show.slug, season, ep.file);
    return {
      url: epUrl,
      title: ep.pretty || prettyName(ep.file),
      thumb: show.thumbUrl || null, // reuse series cover for all eps
    };
  });

  currentPlaylistIndex = 0; // default start

  episodes.forEach((ep, idx) => {
    const li = document.createElement("li");

    li.innerHTML = `
      <div class="bf-ep-thumb">
        ${show.thumbUrl ? `<img src="${show.thumbUrl}" alt="${ep.pretty || ep.file}">` : `<span>${idx + 1}</span>`}
      </div>
      <div class="bf-ep-info">
        <p class="bf-ep-name">${ep.pretty || prettyName(ep.file)}</p>
        <p class="bf-ep-extra">${season || "Évad"} · Ep ${idx + 1}</p>
      </div>
    `;

    li.addEventListener("click", () => {
      currentPlaylistIndex = idx;
      closeEpisodePicker();
      openPlayerFromPlaylist(currentPlaylistIndex);
    });

    episodeList.appendChild(li);
  });
}

// change season dropdown → rebuild list
if (seasonSelect) {
  seasonSelect.addEventListener("change", (e) => {
    if (!lastOpenedShow) return;
    buildEpisodeListForSeason(lastOpenedShow, e.target.value);
  });
}

// --- Player logic ---
function isSmartTV() {
  const ua = navigator.userAgent.toLowerCase();
  return (
    ua.includes("tizen") ||
    ua.includes("smart-tv") ||
    (ua.includes("samsungbrowser") && ua.includes("tv"))
  );
}

// plays any single movie (not part of a playlist)
function playSingleVideo(movieObj) {
  currentPlaylist = [
    {
      url: movieObj.streamUrl,
      title: movieObj.title,
      thumb: movieObj.thumbUrl || null,
    },
  ];
  currentPlaylistIndex = 0;
  openPlayerFromPlaylist(0);
}

// plays direct URL (for Continue Watching resume)
function playDirectUrl(url, thumbUrl) {
  currentPlaylist = [
    {
      url,
      title: prettyName(url.split("/").pop() || "Videó"),
      thumb: thumbUrl || null,
    },
  ];
  currentPlaylistIndex = 0;
  openPlayerFromPlaylist(0);
}

// open modal, start playback at resume position for that playlist item
function openPlayerFromPlaylist(idx) {
  const item = currentPlaylist[idx];
  if (!item) return;

  // If Smart TV -> just launch the mp4 URL directly
  if (isSmartTV()) {
    window.location.href = item.url;
    return;
  }

  const resumeAt = getResumeTime(item.url);

  // set video src and seek
  videoEl.src = item.url;
  videoEl.currentTime = resumeAt || 0;

  // show modal
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");

  // autoplay
  videoEl.play().catch(() => {});

  // record which URL is active for syncing
  videoEl.dataset.url = item.url;
  videoEl.dataset.thumb = item.thumb || "";
}

// auto-next when video ends
videoEl.addEventListener("ended", () => {
  // save last position as "finished" (we could set to 0 or very high)
  finalizeCurrentProgress();

  // go to next episode if available
  if (currentPlaylistIndex < currentPlaylist.length - 1) {
    currentPlaylistIndex += 1;
    openPlayerFromPlaylist(currentPlaylistIndex);
  } else {
    closePlayer();
  }
});

// periodically sync progress to server
function startProgressSync() {
  stopProgressSync();
  progressSyncInterval = setInterval(() => {
    if (!videoEl.src || videoEl.paused) return;
    const currentTime = videoEl.currentTime || 0;
    const url = videoEl.dataset.url;
    const thumb = videoEl.dataset.thumb;
    if (url) {
      syncProgressToServer(url, currentTime, thumb || null);
    }
  }, 30 * 1000);
}

function stopProgressSync() {
  if (progressSyncInterval) {
    clearInterval(progressSyncInterval);
    progressSyncInterval = null;
  }
}

// also save on every timeupdate locally (fast UI feel)
videoEl.addEventListener("timeupdate", () => {
  const url = videoEl.dataset.url;
  if (!url) return;
  // only spam local storage, not server
  saveLocalProgress(url, videoEl.currentTime || 0);
});

// save final state when user closes
function finalizeCurrentProgress() {
  const url = videoEl.dataset.url;
  if (!url) return;
  const time = videoEl.currentTime || 0;
  const thumb = videoEl.dataset.thumb || null;
  syncProgressToServer(url, time, thumb);
}

// close modal
function closePlayer() {
  finalizeCurrentProgress(); // make sure last time is saved

  stopProgressSync();

  videoEl.pause();
  videoEl.removeAttribute("src");
  videoEl.load();

  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");

  videoEl.dataset.url = "";
  videoEl.dataset.thumb = "";
}

if (closeModalBtn) {
  closeModalBtn.addEventListener("click", closePlayer);
}

// escape key handler (close modals / clear search)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (modal.classList.contains("open")) {
      closePlayer();
      return;
    }
    if (epModal.classList.contains("open")) {
      closeEpisodePicker();
      return;
    }
    if (search && search.value.trim().length > 0) {
      search.value = "";
      applyFilter("");
      search.focus();
    }
  }
});

// clicking outside episode picker close
if (epCloseBtn) {
  epCloseBtn.addEventListener("click", closeEpisodePicker);
}

// kick off periodic server sync when playing
videoEl.addEventListener("play", startProgressSync);
videoEl.addEventListener("pause", stopProgressSync);

// --- Search filtering ---
function applyFilter(q) {
  const needle = q.trim().toLowerCase();
  if (!needle) {
    filteredItems = allItems.slice();
  } else {
    filteredItems = allItems.filter((item) => {
      if (item.kind === "movie") {
        return item.title.toLowerCase().includes(needle);
      } else {
        return item.showTitle.toLowerCase().includes(needle);
      }
    });
  }
  renderGrid(filteredItems);
}

if (search) {
  search.addEventListener("input", (e) => applyFilter(e.target.value || ""));
}

// --- Tabs (Filmek / Sorozatok) ---
tabs.forEach((tab) => {
  tab.addEventListener("click", async () => {
    const newType = tab.getAttribute("data-type");
    if (newType === activeType) return;

    activeType = newType;

    // update tab visual state
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");

    // reload library for that tab
    allItems = await fetchLibrary(activeType);
    filteredItems = allItems.slice();
    renderGrid(filteredItems);
  });
});

// --- Logout button ---
document.addEventListener("DOMContentLoaded", () => {
  const logoutLink = document.querySelector(".logout-btn");
  if (logoutLink) {
    logoutLink.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = `${API_BASE}/logout`;
    });
  }
});

// --- Initial bootstrap ---
(async function init() {
  // 1. Load server progress
  try {
    const progRes = await fetch(`${API_BASE}/progress`, {
      credentials: "include",
    });
    if (progRes.ok) {
      serverProgress = await progRes.json();
    }
  } catch (err) {
    console.warn("Could not load server progress", err);
    serverProgress = {};
  }

  // render Continue Watching right away
  renderContinueWatching();

  // 2. Load initial library for default tab (movies)
  try {
    allItems = await fetchLibrary(activeType);
  } catch (err) {
    console.error(err);
    allItems = [];
  }

  filteredItems = allItems.slice();
  renderGrid(filteredItems);
})();
