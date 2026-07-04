# Changelog

All notable changes to **RunBox** are documented here.<br>
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### 🚀 What's New

- _(ai)_ Add AI connection and rate limits checks([`d4c2cb1`](https://github.com/Abdulla-Aldosari/runbox/commit/d4c2cb188964700cf1ede9fa496348442b75e08f))
- _(ai-generate)_ Tag AI-generated commands with targetShell([`cc61f7c`](https://github.com/Abdulla-Aldosari/runbox/commit/cc61f7c0a51b4594368ce278fbbc1994e9057a08))
- _(commands)_ Add target shell selection to commands([`ef00484`](https://github.com/Abdulla-Aldosari/runbox/commit/ef0048452a53555077db992a39269dd7468b30c0))
- _(edit-command)_ Auto-transfer variable values on rename([`c8888e8`](https://github.com/Abdulla-Aldosari/runbox/commit/c8888e8b981f6718771611687d1f1f3eaec9aaa4))
- _(storage)_ Unify variables and favorites into one data file([`c755492`](https://github.com/Abdulla-Aldosari/runbox/commit/c7554927169f175dc4cb908636074bef51dfee49))
- _(storage)_ Allow custom path for local workspace files([`a39fa9e`](https://github.com/Abdulla-Aldosari/runbox/commit/a39fa9e6d51561159819ff9799874ba1e6a225b3))
- _(webview)_ Support header and footer sections in tooltips([`0e704f3`](https://github.com/Abdulla-Aldosari/runbox/commit/0e704f3e047fd43ce03f825e993fefbcf9bb21b1))

### 🐛 Bug Fixes

- _(ai-settings)_ Skip save and close immediately when nothing changed([`eb2dd46`](https://github.com/Abdulla-Aldosari/runbox/commit/eb2dd467b2e6a03f99468c35c173426bf6671bba))
- _(commands)_ Reset custom input state when selecting custom option([`60b4848`](https://github.com/Abdulla-Aldosari/runbox/commit/60b484858b7b05f4fab8c72344bd1a3d8d4a59f7))
- _(enum-manager)_ Enforce required field validation([`9b81f3a`](https://github.com/Abdulla-Aldosari/runbox/commit/9b81f3aae2481986fb1ff05d82cb80023373134f))
- _(main)_ Avoid rescheduling tooltip timer on nested hover events([`cd974c0`](https://github.com/Abdulla-Aldosari/runbox/commit/cd974c0291f7c0bcb9e4603ff28dd8c0446890d1))
- _(media)_ Default variable remember scope to "off"([`ba0fa9e`](https://github.com/Abdulla-Aldosari/runbox/commit/ba0fa9e51452c6c6ea43b9a89f65a5b19571220a))
- _(run-confirm)_ Show enum title and full value in variable input modal([`87e45f5`](https://github.com/Abdulla-Aldosari/runbox/commit/87e45f505152e265334f522ae2fcd38346fc81f8))
- _(run-confirm)_ Handle Alt+0 on enum dropdown button in variable input modal([`24961ce`](https://github.com/Abdulla-Aldosari/runbox/commit/24961ceffeaa553e9b37ef6f235dde091f39e100))

## [1.0.0] - 2026-06-28

- Initial release
