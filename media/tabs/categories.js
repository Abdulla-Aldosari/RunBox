/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/tabs/categories.js
// "Categories & Groups" management tab (also hosts the AI Create entry points).
// Loads after variables.js.

// ─── Categories Tab ───────────────────────────────────────────────────────────

/**
 * Renders the Categories & Groups management tab (two-panel layout).
 * @returns {string} HTML string
 */
function renderCategoriesTab() {
  const categories = state.data.categories || [];
  const selectedCategory = getSelectedCategory();
  const selectedGroups = getSelectedCategoryGroups();

  return `
    <section class="card manage-card">
      <div class="manage-layout">

        <!-- Categories Panel -->
        <div class="manage-panel">
          <div class="manage-panel-header">
            <h2 class="manage-panel-title">Categories</h2>
            <div class="row">
              <button class="btn small secondary ai-create-btn" id="btn-create-with-ai" data-tooltip="Generate a full category with groups and commands using AI">${icons.sparkles} Create with AI</button>
              <button class="btn primary small" id="btn-open-add-category-modal" data-tooltip="Add a new category">+ Add New Category</button>
            </div>
          </div>
          <div class="manage-list">
            ${categories.length === 0 ? `<p class="muted manage-empty">No categories yet.</p>` : ""}
            ${categories
              .map(function (category) {
                const isActive = category.id === uiState.selectedCategoryId;
                return `
              <div class="manage-item ${isActive ? "active" : ""}" data-category-id="${escapeAttr(category.id)}">
                <div class="manage-item-info">
                  <span class="manage-item-label">${escapeHtml(category.title)}</span>
                  <code class="manage-item-count">${
                    (state.data.commands || []).filter(function (c) {
                      return c.categoryId === category.id;
                    }).length
                  }</code>
                </div>
                <div class="manage-item-actions">
                  <button class="btn small secondary btn-rename-category" data-category-id="${escapeAttr(category.id)}" data-category-title="${escapeAttr(category.title)}" data-tooltip="Rename category">Rename</button>
                  <button class="btn small danger btn-delete-category" data-category-id="${escapeAttr(category.id)}" data-category-title="${escapeAttr(category.title)}" data-tooltip="Delete category and all its commands">Delete</button>
                </div>
              </div>
            `;
              })
              .join("")}
          </div>
        </div>

        <!-- Groups Panel -->
        <div class="manage-panel">
          <div class="manage-panel-header">
            <h2 class="manage-panel-title">Groups</h2>
            <button class="btn small primary" id="btn-open-add-group-modal" ${selectedCategory ? "" : "disabled"} data-tooltip="${selectedCategory ? "Add a new group to this category" : "Select a category first"}">+ Add New Group</button>
          </div>
          <div class="manage-list">
            ${!selectedCategory ? `<p class="muted manage-empty">Select a category first.</p>` : ""}
            ${selectedCategory && selectedGroups.length === 0 ? `<p class="muted manage-empty">No groups yet.</p>` : ""}
            ${selectedGroups
              .map(function (group) {
                const isActive = group.id === uiState.selectedGroupId;
                return `
              <div class="manage-item ${isActive ? "active" : ""}" data-group-id="${escapeAttr(group.id)}">
                <div class="manage-item-info">
                  <span class="manage-item-label">${escapeHtml(group.title)}</span>
                  <code class="manage-item-count">${
                    (state.data.commands || []).filter(function (c) {
                      return c.categoryId === uiState.selectedCategoryId && c.groupId === group.id;
                    }).length
                  }</code>
                </div>
                <div class="manage-item-actions">
                  <button class="btn small secondary btn-rename-group" data-group-id="${escapeAttr(group.id)}" data-group-title="${escapeAttr(group.title)}" data-tooltip="Rename group">Rename</button>
                  <button class="btn small danger btn-delete-group" data-group-id="${escapeAttr(group.id)}" data-group-title="${escapeAttr(group.title)}" data-tooltip="Delete group">Delete</button>
                </div>
              </div>
            `;
              })
              .join("")}
          </div>
        </div>

      </div>
    </section>
    ${renderCategoriesModal()}
  `;
}

/**
 * Renders the inline modal for add/rename category/group actions.
 * Returns empty string if the modal is not currently visible.
 * @returns {string} HTML string
 */
function renderCategoriesModal() {
  if (!categoriesModalState.visible) {
    return "";
  }

  const mode = categoriesModalState.mode;
  let title = "";
  let placeholder = "";
  let btnLabel = "";

  if (mode === "add-category") {
    title = "Add New Category";
    placeholder = "Category name...";
    btnLabel = "Add";
  } else if (mode === "rename-category") {
    title = "Rename Category";
    placeholder = "New name...";
    btnLabel = "Rename";
  } else if (mode === "add-group") {
    title = "Add New Group";
    placeholder = "Group name...";
    btnLabel = "Add";
  } else if (mode === "rename-group") {
    title = "Rename Group";
    placeholder = "New name...";
    btnLabel = "Rename";
  }

  return `
    <div class="modal-overlay" id="categories-modal-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box">
        <h3>${escapeHtml(title)}</h3>
        <input id="manage-modal-input" class="input" placeholder="${escapeAttr(placeholder)}" value="${escapeAttr(categoriesModalState.value)}" autocomplete="off" />
        <div class="row justify-content-flex-end">
          <button class="btn small primary min-w65" id="btn-manage-modal-confirm">${escapeHtml(btnLabel)}</button>
          <button class="btn small secondary action min-w65" id="btn-manage-modal-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function bindCategoriesTabEvents() {
  // --- Category item click (select category) ---
  document.querySelectorAll(".manage-item[data-category-id]").forEach(function (item) {
    item.addEventListener("click", function (e) {
      // Don't trigger selection if a button inside was clicked
      if (e.target.closest("button")) {
        return;
      }

      setSelectedCategory(item.dataset.categoryId);
      uiState.selectedGroupId = "all";
      render();
    });
  });

  // --- Group item click (select group) ---
  document.querySelectorAll(".manage-item[data-group-id]").forEach(function (item) {
    item.addEventListener("click", function (e) {
      if (e.target.closest("button")) {
        return;
      }

      uiState.selectedGroupId = item.dataset.groupId;
      render();
    });
  });

  // --- Open Add Category Modal ---
  const addCategoryBtn = document.getElementById("btn-open-add-category-modal");
  if (addCategoryBtn) {
    addCategoryBtn.addEventListener("click", function () {
      categoriesModalState = { visible: true, mode: "add-category", value: "" };
      render();
      const input = document.getElementById("manage-modal-input");
      if (input) {
        input.focus();
      }
    });
  }

  // --- Open Add Group Modal ---
  const addGroupBtn = document.getElementById("btn-open-add-group-modal");
  if (addGroupBtn) {
    addGroupBtn.addEventListener("click", function () {
      categoriesModalState = { visible: true, mode: "add-group", value: "" };
      render();
      const input = document.getElementById("manage-modal-input");
      if (input) {
        input.focus();
      }
    });
  }

  // --- Rename Category buttons ---
  document.querySelectorAll(".btn-rename-category").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const categoryId = btn.dataset.categoryId;
      const categoryTitle = btn.dataset.categoryTitle;
      setSelectedCategory(categoryId);
      categoriesModalState = {
        visible: true,
        mode: "rename-category",
        value: categoryTitle,
      };
      render();
      const input = document.getElementById("manage-modal-input");
      if (input) {
        input.focus();
        input.select();
      }
    });
  });

  // --- Delete Category buttons ---
  document.querySelectorAll(".btn-delete-category").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const categoryId = btn.dataset.categoryId;
      const categoryTitle = btn.dataset.categoryTitle;
      setSelectedCategory(categoryId);
      deleteConfirmState = {
        type: "category",
        id: categoryId,
        title: categoryTitle,
      };
      render();
    });
  });

  // --- Rename Group buttons ---
  document.querySelectorAll(".btn-rename-group").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const groupId = btn.dataset.groupId;
      const groupTitle = btn.dataset.groupTitle;
      uiState.selectedGroupId = groupId;
      categoriesModalState = {
        visible: true,
        mode: "rename-group",
        value: groupTitle,
      };
      render();
      const input = document.getElementById("manage-modal-input");
      if (input) {
        input.focus();
        input.select();
      }
    });
  });

  // --- Delete Group buttons ---
  document.querySelectorAll(".btn-delete-group").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const groupId = btn.dataset.groupId;
      const groupTitle = btn.dataset.groupTitle;
      uiState.selectedGroupId = groupId;
      deleteConfirmState = {
        type: "group",
        id: groupId,
        title: groupTitle,
      };
      render();
    });
  });

  // --- Modal Confirm ---
  const modalConfirmBtn = document.getElementById("btn-manage-modal-confirm");
  if (modalConfirmBtn) {
    modalConfirmBtn.addEventListener("click", function () {
      executeManageModalConfirm();
    });
  }

  // --- Modal Cancel ---
  const modalCancelBtn = document.getElementById("btn-manage-modal-cancel");
  if (modalCancelBtn) {
    modalCancelBtn.addEventListener("click", function () {
      categoriesModalState = { visible: false, mode: null, value: "" };
      render();
    });
  }

  // --- Modal Input: confirm on Enter ---
  const modalInput = document.getElementById("manage-modal-input");
  if (modalInput) {
    modalInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        executeManageModalConfirm();
      }
      if (e.key === "Escape") {
        categoriesModalState = { visible: false, mode: null, value: "" };
        render();
      }
    });
  }
}

function executeManageModalConfirm() {
  const input = document.getElementById("manage-modal-input");
  const value = input ? input.value.trim() : "";
  const mode = categoriesModalState.mode;

  if (!value) {
    showNotice("Name is required.", icons.exclamationTriangle, "warning");
    if (input) {
      input.focus();
    }
    return;
  }

  if (mode === "add-category") {
    const newCategory = {
      id: generateEntityId("cat"),
      title: value,
      groups: [],
    };
    state.data.categories.push(newCategory);
    setSelectedCategory(newCategory.id);
    uiState.selectedGroupId = "all";
    categoriesModalState = { visible: false, mode: null, value: "" };
    persistDataThenRender("Category added.");
    return;
  }

  if (mode === "rename-category") {
    const category = getSelectedCategory();
    if (category) {
      category.title = value;
    }
    categoriesModalState = { visible: false, mode: null, value: "" };
    persistDataThenRender("Category renamed.");
    return;
  }

  if (mode === "add-group") {
    const selectedCategory = getSelectedCategory();
    if (!selectedCategory) {
      showNotice("Select a category first.", icons.exclamationTriangle, "warning");
      return;
    }
    const newGroup = {
      id: generateEntityId("grp"),
      title: value,
    };
    selectedCategory.groups = selectedCategory.groups || [];
    selectedCategory.groups.push(newGroup);
    uiState.selectedGroupId = newGroup.id;
    categoriesModalState = { visible: false, mode: null, value: "" };
    persistDataThenRender("Group added.");
    return;
  }

  if (mode === "rename-group") {
    const selectedCategory = getSelectedCategory();
    if (!selectedCategory) {
      return;
    }
    const group = (selectedCategory.groups || []).find(function (g) {
      return g.id === uiState.selectedGroupId;
    });
    if (group) {
      group.title = value;
    }
    categoriesModalState = { visible: false, mode: null, value: "" };
    persistDataThenRender("Group renamed.");
    return;
  }
}
