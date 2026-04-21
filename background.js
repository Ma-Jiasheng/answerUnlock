const TICK_ALARM = "usage-tick";
const DEFAULT_LIMIT_MINUTES = 30;
const DEFAULT_REQUIRED_STREAK = 3;
const DEFAULT_PLUGIN_ENABLED = true;
const DEFAULT_SELECTED_BOOK_ID = "ieltsluan_2";
const DEFAULT_RESET_ON_WRONG = true;
const DEFAULT_SHOW_COUNTDOWN = true;
const DEFAULT_ENABLED_SITES = [];
let initPromise = null;
const bookCache = new Map();

const WORD_BANK = [
  { en: "apple", zh: "苹果" },
  { en: "book", zh: "书" },
  { en: "river", zh: "河流" },
  { en: "window", zh: "窗户" },
  { en: "garden", zh: "花园" },
  { en: "future", zh: "未来" },
  { en: "honest", zh: "诚实的" },
  { en: "travel", zh: "旅行" },
  { en: "knowledge", zh: "知识" },
  { en: "freedom", zh: "自由" },
  { en: "decision", zh: "决定" },
  { en: "energy", zh: "能量" }
];

const BOOK_CATALOG = [
  { id: "ieltsluan_2", name: "雅思词汇 IELTSluan_2", file: "IELTSluan_2.simple.json" }
];

function getBookMeta(bookId) {
  return BOOK_CATALOG.find((b) => b.id === bookId) || BOOK_CATALOG[0];
}

async function loadBookWords(bookId) {
  const bookMeta = getBookMeta(bookId);
  if (!bookMeta.file) {
    return WORD_BANK.map((item) => ({ en: item.en, zh: item.zh }));
  }
  if (bookCache.has(bookMeta.id)) {
    return bookCache.get(bookMeta.id);
  }
  try {
    const url = chrome.runtime.getURL(bookMeta.file);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`book fetch failed: ${resp.status}`);
    const data = await resp.json();
    const normalized = Array.isArray(data)
      ? data
          .map((item) => ({
            en: String(item.word || "").trim(),
            zh: String(item.meaning || "").trim()
          }))
          .filter((item) => item.en && item.zh)
      : [];
    if (normalized.length > 0) {
      bookCache.set(bookMeta.id, normalized);
      return normalized;
    }
  } catch (error) {
    console.warn("load book failed, fallback internal bank", bookMeta.id, error);
  }
  return WORD_BANK.map((item) => ({ en: item.en, zh: item.zh }));
}

async function ensureDefaults() {
  const { limitMinutes, requiredStreak, pluginEnabled, selectedBookId, resetOnWrong, showCountdown, enabledSites } = await chrome.storage.sync.get([
    "limitMinutes",
    "requiredStreak",
    "pluginEnabled",
    "selectedBookId",
    "resetOnWrong",
    "showCountdown",
    "enabledSites"
  ]);
  const syncPatch = {};
  if (!Number.isFinite(limitMinutes) || limitMinutes <= 0) {
    syncPatch.limitMinutes = DEFAULT_LIMIT_MINUTES;
  }
  if (!Number.isFinite(requiredStreak) || requiredStreak <= 0) {
    syncPatch.requiredStreak = DEFAULT_REQUIRED_STREAK;
  }
  if (typeof pluginEnabled !== "boolean") {
    syncPatch.pluginEnabled = DEFAULT_PLUGIN_ENABLED;
  }
  if (!BOOK_CATALOG.some((book) => book.id === selectedBookId)) {
    syncPatch.selectedBookId = DEFAULT_SELECTED_BOOK_ID;
  }
  if (typeof resetOnWrong !== "boolean") {
    syncPatch.resetOnWrong = DEFAULT_RESET_ON_WRONG;
  }
  if (typeof showCountdown !== "boolean") {
    syncPatch.showCountdown = DEFAULT_SHOW_COUNTDOWN;
  }
  if (!Array.isArray(enabledSites)) {
    syncPatch.enabledSites = DEFAULT_ENABLED_SITES;
  }
  if (Object.keys(syncPatch).length > 0) {
    await chrome.storage.sync.set(syncPatch);
  }

  const state = await chrome.storage.local.get([
    "usedMinutes",
    "locked",
    "currentQuestion",
    "currentStreak",
    "wrongQueue",
    "dailyStats",
    "lastTickAt"
  ]);

  const patch = {};
  if (!Number.isFinite(state.usedMinutes)) patch.usedMinutes = 0;
  if (typeof state.locked !== "boolean") patch.locked = false;
  if (state.currentQuestion === undefined) patch.currentQuestion = null;
  if (!Number.isFinite(state.currentStreak) || state.currentStreak < 0) {
    patch.currentStreak = 0;
  }
  if (!Array.isArray(state.wrongQueue)) patch.wrongQueue = [];
  if (!isValidDailyStats(state.dailyStats)) patch.dailyStats = createDailyStats();
  if (!Number.isFinite(state.lastTickAt)) patch.lastTickAt = Date.now();
  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(TICK_ALARM);
  if (!existing) {
    chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  }
}

function shuffle(arr) {
  const cloned = [...arr];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function createDailyStats() {
  return {
    dateKey: todayKey(),
    interceptions: 0,
    attempts: 0,
    correct: 0
  };
}

function isValidDailyStats(stats) {
  if (!stats || typeof stats !== "object") return false;
  return (
    typeof stats.dateKey === "string" &&
    Number.isFinite(stats.interceptions) &&
    Number.isFinite(stats.attempts) &&
    Number.isFinite(stats.correct)
  );
}

function normalizeDailyStats(stats) {
  const currentDate = todayKey();
  if (!isValidDailyStats(stats) || stats.dateKey !== currentDate) {
    return createDailyStats();
  }
  return stats;
}

async function updateDailyStats(mutator) {
  const { dailyStats } = await chrome.storage.local.get("dailyStats");
  const nextStats = normalizeDailyStats(dailyStats);
  mutator(nextStats);
  await chrome.storage.local.set({ dailyStats: nextStats });
  return nextStats;
}

function pickTargetWord(wordBank, wrongQueue) {
  const shouldRetryWrong = wrongQueue.length > 0 && Math.random() < 0.7;
  if (shouldRetryWrong) {
    const candidate = wordBank.find((word) => word.en === wrongQueue[0]);
    if (candidate) return candidate;
  }
  return wordBank[Math.floor(Math.random() * wordBank.length)];
}

function buildQuestion(wordBank, wrongQueue = []) {
  if (!Array.isArray(wordBank) || wordBank.length < 4) {
    wordBank = WORD_BANK.map((item) => ({ en: item.en, zh: item.zh }));
  }
  const target = pickTargetWord(wordBank, wrongQueue);
  const wrongs = shuffle(
    wordBank.filter((w) => w.en !== target.en).map((w) => w.zh)
  ).slice(0, 3);
  const options = shuffle([target.zh, ...wrongs]);
  return {
    word: target.en,
    correctZh: target.zh,
    options
  };
}

async function ensureQuestionWhenLocked(preferredBookId) {
  const local = await chrome.storage.local.get(["locked", "currentQuestion", "wrongQueue"]);
  if (!local.locked) return null;
  if (local.currentQuestion && local.currentQuestion.word && local.currentQuestion.correctZh) {
    return local.currentQuestion;
  }
  const selectedBookId = preferredBookId || (await chrome.storage.sync.get("selectedBookId")).selectedBookId;
  const wrongQueue = Array.isArray(local.wrongQueue) ? local.wrongQueue : [];
  const wordBank = await loadBookWords(selectedBookId || DEFAULT_SELECTED_BOOK_ID);
  const question = buildQuestion(wordBank, wrongQueue);
  await chrome.storage.local.set({ currentQuestion: question });
  return question;
}

async function lockBrowser() {
  const [{ wrongQueue }, { selectedBookId }] = await Promise.all([
    chrome.storage.local.get("wrongQueue"),
    chrome.storage.sync.get("selectedBookId")
  ]);
  const wordBank = await loadBookWords(selectedBookId || DEFAULT_SELECTED_BOOK_ID);
  const question = buildQuestion(wordBank, Array.isArray(wrongQueue) ? wrongQueue : []);
  await chrome.storage.local.set({
    locked: true,
    currentQuestion: question,
    currentStreak: 0
  });
  await updateDailyStats((stats) => {
    stats.interceptions += 1;
  });
}

async function unlockBrowser() {
  await chrome.storage.local.set({
    locked: false,
    usedMinutes: 0,
    currentQuestion: null,
    currentStreak: 0,
    lastTickAt: Date.now()
  });
}

async function handleTick() {
  await ensureInitialized();
  const [{ locked, usedMinutes }, { limitMinutes, pluginEnabled, enabledSites }] = await Promise.all([
    chrome.storage.local.get(["locked", "usedMinutes"]),
    chrome.storage.sync.get(["limitMinutes", "pluginEnabled", "enabledSites"])
  ]);

  if (pluginEnabled === false) {
    return;
  }
  const activeTabUrl = await getActiveTabUrl();
  if (!isSiteEnabled(activeTabUrl, enabledSites)) {
    return;
  }
  if (locked) {
    return;
  }

  const nextMinutes = (usedMinutes ?? 0) + 1;
  await chrome.storage.local.set({ usedMinutes: nextMinutes, lastTickAt: Date.now() });
  const validLimit = Number.isFinite(limitMinutes) && limitMinutes > 0
    ? limitMinutes
    : DEFAULT_LIMIT_MINUTES;

  if (nextMinutes >= validLimit) {
    await lockBrowser();
  }
}

function normalizeSiteRule(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.replace(/\/.*$/, "");
  if (s.startsWith("*.")) s = s.slice(2);
  return s;
}

function normalizeEnabledSites(sites) {
  if (!Array.isArray(sites)) return [];
  return sites
    .map(normalizeSiteRule)
    .filter(Boolean);
}

function isSiteEnabled(urlString, enabledSites) {
  const normalizedSites = normalizeEnabledSites(enabledSites);
  if (normalizedSites.length === 0) return true;
  if (!urlString) return true;
  if (!/^https?:\/\//i.test(urlString)) return false;
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return normalizedSites.some((site) => host === site || host.endsWith(`.${site}`));
  } catch (_error) {
    return false;
  }
}

async function getActiveTabUrl() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0]?.url || null;
}

function getMessageUrl(message, sender) {
  return message?.pageUrl || sender?.tab?.url || null;
}

async function init() {
  await ensureDefaults();
  await ensureAlarm();
}

function ensureInitialized() {
  if (!initPromise) {
    initPromise = init().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

chrome.runtime.onInstalled.addListener(() => {
  ensureInitialized().catch((err) => console.error("init failed on install", err));
});

chrome.runtime.onStartup.addListener(() => {
  ensureInitialized().catch((err) => console.error("init failed on startup", err));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TICK_ALARM) return;
  handleTick().catch((err) => console.error("tick failed", err));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "get-state") {
    ensureInitialized().catch((err) => console.error("init failed on get-state", err));
    Promise.all([
      chrome.storage.local.get([
        "usedMinutes",
        "locked",
        "currentQuestion",
        "currentStreak",
        "wrongQueue",
        "dailyStats",
        "lastTickAt"
      ]),
      chrome.storage.sync.get([
        "limitMinutes",
        "requiredStreak",
        "pluginEnabled",
        "selectedBookId",
        "resetOnWrong",
        "showCountdown",
        "enabledSites"
      ])
    ])
      .then(async ([local, sync]) => {
        const requiredStreak = Number.isFinite(sync.requiredStreak) && sync.requiredStreak > 0
          ? sync.requiredStreak
          : DEFAULT_REQUIRED_STREAK;
        const fixedQuestion = await ensureQuestionWhenLocked(sync.selectedBookId);
        const dailyStats = normalizeDailyStats(local.dailyStats);
        const attempts = dailyStats.attempts || 0;
        const accuracy = attempts > 0 ? Math.round((dailyStats.correct / attempts) * 100) : 0;
        const pageUrl = getMessageUrl(message, _sender);
        const siteActive = isSiteEnabled(pageUrl, sync.enabledSites);
        sendResponse({
          ok: true,
          usedMinutes: local.usedMinutes ?? 0,
          locked: Boolean(local.locked),
          question: fixedQuestion || local.currentQuestion || null,
          limitMinutes: sync.limitMinutes ?? DEFAULT_LIMIT_MINUTES,
          pluginEnabled: typeof sync.pluginEnabled === "boolean"
            ? sync.pluginEnabled
            : DEFAULT_PLUGIN_ENABLED,
          selectedBookId: sync.selectedBookId || DEFAULT_SELECTED_BOOK_ID,
          resetOnWrong: typeof sync.resetOnWrong === "boolean"
            ? sync.resetOnWrong
            : DEFAULT_RESET_ON_WRONG,
          showCountdown: typeof sync.showCountdown === "boolean"
            ? sync.showCountdown
            : DEFAULT_SHOW_COUNTDOWN,
          siteActive,
          requiredStreak,
          currentStreak: local.currentStreak ?? 0,
          wrongQueueSize: Array.isArray(local.wrongQueue) ? local.wrongQueue.length : 0,
          stats: {
            dateKey: dailyStats.dateKey,
            interceptions: dailyStats.interceptions || 0,
            attempts,
            correct: dailyStats.correct || 0,
            accuracy
          }
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message?.type === "submit-answer") {
    ensureInitialized().catch((err) => console.error("init failed on submit-answer", err));
    Promise.all([
      chrome.storage.local.get(["currentQuestion", "currentStreak", "wrongQueue"]),
      chrome.storage.sync.get(["requiredStreak", "selectedBookId", "resetOnWrong"])
    ])
      .then(async ([local, sync]) => {
        const { currentQuestion } = local;
        const requiredStreak = Number.isFinite(sync.requiredStreak) && sync.requiredStreak > 0
          ? sync.requiredStreak
          : DEFAULT_REQUIRED_STREAK;
        const resetOnWrong = typeof sync.resetOnWrong === "boolean"
          ? sync.resetOnWrong
          : DEFAULT_RESET_ON_WRONG;
        if (!currentQuestion) {
          const wrongQueue = Array.isArray(local.wrongQueue) ? [...local.wrongQueue] : [];
          const wordBank = await loadBookWords(sync.selectedBookId || DEFAULT_SELECTED_BOOK_ID);
          const nextQuestion = buildQuestion(wordBank, wrongQueue);
          await chrome.storage.local.set({
            currentQuestion: nextQuestion,
            currentStreak: 0,
            wrongQueue
          });
          sendResponse({
            ok: true,
            correct: false,
            unlocked: false,
            currentStreak: 0,
            requiredStreak,
            wrongQueueSize: wrongQueue.length,
            nextQuestion
          });
          return;
        }
        const correct = currentQuestion?.correctZh === message.answer;
        const wrongQueue = Array.isArray(local.wrongQueue) ? [...local.wrongQueue] : [];

        await updateDailyStats((stats) => {
          stats.attempts += 1;
          if (correct) stats.correct += 1;
        });

        if (correct) {
          const nextStreak = (local.currentStreak ?? 0) + 1;
          const idx = wrongQueue.indexOf(currentQuestion.word);
          if (idx >= 0) wrongQueue.splice(idx, 1);
          if (nextStreak >= requiredStreak) {
            await chrome.storage.local.set({ wrongQueue });
            await unlockBrowser();
            sendResponse({
              ok: true,
              correct: true,
              unlocked: true,
              currentStreak: nextStreak,
              requiredStreak,
              wrongQueueSize: wrongQueue.length
            });
            return;
          }
          const wordBank = await loadBookWords(sync.selectedBookId || DEFAULT_SELECTED_BOOK_ID);
          const nextQuestion = buildQuestion(wordBank, wrongQueue);
          await chrome.storage.local.set({
            currentStreak: nextStreak,
            currentQuestion: nextQuestion,
            wrongQueue
          });
          sendResponse({
            ok: true,
            correct: true,
            unlocked: false,
            currentStreak: nextStreak,
            requiredStreak,
            wrongQueueSize: wrongQueue.length,
            nextQuestion
          });
          return;
        }

        const currentWord = currentQuestion?.word;
        if (currentWord && !wrongQueue.includes(currentWord)) {
          wrongQueue.push(currentWord);
        }
        const nextStreak = resetOnWrong ? 0 : (local.currentStreak ?? 0);
        await chrome.storage.local.set({
          currentStreak: nextStreak,
          wrongQueue
        });
        sendResponse({
          ok: true,
          correct: false,
          unlocked: false,
          pausedOnWrong: true,
          currentStreak: nextStreak,
          requiredStreak,
          wrongQueueSize: wrongQueue.length,
          correctAnswer: currentQuestion.correctZh
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message?.type === "next-question-after-wrong") {
    ensureInitialized().catch((err) => console.error("init failed on next-question-after-wrong", err));
    Promise.all([
      chrome.storage.local.get(["wrongQueue", "locked"]),
      chrome.storage.sync.get("selectedBookId")
    ])
      .then(async ([local, sync]) => {
        if (!local.locked) {
          sendResponse({ ok: false, error: "not locked" });
          return;
        }
        const wrongQueue = Array.isArray(local.wrongQueue) ? local.wrongQueue : [];
        const wordBank = await loadBookWords(sync.selectedBookId || DEFAULT_SELECTED_BOOK_ID);
        const nextQuestion = buildQuestion(wordBank, wrongQueue);
        await chrome.storage.local.set({ currentQuestion: nextQuestion });
        sendResponse({ ok: true, nextQuestion });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message?.type === "get-stats") {
    ensureInitialized().catch((err) => console.error("init failed on get-stats", err));
    chrome.storage.local.get("dailyStats")
      .then(({ dailyStats }) => {
        const normalized = normalizeDailyStats(dailyStats);
        const attempts = normalized.attempts || 0;
        sendResponse({
          ok: true,
          dateKey: normalized.dateKey,
          interceptions: normalized.interceptions || 0,
          attempts,
          correct: normalized.correct || 0,
          accuracy: attempts > 0 ? Math.round((normalized.correct / attempts) * 100) : 0
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message?.type === "get-countdown") {
    ensureInitialized()
      .then(() => Promise.all([
        chrome.storage.local.get(["usedMinutes", "locked", "lastTickAt"]),
        chrome.storage.sync.get(["limitMinutes", "pluginEnabled", "showCountdown", "enabledSites"])
      ]))
      .then(([local, sync]) => {
        const limitMinutes = Number.isFinite(sync.limitMinutes) && sync.limitMinutes > 0
          ? sync.limitMinutes
          : DEFAULT_LIMIT_MINUTES;
        const usedMinutes = Number.isFinite(local.usedMinutes) ? local.usedMinutes : 0;
        const lastTickAt = Number.isFinite(local.lastTickAt) ? local.lastTickAt : Date.now();
        const elapsedSec = Math.max(0, Math.floor((Date.now() - lastTickAt) / 1000));
        const remainingSec = Math.max(0, limitMinutes * 60 - usedMinutes * 60 - elapsedSec);
        const pageUrl = getMessageUrl(message, _sender);
        const siteActive = isSiteEnabled(pageUrl, sync.enabledSites);
        sendResponse({
          ok: true,
          pluginEnabled: typeof sync.pluginEnabled === "boolean"
            ? sync.pluginEnabled
            : DEFAULT_PLUGIN_ENABLED,
          showCountdown: typeof sync.showCountdown === "boolean"
            ? sync.showCountdown
            : DEFAULT_SHOW_COUNTDOWN,
          siteActive,
          locked: Boolean(local.locked),
          usedMinutes,
          limitMinutes,
          remainingSec
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message?.type === "update-settings") {
    ensureInitialized()
      .then(async () => {
        const current = await chrome.storage.sync.get([
          "limitMinutes",
          "requiredStreak",
          "pluginEnabled",
          "selectedBookId",
          "resetOnWrong",
          "showCountdown",
          "enabledSites"
        ]);
        const limitMinutes = Number(message.limitMinutes);
        const requiredStreak = Number(message.requiredStreak);
        const pluginEnabled = message.pluginEnabled;
        const selectedBookId = message.selectedBookId;
        const resetOnWrong = message.resetOnWrong;
        const showCountdown = message.showCountdown;
        const enabledSites = message.enabledSites;
        if (!Number.isFinite(limitMinutes) || limitMinutes < 1) {
          sendResponse({ ok: false, error: "limitMinutes must be >= 1" });
          return;
        }
        if (!Number.isFinite(requiredStreak) || requiredStreak < 1) {
          sendResponse({ ok: false, error: "requiredStreak must be >= 1" });
          return;
        }
        if (pluginEnabled !== undefined && typeof pluginEnabled !== "boolean") {
          sendResponse({ ok: false, error: "pluginEnabled must be boolean" });
          return;
        }
        if (
          selectedBookId !== undefined &&
          !BOOK_CATALOG.some((book) => book.id === selectedBookId)
        ) {
          sendResponse({ ok: false, error: "selectedBookId invalid" });
          return;
        }
        if (resetOnWrong !== undefined && typeof resetOnWrong !== "boolean") {
          sendResponse({ ok: false, error: "resetOnWrong must be boolean" });
          return;
        }
        if (showCountdown !== undefined && typeof showCountdown !== "boolean") {
          sendResponse({ ok: false, error: "showCountdown must be boolean" });
          return;
        }
        if (enabledSites !== undefined && !Array.isArray(enabledSites)) {
          sendResponse({ ok: false, error: "enabledSites must be array" });
          return;
        }
        const normalizedLimit = Math.floor(limitMinutes);
        const normalizedStreak = Math.floor(requiredStreak);
        const normalizedEnabled = typeof pluginEnabled === "boolean"
          ? pluginEnabled
          : (typeof current.pluginEnabled === "boolean"
            ? current.pluginEnabled
            : DEFAULT_PLUGIN_ENABLED);
        const normalizedBookId = typeof selectedBookId === "string"
          ? selectedBookId
          : (current.selectedBookId || DEFAULT_SELECTED_BOOK_ID);
        const normalizedResetOnWrong = typeof resetOnWrong === "boolean"
          ? resetOnWrong
          : (typeof current.resetOnWrong === "boolean"
            ? current.resetOnWrong
            : DEFAULT_RESET_ON_WRONG);
        const normalizedShowCountdown = typeof showCountdown === "boolean"
          ? showCountdown
          : (typeof current.showCountdown === "boolean"
            ? current.showCountdown
            : DEFAULT_SHOW_COUNTDOWN);
        const normalizedEnabledSites = enabledSites !== undefined
          ? normalizeEnabledSites(enabledSites)
          : normalizeEnabledSites(current.enabledSites);
        await chrome.storage.sync.set({
          limitMinutes: normalizedLimit,
          requiredStreak: normalizedStreak,
          pluginEnabled: normalizedEnabled,
          selectedBookId: normalizedBookId,
          resetOnWrong: normalizedResetOnWrong,
          showCountdown: normalizedShowCountdown,
          enabledSites: normalizedEnabledSites
        });
        await chrome.storage.local.set({
          wrongQueue: [],
          currentQuestion: null,
          currentStreak: 0
        });
        if (!normalizedEnabled) {
          await unlockBrowser();
        } else {
          const { usedMinutes, locked } = await chrome.storage.local.get(["usedMinutes", "locked"]);
          if (locked) {
            await ensureQuestionWhenLocked(normalizedBookId);
          } else if ((usedMinutes ?? 0) >= normalizedLimit) {
            await lockBrowser();
          }
        }

        sendResponse({
          ok: true,
          limitMinutes: normalizedLimit,
          requiredStreak: normalizedStreak,
          pluginEnabled: normalizedEnabled,
          selectedBookId: normalizedBookId,
          resetOnWrong: normalizedResetOnWrong,
          showCountdown: normalizedShowCountdown,
          enabledSites: normalizedEnabledSites
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message?.type === "list-books") {
    const books = BOOK_CATALOG.map((book) => ({
      id: book.id,
      name: book.name
    }));
    sendResponse({ ok: true, books });
    return true;
  }

  if (message?.type === "reset-usage") {
    ensureInitialized()
      .then(async () => {
        await chrome.storage.local.set({
          usedMinutes: 0,
          lastTickAt: Date.now()
        });
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  if (!Object.prototype.hasOwnProperty.call(changes, "pluginEnabled")) return;
  const next = changes.pluginEnabled?.newValue;
  if (next === false) {
    unlockBrowser().catch((err) => console.error("unlock failed on disable", err));
  }
});

ensureInitialized().catch((err) => console.error("init failed at load", err));
