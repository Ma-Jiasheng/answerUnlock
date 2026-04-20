const dateTextEl = document.getElementById("dateText");
const interceptionsEl = document.getElementById("interceptions");
const attemptsEl = document.getElementById("attempts");
const accuracyEl = document.getElementById("accuracy");
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

async function loadStats() {
  const result = await sendMessage({ type: "get-stats" });
  if (!result.ok) {
    throw new Error(result.error || "load stats failed");
  }
  dateTextEl.textContent = `日期：${result.dateKey}`;
  interceptionsEl.textContent = String(result.interceptions || 0);
  attemptsEl.textContent = String(result.attempts || 0);
  accuracyEl.textContent = `${result.accuracy || 0}%`;
}

loadStats().catch((error) => {
  statusEl.textContent = `加载统计失败：${error.message}`;
});
