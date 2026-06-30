# Terminal Recipes — Settings Reference

All settings are available via **File → Preferences → Settings** → search for `Terminal Recipes`, or by editing your `settings.json` directly.

---

## Settings

| Setting                                     | Type      | Default      | Description                                                                                                                                                                             |
| ------------------------------------------- | --------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terminalRecipes.aiProvider`                | `string`  | `"gemini"`   | The AI provider used for generating and explaining terminal commands. Accepted values: `gemini`, `openai`, `anthropic`, `deepseek`, `groq`, `mistral`, `cohere`, `stepfun`.             |
| `terminalRecipes.aiModel`                   | `string`  | `""`         | The model ID for the selected AI provider. Leave empty to use the provider's default model. This is set automatically when you pick a model in **AI Settings** inside the panel.        |
| `terminalRecipes.customSystemInstructions`  | `string`  | `""`         | Custom instructions for the AI command generator. Replaces the default prompt entirely. Leave empty to use the built-in instructions. Supports multi-line text.                         |
| `terminalRecipes.debugOutput`               | `boolean` | `false`      | Enables detailed debug logging in the **Terminal Recipes** Output Channel. Useful for diagnosing AI request failures, model listing errors, and other internal events.                  |
| `terminalRecipes.multiRootFolderResolution` | `string`  | `"remember"` | Controls how the active workspace folder is determined when opening the panel in a **multi-root workspace**. Has no effect in single-folder workspaces. See values below.               |
| `terminalRecipes.localWorkspaceFilesPath`   | `string`  | `""`         | Relative path from the workspace root for extension-local files (variables, favorites, etc.). When empty, files are stored in `.vscode/`. Example: `.temp` or `.temp/terminal-recipes`. |

### `terminalRecipes.multiRootFolderResolution` values

| Value                    | Behavior                                                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"remember"` _(default)_ | On first open, uses the active editor's folder (or the first folder if no editor is active). After you pick a folder from the dropdown, that choice is remembered across sessions for this specific workspace. |
| `"followEditor"`         | Always uses the folder of the currently active text editor when opening the panel. Falls back to the last remembered selection if no editor is active.                                                         |
| `"alwaysFirst"`          | Always uses the first folder listed in the workspace. The folder selector dropdown is hidden.                                                                                                                  |

> **Note:** In single-folder workspaces, this setting has no effect — the only folder is always used.

---

## AI Providers

| Provider             | Free Tier                    | Notes                                         |
| -------------------- | ---------------------------- | --------------------------------------------- |
| **Google Gemini**    | ✅ Free models available     | Default provider. Recommended starting point. |
| **OpenAI ChatGPT**   | ❌ Paid                      | Requires an active OpenAI billing account.    |
| **Anthropic Claude** | ❌ Paid                      |                                               |
| **DeepSeek**         | ✅ Free tier + very low cost | Strong performance at minimal cost.           |
| **Groq**             | ✅ Free tier                 | Fast inference speed.                         |
| **Mistral AI**       | ✅ Free models available     |                                               |
| **Cohere**           | ✅ Free trial available      |                                               |
| **StepFun**          | ✅ Free model available      |                                               |

> **Tip:** To get started for free, select **Gemini**, **DeepSeek**, or **Groq** as your provider.

---

## Configuring via `settings.json`

```json
{
  "terminalRecipes.aiProvider": "gemini",
  "terminalRecipes.aiModel": "",
  "terminalRecipes.customSystemInstructions": "",
  "terminalRecipes.debugOutput": false,
  "terminalRecipes.multiRootFolderResolution": "remember",
  "terminalRecipes.localWorkspaceFilesPath": ""
}
```

---

## Related

- [Back to README](../README.md)
- [Frequently Asked Questions](faqs.md)
