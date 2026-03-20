import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { readFileSync } from "fs";
import { reposRoutes } from "./routes/repos";
import { queueRoutes } from "./routes/queue";
import { notesRoutes } from "./routes/notes";
import { eventsRoutes } from "./routes/events";

const indexHtml = readFileSync("dist/index.html", "utf-8");

const app = new Elysia()
  .get("/health", () => ({ ok: true }))
  .use(reposRoutes)
  .use(queueRoutes)
  .use(notesRoutes)
  .use(eventsRoutes)
  .use(staticPlugin({ assets: "dist/assets", prefix: "/assets" }))
  .onError(({ code, set }) => {
    if (code === "NOT_FOUND") {
      set.headers["content-type"] = "text/html; charset=utf-8";
      return indexHtml;
    }
  })
  .listen(7705);

console.log("cqueue server running on port 7705");

export type App = typeof app;
