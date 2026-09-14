/* CELPIPG Exam Simulator, Application Logic
   Four practice modes reachable from one main menu: Listening Test, Reading
   Test, Writing Practice, Speaking Rehearsal. This file drives the shared
   MCQ engine used by BOTH Listening and Reading (the two modes share almost
   everything: timer, flagging, question map, submit-blocking validation,
   review screen), plus the access gate and the main menu wiring. Writing
   Practice lives in writing.js and Speaking Rehearsal lives in speaking.js,
   both loaded after this file. */

const ACCESS_CODE  = "CELPIPG9000";
const STORAGE_KEY  = "celpipg_exam_state_v1";
const SIM_Q_COUNT  = 38;   // matches one real CELPIP-General Listening or Reading sitting
const LISTENING_SECONDS = 3300; // 55 min, the real CELPIP-General Listening time limit
const READING_SECONDS   = 3240; // 54 min, the real CELPIP-General Reading time limit

// Real blueprint order, used to sequence each practice test the same way the
// real computer-delivered test presents its parts. Reading clusters (a
// passage or an exhibit) always share one domain, so sorting by domain then
// by id keeps every cluster's questions contiguous and in authored order
// without needing a separate grouping pass.
const LISTENING_DOMAIN_ORDER = [
  "listening_part_1_problem_solving",
  "listening_part_2_daily_life_conversation",
  "listening_part_3_information",
  "listening_part_4_news_item",
  "listening_part_5_discussion",
  "listening_part_6_viewpoints",
];
const READING_DOMAIN_ORDER = [
  "reading_part_1_correspondence",
  "reading_part_2_diagram_application",
  "reading_part_3_information",
  "reading_part_4_viewpoints",
];

const DOMAIN_LABELS = {
  "listening_part_1_problem_solving": "Listening Part 1 - Problem Solving",
  "listening_part_2_daily_life_conversation": "Listening Part 2 - Daily Life Conversation",
  "listening_part_3_information": "Listening Part 3 - Information",
  "listening_part_4_news_item": "Listening Part 4 - News Item",
  "listening_part_5_discussion": "Listening Part 5 - Discussion",
  "listening_part_6_viewpoints": "Listening Part 6 - Viewpoints",
  "reading_part_1_correspondence": "Reading Part 1 - Correspondence",
  "reading_part_2_diagram_application": "Reading Part 2 - Diagram Application",
  "reading_part_3_information": "Reading Part 3 - Information",
  "reading_part_4_viewpoints": "Reading Part 4 - Viewpoints",
};
function domainLabel(key) { return DOMAIN_LABELS[key] || key || ""; }

// CELPIP does not use a fixed pass/fail percentage. Your real score is
// converted to a CLB (Canadian Language Benchmark, 1-12) level by CELPIP's
// own proprietary scoring model. Many Express Entry programs require CLB 7
// or higher, and Canadian citizenship (ages 18-54) requires CLB 4 or higher
// in every skill. These bands are an unofficial estimate built from publicly
// published CELPIP score-conversion patterns, not a real CELPIP score, and
// are deliberately conservative since CELPIP never publishes a real raw-
// score-to-CLB table. The same 38-question scale is used for both Listening
// and Reading sittings, since both are scored out of 38 in this simulator.
const CLB_BANDS = [
  { min: 0,  max: 22, clb: "Below CLB 4" },
  { min: 23, max: 25, clb: "CLB 4" },
  { min: 26, max: 28, clb: "CLB 5" },
  { min: 29, max: 30, clb: "CLB 6" },
  { min: 31, max: 32, clb: "CLB 7" },
  { min: 33, max: 34, clb: "CLB 8" },
  { min: 35, max: 36, clb: "CLB 9" },
  { min: 37, max: 38, clb: "CLB 10+" },
];
function estimateCLB(correct, total) {
  const scaled = Math.round(correct / total * 38);
  const band = CLB_BANDS.find(b => scaled >= b.min && scaled <= b.max) || CLB_BANDS[0];
  return band.clb;
}

let currentMode = null;   // "listening" | "reading"
let questions = [];
let state = null;
let timerInterval = null;
let examListenersBound = false;

// ── boot ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("access-gate").style.display = "flex";
  document.getElementById("app").style.display = "none";
  setupAccessGate();
  wireModeSelect();
});

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── access gate ───────────────────────────────────────────────────────────────
function setupAccessGate() {
  const attempt = () => {
    const val = document.getElementById("access-code-input").value.trim().toUpperCase();
    if (val === ACCESS_CODE) {
      document.getElementById("access-gate").style.display = "none";
      document.getElementById("mode-select").style.display = "flex";
    } else {
      const err = document.getElementById("access-error");
      err.textContent = "Incorrect access code. Please try again.";
      document.getElementById("access-code-input").value = "";
      document.getElementById("access-code-input").focus();
    }
  };
  document.getElementById("access-btn").addEventListener("click", attempt);
  document.getElementById("access-code-input").addEventListener("keydown",
    e => { if (e.key === "Enter") attempt(); });
}

// ── main menu ─────────────────────────────────────────────────────────────────
function wireModeSelect() {
  document.getElementById("mode-listening").addEventListener("click", () => {
    document.getElementById("mode-select").style.display = "none";
    openTestPicker("listening");
  });
  document.getElementById("mode-reading").addEventListener("click", () => {
    document.getElementById("mode-select").style.display = "none";
    openTestPicker("reading");
  });
  document.getElementById("mode-writing").addEventListener("click", () => {
    document.getElementById("mode-select").style.display = "none";
    if (typeof initWritingMenu === "function") initWritingMenu();
  });
  document.getElementById("mode-speaking").addEventListener("click", () => {
    document.getElementById("mode-select").style.display = "none";
    if (typeof initSpeakingMenu === "function") initSpeakingMenu();
  });
  document.getElementById("test-picker-back").addEventListener("click", () => {
    document.getElementById("test-picker").style.display = "none";
    document.getElementById("mode-select").style.display = "flex";
  });
}

function backToModeSelect() {
  document.getElementById("test-picker").style.display = "none";
  document.getElementById("mode-select").style.display = "flex";
}

// ── test picker (shared by Listening and Reading) ───────────────────────────
function openTestPicker(mode) {
  document.getElementById("test-picker").style.display = "flex";
  const title = mode === "listening" ? "Choose a Listening Practice Test" : "Choose a Reading Practice Test";
  document.getElementById("test-picker-title").textContent = title;
  document.getElementById("test-picker-desc").textContent = mode === "listening"
    ? "Each test is a real 38-question, six-part Listening sitting, about 55 minutes long, with audio that plays once automatically."
    : "Each test is a real 38-question, four-part Reading sitting, about 54 minutes long, self-paced.";

  const wrap = document.getElementById("test-picker-cards");
  wrap.innerHTML = "";
  for (let n = 1; n <= 3; n++) {
    const btn = document.createElement("button");
    btn.className = "mode-card";
    btn.innerHTML =
      `<div class="mode-card-title">Practice Test ${n}</div>` +
      `<div class="mode-card-desc">38 real-length questions in the real blueprint order, part by part.</div>`;
    btn.addEventListener("click", () => startMCQExam(mode, n));
    wrap.appendChild(btn);
  }
}

// ── question selection ───────────────────────────────────────────────────────
function pickTestQuestions(mode, testNo) {
  const order = mode === "listening" ? LISTENING_DOMAIN_ORDER : READING_DOMAIN_ORDER;
  const filtered = (window.EXAM_QUESTIONS || []).filter(q =>
    q.domain && q.domain.startsWith(mode + "_") && q.test_no === testNo);
  filtered.sort((a, b) => {
    const da = order.indexOf(a.domain), db = order.indexOf(b.domain);
    if (da !== db) return da - db;
    return a.id - b.id;
  });
  return filtered;
}

function examSecondsFor(mode) {
  return mode === "listening" ? LISTENING_SECONDS : READING_SECONDS;
}
function storageKeyFor(mode) {
  return `${STORAGE_KEY}_${mode}`;
}
function freshMCQState(mode, testNo) {
  return {
    mode, testNo, answers: {}, flags: {}, current: 1,
    timeLeft: examSecondsFor(mode), submitted: false, startTime: null,
  };
}
function loadMCQState(mode) {
  try {
    const saved = localStorage.getItem(storageKeyFor(mode));
    return saved ? JSON.parse(saved) : null;
  } catch (e) { return null; }
}

// ── exam start ────────────────────────────────────────────────────────────────
function startMCQExam(mode, testNo) {
  currentMode = mode;
  questions = pickTestQuestions(mode, testNo);

  const saved = loadMCQState(mode);
  if (saved && saved.testNo === testNo && !saved.submitted) {
    state = saved;
  } else {
    state = freshMCQState(mode, testNo);
  }

  document.getElementById("test-picker").style.display = "none";
  document.getElementById("results-screen").style.display = "none";
  document.getElementById("app").style.display = "flex";

  document.getElementById("mcq-mode-title").textContent =
    mode === "listening" ? `Listening Test ${testNo}` : `Reading Test ${testNo}`;

  if (!state.startTime) state.startTime = Date.now();
  renderQuestion();
  startTimer();
  buildGrid();
  bindExamListeners();
}

function bindExamListeners() {
  if (examListenersBound) return;
  examListenersBound = true;
  document.getElementById("submit-btn").addEventListener("click", confirmSubmit);
  document.getElementById("flag-btn").addEventListener("click",   toggleFlag);
  document.getElementById("prev-btn").addEventListener("click",   () => navigate(-1));
  document.getElementById("next-btn").addEventListener("click",   () => navigate(1));
  document.getElementById("map-btn").addEventListener("click",    openMapModal);
  document.getElementById("map-close").addEventListener("click",  closeMapModal);
  document.getElementById("map-backdrop").addEventListener("click", closeMapModal);
  document.addEventListener("keydown", keyHandler);
  document.getElementById("mcq-back").addEventListener("click", () => {
    // The submit flow always confirms before anything destructive happens
    // (blocking dialog on an incomplete submit, confirm dialog on a real
    // submit); leaving mid-test through Back was the one exit with no such
    // guard, silently dropping an in-progress, unsubmitted attempt.
    const midTest = document.getElementById("app").style.display !== "none" && state && !state.submitted;
    if (midTest && !confirm("Leave this practice test? Your progress on this attempt will be lost.")) {
      return;
    }
    clearInterval(timerInterval);
    if (currentMode === "listening") stopAudio();
    document.getElementById("app").style.display = "none";
    document.getElementById("results-screen").style.display = "none";
    document.getElementById("mode-select").style.display = "flex";
  });
}

// ── timer ─────────────────────────────────────────────────────────────────────
function startTimer() {
  clearInterval(timerInterval);
  updateTimerDisplay();
  const totalSeconds = examSecondsFor(currentMode);
  timerInterval = setInterval(() => {
    if (state.submitted) return;
    state.timeLeft = Math.max(0, totalSeconds - Math.floor((Date.now() - state.startTime) / 1000));
    updateTimerDisplay();
    if (state.timeLeft === 0) submitExam();
    saveState();
  }, 1000);
}

function updateTimerDisplay() {
  const h = Math.floor(state.timeLeft / 3600);
  const m = Math.floor((state.timeLeft % 3600) / 60);
  const s = state.timeLeft % 60;
  document.getElementById("timer-display").textContent =
    h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
           : `${m}:${String(s).padStart(2,"0")}`;
}

// ── Reading cluster / scenario rendering ─────────────────────────────────────
// A Reading cluster is either a passage (a letter or a pair of emails) or an
// exhibit (a schedule, notice or table). The shared text/table is the same
// across every question in the cluster, so it is safe to read it off the
// CURRENT question every time. Per-question "scenario" text (who needs what,
// for an exhibit question) changes on every question even within one cluster,
// so it is rendered separately, right above the stem, never by exhibit_data
// alone.
function renderReadingCluster(q) {
  const wrap = document.getElementById("q-cluster-wrap");
  if (!wrap) return;
  if (q.passage) {
    const body = String(q.passage).split(/\n{2,}/).map(block =>
      `<p>${escapeHTML(block.trim()).replace(/\n/g, "<br>")}</p>`).join("");
    wrap.innerHTML = `<div class="cluster-label">Read the following</div>` +
      `<div class="cluster-body">${body}</div>`;
    wrap.style.display = "block";
  } else if (q.exhibit_data) {
    const rows = q.exhibit_data.map(r =>
      `<div class="exhibit-row"><span class="exhibit-row-label">${escapeHTML(r.label)}</span>` +
      `<span class="exhibit-row-value">${escapeHTML(r.value)}</span></div>`).join("");
    wrap.innerHTML = `<div class="cluster-label">Refer to the following</div>` +
      (q.exhibit_title ? `<div class="exhibit-title">${escapeHTML(q.exhibit_title)}</div>` : "") +
      `<div class="exhibit-table">${rows}</div>`;
    wrap.style.display = "block";
  } else {
    wrap.innerHTML = "";
    wrap.style.display = "none";
  }
}

function renderScenario(q) {
  const wrap = document.getElementById("q-scenario-wrap");
  if (!wrap) return;
  if (q.scenario) {
    wrap.innerHTML = `<div class="scenario-label">Situation</div>` +
      `<p class="scenario-text">${escapeHTML(q.scenario)}</p>`;
    wrap.style.display = "block";
  } else {
    wrap.innerHTML = "";
    wrap.style.display = "none";
  }
}

// ── Listening audio ───────────────────────────────────────────────────────────
// Plays a REAL, pre-baked recording of each question's transcript (Piper TTS,
// voice en_US-lessac-high, rendered once offline with generate_listening_audio.py
// and hosted as a static file). No pause, no replay, matching the real test's
// "audio plays once, automatically" rule.
//
// This replaced an earlier version that synthesized speech live in each
// visitor's own browser via speechSynthesis. That approach depended entirely
// on whatever voice happened to be installed on that visitor's own device --
// direct measurement found it could pick anything from a macOS novelty/comedy
// voice ("Albert") to a mismatched British accent ("Daniel"), with pacing
// gaps up to 1000ms+ even on a legitimate, non-joke voice. A pre-baked static
// file means every single customer hears the IDENTICAL, good-quality
// recording, regardless of their own device -- see
// feedback_piper_tts_voice_choice.md for the full comparison and reasoning.
//
// If a question somehow has no audio file (a build gap, or a browser that
// can't play the format), fall back to showing the transcript as text
// immediately rather than leaving the learner with a dead button.
let currentAudio = null;
function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.oncanplaythrough = currentAudio.onended = currentAudio.onerror = null;
    currentAudio = null;
  }
}

function setupAudioForQuestion(q) {
  const btn    = document.getElementById("play-audio-btn");
  const status = document.getElementById("audio-status");
  btn.disabled = false;
  btn.textContent = "▶ Play Audio";
  if (!q.audio) {
    status.textContent = "Audio unavailable for this question, showing script below";
    document.getElementById("q-transcript-wrap").innerHTML =
      `<div class="transcript-label">Listening Script</div><p>${escapeHTML(q.transcript || "")}</p>`;
    document.getElementById("q-transcript-wrap").style.display = q.transcript ? "block" : "none";
    btn.disabled = true;
    return;
  }
  status.textContent = "Not played yet";
  btn.onclick = () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "▶ Playing…";
    status.textContent = "Playing, listen carefully, it only plays once";
    stopAudio();
    currentAudio = new Audio(q.audio);
    currentAudio.onended = () => {
      btn.textContent = "✓ Played";
      status.textContent = "Audio already played once, just like the real test";
    };
    currentAudio.onerror = () => {
      btn.textContent = "✓ Played";
      status.textContent = "Audio playback failed, transcript is available in review after you submit";
    };
    currentAudio.play().catch(() => {
      // Autoplay-policy rejection or similar -- don't leave the learner
      // stuck on a button that says "Playing..." forever with nothing
      // audibly happening and no way to retry.
      btn.disabled = false;
      btn.textContent = "▶ Play Audio";
      status.textContent = "Playback couldn't start, tap Play Audio again";
    });
  };
}

// ── render ─────────────────────────────────────────────────────────────────────
function renderQuestion() {
  const q = questions[state.current - 1];
  if (!q) return;

  document.getElementById("q-cluster-wrap").style.display = "none";
  document.getElementById("q-scenario-wrap").style.display = "none";
  document.getElementById("q-audio-wrap").style.display = "none";
  document.getElementById("q-transcript-wrap").style.display = "none";

  if (currentMode === "listening") {
    stopAudio(); // never let a previous question's audio keep playing into a new one
    if (q.transcript) {
      document.getElementById("q-audio-wrap").style.display = "flex";
      setupAudioForQuestion(q);
    }
  } else if (currentMode === "reading") {
    renderReadingCluster(q);
    renderScenario(q);
  }

  document.getElementById("q-counter").textContent = `Question ${state.current} of ${questions.length}`;
  document.getElementById("q-domain").textContent  = domainLabel(q.domain);
  document.getElementById("question-text").textContent = q.question;

  const imgWrap = document.getElementById("q-image-wrap");
  if (q.image) {
    imgWrap.innerHTML = `<img src="${q.image}" alt="" class="q-image">`;
    imgWrap.style.display = "block";
  } else {
    imgWrap.innerHTML = "";
    imgWrap.style.display = "none";
  }

  const fi = document.getElementById("q-flag-indicator");
  fi.style.display = state.flags[state.current] ? "inline-block" : "none";

  document.getElementById("explanation-box").style.display = "none";

  const ol = document.getElementById("options-list");
  ol.innerHTML = "";
  const chosen = state.answers[state.current];
  ["A", "B", "C", "D", "E"].forEach(letter => {
    const text = q.options?.[letter];
    if (!text) return;
    const div = document.createElement("div");
    div.className = "option" + (chosen === letter ? " selected" : "");
    div.innerHTML = `<span class="opt-letter">${letter}</span><span class="opt-text">${text}</span>`;
    div.addEventListener("click", () => selectAnswer(state.current, letter));
    ol.appendChild(div);
  });

  const panel = document.querySelector(".question-panel");
  if (panel) panel.scrollTop = 0;

  updateProgress();
  updateGrid();
}

function selectAnswer(qNum, letter) {
  if (state.submitted) return;
  state.answers[qNum] = letter;
  renderQuestion();
  saveState();
}

function navigate(dir) {
  const next = state.current + dir;
  if (next >= 1 && next <= questions.length) {
    state.current = next;
    if (state.submitted) renderReview(); else renderQuestion();
  }
}

function toggleFlag() {
  state.flags[state.current] = !state.flags[state.current];
  renderQuestion();
  saveState();
}

function updateProgress() {
  const pct = Object.keys(state.answers).length / questions.length * 100;
  document.getElementById("progress-bar").style.width = pct + "%";
}

// ── question map modal ────────────────────────────────────────────────────────
function openMapModal() {
  updateGrid();
  document.getElementById("map-modal").style.display = "flex";
}
function closeMapModal() {
  document.getElementById("map-modal").style.display = "none";
}

// ── grid ──────────────────────────────────────────────────────────────────────
function buildGrid() {
  const grid = document.getElementById("q-grid");
  grid.innerHTML = "";
  for (let i = 1; i <= questions.length; i++) {
    const btn = document.createElement("button");
    btn.className = "grid-btn";
    btn.id = `gb-${i}`;
    btn.textContent = i;
    btn.addEventListener("click", () => {
      state.current = i;
      closeMapModal();
      if (state.submitted) renderReview(); else renderQuestion();
    });
    grid.appendChild(btn);
  }
}

function updateGrid() {
  for (let i = 1; i <= questions.length; i++) {
    const btn = document.getElementById(`gb-${i}`);
    if (!btn) continue;
    btn.className = "grid-btn" +
      (state.answers[i]  ? " answered" : "") +
      (state.flags[i]    ? " flagged"  : "") +
      (state.current===i ? " active"   : "");
  }
}

// ── submit ────────────────────────────────────────────────────────────────────
function confirmSubmit() {
  const unanswered = questions.length - Object.keys(state.answers).length;
  if (unanswered > 0) {
    alert(`You must answer all ${questions.length} questions before submitting.\n\n${unanswered} question${unanswered > 1 ? "s" : ""} still unanswered.\n\nTap "Question Map" to find unanswered questions.`);
    return;
  }
  if (confirm("Submit your exam now?")) submitExam();
}

function submitExam() {
  clearInterval(timerInterval);
  if (currentMode === "listening") stopAudio();
  state.submitted = true;
  saveState();
  showResults();
}

// ── results ───────────────────────────────────────────────────────────────────
function showResults() {
  document.getElementById("app").style.display = "none";
  document.getElementById("results-screen").style.display = "flex";

  let correct = 0;
  const domainStats = {};
  questions.forEach((q, idx) => {
    const num = idx + 1;
    const userAns = state.answers[num];
    const isRight = userAns === q.correct;
    if (isRight) correct++;
    const dom = q.domain || "Other";
    if (!domainStats[dom]) domainStats[dom] = { correct: 0, total: 0 };
    domainStats[dom].total++;
    if (isRight) domainStats[dom].correct++;
  });

  const clb = estimateCLB(correct, questions.length);
  const skillLabel = currentMode === "listening" ? "Listening" : "Reading";
  document.getElementById("res-status").textContent = `Estimated ${clb}`;
  // Deliberately NOT colored green/red by any single threshold (e.g.
  // citizenship's CLB 4): CELPIP has no universal pass/fail, only different
  // real-world targets for different candidates (CLB 4 for citizenship,
  // CLB 7+ for most Express Entry programs), so a binary color here would
  // visually contradict the disclaimer right below it for anyone whose own
  // target differs from whichever threshold the color was keyed to.
  document.getElementById("res-status").style.color = "#1B3A6B";
  document.getElementById("res-score").textContent  = `${correct} / ${questions.length} correct (${skillLabel})`;

  const noteId = "res-clb-note";
  let note = document.getElementById(noteId);
  if (!note) {
    note = document.createElement("p");
    note.id = noteId;
    note.className = "res-clb-note";
    document.getElementById("res-score").insertAdjacentElement("afterend", note);
  }
  note.textContent = "CELPIP-General does not use a fixed pass or fail percentage. Your real score converts to a CLB "
    + "(Canadian Language Benchmark, 1-12) level under CELPIP's own proprietary scoring model. Many Express Entry "
    + "programs require CLB 7 or higher, and Canadian citizenship (ages 18-54) requires CLB 4 or higher in every "
    + "skill. This is an unofficial estimate, not a real CELPIP score. Only CELPIP's own scoring determines your "
    + "real result.";

  const domDiv = document.getElementById("res-domains");
  domDiv.innerHTML = "";
  Object.entries(domainStats).forEach(([dom, s]) => {
    const dp = Math.round(s.correct / s.total * 100);
    domDiv.innerHTML += `<div class="res-domain-row">
      <span class="res-domain-name">${domainLabel(dom)}</span>
      <div class="res-domain-bar-wrap"><div class="res-domain-bar" style="width:${dp}%;background:#1B3A6B"></div></div>
      <span class="res-domain-pct">${dp}%</span>
    </div>`;
  });

  document.getElementById("res-review-btn").onclick = () => {
    state.submitted = true;
    document.getElementById("results-screen").style.display = "none";
    document.getElementById("app").style.display = "flex";
    renderReview();
  };
  document.getElementById("res-restart-btn").onclick = () => {
    localStorage.removeItem(storageKeyFor(currentMode));
    location.reload();
  };
}

function renderReview() {
  const q = questions[state.current - 1];
  if (!q) return;

  document.getElementById("q-audio-wrap").style.display = "none";
  document.getElementById("q-transcript-wrap").style.display = "none";
  document.getElementById("q-cluster-wrap").style.display = "none";
  document.getElementById("q-scenario-wrap").style.display = "none";

  document.getElementById("q-counter").textContent = `Review, Question ${state.current} of ${questions.length}`;
  document.getElementById("q-domain").textContent  = domainLabel(q.domain);
  document.getElementById("question-text").textContent = q.question;

  if (currentMode === "listening") {
    const transWrap = document.getElementById("q-transcript-wrap");
    if (q.transcript) {
      transWrap.innerHTML = `<div class="transcript-label">Listening Script (for review)</div><p>${escapeHTML(q.transcript)}</p>`;
      transWrap.style.display = "block";
    }
  } else if (currentMode === "reading") {
    renderReadingCluster(q);
    renderScenario(q);
  }

  const revImgWrap = document.getElementById("q-image-wrap");
  if (q.image) {
    revImgWrap.innerHTML = `<img src="${q.image}" alt="" class="q-image">`;
    revImgWrap.style.display = "block";
  } else {
    revImgWrap.innerHTML = "";
    revImgWrap.style.display = "none";
  }

  const ol = document.getElementById("options-list");
  ol.innerHTML = "";
  const userAns = state.answers[state.current];
  ["A", "B", "C", "D", "E"].forEach(letter => {
    const text = q.options?.[letter];
    if (!text) return;
    const div = document.createElement("div");
    let cls = "option";
    if (letter === q.correct)      cls += " correct";
    else if (letter === userAns)   cls += " incorrect";
    div.className = cls;
    div.innerHTML = `<span class="opt-letter">${letter}</span><span class="opt-text">${text}</span>`;
    ol.appendChild(div);
  });

  const box  = document.getElementById("explanation-box");
  const expl = document.getElementById("explanation-text");
  if (q.explanation) {
    expl.textContent = q.explanation;
    box.style.display = "block";
  } else {
    box.style.display = "none";
  }

  const fi = document.getElementById("q-flag-indicator");
  fi.style.display = state.flags[state.current] ? "inline-block" : "none";
  updateGrid();
}

// ── persistence ───────────────────────────────────────────────────────────────
function saveState() {
  try { localStorage.setItem(storageKeyFor(currentMode), JSON.stringify(state)); } catch(e) {}
}

// ── keyboard ──────────────────────────────────────────────────────────────────
function keyHandler(e) {
  if (document.getElementById("app").style.display === "none") return;
  const letter = e.key.toUpperCase();
  const q = questions[state.current - 1];
  if (!state.submitted && ["A", "B", "C", "D", "E"].includes(letter) && !e.ctrlKey && !e.metaKey && q?.options?.[letter]) {
    selectAnswer(state.current, letter);
  }
  if (e.key === "ArrowRight" && state.current < questions.length) navigate(1);
  if (e.key === "ArrowLeft"  && state.current > 1)                navigate(-1);
  if (e.key === "Escape") closeMapModal();
}
