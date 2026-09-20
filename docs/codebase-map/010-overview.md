# Project Overview

**RunBox** is a VS Code extension that provides a webview panel for managing and running terminal commands with support for variables, favorites, and AI-generated commands.

Two separate execution contexts:

| Context | Location | Module System |
| - | - | - |
| **Extension Host (Node.js)** | `extension.js` + `lib/` | CommonJS (`require` / `module.exports`) |
| **Webview (Browser)** | `media/` | Plain `<script>` tags — shared `window` global scope |
