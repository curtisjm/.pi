import assert from "node:assert/strict";
import test from "node:test";

import { checkExecutable } from "../src/config.ts";

test("checkExecutable treats non-zero exits and missing commands as unavailable", () => {
  assert.equal(checkExecutable("node"), "available");
  assert.equal(checkExecutable("false"), "unavailable");
  assert.equal(checkExecutable("definitely-not-a-real-command-web-access-test"), "unavailable");
});
