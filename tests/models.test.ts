import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { modelMatches, parseModels } from "../plugins/cursor/scripts/lib/models.ts";

const fixture = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "models.txt"), "utf8");

test("parseModels reads every model line and skips the header and tip", () => {
  const models = parseModels(fixture);
  assert.equal(models.length, 12);
  assert.equal(models[0].id, "auto");
  assert.equal(models[models.length - 1].id, "claude-opus-5-thinking-high");
  for (const model of models) {
    assert.notEqual(model.id, "Tip:");
    assert.notEqual(model.id, "Available");
  }
});

test("parseModels marks the default and current models", () => {
  const models = parseModels(fixture);
  const auto = models.find((model) => model.id === "auto")!;
  const composer = models.find((model) => model.id === "composer-2.5")!;
  assert.equal(auto.isDefault, true);
  assert.equal(auto.isCurrent, false);
  assert.equal(composer.isCurrent, true);
  assert.equal(composer.label, "Composer 2.5 (current)");
});

test("parseModels returns an empty list for unrecognized output", () => {
  assert.deepEqual(parseModels("something changed\n"), []);
});

test("modelMatches needs every word in the id or label", () => {
  const model = { id: "gpt-5.3-codex-high-fast", label: "Codex 5.3 High Fast", isDefault: false, isCurrent: false };
  assert.equal(modelMatches(model, ["codex", "fast"]), true);
  assert.equal(modelMatches(model, ["CODEX"]), true);
  assert.equal(modelMatches(model, ["codex", "opus"]), false);
});
