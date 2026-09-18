/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// lib/terminal.js
// Terminal shell resolution and lifecycle management.
// Fully isolated from file I/O and data normalization.

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

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
      const pwsh7Candidates = [
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        path.join(process.env.LOCALAPPDATA || "", "Microsoft\\WindowsApps\\pwsh.exe"),
      ];
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

  const defaultProfileName =
    vscode.workspace.getConfiguration("terminal.integrated.defaultProfile").get(profileKey) || "";

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
 * Returns an existing matching terminal or creates a new one with the given shell.
 * If no shellPath is provided, falls back to the user's default terminal profile.
 *
 * Reuse logic: searches all open terminals for one whose name and cwd match the
 * requested combination. A mismatch on either dimension forces a new terminal.
 * This avoids accumulating duplicate terminals when the same command is run
 * repeatedly with the same shell and workspace folder.
 *
 * @param {string|undefined} shellPath - Path to the shell executable
 * @param {string|undefined} shellName - Display name for the terminal tab
 * @param {string|undefined} cwd - Working directory for the new terminal
 * @returns {import('vscode').Terminal}
 */
function getOrCreateTerminal(shellPath, shellName, cwd) {
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

  // Reuse an existing terminal only when name and cwd both match.
  // creationOptions.cwd may be a string or a vscode.Uri — normalise to string for comparison.
  const normalizedCwd = cwd || "";
  const existing = vscode.window.terminals.find(function (t) {
    if (t.name !== terminalName) {
      return false;
    }
    const opts = t.creationOptions || {};
    const termCwd = opts.cwd instanceof Object ? opts.cwd.fsPath || "" : opts.cwd || "";
    return termCwd === normalizedCwd;
  });

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
  detectShellType,
  findDuplicateShellProfiles,
};
