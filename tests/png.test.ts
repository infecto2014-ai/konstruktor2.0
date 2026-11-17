import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { pngWithDpi } from "../shared/png";
import { mmToPx } from "../shared/model";
test("PNG содержит 300 DPI, фактические пиксели и исходную прозрачность", async () => {
  const input = await sharp({
    create: {
      width: mmToPx(24, 300),
      height: mmToPx(32, 300),
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  const output = pngWithDpi(input, 300),
    meta = await sharp(output).metadata();
  assert.equal(meta.width, 283);
  assert.equal(meta.height, 378);
  assert.equal(meta.density, 300);
  assert.equal(meta.hasAlpha, true);
  assert.deepEqual(
    await sharp(output).raw().toBuffer(),
    await sharp(input).raw().toBuffer(),
  );
  const replaced = await sharp(pngWithDpi(output, 150)).metadata();
  assert.equal(replaced.density, 150);
  assert.throws(() => pngWithDpi(input, 10000));
  assert.throws(() => pngWithDpi(new Uint8Array(5), 300));
});
