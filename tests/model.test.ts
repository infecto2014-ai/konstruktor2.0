import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculatePrice,
  corners,
  defaultProject,
  effectiveDpi,
  fits,
  mmToPx,
  projectSchema,
  type Product,
  type TextObject,
  type ImageObject,
} from "../shared/model";
import { products } from "../shared/catalog";

const product = products[0] as Product;
const text = (overrides: Partial<TextObject> = {}): TextObject => ({
  id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  type: "text",
  x: 50,
  y: 50,
  width: 20,
  height: 20,
  rotation: 0,
  text: "Hi",
  font: "Noto Sans",
  fontSize: 12,
  color: "#000000",
  align: "center",
  lineHeight: 1.2,
  ...overrides,
});
const validProject = () => ({
  ...defaultProject(),
  sides: { front: [text()], back: [] },
});

test("мм переводятся в пиксели при 300 dpi", () =>
  assert.equal(mmToPx(25.4, 300), 300));
test("эффективный DPI изображения учитывает худшее измерение", () => {
  const image: ImageObject = {
    id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    type: "image",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    assetId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    pixelWidth: 1200,
    pixelHeight: 600,
  };
  assert.ok(Math.abs(effectiveDpi(image) - 152.4) < 1e-10);
});
test("поворот вычисляет углы, а границы учитывают допуск", () => {
  const obj = text({ x: 50, y: 50, width: 20, height: 10, rotation: 90 });
  const pts = corners(obj);
  assert.deepEqual(
    pts.map((p) => [Math.round(p.x), Math.round(p.y)]),
    [
      [55, 40],
      [55, 60],
      [45, 60],
      [45, 40],
    ],
  );
  assert.equal(
    fits(text({ x: 0, y: 50, width: 0.02, height: 20 }), {
      width: 100,
      height: 100,
    }),
    true,
  );
  assert.equal(
    fits(text({ x: 0, y: 50, width: 0.04, height: 20 }), {
      width: 100,
      height: 100,
    }),
    false,
  );
});
test("цена считает печать по сторонам и количеству", () => {
  const p = {
    ...defaultProject(),
    quantity: 3,
    sides: {
      front: [text()],
      back: [text({ id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" })],
    },
  };
  assert.deepEqual(calculatePrice(p, product), {
    base: 120000,
    printing: 50000,
    unit: 170000,
    quantity: 3,
    total: 510000,
    usedSides: ["front", "back"],
  });
});
test("схема проекта отклоняет NaN, неправильную версию, дробное количество и лишние поля", () => {
  const valid = validProject();
  assert.equal(projectSchema.safeParse(valid).success, true);
  for (const project of [
    { ...valid, sides: { front: [text({ x: Number.NaN })], back: [] } },
    { ...valid, version: 2 },
    { ...valid, quantity: 1.5 },
    { ...valid, secret: "unexpected" },
  ])
    assert.equal(projectSchema.safeParse(project).success, false);
});
