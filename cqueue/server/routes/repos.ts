import { Elysia } from "elysia";
import { existsSync } from "fs";
import { join } from "path";
import { scanRepos } from "../lib/repo-scanner";
import { parseQueue } from "../lib/parse-queue";
import { getGitStatus } from "../lib/git";
import { toContainerPath, toDisplayPath } from "../lib/workspace";

async function ensureFile(filePath: string): Promise<string> {
  if (!existsSync(filePath)) {
    await Bun.write(filePath, "");
  }
  return Bun.file(filePath).text();
}

export const reposRoutes = new Elysia({ prefix: "/api" })
  .get("/repos", () => {
    const repos = scanRepos();
    return { ok: true, data: repos };
  })
  .get("/repo", async ({ query, set }) => {
    const path = query.path;
    if (!path) {
      set.status = 400;
      return { ok: false, error: "Missing path query parameter" };
    }

    const containerPath = toContainerPath(path);
    const queuePath = join(containerPath, "cqueue.md");
    const notesPath = join(containerPath, "cnotes.md");

    const [queueRaw, notes] = await Promise.all([
      ensureFile(queuePath),
      ensureFile(notesPath),
    ]);

    const queue = parseQueue(queueRaw);
    const git = getGitStatus(containerPath);

    // Normalise worktree paths to display paths so frontend can pass them back
    // to API endpoints directly (e.g. /api/actions/chain { worktreePath })
    if (git) {
      git.worktrees = git.worktrees.map((wt) => ({
        ...wt,
        path: toDisplayPath(wt.path),
      }));
    }

    const repo = {
      name: path.split("/").pop() ?? path,
      path,
      containerPath,
      hasQueue: existsSync(queuePath),
      hasNotes: existsSync(notesPath),
    };

    return { ok: true, data: { repo, queue, notes, git } };
  });
