/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/modals/ai-explain.js
// AI Explain command modal — displays a structured, AI-generated Markdown explanation
// for a CLI command. Renders loading, content, and error states.
// Depends on: renderMarkdown() from markdown-parser.js
// Loads after ai-generate.js, before enum-manager.js.

// ─── Open / Close ─────────────────────────────────────────────────────────────

/**
 * Opens the explain modal immediately in loading state and fires the AI request.
 * @param {string} command - Raw command text to explain
 */
function openAiExplainModal(command) {
  aiExplainState.visible = true;
  aiExplainState.loading = true;
  aiExplainState.requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  aiExplainState.command = command;
  aiExplainState.markdown = "";
  aiExplainState.error = "";

  _injectAiExplainModal();
  vscode.postMessage({ type: "aiExplain", payload: { command, requestId: aiExplainState.requestId } });
}

/**
 * Closes the explain modal and removes it from the DOM.
 * Aborts the pending request when the explanation is still loading.
 */
function closeAiExplainModal() {
  if (aiExplainState.loading) {
    vscode.postMessage({ type: "aiCancelExplain" });
  }
  aiExplainState.requestId = "";
  aiExplainState.visible = false;
  aiExplainState.loading = false;
  aiExplainState.markdown = "";
  aiExplainState.error = "";
  aiExplainState.command = "";

  document.removeEventListener("keydown", _onAiExplainEscKey);

  var el = document.getElementById("ai-explain-overlay");
  if (el) {
    el.remove();
  }
}

// ─── DOM Injection ────────────────────────────────────────────────────────────

/**
 * Injects the explain modal overlay into <body>.
 * Call once when opening — then use _repaintAiExplainContent() to update state.
 */
function _injectAiExplainModal() {
  // Remove any existing instance first
  var existing = document.getElementById("ai-explain-overlay");
  if (existing) {
    existing.remove();
  }

  var overlay = document.createElement("div");
  overlay.id = "ai-explain-overlay";
  overlay.className = "ai-explain-overlay";
  overlay.innerHTML = _renderAiExplainModal();

  document.body.appendChild(overlay);
  _bindAiExplainCloseBtn();
  _activateAiExplainLoading();
}

/**
 * Starts the network animation and binds the Cancel button when the loading view is shown.
 */
function _activateAiExplainLoading() {
  if (!aiExplainState.loading) {
    return;
  }
  startAiPlanNet();
  var cancelBtn = document.getElementById("btn-ai-explain-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", function () {
      closeAiExplainModal();
    });
  }
}

/**
 * Repaint only the content area of the modal (loading → content / error).
 * Does not re-inject the modal; only updates the inner content div.
 */
function _repaintAiExplainContent() {
  var contentEl = document.getElementById("ai-explain-content");
  if (!contentEl) {
    return;
  }
  contentEl.innerHTML = _renderAiExplainContent();
  _activateAiExplainLoading();
}

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * Returns the full modal HTML (outer shell + initial content).
 * @returns {string}
 */
function _renderAiExplainModal() {
  var commandHtml = escapeHtml(aiExplainState.command);
  return `<div class="ai-explain-modal" role="dialog" aria-modal="true" aria-labelledby="ai-explain-title">
    <div class="ai-explain-header">
      <div class="ai-explain-title-row">
        <span class="ai-explain-icon">${icons.explain}</span>
        <span class="ai-explain-title" id="ai-explain-title">Command Explanation</span>
      </div>
      <button class="btn icon-btn secondary ai-explain-close d-focus" id="btn-ai-explain-close" type="button" data-tooltip="Close" data-tooltip-pos="left">&#x2715;</button>
    </div>
    <div class="ai-explain-command-bar">
      <pre class="ai-explain-command-pre"><code class="ai-explain-command-text">${commandHtml}</code></pre>
    </div>
    <div class="ai-explain-body" id="ai-explain-content">
      ${_renderAiExplainContent()}
    </div>
  </div>`;
}

/**
 * Returns the inner content HTML based on current aiExplainState.
 * @returns {string}
 */
function _renderAiExplainContent() {
  if (aiExplainState.loading) {
    return `<div class="ai-explain-generating">
      ${renderAiPlanVisual(false)}
      <p class="ai-explain-generating-text" role="status" aria-live="polite">Generating explanation…</p>
      <button class="btn small secondary action min-w65" id="btn-ai-explain-cancel" type="button">Cancel</button>
    </div>`;
  }

  if (aiExplainState.error) {
    return `<div class="ai-explain-error">
      <span>${icons.circleX}</span>
      <span>${escapeHtml(aiExplainState.error)}</span>
    </div>`;
  }

  if (aiExplainState.markdown) {
    return `<div class="md-body">${renderMarkdown(aiExplainState.markdown)}</div>`;
  }

  return "";
}

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * Binds the close button and backdrop-click inside the explain modal.
 */
function _bindAiExplainCloseBtn() {
  var overlay = document.getElementById("ai-explain-overlay");
  if (!overlay) {
    return;
  }

  var closeBtn = document.getElementById("btn-ai-explain-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      closeAiExplainModal();
    });
  }

  // Click outside modal box closes it
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) {
      closeAiExplainModal();
    }
  });

  // Escape key closes it
  document.addEventListener("keydown", _onAiExplainEscKey);
}

function _onAiExplainEscKey(e) {
  if (e.key === "Escape" && aiExplainState.visible) {
    closeAiExplainModal();
  }
}

/**
 * Called by messages.js when aiExplainResult arrives.
 * Updates state and repaints only the content area.
 * Results whose requestId does not match the pending request are ignored.
 * @param {{ success: boolean, markdown?: string, message?: string, requestId?: string }} payload
 */
function handleAiExplainResult(payload) {
  if (!aiExplainState.visible || !payload || payload.requestId !== aiExplainState.requestId) {
    return;
  }
  aiExplainState.loading = false;

  if (payload && payload.success) {
    aiExplainState.markdown = payload.markdown || "";
    aiExplainState.error = "";
  } else {
    aiExplainState.markdown = "";
    aiExplainState.error = payload && payload.message ? payload.message : "An unexpected error occurred.";
  }

  _repaintAiExplainContent();
}
