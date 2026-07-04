/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/markdown-parser.js
// Lightweight Markdown → HTML converter.
// Supports only the elements allowed by EXPLAIN_SYSTEM_INSTRUCTION:
//   ## h2, ### h3, **bold**, *italic*, `inline code`, ```code block```,
//   - unordered list, 1. ordered list, > blockquote,
//   | table | with | separator |
// Loads after utils.js, before modals/ai-explain.js.

/**
 * Converts a Markdown string to an HTML string.
 * Only processes the allowed subset defined in EXPLAIN_SYSTEM_INSTRUCTION.
 * Input must come from the AI (not user) — it is injected via innerHTML.
 * @param {string} md - Raw Markdown text from AI
 * @returns {string} HTML string
 */
function renderMarkdown(md) {
  if (!md || typeof md !== "string") {
    return "";
  }

  var lines = md.split("\n");
  var html = "";
  var i = 0;

  while (i < lines.length) {
    var line = lines[i];

    // ── Fenced code block ─────────────────────────────────────────────────
    if (line.trimStart().startsWith("```")) {
      var lang = line.trim().slice(3).trim();
      var codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      html +=
        '<pre class="md-pre"><code' +
        (lang ? ' class="md-lang-' + escapeHtml(lang) + '"' : "") +
        ">" +
        escapeHtml(codeLines.join("\n")) +
        "</code></pre>\n";
      continue;
    }

    // ── Table ─────────────────────────────────────────────────────────────
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      var tableRows = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableRows.push(lines[i]);
        i++;
      }
      // tableRows[1] is the separator row (| --- | --- |) — skip it
      html += '<div class="md-table-wrap"><table class="md-table">';
      tableRows.forEach(function (row, idx) {
        // Skip separator rows (only dashes, pipes, spaces, colons)
        if (/^[|\-:\s]+$/.test(row)) {
          return;
        }
        var cells = row
          .trim()
          .slice(1, -1) // remove leading/trailing pipes
          .split("|")
          .map(function (cell) {
            return inlineMarkdown(cell.trim());
          });
        var tag = idx === 0 ? "th" : "td";
        var rowTag = idx === 0 ? "thead" : idx === 1 && /^[|\-:\s]+$/.test(tableRows[1]) ? "" : "";
        if (idx === 0) {
          html +=
            "<thead><tr>" +
            cells
              .map(function (c) {
                return "<th>" + c + "</th>";
              })
              .join("") +
            "</tr></thead><tbody>";
        } else if (!/^[|\-:\s]+$/.test(row)) {
          html +=
            "<tr>" +
            cells
              .map(function (c) {
                return "<td>" + c + "</td>";
              })
              .join("") +
            "</tr>";
        }
      });
      html += "</tbody></table></div>\n";
      continue;
    }

    // ── Unordered list ────────────────────────────────────────────────────
    if (/^[ \t]*[-*+] /.test(line)) {
      html += '<ul class="md-ul">';
      while (i < lines.length && /^[ \t]*[-*+] /.test(lines[i])) {
        html += "<li>" + inlineMarkdown(lines[i].replace(/^[ \t]*[-*+] /, "")) + "</li>";
        i++;
      }
      html += "</ul>\n";
      continue;
    }

    // ── Ordered list ──────────────────────────────────────────────────────
    if (/^[ \t]*\d+\. /.test(line)) {
      html += '<ol class="md-ol">';
      while (i < lines.length && /^[ \t]*\d+\. /.test(lines[i])) {
        html += "<li>" + inlineMarkdown(lines[i].replace(/^[ \t]*\d+\. /, "")) + "</li>";
        i++;
      }
      html += "</ol>\n";
      continue;
    }

    // ── Blockquote ────────────────────────────────────────────────────────
    if (/^> /.test(line)) {
      html += '<blockquote class="md-blockquote">';
      while (i < lines.length && /^> /.test(lines[i])) {
        html += "<p>" + inlineMarkdown(lines[i].replace(/^> /, "")) + "</p>";
        i++;
      }
      html += "</blockquote>\n";
      continue;
    }

    // ── Headings ──────────────────────────────────────────────────────────
    if (/^### /.test(line)) {
      html += '<h3 class="md-h3">' + inlineMarkdown(line.slice(4)) + "</h3>\n";
      i++;
      continue;
    }
    if (/^## /.test(line)) {
      html += '<h2 class="md-h2">' + inlineMarkdown(line.slice(3)) + "</h2>\n";
      i++;
      continue;
    }

    // ── Blank line ────────────────────────────────────────────────────────
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Paragraph ─────────────────────────────────────────────────────────
    html += '<p class="md-p">' + inlineMarkdown(line) + "</p>\n";
    i++;
  }

  return html;
}

/**
 * Processes inline Markdown tokens within a single line of text.
 * Handles: **bold**, *italic*, `inline code`.
 * @param {string} text - plain or inline-markdown text (already line-scoped)
 * @returns {string} HTML string
 */
function inlineMarkdown(text) {
  if (!text) {
    return "";
  }
  // Escape HTML first, then re-apply inline patterns on the escaped string
  var out = escapeHtml(text);

  // `inline code` — must run before bold/italic to protect backtick content
  out = out.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');

  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // *italic* (single asterisk, not inside **)
  out = out.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  return out;
}
