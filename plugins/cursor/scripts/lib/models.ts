import { spawnSync } from "node:child_process";

import { CURSOR_BIN } from "./cursor.ts";

export interface Model {
  id: string;
  label: string;
  isDefault: boolean;
  isCurrent: boolean;
}

// `cursor-agent models` prints lines like "composer-2.5 - Composer 2.5 (current)".
// The header, blank lines and the closing tip do not match this pattern.
const MODEL_LINE = /^(\S+) - (.+)$/;

export function parseModels(text: string): Model[] {
  const models: Model[] = [];
  for (const line of text.split("\n")) {
    const match = line.trim().match(MODEL_LINE);
    if (!match) {
      continue;
    }
    const label = match[2];
    models.push({
      id: match[1],
      label: label,
      isDefault: label.endsWith("(default)"),
      isCurrent: label.endsWith("(current)"),
    });
  }
  return models;
}

export function fetchModels(): { models: Model[]; raw: string } {
  const result = spawnSync(CURSOR_BIN, ["models"], { encoding: "utf8" });
  if (result.error) {
    throw new Error("Could not run cursor-agent. Run /cursor:setup.");
  }
  if (result.status !== 0) {
    throw new Error("cursor-agent models failed: " + result.stderr.trim());
  }
  return { models: parseModels(result.stdout), raw: result.stdout };
}

// Returns true when every word appears in the model id or label.
export function modelMatches(model: Model, words: string[]): boolean {
  const text = (model.id + " " + model.label).toLowerCase();
  for (const word of words) {
    if (!text.includes(word.toLowerCase())) {
      return false;
    }
  }
  return true;
}

// Returns an error message, or null when the model exists.
export function checkModel(models: Model[], requested: string): string | null {
  // Bracket overrides such as claude-opus-4-8[effort=high] are checked by the part before "[".
  const id = requested.split("[")[0];
  for (const model of models) {
    if (model.id === id) {
      return null;
    }
  }

  const closeMatches: string[] = [];
  for (const model of models) {
    if (model.id.includes(id)) {
      closeMatches.push(model.id);
    }
  }

  let message = 'Cursor has no model named "' + id + '".';
  if (closeMatches.length > 0) {
    message += " Close matches: " + closeMatches.slice(0, 10).join(", ") + ".";
  }
  message += " Run /cursor:models to see every model.";
  return message;
}
