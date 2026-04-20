(function initOverlay() {
  const ROOT_ID = "__word_unlock_overlay__";
  if (document.getElementById(ROOT_ID)) return;

  let locked = false;
  let currentStreak = 0;
  let requiredStreak = 0;
  let wrongQueueSize = 0;
  let showCountdown = true;
  let activeQuestion = null;
  let stopped = false;
  let awaitingContinueClick = false;
  let selectedAnswer = null;
  let submitLocked = false;
  const timerIds = [];

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.style.position = "fixed";
  root.style.right = "14px";
  root.style.bottom = "14px";
  root.style.zIndex = "2147483647";
  root.style.background = "rgba(15, 23, 42, 0.9)";
  root.style.color = "#fff";
  root.style.padding = "10px 12px";
  root.style.borderRadius = "10px";
  root.style.fontFamily = "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, Microsoft YaHei, sans-serif";
  root.style.fontSize = "12px";
  root.style.lineHeight = "1.45";
  root.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.28)";
  root.style.maxWidth = "260px";
  root.style.pointerEvents = "none";
  root.textContent = "Word Unlock 计时加载中...";

  const modal = document.createElement("div");
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.zIndex = "2147483646";
  modal.style.background = "rgba(2, 6, 23, 0.8)";
  modal.style.display = "none";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";
  modal.style.padding = "16px";

  const card = document.createElement("div");
  card.style.width = "min(520px, 100%)";
  card.style.background = "#fff";
  card.style.borderRadius = "16px";
  card.style.padding = "22px";
  card.style.boxShadow = "0 16px 48px rgba(0, 0, 0, 0.28)";
  card.style.color = "#0f172a";
  card.style.fontFamily = "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, Microsoft YaHei, sans-serif";

  const title = document.createElement("h2");
  title.textContent = "专注挑战";
  title.style.margin = "0 0 6px";

  const desc = document.createElement("p");
  desc.textContent = "视频已暂停，连续答对后才能继续浏览。";
  desc.style.margin = "0 0 12px";
  desc.style.color = "#475569";

  const progress = document.createElement("p");
  progress.style.margin = "0 0 12px";
  progress.style.fontWeight = "600";

  const word = document.createElement("div");
  word.style.fontSize = "38px";
  word.style.fontWeight = "700";
  word.style.margin = "10px 0 14px";

  const optionWrap = document.createElement("div");
  optionWrap.style.display = "grid";
  optionWrap.style.gap = "10px";

  const status = document.createElement("p");
  status.style.margin = "12px 0 0";
  status.style.minHeight = "20px";
  status.style.color = "#b91c1c";

  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(progress);
  card.appendChild(word);
  card.appendChild(optionWrap);
  card.appendChild(status);
  modal.appendChild(card);

  function appendIfMissing(el) {
    if (stopped) return;
    if (!document.documentElement.contains(el)) {
      document.documentElement.appendChild(el);
    }
  }

  function stopOverlay() {
    if (stopped) return;
    stopped = true;
    timerIds.forEach((id) => clearInterval(id));
    timerIds.length = 0;
    try {
      root.remove();
      modal.remove();
    } catch (error) {
      // ignore cleanup failures
    }
  }

  function formatSec(totalSec) {
    const safe = Math.max(0, totalSec);
    const mm = String(Math.floor(safe / 60)).padStart(2, "0");
    const ss = String(safe % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function setStatus(text, ok = false) {
    status.textContent = text;
    status.style.color = ok ? "#15803d" : "#b91c1c";
  }

  function pauseAllMedia() {
    const media = document.querySelectorAll("video, audio");
    media.forEach((m) => {
      try {
        m.pause();
      } catch (error) {
        // ignore
      }
    });
  }

  function renderQuestion(question) {
    activeQuestion = question;
    awaitingContinueClick = false;
    selectedAnswer = null;
    submitLocked = false;
    word.textContent = question.word;
    optionWrap.innerHTML = "";
    question.options.forEach((option) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.optionValue = option;
      btn.textContent = option;
      btn.style.border = "1px solid #cbd5e1";
      btn.style.background = "#f8fafc";
      btn.style.padding = "12px";
      btn.style.borderRadius = "10px";
      btn.style.cursor = "pointer";
      btn.style.fontSize = "15px";
      btn.style.transition = "all 0.15s ease";
      btn.addEventListener("click", () => submitAnswer(option));
      optionWrap.appendChild(btn);
    });
  }

  function markAnswerResult(correctAnswer) {
    const buttons = optionWrap.querySelectorAll("button");
    buttons.forEach((btn) => {
      const value = btn.dataset.optionValue || "";
      btn.disabled = true;
      if (value === correctAnswer) {
        btn.style.background = "#dcfce7";
        btn.style.borderColor = "#16a34a";
        btn.style.color = "#166534";
      } else if (value === selectedAnswer) {
        btn.style.background = "#fee2e2";
        btn.style.borderColor = "#dc2626";
        btn.style.color = "#991b1b";
      } else {
        btn.style.opacity = "0.7";
      }
    });
  }

  async function continueToNextQuestion() {
    if (!awaitingContinueClick) return;
    const resp = await sendMessage({ type: "next-question-after-wrong" });
    if (!resp?.ok || !resp.nextQuestion) {
      setStatus("下一题加载失败，请重试。");
      return;
    }
    awaitingContinueClick = false;
    setStatus("");
    renderQuestion(resp.nextQuestion);
  }

  function renderProgress() {
    progress.textContent = `连对 ${currentStreak}/${requiredStreak}，错题池 ${wrongQueueSize}`;
  }

  function showLockModal() {
    modal.style.display = "flex";
    document.documentElement.style.overflow = "hidden";
    if (document.body) document.body.style.overflow = "hidden";
    pauseAllMedia();
  }

  function hideLockModal() {
    modal.style.display = "none";
    document.documentElement.style.overflow = "";
    if (document.body) document.body.style.overflow = "";
    setStatus("");
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      if (stopped) {
        reject(new Error("overlay stopped"));
        return;
      }
      try {
        // Accessing chrome.runtime itself can throw after extension reload.
        if (!chrome?.runtime?.id) {
          stopOverlay();
          reject(new Error("Extension context invalidated"));
          return;
        }
        const payload = { ...message, pageUrl: location.href };
        chrome.runtime.sendMessage(payload, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            if (String(err.message || "").includes("Extension context invalidated")) {
              stopOverlay();
            }
            reject(new Error(err.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        if (String(error?.message || "").includes("Extension context invalidated")) {
          stopOverlay();
        }
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async function refreshState() {
    if (stopped) return;
    const [countdown, state] = await Promise.all([
      sendMessage({ type: "get-countdown" }),
      sendMessage({ type: "get-state" })
    ]);
    if (!countdown?.ok || !state?.ok) return;

    if (
      state.pluginEnabled === false ||
      countdown.pluginEnabled === false ||
      state.siteActive === false ||
      countdown.siteActive === false
    ) {
      locked = false;
      hideLockModal();
      root.style.display = "none";
      return;
    }
    showCountdown = state.showCountdown !== false && countdown.showCountdown !== false;
    root.style.display = showCountdown ? "block" : "none";

    root.style.background = state.locked ? "rgba(185, 28, 28, 0.92)" : "rgba(15, 23, 42, 0.9)";
    root.textContent = state.locked
      ? "已锁定：请先完成答题"
      : `学习拦截倒计时 ${formatSec(countdown.remainingSec)} (${countdown.usedMinutes}/${countdown.limitMinutes} 分钟)`;

    locked = Boolean(state.locked);
    currentStreak = state.currentStreak ?? 0;
    requiredStreak = state.requiredStreak ?? 0;
    wrongQueueSize = state.wrongQueueSize ?? 0;
    renderProgress();

    if (locked && state.question) {
      showLockModal();
      if (!activeQuestion || activeQuestion.word !== state.question.word) {
        renderQuestion(state.question);
      }
    } else {
      hideLockModal();
      activeQuestion = null;
    }
  }

  async function submitAnswer(answer) {
    if (stopped) return;
    if (submitLocked) return;
    if (awaitingContinueClick) {
      continueToNextQuestion().catch(() => {
        setStatus("下一题加载失败，请重试。");
      });
      return;
    }
    submitLocked = true;
    selectedAnswer = answer;
    setStatus("正在校验...");
    const result = await sendMessage({ type: "submit-answer", answer });
    submitLocked = false;
    if (!result?.ok) {
      setStatus("校验失败，请重试。");
      return;
    }
    currentStreak = result.currentStreak ?? currentStreak;
    requiredStreak = result.requiredStreak ?? requiredStreak;
    wrongQueueSize = result.wrongQueueSize ?? wrongQueueSize;
    renderProgress();

    if (result.correct && result.unlocked) {
      setStatus("挑战完成，已解锁。", true);
      await refreshState();
      return;
    }
    if (result.correct) {
      setStatus(`回答正确，再答对 ${Math.max(requiredStreak - currentStreak, 0)} 题。`, true);
      if (result.nextQuestion) renderQuestion(result.nextQuestion);
      return;
    }
    const correctAnswer = activeQuestion?.correctZh || "";
    markAnswerResult(correctAnswer);
    awaitingContinueClick = true;
    setStatus(
      `回答错误，正确答案：${correctAnswer || "未知"}。点击任意处进入下一题。`
    );
  }

  document.addEventListener("keydown", (e) => {
    if (!locked) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener("click", (e) => {
    if (!locked) return;
    if (awaitingContinueClick) {
      e.preventDefault();
      e.stopImmediatePropagation();
      continueToNextQuestion().catch(() => {
        setStatus("下一题加载失败，请重试。");
      });
      return;
    }
    if (card.contains(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  timerIds.push(setInterval(() => {
    if (stopped) return;
    if (locked) pauseAllMedia();
    if (showCountdown) {
      appendIfMissing(root);
    } else if (document.documentElement.contains(root)) {
      root.remove();
    }
    appendIfMissing(modal);
  }, 800));

  appendIfMissing(root);
  appendIfMissing(modal);
  refreshState();
  timerIds.push(setInterval(() => {
    if (stopped) return;
    refreshState().catch(() => {
      if (stopped) return;
      root.textContent = "Word Unlock 未连接";
      root.style.background = "rgba(71, 85, 105, 0.92)";
    });
  }, 1000));
})();
