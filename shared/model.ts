import { z } from "zod";
export const sides = ["front", "back"] as const;
export type Side = (typeof sides)[number];
const finite = z.number().finite();
const base = {
  id: z.string().uuid(),
  x: finite.min(-1000).max(1000),
  y: finite.min(-1000).max(1000),
  width: finite.positive().max(1000),
  height: finite.positive().max(1000),
  rotation: finite.min(-360).max(360),
};
export const objectSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...base,
      type: z.literal("text"),
      text: z.string().min(1).max(500),
      font: z.enum(["Noto Sans", "Noto Serif"]),
      fontSize: finite.min(1).max(100),
      color: z.string().regex(/^#[0-9a-f]{6}$/i),
      align: z.enum(["left", "center", "right"]),
      lineHeight: finite.min(1).max(2),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("image"),
      assetId: z.string().uuid(),
      pixelWidth: z.number().int().positive().max(10000),
      pixelHeight: z.number().int().positive().max(10000),
    })
    .strict(),
]);
export const projectSchema = z
  .object({
    version: z.literal(1),
    productId: z.string().max(64),
    colorId: z.string().max(64),
    size: z.string().max(16),
    quantity: z.number().int().min(1).max(100),
    sides: z
      .object({
        front: z.array(objectSchema).max(30),
        back: z.array(objectSchema).max(30),
      })
      .strict(),
  })
  .strict();
export type DesignObject = z.infer<typeof objectSchema>;
export type TextObject = Extract<DesignObject, { type: "text" }>;
export type ImageObject = Extract<DesignObject, { type: "image" }>;
export type Project = z.infer<typeof projectSchema>;
export interface PrintArea {
  width: number;
  height: number;
}
export interface Product {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  sidePrice: number;
  colors: { id: string; name: string; hex: string }[];
  sizes: string[];
  areas: Record<Side, PrintArea>;
  mockups: Record<Side, string>;
  demo: true;
}
export interface Asset {
  id: string;
  token: string;
  width: number;
  height: number;
  mime: string;
  name: string;
}
export interface Price {
  base: number;
  printing: number;
  unit: number;
  quantity: number;
  total: number;
  usedSides: Side[];
}
export const contactSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    contact: z.string().trim().min(5).max(150),
    consent: z.literal(true),
  })
  .strict();
export const saveSchema = z
  .object({
    project: projectSchema,
    assets: z
      .array(
        z
          .object({ id: z.string().uuid(), token: z.string().min(32).max(128) })
          .strict(),
      )
      .max(60),
  })
  .strict();
export type SavePayload = z.infer<typeof saveSchema>;
export const orderSchema = saveSchema
  .extend({
    contact: contactSchema,
    idempotencyKey: z.string().uuid(),
    files: z
      .array(
        z
          .object({
            kind: z.enum(["print", "preview"]),
            side: z.enum(sides),
            assetId: z.string().uuid(),
            token: z.string().min(32).max(128),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict();
export type OrderPayload = z.infer<typeof orderSchema>;
export const defaultProject = (): Project => ({
  version: 1,
  productId: "classic",
  colorId: "white",
  size: "M",
  quantity: 1,
  sides: { front: [], back: [] },
});
export const mmToPx = (mm: number, dpi: number) =>
  Math.round((mm * dpi) / 25.4);
export function corners(o: DesignObject) {
  const a = (o.rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => ({
    x: o.x + ((x * o.width) / 2) * c - ((y * o.height) / 2) * s,
    y: o.y + ((x * o.width) / 2) * s + ((y * o.height) / 2) * c,
  }));
}
export const fits = (o: DesignObject, a: PrintArea) =>
  corners(o).every(
    (p) =>
      p.x >= -0.01 &&
      p.y >= -0.01 &&
      p.x <= a.width + 0.01 &&
      p.y <= a.height + 0.01,
  );
export const effectiveDpi = (o: ImageObject) =>
  Math.min(o.pixelWidth / o.width, o.pixelHeight / o.height) * 25.4;
export function projectErrors(p: Project, product: Product) {
  const errors: string[] = [];
  if (!product.colors.some((c) => c.id === p.colorId))
    errors.push("Выберите доступный цвет");
  if (!product.sizes.includes(p.size)) errors.push("Выберите доступный размер");
  for (const side of sides)
    for (const o of p.sides[side])
      if (!fits(o, product.areas[side]))
        errors.push(
          `${side === "front" ? "Перед" : "Спина"}: объект выходит за область печати. Уменьшите или переместите его.`,
        );
  return errors;
}
export function calculatePrice(p: Project, product: Product): Price {
  const usedSides = sides.filter((s) => p.sides[s].length > 0),
    printing = usedSides.length * product.sidePrice,
    unit = product.basePrice + printing;
  return {
    base: product.basePrice,
    printing,
    unit,
    quantity: p.quantity,
    total: unit * p.quantity,
    usedSides,
  };
}
export const rub = (kopecks: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(kopecks / 100);
