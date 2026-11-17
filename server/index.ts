import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import sharp from "sharp";
import type { Metadata } from "sharp";
import { z } from "zod";
import { products, exportDpi, qualityWarningDpi } from "../shared/catalog.js";
import {
  calculatePrice,
  mmToPx,
  projectErrors,
  projectSchema,
  saveSchema,
  orderSchema,
  type Asset,
  type Product,
  type Project,
  type Side,
} from "../shared/model.js";
import { createStorage, type Storage, type StoredAsset } from "./storage.js";

const here = dirname(fileURLToPath(import.meta.url));
const defaultOrigins = ["http://localhost:5174"];
const maxFile = 12 * 1024 * 1024;
const maxPixels = 24_000_000;
const maxDimension = 10_000;
const originList = (value = process.env.ALLOWED_ORIGINS) => {
  const raw = value
    ? value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : defaultOrigins;
  return [
    ...new Set(
      raw.map((x) => {
        const u = new URL(x);
        if (u.origin !== x.replace(/\/$/, ""))
          throw new Error("ALLOWED_ORIGINS должен содержать только origins");
        return u.origin;
      }),
    ),
  ];
};
const sha = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const secretMatches = (given: string | undefined, hash: string | undefined) => {
  if (!given || !hash) return false;
  const a = Buffer.from(sha(given), "hex"),
    b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
          .join(",")}}`
      : JSON.stringify(v);
const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
const findProduct = (id: string, catalog: Product[]) =>
  catalog.find((p) => p.id === id);
const safeAsset = (r: StoredAsset, accessToken: string): Asset => ({
  id: r.id,
  token: accessToken,
  width: r.width,
  height: r.height,
  mime: r.mime,
  name: r.name,
});
type OrderSnapshot = {
  id: string;
  number: string;
  createdAt: string;
  contact: { name: string; contact: string; consent: true };
  project: Project;
  product: Product;
  price: ReturnType<typeof calculatePrice>;
  assets: Asset[];
  files: {
    kind: "print" | "preview";
    side: Side;
    assetId: string;
    token: string;
    url: string;
  }[];
  accessToken: string;
};

export interface AppOptions {
  dataDir?: string;
  storage?: Storage;
  catalog?: Product[];
  allowedOrigins?: string[];
  dpi?: number;
  warningDpi?: number;
  production?: boolean;
}

export async function createApp(options: AppOptions = {}) {
  const dataDir = resolve(
    options.dataDir || process.env.DATA_DIR || resolve(here, "../data"),
  );
  await mkdir(dataDir, { recursive: true });
  const db = options.storage || (await createStorage(dataDir));
  const catalog = options.catalog || products;
  const dpi = options.dpi || exportDpi;
  const warningDpi = options.warningDpi || qualityWarningDpi;
  const allowed = options.allowedOrigins || originList();
  const production =
    options.production ?? process.env.NODE_ENV === "production";
  const app = express();
  const appOrigins = allowed.length ? allowed : defaultOrigins;
  app.disable("x-powered-by");
  app.use(
    helmet({
      xFrameOptions: false,
      contentSecurityPolicy: {
        directives: {
          "frame-ancestors": ["'self'", ...appOrigins],
          "img-src": ["'self'", "data:", "blob:"],
          "font-src": ["'self'", "data:"],
          "connect-src": ["'self'", ...(production ? [] : ["ws:", "wss:"])],
          "upgrade-insecure-requests": production ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "2mb", strict: true }));
  const mutate = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Слишком много запросов. Повторите позже." },
  });
  const uploadLimit = rateLimit({
    windowMs: 60_000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Слишком много загрузок. Повторите позже." },
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFile, files: 1, fields: 2, parts: 3 },
  });
  app.use("/api", (req, _res, next) => {
    const origin = req.get("origin");
    if (origin && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      let own = "";
      try {
        own = new URL(`${req.protocol}://${req.get("host")}`).origin;
      } catch {}
      if (origin !== own)
        return next(fail(403, "Запрос с этого сайта запрещён"));
    }
    next();
  });
  app.get("/api/catalog", (_req, res) =>
    res.json({
      products: catalog,
      qualityWarningDpi: warningDpi,
      exportDpi: dpi,
      allowedOrigins: allowed,
    }),
  );

  app.post(
    "/api/assets",
    uploadLimit,
    mutate,
    upload.single("file"),
    async (req, res, next) => {
      try {
        if (!req.file) throw fail(400, "Выберите файл изображения");
        let meta: Metadata;
        try {
          meta = await sharp(req.file.buffer, {
            failOn: "error",
            animated: false,
          }).metadata();
        } catch {
          throw fail(415, "Файл не является корректным PNG, JPEG или WebP");
        }
        const format = meta.format;
        if (
          !["png", "jpeg", "webp"].includes(format || "") ||
          !meta.width ||
          !meta.height
        )
          throw fail(415, "Поддерживаются только PNG, JPEG и WebP");
        if (
          meta.width > maxDimension ||
          meta.height > maxDimension ||
          meta.width * meta.height > maxPixels
        )
          throw fail(413, "Изображение превышает допустимый размер");
        try {
          await sharp(req.file.buffer, {
            limitInputPixels: maxPixels,
            failOn: "error",
            animated: false,
          }).stats();
        } catch {
          throw fail(415, "Файл не является корректным PNG, JPEG или WebP");
        }
        const id = randomUUID(),
          access = token();
        const mime = `image/${format === "jpeg" ? "jpeg" : format}`;
        const oriented = [5, 6, 7, 8].includes(meta.orientation || 0);
        const row: StoredAsset = {
          id,
          tokenHash: sha(access),
          width: oriented ? meta.height : meta.width,
          height: oriented ? meta.width : meta.height,
          mime,
          name: (req.file.originalname || `image.${format}`)
            .replace(/[\r\n\0]/g, "")
            .slice(0, 180),
          key: `${id}.${format}`,
        };
        await db.saveAsset(row, req.file.buffer);
        res.status(201).json(safeAsset(row, access));
      } catch (e) {
        next(e);
      }
    },
  );

  app.get("/api/assets/:id", async (req, res, next) => {
    try {
      if (!z.string().uuid().safeParse(req.params.id).success)
        throw fail(404, "Изображение не найдено");
      const found = await db.getAsset(req.params.id);
      if (
        !found ||
        !secretMatches(req.query.token as string, found.row.tokenHash)
      )
        throw fail(404, "Изображение не найдено");
      res
        .set({
          "Content-Type": found.row.mime,
          "Content-Length": String(found.bytes.length),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": `inline; filename="${found.row.id}"`,
        })
        .send(found.bytes);
    } catch (e) {
      next(e);
    }
  });

  async function resolveAssets(
    items: { id: string; token: string }[],
  ): Promise<Map<string, { row: StoredAsset; token: string }>> {
    const map = new Map<string, { row: StoredAsset; token: string }>();
    for (const item of items) {
      if (map.has(item.id))
        throw fail(400, "Список изображений содержит повтор");
      const stored = await db.getAsset(item.id);
      if (!stored || !secretMatches(item.token, stored.row.tokenHash))
        throw fail(404, "Изображение не найдено или нет доступа");
      map.set(item.id, { row: stored.row, token: item.token });
    }
    return map;
  }
  function validateProject(project: Project, checkBounds = true) {
    const objectIds = [...project.sides.front, ...project.sides.back].map(
      (o) => o.id,
    );
    if (new Set(objectIds).size !== objectIds.length)
      throw fail(
        400,
        "В проекте обнаружены повторяющиеся идентификаторы объектов",
      );
    const product = findProduct(project.productId, catalog);
    if (!product) throw fail(400, "Выбранное изделие недоступно");
    const errors = checkBounds
      ? projectErrors(project, product)
      : [
          ...(!product.colors.some((c) => c.id === project.colorId)
            ? ["Выберите доступный цвет"]
            : []),
          ...(!product.sizes.includes(project.size)
            ? ["Выберите доступный размер"]
            : []),
        ];
    if (errors.length) throw fail(400, errors.join(" "));
    return product;
  }
  async function validateObjectAssets(
    project: Project,
    assets: Map<string, { row: StoredAsset; token: string }>,
  ) {
    for (const side of ["front", "back"] as const)
      for (const o of project.sides[side])
        if (o.type === "image") {
          const stored = assets.get(o.assetId);
          if (!stored)
            throw fail(400, "В проекте отсутствует исходное изображение");
          if (
            stored.row.width !== o.pixelWidth ||
            stored.row.height !== o.pixelHeight
          )
            throw fail(
              400,
              "Размер исходного изображения не совпадает с проектом",
            );
        }
  }
  const projectOutput = (
    project: Project,
    assets: Map<string, { row: StoredAsset; token: string }>,
  ) => ({
    project,
    assets: [...assets.values()].map((x) => safeAsset(x.row, x.token)),
  });

  app.post("/api/projects", mutate, async (req, res, next) => {
    try {
      const parsed = saveSchema.safeParse(req.body);
      if (!parsed.success) throw fail(400, "Проверьте данные проекта");
      const { project, assets: refs } = parsed.data;
      validateProject(project, false);
      const assets = await resolveAssets(refs);
      await validateObjectAssets(project, assets);
      const id = randomUUID(),
        access = token(),
        createdAt = new Date().toISOString();
      const body = projectOutput(project, assets);
      await db.saveProject({ id, tokenHash: sha(access), body, createdAt });
      res.status(201).json({ id, token: access });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/projects/:id", async (req, res, next) => {
    try {
      if (!z.string().uuid().safeParse(req.params.id).success)
        throw fail(404, "Проект не найден");
      const row = await db.getProject(req.params.id);
      if (!row || !secretMatches(req.query.token as string, row.tokenHash))
        throw fail(404, "Проект не найден");
      res.set("Cache-Control", "private, no-store").json(row.body);
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/orders", mutate, async (req, res, next) => {
    try {
      const parsed = orderSchema.safeParse(req.body);
      if (!parsed.success) throw fail(400, "Проверьте данные заказа");
      const payload = parsed.data,
        { project, assets: refs, files, contact, idempotencyKey } = payload;
      if (![...project.sides.front, ...project.sides.back].length)
        throw fail(400, "Добавьте дизайн перед оформлением заказа");
      const product = validateProject(project);
      const allRefs = new Map<string, string>();
      for (const ref of [
        ...refs,
        ...files.map((f) => ({ id: f.assetId, token: f.token })),
      ]) {
        const prior = allRefs.get(ref.id);
        if (prior && prior !== ref.token)
          throw fail(404, "Файл не найден или нет доступа");
        allRefs.set(ref.id, ref.token);
      }
      const assetMap = await resolveAssets(
        [...allRefs].map(([id, token]) => ({ id, token })),
      );
      await validateObjectAssets(project, assetMap);
      const used = (["front", "back"] as const).filter(
        (s) => project.sides[s].length > 0,
      );
      if (
        files.length !== used.length * 2 ||
        files.some((f) => !used.includes(f.side))
      )
        throw fail(
          400,
          "Для каждой стороны с дизайном нужны печатный файл и превью",
        );
      const outputKeys = new Set<string>();
      for (const side of used)
        for (const kind of ["print", "preview"] as const) {
          const match = files.filter((f) => f.side === side && f.kind === kind);
          if (match.length !== 1)
            throw fail(
              400,
              "Файлы заказа не соответствуют сторонам с дизайном",
            );
          const f = match[0],
            stored = assetMap.get(f.assetId);
          if (!stored || !secretMatches(f.token, stored.row.tokenHash))
            throw fail(404, "Файл заказа не найден или нет доступа");
          const unique = `${side}:${kind}`;
          if (outputKeys.has(unique))
            throw fail(400, "Файл заказа указан повторно");
          outputKeys.add(unique);
          const bytes = (await db.getAsset(f.assetId))!.bytes;
          let info: Metadata;
          try {
            info = await sharp(bytes, {
              limitInputPixels: maxPixels,
              failOn: "error",
            }).metadata();
          } catch {
            throw fail(400, "Файл заказа повреждён");
          }
          if (kind === "print") {
            const area = product.areas[side];
            if (
              stored.row.mime !== "image/png" ||
              info.format !== "png" ||
              !info.hasAlpha ||
              info.width !== mmToPx(area.width, dpi) ||
              info.height !== mmToPx(area.height, dpi)
            )
              throw fail(
                400,
                "Печатный PNG должен иметь прозрачность и точный размер области при 300 dpi",
              );
          } else if (info.width !== 600 || info.height !== 680)
            throw fail(400, "Превью должно иметь размер 600×680 пикселей");
        }
      const price = calculatePrice(project, product),
        createdAt = new Date().toISOString();
      const sourceIds = new Set(
        [...project.sides.front, ...project.sides.back].flatMap((o) =>
          o.type === "image" ? [o.assetId] : [],
        ),
      );
      const sourceHashes = [];
      for (const id of [...sourceIds].sort()) {
        const loaded = await db.getAsset(id);
        if (!loaded) throw fail(404, "Исходное изображение не найдено");
        sourceHashes.push({ id, hash: sha(loaded.bytes) });
      }
      // Idempotency describes the business request, not browser-rendered PNG bytes:
      // Chromium may rasterize equivalent SVG geometry with tiny pixel differences.
      const fingerprint = sha(canonical({ project, contact, sourceHashes }));
      const localDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: process.env.ORDER_TIME_ZONE || "Europe/Kaliningrad",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date(createdAt));
      const datePart = (type: Intl.DateTimeFormatPartTypes) =>
        localDate.find((p) => p.type === type)?.value || "";
      const id = randomUUID(),
        access = token(),
        number = `MS-${datePart("year")}${datePart("month")}${datePart("day")}-${id.slice(0, 8).toUpperCase()}`;
      const fullAssets = [...assetMap.values()].map((x) =>
        safeAsset(x.row, x.token),
      );
      const snapshot: OrderSnapshot = {
        id,
        number,
        createdAt,
        contact,
        project,
        product: structuredClone(product),
        price,
        assets: fullAssets,
        files: files.map((f) => ({
          ...f,
          url: `/api/assets/${f.assetId}?token=${encodeURIComponent(f.token)}`,
        })),
        accessToken: access,
      };
      const created = await db.createOrder({
        id,
        tokenHash: sha(access),
        idempotencyKey,
        fingerprint,
        body: { ...snapshot, accessToken: access },
        createdAt,
      });
      if (created.row.fingerprint !== fingerprint)
        throw fail(409, "Ключ повтора уже использован для другого заказа");
      const order = created.row.body as OrderSnapshot;
      res.status(created.created ? 201 : 200).json({
        id: order.id,
        token: order.accessToken,
        number: order.number,
        price: order.price,
      });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/orders/:id", async (req, res, next) => {
    try {
      if (!z.string().uuid().safeParse(req.params.id).success)
        throw fail(404, "Заказ не найден");
      const row = await db.getOrder(req.params.id);
      if (!row || !secretMatches(req.query.token as string, row.tokenHash))
        throw fail(404, "Заказ не найден");
      const { accessToken: _secret, ...snapshot } = row.body as OrderSnapshot;
      res.set("Cache-Control", "private, no-store").json(snapshot);
    } catch (e) {
      next(e);
    }
  });

  if (production) {
    app.use(
      express.static(resolve(here, "../dist"), {
        dotfiles: "deny",
        index: "index.html",
        fallthrough: true,
        maxAge: "1h",
      }),
    );
    app.get("/{*path}", (req, res, next) => {
      if (
        req.path.startsWith("/api/") ||
        req.path === "/api" ||
        !req.accepts("html")
      )
        return next();
      res.sendFile(resolve(here, "../dist/index.html"));
    });
  }
  const errors: ErrorRequestHandler = (
    err,
    _req: Request,
    res: Response,
    _next,
  ) => {
    if (res.headersSent) return;
    const error = err as Error & { status?: number };
    const status =
      Number(error.status) ||
      (err instanceof multer.MulterError
        ? err.code === "LIMIT_FILE_SIZE"
          ? 413
          : 400
        : 500);
    const message =
      status >= 500
        ? "Внутренняя ошибка сервера"
        : err instanceof multer.MulterError
          ? err.code === "LIMIT_FILE_SIZE"
            ? "Файл превышает 12 МБ. Выберите изображение меньшего размера."
            : "Некорректная загрузка. Отправьте один файл PNG, JPEG или WebP."
          : err instanceof SyntaxError
            ? "Некорректный JSON запроса."
            : error.message || "Некорректный запрос";
    if (status >= 500) console.error("server error");
    res.status(status).json({ error: message });
  };
  app.use(errors);
  return { app, close: () => db.close() };
}
