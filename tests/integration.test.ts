import { test } from "node:test";
import assert from "node:assert/strict";
import { trustedMessage } from "../shared/integration";

const allowed = ["http://localhost:5174"];
const parent = {};
const init = {
  channel: "souvenir-constructor",
  version: 1,
  type: "host:init",
  payload: { productId: "classic", colorId: "blue", size: "L" },
};
test("валидатор принимает только точный origin, source и версию схемы", () => {
  assert.equal(trustedMessage(allowed[0], parent, parent, allowed, init), true);
  assert.equal(
    trustedMessage("https://evil.example", parent, parent, allowed, init),
    false,
  );
  assert.equal(trustedMessage(allowed[0], {}, parent, allowed, init), false);
  assert.equal(
    trustedMessage(allowed[0], parent, parent, allowed, {
      ...init,
      version: 2,
    }),
    false,
  );
  assert.equal(
    trustedMessage(allowed[0], parent, parent, allowed, {
      ...init,
      extra: "x",
    }),
    false,
  );
});
