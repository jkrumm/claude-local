import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { reposRoutes } from "./routes/repos";

const app = new Elysia()
  .get("/health", () => ({ ok: true }))
  .use(reposRoutes)
  .use(staticPlugin({ assets: "dist", prefix: "/" }))
  .listen(7705);

console.log("cqueue server running on port 7705");

export type App = typeof app;
