/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// lib/ai/systemInstruction.js
// System instructions sent to the AI providers. Every instruction is built from
// shared rule blocks so the same rule is written exactly once:
//
//   COMMAND_RULES  -> how a command string is written (outline + single)
//   VALIDITY_RULE  -> which requests are rejected (outline + single)
//   DETAILS_RULES  -> title / description / helpUrl / variables (details + single)
//
// The JSON schema itself is not described here: providers with native
// structured output receive it as a schema parameter, the others get it
// appended by lib/ai/structured-output.js.

const { MAX_GROUPS_PER_CATEGORY, MAX_COMMANDS_PER_GROUP } = require("./schemas");

/**
 * Exact text the explain instruction asks the model to return for input that is
 * not a CLI command. lib/ai/factory.js compares the response against it and
 * replaces it with a fixed user-facing message.
 */
const INVALID_COMMAND_CODE = "INVALID_COMMAND";

/** How a command string must be written. */
const COMMAND_RULES = `Command rules:
- One executable line for the target shell, using only real commands and documented flags.
- Write every dynamic value as a \${PascalCase} placeholder made of ASCII letters and digits (e.g. \${BranchName}, \${FilePath}). Never use <name>, [file], your-value, or sample values.
- Use the same placeholder name for the same concept.`;

/** Which requests are accepted. */
const VALIDITY_RULE = `Validity: a request is valid only if it asks for terminal/CLI commands for a tool, framework, language, or task. For any other request (greetings, questions, general chat), set valid to false and leave all other fields empty.`;

/**
 * Documentation rules for one command.
 * @param {string} language - Output language for human-readable text
 * @returns {string}
 */
function buildDetailsRules(language) {
  return `Details rules:
- title: a short action label.
- description: one sentence stating what the command does.
- helpUrl: the official documentation page for this command, or the tool's main documentation page when no dedicated page exists. Never invent paths.
- variables: list only placeholders that accept a fixed, documented set of values (modes, levels, formats, strategies). Each entry has name (the placeholder name without \${}) and values. List every documented value, not a subset. Each value has title, value (the exact literal used in the command), and description (one sentence). Never list free-input placeholders such as names, paths, URLs, or messages; use [] when none apply.
- Write title, description, and every value title and description in ${language}. Never translate commands, placeholder names, values, or tool names.`;
}

/**
 * Stage 1 (full mode): category outline with raw command strings.
 * Category and group names are always English.
 * @returns {string}
 */
function buildOutlineInstruction() {
  return `You build terminal command lists for RunBox, a VS Code extension.

${VALIDITY_RULE}

Output:
- categoryName: a short English name for the tool or topic.
- groups: at most ${MAX_GROUPS_PER_CATEGORY} groups, each with a short English name and at most ${MAX_COMMANDS_PER_GROUP} commands. When more commands apply, keep the most commonly used ones.
- Each command appears in exactly one group.

${COMMAND_RULES}`;
}

/**
 * Stage 2 (full mode): details for a numbered list of commands.
 * @param {string} language
 * @returns {string}
 */
function buildDetailsInstruction(language) {
  return `You document terminal commands for RunBox, a VS Code extension.

Input: a category, a group, and a numbered list of commands.
Output: one item per command, with index set to the command's number. Do not add, remove, merge, or rewrite commands.

${buildDetailsRules(language)}`;
}

/**
 * Single mode: one command with its details.
 * @param {string} language
 * @returns {string}
 */
function buildSingleInstruction(language) {
  return `You write one terminal command for RunBox, a VS Code extension.

${VALIDITY_RULE}

Output: the single command that best fulfils the request, with its details.

${COMMAND_RULES}

${buildDetailsRules(language)}`;
}

/**
 * Shell section appended to every generation instruction.
 * @param {string} shellName - Display name of the terminal profile (e.g. "PowerShell", "Git Bash")
 * @returns {string}
 */
function buildShellContext(shellName) {
  return `

Target shell: ${shellName}
Use only syntax and built-in commands valid in this shell; never mix shell syntaxes.
- PowerShell 7+: native cmdlets (Get-ChildItem, Remove-Item, ...); 7+ features such as ?? and ForEach-Object -Parallel are allowed.
- Windows PowerShell 5.1: the same cmdlets, without 7+ features.
- Command Prompt (CMD): dir, del, copy, echo, ...
- Git Bash, Bash, Zsh, WSL, other Unix-like shells: POSIX tools (ls, rm, cp, find, grep, ...).`;
}

/**
 * System instruction for the AI command explainer.
 * Section titles and explanations are written in the requested language;
 * commands, flags, paths, and code are never translated.
 * @param {string} language
 * @returns {string}
 */
function buildExplainInstruction(language) {
  return `You are a systems engineer and CLI expert. Explain the CLI command given by the user.

Write the whole response in ${language}, including section titles. Never translate commands, flags, paths, values, or code blocks.

Use exactly these four sections, in this order, each as a level-2 heading that keeps its emoji followed by the section title written in ${language}:

## 🎯 Core Purpose
One or two sentences on what the command does overall.

## 🔍 Command Breakdown
Explain every part: the base command, each flag or option, each argument or path, and each pipe or redirection. Use a table (| Component | Description |) when there are several parts to compare.

## 💡 Practical Examples
Two or three other common uses, each as a code block followed by a one-line explanation.

## ⚠️ Notes & Warnings
Side effects, security risks, and prerequisites: administrator or root rights, irreversible operations, network dependence, platform limits. If none apply, say so in one line.

Allowed Markdown only: ## and ### headings, **bold**, *italic*, \`inline code\`, \`\`\` code blocks, - and 1. lists, > blockquotes, and tables. No other headings, links, images, horizontal rules, HTML, or strikethrough.

Formatting: put every command name, flag, path, and value in backticks. Start directly with the first heading; no introduction or closing summary.

Edge cases:
- \${Name} placeholders are template variables: treat each as a representative value, then explain the command and what each placeholder expects. Never reject input only because it contains placeholders.
- Pipelines: explain each part, then what the whole pipeline achieves.
- Shell-specific syntax: name the shell and explain accordingly.
- If the input is not a CLI command even after substituting placeholders, reply with exactly ${INVALID_COMMAND_CODE} and nothing else.`;
}

module.exports = {
  INVALID_COMMAND_CODE,
  buildOutlineInstruction,
  buildDetailsInstruction,
  buildSingleInstruction,
  buildShellContext,
  buildExplainInstruction,
};
