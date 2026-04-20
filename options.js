const input = document.getElementById("limitMinutes");
const streakInput = document.getElementById("requiredStreak");
const pluginEnabledInput = document.getElementById("pluginEnabled");
const resetOnWrongInput = document.getElementById("resetOnWrong");
const showCountdownInput = document.getElementById("showCountdown");
const selectedBookInput = document.getElementById("selectedBook");
const enabledSitesInput = document.getElementById("enabledSites");
const saveBtn = document.getElementById("saveBtn");
const openStatsBtn = document.getElementById("openStatsBtn");
const statusEl = document.getElementById("status");

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

async function load() {
  const [{ limitMinutes, requiredStreak, pluginEnabled, selectedBookId, resetOnWrong, showCountdown, enabledSites }, booksRes] = await Promise.all([
    chrome.storage.sync.get([
      "limitMinutes",
      "requiredStreak",
      "pluginEnabled",
      "selectedBookId",
      "resetOnWrong",
      "showCountdown",
      "enabledSites"
    ]),
    sendMessage({ type: "list-books" })
  ]);
  input.value = String(limitMinutes || 30);
  streakInput.value = String(requiredStreak || 3);
  pluginEnabledInput.checked = typeof pluginEnabled === "boolean" ? pluginEnabled : true;
  resetOnWrongInput.checked = typeof resetOnWrong === "boolean" ? resetOnWrong : true;
  showCountdownInput.checked = typeof showCountdown === "boolean" ? showCountdown : true;
  enabledSitesInput.value = Array.isArray(enabledSites) ? enabledSites.join("\n") : "";
  const books = booksRes?.ok ? booksRes.books : [];
  selectedBookInput.innerHTML = "";
  books.forEach((book) => {
    const option = document.createElement("option");
    option.value = book.id;
    option.textContent = book.name;
    selectedBookInput.appendChild(option);
  });
  if (books.length === 0) {
    const option = document.createElement("option");
    option.value = "built_in";
    option.textContent = "内置词书（演示）";
    selectedBookInput.appendChild(option);
  }
  selectedBookInput.value = selectedBookId || selectedBookInput.options[0]?.value || "built_in";
}

async function save() {
  const val = Number(input.value);
  const streakVal = Number(streakInput.value);
  if (!Number.isFinite(val) || val < 1) {
    statusEl.textContent = "请输入大于等于 1 的整数。";
    statusEl.style.color = "#b91c1c";
    return;
  }
  if (!Number.isFinite(streakVal) || streakVal < 1) {
    statusEl.textContent = "连续答对题数 N 必须大于等于 1。";
    statusEl.style.color = "#b91c1c";
    return;
  }
  const enabledSites = enabledSitesInput.value
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);

  const res = await sendMessage({
    type: "update-settings",
    limitMinutes: Math.floor(val),
    requiredStreak: Math.floor(streakVal),
    pluginEnabled: Boolean(pluginEnabledInput.checked),
    selectedBookId: selectedBookInput.value,
    resetOnWrong: Boolean(resetOnWrongInput.checked),
    showCountdown: Boolean(showCountdownInput.checked),
    enabledSites
  });
  if (!res?.ok) {
    statusEl.textContent = `保存失败：${res?.error || "unknown error"}`;
    statusEl.style.color = "#b91c1c";
    return;
  }
  statusEl.textContent = "已保存。新设置会在下一次计时周期生效。";
  statusEl.style.color = "#15803d";
}

saveBtn.addEventListener("click", () => {
  save().catch((error) => {
    statusEl.textContent = `保存失败：${error.message}`;
    statusEl.style.color = "#b91c1c";
  });
});

openStatsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("stats.html") });
});

load().catch((error) => {
  statusEl.textContent = `加载失败：${error.message}`;
  statusEl.style.color = "#b91c1c";
});
