// ===== app.js =====

// === Elements ===
const grid = document.getElementById("grid");
const search = document.getElementById("search");
const serverUrl = document.getElementById("serverUrl");

const modal = document.getElementById("playerModal");
const closeModalBtn = document.getElementById("closeModal");
const playerTitle = document.getElementById("playerTitle");
const videoEl = document.getElementById("player");
const backdrop = document.getElementById("modalBackdrop");

// ✅ Change this each time you restart Cloudflare tunnel
const API_BASE = "https://consists-warren-hardcover-earth.trycloudflare.com";

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

  // If not logged in → go to backend login page
  if (res.status === 401) {
    window.location.href = `${API_BASE}/login`;
    return [];
  }

  if (!res.ok) throw new Error("Failed to fetch videos");

  const data = await res.json();
  return data.map((name) => ({ id: encodeURIComponent(name), name }));
}

// === UI Builders ===
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
  if (e.key === "Escape" && modal.classList.contains("open")) closePlayer();
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

if (search) {
  search.addEventListener("input", (e) => applyFilter(e.target.value || ""));
}

// === Logout button handler ===
document.addEventListener("DOMContentLoaded", () => {
  const logoutLink = document.querySelector(".logout-btn");
  if (logoutLink) {
    logoutLink.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = `${API_BASE}/logout`;
    });
  }
});

// === Init ===
(async function init() {
  setServerURLLabel();
  try {
    allVideos = await fetchVideos();
    filtered = allVideos.slice();
    renderGrid(filtered);
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div style="color:#ff2d55;">Failed to load library.</div>`;
  }
})();

