/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/modals/ai-generate.js
// AI Generate prompt, loading overlay, results modal, and generate/results bind events.
// Loads after ai-settings.js.

// ─── Prompt History Helpers ───────────────────────────────────────────────────

function getPromptHistory() {
  try {
    const raw = localStorage.getItem("aiPromptHistory");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePromptToHistory(prompt) {
  try {
    const history = getPromptHistory().filter(function (p) {
      return p !== prompt;
    });
    history.unshift(prompt);
    localStorage.setItem("aiPromptHistory", JSON.stringify(history.slice(0, 10)));
  } catch {}
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAiPromptModal() {
  const isFullMode = aiState.mode === "full";
  const selectedCategory = getSelectedCategory();
  const groups = getSelectedCategoryGroups();
  const selectedGroup = groups.find(function (g) {
    return g.id === aiState.groupId;
  });
  const contextLabel = isFullMode
    ? `${icons.sparkles} Create a new category with all its groups and commands`
    : `${icons.sparkles} Add a single command to group: <code>${escapeHtml(selectedGroup ? selectedGroup.title : aiState.groupId)}</code> in <code>${escapeHtml(selectedCategory ? selectedCategory.title : aiState.categoryId)}</code>`;

  // Build shell selector — shown only when terminal profiles are available
  const profiles = (state.terminalProfiles && state.terminalProfiles.profiles) || [];
  const defaultProfile = (state.terminalProfiles && state.terminalProfiles.defaultProfile) || "";
  const resolvedShell = aiState.shellName || defaultProfile || (profiles.length > 0 ? profiles[0].name : "");
  const shellSelectorHtml =
    profiles.length > 0
      ? `<div class="ai-shell-wrap ml-auto">
          <span class="ai-shell-label"
            data-tooltip="The AI will generate commands using the syntax of the selected shell. This does not affect which terminal runs the command."
            data-tooltip-pos="top">Generate commands for:</span>
          ${renderCustomSelect(
            "ai-shell-select-wrap",
            "ai-shell-select-btn",
            "ai-shell-select-menu",
            profiles.map(function (p) {
              return { value: p.name, label: p.name };
            }),
            resolvedShell,
            "cs-btn-sm"
          )}
        </div>`
      : "";

  const promptHistory = getPromptHistory();
  const historyHtml = promptHistory.length
    ? `
            <div class="ai-history-anchor">
              <a href="#" class="ai-history-toggle muted" id="btn-ai-history-toggle">${icons.recent} Recent prompts (${promptHistory.length})</a>
              <div class="ai-history-popover${aiState.promptHistoryOpen ? " open" : ""}" id="ai-history-popover">
                <div class="ai-history-header">
                  <div class="d-flex align-items-center gap-6">
                    ${icons.recent}
                    <span>Recent prompts</span>
                  </div>
                  <button class="btn-close d-focus" id="btn-ai-history-close" type="button" aria-label="Close">${icons.cancel}</button>
                </div>
                <ul class="ai-history-list">${promptHistory
                  .map(function (p, i) {
                    return `<li><button class="ai-history-item" data-index="${i}" type="button"><span class="ai-history-num">${i + 1}</span>${escapeHtml(p)}</button></li>`;
                  })
                  .join("")}</ul>
              </div>
            </div>`
    : "";

  return `
    <div class="modal-overlay" id="ai-prompt-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box ai-prompt-box">
        <h3>${contextLabel}</h3>
        ${aiState.error ? `<p class="ai-error-msg">❌ ${escapeHtml(aiState.error)}</p>` : ""}
        <div class="ai-prompt-label-row">
          <span class="ws-nowrap mr-10">Describe what you need</span>
          ${shellSelectorHtml}
        </div>
        <div class="ai-prompt-textarea-wrap">
          <textarea id="ai-prompt-textarea" class="input" rows="4"
            placeholder="${isFullMode ? "e.g. All essential Git commands" : "e.g. A command to find and kill a process on port 8080"}"
          >${escapeHtml(aiState.prompt)}</textarea>
          ${historyHtml}
        </div>
        <div class="row align-items-flex-end">
          <a href="#" class="muted ai-model-label" id="ai-model-label-link" data-tooltip="Change AI model">${getAiModelLabel(aiState.providerName)}</a>
          <button class="btn small primary" id="btn-ai-generate">${icons.sparkles} Generate</button>
          <button class="btn small secondary action min-w65" id="btn-ai-prompt-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Returns the loading overlay status line for the current generation stage.
 * @returns {string}
 */
function getAiLoadingText() {
  const progress = aiState.progress;
  if (progress && progress.stage === "outline") {
    return "Planning groups and commands...";
  }
  if (progress && progress.stage === "details") {
    return `Writing command details: ${progress.done} of ${progress.total} groups...`;
  }
  return "Generating commands with AI...";
}

// ─── Loading overlay ──────────────────────────────────────────────────────────

const AI_LOADING_PHRASES = ["Mapping out your workflow...", "Grouping related commands...", "Choosing clear group names...", "Matching your shell's syntax..."];

/** Logical size of the planning network canvas. */
const AI_NET_WIDTH = 300;
const AI_NET_HEIGHT = 110;
const AI_NET_NODE_COUNT = 24;
const AI_NET_LINK_DISTANCE = 64;

/** Live state of the planning network; node positions survive re-renders so the motion never jumps. */
const aiNet = { canvas: null, frame: 0, nodes: [], pulses: [], lastTime: 0, nextPulseAt: 0 };

let aiLoadingPhraseTimer = null;
let aiLoadingPhraseIndex = 0;

/**
 * Merges one `aiGenerateProgress` payload into the progress kept in `aiState`.
 * The `groups` payload becomes the per-group list (all queued); each `details`
 * payload then updates the status of a single group.
 * @param {object|null} prev - The current `aiState.progress`.
 * @param {object|null} payload - The incoming progress payload.
 * @returns {object|null}
 */
function mergeAiProgress(prev, payload) {
  if (!payload) {
    return null;
  }
  if (payload.stage === "groups") {
    return {
      stage: "details",
      done: 0,
      total: payload.groups.length,
      groups: payload.groups.map(function (g) {
        return { name: g.name, commands: g.commands, status: "queued" };
      }),
    };
  }
  if (payload.stage === "details" && prev && prev.groups) {
    return {
      stage: "details",
      done: payload.done,
      total: payload.total,
      groups: prev.groups.map(function (g, i) {
        return i === payload.index ? Object.assign({}, g, { status: payload.status }) : g;
      }),
    };
  }
  return payload;
}

/** The planning visual: a living network drawn on a canvas with a softly pulsing orb at its centre. */
function renderAiPlanVisual() {
  const phrase =
    aiState.mode === "full"
      ? `<p class="ai-loading-phrase is-in" id="ai-loading-phrase" aria-hidden="true">${escapeHtml(AI_LOADING_PHRASES[aiLoadingPhraseIndex % AI_LOADING_PHRASES.length])}</p>`
      : "";
  return `
    <div class="ai-plan-visual" aria-hidden="true">
      <canvas class="ai-plan-canvas" id="ai-plan-canvas" width="${AI_NET_WIDTH}" height="${AI_NET_HEIGHT}"></canvas>
      <div class="ai-orb">
        <span class="ai-orb-ring"></span>
        <span class="ai-orb-ring ai-orb-ring-2"></span>
        <span class="ai-orb-core"></span>
      </div>
    </div>
    ${phrase}
  `;
}

/**
 * Returns the status marker of one group row.
 * @param {"queued"|"active"|"done"|"failed"} status
 * @returns {string}
 */
function renderAiGroupStatus(status) {
  if (status === "active") {
    return `<span class="ai-status-active"><i></i><i></i><i></i></span>`;
  }
  if (status === "done") {
    return `<svg class="ai-status-check" viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5" /></svg>`;
  }
  if (status === "failed") {
    return `<span class="ai-status-failed">${icons.circleX}</span>`;
  }
  return `<span class="ai-status-dot"></span>`;
}

function renderAiGroupRow(group, index) {
  const count = group.commands.length;
  return `
    <li class="ai-group-row is-${group.status}" data-group-index="${index}" data-status="${group.status}">
      <span class="ai-group-status">${renderAiGroupStatus(group.status)}</span>
      <span class="ai-group-main">
        <span class="ai-group-name">${escapeHtml(group.name)}</span>
      </span>
      <span class="ai-group-count">${count} ${count === 1 ? "command" : "commands"}</span>
    </li>
  `;
}

/** The group list: overall counter, progress bar, and one row per group. */
function renderAiGroupList(progress) {
  return `
    <div class="ai-loading-summary">
      <span class="ai-loading-counter">
        <span class="ai-loading-counter-num" id="ai-loading-done">${progress.done}</span>
        <span class="ai-loading-counter-sep">/</span>
        <span class="ai-loading-counter-total">${progress.total}</span>
      </span>
      <span class="ai-loading-counter-label">groups written</span>
    </div>
    <div class="ai-loading-bar" aria-hidden="true"><span class="ai-loading-bar-fill" id="ai-loading-bar-fill"></span></div>
    <ul class="ai-group-list" id="ai-group-list">${progress.groups.map(renderAiGroupRow).join("")}</ul>
  `;
}

function hasAiGroupProgress() {
  return !!(aiState.progress && aiState.progress.groups && aiState.progress.groups.length);
}

function renderAiLoadingOverlay() {
  const hasGroups = hasAiGroupProgress();
  return `
    <div class="modal-overlay" id="ai-loading-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box ai-loading-box${hasGroups ? " has-groups" : ""}" id="ai-loading-box">
        <div class="ai-loading-stage" id="ai-loading-stage">${hasGroups ? renderAiGroupList(aiState.progress) : renderAiPlanVisual()}</div>
        <p class="ai-loading-text" id="ai-loading-text" role="status" aria-live="polite">${escapeHtml(getAiLoadingText())}</p>
        <button class="btn small secondary action min-w65" id="btn-ai-loading-cancel" type="button">Cancel</button>
      </div>
    </div>
  `;
}

/**
 * Brings the visible loading overlay in line with `aiState.progress` without a
 * full render, so running animations are never interrupted. Safe to call at any time.
 */
function updateAiLoadingView() {
  const textEl = document.getElementById("ai-loading-text");
  if (textEl) {
    textEl.textContent = getAiLoadingText();
  }
  const box = document.getElementById("ai-loading-box");
  const stage = document.getElementById("ai-loading-stage");
  if (!box || !stage || !hasAiGroupProgress()) {
    return;
  }
  const progress = aiState.progress;

  if (!document.getElementById("ai-group-list")) {
    stage.innerHTML = renderAiGroupList(progress);
    box.classList.add("has-groups");
  }

  document.querySelectorAll(".ai-group-row").forEach(function (row) {
    const index = Number(row.dataset.groupIndex);
    const group = progress.groups[index];
    row.style.setProperty("--i", index);
    if (!group || row.dataset.status === group.status) {
      return;
    }
    row.dataset.status = group.status;
    row.className = `ai-group-row is-${group.status}`;
    row.querySelector(".ai-group-status").innerHTML = renderAiGroupStatus(group.status);
    if (group.status === "active") {
      row.scrollIntoView({ block: "nearest" });
    }
  });
  riseAiFinishedRows();

  const doneEl = document.getElementById("ai-loading-done");
  if (doneEl && doneEl.textContent !== String(progress.done)) {
    doneEl.textContent = progress.done;
    doneEl.classList.remove("is-bump");
    void doneEl.offsetWidth;
    doneEl.classList.add("is-bump");
  }
  const fill = document.getElementById("ai-loading-bar-fill");
  if (fill) {
    fill.style.setProperty("--progress", progress.total > 0 ? progress.done / progress.total : 0);
  }
}

/**
 * Moves finished group rows up, right after the last finished row, and slides
 * every row that changed position into place.
 */
function riseAiFinishedRows() {
  const list = document.getElementById("ai-group-list");
  if (!list || !hasAiGroupProgress()) {
    return;
  }
  const rows = Array.from(list.children);
  const before = new Map(
    rows.map(function (row) {
      return [row, row.getBoundingClientRect().top];
    })
  );
  let moved = false;
  rows.forEach(function (row) {
    const group = aiState.progress.groups[Number(row.dataset.groupIndex)];
    if (!group || group.status !== "done" || row.dataset.risen === "1") {
      return;
    }
    row.dataset.risen = "1";
    const firstOpen = Array.from(list.children).find(function (el) {
      return el.dataset.risen !== "1" || el === row;
    });
    if (firstOpen && firstOpen !== row) {
      list.insertBefore(row, firstOpen);
      moved = true;
    }
  });
  if (!moved || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  rows.forEach(function (row) {
    const delta = before.get(row) - row.getBoundingClientRect().top;
    if (delta !== 0) {
      row.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: 450, easing: "ease" });
    }
  });
}

let aiFinaleTimer = null;

/** Stops a pending finale so a cancelled or restarted run is never overwritten. */
function cancelAiLoadingFinale() {
  clearTimeout(aiFinaleTimer);
  aiFinaleTimer = null;
}

/**
 * Plays the short closing flash over the group list, then calls `onDone`.
 * Skips the wait when there is no group list or motion is reduced.
 * @param {() => void} onDone
 */
function playAiLoadingFinale(onDone) {
  const box = document.getElementById("ai-loading-box");
  if (!box || !document.getElementById("ai-group-list") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    onDone();
    return;
  }
  box.classList.add("is-finale");
  cancelAiLoadingFinale();
  aiFinaleTimer = setTimeout(function () {
    aiFinaleTimer = null;
    onDone();
  }, 950);
}

/**
 * Applies a finished generation result: shows the results view, or the prompt with the error.
 * @param {{ success: boolean, result?: object, message?: string }|undefined} payload
 */
function applyAiGenerateResult(payload) {
  aiState.progress = null;
  if (payload && payload.success) {
    const result = payload.result;
    aiState.mode = result.mode;
    aiState.result = result.mode === "full" ? { category: result.category, commands: result.commands } : result.command;
    aiState.warnings = result.mode === "full" ? result.warnings || [] : [];
    // Initialize all commands as checked
    const cmds = result.mode === "full" ? result.commands || [] : [result.command];
    const checked = {};
    cmds.forEach(function (cmd) {
      checked[cmd.id] = true;
    });
    aiState.checkedIds = checked;
    aiState.filterGroupId = "all";
    aiState.error = "";
    aiState.view = "results";
  } else {
    aiState.error = payload && payload.message ? payload.message : "Unknown error";
    aiState.view = "prompt";
  }
  render();
}

/**
 * Creates the drifting nodes of the planning network at random positions.
 * Each node has its own speed and a slowly changing heading, so no two runs look alike.
 */
function createAiNetNodes() {
  const nodes = [];
  for (let i = 0; i < AI_NET_NODE_COUNT; i++) {
    nodes.push({
      x: Math.random() * AI_NET_WIDTH,
      y: Math.random() * AI_NET_HEIGHT,
      heading: Math.random() * Math.PI * 2,
      turn: (Math.random() - 0.5) * 0.9,
      speed: 5 + Math.random() * 9,
      radius: 1.2 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
      energy: 0,
    });
  }
  return nodes;
}

/** Moves every node one step; headings wander and nodes are steered gently back near the edges. */
function stepAiNet(dt) {
  aiNet.nodes.forEach(function (node) {
    node.turn += (Math.random() - 0.5) * 1.6 * dt;
    node.turn = Math.max(-1.1, Math.min(1.1, node.turn));
    node.heading += node.turn * dt;
    node.x += Math.cos(node.heading) * node.speed * dt;
    node.y += Math.sin(node.heading) * node.speed * dt;
    const margin = 14;
    if (node.x < margin) node.heading = Math.atan2(Math.sin(node.heading), Math.abs(Math.cos(node.heading)));
    if (node.x > AI_NET_WIDTH - margin) node.heading = Math.atan2(Math.sin(node.heading), -Math.abs(Math.cos(node.heading)));
    if (node.y < margin) node.heading = Math.atan2(Math.abs(Math.sin(node.heading)), Math.cos(node.heading));
    if (node.y > AI_NET_HEIGHT - margin) node.heading = Math.atan2(-Math.abs(Math.sin(node.heading)), Math.cos(node.heading));
    node.energy = Math.max(0, node.energy - dt * 1.4);
  });
}

/** Sends a light pulse along a random link between two nearby nodes, at random moments. */
function spawnAiNetPulse(now) {
  if (now < aiNet.nextPulseAt) {
    return;
  }
  aiNet.nextPulseAt = now + 260 + Math.random() * 700;
  const from = aiNet.nodes[Math.floor(Math.random() * aiNet.nodes.length)];
  const near = aiNet.nodes.filter(function (other) {
    return other !== from && Math.hypot(other.x - from.x, other.y - from.y) < AI_NET_LINK_DISTANCE;
  });
  if (!near.length) {
    return;
  }
  const to = near[Math.floor(Math.random() * near.length)];
  from.energy = 1;
  aiNet.pulses.push({ from, to, t: 0, speed: 0.9 + Math.random() * 0.9 });
}

/** Draws one frame of the network: soft links, twinkling nodes, and travelling pulses. */
function drawAiNet(ctx, time) {
  const style = getComputedStyle(aiNet.canvas);
  const accent = style.getPropertyValue("--runbox-button-background").trim() || "#3794ff";
  const light = style.getPropertyValue("--runbox-foreground").trim() || "#ffffff";
  ctx.clearRect(0, 0, AI_NET_WIDTH, AI_NET_HEIGHT);

  ctx.lineWidth = 0.8;
  ctx.strokeStyle = accent;
  for (let i = 0; i < aiNet.nodes.length; i++) {
    for (let j = i + 1; j < aiNet.nodes.length; j++) {
      const a = aiNet.nodes[i];
      const b = aiNet.nodes[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < AI_NET_LINK_DISTANCE) {
        ctx.globalAlpha = (1 - dist / AI_NET_LINK_DISTANCE) * 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  aiNet.nodes.forEach(function (node) {
    const twinkle = 0.55 + 0.45 * Math.sin(time / 650 + node.phase);
    ctx.globalAlpha = Math.min(1, 0.35 * twinkle + node.energy * 0.7);
    ctx.fillStyle = node.energy > 0.05 ? light : accent;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius + node.energy * 1.6, 0, Math.PI * 2);
    ctx.fill();
  });

  aiNet.pulses.forEach(function (pulse) {
    const x = pulse.from.x + (pulse.to.x - pulse.from.x) * pulse.t;
    const y = pulse.from.y + (pulse.to.y - pulse.from.y) * pulse.t;
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

/** Animation loop; ends by itself once the canvas has left the page. */
function tickAiNet(time) {
  const canvas = aiNet.canvas;
  if (!canvas || !canvas.isConnected) {
    aiNet.frame = 0;
    aiNet.canvas = null;
    return;
  }
  const dt = aiNet.lastTime ? Math.min(0.05, (time - aiNet.lastTime) / 1000) : 0.016;
  aiNet.lastTime = time;
  stepAiNet(dt);
  spawnAiNetPulse(time);
  aiNet.pulses.forEach(function (pulse) {
    pulse.t += dt * pulse.speed;
    if (pulse.t >= 1) {
      pulse.to.energy = 1;
    }
  });
  aiNet.pulses = aiNet.pulses.filter(function (pulse) {
    return pulse.t < 1;
  });
  drawAiNet(canvas.getContext("2d"), time);
  aiNet.frame = requestAnimationFrame(tickAiNet);
}

/** Attaches the animation to the planning canvas of the current render; a still frame when motion is reduced. */
function startAiPlanNet() {
  const canvas = document.getElementById("ai-plan-canvas");
  if (!canvas) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(AI_NET_WIDTH * dpr);
  canvas.height = Math.round(AI_NET_HEIGHT * dpr);
  canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!aiNet.nodes.length) {
    aiNet.nodes = createAiNetNodes();
  }
  aiNet.canvas = canvas;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    drawAiNet(canvas.getContext("2d"), 0);
    return;
  }
  if (!aiNet.frame) {
    aiNet.lastTime = 0;
    aiNet.frame = requestAnimationFrame(tickAiNet);
  }
}

/** Swaps the planning phrase every few seconds; stops by itself once the phrase is gone. */
function rotateAiLoadingPhrase() {
  const el = document.getElementById("ai-loading-phrase");
  if (!el) {
    clearInterval(aiLoadingPhraseTimer);
    aiLoadingPhraseTimer = null;
    return;
  }
  aiLoadingPhraseIndex = (aiLoadingPhraseIndex + 1) % AI_LOADING_PHRASES.length;
  el.classList.remove("is-in");
  void el.offsetWidth;
  el.textContent = AI_LOADING_PHRASES[aiLoadingPhraseIndex];
  el.classList.add("is-in");
}

function renderAiResultsModal() {
  if (!aiState.result) {
    return "";
  }

  const isFullMode = aiState.mode === "full";
  const allCommands = isFullMode ? aiState.result.commands || [] : [aiState.result];
  const category = isFullMode ? aiState.result.category : null;
  const groups = isFullMode ? (aiState.result.category ? aiState.result.category.groups || [] : []) : getSelectedCategoryGroups();

  // Filter commands by active group tab
  const filteredCommands =
    aiState.filterGroupId === "all"
      ? allCommands
      : allCommands.filter(function (cmd) {
          return cmd.groupId === aiState.filterGroupId;
        });

  const selectedCount = Object.values(aiState.checkedIds).filter(Boolean).length;

  // Build group tabs for filtering
  const groupTabs =
    isFullMode && groups.length > 0
      ? `
      <div class="group-tags-row">
        <button class="tag d-focus group-filter-tag ${aiState.filterGroupId === "all" ? "active" : ""}" data-ai-filter="all">All (${allCommands.length})</button>
        ${groups
          .map(function (g) {
            const count = allCommands.filter(function (cmd) {
              return cmd.groupId === g.id;
            }).length;
            return `<button class="tag d-focus group-filter-tag ${aiState.filterGroupId === g.id ? "active" : ""}" data-ai-filter="${escapeAttr(g.id)}">${escapeHtml(g.title)} (${count})</button>`;
          })
          .join("")}
      </div>`
      : "";

  return `
    <div class="modal-overlay" id="ai-results-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box ai-results-box">
        <div class="row between">
          <h3>${icons.sparkles} AI Generated Commands</h3>
          ${isFullMode && category ? `<span class="muted ai-category-label">Category: <strong>${escapeHtml(category.title)}</strong></span>` : ""}
        </div>
        ${aiState.error ? `<p class="ai-error-msg">❌ ${escapeHtml(aiState.error)}</p>` : ""}
        ${
          aiState.warnings && aiState.warnings.length
            ? `<ul class="ai-warning-list">
                ${aiState.warnings
                  .map(function (warning) {
                    return `<li>${escapeHtml(warning)}</li>`;
                  })
                  .join("")}
              </ul>`
            : ""
        }
        ${groupTabs}
        <div class="table-wrap">
          <div class="ai-results-table-scroll">
          <table class="cmds-table commands-table ai-results-table">
            <thead>
              <tr>
              <th>Title</th>
              <th>Description</th>
              <th>Command</th>
              ${isFullMode ? "<th>Group</th>" : ""}
              <th><input type="checkbox" id="ai-check-all" ${selectedCount === allCommands.length ? "checked" : ""} /></th>
              </tr>
            </thead>
            <tbody>
              ${filteredCommands
                .map(function (cmd) {
                  const isChecked = aiState.checkedIds[cmd.id] !== false;
                  const cmdGroups = isFullMode
                    ? (function () {
                        const g = groups.find(function (gr) {
                          return gr.id === cmd.groupId;
                        });
                        return g ? g.title : cmd.groupId || "";
                      })()
                    : "";
                  return `
                  <tr class="${isChecked ? "" : "ai-row-unchecked"}">
                    <td><strong>${escapeHtml(cmd.title)}</strong></td>
                    <td>${escapeHtml(cmd.description || "-")}</td>
                    <td><pre class="template-cell">${highlightTemplateHtml(cmd.command)}</pre></td>
                    ${isFullMode ? `<td>${escapeHtml(cmdGroups || "-")}</td>` : ""}
                    <td>
                      <input type="checkbox" class="ai-cmd-checkbox" data-cmd-id="${escapeAttr(cmd.id)}" ${isChecked ? "checked" : ""} />
                    </td>
                  </tr>
                `;
                })
                .join("")}
            </tbody>
          </table>
          </div>
        </div>
        <div class="row justify-content-flex-end mt-20">
          <span class="muted ai-results-count">${selectedCount} of ${allCommands.length} selected</span>
          <button class="btn small primary" id="btn-ai-insert" ${selectedCount === 0 ? "disabled" : ""}>Insert Selected (${selectedCount})</button>
          <button class="btn small secondary action min-w65" id="btn-ai-results-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

// ─── AI Generate Bind Function ───────────────────────────────────────────────

function bindAiGenerateEvents() {
  // ⚙️ AI Settings button (in header)
  const aiSettingsBtn = document.getElementById("btn-ai-settings");
  if (aiSettingsBtn) {
    aiSettingsBtn.addEventListener("click", function () {
      aiState.view = "settings";
      aiState.apiKeyInput = "";
      // Fetch current settings from extension
      vscode.postMessage({ type: "aiGetSettings" });
    });
  }

  // "Create with AI" button (in manage tab)
  const createWithAiBtn = document.getElementById("btn-create-with-ai");
  if (createWithAiBtn) {
    createWithAiBtn.addEventListener("click", function () {
      aiState.mode = "full";
      aiState.view = "prompt";
      aiState.prompt = "";
      aiState.error = "";
      // Fetch current settings so providerName is always up-to-date before rendering
      vscode.postMessage({ type: "aiGetSettings" });
    });
  }

  // "Add with AI" button (in commands tab)
  const addWithAiBtn = document.getElementById("btn-add-with-ai");
  if (addWithAiBtn) {
    addWithAiBtn.addEventListener("click", function () {
      const selectedCategory = getSelectedCategory();
      if (!selectedCategory) {
        return;
      }
      aiState.mode = "single";
      aiState.categoryId = selectedCategory.id;
      aiState.groupId = uiState.selectedGroupId !== "all" ? uiState.selectedGroupId : "";
      aiState.view = "prompt";
      aiState.prompt = "";
      aiState.error = "";
      // Fetch current settings so providerName is always up-to-date before rendering
      vscode.postMessage({ type: "aiGetSettings" });
    });
  }

  // --- Prompt modal events ---
  if (aiState.view === "prompt") {
    // Bind shell selector — sync aiState.shellName when the user picks a different shell
    const profiles = (state.terminalProfiles && state.terminalProfiles.profiles) || [];
    const defaultProfile = (state.terminalProfiles && state.terminalProfiles.defaultProfile) || "";
    // Initialise shellName/shellPath from default profile on first open
    if (!aiState.shellName && (defaultProfile || profiles.length > 0)) {
      aiState.shellName = defaultProfile || profiles[0].name;
      const initialProfile = profiles.find(function (p) {
        return p.name === aiState.shellName;
      });
      aiState.shellPath = initialProfile ? initialProfile.shellPath : null;
    }
    if (profiles.length > 0) {
      bindCustomSelect("ai-shell-select-wrap", "ai-shell-select-btn", "ai-shell-select-menu", function (newShell) {
        aiState.shellName = newShell;
        const matchedProfile = profiles.find(function (p) {
          return p.name === newShell;
        });
        aiState.shellPath = matchedProfile ? matchedProfile.shellPath : null;
      });
    }

    const textarea = document.getElementById("ai-prompt-textarea");
    if (textarea) {
      textarea.addEventListener("input", function () {
        aiState.prompt = textarea.value;
      });
      // Focus textarea
      setTimeout(function () {
        if (textarea) {
          textarea.focus();
        }
      }, 50);
    }

    const generateBtn = document.getElementById("btn-ai-generate");
    if (generateBtn) {
      generateBtn.addEventListener("click", function () {
        const prompt = document.getElementById("ai-prompt-textarea");
        const promptValue = prompt ? prompt.value.trim() : aiState.prompt.trim();
        if (!promptValue) {
          aiState.error = "Please enter a prompt.";
          render();
          return;
        }
        cancelAiLoadingFinale();
        savePromptToHistory(promptValue);
        aiState.prompt = promptValue;
        aiState.error = "";
        aiState.warnings = [];
        aiState.progress = null;
        aiState.promptHistoryOpen = false;
        aiState.view = "loading";
        render();

        vscode.postMessage({
          type: "aiGenerate",
          payload: {
            mode: aiState.mode,
            prompt: promptValue,
            categoryId: aiState.categoryId,
            groupId: aiState.groupId,
            shellName: aiState.shellName,
            shellPath: aiState.shellPath,
          },
        });
      });
    }

    const aiModelLabelLink = document.getElementById("ai-model-label-link");
    if (aiModelLabelLink) {
      aiModelLabelLink.addEventListener("click", function (e) {
        e.preventDefault();
        aiState.returnToPrompt = true;
        aiState.view = "settings";
        aiState.apiKeyInput = "";
        vscode.postMessage({ type: "aiGetSettings" });
      });
    }

    const cancelBtn = document.getElementById("btn-ai-prompt-cancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        aiState.view = null;
        aiState.error = "";
        aiState.prompt = "";
        render();
      });
    }

    // 🕐 Prompt history popover
    const historyToggle = document.getElementById("btn-ai-history-toggle");
    if (historyToggle) {
      historyToggle.addEventListener("click", function (e) {
        e.preventDefault();
        aiState.promptHistoryOpen = !aiState.promptHistoryOpen;
        const popover = document.getElementById("ai-history-popover");
        if (popover) {
          popover.classList.toggle("open", aiState.promptHistoryOpen);
        }
      });
    }

    const historyClose = document.getElementById("btn-ai-history-close");
    if (historyClose) {
      historyClose.addEventListener("click", function () {
        aiState.promptHistoryOpen = false;
        const popover = document.getElementById("ai-history-popover");
        if (popover) {
          popover.classList.remove("open");
        }
      });
    }

    document.querySelectorAll(".ai-history-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const history = getPromptHistory();
        const idx = parseInt(btn.dataset.index, 10);
        const selected = history[idx];
        if (selected === undefined) {
          return;
        }
        const ta = document.getElementById("ai-prompt-textarea");
        if (ta) {
          ta.value = selected;
          aiState.prompt = selected;
          ta.focus();
        }
        aiState.promptHistoryOpen = false;
        const popover = document.getElementById("ai-history-popover");
        if (popover) {
          popover.classList.remove("open");
        }
      });
    });

    // Close popover when clicking outside of it
    document.addEventListener("click", function onDocClickHistory(e) {
      const anchor = document.querySelector(".ai-history-anchor");
      if (!anchor) {
        document.removeEventListener("click", onDocClickHistory);
        return;
      }
      if (!anchor.contains(e.target)) {
        aiState.promptHistoryOpen = false;
        const popover = document.getElementById("ai-history-popover");
        if (popover) {
          popover.classList.remove("open");
        }
      }
    });
  }

  // --- Loading overlay events ---
  if (aiState.view === "loading") {
    updateAiLoadingView();
    startAiPlanNet();
    if (!aiLoadingPhraseTimer && document.getElementById("ai-loading-phrase")) {
      aiLoadingPhraseTimer = setInterval(rotateAiLoadingPhrase, 2800);
    }
    const loadingCancelBtn = document.getElementById("btn-ai-loading-cancel");
    if (loadingCancelBtn) {
      loadingCancelBtn.addEventListener("click", function () {
        cancelAiLoadingFinale();
        vscode.postMessage({ type: "aiCancelGenerate" });
        aiState.progress = null;
        aiState.view = "prompt";
        render();
      });
    }
  }

  // --- Results modal events ---
  if (aiState.view === "results") {
    const checkAll = document.getElementById("ai-check-all");
    if (checkAll) {
      checkAll.addEventListener("change", function () {
        const allCommands = aiState.mode === "full" ? aiState.result.commands || [] : [aiState.result];
        const newChecked = {};
        allCommands.forEach(function (cmd) {
          newChecked[cmd.id] = checkAll.checked;
        });
        aiState.checkedIds = newChecked;
        render();
      });
    }

    document.querySelectorAll(".ai-cmd-checkbox").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        aiState.checkedIds[checkbox.dataset.cmdId] = checkbox.checked;
        // Update UI without full re-render to preserve scroll position
        const allCommands = aiState.mode === "full" ? aiState.result.commands || [] : [aiState.result];
        const selectedCount = Object.values(aiState.checkedIds).filter(Boolean).length;
        // Toggle row dimming class
        const row = checkbox.closest("tr");
        if (row) {
          if (checkbox.checked) {
            row.classList.remove("ai-row-unchecked");
          } else {
            row.classList.add("ai-row-unchecked");
          }
        }
        // Update count text
        const countEl = document.querySelector(".ai-results-count");
        if (countEl) {
          countEl.textContent = selectedCount + " of " + allCommands.length + " selected";
        }
        // Update insert button
        const insertBtn = document.getElementById("btn-ai-insert");
        if (insertBtn) {
          insertBtn.disabled = selectedCount === 0;
          insertBtn.textContent = "Insert Selected (" + selectedCount + ")";
        }
        // Update check-all checkbox
        const checkAll = document.getElementById("ai-check-all");
        if (checkAll) {
          checkAll.checked = selectedCount === allCommands.length;
        }
      });
    });

    document.querySelectorAll("[data-ai-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        aiState.filterGroupId = btn.dataset.aiFilter;
        render();
      });
    });

    const insertBtn = document.getElementById("btn-ai-insert");
    if (insertBtn) {
      insertBtn.addEventListener("click", function () {
        const allCommands = aiState.mode === "full" ? aiState.result.commands || [] : [aiState.result];
        const selectedCommands = allCommands.filter(function (cmd) {
          return aiState.checkedIds[cmd.id] !== false;
        });

        if (!selectedCommands.length) {
          return;
        }

        // "Current Workspace" pseudo-category: route to the dedicated workspace-local
        // insert message instead of the regular category-based aiInsert.
        if (isCurrentWorkspaceCategory(aiState.categoryId)) {
          vscode.postMessage({
            type: "aiInsertWorkspace",
            payload: {
              mode: aiState.mode,
              groups: aiState.mode === "full" && aiState.result.category ? aiState.result.category.groups || [] : [],
              commands: selectedCommands,
            },
          });
          return;
        }

        vscode.postMessage({
          type: "aiInsert",
          payload: {
            mode: aiState.mode,
            category: aiState.mode === "full" ? aiState.result.category || null : null,
            commands: selectedCommands,
          },
        });
      });
    }

    const cancelBtn = document.getElementById("btn-ai-results-cancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        aiState.view = null;
        aiState.result = null;
        aiState.warnings = [];
        aiState.error = "";
        render();
      });
    }
  }
}
