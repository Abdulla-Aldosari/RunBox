/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/connection-watchdog.js
// Independent heartbeat that detects a silently dropped extension host connection
// (e.g. after the computer resumes from sleep, after an extension update, or after
// an unexpected host restart) and surfaces a "Service connection lost" modal to the user.
//
// Deliberately independent of all business message traffic (saveData, performAction,
// etc.) — see the proposal doc for why coupling the detector to business replies
// produced false positives in a previous attempt. This file only ever sends "ping"
// and only ever listens for "pong".
//
// Loads after media/utils.js (only depends on `icons` and `vscode`, both already
// defined earlier) and before the modal files.

const CONNECTION_WATCHDOG_PING_INTERVAL_MS = 10000;
const CONNECTION_WATCHDOG_PONG_TIMEOUT_MS = 5000;

let connectionLost = false;
let connectionWatchdogPongTimer = null;

function sendConnectionWatchdogPing() {
  vscode.postMessage({ type: "ping" });

  clearTimeout(connectionWatchdogPongTimer);
  connectionWatchdogPongTimer = setTimeout(function () {
    if (!connectionLost) {
      connectionLost = true;
      render();
    }
  }, CONNECTION_WATCHDOG_PONG_TIMEOUT_MS);
}

setInterval(sendConnectionWatchdogPing, CONNECTION_WATCHDOG_PING_INTERVAL_MS);

window.addEventListener("message", function (event) {
  const message = event.data;

  if (!message || message.type !== "pong") {
    return;
  }

  clearTimeout(connectionWatchdogPongTimer);
  connectionWatchdogPongTimer = null;

  if (connectionLost) {
    connectionLost = false;
    render();
  }
});

/**
 * Renders the "Service connection lost" modal overlay, or "" when the connection is healthy.
 * Has no close/Cancel button and does not dismiss on outside click — it can only be
 * cleared by a successful "pong", since any button here would itself depend on the
 * broken postMessage channel.
 * @returns {string}
 */
function renderConnectionLostModal() {
  if (!connectionLost) {
    return "";
  }

  return `
    <div class="modal-overlay" id="connection-lost-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box connection-lost-box">
        <div class="connection-lost-icon">${icons.noConnectToHost}</div>
        <h3>Service connection lost</h3>
        <p>RunBox service stopped. Close this panel and open it again to restore the service.</p>
      </div>
    </div>
  `;
}
