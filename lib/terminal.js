/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// lib/terminal.js
// Terminal shell resolution and lifecycle management.
// Fully isolated from file I/O and data normalization.

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

// Helper processes that belong to the terminal plumbing itself, not to a
// command running inside the shell. Compared after `normalizeProcessName`.
const CONSOLE_HELPER_PROCESSES = new Set(["conhost", "openconsole"]);

// Upper bound for waiting on `Terminal.processId`, so a terminal that never
// reports its process can not block a run request.
const PROCESS_ID_TIMEOUT_MS = 2000;

// Terminals with a shell-integration-reported command currently running.
const runningTerminals = new Set();
// Terminals for which at least one execution was observed from start to end.
// Only then can "no running command" be trusted: a command that started before
// the listeners were registered, or before shell integration activated, never
// produced a start event and would otherwise look idle.
const provenTerminals = new Set();

/**
 * Fixes a shell executable path on Windows by replacing the 32-bit Sysnative alias
 * with the actual 64-bit System32 path to avoid process resolution issues.
 * @param {string} rawPath
 * @returns {string}
 */
function fixShellPath(rawPath) {
  if (typeof rawPath !== "string") {
    return rawPath;
  }
  // Replace Sysnative (32-bit alias) with System32 (actual 64-bit path)
  return rawPath.replace(/\\Sysnative\\/i, "\\System32\\");
}

/**
 * Resolves the shell executable path for a named VS Code terminal profile source
 * (e.g. 'PowerShell', 'Git Bash', 'WSL') on Windows.
 * Returns null if the source is unrecognized or the platform is not Windows.
 * @param {string} source - The profile source name from VS Code settings
 * @returns {string|null}
 */
function resolveSourceProfilePath(source) {
  const platform = process.platform;

  if (platform === "win32") {
    if (source === "PowerShell") {
      // PowerShell 7+ has multiple possible install locations depending on the
      // package used (see Microsoft's official install methods):
      // - MSI package: fixed path under "Program Files"
      // - WinGet/MSIX package (the method Microsoft recommends for Windows
      //   clients, winget install --id Microsoft.PowerShell): resolves through
      //   the per-user app execution alias, independent of the exact version
      const pwsh7Candidates = ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", path.join(process.env.LOCALAPPDATA || "", "Microsoft\\WindowsApps\\pwsh.exe")];
      for (const candidate of pwsh7Candidates) {
        if (!candidate) {
          continue;
        }
        try {
          fs.accessSync(candidate);
          return candidate;
        } catch {}
      }
      return "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    }

    if (source === "Command Prompt") {
      return "C:\\Windows\\System32\\cmd.exe";
    }

    if (source === "Git Bash") {
      const candidates = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"];
      for (const p of candidates) {
        try {
          fs.accessSync(p);
          return p;
        } catch {}
      }
      return null;
    }

    if (source === "WSL" || source === "WSL Bash") {
      return "C:\\Windows\\System32\\wsl.exe";
    }
  }

  return null;
}

/**
 * Reads the terminal profiles configured in VS Code settings for the current platform.
 * Returns a list of profiles with their resolved shell paths, and the default profile name.
 * @returns {{ defaultProfile: string, profiles: Array<{name: string, shellPath: string}> }}
 */
function getTerminalProfiles() {
  const platform = process.platform;
  const profileKey = platform === "win32" ? "windows" : platform === "darwin" ? "osx" : "linux";

  const defaultProfileName = vscode.workspace.getConfiguration("terminal.integrated.defaultProfile").get(profileKey) || "";

  const rawProfiles = vscode.workspace.getConfiguration("terminal.integrated.profiles").get(profileKey) || {};

  const profiles = [];

  for (const [name, config] of Object.entries(rawProfiles)) {
    if (!config || typeof config !== "object") {
      continue;
    }

    let shellPath = null;

    // Prefer explicit path
    if (config.path) {
      const rawPath = Array.isArray(config.path) ? config.path[0] : config.path;
      if (typeof rawPath === "string" && rawPath) {
        shellPath = fixShellPath(rawPath);
      }
    }

    // Fall back to resolving from source
    if (!shellPath && config.source) {
      shellPath = resolveSourceProfilePath(config.source);
    }

    if (!shellPath) {
      continue;
    }

    profiles.push({ name, shellPath, shellType: detectShellType(shellPath) });
  }

  return {
    defaultProfile: defaultProfileName,
    profiles,
  };
}

/**
 * Normalizes a process name for comparison: lowercase, without a ".exe" suffix.
 * @param {string} name
 * @returns {string}
 */
function normalizeProcessName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\.exe$/, "");
}

/**
 * Decides from a process snapshot whether a command is running in the
 * foreground of the shell whose process id is `shellPid`.
 *
 * A shell with no descendant processes (ignoring console helper processes such
 * as conhost) is idle; any other descendant is a running command.
 *
 * Returns `null` when the snapshot cannot answer reliably:
 *  - the shell process is not in the snapshot;
 *  - the shell is `wsl`: Linux processes inside WSL are invisible to the
 *    Windows process table, so busy and idle look identical.
 *
 * On Windows, Git Bash's `bin\bash.exe` is a launcher that keeps exactly one
 * `bash.exe` child while idle, so a single `bash` descendant is the idle state
 * there. A running command always adds further descendants below it.
 *
 * @param {number} shellPid
 * @param {Array<{pid: number, ppid: number, name: string}>} processes
 * @param {string} [platform] - Defaults to `process.platform`
 * @returns {boolean|null}
 */
function isShellProcessBusy(shellPid, processes, platform) {
  const hostPlatform = platform || process.platform;
  const root = processes.find(function (p) {
    return p.pid === shellPid;
  });
  if (!root) {
    return null;
  }

  const rootName = normalizeProcessName(root.name);
  if (rootName === "wsl") {
    return null;
  }

  const childrenByParent = new Map();
  for (const proc of processes) {
    if (!childrenByParent.has(proc.ppid)) {
      childrenByParent.set(proc.ppid, []);
    }
    childrenByParent.get(proc.ppid).push(proc);
  }

  const descendants = [];
  const visited = new Set([shellPid]);
  const queue = [shellPid];
  while (queue.length > 0) {
    const parentPid = queue.shift();
    for (const child of childrenByParent.get(parentPid) || []) {
      if (visited.has(child.pid) || CONSOLE_HELPER_PROCESSES.has(normalizeProcessName(child.name))) {
        continue;
      }
      visited.add(child.pid);
      descendants.push(child);
      queue.push(child.pid);
    }
  }

  if (hostPlatform === "win32" && rootName === "bash") {
    const isIdleLauncher = descendants.length === 1 && normalizeProcessName(descendants[0].name) === "bash";
    return descendants.length > 0 && !isIdleLauncher;
  }

  return descendants.length > 0;
}

/**
 * Combines every available signal into one verdict for a terminal.
 *
 * - `busy`    : must not receive a new command (exited, or a command is running).
 * - `idle`    : safe to receive a new command.
 * - `unknown` : no signal could tell; callers must treat it as busy.
 *
 * Shell integration is the most precise signal but is only trusted once an
 * execution of this terminal was observed to finish (`integrationTrusted`).
 * The process-tree verdict (`processBusy`) covers every other terminal.
 *
 * @param {{ exited: boolean, running: boolean, integrationTrusted: boolean, processBusy: boolean|null }} signals
 * @returns {"busy"|"idle"|"unknown"}
 */
function classifyTerminalBusy(signals) {
  if (signals.exited || signals.running) {
    return "busy";
  }
  if (signals.integrationTrusted) {
    return "idle";
  }
  if (signals.processBusy === true) {
    return "busy";
  }
  if (signals.processBusy === false) {
    return "idle";
  }
  return "unknown";
}

/**
 * Reads a snapshot of all running processes on the host the extension runs on.
 * Resolves to `null` when the snapshot cannot be read.
 * @returns {Promise<Array<{pid: number, ppid: number, name: string}>|null>}
 */
async function readProcessSnapshot() {
  try {
    if (process.platform === "win32") {
      const powershellPath = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Csv -NoTypeInformation";
      const { stdout } = await execFileAsync(powershellPath, ["-NoProfile", "-NonInteractive", "-Command", script], {
        windowsHide: true,
        timeout: 8000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const processes = [];
      for (const line of stdout.split(/\r?\n/)) {
        const match = /^"(\d+)","(\d+)","(.*)"$/.exec(line.trim());
        if (match) {
          processes.push({ pid: Number(match[1]), ppid: Number(match[2]), name: match[3] });
        }
      }
      return processes.length > 0 ? processes : null;
    }

    if (process.platform === "linux") {
      const entries = await fs.promises.readdir("/proc");
      const reads = entries
        .filter(function (entry) {
          return /^\d+$/.test(entry);
        })
        .map(async function (entry) {
          try {
            const stat = await fs.promises.readFile(`/proc/${entry}/stat`, "utf8");
            // Format: "<pid> (<comm>) <state> <ppid> ..." where <comm> may contain spaces or parentheses.
            const open = stat.indexOf("(");
            const close = stat.lastIndexOf(")");
            const rest = stat.slice(close + 2).split(" ");
            return { pid: Number(entry), ppid: Number(rest[1]), name: stat.slice(open + 1, close) };
          } catch {
            // The process exited between listing and reading; skip it.
            return null;
          }
        });
      const processes = (await Promise.all(reads)).filter(Boolean);
      return processes.length > 0 ? processes : null;
    }

    const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,comm="], { timeout: 8000, maxBuffer: 16 * 1024 * 1024 });
    const processes = [];
    for (const line of stdout.split("\n")) {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (match) {
        processes.push({ pid: Number(match[1]), ppid: Number(match[2]), name: match[3].replace(/^.*[\\/]/, "") });
      }
    }
    return processes.length > 0 ? processes : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a terminal's shell process id, giving up after PROCESS_ID_TIMEOUT_MS.
 * @param {import('vscode').Terminal} terminal
 * @returns {Promise<number|undefined>}
 */
async function readTerminalProcessId(terminal) {
  let timer;
  const timeout = new Promise(function (resolve) {
    timer = setTimeout(resolve, PROCESS_ID_TIMEOUT_MS, undefined);
  });
  try {
    return await Promise.race([Promise.resolve(terminal.processId), timeout]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the first candidate terminal that is safe to send a new command to,
 * or `undefined` when none is. A terminal whose state cannot be determined is
 * never returned. The process snapshot is read only when some candidate needs
 * it, and at most once.
 * @param {Array<import('vscode').Terminal>} candidates
 * @param {function(): Promise<Array<{pid: number, ppid: number, name: string}>|null>} readSnapshot
 * @returns {Promise<import('vscode').Terminal|undefined>}
 */
async function pickIdleTerminal(candidates, readSnapshot) {
  let snapshotPromise = null;

  for (const terminal of candidates) {
    const signals = {
      exited: terminal.exitStatus !== undefined,
      running: runningTerminals.has(terminal),
      integrationTrusted: provenTerminals.has(terminal) && Boolean(terminal.shellIntegration),
      processBusy: null,
    };

    let verdict = classifyTerminalBusy(signals);
    if (verdict === "unknown") {
      const pid = await readTerminalProcessId(terminal);
      if (pid) {
        if (!snapshotPromise) {
          snapshotPromise = readSnapshot();
        }
        const snapshot = await snapshotPromise;
        signals.processBusy = snapshot ? isShellProcessBusy(pid, snapshot) : null;
        verdict = classifyTerminalBusy(signals);
      }
    }

    if (verdict === "idle") {
      return terminal;
    }
  }

  return undefined;
}

/**
 * Starts tracking which terminals have a command running, using the shell
 * integration events (VS Code 1.93+; skipped on older versions, where the
 * process-tree check alone is used). Call once during activation.
 * @param {import('vscode').ExtensionContext} context
 */
function initTerminalTracking(context) {
  const win = vscode.window;
  const disposables = [];

  if (typeof win.onDidStartTerminalShellExecution === "function") {
    disposables.push(
      win.onDidStartTerminalShellExecution(function (event) {
        runningTerminals.add(event.terminal);
      })
    );
  }
  if (typeof win.onDidEndTerminalShellExecution === "function") {
    disposables.push(
      win.onDidEndTerminalShellExecution(function (event) {
        runningTerminals.delete(event.terminal);
        provenTerminals.add(event.terminal);
      })
    );
  }
  if (typeof win.onDidCloseTerminal === "function") {
    disposables.push(
      win.onDidCloseTerminal(function (terminal) {
        runningTerminals.delete(terminal);
        provenTerminals.delete(terminal);
      })
    );
  }

  context.subscriptions.push({
    dispose: function () {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      runningTerminals.clear();
      provenTerminals.clear();
    },
  });
}

/**
 * Returns an idle matching terminal or creates a new one with the given shell.
 * If no shellPath is provided, falls back to the user's default terminal profile.
 *
 * Reuse logic: among the open terminals whose name and cwd match the requested
 * combination, the first one that is verifiably idle is reused. A terminal that
 * is busy (for example running a server), has exited, or whose state cannot be
 * determined is skipped, because text sent to it would reach the running
 * process instead of the shell. A new terminal is created only when no matching
 * terminal is idle, so terminals do not accumulate beyond the number of
 * commands that are actually running at the same time.
 *
 * @param {string|undefined} shellPath - Path to the shell executable
 * @param {string|undefined} shellName - Display name for the terminal tab
 * @param {string|undefined} cwd - Working directory for the new terminal
 * @returns {Promise<import('vscode').Terminal>}
 */
async function getOrCreateTerminal(shellPath, shellName, cwd) {
  // Resolve the terminal name and default profile up-front so both the reuse
  // check and the createTerminal call use the exact same name.
  let terminalName;
  let resolvedShellPath;

  if (shellPath) {
    terminalName = shellName ? `RunBox (${shellName})` : "RunBox";
    resolvedShellPath = shellPath;
  } else {
    const { defaultProfile: defaultProfileName, profiles } = getTerminalProfiles();
    const defaultEntry = profiles.find(function (p) {
      return p.name === defaultProfileName;
    });
    terminalName = defaultEntry ? `RunBox (${defaultEntry.name})` : "RunBox";
    resolvedShellPath = defaultEntry ? defaultEntry.shellPath : undefined;
  }

  // Reuse an existing terminal only when name and cwd both match and it is idle.
  // creationOptions.cwd may be a string or a vscode.Uri — normalise to string for comparison.
  const normalizedCwd = cwd || "";
  const candidates = vscode.window.terminals.filter(function (t) {
    if (t.name !== terminalName) {
      return false;
    }
    const opts = t.creationOptions || {};
    const termCwd = opts.cwd instanceof Object ? opts.cwd.fsPath || "" : opts.cwd || "";
    return termCwd === normalizedCwd;
  });

  const existing = await pickIdleTerminal(candidates, readProcessSnapshot);
  if (existing) {
    return existing;
  }

  return vscode.window.createTerminal({
    name: terminalName,
    ...(resolvedShellPath ? { shellPath: resolvedShellPath } : {}),
    ...(cwd ? { cwd } : {}),
  });
}

/**
 * Classifies a shell executable path into a standardized shell type identifier.
 * Used to tag AI-generated commands with the shell they were written for,
 * and to match terminal profiles against that classification later.
 *
 * PowerShell 7+ (`pwsh.exe`) and Windows PowerShell 5.1 (`powershell.exe`) are
 * classified separately: they are genuinely different, independently installed
 * programs with real syntax/feature differences, not just a version number.
 * @param {string|null|undefined} shellPath - Full path to the shell executable
 * @returns {string|null} One of: "pwsh", "powershell", "cmd", "bash", "wsl", "zsh", "sh" — or null if unrecognized
 */
function detectShellType(shellPath) {
  if (typeof shellPath !== "string" || !shellPath) {
    return null;
  }

  // Use an OS-agnostic basename extraction instead of the platform-dependent
  // path.basename (which is path.win32 on Windows but path.posix on Linux/macOS).
  // Shell paths here can be either style (e.g. "C:\...\cmd.exe" or "/bin/sh"),
  // and detection must behave identically regardless of the host OS running Node.
  const base = shellPath.replace(/^.*[\\/]/, "").toLowerCase();

  if (base.includes("pwsh")) {
    return "pwsh";
  }
  if (base.includes("powershell")) {
    return "powershell";
  }
  if (base.startsWith("cmd")) {
    return "cmd";
  }
  if (base.includes("wsl")) {
    return "wsl";
  }
  if (base.includes("bash")) {
    return "bash";
  }
  if (base.includes("zsh")) {
    return "zsh";
  }
  if (base === "sh" || base === "sh.exe") {
    return "sh";
  }

  return null;
}

/**
 * Groups terminal profile names that resolve to the exact same shell executable
 * path. VS Code allows multiple profile entries to point at the same underlying
 * shellPath (e.g. a custom "PowerShell" profile pointing at the same
 * powershell.exe as the built-in "Windows PowerShell" profile), which makes
 * picking between them in the run confirmation dialog a no-op. Used only to
 * detect and surface this situation to the user; never used to alter any
 * profile or restrict any selection.
 * @param {Array<{name: string, shellPath: string}>} profiles
 * @returns {string[][]} Groups of 2+ profile names sharing the same shellPath.
 *   Empty array when there is no duplication.
 */
function findDuplicateShellProfiles(profiles) {
  const namesByPath = new Map();

  for (const profile of profiles || []) {
    if (!profile || typeof profile.shellPath !== "string" || !profile.shellPath) {
      continue;
    }
    if (!namesByPath.has(profile.shellPath)) {
      namesByPath.set(profile.shellPath, []);
    }
    namesByPath.get(profile.shellPath).push(profile.name);
  }

  return Array.from(namesByPath.values()).filter(function (names) {
    return names.length > 1;
  });
}

module.exports = {
  fixShellPath,
  resolveSourceProfilePath,
  getTerminalProfiles,
  getOrCreateTerminal,
  initTerminalTracking,
  isShellProcessBusy,
  classifyTerminalBusy,
  pickIdleTerminal,
  detectShellType,
  findDuplicateShellProfiles,
};
