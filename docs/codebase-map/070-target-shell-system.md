# Target Shell System

Commands can be tagged with the shell environment they were written for, so that
running them auto-selects a matching terminal profile instead of relying on the
user's default shell.

## Data Model

Each command may carry an optional `targetShell` field, a string identifier from
the fixed set: `"pwsh"`, `"powershell"`, `"cmd"`, `"bash"`, `"wsl"`, `"zsh"`,
`"sh"`. `"pwsh"` (PowerShell 7+, `pwsh.exe`) and `"powershell"` (Windows
PowerShell 5.1, `powershell.exe`) are distinct values — they are different,
independently installed programs with real syntax/feature differences, not
just a version number. The field is validated in `lib/normalize.js` against
`VALID_TARGET_SHELLS` (a `Set` that must stay in sync with the classification
logic in `detectShellType`). An invalid or empty value is dropped, and the key
is omitted from the stored command object entirely — matching the same
"omit-if-empty" convention used for `helpUrl` and `variableMeta`.

## Where `targetShell` Is Set

- **Manually** - via the "Target Shell" dropdown in the shared command form
  (`media/modals/command-form.js`, wrapper `command-form-shell-wrap`), used by
  both Add and Edit modes. It uses the shared `TARGET_SHELL_OPTIONS` list
  defined in `media/state.js`.
- **By AI generation** — the AI Generate modal lets the user pick a target
  shell for the prompt (`ai-shell-select-wrap` in
  `media/modals/ai-generate.js`). `lib/ai/factory.js` (`buildShellContext()`)
  injects that shell name into the system instruction so the AI writes
  shell-appropriate syntax, and the generated command is tagged with the
  matching `targetShell`.

## Matching a Command to a Real Terminal Profile

1. `lib/terminal.js` → `detectShellType(shellPath)` classifies a shell
   executable path (e.g. `pwsh.exe`, `bash.exe`) into the same standardized
   identifier set used by `targetShell`.
2. `getTerminalProfiles()` calls `detectShellType()` for every configured VS
   Code terminal profile and attaches the result as `shellType` on each
   profile entry sent to the webview (`state.terminalProfiles.profiles`).
3. `findMatchingShellProfile(targetShell)` in `media/utils.js` collects every
   profile in `state.terminalProfiles.profiles` whose `shellType` equals the
   requested `targetShell`, or returns `null` if none matches or `targetShell`
   is empty. When more than one profile matches (e.g. a "PowerShell" profile
   and a "Windows PowerShell" profile that both resolve to the same classic
   `powershell.exe`, a setup VS Code's own "Select Default Profile" flow
   produces when PowerShell 7+ is not installed), the profile named after VS
   Code's own naming convention for that shell type is preferred
   (`PREFERRED_PROFILE_NAME_BY_SHELL_TYPE`: `"powershell"` → "Windows
   PowerShell", `"pwsh"` → "PowerShell"); otherwise the first match is
   returned.

## Target Shell Transparency Indicator (Command Form)

Since a terminal profile's display name never guarantees which real
executable it points to, `describeShellSelection(targetShell)` in
`media/utils.js` reuses `findMatchingShellProfile()` to describe the outcome
directly instead of leaving the user to guess. It returns `null` for "Any
Shell" (empty `targetShell`), or `{ status: "matched"|"unmatched", profile,
duplicates }` — `duplicates` lists every other configured profile that
resolves to the same `shellType`, if any.

`renderTargetShellCheck(targetShell)` in `media/modals/command-form.js` calls
this on every render of the Command form (both Add and Edit modes, always
reflecting the current `commandFormBuffer.targetShell` — not only right after
a change) and renders a short indicator below the "Target Shell" field:

- **Matched** → `✓ Matches: <profile name>`, with a tooltip showing the full
  resolved executable path and, when `duplicates` is non-empty, which other
  profile names resolve to the exact same executable.
- **Unmatched** → `⚠ No matching profile`, with a tooltip stating no
  configured profile resolves to this shell type on this machine.
- **Any Shell** → nothing is rendered.

The same `describeShellSelection()` result also drives
`buildTargetShellOptions()` (`media/modals/command-form.js`), which dims every
option in the "Target Shell" dropdown itself (`itemClass:
"cs-item-shell-unmatched"`, see `media/styles.css`) whose shell type has no
matching profile — so the lack of a match is visible directly in the closed
list, before the user even selects it. This is purely visual: every option
remains fully selectable, since Target Shell is a suggestion, never a
restriction. "Any Shell" is never dimmed.

## Run Confirm Auto-Selection

When the Run Confirm modal is opened for a command (Run button click, or
after resolving missing variables), `media/tabs/commands.js` calls
`findMatchingShellProfile(command.targetShell)`:

- **Match found** → that profile's `shellPath`/`name` pre-select the shell
  dropdown in the Run Confirm modal (`renderShellSelector()` in
  `media/modals/run-confirm.js`).
- **No match** (empty `targetShell`, or no configured profile has that
  `shellType`) → falls back to whatever shell was previously selected in
  `runConfirmState`, preserving prior behavior exactly.

The user can still override the auto-selected shell manually via the
dropdown before confirming — this system only changes the pre-selected
default, never the final choice.
