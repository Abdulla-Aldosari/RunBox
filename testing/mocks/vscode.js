/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/mocks/vscode.js
// Minimal mock of the VS Code API used by lib/ modules.
// Injected by test files before requiring any lib/ module that depends on "vscode".
// Only surfaces the shapes used by storage.js, terminal.js, and handlers.js —
// no real functionality, just enough to satisfy require() without crashing.

const vscode = {
  workspace: {
    workspaceFolders: null,
    getConfiguration: function () {
      return {
        get: function () {
          return undefined;
        },
      };
    },
  },
  window: {
    activeTerminal: null,
    createTerminal: function () {
      return {};
    },
    showInputBox: async function () {
      return undefined;
    },
    showInformationMessage: async function () {
      return undefined;
    },
    showWarningMessage: async function () {
      return undefined;
    },
    showErrorMessage: async function () {
      return undefined;
    },
  },
  env: {
    openExternal: async function () {},
  },
  Uri: {
    file: function (p) {
      return { fsPath: p };
    },
    joinPath: function (base, ...parts) {
      const path = require("path");
      return { fsPath: path.join(base.fsPath || base, ...parts) };
    },
  },
  commands: {
    executeCommand: async function () {},
  },
  SecretStorage: class {
    async get() {
      return undefined;
    }
    async store() {}
    async delete() {}
  },
};

module.exports = vscode;
