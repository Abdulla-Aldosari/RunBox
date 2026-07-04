# Manual Testing Checklist — RunBox

**Purpose:** A step-by-step checklist for manually verifying every UI feature and runtime behaviour of the extension. Work through each section in order. Mark items with `[x]` as you confirm them.

**How to run:** Press **F5** in VS Code to launch the Extension Development Host, then open the panel with **F4 F4** (or Command Palette → "RunBox: Open Panel").

---

## 0. Prerequisites

- [ ] Extension launches without errors (check Output → "RunBox" channel)
- [ ] Panel opens and the webview renders without a blank screen or console errors
- [ ] Open the browser DevTools inside the webview (**Ctrl+Shift+I** in the Extension Development Host) and confirm the Console is clean

---

## 1. Tab Bar

- [ ] All five tabs are visible: **Recent**, **Commands**, **Favorites**, **Variables**, **AI**
- [ ] Clicking each tab switches to the correct view
- [ ] The active tab shows its active state (highlighted/underlined) and the others do not
- [ ] Close and reopen the panel — the previously selected tab is restored (persisted in `localStorage`)

---

## 2. Recent Tab

- [ ] **Empty state:** before running any command, the tab shows an appropriate "no recent commands" message
- [ ] After running or using a command (see Commands tab tests), it appears here sorted by most-recent first
- [ ] The total run count is shown correctly in the header
- [ ] **Copy** button: copies the resolved command to the clipboard → green notice "Copied"
- [ ] **Use** button: sends the resolved command to the active terminal → green notice "Used"
- [ ] **Run** button: opens the Run Confirm modal (see §8)
- [ ] **Global Favorite (♡)** button: clicking toggles the heart icon and adds/removes the command from global favorites
- [ ] **Workspace Favorite** button: only visible when a workspace folder is open; toggles workspace favorites independently
- [ ] Variable inputs `{varName}` render as text fields inside the card
- [ ] Typing a value in a variable field updates the resolved command preview in real time
- [ ] **Enum variable:** when a command has an enum-typed variable, a custom dropdown appears — **no native `<select>` element**
- [ ] The `__EMPTY_VALUE__` / "Empty" button (if present) sends an explicitly empty string to the resolved command

---

## 3. Commands Tab

### 3.1 Filter Bar

- [ ] **Category dropdown** (custom select, not native `<select>`): selecting a category filters the command list to that category
- [ ] The selected category is restored after closing and reopening the panel (`localStorage`)
- [ ] **Group dropdown**: populates with the groups of the selected category; selecting a group further filters the list
- [ ] Changing the category resets the group filter to "All"
- [ ] **Search field**: typing text filters commands by title, description, and command string simultaneously
- [ ] Clearing the search field restores the full list

### 3.2 Column Visibility

- [ ] **Column toggle dropdown** (custom select): opening it shows checkboxes or toggles for each column
- [ ] Toggling a column off hides that column's data from all visible command cards
- [ ] Toggling it back on restores it
- [ ] Column visibility preference is restored after reopening the panel (`localStorage`)
- [ ] Columns to verify individually: **Title**, **Description**, **Command**, **Category**, **Group**, **Help URL**, **Last Run**, **Run Count**

### 3.3 Command Cards

- [ ] Each visible card shows only the columns that are enabled
- [ ] **Help URL icon**: clicking the external-link icon opens the URL in the system browser
- [ ] **Copy** button: copies the resolved command → green notice "Copied"
- [ ] **Use** button: sends the resolved command to the active terminal → green notice "Used"
- [ ] **Run** button: opens Run Confirm modal (see §8)
- [ ] **Edit (pencil)** button: opens the Edit Command modal pre-filled with the command's data (see §5)
- [ ] **Delete (bin)** button: opens the Delete Confirm modal (see §6)
- [ ] **Global Favorite (♡)** button: toggles global favorites; icon changes between filled and outlined
- [ ] **Workspace Favorite** button: visible only with an open workspace; toggles independently of global favorites

### 3.4 Variable Inputs Inside Cards

- [ ] `{varName}` placeholders render as labelled text inputs
- [ ] Typing updates the resolved command in real time
- [ ] **Remember checkbox** per variable: when checked and the command is run/used/copied, the value is saved to `commandDrafts` and pre-filled next time
- [ ] **Enum variable**: renders as a custom dropdown (not a native `<select>`)
- [ ] **"Empty" button** (`RUNBOX_EMPTY_VALUE`): sets the variable to an explicitly empty string

### 3.5 Sort Mode

- [ ] **Sort** button activates drag-and-drop sort mode (cards show drag handles)
- [ ] Dragging a card upward moves it above the target card
- [ ] Dragging a card downward moves it below the target card
- [ ] The visual order changes correctly during the drag
- [ ] **Save Order** button saves the new order → green notice → commands stay in that order after a re-render
- [ ] **Cancel** button restores the original order without saving

---

## 4. New Command Modal

- [ ] **"+ Add Command"** button opens the New Command modal
- [ ] Modal contains: **Title**, **Description**, **Command**, **Help URL** fields
- [ ] **Group tags** : populates with the groups of the selected category
- [ ] Writing `{varName}` in the Command field causes a **Variable Metadata** section to appear
- [ ] In Variable Metadata, a variable can be left as plain text (default) or switched to **enum** type
- [ ] **Enum type**: adding multiple option rows (title + value + description) works; each row can be removed individually
- [ ] **Validation**: attempting to save with an empty Title, Command, or without a selected Category shows an error / prevents saving
- [ ] **Save** button saves the new command and closes the modal → new card appears in the Commands tab → green notice
- [ ] **Cancel (✕)** button closes the modal without saving; no new command appears

---

## 5. Edit Command Modal

- [ ] Edit modal opens pre-filled with the command's current Title, Description, Command, Help URL
- [ ] **Category dropdown** pre-selects the correct category
- [ ] **Group tags** pre-selects the correct group
- [ ] All fields are editable
- [ ] **Variable Metadata**: if the command already has enum variables, their options are shown and editable
- [ ] Changing a field and saving correctly persists the change
- [ ] After saving, the panel scrolls to the edited command card (scroll-into-view)
- [ ] **Cancel** button closes the modal; the command remains unchanged

---

## 6. Delete Confirm Modal

- [ ] The modal displays the name of the command to be deleted
- [ ] **Confirm** button: deletes the command → it disappears from the list → green notice
- [ ] **Cancel** button: closes the modal; the command remains

---

## 7. Favorites Tab

- [ ] Two sections: **Global Favorites** and **Workspace Favorites**
- [ ] **Workspace Favorites** section is only shown when a workspace folder is open
- [ ] Each section shows an appropriate empty-state message when there are no favorites in that scope
- [ ] Favorited commands appear in the correct section
- [ ] **Copy**, **Use**, **Run** buttons work the same as in the Commands tab
- [ ] **Remove from Favorites (♡-)** button removes the command from that section immediately
- [ ] Variable inputs, enums, and the "Empty" button work the same as in Commands tab

---

## 8. Run Confirm Modal

- [ ] Modal displays the **title** of the command to be executed
- [ ] **Shell selector dropdown** (custom select): lists all terminal profiles from VS Code settings
- [ ] The **default terminal profile** is pre-selected
- [ ] Selecting a different shell changes which terminal is opened
- [ ] Variable inputs are shown with their **saved (remembered) values** pre-filled
- [ ] **3-way remember toggle (Local / Off / Global)** per variable:
  - `Local` saves the value to the workspace variables file after running
  - `Off` does not save
  - `Global` saves to the global variables file
- [ ] **Workspace toggle** is **disabled** (greyed out) when no workspace folder is open
- [ ] **Enum variable**: rendered as a custom dropdown in the modal
- [ ] The **resolved command preview** updates in real time as variables are changed
- [ ] **Run** button:
  - Executes the command in a terminal using the selected shell
  - Closes the modal
  - Updates `lastRunAt` and `runCount` for the command
  - Command appears (or moves to the top) in the **Recent** tab
- [ ] The correct shell executable is used (the terminal name includes the shell name)
- [ ] **Cancel** button: closes the modal; the command is not run

---

## 9. Variables Tab

- [ ] Tab lists all commands that contain at least one `{varName}` placeholder
- [ ] **Local Variables** section (workspace-scoped) is disabled / hidden when no workspace is open
- [ ] **Global Variables** section is always visible
- [ ] Saved variable values are pre-filled in the input fields
- [ ] Editing a field and clicking **Save Local**: saves to `.vscode/runbox.data.json` → green notice
- [ ] Editing a field and clicking **Save Global**: saves to `~/.runbox/data.json` → green notice
- [ ] **Open Local Data JSON** button: opens the file in VS Code editor; prompts to create it if it doesn't exist
- [ ] **Open Global Data JSON** button: opens the file in VS Code editor; prompts to create it if it doesn't exist
- [ ] The first time a local variable or local favorite is saved in a fresh workspace, a one-time notice appears: `Created file ".vscode/runbox.data.json". You can change this location anytime in workspace settings.` with an "Open Settings" action; saving again does not repeat the notice

### 9.1 Auto-Variables

- [ ] **Auto-Variables Settings** button/section is visible
- [ ] Opening the settings reveals toggles for each auto-variable (e.g. DATE, TIME, USERNAME, OS, etc.)
- [ ] Toggling an auto-variable on/off and saving persists the setting
- [ ] Enabled auto-variables are correctly resolved in command strings (e.g. `{DATE}` → today's date)

---

## 10. AI Tab

- [ ] **Prompt textarea** accepts multi-line input
- [ ] **Mode dropdown** (custom select): lists available generation modes; selecting one works correctly
- [ ] **Generate** button sends the request to the AI provider
- [ ] A **loading indicator** is shown while the request is in progress
- [ ] If the AI key is missing or invalid, an **error state** is shown with a descriptive message
- [ ] Successful generation shows a list of result items, each with: Title, Description, Command
- [ ] **Insert** button per result: adds that command to the commands data → the command appears in the Commands tab → green notice
- [ ] **Discard** button per result: removes that item from the results list
- [ ] **AI Settings (⚙)** button opens the AI Settings modal (see §11)

---

## 11. AI Settings Modal

- [ ] Modal shows the current **provider** selection
- [ ] **Provider dropdown** (custom select): lists Gemini, OpenAI, Anthropic; selecting changes the provider
- [ ] **API Key** input field accepts text (value is masked)
- [ ] **Save** button stores the API key in VS Code SecretStorage → green notice → modal closes
- [ ] **Cancel** button closes the modal without saving

---

## 12. Notice Bar

- [ ] **Success** (green): appears after a successful save / copy / run / use
- [ ] **Error** (red): appears when a save or action fails
- [ ] **Warning** (orange/yellow): appears for non-critical issues
- [ ] The notice includes the correct icon and message text for each type
- [ ] **Dismiss (✕)** button hides the notice immediately
- [ ] A new operation that triggers a notice replaces the old one

---

## 13. Tooltips

- [ ] Hovering over icon buttons (copy, run, edit, delete, heart, external-link, etc.) shows a tooltip
- [ ] The tooltip uses the `data-tooltip` attribute — **no native `title` attribute on the same element**
- [ ] Tooltip positioning is correct (does not clip off-screen)

---

## 14. Rules Verification

Open DevTools (Ctrl+Shift+I in the Extension Development Host webview) and run these checks in the Console:

```js
// Must return 0 — no native <select> elements anywhere
document.querySelectorAll("select").length;

// Must return 0 — no inline style attributes
document.querySelectorAll("[style]").length;
```

- [ ] `document.querySelectorAll("select").length` returns **0**
- [ ] `document.querySelectorAll("[style]").length` returns **0** (or only elements that use `style.setProperty` for dynamic CSS custom properties, which is allowed)
- [ ] All dropdowns use the custom select markup: `wrapper > button + ul.custom-select-menu`

---

## 15. Data Persistence (after VS Code restart)

Close the Extension Development Host completely and reopen it (F5 again):

- [ ] **Commands** created during testing are still present
- [ ] **Variables** (local and global) saved during testing are still correct
- [ ] **Global favorites** are still favorited
- [ ] **Workspace favorites** are still favorited (if a workspace was open)
- [ ] The previously selected **tab** is restored
- [ ] The previously selected **category** is restored

---

## 16. Build & Linting

Run these commands from the terminal in the project root and confirm no errors:

```bash
npm run lint
npm run build
npm test
```

- [ ] `npm run lint` — ESLint exits with 0 errors
- [ ] `npm run build` — esbuild bundles `dist/extension.js` successfully
- [ ] `npm test` — all programmatic tests pass (syntax, exports, normalize, terminal)
