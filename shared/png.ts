/** Set PNG physical density without changing the pixel payload or alpha. */
export function pngWithDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (!Number.isFinite(dpi) || dpi < 72 || dpi > 600)
    throw new Error("DPI должен быть от 72 до 600");
  if (
    bytes.length < 33 ||
    bytes[0] !== 137 ||
    String.fromCharCode(...bytes.slice(1, 4)) !== "PNG"
  )
    throw new Error("Некорректный PNG");
  const read = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    parts: Uint8Array[] = [bytes.slice(0, 8)];
  const chunk = new Uint8Array(21),
    view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4);
  const ppm = Math.round(dpi / 0.0254);
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1;
  let crc = 0xffffffff;
  for (const b of chunk.slice(4, 17)) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("Повреждённый PNG");
    const len = read.getUint32(offset),
      end = offset + 12 + len;
    if (end > bytes.length) throw new Error("Повреждённый PNG");
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type !== "pHYs") parts.push(bytes.slice(offset, end));
    if (type === "IHDR") parts.push(chunk);
    offset = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
