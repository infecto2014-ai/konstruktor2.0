import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../server/index.js";
import type { Product, Project } from "../shared/model.js";

const product: Product = {
  id: "classic",
  name: "Тестовая футболка",
  description: "Товар для тестов",
  basePrice: 10000,
  sidePrice: 2000,
  colors: [{ id: "white", name: "Белый", hex: "#ffffff" }],
  sizes: ["M"],
  areas: { front: { width: 24, height: 32 }, back: { width: 24, height: 32 } },
  mockups: { front: "/mock-front.png", back: "/mock-back.png" },
  demo: true,
};
const roots: string[] = [];
const servers: Server[] = [];
after(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
  for (const d of roots) await rm(d, { recursive: true, force: true });
});
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "konstruktor-test-"));
  roots.push(dataDir);
  const { app, close } = await createApp({
    dataDir,
    catalog: [product],
    allowedOrigins: ["http://localhost:5174"],
    production: false,
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  return { base, close };
}
const png = (width: number, height: number, alpha = true, tint = 240) =>
  sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha
        ? { r: tint, g: 0, b: 0, alpha: 0 }
        : { r: tint, g: tint, b: tint },
    },
  })
    .png()
    .toBuffer();
async function upload(base: string, bytes: Buffer, name = "image.png") {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    name,
  );
  const r = await fetch(`${base}/api/assets`, { method: "POST", body: form });
  return { response: r, data: (await r.json()) as any };
}
const project = (withText = true): Project => ({
  version: 1,
  productId: "classic",
  colorId: "white",
  size: "M",
  quantity: 2,
  sides: {
    front: withText
      ? [
          {
            id: randomUUID(),
            type: "text",
            x: 12,
            y: 16,
            width: 10,
            height: 8,
            rotation: 0,
            text: "Привет",
            font: "Noto Sans",
            fontSize: 20,
            color: "#111111",
            align: "center",
            lineHeight: 1.2,
          },
        ]
      : [],
    back: [],
  },
});

test("catalog exposes prices, print DPI and configured embedding origins", async () => {
  const f = await fixture();
  try {
    const r = await fetch(`${f.base}/api/catalog`);
    assert.equal(r.status, 200);
    const j = (await r.json()) as any;
    assert.equal(j.exportDpi, 300);
    assert.deepEqual(j.allowedOrigins, ["http://localhost:5174"]);
    assert.equal(j.products[0].id, "classic");
    const csp = r.headers.get("content-security-policy") || "";
    assert.match(csp, /frame-ancestors 'self' http:\/\/localhost:5174/);
    assert.equal(r.headers.get("x-frame-options"), null);
  } finally {
    await f.close();
  }
});

test("rejects cross-origin mutations before saving project", async () => {
  const f = await fixture();
  try {
    const r = await fetch(`${f.base}/api/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
      },
      body: JSON.stringify({ project: project(), assets: [] }),
    });
    assert.equal(r.status, 403);
  } finally {
    await f.close();
  }
});

test("uploads retain image data and enforce bearer token access", async () => {
  const f = await fixture();
  try {
    const original = await png(48, 32);
    const { response, data } = await upload(f.base, original);
    assert.equal(response.status, 201);
    let get = await fetch(`${f.base}/api/assets/${data.id}`);
    assert.equal(get.status, 404);
    get = await fetch(
      `${f.base}/api/assets/${data.id}?token=${encodeURIComponent(data.token)}`,
    );
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), original);
  } finally {
    await f.close();
  }
});

test("rejects spoofed SVG upload even when named PNG", async () => {
  const f = await fixture();
  try {
    const { response, data } = await upload(
      f.base,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    );
    assert.equal(response.status, 415);
    assert.match(data.error, /PNG, JPEG или WebP/);
  } finally {
    await f.close();
  }
});

test("rejects malformed JPEG bytes and dimensions above pixel or side limits", async () => {
  const f = await fixture();
  try {
    let result = await upload(f.base, Buffer.from("not a jpeg"), "photo.png");
    assert.equal(result.response.status, 415);
    result = await upload(f.base, await png(10001, 1));
    assert.equal(result.response.status, 413);
    result = await upload(f.base, await png(5000, 5000));
    assert.equal(result.response.status, 413);
  } finally {
    await f.close();
  }
});

test("saves private project and creates immutable priced order idempotently", async () => {
  const f = await fixture();
  try {
    const p = project();
    const saved = await fetch(`${f.base}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: p, assets: [] }),
    });
    assert.equal(saved.status, 201);
    const projectAccess = (await saved.json()) as any;
    let loaded = await fetch(
      `${f.base}/api/projects/${projectAccess.id}?token=${projectAccess.token}`,
    );
    assert.equal(loaded.status, 200);
    assert.equal(((await loaded.json()) as any).project.sides.front.length, 1);
    loaded = await fetch(`${f.base}/api/projects/${projectAccess.id}`);
    assert.equal(loaded.status, 404);

    const [print, preview] = await Promise.all([
      upload(f.base, await png(283, 378)),
      upload(f.base, await png(600, 680, false)),
    ]);
    assert.equal(print.response.status, 201);
    assert.equal(preview.response.status, 201);
    const assets = [print.data, preview.data];
    const payload = {
      project: p,
      assets: [],
      contact: {
        name: "Тестовый клиент",
        contact: "test@example.com",
        consent: true,
      },
      idempotencyKey: randomUUID(),
      files: [
        {
          kind: "print",
          side: "front",
          assetId: assets[0].id,
          token: assets[0].token,
        },
        {
          kind: "preview",
          side: "front",
          assetId: assets[1].id,
          token: assets[1].token,
        },
      ],
    };
    const create = () =>
      fetch(`${f.base}/api/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    let order = await create();
    assert.equal(order.status, 201);
    const first = (await order.json()) as any;
    assert.equal(first.price.base, 10000);
    assert.equal(first.price.printing, 2000);
    assert.equal(first.price.total, 24000);
    const [retryPrint, retryPreview] = await Promise.all([
      upload(f.base, await png(283, 378)),
      upload(f.base, await png(600, 680, false, 120)),
    ]);
    const retryPayload = {
      ...payload,
      files: [
        {
          kind: "print",
          side: "front",
          assetId: retryPrint.data.id,
          token: retryPrint.data.token,
        },
        {
          kind: "preview",
          side: "front",
          assetId: retryPreview.data.id,
          token: retryPreview.data.token,
        },
      ],
    };
    order = await fetch(`${f.base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(retryPayload),
    });
    assert.equal(order.status, 200);
    const retry = (await order.json()) as any;
    assert.equal(retry.id, first.id);
    assert.equal(retry.token, first.token);
    const changed = {
      ...payload,
      contact: { ...payload.contact, name: "Другой клиент" },
    };
    order = await fetch(`${f.base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(changed),
    });
    assert.equal(order.status, 409);
    const snapshot = await fetch(
      `${f.base}/api/orders/${first.id}?token=${first.token}`,
    );
    assert.equal(snapshot.status, 200);
    const body = (await snapshot.json()) as any;
    assert.equal(body.number, first.number);
    assert.equal(body.price.total, 24000);
    assert.equal(body.files.length, 2);
    assert.equal(body.contact.name, "Тестовый клиент");
    const hidden = await fetch(`${f.base}/api/orders/${first.id}`);
    assert.equal(hidden.status, 404);
    const tamperedPrice = {
      ...payload,
      price: {
        base: 1,
        printing: 0,
        unit: 1,
        quantity: 2,
        total: 2,
        usedSides: ["front"],
      },
    };
    order = await fetch(`${f.base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tamperedPrice),
    });
    assert.equal(order.status, 400);
  } finally {
    await f.close();
  }
});

test("rejects forged client pixel dimensions and order with no design", async () => {
  const f = await fixture();
  try {
    const a = await upload(f.base, await png(48, 32));
    assert.equal(a.response.status, 201);
    const forged = project();
    forged.sides.front = [
      {
        id: randomUUID(),
        type: "image",
        assetId: a.data.id,
        x: 12,
        y: 16,
        width: 10,
        height: 8,
        rotation: 0,
        pixelWidth: 200,
        pixelHeight: 200,
      } as any,
    ];
    let r = await fetch(`${f.base}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project: forged,
        assets: [{ id: a.data.id, token: a.data.token }],
      }),
    });
    assert.equal(r.status, 400);
    const empty = project(false),
      fake = await upload(f.base, await png(284, 378)),
      prev = await upload(f.base, await png(600, 680, false));
    r = await fetch(`${f.base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project: empty,
        assets: [fake.data, prev.data].map((x) => ({
          id: x.id,
          token: x.token,
        })),
        contact: { name: "Тест", contact: "test@example.com", consent: true },
        idempotencyKey: randomUUID(),
        files: [
          {
            kind: "print",
            side: "front",
            assetId: fake.data.id,
            token: fake.data.token,
          },
          {
            kind: "preview",
            side: "front",
            assetId: prev.data.id,
            token: prev.data.token,
          },
        ],
      }),
    });
    assert.equal(r.status, 400);
  } finally {
    await f.close();
  }
});

test("allows saving out-of-bounds drafts but refuses ordering until fixed", async () => {
  const f = await fixture();
  try {
    const draft = project();
    draft.sides.front[0].x = 0.5;
    let r = await fetch(`${f.base}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: draft, assets: [] }),
    });
    assert.equal(r.status, 201);
    const print = await upload(f.base, await png(283, 378)),
      preview = await upload(f.base, await png(600, 680, false));
    r = await fetch(`${f.base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project: draft,
        assets: [],
        contact: { name: "Клиент", contact: "test@example.com", consent: true },
        idempotencyKey: randomUUID(),
        files: [
          {
            kind: "print",
            side: "front",
            assetId: print.data.id,
            token: print.data.token,
          },
          {
            kind: "preview",
            side: "front",
            assetId: preview.data.id,
            token: preview.data.token,
          },
        ],
      }),
    });
    assert.equal(r.status, 400);
  } finally {
    await f.close();
  }
});

test("rejects duplicate object ids across sides", async () => {
  const f = await fixture();
  try {
    const p = project();
    p.sides.back = [{ ...p.sides.front[0] }];
    const r = await fetch(`${f.base}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: p, assets: [] }),
    });
    assert.equal(r.status, 400);
  } finally {
    await f.close();
  }
});

test("rejects transparent PNG with wrong print size and opaque PNG as print file", async () => {
  const f = await fixture();
  try {
    const p = project(),
      preview = await upload(f.base, await png(600, 680, false));
    for (const image of [await png(282, 378), await png(283, 378, false)]) {
      const print = await upload(f.base, image);
      const r = await fetch(`${f.base}/api/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project: p,
          assets: [],
          contact: {
            name: "Клиент",
            contact: "test@example.com",
            consent: true,
          },
          idempotencyKey: randomUUID(),
          files: [
            {
              kind: "print",
              side: "front",
              assetId: print.data.id,
              token: print.data.token,
            },
            {
              kind: "preview",
              side: "front",
              assetId: preview.data.id,
              token: preview.data.token,
            },
          ],
        }),
      });
      assert.equal(r.status, 400);
    }
  } finally {
    await f.close();
  }
});

test(
  "PostgreSQL adapter integration is skipped unless an isolated DB is configured",
  { skip: !process.env.PG_TEST_URL },
  async () => {
    // Set PG_TEST_URL to a disposable PostgreSQL database before running this integration suite.
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = process.env.PG_TEST_URL;
    try {
      const f = await fixture();
      try {
        const saved = await fetch(`${f.base}/api/projects`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ project: project(), assets: [] }),
        });
        assert.equal(saved.status, 201);
        const credentials = (await saved.json()) as any;
        const loaded = await fetch(
          `${f.base}/api/projects/${credentials.id}?token=${credentials.token}`,
        );
        assert.equal(loaded.status, 200);
      } finally {
        await f.close();
      }
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  },
);
