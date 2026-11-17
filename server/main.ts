import { createApp } from "./index.js";

try {
  process.loadEnvFile?.();
} catch {}

const production = process.env.NODE_ENV === "production";
try {
  const { app } = await createApp({ production });
  if (!production) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
  const port = Number(process.env.PORT) || 5173;
  const host = process.env.HOST || (production ? "0.0.0.0" : "127.0.0.1");
  app.listen(port, host, () =>
    console.log(`Конструктор запущен: http://${host}:${port}`),
  );
} catch {
  console.error("Не удалось запустить сервер");
  process.exitCode = 1;
}
