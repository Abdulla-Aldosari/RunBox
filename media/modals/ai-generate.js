/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
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

function renderAiLoadingOverlay() {
  return `
    <div class="modal-overlay" id="ai-loading-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box ai-loading-box">
        <div class="ai-spinner" aria-label="Loading..."></div>
        <p class="ai-loading-text">Generating commands with AI...</p>
      </div>
    </div>
  `;
}

function renderAiResultsModal() {
  if (!aiState.result) {
    return "";
  }

  const isFullMode = aiState.mode === "full";
  const allCommands = isFullMode ? aiState.result.commands || [] : [aiState.result];
  const category = isFullMode ? aiState.result.category : null;
  const groups = isFullMode
    ? aiState.result.category
      ? aiState.result.category.groups || []
      : []
    : getSelectedCategoryGroups();

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
        ${groupTabs}
        <div class="table-wrap">
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
    // Initialise shellName from default profile on first open
    if (!aiState.shellName && (defaultProfile || profiles.length > 0)) {
      aiState.shellName = defaultProfile || profiles[0].name;
    }
    if (profiles.length > 0) {
      bindCustomSelect("ai-shell-select-wrap", "ai-shell-select-btn", "ai-shell-select-menu", function (newShell) {
        aiState.shellName = newShell;
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
        savePromptToHistory(promptValue);
        aiState.prompt = promptValue;
        aiState.error = "";
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
        aiState.error = "";
        render();
      });
    }
  }
}
