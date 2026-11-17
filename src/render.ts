import type { DesignObject, PrintArea, TextObject } from "../shared/model";
import { mmToPx } from "../shared/model";
import { pngWithDpi } from "../shared/png";
export const fontReady = () =>
  Promise.all(
    ["Noto Sans", "Noto Serif"].map((f) =>
      document.fonts.load(`20px "${f}"`, "Привет Йё ABC"),
    ),
  ).then(() => document.fonts.ready);
export const garmentFilter = (color: string) =>
  color === "#ffffff"
    ? "none"
    : color === "#0b1a3f" || color === "#000000"
      ? "brightness(.25) sepia(.3) saturate(1.8) hue-rotate(170deg)"
      : "sepia(1) saturate(4) hue-rotate(180deg) brightness(.75)";
export const mockupScale = 11 / 12;
export function measureText(
  o: Pick<TextObject, "text" | "font" | "fontSize" | "lineHeight">,
) {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = `${o.fontSize}px "${o.font}"`;
  const lines = o.text.split("\n"),
    pad = o.fontSize * 0.18;
  return {
    width: Math.max(1, ...lines.map((l) => ctx.measureText(l).width)) + pad * 2,
    height: lines.length * o.fontSize * o.lineHeight + pad * 2,
    pad,
  };
}
export function drawObjects(
  ctx: CanvasRenderingContext2D,
  objects: DesignObject[],
  images: Map<string, HTMLImageElement>,
) {
  for (const o of objects) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate((o.rotation * Math.PI) / 180);
    if (o.type === "image") {
      const img = images.get(o.assetId);
      if (img)
        ctx.drawImage(img, -o.width / 2, -o.height / 2, o.width, o.height);
    } else {
      const m = measureText(o);
      ctx.scale(o.width / m.width, o.height / m.height);
      ctx.translate(-m.width / 2, -m.height / 2);
      ctx.font = `${o.fontSize}px "${o.font}"`;
      ctx.fillStyle = o.color;
      ctx.textAlign = o.align;
      ctx.textBaseline = "middle";
      const x =
        o.align === "left"
          ? m.pad
          : o.align === "right"
            ? m.width - m.pad
            : m.width / 2;
      o.text
        .split("\n")
        .forEach((line, i) =>
          ctx.fillText(line, x, m.pad + (i + 0.5) * o.fontSize * o.lineHeight),
        );
    }
    ctx.restore();
  }
}
export async function loadImage(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}
export async function printPng(
  area: PrintArea,
  objects: DesignObject[],
  images: Map<string, HTMLImageElement>,
  dpi: number,
): Promise<Blob> {
  await fontReady();
  const w = mmToPx(area.width, dpi),
    h = mmToPx(area.height, dpi);
  if (dpi < 72 || dpi > 600 || w * h > 24000000 || w > 10000 || h > 10000)
    throw new Error(
      "Слишком большой экспорт. Уменьшите DPI; допустимо до 24 млн пикселей.",
    );
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(w / area.width, h / area.height);
  drawObjects(ctx, objects, images);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Не удалось создать PNG"))),
      "image/png",
    ),
  );
  canvas.width = canvas.height = 1;
  return new Blob(
    [new Uint8Array(pngWithDpi(new Uint8Array(await blob.arrayBuffer()), dpi))],
    { type: "image/png" },
  );
}
export async function previewPng(
  area: PrintArea,
  objects: DesignObject[],
  images: Map<string, HTMLImageElement>,
  color: string,
  mockup: string,
) {
  await fontReady();
  const c = document.createElement("canvas");
  c.width = 600;
  c.height = 680;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f5f9ff";
  ctx.fillRect(0, 0, 600, 680);
  const img = await loadImage(mockup);
  ctx.filter = garmentFilter(color);
  ctx.drawImage(img, 0, 0, 600, 680);
  ctx.filter = "none";
  ctx.save();
  ctx.translate(300 - (area.width * mockupScale) / 2, 185);
  ctx.scale(mockupScale, mockupScale);
  drawObjects(ctx, objects, images);
  ctx.restore();
  ctx.fillStyle = "#55627f";
  ctx.font = '14px "Noto Sans"';
  ctx.fillText(`Демонстрационный эскиз · цвет ${color}`, 16, 660);
  return new Promise<Blob>((res, rej) =>
    c.toBlob(
      (b) => (b ? res(b) : rej(new Error("Ошибка превью"))),
      "image/png",
    ),
  );
}
