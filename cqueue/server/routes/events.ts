import { Elysia, sse } from "elysia";
import { watch } from "fs";
import { existsSync } from "fs";
import { join } from "path";

export const eventsRoutes = new Elysia({ prefix: "/api" }).get(
  "/events",
  async function* ({ query, request }) {
    const path = query.path;
    if (!path) {
      yield sse({ event: "error", data: JSON.stringify({ error: "Missing path" }) });
      return;
    }

    const queuePath = join(path, "cqueue.md");
    const notesPath = join(path, "cnotes.md");

    const pending: Array<{ file: "queue" | "notes" }> = [];
    let wake: (() => void) | null = null;
    let closed = false;

    const notify = (file: "queue" | "notes") => {
      pending.push({ file });
      wake?.();
      wake = null;
    };

    const watchers: ReturnType<typeof watch>[] = [];

    if (existsSync(queuePath)) {
      watchers.push(watch(queuePath, () => notify("queue")));
    }
    if (existsSync(notesPath)) {
      watchers.push(watch(notesPath, () => notify("notes")));
    }

    const cleanup = () => {
      if (closed) return;
      closed = true;
      for (const w of watchers) w.close();
      wake?.();
      wake = null;
    };

    request.signal.addEventListener("abort", cleanup);

    yield sse({ event: "connected", data: "{}" });

    while (!request.signal.aborted) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });

      while (pending.length > 0) {
        const event = pending.shift()!;
        yield sse({ event: "change", data: JSON.stringify(event) });
      }
    }

    cleanup();
  },
);
