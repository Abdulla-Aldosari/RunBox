/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/modals/ai-check-status.js
// AI Check Status modal — shared by the "Check Connection" and "Check Rate Limits"
// actions in AI Settings. Shows a loading state while the extension performs the
// check, then displays the result (or an explanatory message when a provider does
// not support proactive rate limit checks).
// Loads after ai-settings.js.

// ─── Open / Close ─────────────────────────────────────────────────────────────

/**
 * Opens the modal in loading state and fires the connection check request.
 * @param {string} providerName
 * @param {string} modelId
 */
function openAiCheckConnectionModal(providerName, modelId) {
  aiCheckStatusState.visible = true;
  aiCheckStatusState.mode = "connection";
  aiCheckStatusState.loading = true;
  aiCheckStatusState.result = null;
  aiCheckStatusState.error = "";

  _injectAiCheckStatusModal();
  vscode.postMessage({ type: "aiCheckConnection", payload: { providerName, modelId } });
}

/**
 * Opens the modal in loading state and fires the rate limits check request.
 * If the provider does not support proactive rate limit checks, the extension
 * responds immediately (no real network request) and the modal shows a link
 * to the provider's own rate-limit page instead.
 * @param {string} providerName
 * @param {string} modelId
 */
function openAiCheckRateLimitsModal(providerName, modelId) {
  aiCheckStatusState.visible = true;
  aiCheckStatusState.mode = "rateLimits";
  aiCheckStatusState.loading = true;
  aiCheckStatusState.result = null;
  aiCheckStatusState.error = "";

  _injectAiCheckStatusModal();
  vscode.postMessage({ type: "aiCheckRateLimits", payload: { providerName, modelId } });
}

/**
 * Closes the modal and removes it from the DOM.
 */
function closeAiCheckStatusModal() {
  aiCheckStatusState.visible = false;
  aiCheckStatusState.mode = null;
  aiCheckStatusState.loading = false;
  aiCheckStatusState.result = null;
  aiCheckStatusState.error = "";

  document.removeEventListener("keydown", _onAiCheckStatusEscKey);

  var el = document.getElementById("ai-check-status-overlay");
  if (el) {
    el.remove();
  }
}

// ─── DOM Injection ────────────────────────────────────────────────────────────

/**
 * Injects the modal overlay into <body>.
 * Call once when opening — then use _repaintAiCheckStatusContent() to update state.
 */
function _injectAiCheckStatusModal() {
  var existing = document.getElementById("ai-check-status-overlay");
  if (existing) {
    existing.remove();
  }

  var overlay = document.createElement("div");
  overlay.id = "ai-check-status-overlay";
  overlay.className = "modal-overlay";
  overlay.setAttribute("data-dismiss-on-outside-click", "true");
  overlay.innerHTML = _renderAiCheckStatusModal();

  document.body.appendChild(overlay);
  _bindAiCheckStatusEvents();
}

/**
 * Repaint only the content area of the modal (loading → success / error / unsupported).
 */
function _repaintAiCheckStatusContent() {
  var contentEl = document.getElementById("ai-check-status-content");
  if (!contentEl) {
    return;
  }
  contentEl.innerHTML = _renderAiCheckStatusContent();
  _bindAiCheckStatusContentEvents();
}

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * Returns the modal title based on the current mode.
 * @returns {string}
 */
function _aiCheckStatusTitle() {
  return aiCheckStatusState.mode === "rateLimits" ? "Rate Limits Status" : "Connection Status";
}

/**
 * Returns the full modal HTML (outer shell + initial content).
 * @returns {string}
 */
function _renderAiCheckStatusModal() {
  return `<div class="modal-box ai-check-status-box">
    <h3>${icons.aiSettings} ${_aiCheckStatusTitle()}</h3>
    <div id="ai-check-status-content">
      ${_renderAiCheckStatusContent()}
    </div>
    <div class="row justify-content-flex-end ai-check-status-footer">
      <button class="btn small secondary action min-w65" id="btn-ai-check-status-close">Close</button>
    </div>
  </div>`;
}

/**
 * Converts a camelCase key (e.g. "remainingRequestsMinute") into a human label
 * (e.g. "Remaining Requests Minute").
 * @param {string} key
 * @returns {string}
 */
function _humanizeLimitKey(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, function (c) {
      return c.toUpperCase();
    })
    .trim();
}

/**
 * Formats a single rate-limit value for display.
 * Numeric keys ending in "Seconds" are also expanded into a local wall-clock time.
 * String values (e.g. Anthropic's ISO reset timestamps) are shown as a local time string.
 * @param {string} key
 * @param {number|string} value
 * @returns {string}
 */
function _formatLimitValue(key, value) {
  if (typeof value === "number" && /Seconds$/.test(key)) {
    var when = new Date(Date.now() + value * 1000);
    return `${value} seconds (${when.toLocaleTimeString()})`;
  }
  if (typeof value === "string") {
    var parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }
    return value;
  }
  return String(value);
}

/**
 * Scans a raw rate-limits object and pairs up "limit<X>" / "remaining<X>" keys
 * generically, regardless of which provider they came from (e.g. "limitRequests" +
 * "remainingRequests", "limitRequestsMinute" + "remainingRequestsMinute", etc.).
 * Also attaches a matching "reset*" key when one exists for the same category
 * (Requests or Tokens).
 * @param {object} limits
 * @returns {{ label: string, limitKey: string, remainingKey: string, resetKey: string|null, limit: number, remaining: number, resetValue: (number|string|null) }[]}
 */
function _extractLimitPairs(limits) {
  var keys = Object.keys(limits);
  var pairs = [];

  keys.forEach(function (key) {
    if (!/^limit/.test(key)) {
      return;
    }
    var suffix = key.slice(5); // text after "limit"
    var remainingKey = "remaining" + suffix;
    if (limits[remainingKey] === null || limits[remainingKey] === undefined) {
      return;
    }

    var categoryMatch = suffix.match(/Requests|Tokens/);
    var category = categoryMatch ? categoryMatch[0] : suffix;
    var remainder = suffix.replace(category, "");

    var resetKey = keys.find(function (k) {
      return /^reset/.test(k) && k.indexOf(category) !== -1;
    });

    var label = _humanizeLimitKey(category) + (remainder ? ` (${_humanizeLimitKey(remainder)})` : "");

    pairs.push({
      label: label,
      limitKey: key,
      remainingKey: remainingKey,
      resetKey: resetKey || null,
      limit: limits[key],
      remaining: limits[remainingKey],
      resetValue: resetKey ? limits[resetKey] : null,
    });
  });

  return pairs;
}

/**
 * Renders a single rate-limit pair as a labeled progress bar showing
 * remaining/limit, colored by how much of the limit has been consumed.
 * The fill percentage is applied via a data-percent attribute and set as a
 * CSS custom property (--limit-percent) after the element is bound, since
 * the value can only be known at runtime.
 * @param {{ label: string, limit: number, remaining: number, resetKey: string|null, resetValue: (number|string|null) }} pair
 * @returns {string}
 */
function _renderLimitBar(pair) {
  var limit = typeof pair.limit === "number" ? pair.limit : 0;
  var remaining = typeof pair.remaining === "number" ? pair.remaining : 0;
  var used = limit > 0 ? limit - remaining : 0;
  var percent = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;

  var level = "level-ok";
  if (percent >= 90) {
    level = "level-danger";
  } else if (percent >= 70) {
    level = "level-warning";
  }

  var resetHtml = "";
  if (pair.resetKey && pair.resetValue !== null && pair.resetValue !== undefined) {
    resetHtml = `<div class="ai-check-status-limit-reset">Resets in ${escapeHtml(_formatLimitValue(pair.resetKey, pair.resetValue))}</div>`;
  }

  return `<div class="ai-check-status-limit-group">
    <div class="ai-check-status-limit-header">
      <span class="ai-check-status-limit-title">${escapeHtml(pair.label)}</span>
      <span class="ai-check-status-limit-values">${escapeHtml(String(remaining))} / ${escapeHtml(String(limit))} remaining</span>
    </div>
    <div class="ai-check-status-progress-track">
      <div class="ai-check-status-progress-fill ${level}" data-percent="${percent}"></div>
    </div>
    ${resetHtml}
  </div>`;
}

/**
 * Renders any rate-limit fields that were not matched into a limit/remaining
 * pair by _extractLimitPairs() (e.g. provider-specific extras), as simple
 * label/value cards in the two-column grid.
 * @param {object} limits
 * @param {{ limitKey: string, remainingKey: string, resetKey: string|null }[]} pairs
 * @returns {string}
 */
function _renderLeftoverLimitCards(limits, pairs) {
  var consumed = {};
  pairs.forEach(function (p) {
    consumed[p.limitKey] = true;
    consumed[p.remainingKey] = true;
    if (p.resetKey) {
      consumed[p.resetKey] = true;
    }
  });

  var leftoverKeys = Object.keys(limits).filter(function (key) {
    return limits[key] !== null && limits[key] !== undefined && !consumed[key];
  });

  if (!leftoverKeys.length) {
    return "";
  }

  var cards = leftoverKeys
    .map(function (key) {
      return `<div class="ai-check-status-card">
        <span class="ai-check-status-card-label">${escapeHtml(_humanizeLimitKey(key))}</span>
        <span class="ai-check-status-card-value">${escapeHtml(_formatLimitValue(key, limits[key]))}</span>
      </div>`;
    })
    .join("");

  return `<div class="ai-check-status-grid">${cards}</div>`;
}

/**
 * Returns the inner content HTML based on current aiCheckStatusState.
 * @returns {string}
 */
function _renderAiCheckStatusContent() {
  if (aiCheckStatusState.loading) {
    var label = aiCheckStatusState.mode === "rateLimits" ? "Checking rate limits…" : "Checking connection…";
    return `<div class="ai-explain-loading">
      <div class="ai-explain-spinner"></div>
      <span>${label}</span>
    </div>`;
  }

  if (aiCheckStatusState.error) {
    return `<div class="ai-explain-error">
      <span>${icons.circleX}</span>
      <span>${escapeHtml(aiCheckStatusState.error)}</span>
    </div>`;
  }

  var result = aiCheckStatusState.result;
  if (!result) {
    return "";
  }

  // Rate limits: provider does not support proactive checks — show a link instead.
  if (aiCheckStatusState.mode === "rateLimits" && result.supported === false) {
    return `<div class="ai-check-status-unsupported-card">
      <span>${icons.exclamationTriangle} ${escapeHtml(result.serviceName)} does not provide a way to check the rate limits.</span>
      <span class="ai-check-status-unsupported-hint">To check rate limits, visit their link below:</span>
      <a class="ai-check-status-link-btn" id="btn-ai-check-status-open-url" data-url="${escapeAttr(result.rateLimitsUrl)}" href="#" data-tooltip="Open ${escapeAttr(result.rateLimitsUrl)} in browser">
        ${icons.externalLink} ${escapeHtml(result.rateLimitsUrl)}
      </a>
    </div>`;
  }

  // Connection check success
  if (aiCheckStatusState.mode === "connection") {
    return `<div class="d-grid gap-6">
      <div class="ai-check-status-banner ok">
        ${icons.checkboxOk} Connection successful
      </div>
      <div class="ai-check-status-grid">
        <div class="ai-check-status-card">
          <span class="ai-check-status-card-label">Provider</span>
          <span class="ai-check-status-card-value">${escapeHtml(result.serviceName)}</span>
        </div>
        <div class="ai-check-status-card">
          <span class="ai-check-status-card-label">Model</span>
          <span class="ai-check-status-card-value">${escapeHtml(result.modelId)}</span>
        </div>
        <div class="ai-check-status-card ai-check-status-card-full">
          <span class="ai-check-status-card-label">Response Time</span>
          <span class="ai-check-status-card-value">${escapeHtml(String(result.responseTimeMs))} ms</span>
        </div>
      </div>
    </div>`;
  }

  // Rate limits check success (supported provider)
  var limits = result.limits || {};
  var pairs = _extractLimitPairs(limits);
  var barsHtml = pairs.map(_renderLimitBar).join("");
  var leftoverHtml = _renderLeftoverLimitCards(limits, pairs);

  return `<div class="d-grid gap-6">
    <div class="ai-check-status-grid">
      <div class="ai-check-status-card">
        <span class="ai-check-status-card-label">Provider</span>
        <span class="ai-check-status-card-value">${escapeHtml(result.serviceName)}</span>
      </div>
      <div class="ai-check-status-card">
        <span class="ai-check-status-card-label">Model</span>
        <span class="ai-check-status-card-value">${escapeHtml(result.modelId)}</span>
      </div>
    </div>
    ${barsHtml}
    ${leftoverHtml}
    <div class="ai-SecretStorage-note">Note: rate limits depend on your account tier and model usage.</div>
  </div>`;
}

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * Binds the close button and backdrop-click for the modal shell (called once, on inject).
 */
function _bindAiCheckStatusEvents() {
  var overlay = document.getElementById("ai-check-status-overlay");
  if (!overlay) {
    return;
  }

  var closeBtn = document.getElementById("btn-ai-check-status-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      closeAiCheckStatusModal();
    });
  }

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) {
      closeAiCheckStatusModal();
    }
  });

  document.addEventListener("keydown", _onAiCheckStatusEscKey);

  _bindAiCheckStatusContentEvents();
}

/**
 * Binds events inside the content area only (called after every repaint,
 * since the content HTML is replaced each time).
 */
function _bindAiCheckStatusContentEvents() {
  var openUrlLink = document.getElementById("btn-ai-check-status-open-url");
  if (openUrlLink) {
    openUrlLink.addEventListener("click", function (e) {
      e.preventDefault();
      var url = openUrlLink.dataset.url;
      if (url) {
        vscode.postMessage({ type: "openExternalUrl", payload: { url } });
      }
    });
  }

  // Progress bar fill percentage is computed at runtime — apply it as a CSS
  // custom property (the only permitted use of inline style.setProperty).
  document.querySelectorAll(".ai-check-status-progress-fill[data-percent]").forEach(function (fillEl) {
    fillEl.style.setProperty("--limit-percent", fillEl.dataset.percent + "%");
  });
}

function _onAiCheckStatusEscKey(e) {
  if (e.key === "Escape" && aiCheckStatusState.visible) {
    closeAiCheckStatusModal();
  }
}

/**
 * Called by messages.js when aiCheckConnectionResult arrives.
 * @param {{ success: boolean, providerName?: string, serviceName?: string, modelId?: string, responseTimeMs?: number, message?: string }} payload
 */
function handleAiCheckConnectionResult(payload) {
  if (!aiCheckStatusState.visible || aiCheckStatusState.mode !== "connection") {
    return;
  }
  aiCheckStatusState.loading = false;

  if (payload && payload.success) {
    aiCheckStatusState.result = payload;
    aiCheckStatusState.error = "";
  } else {
    aiCheckStatusState.result = null;
    aiCheckStatusState.error = payload && payload.message ? payload.message : "An unexpected error occurred.";
  }

  _repaintAiCheckStatusContent();
}

/**
 * Called by messages.js when aiCheckRateLimitsResult arrives.
 * @param {{ success: boolean, supported?: boolean, providerName?: string, serviceName?: string, modelId?: string, limits?: object, rateLimitsUrl?: string, message?: string }} payload
 */
function handleAiCheckRateLimitsResult(payload) {
  if (!aiCheckStatusState.visible || aiCheckStatusState.mode !== "rateLimits") {
    return;
  }
  aiCheckStatusState.loading = false;

  if (payload && payload.success) {
    aiCheckStatusState.result = payload;
    aiCheckStatusState.error = "";
  } else {
    aiCheckStatusState.result = null;
    aiCheckStatusState.error = payload && payload.message ? payload.message : "An unexpected error occurred.";
  }

  _repaintAiCheckStatusContent();
}
