const limitInput = document.getElementById("limitMinutes");
const streakInput = document.getElementById("requiredStreak");
const pluginEnabledInput = document.getElementById("pluginEnabled");
const selectedBookInput = document.getElementById("selectedBook");
const resetOnWrongInput = document.getElementById("resetOnWrong");
const showCountdownInput = document.getElementById("showCountdown");
const countdownEl = document.getElementById("countdown");
const usageTextEl = document.getElementById("usageText");
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");
const statsBtn = document.getElementById("statsBtn");
const optionsBtn = document.getElementById("optionsBtn");

function setStatus(text, ok = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("ok", ok);
}

function formatSec(totalSec) {
  const safe = Math.max(0, Number(totalSec) || 0);
  const mm = String(Math.floor(safe / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

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

async function loadConfig() {
  const [{ limitMinutes, requiredStreak, pluginEnabled, selectedBookId, resetOnWrong, showCountdown }, booksRes] = await Promise.all([
    chrome.storage.sync.get([
      "limitMinutes",
      "requiredStreak",
      "pluginEnabled",
      "selectedBookId",
      "resetOnWrong",
      "showCountdown"
    ]),
    sendMessage({ type: "list-books" })
  ]);

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
    option.value = "ieltsluan_2";
    option.textContent = "雅思词汇 IELTSluan_2";
    selectedBookInput.appendChild(option);
  }

  const targetBookId = selectedBookId || selectedBookInput.options[0]?.value || "ieltsluan_2";
  selectedBookInput.value = targetBookId;

  limitInput.value = String(limitMinutes || 30);
  streakInput.value = String(requiredStreak || 3);
  pluginEnabledInput.checked = typeof pluginEnabled === "boolean" ? pluginEnabled : true;
  resetOnWrongInput.checked = typeof resetOnWrong === "boolean" ? resetOnWrong : true;
  showCountdownInput.checked = typeof showCountdown === "boolean" ? showCountdown : true;
}

async function refreshCountdown() {
  const res = await sendMessage({ type: "get-countdown" });
  if (!res?.ok) {
    throw new Error(res?.error || "get-countdown failed");
  }
  if (res.pluginEnabled === false) {
    countdownEl.textContent = "已关闭";
    usageTextEl.textContent = "插件功能未启用";
    return;
  }
  countdownEl.textContent = res.locked ? "已锁定" : formatSec(res.remainingSec);
  usageTextEl.textContent = `进度 ${res.usedMinutes}/${res.limitMinutes} 分钟`;
}

async function saveConfig() {
  const limitMinutes = Number(limitInput.value);
  const requiredStreak = Number(streakInput.value);
  const pluginEnabled = Boolean(pluginEnabledInput.checked);
  const selectedBookId = selectedBookInput.value;
  const resetOnWrong = Boolean(resetOnWrongInput.checked);
  const showCountdown = Boolean(showCountdownInput.checked);
  if (!Number.isFinite(limitMinutes) || limitMinutes < 1) {
    setStatus("倒计时必须大于等于 1 分钟");
    return;
  }
  if (!Number.isFinite(requiredStreak) || requiredStreak < 1) {
    setStatus("N 必须大于等于 1");
    return;
  }
  const res = await sendMessage({
    type: "update-settings",
    limitMinutes: Math.floor(limitMinutes),
    requiredStreak: Math.floor(requiredStreak),
    pluginEnabled,
    selectedBookId,
    resetOnWrong,
    showCountdown
  });
  if (!res?.ok) {
    setStatus(`保存失败：${res?.error || "unknown error"}`);
    return;
  }
  setStatus("已保存并生效", true);
  await refreshCountdown();
}

async function resetUsage() {
  const res = await sendMessage({ type: "reset-usage" });
  if (!res?.ok) {
    setStatus(`重置失败：${res?.error || "unknown error"}`);
    return;
  }
  setStatus("计时已重置", true);
  await refreshCountdown();
}

saveBtn.addEventListener("click", () => {
  saveConfig().catch((error) => setStatus(`保存异常：${error.message}`));
});

resetBtn.addEventListener("click", () => {
  resetUsage().catch((error) => setStatus(`重置异常：${error.message}`));
});

statsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("stats.html") });
});

optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

Promise.all([loadConfig(), refreshCountdown()])
  .catch((error) => {
    setStatus(`初始化失败：${error.message}`);
  });
