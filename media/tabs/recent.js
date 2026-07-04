/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/tabs/recent.js
// "Recent Commands" tab — shows commands ordered by lastRunAt.
// Loads after the modal files.

function renderRecentCommandsTab() {
  const recentCommands = (state.data.commands || [])
    .filter(function (cmd) {
      return cmd.lastRunAt;
    })
    .slice()
    .sort(function (a, b) {
      return new Date(b.lastRunAt) - new Date(a.lastRunAt);
    });

  const totalRuns = recentCommands.reduce(function (sum, cmd) {
    return sum + (cmd.runCount || 0);
  }, 0);

  if (!recentCommands.length) {
    return `
      <section class="card">
        <div class="row between">
          <h2>Recent Commands</h2>
        </div>
        <p class="muted">No recent commands yet. Run or Use a command to see it here.</p>
      </section>
    `;
  }

  return `
    <section class="card">
      <div class="row between">
        <h2>Recent Commands</h2>
        <div class="row">
          <span class="muted total-runs">Total runs: <strong>${totalRuns}</strong></span>
          <button id="btn-clear-recent" class="btn small danger" data-tooltip="Clear all recent command history">Clear Recent</button>
        </div>
      </div>
      <div class="table-wrap recent-commands">
        <table class="cmds-table recent-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Template</th>
              <th>Last Run</th>
              <th>×Runs</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${recentCommands
              .map(function (command) {
                const titleHtml = command.helpUrl
                  ? `<a class="cmd-title-link" data-url="${escapeAttr(command.helpUrl)}" data-tooltip="Open documentation">${escapeHtml(command.title)}</a>`
                  : `<strong>${escapeHtml(command.title)}</strong>`;
                return `
                <tr data-command-id="${escapeAttr(command.id)}"${command.id === uiState.recentSelectedCommandRowId ? ' class="selected-command-row"' : ""}>
                  <td>${titleHtml}</td>
                  <td><pre class="template-cell">${highlightTemplateHtml(command.command)}</pre></td>
                  <td data-tooltip="${escapeAttr(formatDateTime(command.lastRunAt))}">${escapeHtml(timeAgo(command.lastRunAt))}</td>
                  <td><strong>×${command.runCount || 0}</strong></td>
                  <td>
                    ${renderActionsCell(command, { showDelete: false, showEdit: false, showGoto: true, favoriteStyle: "favorite" })}
                  </td>
                </tr>
              `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function bindRecentTabEvents() {
  const clearRecentButton = document.getElementById("btn-clear-recent");

  if (clearRecentButton) {
    clearRecentButton.addEventListener("click", function () {
      deleteConfirmState = {
        type: "clearRecent",
        id: null,
        title: "All recent history will be cleared.",
        template: "",
      };
      render();
    });
  }
}
