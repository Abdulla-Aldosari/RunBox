# RunBox: Settings Reference

All settings are available in the Settings UI (**File → Preferences → Settings**, then search for `RunBox`) or by editing your `settings.json` directly.

## Settings

| Setting                            | Type      | Default      | Description                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | --------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runBox.aiProvider`                | `string`  | `"gemini"`   | The AI provider used for generating and explaining terminal commands. Accepted values: `gemini`, `openai`, `anthropic`, `deepseek`, `groq`, `mistral`, `cohere`, `stepfun`.                                                                                                                                                                                                                                        |
| `runBox.aiModel`                   | `string`  | `""`         | The model ID for the selected AI provider. Leave empty to use the provider's default model. This is set automatically when you pick a model in **AI Settings** inside the panel.                                                                                                                                                                                                                                   |
| `runBox.aiGenerateLanguage`        | `string`  | `"English"`  | Language of AI-generated command text: titles, descriptions, and enum value labels. Commands, variable names, enum values, and category/group names are never translated. Accepted values: `English`, `Arabic`, `Chinese`, `Spanish`, `French`, `German`, `Japanese`, `Korean`, `Portuguese`, `Russian`, `Turkish`, `Hindi`.                                                                                       |
| `runBox.aiExplainLanguage`         | `string`  | `"English"`  | Default language of AI command explanations. Ctrl+click the explain button of a command to pick another language for a single explanation. Accepts the same values as `runBox.aiGenerateLanguage`.                                                                                                                                                                                                                 |
| `runBox.debugOutput`               | `boolean` | `false`      | Enables detailed debug logging in the **RunBox** Output Channel. Useful for diagnosing AI request failures, model listing errors, and other internal events.                                                                                                                                                                                                                                                       |
| `runBox.multiRootFolderResolution` | `string`  | `"remember"` | Controls how the active workspace folder is determined when opening the panel in a **multi-root workspace**. Has no effect in single-folder workspaces. See values below.                                                                                                                                                                                                                                          |
| `runBox.localWorkspaceFilesPath`   | `string`  | `""`         | Relative path from the workspace root for extension-local files (variables, favorites, etc.). When empty, files are stored in `.vscode/`. Example: `.temp` or `.temp/runbox`. Use forward slashes (`/`) as separators; backslashes also work but are normalized to forward slashes internally so the path resolves correctly on every OS. Changing this setting does not move existing files (see the note below). |
| `runBox.workspaceID`               | `string`  | `""`         | Auto-generated unique identifier that links the **Current Workspace** pseudo-category to this specific workspace folder. Created automatically the first time you add a group or command under **Current Workspace**, so you never need to set it manually. Do not copy this value between projects.                                                                                                               |

> **Note:** Changing `runBox.localWorkspaceFilesPath` does not move any existing variables or favorites files from the old location. If old files exist at the previous path (for example `.vscode/`), you must move them manually to the new path. Otherwise, the extension creates new empty files at the new path and the old files are no longer read.

### `runBox.multiRootFolderResolution` values

| Value                    | Behavior                                                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"remember"` _(default)_ | On first open, uses the active editor's folder (or the first folder if no editor is active). After you pick a folder from the dropdown, that choice is remembered across sessions for this specific workspace. |
| `"followEditor"`         | Always uses the folder of the currently active text editor when opening the panel. Falls back to the last remembered selection if no editor is active.                                                         |
| `"alwaysFirst"`          | Always uses the first folder listed in the workspace. The folder selector dropdown is hidden.                                                                                                                  |

> **Note:** In single-folder workspaces, this setting has no effect because the only folder is always used.

---

## AI Providers

| Provider             | Free Tier                 | Notes                                       |
| -------------------- | ------------------------- | ------------------------------------------- |
| **Google Gemini**    | Free models available     | Default provider and a good starting point. |
| **OpenAI ChatGPT**   | Paid                      | Requires an active OpenAI billing account.  |
| **Anthropic Claude** | Paid                      |                                             |
| **DeepSeek**         | Free tier + very low cost | Strong performance at minimal cost.         |
| **Groq**             | Free tier                 | Fast inference speed.                       |
| **Mistral AI**       | Free models available     |                                             |
| **Cohere**           | Free trial available      |                                             |
| **StepFun**          | Free model available      |                                             |

> **Tip:** To get started for free, select **Gemini**, **DeepSeek**, or **Groq** as your provider.

---

## Configuring via `settings.json`

```json
{
  "runBox.aiProvider": "gemini",
  "runBox.aiModel": "",
  "runBox.aiGenerateLanguage": "English",
  "runBox.aiExplainLanguage": "English",
  "runBox.debugOutput": false,
  "runBox.multiRootFolderResolution": "remember",
  "runBox.localWorkspaceFilesPath": "",
  "runBox.workspaceID": ""
}
```

---

## Related

- [Back to README](../README.md)
- [Frequently Asked Questions](faqs.md)
