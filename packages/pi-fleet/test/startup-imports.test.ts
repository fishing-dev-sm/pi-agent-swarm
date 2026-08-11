import assert from "node:assert/strict";
import { test } from "vitest";

import extension from "../src/index.js";

test("Pi Fleet exports an extension factory", () => {
	assert.equal(typeof extension, "function");
});
