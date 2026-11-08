All notable changes to **[RunBox](https://github.com/Abdulla-Aldosari/runbox)** are documented here.<br>

## [2.0.0](https://github.com/Abdulla-Aldosari/runbox/compare/v1.1.0..v2.0.0) - 2026-11-08

### ⚠️ Important Changes

- _(auto-variables)_ [**breaking**] Add ${@name} syntax and the ${@time} variable - ([4d86805](https://github.com/Abdulla-Aldosari/runbox/commit/4d86805c5d0c2e58478f4a77b0ca8d427a5474e1))

### 🚀 Features

- _(ai-generation)_ Limit AI generated names to the allowed format - ([6fbd298](https://github.com/Abdulla-Aldosari/runbox/commit/6fbd2989a7e40ffa0a0d3a4c823ccdb0507df338))
- _(categories)_ Validate category and group name format - ([b6dcd8b](https://github.com/Abdulla-Aldosari/runbox/commit/b6dcd8bcb49b1493b668e543b4f2ecbf2d8e4a03))
- _(categories)_ Block duplicate category and group names - ([d9934d1](https://github.com/Abdulla-Aldosari/runbox/commit/d9934d16027f3ee6b033975749e21a6f4ffb166e))
- _(command-form)_ Add insert variable picker for auto variables - ([54356d4](https://github.com/Abdulla-Aldosari/runbox/commit/54356d47ebc5da2a1695fe594666fea578e73daa))
- _(commands)_ Add quick add group button to the groups row - ([d46a6a3](https://github.com/Abdulla-Aldosari/runbox/commit/d46a6a3d08943eddb6d9716d51102d3103181757))
- _(ui)_ Keep panel header and tabs visible when scrolling long tables - ([aafb70d](https://github.com/Abdulla-Aldosari/runbox/commit/aafb70d588014fefc3d3edda890cda473843e601))

### 🐛 Bug Fixes

- _(command-form)_ Keep undo history in the command template field - ([a4db48c](https://github.com/Abdulla-Aldosari/runbox/commit/a4db48c535c3f62223bbfae831b2b31bb1524a42))
- _(commands)_ Restore row selection and help links after column toggle - ([8c120ff](https://github.com/Abdulla-Aldosari/runbox/commit/8c120ffda4661ddff19fb419ff7b95100d3564c6))
- _(recent)_ Show current workspace commands in the recent tab - ([b015535](https://github.com/Abdulla-Aldosari/runbox/commit/b015535a2860af4c31600046247cf779959da956))
- _(security)_ Prevent prototype pollution in AI provider model cache - ([01418fe](https://github.com/Abdulla-Aldosari/runbox/commit/01418fe393a9bcbe17d8fefce240b12e5ae0b20f))

## [1.1.0](https://github.com/Abdulla-Aldosari/runbox/compare/v1.0.0..v1.1.0) - 2026-11-05

### 🚀 Features

- _(ai)_ Add AI connection and rate limits checks - ([99978c4](https://github.com/Abdulla-Aldosari/runbox/commit/99978c428ecd80bef66808254c6a906ce4b96af2))
- _(ai-explain)_ Add per-explanation language picker - ([d917763](https://github.com/Abdulla-Aldosari/runbox/commit/d91776377a48636b93c56c252edc2d5acff5f892))
- _(ai-generate)_ Redesign loading view with live group progress - ([16f8f6d](https://github.com/Abdulla-Aldosari/runbox/commit/16f8f6dfacad8ba7a3bb47ed3fd19b8501183163))
- _(ai-generate)_ Add cancel button and progress to generation - ([b6a2353](https://github.com/Abdulla-Aldosari/runbox/commit/b6a2353e155a8b463c9823b06f7436098156128a))
- _(ai-generate)_ Tag AI-generated commands with targetShell - ([14e561e](https://github.com/Abdulla-Aldosari/runbox/commit/14e561e639d463794f2fe82f7def769c128c6256))
- _(ai-settings)_ Add aiOutputLanguage setting for AI-written text - ([e2325b6](https://github.com/Abdulla-Aldosari/runbox/commit/e2325b696fa4373ec7531c32a5d98e43b53f4d8d))
- _(commands)_ Show target shell match status in command form - ([422cf7f](https://github.com/Abdulla-Aldosari/runbox/commit/422cf7f56cf5ec4828085c288d6ba98998dec4ae))
- _(commands)_ Split powershell target shell into pwsh and windows powershell - ([aa73400](https://github.com/Abdulla-Aldosari/runbox/commit/aa7340066541f76df4e285d37288e102c8b539f5))
- _(commands)_ Add file picking functionality in variable modal - ([66d4ded](https://github.com/Abdulla-Aldosari/runbox/commit/66d4ded1693072e1184fe6d6715e32872a21e7aa))
- _(commands)_ Add "Current Workspace" private category - ([e6d759d](https://github.com/Abdulla-Aldosari/runbox/commit/e6d759d98c788ecdf2483b54a734c717f9739be3))
- _(commands)_ Add target shell selection to commands - ([b3a6a85](https://github.com/Abdulla-Aldosari/runbox/commit/b3a6a85d4413df2ee92b867e1317ae15324ae3cc))
- _(edit-command)_ Auto-transfer variable values on rename - ([bb7ce98](https://github.com/Abdulla-Aldosari/runbox/commit/bb7ce980f96eb5b162ed83dc41a7e634bbb65eb2))
- _(storage)_ Allow custom path for local workspace files - ([df1543d](https://github.com/Abdulla-Aldosari/runbox/commit/df1543d9aa5d97dbacb307733246fbb839b4fc93))
- _(terminal)_ Warn users about duplicate shell terminal profiles - ([6267c7f](https://github.com/Abdulla-Aldosari/runbox/commit/6267c7f789582ea4396398708c12b71baf772591))
- _(variables)_ Add Ctrl/Cmd+Shift+O/E variable field shortcuts - ([1c5a0e7](https://github.com/Abdulla-Aldosari/runbox/commit/1c5a0e7770d3387a820341daa49f641ec9d109e7))
- _(webview)_ Detect a lost extension host connection ([#27](https://github.com/Abdulla-Aldosari/runbox/issues/27)) - ([23186ce](https://github.com/Abdulla-Aldosari/runbox/commit/23186ce783f649af283d461233010a9d38d0e36d))

### 🐛 Bug Fixes

- _(ai)_ Split full-mode generation into outline and details requests - ([f9aa6b8](https://github.com/Abdulla-Aldosari/runbox/commit/f9aa6b8af9b68019e6b455117c89a2f5e0bb2c1b))
- _(ai-generate)_ Scope ai results modal scrolling to its table - ([8fa1159](https://github.com/Abdulla-Aldosari/runbox/commit/8fa115988a213900306122aa2a3f82b1b27e56f6))
- _(logger)_ Show full AI response alongside errors in debug output - ([1f6de12](https://github.com/Abdulla-Aldosari/runbox/commit/1f6de1233831bc13498ba607ea968c0e76fb1161))
- _(media)_ Default variable remember scope to "off" - ([716d302](https://github.com/Abdulla-Aldosari/runbox/commit/716d302cb5169bfb7267874ede061351b692053d))

## [1.0.0] - 2026-06-28

- Initial release
