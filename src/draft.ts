import type { Asset, Project } from "../shared/model";
export interface LocalAsset {
  id: string;
  blob: Blob;
  name: string;
  width: number;
  height: number;
  remote?: Asset;
}
export interface Draft {
  project: Project;
  assets: LocalAsset[];
  source?: string;
}
function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("souvenir-constructor-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("draft");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function readDraft(source?: string): Promise<Draft | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("draft");
    const read = (key: string, follow = true) => {
      const r = tx.objectStore("draft").get(key);
      r.onsuccess = () => {
        const value: unknown = r.result;
        if (typeof value === "string" && follow) read(value, false);
        else if (!value && source && key !== "last") read("last");
        else resolve(value as Draft | undefined);
      };
      r.onerror = () => reject(r.error);
    };
    read(source ? `source:${source}` : "last");
    tx.oncomplete = () => d.close();
  });
}
export async function writeDraft(value: Draft) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction("draft", "readwrite");
    const key = `source:${value.source || "standalone"}`;
    t.objectStore("draft").put(value, key);
    t.objectStore("draft").put(key, "last");
    t.oncomplete = () => {
      d.close();
      resolve();
    };
    t.onerror = () => reject(t.error);
  });
}
