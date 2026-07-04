# AI Shell-Context Generation — Evaluation & Test Cases

> A documentation of the shell-aware AI command generation feature in **RunBox**, including real-world stress tests designed to evaluate how accurately the AI model respects the target shell when generating commands.

---

## Overview

RunBox supports AI-assisted command generation via the **"Add with AI"** and **"Create with AI"** buttons. When a user submits a natural-language prompt, the extension sends it to the configured AI provider alongside a **system instruction** that includes the target shell environment.

The core premise of this feature is:

> **The AI must generate commands that are valid and executable in the specified shell — not in any other shell, regardless of how the prompt is worded.**

This means the same prompt sent twice — once targeting `PowerShell` and once targeting `Git Bash` — should yield syntactically different commands. A prompt mentioning "Linux-style" while targeting `CMD` must still produce a `CMD`-native command.

---

## How It Works

### 1. Shell Selection

When the AI prompt modal opens, a **"Generate commands for"** selector appears above the textarea. It is automatically pre-filled with the user's VS Code default terminal profile. The user can change it before generating.

```
┌─────────────────────────────────────────────────────────────────┐
│  ✨ Add a single command to group: General in: File Management   │
│                                                                  │
│  Describe what you need          Generate commands for: [▼]      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  A command to find and delete all .log files             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  🔗 gemini-flash-latest          [✨ Generate]  [Cancel]        │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Shell Context Injection

The selected shell name is appended to the system instruction before the request is sent to the AI:

```
SHELL ENVIRONMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The user's target shell is: PowerShell

You MUST generate commands that are valid and executable in this specific shell.
Do NOT mix shell syntaxes. Use only the native built-in commands for the target shell.
```

### 3. Variable System

The AI may wrap dynamic values in `${VariableName}` syntax. There are two types:

| Type               | Description              | Example                                               |
| ------------------ | ------------------------ | ----------------------------------------------------- |
| **Free Input (A)** | User types any value     | `${DirectoryPath}`, `${BranchName}`                   |
| **Enum (B)**       | Fixed documented options | `--loglevel=${LogLevel}` → `silent\|error\|warn\|...` |

---

## Test Suite

The following 10 tests were designed to stress-test the model's ability to respect the target shell. Each test includes a deliberately challenging prompt (a "trap") intended to confuse or misdirect the model.

---

### Test 1 — Recursive File Deletion

| Field               | Value                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt**          | `A command to find all .log files recursively in a directory and delete them`                                                                                                    |
| **Target Shell**    | `Git Bash`                                                                                                                                                                       |
| **Trap**            | This is the "classic trap": a request that sounds perfectly natural in a Unix context. If the model ignores the shell context, it might generate a PowerShell or CMD equivalent. |
| **Expected Result** | `find` with `-delete` flag — a POSIX command native to Bash environments                                                                                                         |

**AI Response:**

```
Title:   Find and Delete Log Files Recursively
Desc:    Recursively searches for and deletes all .log files starting from the
         specified directory in Git Bash.
Command: find ${DirectoryPath} -type f -name "*.log" -delete
```

**Evaluation:** ✅ **Excellent.** The model used the correct Unix command and explicitly acknowledged Git Bash in the description. The variable `${DirectoryPath}` is correctly typed as free input.

---

### Test 2 — Same Prompt, Different Shell

| Field               | Value                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Prompt**          | `A command to find all .log files recursively in a directory and delete them`                                                                                      |
| **Target Shell**    | `PowerShell`                                                                                                                                                       |
| **Trap**            | Identical prompt to Test 1. The only change is the target shell. This is the most revealing test: if the system works, the output must be syntactically different. |
| **Expected Result** | `Get-ChildItem` piped into `Remove-Item` — PowerShell native cmdlets                                                                                               |

**AI Response:**

```
Title:   Delete all .log files recursively
Desc:    Finds all files with a .log extension in the specified directory and
         its subdirectories, and deletes them.
Command: Get-ChildItem -Path ${DirectoryPath} -Filter "*.log" -Recurse | Remove-Item -Force
```

**Evaluation:** ✅ **Excellent.** Completely different output from Test 1, despite an identical prompt. This confirms that shell context injection is working as intended.

---

### Test 3 — Explicit Linux Hint in Prompt

| Field               | Value                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Prompt**          | `A command to grep for error messages in all .txt files, just like Linux grep`                                                                                           |
| **Target Shell**    | `PowerShell`                                                                                                                                                             |
| **Trap**            | The prompt explicitly says "just like Linux grep", nudging the model toward using the `grep` command. The model must ignore this hint and use the PowerShell equivalent. |
| **Expected Result** | `Select-String` — PowerShell's native text-searching cmdlet                                                                                                              |

**AI Response:**

```
Title:   Search for Text in Text Files (grep equivalent)
Desc:    Searches recursively for a specific pattern or error message inside all
         .txt files in a directory using PowerShell.
Command: Get-ChildItem -Path "${DirectoryPath}" -Filter "*.txt" -Recurse
         -ErrorAction SilentlyContinue | Select-String -Pattern "${Pattern}"
```

**Evaluation:** ✅ **Excellent.** The model correctly ignored the "just like Linux grep" phrasing, used `Select-String`, and even added `-ErrorAction SilentlyContinue` for robustness. The title acknowledges the `grep` context without misusing it.

---

### Test 4 — "Linux-style" Targeting CMD

| Field               | Value                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt**          | `A Linux-style command to list all files sorted by size in the current directory`                                                      |
| **Target Shell**    | `Command Prompt`                                                                                                                       |
| **Trap**            | The phrase "Linux-style" is embedded directly in the prompt while the target shell is CMD — the most restricted of all Windows shells. |
| **Expected Result** | `dir` with a sort flag — a CMD-native listing command                                                                                  |

**AI Response:**

```
Title:   List Files Sorted by Size
Desc:    Lists all files in the current directory sorted by size.
Command: dir /A /O:${SortOrder}
```

**Evaluation:** ⚠️ **Acceptable.** The model used a CMD-native `dir` command, which is correct. Making `${SortOrder}` a variable is a reasonable choice since the prompt did not specify ascending or descending order. The `/A` flag (show hidden files) was unnecessary for the request but is not harmful.

---

### Test 5 — Windows Paths in a Unix Shell

| Field               | Value                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt**          | `A command to copy all PDF files from C:\Users\Documents to C:\Backup`                                                                                                                      |
| **Target Shell**    | `Git Bash`                                                                                                                                                                                  |
| **Trap**            | The prompt uses Windows-style backslash paths (`C:\Users\...`), which are incompatible with Bash. The model must either abstract the paths into variables or use POSIX-compatible notation. |
| **Expected Result** | `cp` command (POSIX) with abstracted path variables                                                                                                                                         |

**AI Response:**

```
Title:   Copy PDF Files in Git Bash
Desc:    Copies all PDF files from a source directory to a destination directory
         using POSIX paths in Git Bash.
Command: cp "${SourceDirectory}"/*.pdf "${DestinationDirectory}"
```

**Evaluation:** ✅ **Smart.** The model abstracted both Windows paths into `${SourceDirectory}` and `${DestinationDirectory}` variables (free input), used the correct POSIX `cp` command, and even documented the POSIX path requirement in the description.

---

### Test 6 — Unix Archive Format on Windows

| Field               | Value                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt**          | `A command to compress a folder into a .tar.gz file`                                                                                           |
| **Target Shell**    | `PowerShell`                                                                                                                                   |
| **Trap**            | `.tar.gz` is a Unix-origin archive format. PowerShell's native `Compress-Archive` only produces `.zip`. Can the model find a correct solution? |
| **Expected Result** | Either a `tar.exe` invocation (available natively on Windows 10+) or `Compress-Archive` with a note                                            |

**AI Response:**

```
Title:   Compress Folder to TAR.GZ
Desc:    Compresses a folder into a .tar.gz archive using the native tar utility
         available in PowerShell.
Command: tar -czvf "${ArchiveName}.tar.gz" "${FolderName}"
```

**Evaluation:** ⚠️ **Conditionally correct.** Microsoft shipped `tar.exe` natively with Windows 10 (build 1803+) and Windows Server 2019+. The command is valid in modern environments. On older systems it would fail silently. The description correctly notes "native tar utility available in PowerShell", which frames the expectation accurately.

---

### Test 7 — Process Analysis in CMD

| Field               | Value                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt**          | `A command to count the number of running processes and show only the top 5 by memory usage`                                                                                        |
| **Target Shell**    | `Command Prompt`                                                                                                                                                                    |
| **Trap**            | This request is **natively impossible** in pure CMD — the shell has no built-in process sorting or memory inspection. This tests whether the model can find a practical workaround. |
| **Expected Result** | Any working solution; CMD alone cannot satisfy this requirement                                                                                                                     |

**AI Response:**

```
Title:   Count Processes and Show Top 5 by Memory
Desc:    Counts the total number of running processes and displays the top 5
         processes consuming the most memory.
Command: powershell -Command "$proc = Get-Process; Write-Host 'Total Running
         Processes: ' $proc.Count; Write-Host ''; Write-Host 'Top 5 Processes
         by Memory Usage:'; $proc | Sort-Object WorkingSet64 -Descending |
         Select-Object -First 5 | Format-Table Name, Id,
         @{Name='Memory(MB)';Expression={[math]::round($_.WorkingSet64/1MB,2)}}"
```

**Evaluation:** ✅ **Pragmatic and correct.** The model recognized that CMD alone cannot fulfil this request and invoked `powershell -Command` as a subprocess — a well-known and widely-used pattern on Windows. Since the extension does not support back-and-forth conversation ("I cannot do this, do you want X instead?"), generating a working solution through any available means is the right call.

---

### Test 8 — Windows PowerShell vs PowerShell

| Field               | Value                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt**          | `A command to kill all processes named "chrome" using a one-liner`                                                                                          |
| **Target Shell**    | `Windows PowerShell`                                                                                                                                        |
| **Trap**            | Subtle distinction: `Windows PowerShell` (5.x, built into Windows) versus `PowerShell` (7.x, cross-platform). Does the model differentiate between the two? |
| **Expected Result** | `Stop-Process` cmdlet — valid in both PowerShell versions                                                                                                   |

**AI Response:**

```
Title:   Kill All Chrome Processes
Desc:    Forcefully terminates all active Google Chrome processes running
         on the system.
Command: Stop-Process -Name "chrome" -Force
```

**Evaluation:** ✅ **Excellent.** Clean, correct, idiomatic PowerShell. The `Stop-Process` cmdlet exists identically in both Windows PowerShell 5.x and PowerShell 7.x, so the distinction is correctly handled by using a universally compatible command.

---

### Test 9 — Real-Time Log Monitoring

| Field               | Value                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt**          | `A command to watch a log file in real time and filter lines that contain the word ERROR, similar to what you'd do on a Linux server` |
| **Target Shell**    | `Git Bash`                                                                                                                            |
| **Trap**            | The phrase "similar to what you'd do on a Linux server" is included to test whether the model uses Git Bash-compatible Unix commands. |
| **Expected Result** | `tail -f` piped into `grep` — standard Unix tools available in Git Bash                                                               |

**AI Response:**

```
Title:   Watch Log File and Filter Lines
Desc:    Monitors a log file in real-time and uses grep to filter lines that
         match (or exclude) a specific keyword like ERROR.
Command: tail -f "${LogFilePath}" | grep ${MatchOption} ${CaseOption} "${FilterPattern}"
```

**Evaluation:** ✅ **Correct shell syntax.** The model correctly used `tail -f | grep` and stayed true to Git Bash.

> **⚠️ Note on variable quality:** `${MatchOption}` and `${CaseOption}` were defined as Enum variables with a single value each (`-v` and `-i` respectively). A single-value Enum is a logical contradiction — if only one value exists, there is nothing to choose from. These flags should have been written directly in the command string:
>
> ```bash
> tail -f "${LogFilePath}" | grep -v -i "${FilterPattern}"
> ```
>
> This is a known edge case in the Enum detection logic of the system instruction and will be addressed in a future improvement.

---

### Test 10 — Ignoring Explicit Shell Instructions in the Prompt

| Field               | Value                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt**          | `A command to recursively find all node_modules folders and remove them to free disk space, use rm -rf style`                                                                                             |
| **Target Shell**    | `PowerShell`                                                                                                                                                                                              |
| **Trap**            | The most direct challenge: the user explicitly requests "`rm -rf` style" while the shell is PowerShell. The model must discard the user's stylistic instruction and generate a native PowerShell command. |
| **Expected Result** | `Get-ChildItem` with `-Directory -Recurse` piped into `Remove-Item -Force -Recurse`                                                                                                                       |

**AI Response:**

```
Title:   Recursively Delete node_modules Folders
Desc:    Finds and recursively deletes all 'node_modules' directories starting
         from a specific path to free up disk space in PowerShell.
Command: Get-ChildItem -Path "${StartPath}" -Filter "node_modules" -Directory
         -Recurse | Remove-Item -Force -Recurse
```

**Evaluation:** ✅ **Excellent.** The model completely ignored the "rm -rf style" directive and produced idiomatic, safe PowerShell. The `-Directory` filter ensures only folders are targeted, and the description explicitly names PowerShell as the runtime.

---

## Results Summary

| #   | Shell              | Trap Type                           | Result                            |
| --- | ------------------ | ----------------------------------- | --------------------------------- |
| 1   | Git Bash           | Classic Unix command request        | ✅ Passed                         |
| 2   | PowerShell         | Identical prompt, different shell   | ✅ Passed                         |
| 3   | PowerShell         | Explicit "Linux grep" mention       | ✅ Passed                         |
| 4   | CMD                | "Linux-style" in prompt             | ⚠️ Acceptable                     |
| 5   | Git Bash           | Windows-style paths                 | ✅ Passed                         |
| 6   | PowerShell         | Unix archive format (.tar.gz)       | ⚠️ Conditionally correct          |
| 7   | CMD                | Impossible in pure CMD              | ✅ Pragmatic solution             |
| 8   | Windows PowerShell | Version distinction                 | ✅ Passed                         |
| 9   | Git Bash           | "like a Linux server" phrasing      | ✅ Passed (variable quality note) |
| 10  | PowerShell         | Explicit "rm -rf style" instruction | ✅ Passed                         |

**8 full passes · 2 acceptable with notes · 0 failures**

---

## Conclusions

The shell-context injection mechanism performs reliably across a wide range of adversarial prompts. The model consistently prioritizes the declared shell over conflicting hints embedded in the prompt text.

Key observations:

- **Shell override works** — explicit mentions of other shells ("Linux grep", "rm -rf style") do not derail the output.
- **Cross-shell prompts are differentiated** — the same prompt targeting different shells produces meaningfully different commands (Tests 1 & 2).
- **CMD limitations are handled pragmatically** — when a request exceeds CMD's native capabilities, the model uses a `powershell -Command` subprocess rather than failing.
- **Enum variable quality needs refinement** — the model occasionally creates Enum variables with a single documented value. A variable with only one option is logically equivalent to a constant and should be written inline. This will be addressed by extending the system instruction with an explicit rule.

---

_Generated as part of the RunBox extension development process._
_Shell-aware AI generation feature — `lib/ai/factory.js` · `lib/ai/systemInstruction.js`_
