import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/onest/cyrillic-400.css";
import "@fontsource/onest/cyrillic-700.css";
import "@fontsource/onest/latin-400.css";
import "@fontsource/onest/latin-700.css";
import "@fontsource/noto-sans/cyrillic-400.css";
import "@fontsource/noto-sans/latin-400.css";
import "@fontsource/noto-serif/cyrillic-400.css";
import "@fontsource/noto-serif/latin-400.css";
import {
  calculatePrice,
  defaultProject,
  effectiveDpi,
  fits,
  projectErrors,
  projectSchema,
  rub,
  sides,
  type Asset,
  type DesignObject,
  type OrderPayload,
  type Product,
  type Project,
  type Side,
  type TextObject,
} from "../shared/model";
import {
  products as fallbackProducts,
  exportDpi as fallbackDpi,
  qualityWarningDpi as fallbackQuality,
} from "../shared/catalog";
import { trustedMessage } from "../shared/integration";
import {
  api,
  assetUrl,
  createOrder,
  download,
  saveProject,
  upload,
  type LoadedProject,
} from "./api";
import { readDraft, writeDraft, type LocalAsset } from "./draft";
import {
  drawObjects,
  fontReady,
  garmentFilter,
  mockupScale,
  loadImage,
  measureText,
  previewPng,
  printPng,
} from "./render";
import { downloadArchive, type OrderSnapshot } from "./archive";
import "./tokens.css";
import "./styles.css";

const sideName = (s: Side) => (s === "front" ? "Перед" : "Спина");
const uid = () => crypto.randomUUID();
const clone = <T,>(x: T): T => structuredClone(x);
function App() {
  const [productOpen, setProductOpen] = useState(window.innerWidth > 720);
  const [project, setProject] = useState<Project>(defaultProject),
    [products, setProducts] = useState<Product[]>(fallbackProducts),
    [side, setSide] = useState<Side>("front"),
    [selected, setSelected] = useState<string>(),
    [zoom, setZoom] = useState(100),
    [assets, setAssets] = useState<LocalAsset[]>([]),
    [images, setImages] = useState(new Map<string, HTMLImageElement>()),
    [status, setStatus] = useState("Загрузка черновика…"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [fontsLoaded, setFontsLoaded] = useState(false),
    [modal, setModal] = useState(false),
    [previews, setPreviews] = useState<Partial<Record<Side, string>>>({}),
    [order, setOrder] = useState<{
      id: string;
      token: string;
      number: string;
      price: { total: number };
    }>(),
    [savedLink, setSavedLink] = useState(""),
    [dpi, setDpi] = useState(fallbackDpi),
    [quality, setQuality] = useState(fallbackQuality);
  const allowed = useRef<string[]>([]),
    hostOrigin = useRef<string | undefined>(undefined),
    history = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    [, tick] = useState(0),
    latest = useRef(project),
    assetLatest = useRef(assets),
    drag = useRef<
      | {
          before: Project;
          object: DesignObject;
          start: { x: number; y: number };
          mode: "move" | "resize" | "rotate";
        }
      | undefined
    >(undefined),
    canvas = useRef<HTMLCanvasElement>(null),
    svg = useRef<SVGSVGElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    orderKey = useRef(uid());
  const busyRef = useRef(busy),
    modalRef = useRef(modal);
  const imageCache = useRef(new WeakMap<Blob, Promise<HTMLImageElement>>());
  function imageFor(a: LocalAsset) {
    let cached = imageCache.current.get(a.blob);
    if (!cached) {
      const url = URL.createObjectURL(a.blob);
      cached = loadImage(url).finally(() => URL.revokeObjectURL(url));
      imageCache.current.set(a.blob, cached);
    }
    return cached;
  }
  latest.current = project;
  assetLatest.current = assets;
  busyRef.current = busy;
  modalRef.current = modal;
  const product =
      products.find((p) => p.id === project.productId) ?? products[0],
    area = product.areas[side],
    objects = project.sides[side],
    object = objects.find((o) => o.id === selected),
    price = calculatePrice(project, product),
    errors = projectErrors(project, product),
    empty = !sides.some((s) => project.sides[s].length);
  const lowQuality = sides.flatMap((s) =>
    project.sides[s]
      .filter((o) => o.type === "image" && effectiveDpi(o) < quality)
      .map(
        (o) =>
          `${sideName(s)}: изображение ${o.type === "image" ? Math.round(effectiveDpi(o)) : 0} DPI. Лучше загрузить исходник крупнее (от ${quality} DPI).`,
      ),
  );
  useEffect(() => {
    const media = matchMedia("(max-width:720px)");
    const change = () => setProductOpen(!media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  function emit(type: string, payload: unknown) {
    if (window.parent !== window && hostOrigin.current)
      window.parent.postMessage(
        { channel: "souvenir-constructor", version: 1, type, payload },
        hostOrigin.current,
      );
  }
  function commit(p: Project, before = latest.current) {
    if (JSON.stringify(p) === JSON.stringify(before)) return;
    history.current = [...history.current.slice(-49), clone(before)];
    future.current = [];
    setProject(p);
    tick((x) => x + 1);
    orderKey.current = uid();
    setOrder(undefined);
    setSavedLink("");
  }
  function change(fn: (p: Project) => void) {
    const p = clone(latest.current);
    fn(p);
    commit(p);
  }
  function updateObject(patch: Partial<DesignObject>) {
    change((p) => {
      p.sides[side] = p.sides[side].map((o) =>
        o.id === selected ? ({ ...o, ...patch } as DesignObject) : o,
      );
    });
  }
  function undo() {
    const prev = history.current.pop();
    if (prev) {
      future.current.push(clone(latest.current));
      setProject(prev);
      setSelected(undefined);
      tick((x) => x + 1);
      orderKey.current = uid();
      setOrder(undefined);
      setSavedLink("");
    }
  }
  function redo() {
    const next = future.current.pop();
    if (next) {
      history.current.push(clone(latest.current));
      setProject(next);
      setSelected(undefined);
      tick((x) => x + 1);
      orderKey.current = uid();
      setOrder(undefined);
      setSavedLink("");
    }
  }
  function fail(e: unknown) {
    setError(
      e instanceof Error
        ? e.message
        : "Не удалось выполнить действие. Повторите попытку.",
    );
    setStatus("Черновик остаётся на устройстве.");
  }
  useEffect(() => {
    void fontReady()
      .then(() => setFontsLoaded(true))
      .catch(fail);
    void (async () => {
      try {
        const catalog = await api<{
          products: Product[];
          allowedOrigins: string[];
          exportDpi: number;
          qualityWarningDpi: number;
        }>("/api/catalog");
        setProducts(catalog.products);
        setDpi(catalog.exportDpi);
        setQuality(catalog.qualityWarningDpi);
        allowed.current = catalog.allowedOrigins;
        let refOrigin: string | undefined;
        try {
          refOrigin = new URL(document.referrer).origin;
        } catch {
          /* standalone */
        }
        if (refOrigin && allowed.current.includes(refOrigin)) {
          hostOrigin.current = refOrigin;
        }
        const hash = new URLSearchParams(location.hash.slice(1)),
          id = hash.get("project"),
          token = hash.get("token");
        const draft = await readDraft(location.hash || undefined).catch(
          () => undefined,
        );
        if (id && token && draft?.source === location.hash) {
          setProject(projectSchema.parse(draft.project));
          setAssets(draft.assets);
          setStatus("Локальный черновик этого проекта восстановлен");
        } else if (id && token) {
          const result = await api<LoadedProject>(
            `/api/projects/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
          );
          const p = projectSchema.parse(result.project);
          const local = await Promise.all(
            result.assets.map(async (a) => {
              const r = await fetch(assetUrl(a));
              if (!r.ok)
                throw new Error("Не удалось загрузить исходник проекта");
              return {
                id: a.id,
                blob: await r.blob(),
                name: a.name,
                width: a.width,
                height: a.height,
                remote: a,
              };
            }),
          );
          setProject(p);
          setAssets(local);
          setStatus("Проект открыт по ссылке");
        } else {
          try {
            if (draft) {
              setProject(projectSchema.parse(draft.project));
              setAssets(draft.assets);
              setStatus("Локальный черновик восстановлен");
            } else setStatus("Все изменения сохраняются на устройстве");
          } catch {
            setStatus(
              "Хранилище устройства недоступно. Сохраняйте проект на сервере.",
            );
          }
        }
      } catch (e) {
        fail(e);
        try {
          const d = await readDraft();
          if (d) {
            setProject(projectSchema.parse(d.project));
            setAssets(d.assets);
          }
        } catch {
          /* error already shown */
        }
      } finally {
        setReady(true);
        emit("constructor:ready", {});
      }
    })();
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      void writeDraft({ project, assets, source: location.hash })
        .then(() => {
          if (!busy) setStatus("Черновик сохранён на устройстве");
        })
        .catch(() =>
          setError(
            "Не удалось сохранить черновик на устройстве. Сохраните проект на сервере.",
          ),
        );
    }, 350);
    return () => clearTimeout(timer);
  }, [project, assets, ready]);
  useEffect(() => {
    let disposed = false;
    void Promise.all(
      assets.map(async (a) => [a.id, await imageFor(a)] as const),
    )
      .then((entries) => {
        if (!disposed) setImages(new Map(entries));
      })
      .catch(fail);
    return () => {
      disposed = true;
    };
  }, [assets]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !fontsLoaded) return;
    const scale = 4;
    c.width = Math.round(area.width * scale);
    c.height = Math.round(area.height * scale);
    const ctx = c.getContext("2d")!;
    ctx.scale(scale, scale);
    drawObjects(ctx, objects, images);
  }, [project, side, images, fontsLoaded, area]);
  useEffect(() => {
    function handle(e: MessageEvent) {
      if (
        !trustedMessage(
          e.origin,
          e.source,
          window.parent,
          allowed.current,
          e.data,
        )
      )
        return;
      if (busyRef.current || modalRef.current) {
        emit("constructor:error", {
          message:
            "Операция выполняется или открыто оформление. Повторите выбор позже.",
        });
        return;
      }
      const payload = e.data.payload as {
        productId: string;
        colorId?: string;
        size?: string;
      };
      const p = products.find((p) => p.id === payload.productId);
      if (!p) {
        emit("constructor:error", { message: "Товар не найден" });
        return;
      }
      if (
        (payload.colorId && !p.colors.some((c) => c.id === payload.colorId)) ||
        (payload.size && !p.sizes.includes(payload.size))
      ) {
        emit("constructor:error", { message: "Вариант не найден" });
        return;
      }
      hostOrigin.current = e.origin;
      change((d) => {
        d.productId = p.id;
        d.colorId = payload.colorId ?? p.colors[0].id;
        d.size = payload.size ?? p.sizes[0];
      });
    }
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [products]);
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      emit("constructor:height", {
        height: document.documentElement.scrollHeight,
      }),
    );
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        modal ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
      if (e.key === "Delete" && selected) {
        e.preventDefault();
        change((p) => {
          p.sides[side] = p.sides[side].filter((o) => o.id !== selected);
        });
        setSelected(undefined);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected, side, modal]);
  useEffect(() => {
    const open = () => location.reload();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  useEffect(
    () => () => {
      Object.values(previews).forEach((u) => u && URL.revokeObjectURL(u));
    },
    [previews],
  );
  function addText() {
    const o: TextObject = {
      id: uid(),
      type: "text",
      x: area.width / 2,
      y: area.height * 0.3,
      width: 100,
      height: 30,
      rotation: 0,
      text: "Ваша надпись",
      font: "Noto Sans",
      fontSize: 14,
      color: "#0b1a3f",
      align: "center",
      lineHeight: 1.2,
    };
    const measured = measureText(o);
    o.width = measured.width;
    o.height = measured.height;
    change((p) => p.sides[side].push(o));
    setSelected(o.id);
  }
  async function addImage(file: File) {
    setError("");
    try {
      if (
        assets.reduce((n, a) => n + a.blob.size, 0) + file.size >
        60 * 1024 * 1024
      )
        throw new Error(
          "Суммарный объём исходников ограничен 60 МБ для защиты памяти.",
        );
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 12 * 1024 * 1024
      )
        throw new Error(
          "Выберите PNG, JPEG или WebP до 12 МБ. SVG и PDF не поддерживаются.",
        );
      const image = await createImageBitmap(file);
      const w = image.width,
        h = image.height;
      image.close();
      if (assets.reduce((n, a) => n + a.width * a.height, 0) + w * h > 48000000)
        throw new Error(
          "Слишком много крупных изображений. Суммарно допустимо 48 млн пикселей.",
        );
      if (w * h > 24000000 || w > 10000 || h > 10000)
        throw new Error(
          "Изображение слишком большое: допустимо до 24 млн пикселей и 10000 px по стороне.",
        );
      const id = uid(),
        width = Math.min(area.width * 0.65, 140),
        height = (width * h) / w;
      setAssets((a) => [
        ...a,
        { id, blob: file, name: file.name, width: w, height: h },
      ]);
      const o: DesignObject = {
        id: uid(),
        type: "image",
        assetId: id,
        pixelWidth: w,
        pixelHeight: h,
        x: area.width / 2,
        y: area.height / 2,
        width,
        height,
        rotation: 0,
      };
      change((p) => p.sides[side].push(o));
      setSelected(o.id);
    } catch (e) {
      fail(e);
    }
  }
  function textEdit(patch: Partial<TextObject>) {
    if (object?.type !== "text") return;
    const next = { ...object, ...patch };
    const scale = object.width / measureText(object).width;
    const m = measureText(next);
    updateObject({ ...next, width: m.width * scale, height: m.height * scale });
  }
  function point(e: React.PointerEvent) {
    const bounds = svg.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - bounds.left) / bounds.width) * area.width,
      y: ((e.clientY - bounds.top) / bounds.height) * area.height,
    };
  }
  function startDrag(
    e: React.PointerEvent,
    id: string,
    mode: "move" | "resize" | "rotate",
  ) {
    if (busy) return;
    e.stopPropagation();
    e.preventDefault();
    const o = objects.find((o) => o.id === id)!;
    setSelected(id);
    svg.current!.setPointerCapture(e.pointerId);
    drag.current = {
      before: clone(latest.current),
      object: clone(o),
      start: point(e),
      mode,
    };
  }
  function moveDrag(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const pt = point(e),
      o = { ...d.object };
    if (d.mode === "move") {
      o.x += pt.x - d.start.x;
      o.y += pt.y - d.start.y;
    } else if (d.mode === "rotate") {
      o.rotation = Math.max(
        -360,
        Math.min(
          360,
          d.object.rotation +
            ((Math.atan2(pt.y - o.y, pt.x - o.x) -
              Math.atan2(d.start.y - o.y, d.start.x - o.x)) *
              180) /
              Math.PI,
        ),
      );
    } else {
      const initial = Math.hypot(d.start.x - o.x, d.start.y - o.y),
        ratio = Math.max(
          0.05,
          Math.min(
            5,
            Math.hypot(pt.x - o.x, pt.y - o.y) / Math.max(1, initial),
          ),
        );
      o.width = Math.min(1000, o.width * ratio);
      o.height = Math.min(1000, o.height * ratio);
    }
    const p = clone(d.before);
    p.sides[side] = p.sides[side].map((x) => (x.id === o.id ? o : x));
    latest.current = p;
    setProject(p);
  }
  function endDrag() {
    if (drag.current) {
      const before = drag.current.before;
      drag.current = undefined;
      commit(latest.current, before);
    }
  }
  async function syncAssets() {
    let p = clone(latest.current);
    let local = [...assetLatest.current];
    for (const a of local.filter((a) =>
      sides.some((s) =>
        p.sides[s].some((o) => o.type === "image" && o.assetId === a.id),
      ),
    )) {
      if (!a.remote) {
        const remote = await upload(a.blob, a.name);
        p.sides = {
          front: p.sides.front.map((o) =>
            o.type === "image" && o.assetId === a.id
              ? { ...o, assetId: remote.id }
              : o,
          ),
          back: p.sides.back.map((o) =>
            o.type === "image" && o.assetId === a.id
              ? { ...o, assetId: remote.id }
              : o,
          ),
        };
        local = local.map((x) =>
          x.id === a.id ? { ...x, id: remote.id, remote } : x,
        );
      }
    }
    // Keep uploaded originals available to historical snapshots as well.
    for (const old of assetLatest.current) {
      const replacement = local.find((a) => a.blob === old.blob);
      if (replacement && replacement.id !== old.id) {
        for (const stack of [history.current, future.current])
          for (const snapshot of stack)
            for (const s of sides)
              for (const o of snapshot.sides[s])
                if (o.type === "image" && o.assetId === old.id)
                  o.assetId = replacement.id;
      }
    }
    setAssets(local);
    setProject(p);
    latest.current = p;
    assetLatest.current = local;
    await writeDraft({ project: p, assets: local, source: location.hash });
    const ids = new Set(
      sides.flatMap((s) =>
        p.sides[s].flatMap((o) => (o.type === "image" ? [o.assetId] : [])),
      ),
    );
    return {
      project: p,
      assets: local
        .filter((a) => ids.has(a.id))
        .map((a) => ({ id: a.remote!.id, token: a.remote!.token })),
    };
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const payload = await syncAssets();
      const saved = await saveProject(payload);
      const url = new URL(location.href);
      url.hash = new URLSearchParams({
        project: saved.id,
        token: saved.token,
      }).toString();
      setSavedLink(url.href);
      setStatus("Проект сохранён на сервере. Ссылка даёт доступ к макету.");
      emit("project:saved", { id: saved.id });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function currentImages() {
    await fontReady();
    const used = new Set(
      sides.flatMap((s) =>
        latest.current.sides[s].flatMap((o) =>
          o.type === "image" ? [o.assetId] : [],
        ),
      ),
    );
    const entries = await Promise.all(
      assetLatest.current
        .filter((a) => used.has(a.id))
        .map(async (a) => [a.id, await imageFor(a)] as const),
    );
    return new Map(entries);
  }
  async function exportSide() {
    setBusy(true);
    setError("");
    try {
      if (errors.length) throw new Error(errors[0]);
      if (!objects.length)
        throw new Error("Добавьте надпись или изображение на эту сторону.");
      const blob = await printPng(area, objects, await currentImages(), dpi);
      await download(blob, `print-${side}-${dpi}dpi.png`);
      setStatus(
        "Прозрачный PNG выгружен. Требуется согласование с производством.",
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function openOrder() {
    setBusy(true);
    setError("");
    try {
      if (errors.length || empty)
        throw new Error(errors[0] ?? "Добавьте хотя бы один объект");
      const imgs = await currentImages();
      const urls: Partial<Record<Side, string>> = {};
      for (const s of sides)
        urls[s] = URL.createObjectURL(
          await previewPng(
            product.areas[s],
            project.sides[s],
            imgs,
            product.colors.find((c) => c.id === project.colorId)!.hex,
            product.mockups[s],
          ),
        );
      setPreviews(urls);
      setModal(true);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function submitOrder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const payload = await syncAssets(),
        imgs = await currentImages(),
        files: OrderPayload["files"] = [];
      for (const s of sides.filter((s) => payload.project.sides[s].length)) {
        const print = await upload(
          await printPng(product.areas[s], payload.project.sides[s], imgs, dpi),
          `print-${s}.png`,
        );
        files.push({
          kind: "print",
          side: s,
          assetId: print.id,
          token: print.token,
        });
        const preview = await upload(
          await previewPng(
            product.areas[s],
            payload.project.sides[s],
            imgs,
            product.colors.find((c) => c.id === project.colorId)!.hex,
            product.mockups[s],
          ),
          `preview-${s}.png`,
        );
        files.push({
          kind: "preview",
          side: s,
          assetId: preview.id,
          token: preview.token,
        });
      }
      const result = await createOrder({
        ...payload,
        contact: {
          name: String(form.get("name")),
          contact: String(form.get("contact")),
          consent: true,
        },
        files,
        idempotencyKey: orderKey.current,
      });
      setOrder(result);
      setStatus(`Заявка ${result.number} сохранена`);
      emit("order:created", { id: result.id, number: result.number });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function downloadOrder(archive = false) {
    if (!order) return;
    setBusy(true);
    try {
      const snapshot = await api<OrderSnapshot>(
        `/api/orders/${order.id}?token=${encodeURIComponent(order.token)}`,
      );
      if (archive) {
        await downloadArchive(snapshot, order.number);
        return;
      }
      await download(
        new Blob([JSON.stringify(snapshot, null, 2)], {
          type: "application/json",
        }),
        `order-${order.number}.json`,
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const color =
    product.colors.find((c) => c.id === project.colorId)?.hex ?? "#ffffff";
  return (
    <div className="app">
      <header className="brand-bar">
        <a
          className="brand"
          href="/"
          aria-label="Мастерская сувениров — конструктор"
        >
          <span className="brand-symbol">м.</span>
          <span>
            МАСТЕРСКАЯ
            <br />
            <small>сувениров</small>
          </span>
        </a>
        <span className="demo-badge">ДЕМОНСТРАЦИОННАЯ ВЕРСИЯ</span>
        <span className="header-note">Ваши идеи. Ваш принт.</span>
      </header>
      <main>
        <section className="intro">
          <span className="eyebrow">СОЗДАВАЙТЕ СВОЁ</span>
          <h1>
            Футболка с вашим характером<span className="blue-dot">.</span>
          </h1>
          <p>
            Выберите основу, добавьте изображение и слова — соберите вещь,
            которая говорит за вас.
          </p>
        </section>
        <div className="workspace" aria-busy={busy}>
          <aside className="panel product-panel">
            <div className="panel-heading">
              <span className="step">01</span>
              <h2>Основа</h2>
            </div>
            <details
              className="product-options"
              open={productOpen}
              onToggle={(e) => setProductOpen(e.currentTarget.open)}
            >
              <summary>
                {product.name} · {project.size} · настроить
              </summary>
              <label className="field">
                Модель
                <select
                  aria-label="Модель"
                  value={project.productId}
                  disabled={busy || !ready}
                  onChange={(e) =>
                    change((p) => {
                      p.productId = e.target.value;
                      const next = products.find((x) => x.id === p.productId)!;
                      if (!next.colors.some((c) => c.id === p.colorId))
                        p.colorId = next.colors[0].id;
                      if (!next.sizes.includes(p.size)) p.size = next.sizes[0];
                    })
                  }
                >
                  {products.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted small">{product.description}</p>
              <div className="field">
                <span>
                  Цвет ·{" "}
                  {product.colors.find((c) => c.id === project.colorId)?.name}
                </span>
                <div className="swatches">
                  {product.colors.map((c) => (
                    <button
                      key={c.id}
                      className="swatch"
                      style={{ background: c.hex }}
                      aria-label={`Цвет: ${c.name}`}
                      aria-pressed={project.colorId === c.id}
                      disabled={busy || !ready}
                      onClick={() =>
                        change((p) => {
                          p.colorId = c.id;
                        })
                      }
                    />
                  ))}
                </div>
              </div>
              <div className="field">
                <span>Размер</span>
                <div className="sizes">
                  {product.sizes.map((s) => (
                    <button
                      key={s}
                      aria-pressed={project.size === s}
                      disabled={busy || !ready}
                      onClick={() =>
                        change((p) => {
                          p.size = s;
                        })
                      }
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="notice small">
                Демо-товар. Изображения, размеры области печати и цены приведены
                для проверки конструктора.
              </div>
            </details>
            <hr />
            <div className="panel-heading">
              <span className="step">02</span>
              <h2>Ваш дизайн</h2>
            </div>
            <div className="stack">
              <button
                className="button primary"
                disabled={
                  busy || !ready || !fontsLoaded || objects.length >= 30
                }
                onClick={() => fileInput.current?.click()}
              >
                ＋ Загрузить изображение
              </button>
              <input
                ref={fileInput}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void addImage(f);
                  e.target.value = "";
                }}
              />
              <button
                className="button secondary"
                disabled={
                  busy || !ready || !fontsLoaded || objects.length >= 30
                }
                onClick={addText}
              >
                Тт · Добавить надпись
              </button>
              <p className="small muted">
                PNG, JPEG, WebP · до 12 МБ
                <br />
                Оригиналы сохраняются вместе с макетом.
              </p>
            </div>
            <details className="help">
              <summary>Как работать с макетом</summary>
              <p className="small">
                Перетаскивайте объекты внутри пунктирной рамки. Потяните квадрат
                для размера или круг для поворота. Точные размеры и слои — в
                панели объекта. Перед и спина редактируются независимо.
              </p>
            </details>
          </aside>
          <section className="panel stage-panel">
            <div className="stage-toolbar">
              <div className="side-tabs">
                {sides.map((s) => (
                  <button
                    key={s}
                    aria-pressed={side === s}
                    onClick={() => {
                      setSide(s);
                      setSelected(undefined);
                    }}
                  >
                    {sideName(s)}
                    {project.sides[s].length > 0 && (
                      <span className="side-dot" />
                    )}
                  </button>
                ))}
              </div>
              <div className="tool-row">
                <button
                  className="icon-button"
                  title="Отменить (Ctrl+Z)"
                  aria-label="Отменить"
                  disabled={busy || !ready || !history.current.length}
                  onClick={undo}
                >
                  ↶
                </button>
                <button
                  className="icon-button"
                  title="Повторить (Ctrl+Shift+Z)"
                  aria-label="Повторить"
                  disabled={busy || !ready || !future.current.length}
                  onClick={redo}
                >
                  ↷
                </button>
              </div>
            </div>
            <div className="stage">
              <div
                className="garment"
                style={{ transform: `scale(${zoom / 100})` }}
              >
                <img
                  className="garment-photo"
                  src={product.mockups[side]}
                  alt={`Демонстрационный вид футболки: ${sideName(side)}`}
                  style={{ filter: garmentFilter(color) }}
                />
                <div
                  className="print-area"
                  style={{
                    left: `${(300 - (area.width * mockupScale) / 2) / 6}%`,
                    width: `${(area.width * mockupScale) / 6}%`,
                    height: `${(area.height * mockupScale) / 6.8}%`,
                  }}
                >
                  <canvas ref={canvas} aria-label="Макет принта" />
                  <svg
                    ref={svg}
                    viewBox={`0 0 ${area.width} ${area.height}`}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={() => {
                      if (drag.current) {
                        setProject(drag.current.before);
                        drag.current = undefined;
                      }
                    }}
                    onPointerDown={() => setSelected(undefined)}
                    aria-label="Область печати"
                  >
                    {objects.map((o) => (
                      <g
                        key={o.id}
                        transform={`translate(${o.x} ${o.y}) rotate(${o.rotation})`}
                      >
                        <rect
                          x={-o.width / 2}
                          y={-o.height / 2}
                          width={o.width}
                          height={o.height}
                          fill="transparent"
                          stroke={
                            selected === o.id
                              ? "#1557ff"
                              : !fits(o, area)
                                ? "#c22"
                                : "transparent"
                          }
                          strokeWidth="1"
                          vectorEffect="non-scaling-stroke"
                          onPointerDown={(e) => startDrag(e, o.id, "move")}
                        />
                        {selected === o.id && (
                          <>
                            <rect
                              x={o.width / 2 - 4}
                              y={o.height / 2 - 4}
                              width="8"
                              height="8"
                              fill="#1557ff"
                              onPointerDown={(e) =>
                                startDrag(e, o.id, "resize")
                              }
                            />
                            <line
                              x1="0"
                              y1={-o.height / 2}
                              x2="0"
                              y2={-o.height / 2 - 12}
                              stroke="#1557ff"
                              strokeWidth="1"
                            />
                            <circle
                              cx="0"
                              cy={-o.height / 2 - 12}
                              r="5"
                              fill="#1557ff"
                              onPointerDown={(e) =>
                                startDrag(e, o.id, "rotate")
                              }
                            />
                          </>
                        )}
                      </g>
                    ))}
                  </svg>
                  {!objects.length && (
                    <span className="empty-print">
                      Место для
                      <br />
                      вашей идеи
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="stage-foot">
              <span className="small muted">
                Область печати: {area.width} × {area.height} мм
                <br />
                Демонстрационный эскиз
              </span>
              <label className="zoom">
                Масштаб
                <select
                  aria-label="Масштаб просмотра"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                >
                  <option value="75">75%</option>
                  <option value="100">100%</option>
                  <option value="125">125%</option>
                </select>
              </label>
            </div>
            <button
              className="button secondary export-button"
              disabled={
                busy || !ready || empty || errors.length > 0 || !fontsLoaded
              }
              onClick={() => void exportSide()}
            >
              ↓ PNG текущей стороны · {dpi} DPI
            </button>
            <p className="small muted">
              Прозрачный принт без футболки. Размер в миллиметрах не зависит от
              масштаба.
            </p>
          </section>
          <aside className="right-panels">
            <section className="panel properties">
              <div className="panel-heading">
                <span className="step">03</span>
                <h2>Объект и слои</h2>
              </div>
              {object ? (
                <>
                  <p className="small muted">
                    {object.type === "text" ? "Надпись" : "Изображение"} ·{" "}
                    {sideName(side)}
                  </p>
                  {object.type === "text" && (
                    <>
                      <label className="field">
                        Текст
                        <textarea
                          aria-label="Текст надписи"
                          maxLength={500}
                          rows={3}
                          value={object.text}
                          disabled={busy || !ready}
                          onChange={(e) =>
                            textEdit({ text: e.target.value || " " })
                          }
                        />
                      </label>
                      <label className="field">
                        Шрифт
                        <select
                          value={object.font}
                          disabled={busy || !ready}
                          onChange={(e) =>
                            textEdit({
                              font: e.target.value as TextObject["font"],
                            })
                          }
                        >
                          <option>Noto Sans</option>
                          <option>Noto Serif</option>
                        </select>
                      </label>
                      <div className="row">
                        <label className="field">
                          Размер, мм
                          <input
                            aria-label="Размер шрифта, мм"
                            type="number"
                            min="1"
                            max="100"
                            step="1"
                            value={object.fontSize}
                            disabled={busy || !ready}
                            onChange={(e) =>
                              textEdit({
                                fontSize: Math.max(
                                  1,
                                  Math.min(100, Number(e.target.value)),
                                ),
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          Цвет
                          <input
                            aria-label="Цвет текста"
                            type="color"
                            value={object.color}
                            disabled={busy || !ready}
                            onChange={(e) =>
                              textEdit({ color: e.target.value })
                            }
                          />
                        </label>
                      </div>
                      <div className="row">
                        <label className="field">
                          Выравнивание
                          <select
                            value={object.align}
                            disabled={busy || !ready}
                            onChange={(e) =>
                              textEdit({
                                align: e.target.value as TextObject["align"],
                              })
                            }
                          >
                            <option value="left">Слева</option>
                            <option value="center">По центру</option>
                            <option value="right">Справа</option>
                          </select>
                        </label>
                        <label className="field">
                          Интервал
                          <input
                            aria-label="Межстрочный интервал"
                            type="number"
                            min="1"
                            max="2"
                            step=".1"
                            value={object.lineHeight}
                            disabled={busy || !ready}
                            onChange={(e) =>
                              textEdit({
                                lineHeight: Math.max(
                                  1,
                                  Math.min(2, Number(e.target.value)),
                                ),
                              })
                            }
                          />
                        </label>
                      </div>
                    </>
                  )}
                  <div className="row">
                    <label className="field">
                      Ширина, мм
                      <input
                        aria-label="Ширина объекта, мм"
                        type="number"
                        min="1"
                        max="1000"
                        value={Math.round(object.width * 10) / 10}
                        disabled={busy || !ready}
                        onChange={(e) => {
                          const width = Math.max(
                            1,
                            Math.min(1000, Number(e.target.value)),
                          );
                          updateObject({
                            width,
                            height: (object.height * width) / object.width,
                          });
                        }}
                      />
                    </label>
                    <label className="field">
                      Поворот, °
                      <input
                        aria-label="Поворот объекта"
                        type="number"
                        min="-360"
                        max="360"
                        value={Math.round(object.rotation)}
                        disabled={busy || !ready}
                        onChange={(e) =>
                          updateObject({
                            rotation: Math.max(
                              -360,
                              Math.min(360, Number(e.target.value)),
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="row">
                    {(["x", "y"] as const).map((axis) => (
                      <label className="field" key={axis}>
                        {axis.toUpperCase()}, мм
                        <input
                          aria-label={`Координата ${axis.toUpperCase()}, мм`}
                          type="number"
                          min="-1000"
                          max="1000"
                          value={Math.round(object[axis] * 10) / 10}
                          disabled={busy || !ready}
                          onChange={(e) =>
                            updateObject({
                              [axis]: Math.max(
                                -1000,
                                Math.min(1000, Number(e.target.value)),
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div className="tool-row">
                    <button
                      className="button secondary"
                      disabled={busy || !ready}
                      onClick={() =>
                        updateObject({ x: area.width / 2, y: area.height / 2 })
                      }
                    >
                      По центру
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy || !ready || objects.length >= 30}
                      onClick={() => {
                        const o = {
                          ...object,
                          id: uid(),
                          x: object.x + 5,
                          y: object.y + 5,
                        };
                        change((p) => p.sides[side].push(o));
                        setSelected(o.id);
                      }}
                    >
                      Копия
                    </button>
                    <button
                      className="button danger"
                      disabled={busy || !ready}
                      onClick={() => {
                        change((p) => {
                          p.sides[side] = p.sides[side].filter(
                            (o) => o.id !== object.id,
                          );
                        });
                        setSelected(undefined);
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted small">
                  Выберите объект на футболке или добавьте новый. Все размеры
                  задаются в миллиметрах.
                </p>
              )}
              {objects.length > 0 && (
                <div className="layers">
                  <h3>Слои · сверху вниз</h3>
                  {[...objects].reverse().map((o) => (
                    <div
                      className={`layer ${selected === o.id ? "selected" : ""}`}
                      key={o.id}
                    >
                      <button
                        className="layer-name"
                        onClick={() => setSelected(o.id)}
                      >
                        {o.type === "text"
                          ? o.text.slice(0, 24)
                          : "Изображение"}
                      </button>
                      <button
                        aria-label="Поднять слой"
                        disabled={
                          busy ||
                          !ready ||
                          objects.indexOf(o) === objects.length - 1
                        }
                        onClick={() =>
                          change((p) => {
                            const arr = p.sides[side],
                              i = arr.findIndex((x) => x.id === o.id);
                            [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
                          })
                        }
                      >
                        ↑
                      </button>
                      <button
                        aria-label="Опустить слой"
                        disabled={busy || !ready || objects.indexOf(o) === 0}
                        onClick={() =>
                          change((p) => {
                            const arr = p.sides[side],
                              i = arr.findIndex((x) => x.id === o.id);
                            [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
                          })
                        }
                      >
                        ↓
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="panel price-card">
              <div className="panel-heading">
                <h2>Ваш расчёт</h2>
                <span className="demo-badge">ДЕМО</span>
              </div>
              <div className="price-line">
                <span>Футболка</span>
                <span>{rub(price.base)}</span>
              </div>
              <div className="price-line">
                <span>Печать · {price.usedSides.length} стороны</span>
                <span>{rub(price.printing)}</span>
              </div>
              <label className="field row">
                Количество
                <input
                  aria-label="Количество"
                  type="number"
                  min="1"
                  max="100"
                  value={project.quantity}
                  disabled={busy || !ready}
                  onChange={(e) =>
                    change((p) => {
                      p.quantity = Math.max(
                        1,
                        Math.min(100, Math.round(Number(e.target.value))),
                      );
                    })
                  }
                />
              </label>
              <div className="price-total">
                <span>Итого</span>
                <strong>{rub(price.total)}</strong>
              </div>
              <button
                className="button primary"
                disabled={
                  busy || !ready || empty || errors.length > 0 || !fontsLoaded
                }
                onClick={() => void openOrder()}
              >
                Проверить и оформить →
              </button>
              <p className="small muted">
                Сохраняем тестовую заявку. Оплата и доставка не подключены.
              </p>
            </section>
          </aside>
        </div>
        <section className="bottom-actions">
          <div className="status" role="status">
            {busy ? "Выполняется операция…" : status}
          </div>
          <button
            className="button secondary"
            disabled={busy || !ready || !ready}
            onClick={() => void save()}
          >
            Сохранить проект на сервере
          </button>
          {savedLink && (
            <div className="saved-link">
              <label className="field">
                Личная ссылка на макет
                <input
                  readOnly
                  aria-label="Ссылка на проект"
                  value={savedLink}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <a href={savedLink}>Открыть сохранённый проект</a>
              <p className="small">
                Сохраните ссылку: она даёт доступ к проекту и исходникам.
              </p>
            </div>
          )}
        </section>
        <div className="messages" aria-live="polite">
          {error && (
            <div className="error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Закрыть ошибку"
                onClick={() => setError("")}
              >
                ×
              </button>
            </div>
          )}
          {errors.map((e, i) => (
            <p className="error" key={i}>
              {e}
            </p>
          ))}
          {lowQuality.map((e, i) => (
            <p className="warning" key={i}>
              {e}
            </p>
          ))}
        </div>
        <footer className="footer-note">
          Производственные файлы требуют проверки тестового отпечатка. Цветовой
          профиль и белая подложка согласуются с производством.
        </footer>
      </main>
      <dialog
        ref={dialog}
        className="modal"
        onCancel={(e) => {
          if (busy) {
            e.preventDefault();
            return;
          }
          setModal(false);
        }}
        onClose={() => setModal(false)}
      >
        <div className="panel-heading">
          <h2>{order ? "Заявка сохранена" : "Проверьте обе стороны"}</h2>
          <button
            className="icon-button"
            aria-label="Закрыть оформление"
            disabled={busy || !ready}
            onClick={() => setModal(false)}
          >
            ×
          </button>
        </div>
        {order ? (
          <div className="stack">
            <p className="success">
              Номер заявки: <strong>{order.number}</strong>
              <br />
              Сохранённая сумма: {rub(order.price.total)}
            </p>
            <p>
              Это демонстрационная заявка. Оплата, доставка и отправка в
              производство не выполняются.
            </p>
            <button
              className="button primary"
              disabled={busy || !ready}
              onClick={() => void downloadOrder(true)}
            >
              Скачать комплект заявки (ZIP)
            </button>
            <button
              className="button secondary"
              disabled={busy || !ready}
              onClick={() => void downloadOrder()}
            >
              Скачать снимок заявки (JSON)
            </button>
            <p className="small">
              В снимке — макет, расчёт и ссылки доступа к исходникам, эскизам и
              PNG. Храните файл конфиденциально.
            </p>
          </div>
        ) : (
          <>
            <div className="preview-grid">
              {sides.map((s) => (
                <figure key={s}>
                  <img
                    src={previews[s]}
                    alt={`Итоговый эскиз: ${sideName(s)}`}
                  />
                  <figcaption>
                    {sideName(s)} ·{" "}
                    {project.sides[s].length ? "с печатью" : "без печати"}
                  </figcaption>
                </figure>
              ))}
            </div>
            {lowQuality.length > 0 && (
              <p className="warning">
                Есть изображения с низким разрешением. Рекомендуем заменить
                исходники перед реальной печатью.
              </p>
            )}
            <form
              className="order-form stack"
              onSubmit={(e) => void submitOrder(e)}
            >
              <div className="row">
                <label className="field">
                  Ваше имя
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={100}
                    autoComplete="name"
                    disabled={busy || !ready}
                  />
                </label>
                <label className="field">
                  Телефон или email
                  <input
                    name="contact"
                    required
                    minLength={5}
                    maxLength={150}
                    autoComplete="email"
                    disabled={busy || !ready}
                  />
                </label>
              </div>
              <label className="consent">
                <input
                  name="consent"
                  type="checkbox"
                  required
                  disabled={busy || !ready}
                />
                Согласен на сохранение указанных данных для демонстрационной
                заявки.
              </label>
              <div className="price-total">
                <span>{project.quantity} шт. · демо-стоимость</span>
                <strong>{rub(price.total)}</strong>
              </div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="button primary"
                disabled={busy || !ready || !!errors.length || empty}
              >
                {busy ? "Сохраняем файлы и заявку…" : "Сохранить заявку"}
              </button>
            </form>
          </>
        )}
      </dialog>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
