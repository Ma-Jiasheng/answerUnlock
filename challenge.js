const wordEl = document.getElementById("word");
const optionsEl = document.getElementById("options");
const statusEl = document.getElementById("status");
const streakEl = document.getElementById("streak");
const targetEl = document.getElementById("target");
const wrongCountEl = document.getElementById("wrongCount");

let currentStreak = 0;
let requiredStreak = 0;
let wrongQueueSize = 0;

function setStatus(text, ok = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("ok", ok);
}

function renderProgress() {
  streakEl.textContent = String(currentStreak);
  targetEl.textContent = String(requiredStreak);
  wrongCountEl.textContent = String(wrongQueueSize);
}

function renderQuestion(question) {
  wordEl.textContent = question.word;
  optionsEl.innerHTML = "";

  question.options.forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option";
    btn.textContent = option;
    btn.addEventListener("click", () => submit(option));
    optionsEl.appendChild(btn);
  });
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

async function loadState() {
  const state = await sendMessage({ type: "get-state" });
  if (!state.ok) {
    throw new Error(state.error || "failed to load state");
  }
  currentStreak = state.currentStreak ?? 0;
  requiredStreak = state.requiredStreak ?? 0;
  wrongQueueSize = state.wrongQueueSize ?? 0;
  renderProgress();

  if (!state.locked || !state.question) {
    setStatus("当前未锁定，你可以继续使用浏览器。", true);
    wordEl.textContent = "Unlocked";
    optionsEl.innerHTML = "";
    return;
  }
  renderQuestion(state.question);
}

async function submit(answer) {
  setStatus("正在校验答案...");
  const result = await sendMessage({ type: "submit-answer", answer });
  if (!result.ok) {
    setStatus("校验失败，请重试。");
    return;
  }
  if (result.correct) {
    currentStreak = result.currentStreak ?? currentStreak;
    requiredStreak = result.requiredStreak ?? requiredStreak;
    wrongQueueSize = result.wrongQueueSize ?? wrongQueueSize;
    if (result.unlocked) {
      setStatus("回答正确，挑战完成，已解锁。", true);
      wordEl.textContent = "Great!";
      optionsEl.innerHTML = "";
    } else {
      setStatus(`回答正确！再答对 ${Math.max(requiredStreak - currentStreak, 0)} 题即可解锁。`, true);
      renderQuestion(result.nextQuestion);
    }
    renderProgress();
    return;
  }
  currentStreak = 0;
  requiredStreak = result.requiredStreak ?? requiredStreak;
  wrongQueueSize = result.wrongQueueSize ?? wrongQueueSize;
  renderProgress();
  setStatus("回答错误，连对已重置，错题会优先重练。");
  renderQuestion(result.nextQuestion);
}

loadState().catch((error) => {
  setStatus(`初始化失败：${error.message}`);
});
