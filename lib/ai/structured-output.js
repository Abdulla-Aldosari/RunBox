/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// lib/ai/structured-output.js
// Provider-independent handling of JSON responses.
//
// Every provider implements one transport method:
//
//   completeJson({ system, prompt, schema, schemaName, signal })
//     -> Promise<{ text: string, truncated: boolean }>
//
// `truncated` is true when the provider stopped because it hit its output-token
// limit (finish/stop reason "length", "max_tokens", "MAX_TOKENS", ...).
// requestJson() below is the only place that turns that raw text into data, so
// truncation detection, JSON extraction, validation, and the single retry
// behave identically for every provider.

/** The response hit the provider's output-token limit; retrying cannot help. */
class AiTruncatedError extends Error {
  constructor() {
    super("The AI response was cut off because it exceeded the model's output limit. Try a smaller request or another model.");
    this.name = "AiTruncatedError";
  }
}

/** The response was not valid JSON or did not match the expected structure. */
class AiInvalidResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = "AiInvalidResponseError";
  }
}

/** The model judged the user's request to be outside the supported scope. */
class AiRejectedRequestError extends Error {
  constructor() {
    super("This is not a valid request.");
    this.name = "AiRejectedRequestError";
  }
}

/**
 * Text appended to the system instruction for providers that cannot receive
 * the schema as a request parameter (json_object mode or none).
 * @param {object} schema
 * @returns {string}
 */
function buildSchemaAppendix(schema) {
  return `

Respond with one JSON object that matches this JSON Schema exactly, with no text, markdown, or code fences before or after it:
${JSON.stringify(schema)}`;
}

/**
 * Extracts and parses the JSON object contained in a model response.
 * Tolerates surrounding code fences or stray text around a single object.
 * @param {string} text
 * @returns {object}
 * @throws {AiInvalidResponseError}
 */
function parseJsonObject(text) {
  const raw = typeof text === "string" ? text : "";
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AiInvalidResponseError("The AI response did not contain a JSON object.");
  }

  let data;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new AiInvalidResponseError(`The AI response was not valid JSON: ${err.message}`);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new AiInvalidResponseError("The AI response was not a JSON object.");
  }
  return data;
}

/**
 * Sends one structured request and returns validated data.
 *
 * - Truncated response  -> AiTruncatedError (no retry: the same request would be cut again).
 * - Invalid JSON, or `validate` throws AiInvalidResponseError -> one retry, then the error.
 * - Any other error (network, auth, rate limit, abort, AiRejectedRequestError) -> thrown as is.
 *
 * @template T
 * @param {{ completeJson: Function }} provider
 * @param {{ system: string, prompt: string, schema: object, schemaName: string, signal?: AbortSignal }} request
 * @param {(data: object) => T} validate - Returns the normalized result or throws
 * @param {(entry: { attempt: number, text?: string, error?: Error }) => void} [onAttempt] - Logging hook
 * @returns {Promise<T>}
 */
async function requestJson(provider, request, validate, onAttempt) {
  const maxAttempts = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let text = "";
    try {
      const response = await provider.completeJson(request);
      text = response.text;
      if (response.truncated) {
        throw new AiTruncatedError();
      }
      const result = validate(parseJsonObject(text));
      if (onAttempt) onAttempt({ attempt, text });
      return result;
    } catch (err) {
      if (onAttempt) onAttempt({ attempt, text, error: err });
      if (!(err instanceof AiInvalidResponseError) || (request.signal && request.signal.aborted)) {
        throw err;
      }
      lastError = err;
    }
  }

  throw lastError;
}

module.exports = {
  AiTruncatedError,
  AiInvalidResponseError,
  AiRejectedRequestError,
  buildSchemaAppendix,
  parseJsonObject,
  requestJson,
};
