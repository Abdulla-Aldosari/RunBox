# Contributing

Thank you for your interest in contributing to the [runbox](https://github.com/Abdulla-Aldosari/runbox) VS Code extension.

When contributing, please first discuss the change you wish to make via an [issue](https://github.com/Abdulla-Aldosari/runbox/issues) or any other method with the owner of this repository before making a change.

---

## Prerequisites

- [Node.js](https://nodejs.org/)
- [Visual Studio Code](https://code.visualstudio.com/)

---

## Getting Started

1. Fork this repository and create your branch from `main`.

2. Clone your forked repository:

```sh
git clone https://github.com/{username}/runbox.git
cd runbox
```

3. Install dependencies:

```sh
npm install
```

4. Build the extension:

```sh
npm run build
```

---

## Development Workflow

1. Create a new branch from `main` for your changes:

```sh
git checkout main
git checkout -b my-feature-branch
```

2. Run `npm run watch` to build and watch for changes while developing.

3. Press `F5` in VS Code to launch the extension in a new window (Extension Development Host).

4. Run the syntax check to catch any errors:

```sh
npm run check
```

5. Add or update tests according to your changes, then verify they pass:

```sh
npm test
```

6. Run linting and formatting checks before committing:

```sh
npm run lint
npm run prettier:check
```

To auto-fix formatting:

```sh
npm run prettier
```

### Common Commands

```sh
npm install             # Install dependencies
npm run check           # Syntax check (node --check)
npm run lint            # Run ESLint
npm run prettier        # Format all files with Prettier
npm run prettier:check  # Check formatting without modifying files
npm run build           # Bundle and minify the extension
npm run watch           # Build and watch for changes
npm test                # Run all tests
```

> [!NOTE]
>
> `npm test` runs 9 test suites sequentially via `testing/run-tests.js`:
>
> - **Syntax**: checks all JS files for syntax errors (`node --check`)
> - **Function**: unit tests for `lib/normalize.js`
> - **FixShellPath**: unit tests for `lib/terminal.js`
> - **RunShell**: tests for shell selection when running a command
> - **Storage**: tests for `lib/storage.js`
> - **Exports**: verifies the public exports of all `lib/` modules
> - **HelpLinks**: tests for the help link registry in `lib/help-links.js`
> - **AiGeneration**: tests for the AI command generation flow
> - **Inline-Styles**: scans `media/` files for forbidden inline styles
>
> A unified summary table is printed at the end, showing Total / Passed / Failed per suite. The exact counts change as tests are added.

Example summary table:

```sh
───────────────────────────────────────────────────────
# Final Result :
───────────────────────────────────────────────────────
  Syntax         ( Total: 55 / Passed: 55 / Failed: 00 )
  Function       ( Total: 78 / Passed: 78 / Failed: 00 )
  FixShellPath   ( Total: 30 / Passed: 30 / Failed: 00 )
  RunShell       ( Total: 06 / Passed: 06 / Failed: 00 )
  Storage        ( Total: 09 / Passed: 09 / Failed: 00 )
  Exports        ( Total: 90 / Passed: 90 / Failed: 00 )
  HelpLinks      ( Total: 04 / Passed: 04 / Failed: 00 )
  AiGeneration   ( Total: 39 / Passed: 39 / Failed: 00 )
  Inline-Styles  ( Total: 19 / Passed: 19 / Failed: 00 )
───────────────────────────────────────────────────────
```

---

## Code Style

- Code formatting is enforced with Prettier (run `npm run prettier` to format all files)
- Linting is enforced with ESLint (run `npm run lint` to check)

---

## Architecture Overview

The extension has two execution contexts:

- **Extension Host (Node.js):** `extension.js` + `lib/` — CommonJS modules
- **Webview (Browser):** `media/` — plain `<script>` tags sharing a single `window` global scope

Key components:

- `extension.js` — Entry point: panel creation, message routing, state broadcasting
- `lib/handlers.js` — All webview message handler functions
- `lib/storage.js` — All file I/O and path constants (single source of truth for persistence)
- `lib/normalize.js` — Pure data normalization, no side effects
- `lib/terminal.js` — Terminal shell resolution and lifecycle management
- `lib/ai/factory.js` — AI command generation and provider instantiation
- `lib/ai/providers-config.js` — Single source of truth for all AI provider metadata

For a detailed breakdown of every file, export, and message type, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

---

## Submitting Changes

1. Start committing your changes. Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

> [!NOTE]
>
> - `CHANGELOG.md` is generated automatically from commit messages using [git-cliff](https://git-cliff.org/). Do not edit it manually. Only commits of type `feat`, `fix`, `perf`, and breaking changes `type(scope)!` appear in the changelog — all other types are excluded.
> - Write clear, well-formed commit messages as they directly feed into the changelog.
> - Scope is required.

2. Make your changes and ensure tests pass:

```sh
npm test
```

3. Run linting and formatting checks:

```sh
npm run lint
npm run prettier:check
```

4. Submit a pull request **targeting the `main` branch** with a clear description of your changes. Fill out all relevant sections of the PR template.

5. Wait for approval from the project owner/maintainer. Discuss any requested changes and update your PR accordingly.

6. You may merge the pull request once you have sign-off from the project owner, or request them to merge it if they haven't done so after a while.

For bug fixes, please include a test case that demonstrates the fix when possible.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
