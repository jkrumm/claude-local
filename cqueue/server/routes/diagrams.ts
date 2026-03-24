import { Elysia } from "elysia";
import { join, resolve } from "path";
import { promises as fs } from "fs";
import { toContainerPath } from "../lib/workspace";

const DIAGRAMS_DIR = "docs/diagrams";

function diagramsDir(repoContainerPath: string): string {
  return join(repoContainerPath, DIAGRAMS_DIR);
}

function sanitizeName(name: string): string | null {
  if (!name || name.length > 100) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) return null;
  if (!/^[a-zA-Z0-9 \-_]+$/.test(trimmed)) return null;
  return trimmed;
}

export interface DiagramMeta {
  name: string;
  hasSvg: boolean;
  modifiedAt: number;
}

export const diagramsRoutes = new Elysia({ prefix: "/api" })
  // List all diagrams in docs/diagrams/
  .get("/diagrams", async ({ query, set }) => {
    const path = query.path;
    if (!path) {
      set.status = 400;
      return { ok: false, error: "Missing path" } as const;
    }

    const dir = diagramsDir(toContainerPath(path));

    try {
      await fs.mkdir(dir, { recursive: true });
      const entries = await fs.readdir(dir);
      const diagrams: DiagramMeta[] = [];

      for (const entry of entries) {
        if (!entry.endsWith(".excalidraw")) continue;
        const name = entry.slice(0, -".excalidraw".length);
        const svgPath = join(dir, `${name}.svg`);
        let hasSvg = false;
        let modifiedAt = 0;

        try {
          const stat = await fs.stat(join(dir, entry));
          modifiedAt = stat.mtimeMs;
          await fs.access(svgPath);
          hasSvg = true;
        } catch {
          // file may not exist yet
        }

        diagrams.push({ name, hasSvg, modifiedAt });
      }

      diagrams.sort((a, b) => b.modifiedAt - a.modifiedAt);
      return { ok: true, data: diagrams } as const;
    } catch {
      return { ok: true, data: [] as DiagramMeta[] } as const;
    }
  })

  // Get .excalidraw file content
  .get("/diagrams/file", async ({ query, set }) => {
    const { path, name } = query;
    if (!path || !name) {
      set.status = 400;
      return { ok: false, error: "Missing path or name" } as const;
    }

    const safeName = sanitizeName(name);
    if (!safeName) {
      set.status = 400;
      return { ok: false, error: "Invalid diagram name" } as const;
    }

    const dir = diagramsDir(toContainerPath(path));
    const filePath = resolve(join(dir, `${safeName}.excalidraw`));
    if (!filePath.startsWith(resolve(dir))) {
      set.status = 400;
      return { ok: false, error: "Path traversal not allowed" } as const;
    }

    try {
      const content = await Bun.file(filePath).text();
      return { ok: true, data: content } as const;
    } catch {
      return { ok: true, data: "" } as const;
    }
  })

  // Save .excalidraw file and optional .svg
  .put("/diagrams/file", async ({ query, body, set }) => {
    const { path, name } = query;
    if (!path || !name) {
      set.status = 400;
      return { ok: false, error: "Missing path or name" } as const;
    }

    const safeName = sanitizeName(name);
    if (!safeName) {
      set.status = 400;
      return { ok: false, error: "Invalid diagram name" } as const;
    }

    const b = body as { excalidraw?: string; svg?: string };
    if (!b || typeof b.excalidraw !== "string") {
      set.status = 400;
      return { ok: false, error: "Body must include excalidraw string" } as const;
    }

    const dir = diagramsDir(toContainerPath(path));
    await fs.mkdir(dir, { recursive: true });

    const excalidrawPath = resolve(join(dir, `${safeName}.excalidraw`));
    if (!excalidrawPath.startsWith(resolve(dir))) {
      set.status = 400;
      return { ok: false, error: "Path traversal not allowed" } as const;
    }

    const tmpExcalidraw = `${excalidrawPath}.tmp`;
    await Bun.write(tmpExcalidraw, b.excalidraw);
    await fs.rename(tmpExcalidraw, excalidrawPath);

    if (typeof b.svg === "string" && b.svg.length > 0) {
      const svgPath = resolve(join(dir, `${safeName}.svg`));
      const tmpSvg = `${svgPath}.tmp`;
      await Bun.write(tmpSvg, b.svg);
      await fs.rename(tmpSvg, svgPath);
    }

    return { ok: true } as const;
  })

  // Delete .excalidraw + .svg pair
  .delete("/diagrams/file", async ({ query, set }) => {
    const { path, name } = query;
    if (!path || !name) {
      set.status = 400;
      return { ok: false, error: "Missing path or name" } as const;
    }

    const safeName = sanitizeName(name);
    if (!safeName) {
      set.status = 400;
      return { ok: false, error: "Invalid diagram name" } as const;
    }

    const dir = diagramsDir(toContainerPath(path));
    const excalidrawPath = resolve(join(dir, `${safeName}.excalidraw`));
    if (!excalidrawPath.startsWith(resolve(dir))) {
      set.status = 400;
      return { ok: false, error: "Path traversal not allowed" } as const;
    }

    await fs.unlink(excalidrawPath).catch(() => {});
    await fs.unlink(resolve(join(dir, `${safeName}.svg`))).catch(() => {});

    return { ok: true } as const;
  })

  // Rename .excalidraw + .svg pair
  .post("/diagrams/rename", async ({ query, body, set }) => {
    const { path } = query;
    const b = body as { name?: string; newName?: string };
    if (!path || !b?.name || !b?.newName) {
      set.status = 400;
      return { ok: false, error: "Missing path, name, or newName" } as const;
    }

    const safeName = sanitizeName(b.name);
    const safeNewName = sanitizeName(b.newName);
    if (!safeName || !safeNewName) {
      set.status = 400;
      return { ok: false, error: "Invalid diagram name" } as const;
    }

    const dir = diagramsDir(toContainerPath(path));
    const resolvedDir = resolve(dir);

    const oldExcalidraw = resolve(join(dir, `${safeName}.excalidraw`));
    const newExcalidraw = resolve(join(dir, `${safeNewName}.excalidraw`));
    if (!oldExcalidraw.startsWith(resolvedDir) || !newExcalidraw.startsWith(resolvedDir)) {
      set.status = 400;
      return { ok: false, error: "Path traversal not allowed" } as const;
    }

    await fs.rename(oldExcalidraw, newExcalidraw).catch(() => {});
    await fs.rename(
      resolve(join(dir, `${safeName}.svg`)),
      resolve(join(dir, `${safeNewName}.svg`)),
    ).catch(() => {});

    return { ok: true } as const;
  })

  // Serve SVG file for thumbnails (returns SVG with correct content-type)
  .get("/diagrams/svg", async ({ query, set }) => {
    const { path, name } = query;
    if (!path || !name) {
      set.status = 400;
      return "Missing path or name";
    }

    const safeName = sanitizeName(name);
    if (!safeName) {
      set.status = 400;
      return "Invalid name";
    }

    const dir = diagramsDir(toContainerPath(path));
    const svgPath = resolve(join(dir, `${safeName}.svg`));
    if (!svgPath.startsWith(resolve(dir))) {
      set.status = 400;
      return "Path traversal not allowed";
    }

    try {
      const content = await Bun.file(svgPath).text();
      set.headers["content-type"] = "image/svg+xml";
      set.headers["cache-control"] = "no-cache";
      return content;
    } catch {
      set.status = 404;
      return "Not found";
    }
  });
