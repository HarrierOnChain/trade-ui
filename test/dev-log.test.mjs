import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isOkRequestLog } from "../server/dev-log.mjs";

const green = (s) => `\x1b[32m${s}\x1b[39m`;

describe("dev request log", () => {
  test("drops a plain 200 line", () => {
    assert.equal(isOkRequestLog(" GET /api/raze/tokens/sol/mint 200 in 333ms\n"), true);
  });

  test("drops a coloured 200 line", () => {
    assert.equal(isOkRequestLog(` GET /api/raze/tokens/sol/mint ${green("200")} in 270ms\n`), true);
  });

  test("keeps errors and other lines", () => {
    assert.equal(isOkRequestLog(" GET /api/raze/tokens/sol/mint 400 in 12ms\n"), false);
    assert.equal(isOkRequestLog(" GET /api/raze/tokens/sol/mint \x1b[31m500\x1b[39m in 12ms\n"), false);
    assert.equal(isOkRequestLog(" │ GET https://api.raze.bot/x 200 in 12ms (cache miss)\n"), false);
    assert.equal(isOkRequestLog("[trade-ui] locked (idle)\n"), false);
    assert.equal(isOkRequestLog(" GET /a 200 in 1ms\n GET /b 500 in 2ms\n"), false);
  });
});
