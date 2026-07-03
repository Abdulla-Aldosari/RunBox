# Terminal Recipes — Frequently Asked Questions

---

## General

### Where are my commands stored?

All commands and categories are stored globally in a single JSON file on your machine:

```
~/.vscode-terminal-recipes/commands.json
```

This file is shared across all your VS Code workspaces, so your recipes are always available no matter which project you open. You can open and edit this file directly from the panel using the **Open Global JSON** button in the header.

---

### Does Terminal Recipes support multi-root workspaces?

Yes. When you open a multi-root workspace (a `.code-workspace` file with multiple folders), a **workspace folder selector** dropdown appears below the panel header. You can switch between folders at any time — local variables, local favorites, and auto variables like `${workspaceFolder}` and `${workspaceName}` all update to reflect the selected folder.

The **Run confirmation dialog** also includes a per-execution folder override so you can run a specific command against a different folder without changing the panel's active selection. The terminal will open in the chosen folder's directory.

The folder resolution behavior when opening the panel is controlled by the `terminalRecipes.multiRootFolderResolution` setting. See the [Settings Reference](settings.md) for details.

---

### Can I back up my commands or share them with my team?

Yes. Simply copy `~/.vscode-terminal-recipes/commands.json` to a safe location or commit it to a shared repository. To restore, replace the file at the same path. Anyone with this file can import your full set of commands by placing it at the same path on their machine.

---

### What is the difference between Run, Use, and Copy?

| Action   | What it does                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Run**  | Sends the resolved command to the terminal and executes it immediately. A confirmation dialog appears first.              |
| **Use**  | Pastes the resolved command into the terminal input without pressing Enter — so you can review or edit it before running. |
| **Copy** | Copies the resolved command to your clipboard. Nothing is sent to the terminal.                                           |

---

## Variables

### How do the three variable scopes work?

Every variable in a command can be saved in one of three independent scopes. The **Local / Off / Global** toggle on each variable row controls which scope is active for that variable:

| Scope      | Where the value is saved                                                | When to use it                                                                                            |
| ---------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Local**  | `.vscode/terminal-recipes.data.json` inside your current project folder | When the value is specific to this project (e.g. a database name, a port number that differs per project) |
| **Global** | `~/.vscode-terminal-recipes/data.json` in your home directory           | When you use the same value across all your projects (e.g. your username, a shared server address)        |
| **Off**    | In memory only — never written to disk                                  | When you want to fill in a value just for this session without saving it anywhere                         |

Switching the toggle does **not** delete the value stored in the other scopes — each scope stores its value independently.

---

### What are Auto Variables?

Auto Variables are built-in variables that are resolved automatically without any input from you:

| Variable             | Resolved value                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `${date}`            | Today's date (configurable format)                                                                                                      |
| `${username}`        | Your operating system username                                                                                                          |
| `${workspaceFolder}` | The full path to the active workspace folder. In multi-root workspaces, reflects the folder selected in the panel's workspace selector. |
| `${workspaceName}`   | The folder name (basename) of the active workspace folder. In multi-root workspaces, reflects the selected folder.                      |

> **Multi-root workspaces:** `${workspaceFolder}` and `${workspaceName}` always reflect the folder that is currently active in the panel. Switching the workspace folder dropdown updates these values for all subsequent command executions. You can also override them per-execution in the Run confirmation dialog.

---

### What are Enum Variables?

Enum Variables let you define a fixed list of allowed values for a variable. Instead of typing a value manually, a dropdown appears with your predefined options when you run or use the command. This is useful for variables like `${env}` (with options: `dev`, `staging`, `production`) or `${region}`.

To define enum options, open the **Edit Command** form for any command and click the enum manager icon next to the variable name.

---

## AI Assistant

### How do I get an API key for the AI assistant?

Each provider has a free option to get started:

| Provider          | Get API Key                                                                         |
| ----------------- | ----------------------------------------------------------------------------------- |
| **Google Gemini** | [aistudio.google.com](https://aistudio.google.com/) — free tier available           |
| **DeepSeek**      | [platform.deepseek.com](https://platform.deepseek.com/) — free tier + very low cost |
| **Groq**          | [console.groq.com](https://console.groq.com/) — free tier with fast inference       |
| **Mistral AI**    | [console.mistral.ai](https://console.mistral.ai/) — free models available           |
| **Cohere**        | [dashboard.cohere.com](https://dashboard.cohere.com/) — free trial available        |
| **StepFun**       | [platform.stepfun.com](https://platform.stepfun.com/) — free model available        |
| **OpenAI**        | [platform.openai.com](https://platform.openai.com/) — paid                          |
| **Anthropic**     | [console.anthropic.com](https://console.anthropic.com/) — paid                      |

Once you have a key, open the panel → click **AI Settings** (⚙️ icon) → select your provider → paste the key → click **Save API Key**.

---

### How do I generate commands with AI?

1. Go to the **Categories & Groups** tab and select a category and group.
2. Click **Create with AI** — or go to the **Commands** tab and click **Add with AI**.
3. Describe what you want in plain language (e.g. "commands to manage a MySQL database").
4. The AI generates a set of commands. Review them, select the ones you want, and click **Insert**.

---

### What does the AI Explain button do?

The **Explain** button (available on each command row) sends the raw command template to the AI and returns a structured breakdown explaining what it does, what each part means, practical examples, and any warnings. The explanation appears directly inside the panel as formatted text.

---

## Troubleshooting

### A command runs in the wrong shell on Windows

By default, the extension uses your active VS Code terminal profile. If you need to run a specific command in a specific shell (e.g. PowerShell vs CMD vs Git Bash), use the **shell selector** dropdown in the Run confirmation dialog to choose the target shell before confirming.

### The panel is not opening

Use the Command Palette (`Ctrl+Shift+P`) and run **Terminal Recipes: Open Panel**, or press `F4 F4` (two consecutive presses of the F4 key).

---

## Related

- [Back to README](../README.md)
- [Settings Reference](settings.md)
