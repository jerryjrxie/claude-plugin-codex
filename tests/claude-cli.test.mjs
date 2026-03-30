import test from "node:test";
import assert from "node:assert/strict";

import { MODEL_ALIASES } from "../scripts/lib/claude-cli.mjs";

test("MODEL_ALIASES maps shorthand names to full model IDs", () => {
  assert.equal(MODEL_ALIASES.get("opus"), "claude-opus-4-6");
  assert.equal(MODEL_ALIASES.get("sonnet"), "claude-sonnet-4-6");
  assert.equal(MODEL_ALIASES.get("haiku"), "claude-haiku-4-5");
  assert.equal(MODEL_ALIASES.get("nonexistent"), undefined);
});
