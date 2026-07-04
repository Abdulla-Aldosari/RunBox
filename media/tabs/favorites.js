/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/tabs/favorites.js
// "Favorites" tab — global and workspace favorites lists.
// Loads after commands.js.

// Renders the Favorites tab.
function renderFavoritesTab() {
  const hasWorkspace = !!state.workspaceFolder;
  const scope = uiState.favoritesScope;
  const allCommands = state.data.commands || [];
  const favoriteIds = scope === "local" ? state.localFavorites : state.globalFavorites;
  const favoritedCommands = allCommands.filter(function (cmd) {
    return favoriteIds.includes(cmd.id);
  });
  const validLocalCount = state.localFavorites.filter(function (id) {
    return allCommands.some(function (cmd) {
      return cmd.id === id;
    });
  }).length;
  const validGlobalCount = state.globalFavorites.filter(function (id) {
    return allCommands.some(function (cmd) {
      return cmd.id === id;
    });
  }).length;
  const emptyMsg =
    scope === "local"
      ? "No local favorites for this workspace yet. Click the star icon on any command to add it."
      : "No global favorites yet. Click the star icon on any command to add it.";

  let skipConfirm = false;
  try {
    skipConfirm = localStorage.getItem("unfav_confirm_skip") === "1";
  } catch {}

  const showWrap = hasWorkspace || skipConfirm;

  return `
    <section class="card">
      ${showWrap ? renderFavoritesScopeToggle(scope, hasWorkspace, skipConfirm, validLocalCount, validGlobalCount) : ""}
      <div class="table-wrap">
        ${favoritedCommands.length === 0 ? `<p class="muted">${emptyMsg}</p>` : renderFavoritesTable(favoritedCommands)}
      </div>
    </section>
  `;
}

/**
 * Renders the big scope toggle (Local Workspace / Global) for the Favorites tab.
 * @param {string} scope - current favorites scope ('local' | 'global')
 * @param {boolean} showToggle - whether to show the scope toggle (requires workspace)
 * @param {boolean} skipConfirm - whether to show the restore confirmation link
 */
function renderFavoritesScopeToggle(scope, showToggle, skipConfirm, validLocalCount, validGlobalCount) {
  return `
    <div class="fav-scope-toggle-wrap">
      ${
        showToggle
          ? `
      <div class="fav-scope-toggle-section">
        <div class="fav-scope-toggle">
          <button class="fav-scope-btn d-focus ${scope === "local" ? "active" : ""}" data-scope="local" data-tooltip="Show favorites for this workspace only">Local Workspace (${validLocalCount})</button>
          <button class="fav-scope-btn d-focus ${scope === "global" ? "active" : ""}" data-scope="global" data-tooltip="Show favorites available in all workspaces">Global (${validGlobalCount})</button>
        </div>
        <span class="muted fav-scope-hint">${scope === "local" ? escapeHtml(state.workspaceFolder || "") : "Available everywhere"}</span>
      </div>`
          : `<p class="muted margin-block-0">Showing only global favorites, as no workspace is currently open.</p>`
      }
      ${skipConfirm ? `<p class="muted margin-block-0">Removal confirmations are disabled. <a href="#" id="btn-restore-unfav-confirm" data-tooltip="Re-enable the confirmation dialog when removing from favorites">Restore</a></p>` : ""}
    </div>
  `;
}

/**
 * Renders the favorites table (Title, Template, Actions).
 * Uses icons.heartMinus for the remove button.
 */
function renderFavoritesTable(commands) {
  return `
    <table class="cmds-table favorites-table main-table">
      <thead>
        <tr>
          <th class="main-t-title-column">Title</th>
          <th class="main-t-description-column">Description</th>
          <th class="main-t-template-column">Template</th>
          <th class="main-t-groups-column">Cat/Group</th>
          <th class="main-t-action-column">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${commands
          .map(function (command) {
            const titleHtml = command.helpUrl
              ? `<a class="cmd-title-link" data-url="${escapeAttr(command.helpUrl)}" data-tooltip="Open documentation">${escapeHtml(command.title)}</a>`
              : `<strong>${escapeHtml(command.title)}</strong>`;
            const _cat = (state.data.categories || []).find(function (c) {
              return c.id === command.categoryId;
            });
            const _catTitle = _cat ? _cat.title || "" : "";
            const _groups = _cat ? _cat.groups || [] : [];
            const _groupTitle = resolveGroupTitle(command.groupId || "", _groups);
            const _hasGroup = !!_groupTitle && _groupTitle !== "-";
            const _catGroupLabel =
              _catTitle && _hasGroup
                ? `${_catTitle} / ${_groupTitle}`
                : _catTitle || (_hasGroup ? _groupTitle : "") || "-";
            return `
            <tr data-command-id="${escapeAttr(command.id)}"${command.id === uiState.favoritesSelectedCommandRowId ? ' class="selected-command-row"' : ""}>
              <td class="main-t-title-column">${titleHtml}<br><span class="muted">${escapeHtml(command.id)}</span></td>
              <td class="main-t-description-column">${escapeHtml(command.description || "-")}</td>
              <td class="main-t-template-column"><pre class="template-cell">${highlightTemplateHtml(command.command)}</pre></td>
              <td class="main-t-groups-column">${escapeHtml(_catGroupLabel)}</td>
              <td class="main-t-action-column">
                ${renderActionsCell(command, { showDelete: false, showEdit: false, showGoto: true, favoriteStyle: "unfavorite" })}
              </td>
            </tr>
          `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

/**
 * Renders the unified Favorite modal (manage favorites: add/remove/toggle local+global).
 * opened from Commands/Recent tabs and from Favorites tab CTRL+click.
 */
function renderFavoriteModal() {
  const s = favoriteModalState;
  const hasWorkspace = !!state.workspaceFolder;
  const command = (state.data.commands || []).find(function (c) {
    return c.id === s.commandId;
  });
  const cmdTitle = command ? command.title : "";
  const noneSelected = !s.selectedLocal && !s.selectedGlobal;
  // Only show warning/Unfavorite if command was already in at least one favorites list
  const wasInFavorites = isInFavorites(s.commandId);

  return `
    <div class="modal-overlay" id="favorite-modal-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box">
        <h3>${icons.heartPlus} Manage Favorites</h3>
        <p class="delete-confirm-command-name">${escapeHtml(cmdTitle)}</p>
        <p class="modal-description">Select where to save this command as a favorite:</p>
        <div class="fav-modal-tags">
          ${hasWorkspace ? `<button class="tag d-focus fav-modal-tag ${s.selectedLocal ? "active" : ""}" data-scope="local" data-tooltip="Save for this workspace only">Local Workspace</button>` : ""}
          <button class="tag d-focus fav-modal-tag ${s.selectedGlobal ? "active" : ""}" data-scope="global" data-tooltip="Save for all workspaces">Global</button>
        </div>
        ${wasInFavorites && noneSelected ? `<p class="modal-description fav-modal-hint">No selection — clicking Save will remove from all favorites.</p>` : ""}
        <div class="row between mt-20">
          ${wasInFavorites ? `<button class="btn small danger" id="btn-fav-unfavorite-all" data-tooltip="Remove from all favorites immediately">Unfavorite</button>` : "<span></span>"}
          <div class="row">
            <button class="btn small primary min-w65" id="btn-fav-save">Save</button>
            <button class="btn small secondary action min-w65" id="btn-fav-cancel">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Renders the unfavorite confirm modal (normal click on btn-unfavorite in Favorites tab).
 */
function renderUnfavoriteConfirmModal() {
  if (!unfavoriteConfirmState.visible) {
    return "";
  }
  const s = unfavoriteConfirmState;
  const command = (state.data.commands || []).find(function (c) {
    return c.id === s.commandId;
  });
  const cmdTitle = command ? command.title : "";
  const scopeLabel = s.scope === "local" ? "Local Workspace" : "Global";
  let skipConfirm = false;
  try {
    skipConfirm = localStorage.getItem("unfav_confirm_skip") === "1";
  } catch {}

  return `
    <div class="modal-overlay" id="unfav-confirm-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box">
        <h3>Remove from Favorites</h3>
        <p class="modal-description">Remove from <strong>"${escapeHtml(scopeLabel)}"</strong> favorites?</p>
        <p class="delete-confirm-command-name">${escapeHtml(cmdTitle)}</p>
        <label class="fav-dont-show-wrap">
          <input type="checkbox" id="unfav-dont-show-again" ${skipConfirm ? "checked" : ""} />
          Don't show this message again
        </label>
        <div class="row justify-content-flex-end mt-20">
          <button class="btn small danger min-w65" id="btn-unfav-confirm-remove">Remove</button>
          <button class="btn small secondary action min-w65" id="btn-unfav-confirm-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Binds events for the Favorites tab (scope toggle + unfavorite buttons).
 */
function bindFavoritesTabEvents() {
  // Scope toggle buttons
  document.querySelectorAll(".fav-scope-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const scope = btn.dataset.scope;
      uiState.favoritesScope = scope;
      try {
        localStorage.setItem("favoritesScope", scope);
      } catch {}
      render();
    });
  });

  // Unfavorite buttons (iconHeartMinus)
  document.querySelectorAll(".btn-unfavorite").forEach(function (button) {
    button.addEventListener("click", function (e) {
      const commandId = button.dataset.commandId;
      const scope = uiState.favoritesScope;

      if (e.ctrlKey) {
        // CTRL+click → open unified manage modal with current state pre-filled
        favoriteModalState = {
          visible: true,
          commandId,
          selectedLocal: state.localFavorites.includes(commandId),
          selectedGlobal: state.globalFavorites.includes(commandId),
        };
        render();
        return;
      }

      // Normal click: check "Don't show again" setting
      let skipConfirm = false;
      try {
        skipConfirm = localStorage.getItem("unfav_confirm_skip") === "1";
      } catch {}

      if (skipConfirm) {
        // Remove directly
        if (scope === "local") {
          const newLocal = state.localFavorites.filter(function (id) {
            return id !== commandId;
          });
          state.localFavorites = newLocal;
          persistFavorites({ local: newLocal });
          showNotice("Removed from Local Workspace Favorites.", icons.heartMinus, "info");
        } else {
          const newGlobal = state.globalFavorites.filter(function (id) {
            return id !== commandId;
          });
          state.globalFavorites = newGlobal;
          persistFavorites({ global: newGlobal });
          showNotice("Removed from Global Favorites.", icons.heartMinus, "info");
        }
        render();
      } else {
        // Show confirm modal
        unfavoriteConfirmState = { visible: true, commandId, scope };
        render();
      }
    });
  });

  // Restore unfav confirmation dialog
  const restoreUnfavConfirmBtn = document.getElementById("btn-restore-unfav-confirm");
  if (restoreUnfavConfirmBtn) {
    restoreUnfavConfirmBtn.addEventListener("click", function (e) {
      e.preventDefault();
      try {
        localStorage.removeItem("unfav_confirm_skip");
      } catch {}
      render();
    });
  }

  bindUnfavoriteConfirmEvents();
}

/**
 * Binds events for the unified Favorite modal (tag-style selection).
 */
function bindFavoriteModalEvents() {
  // Tag toggle buttons (Local Workspace / Global)
  document.querySelectorAll(".fav-modal-tag").forEach(function (tag) {
    tag.addEventListener("click", function () {
      const scope = tag.dataset.scope;
      if (scope === "local") {
        favoriteModalState.selectedLocal = !favoriteModalState.selectedLocal;
      } else if (scope === "global") {
        favoriteModalState.selectedGlobal = !favoriteModalState.selectedGlobal;
      }
      render();
    });
  });

  // Unfavorite All button → remove from ALL favorites
  const unfavAllBtn = document.getElementById("btn-fav-unfavorite-all");
  if (unfavAllBtn) {
    unfavAllBtn.addEventListener("click", function () {
      const commandId = favoriteModalState.commandId;
      if (commandId) {
        const newGlobal = state.globalFavorites.filter(function (id) {
          return id !== commandId;
        });
        const newLocal = state.localFavorites.filter(function (id) {
          return id !== commandId;
        });
        state.globalFavorites = newGlobal;
        state.localFavorites = newLocal;
        persistFavorites({ global: newGlobal, local: newLocal });
        showNotice("Removed from all favorites.", icons.heartMinus, "info");
      }
      favoriteModalState = {
        visible: false,
        commandId: null,
        selectedLocal: false,
        selectedGlobal: false,
      };
      render();
    });
  }

  // Save button → apply tag selection
  const saveBtn = document.getElementById("btn-fav-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      const commandId = favoriteModalState.commandId;
      const wantLocal = favoriteModalState.selectedLocal;
      const wantGlobal = favoriteModalState.selectedGlobal;

      if (commandId) {
        // Apply global
        let newGlobal;
        if (wantGlobal && !state.globalFavorites.includes(commandId)) {
          newGlobal = state.globalFavorites.concat([commandId]);
        } else if (!wantGlobal && state.globalFavorites.includes(commandId)) {
          newGlobal = state.globalFavorites.filter(function (id) {
            return id !== commandId;
          });
        } else {
          newGlobal = state.globalFavorites;
        }

        // Apply local
        let newLocal;
        if (wantLocal && !state.localFavorites.includes(commandId)) {
          newLocal = state.localFavorites.concat([commandId]);
        } else if (!wantLocal && state.localFavorites.includes(commandId)) {
          newLocal = state.localFavorites.filter(function (id) {
            return id !== commandId;
          });
        } else {
          newLocal = state.localFavorites;
        }

        state.globalFavorites = newGlobal;
        state.localFavorites = newLocal;
        persistFavorites({ global: newGlobal, local: newLocal });

        if (!wantGlobal && !wantLocal) {
          showNotice("Removed from all favorites.", icons.heartMinus, "info");
        } else if (wantGlobal && wantLocal) {
          showNotice("Saved to Local & Global Favorites.", icons.heartPlus, "success");
        } else if (wantGlobal) {
          showNotice("Saved to Global Favorites.", icons.heartPlus, "success");
        } else {
          showNotice("Saved to Local Favorites.", icons.heartPlus, "success");
        }
      }

      favoriteModalState = {
        visible: false,
        commandId: null,
        selectedLocal: false,
        selectedGlobal: false,
      };
      render();
    });
  }

  // Cancel button
  const cancelBtn = document.getElementById("btn-fav-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", function () {
      favoriteModalState = {
        visible: false,
        commandId: null,
        selectedLocal: false,
        selectedGlobal: false,
      };
      render();
    });
  }

  // Flash on outside click (modal stays)
  const overlay = document.getElementById("favorite-modal-overlay");
  if (overlay) {
    overlay.addEventListener("pointerdown", function (e) {
      if (e.target === overlay) {
        var box = overlay.querySelector(".modal-box");
        if (box) {
          box.classList.remove("modal-box-flash");
          void box.offsetWidth;
          box.classList.add("modal-box-flash");
          box.addEventListener(
            "animationend",
            function () {
              box.classList.remove("modal-box-flash");
            },
            { once: true }
          );
        }
      }
    });
  }
}

/**
 * Binds events for the unfavorite confirm modal.
 */
function bindUnfavoriteConfirmEvents() {
  const removeBtn = document.getElementById("btn-unfav-confirm-remove");
  if (removeBtn) {
    removeBtn.addEventListener("click", function () {
      const commandId = unfavoriteConfirmState.commandId;
      const scope = unfavoriteConfirmState.scope;

      // Save "don't show again" preference
      const checkbox = document.getElementById("unfav-dont-show-again");
      if (checkbox && checkbox.checked) {
        try {
          localStorage.setItem("unfav_confirm_skip", "1");
        } catch {}
      }

      // Remove from scope
      if (scope === "local") {
        const newLocal = state.localFavorites.filter(function (id) {
          return id !== commandId;
        });
        state.localFavorites = newLocal;
        persistFavorites({ local: newLocal });
      } else {
        const newGlobal = state.globalFavorites.filter(function (id) {
          return id !== commandId;
        });
        state.globalFavorites = newGlobal;
        persistFavorites({ global: newGlobal });
      }

      unfavoriteConfirmState = { visible: false, commandId: null, scope: null };
      showNotice("Removed from Favorites.", icons.heartMinus, "info");
      render();
    });
  }

  const cancelBtn = document.getElementById("btn-unfav-confirm-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", function () {
      unfavoriteConfirmState = { visible: false, commandId: null, scope: null };
      render();
    });
  }

  // Flash on outside click
  const overlay = document.getElementById("unfav-confirm-overlay");
  if (overlay) {
    overlay.addEventListener("pointerdown", function (e) {
      if (e.target === overlay) {
        var box = overlay.querySelector(".modal-box");
        if (box) {
          box.classList.remove("modal-box-flash");
          void box.offsetWidth;
          box.classList.add("modal-box-flash");
          box.addEventListener(
            "animationend",
            function () {
              box.classList.remove("modal-box-flash");
            },
            { once: true }
          );
        }
      }
    });
  }
}
