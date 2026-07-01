/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/main.js
// Entry point — global helpers, tooltip IIFE, and initialization signal.
// All state, icons, utilities, modals, tabs, render, and messages are loaded
// by earlier <script> tags. This file is loaded last.

// Disable right-click context menu unless text is selected
document.addEventListener("contextmenu", function (e) {
  // Allow native context menu on text input elements (paste/cut/copy)
  const tag = e.target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || e.target.isContentEditable) {
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.toString().trim() === "") {
    e.preventDefault();
  }
});

// ===== VS Code-style Tooltip =====
(function () {
  let _hoverEl = null;
  let _showTimer = null;
  const DELAY = 550; // ms — same feel as VS Code
  const GAP = 6; // px — gap between element and tooltip

  function getOrCreateTooltip() {
    if (!_hoverEl) {
      _hoverEl = document.createElement("div");
      _hoverEl.className = "tr-tooltip-hover";
      _hoverEl.setAttribute("role", "tooltip");
    }
    return _hoverEl;
  }

  function positionTooltip(el) {
    const tip = getOrCreateTooltip();
    const pos = el.dataset.tooltipPos || "bottom";

    // Temporarily attach (hidden) to measure dimensions
    tip.style.setProperty("--tr-tooltip-visibility", "hidden");
    tip.style.setProperty("--tr-tooltip-left", "0px");
    tip.style.setProperty("--tr-tooltip-top", "0px");
    if (!tip.isConnected) document.body.appendChild(tip);

    const rect = el.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;

    let left, top;

    if (pos === "top") {
      left = rect.left + rect.width / 2 - tw / 2;
      top = rect.top - th - GAP;
    } else if (pos === "right") {
      left = rect.right + GAP;
      top = rect.top + rect.height / 2 - th / 2;
    } else if (pos === "left") {
      left = rect.left - tw - GAP;
      top = rect.top + rect.height / 2 - th / 2;
    } else {
      // bottom (default)
      left = rect.left + rect.width / 2 - tw / 2;
      top = rect.bottom + GAP;
    }

    // Clamp to viewport so it doesn't go off-screen
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    left = Math.max(GAP, Math.min(left, vw - tw - GAP));
    top = Math.max(GAP, Math.min(top, vh - th - GAP));

    tip.style.setProperty("--tr-tooltip-left", left + "px");
    tip.style.setProperty("--tr-tooltip-top", top + "px");
    tip.dataset.pos = pos; // used by CSS to show the correct arrow direction
    tip.style.setProperty("--tr-tooltip-visibility", "");
  }

  function showTooltip(el) {
    const tip = getOrCreateTooltip();
    const header = el.dataset.tooltipHeader || "";
    const body = el.dataset.tooltip || "";
    const footer = el.dataset.tooltipFooter || "";

    var html = "";
    if (header) html += '<div class="tr-tooltip-header">' + header + "</div>";
    if (body) html += '<div class="tr-tooltip-body">' + body + "</div>";
    if (footer) {
      if (body || header) html += '<div class="tr-tooltip-divider"></div>';
      html += '<div class="tr-tooltip-footer">' + footer + "</div>";
    }
    tip.innerHTML = html;
    positionTooltip(el);
  }

  function hideTooltip() {
    clearTimeout(_showTimer);
    _showTimer = null;
    _hoverEl?.remove();
  }

  document.addEventListener("mouseover", function (e) {
    const el = e.target.closest("[data-tooltip]");
    if (!el) return;

    // Cancel any pending show for a different element
    clearTimeout(_showTimer);

    _showTimer = setTimeout(function () {
      showTooltip(el);
    }, DELAY);
  });

  document.addEventListener("mouseout", function (e) {
    const fromEl = e.target.closest("[data-tooltip]");
    const toEl = e.relatedTarget?.closest("[data-tooltip]");

    // Mouse stayed within tooltip-owning elements — do nothing
    if (fromEl && toEl && fromEl === toEl) return;

    hideTooltip();
  });

  // Hide immediately on any click/tap — before any handler fires
  document.addEventListener("pointerdown", function () {
    hideTooltip();
  });
})();

// ─── Initialization ────────────────────────────────────────────────────────────
// Signal the extension that the webview is ready to receive state.
vscode.postMessage({ type: "ready" });
