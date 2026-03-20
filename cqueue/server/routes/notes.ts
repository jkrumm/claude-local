import { Elysia } from "elysia";
import { join } from "path";
import { promises as fs } from "fs";
import { toContainerPath } from "../lib/workspace";

export const notesRoutes = new Elysia({ prefix: "/api" })
  .get("/notes", async ({ query, set }) => {
    const path = query.path;
    if (!path) {
      set.status = 400;
      return { ok: false, error: "Missing path query parameter" } as const;
    }

    const notesPath = join(toContainerPath(path), "cnotes.md");

    try {
      const content = await Bun.file(notesPath).text();
      return { ok: true, data: content } as const;
    } catch {
      return { ok: true, data: "" } as const;
    }
  })
  .put("/notes", async ({ query, body, set }) => {
    const path = query.path;
    if (!path) {
      set.status = 400;
      return { ok: false, error: "Missing path query parameter" } as const;
    }

    const b = body as { content?: string };
    if (!b || typeof b.content !== "string") {
      set.status = 400;
      return { ok: false, error: "Body must be { content: string }" } as const;
    }

    const notesPath = join(toContainerPath(path), "cnotes.md");
    const tmpPath = `${notesPath}.tmp`;

    await Bun.write(tmpPath, b.content);
    await fs.rename(tmpPath, notesPath);

    return { ok: true } as const;
  });
