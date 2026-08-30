/* CELPIP-General Writing Practice, application logic.
   A real countdown timer (time_minutes from the task, matching the real
   27-minute Task 1 / 26-minute Task 2 limits) paired with a plain textarea
   and a live word counter. There is no way for a website to grade written
   English, so after the timer ends (or the candidate taps Finish) this
   reveals a model answer plus tips to compare against instead of a score. */

let wrTasks = [];
let wrCurrent = null;
let wrTimerInterval = null;
let wrRemaining = 0;
let wrRunning = false;
let wrLeaveGuardBound = false;

function wordCount(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function initWritingMenu() {
  wrTasks = window.WRITING_TASKS || [];
  document.getElementById("writing-menu").style.display = "flex";
  document.getElementById("writing-play").style.display = "none";

  const byKey = {};
  wrTasks.forEach(t => { (byKey[t.task_key] = byKey[t.task_key] || []).push(t); });

  const list = document.getElementById("writing-task-list");
  list.innerHTML = "";
  wrTasks.forEach(t => {
    const groupIndex = byKey[t.task_key].indexOf(t) + 1;
    const groupTotal = byKey[t.task_key].length;
    const btn = document.createElement("button");
    btn.className = "station-card";
    btn.innerHTML =
      `<span class="station-card-section">${escapeHTML(t.task_title)}</span>` +
      `<span class="station-card-title">Prompt ${groupIndex} of ${groupTotal}</span>` +
      `<span class="station-card-meta">${t.time_minutes} minutes, ${t.min_words}-${t.max_words} words</span>`;
    btn.addEventListener("click", () => startWritingTask(t));
    list.appendChild(btn);
  });

  document.getElementById("writing-menu-back").onclick = () => {
    document.getElementById("writing-menu").style.display = "none";
    document.getElementById("mode-select").style.display = "flex";
  };
}

function bindLeaveGuardOnce() {
  if (wrLeaveGuardBound) return;
  wrLeaveGuardBound = true;
  window.addEventListener("beforeunload", (e) => {
    if (wrRunning) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

function startWritingTask(t) {
  bindLeaveGuardOnce();
  wrCurrent = t;
  wrRunning = false;
  stopWrTimer();
  wrRemaining = t.time_minutes * 60;

  document.getElementById("writing-menu").style.display = "none";
  document.getElementById("writing-play").style.display = "flex";
  document.getElementById("writing-title-bar").textContent = t.task_title;
  document.getElementById("writing-instructions").textContent =
    `You have ${t.time_minutes} minutes. Write between ${t.min_words} and ${t.max_words} words. `
    + "Tap Start Timer when you are ready to begin the real countdown clock, just like the real test.";
  document.getElementById("writing-prompt-box").innerHTML =
    String(t.prompt_text || "").split(/\n+/).filter(Boolean)
      .map(line => `<p>${escapeHTML(line)}</p>`).join("");

  const textarea = document.getElementById("writing-textarea");
  textarea.value = "";
  textarea.disabled = true;
  textarea.oninput = () => updateWordCounter(t);
  updateWordCounter(t);
  updateWrTimerDisplay();

  document.getElementById("writing-compare-wrap").style.display = "none";
  const startBtn = document.getElementById("writing-start-btn");
  const finishBtn = document.getElementById("writing-finish-btn");
  startBtn.style.display = "block";
  startBtn.disabled = false;
  startBtn.textContent = "Start Timer";
  finishBtn.style.display = "none";

  startBtn.onclick = () => beginWrTimer(t);
  finishBtn.onclick = () => finishWriting(t);

  document.getElementById("writing-back").onclick = () => {
    if (wrRunning && !confirm("Leave this writing task? Your timer will stop and your response will not be saved.")) {
      return;
    }
    stopWrTimer();
    wrRunning = false;
    document.getElementById("writing-play").style.display = "none";
    initWritingMenu();
  };
}

function updateWordCounter(t) {
  const text = document.getElementById("writing-textarea").value;
  const count = wordCount(text);
  const countEl = document.getElementById("writing-word-count");
  countEl.textContent = `${count} word${count === 1 ? "" : "s"}`;
  countEl.classList.remove("wc-ok", "wc-warn");
  countEl.classList.add(count >= t.min_words && count <= t.max_words ? "wc-ok" : "wc-warn");
  document.getElementById("writing-word-target").textContent = `Target: ${t.min_words}-${t.max_words} words`;
}

function beginWrTimer(t) {
  const startBtn = document.getElementById("writing-start-btn");
  startBtn.disabled = true;
  startBtn.style.display = "none";
  document.getElementById("writing-finish-btn").style.display = "block";
  document.getElementById("writing-textarea").disabled = false;
  document.getElementById("writing-textarea").focus();
  wrRunning = true;
  wrRemaining = t.time_minutes * 60;
  updateWrTimerDisplay();
  wrTimerInterval = setInterval(() => wrTick(t), 1000);
}

function wrTick(t) {
  wrRemaining--;
  if (wrRemaining <= 0) {
    wrRemaining = 0;
    updateWrTimerDisplay();
    finishWriting(t);
    return;
  }
  updateWrTimerDisplay();
}

function updateWrTimerDisplay() {
  const m = Math.floor(wrRemaining / 60);
  const s = wrRemaining % 60;
  document.getElementById("writing-timer-display").textContent = `${m}:${String(s).padStart(2, "0")}`;
}

function stopWrTimer() {
  if (wrTimerInterval) { clearInterval(wrTimerInterval); wrTimerInterval = null; }
}

function finishWriting(t) {
  stopWrTimer();
  wrRunning = false;
  const textarea = document.getElementById("writing-textarea");
  textarea.disabled = true;
  document.getElementById("writing-finish-btn").style.display = "none";
  // The pre-start instructions ("Tap Start Timer when you are ready...")
  // otherwise stay on screen after the task is already finished and the
  // model answer is showing -- stale advice for a screen state it no
  // longer applies to.
  document.getElementById("writing-instructions").textContent =
    "Compare what you wrote to the model answer and tips below.";

  const compareWrap = document.getElementById("writing-compare-wrap");
  compareWrap.style.display = "block";
  document.getElementById("writing-your-response").textContent = textarea.value || "(You did not write a response.)";
  document.getElementById("writing-model-answer").textContent = t.model_answer || "";
  document.getElementById("writing-tips").textContent = t.tips || "";

  document.getElementById("writing-next-btn").onclick = () => {
    document.getElementById("writing-play").style.display = "none";
    initWritingMenu();
  };
}
