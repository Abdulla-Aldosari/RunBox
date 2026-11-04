<div align="center">

# RunBox

**Organize, run, and generate terminal commands with variables, favorites, and a built-in AI assistant.**
</div>

![RunBox Overview](docs/images/hero-screenshot.png)

RunBox gives you a central panel inside VS Code to store and run your frequently used terminal commands. Organize them by category and group, define reusable variables, and execute them with a single click across every project you work on.

## Key Features

### 📂 Categorized Command Management

Organize commands into **categories** and **groups** (e.g. MySQL → Setup, Build, Deploy). Create, rename, and delete both. Filter the command table by category and group, toggle visible columns, and drag rows to reorder them within a group.

![Categorized Command Management](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/RunBox/categorized-command-management.gif)

<br>

### 🗂️ Current Workspace

A special category that always appears first in the list whenever a workspace folder is open. Commands and groups added under **Current Workspace** are stored privately in `.vscode/runbox.data.json` (or in the path set by `runBox.localWorkspaceFilesPath`) instead of the shared global file, so they appear only in this exact workspace folder and never in any other project.

![Current Workspace](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/RunBox/current-workspace.gif)

This is useful for commands that only make sense for one specific project, such as a project-specific build script or a database connection string, that you never want showing up when you open a different project.

> [!NOTE]
> Commands under **Current Workspace** can only be added to **Local Workspace favorites** (never Global), and their variables can only use the **Local** or **Off** scope (never Global).

<br>

### ⚡ Three Ways to Run a Command

| Action   | What it does                                                               |
| -------- | -------------------------------------------------------------------------- |
| **Run**  | Executes the command immediately (with a confirmation dialog)              |
| **Use**  | Pastes it into the terminal input so you can review or edit before running |
| **Copy** | Copies the resolved command to your clipboard                              |

![Run, Use, and Copy](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/RunBox/three-ways-to-run-a-command.gif)

<br>

### 🖥️ Target Shell Selection

Assign a target shell (Windows PowerShell, PowerShell, Command Prompt, Bash, and more) to any command from the Add/Edit form. Windows PowerShell (5.1, built into Windows) and PowerShell (7+, installed separately) are listed as distinct options because they are different programs with real syntax differences. When you click **Run**, RunBox detects a matching terminal profile on your machine and pre-selects it in the confirmation dialog. You can still override it before confirming. AI-generated commands can also target a specific shell so that the syntax matches.

![Target Shell Selection](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/RunBox/target-shell-selection.gif)

> [!NOTE]
> The Target Shell field in the Add/Edit form is a fixed shell _type_ (for example `bash`), independent of profile _names_. The confirmation dialog's shell picker, on the other hand, lists the terminal profiles actually configured on your machine (from VS Code's `terminal.integrated.profiles` settings), which is why the two lists can look different.
>
> RunBox compares your command's target shell type with the detected type of each profile (based on its executable path) and pre-selects the first match. If no profile matches, VS Code's default terminal profile is used and the command still runs normally. The pre-selection is a convenience, not a restriction: you can pick any other profile in the confirmation dialog, and that choice applies to that run only. Leaving Target Shell as **Any Shell** uses VS Code's default terminal profile.
>
> The Add/Edit form also shows a small indicator below the field that tells you whether your selection matches a profile on your machine. Hover over it to see the full path it resolves to.

<br>

### 🔤 Variables: Three Independent Scopes

Add `${variableName}` placeholders to any command template. When you run or use a command, a dialog prompts you to fill in the values.

Each variable can be saved in one of three independent scopes:

| Scope      | Saved to                                   | Best for                               |
| ---------- | ------------------------------------------ | -------------------------------------- |
| **Local**  | `.vscode/runbox.data.json`                 | Values that differ per project         |
| **Global** | `~/.runbox/data.json`                      | Values shared across all projects      |
| **Off**    | Session memory only, never written to disk | One-time values you don't need to keep |

Switching the scope toggle never deletes the value stored in the other scopes.

![Variables: Three Independent Scopes](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/RunBox/variables-three-independent-scopes.gif)

<br>

### 🔤 Auto Variables

**Auto Variables** (`${date}`, `${username}`, `${workspaceFolder}`, `${workspaceName}`) are resolved automatically, with no input required.

![Auto Variables](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/RunBox/auto-variables.gif)

<br>

### 🔤 Enum Variables

**Enum Variables** let you predefine a fixed list of options that appears as a dropdown when you run a command.

![Enum Variables](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/RunBox/enum-variables.gif)

<br>

### 🗃️ Multi-Root Workspace Support

A workspace folder selector appears in the panel header when you work in a multi-root workspace. Local variables, local favorites, and auto variables such as `${workspaceFolder}` and `${workspaceName}` automatically reflect the selected folder. The Run confirmation dialog also includes a per-execution folder override that sets the terminal's working directory.

![Multi-Root Workspace](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/RunBox/multi-root-workspace.gif)

How the folder is chosen when the panel opens is controlled by the `runBox.multiRootFolderResolution` setting. See the [Settings Reference](docs/settings.md) for the available modes.

<br>

### ✨ Generate Commands with AI

![Generate Commands with AI](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/RunBox/generate-commands-with-ia.gif)

Describe what you need in plain language (for example, "commands to manage a MySQL database") and the AI produces a set of ready-to-insert commands. Review the results, select the ones you want, and insert them directly into a category and group.

**8 AI providers supported:** Google Gemini · OpenAI · Anthropic Claude · DeepSeek · Groq · Mistral AI · Cohere · StepFun

> [!NOTE]
> Several providers offer **free tiers**. Gemini, DeepSeek, and Groq are good starting points.

<br>

### 📖 Explain Command with AI

![Explain Command with AI](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/RunBox/explain-command-with-ia.gif)

Click the **Explain** button on any command to get a structured breakdown: what it does, what each part means, practical examples, and warnings. The result is rendered directly inside the panel.

<br>

### ⭐ Favorites

Mark any command as a favorite with **Global** or **Local Workspace** scope. Add one with a single click, or Ctrl+click to manage its scope. You can jump from the Favorites tab back to the original command at any time.

<br>

### 🕘 Recent Commands

Every command you run is tracked automatically. Revisit or re-run recent commands without searching the full list.

<br>

### 💾 Command Storage, Backup & Sharing

All commands and categories are stored globally in a single JSON file on your machine, `~/.runbox/commands.json`, which is shared across every VS Code workspace you open. Open and edit it directly from the panel with the **Open Global JSON** button in the header.

Back it up, or commit it to a shared repository to sync your commands across machines or share them with your team. Anyone can restore your full set of commands by placing this file at the same path on their machine.

<br>

### 🪟 Safe Across Multiple Windows

Open RunBox in as many VS Code windows as you like, whether it is the same project twice or several different projects at once, without worrying about lost data. Saves are always written safely to disk, adding or removing a command in one window never erases what another window just saved, and every open window updates live to reflect changes made elsewhere. If two windows edit the exact same command at the same time, a dialog lets you choose which version to keep.

<br>

## Requirements

- VS Code 1.90.0 or later.

## Getting Started

1. Install the extension from the VS Code Marketplace.
2. Open the panel:
   - **Command Palette** → `RunBox: Open Panel`
   - **Keyboard shortcut** → `F4 F4` (press F4 twice)
3. Create a category and, optionally, add groups to it.
4. Add your first command. Use `${variableName}` placeholders for any values that change between runs.
5. Click **Run**, **Use**, or **Copy** to execute it.

## Keyboard Shortcut

| Shortcut | Action                |
| -------- | --------------------- |
| `F4 F4`  | Open the RunBox panel |

## Documentation

- [Settings Reference](docs/settings.md): all configuration options explained
- [Frequently Asked Questions](docs/faqs.md): common questions and troubleshooting

## License

[MIT](LICENSE)
