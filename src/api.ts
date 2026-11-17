import type {
  Asset,
  OrderPayload,
  Project,
  SavePayload,
} from "../shared/model";
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const json: unknown = await r.json().catch(() => null);
  if (!r.ok)
    throw new Error(
      json && typeof json === "object" && "error" in json
        ? String(json.error)
        : `Ошибка сервера (${r.status}). Повторите действие.`,
    );
  return json as T;
}
export const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const upload = (blob: Blob, name: string) => {
  const f = new FormData();
  f.set("file", blob, name);
  return api<Asset>("/api/assets", { method: "POST", body: f });
};
export const saveProject = (payload: SavePayload) =>
  api<{ id: string; token: string }>("/api/projects", jsonPost(payload));
export const createOrder = (payload: OrderPayload) =>
  api<{ id: string; token: string; number: string; price: { total: number } }>(
    "/api/orders",
    jsonPost(payload),
  );
export const assetUrl = (a: Pick<Asset, "id" | "token">) =>
  `/api/assets/${a.id}?token=${encodeURIComponent(a.token)}`;
export async function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export type LoadedProject = { project: Project; assets: Asset[] };
