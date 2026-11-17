import { zipSync, strToU8 } from "fflate";
import type { Asset } from "../shared/model";
import { assetUrl, download } from "./api";
export interface OrderSnapshot {
  assets: Asset[];
  files: {
    kind: string;
    side: string;
    assetId: string;
    token: string;
    url: string;
  }[];
  [key: string]: unknown;
}
/** Capability URLs stay inside the private downloaded archive. Never publish it. */
export async function downloadArchive(snapshot: OrderSnapshot, number: string) {
  const entries: Record<string, Uint8Array> = {
    "order.json": strToU8(JSON.stringify(snapshot, null, 2)),
  };
  let total = 0;
  for (const a of snapshot.assets) {
    const r = await fetch(assetUrl(a));
    if (!r.ok)
      throw new Error("Не удалось скачать файл заявки. Повторите выгрузку.");
    const bytes = new Uint8Array(await r.arrayBuffer());
    total += bytes.length;
    if (total > 100 * 1024 * 1024)
      throw new Error(
        "Комплект больше 100 МБ. Скачайте снимок JSON и файлы по ссылкам из него.",
      );
    const output = snapshot.files.find((f) => f.assetId === a.id),
      ext =
        a.mime === "image/jpeg"
          ? "jpg"
          : a.mime === "image/webp"
            ? "webp"
            : "png";
    entries[
      output
        ? `${output.kind}-${output.side}.${ext}`
        : `originals/${a.id}.${ext}`
    ] = bytes;
  }
  const zipped = zipSync(entries, { level: 0 });
  await download(
    new Blob([new Uint8Array(zipped)], { type: "application/zip" }),
    `order-${number}.zip`,
  );
}
