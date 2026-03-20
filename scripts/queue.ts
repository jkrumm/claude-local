#!/usr/bin/env bun

/**
 * Claude Code Task Queue CLI
 *
 * Manage the ~/.claude/queue.md task queue for automated Claude Code sessions.
 * The Stop hook in notify.ts pops tasks and injects them as the next user message.
 *
 * Usage:
 *   cq add "task text"       - Add a task (single-line)
 *   cq add                   - Add a task via stdin (Ctrl+D to finish)
 *   cq edit                  - Open queue.md in $EDITOR
 *   cq list                  - Show all queued tasks
 *   cq pop                   - Print + remove first task (used by Stop hook)
 *   cq clear                 - Remove all tasks
 *   cq status                - One-line count of pending tasks
 *   cq pause                 - Append PAUSE block at end of queue
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// ============================================================================
// ANSI Styling
// ============================================================================

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  // Colors
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  // Background
  bgCyan: "\x1b[46m",
  bgGreen: "\x1b[42m",
};

const isaTTY = process.stdout.isTTY;

function style(str: string, ...codes: string[]): string {
  if (!isaTTY) return str;
  return codes.join("") + str + c.reset;
}

const fmt = {
  header: (s: string) => style(s, c.bold, c.cyan),
  label: (s: string) => style(s, c.bold, c.white),
  index: (s: string) => style(s, c.bold, c.yellow),
  preview: (s: string) => style(s, c.white),
  detail: (s: string) => style(s, c.gray),
  success: (s: string) => style(s, c.green),
  warn: (s: string) => style(s, c.yellow),
  error: (s: string) => style(s, c.red),
  path: (s: string) => style(s, c.dim, c.cyan),
  pause: (s: string) => style(s, c.magenta, c.bold),
  count: (s: string) => style(s, c.bold, c.cyan),
  slash: (s: string) => style(s, c.blue, c.bold),
};

// ============================================================================
// Queue File Resolution (per-repo via git root)
// ============================================================================

function getQueueFile(): string {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    console.error(fmt.error("\n  Not inside a git repository. cq is per-repo.\n"));
    process.exit(1);
  }
  return join(result.stdout.toString().trim(), "queue.md");
}

const QUEUE_FILE = getQueueFile();

// ============================================================================
// Queue File I/O
// ============================================================================

function readQueue(): string {
  if (!existsSync(QUEUE_FILE)) {
    return "";
  }
  return readFileSync(QUEUE_FILE, "utf-8");
}

function writeQueue(content: string): void {
  writeFileSync(QUEUE_FILE, content);
}

/**
 * Parse queue file into task blocks.
 * Strips header comment lines (# at file top) and blank leading lines.
 */
function parseBlocks(raw: string): string[] {
  const lines = raw.split("\n");

  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#") || line === "") {
      startIdx = i + 1;
    } else {
      break;
    }
  }

  const body = lines.slice(startIdx).join("\n");
  if (!body.trim()) return [];

  return body.split(/\n---\n/).map((b) => b.trim()).filter((b) => b.length > 0);
}

function writeBlocks(blocks: string[]): void {
  if (blocks.length === 0) {
    writeQueue("");
    return;
  }
  writeQueue(blocks.join("\n---\n") + "\n");
}

// ============================================================================
// Helpers
// ============================================================================

function taskKind(block: string): "pause" | "slash" | "task" {
  if (block === "PAUSE") return "pause";
  if (block.startsWith("/")) return "slash";
  return "task";
}

function taskIcon(block: string): string {
  switch (taskKind(block)) {
    case "pause":  return "⏸";
    case "slash":  return "⚡";
    default:       return "◆";
  }
}

function renderTask(block: string, index: number): string {
  const kind = taskKind(block);
  const lines = block.split("\n");
  const firstLine = lines[0];
  const lineCount = lines.length;

  const icon = taskIcon(block);
  const num = fmt.index(`[${index}]`);

  if (kind === "pause") {
    return `  ${num} ${icon} ${fmt.pause("PAUSE")} ${fmt.detail("— queue will stop here")}`;
  }

  if (kind === "slash") {
    const preview = firstLine.length > 68 ? firstLine.slice(0, 68) + "…" : firstLine;
    return `  ${num} ${icon} ${fmt.slash(preview)}`;
  }

  const preview = firstLine.length > 68 ? firstLine.slice(0, 68) + "…" : firstLine;
  const extra = lineCount > 1 ? fmt.detail(` +${lineCount - 1} line${lineCount > 2 ? "s" : ""}`) : "";
  return `  ${num} ${icon} ${fmt.preview(preview)}${extra}`;
}

// ============================================================================
// Commands
// ============================================================================

function cmdAdd(args: string[]): void {
  let task: string;

  if (args.length > 0) {
    task = args.join(" ").trim();
  } else {
    // Read from stdin until EOF
    task = readFileSync("/dev/stdin", "utf-8").trim();
  }

  if (!task) {
    console.error(fmt.error("No task text provided."));
    process.exit(1);
  }

  const raw = readQueue();
  const blocks = parseBlocks(raw);
  blocks.push(task);
  writeBlocks(blocks);

  const kind = taskKind(task);
  const icon = taskIcon(task);
  const preview = task.split("\n")[0].slice(0, 60);

  console.log(
    `\n  ${icon} ${kind === "slash" ? fmt.slash(preview) : fmt.preview(preview)}\n` +
    `  ${fmt.success("Added")} ${fmt.detail(`(${blocks.length} task${blocks.length === 1 ? "" : "s"} in queue)`)}\n`
  );
}

function cmdEdit(): void {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const proc = Bun.spawnSync([editor, QUEUE_FILE], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(proc.exitCode ?? 0);
}

function cmdList(): void {
  const raw = readQueue();
  const blocks = parseBlocks(raw);

  console.log();
  if (blocks.length === 0) {
    console.log(`  ${fmt.detail("Queue is empty.")}  ${fmt.path(QUEUE_FILE)}\n`);
    return;
  }

  console.log(`  ${fmt.header("Claude Queue")}  ${fmt.detail(`${blocks.length} task${blocks.length === 1 ? "" : "s"}`)}`);
  console.log(`  ${fmt.path(QUEUE_FILE)}\n`);

  for (let i = 0; i < blocks.length; i++) {
    console.log(renderTask(blocks[i], i + 1));
  }

  console.log();
}

function cmdPop(): void {
  const raw = readQueue();
  const blocks = parseBlocks(raw);

  if (blocks.length === 0) {
    process.exit(0);
  }

  const [first, ...rest] = blocks;
  writeBlocks(rest);

  process.stdout.write(first);
  process.exit(0);
}

function cmdClear(): void {
  writeBlocks([]);
  console.log(`\n  ${fmt.success("Queue cleared.")}\n`);
}

function cmdStatus(): void {
  const raw = readQueue();
  const blocks = parseBlocks(raw);
  const count = blocks.length;

  console.log();
  if (count === 0) {
    console.log(`  ${fmt.detail("Queue is empty.")}\n`);
  } else {
    console.log(`  ${fmt.count(String(count))} task${count === 1 ? "" : "s"} pending.\n`);
  }
}

function cmdPause(): void {
  const raw = readQueue();
  const blocks = parseBlocks(raw);
  blocks.push("PAUSE");
  writeBlocks(blocks);
  console.log(`\n  ⏸  ${fmt.pause("PAUSE")} ${fmt.success("appended")} ${fmt.detail(`(${blocks.length} blocks total)`)}\n`);
}

// ============================================================================
// Help
// ============================================================================

function printHelp(): void {
  console.log(`
  ${fmt.header("cq")} ${fmt.detail("— Claude Code Task Queue")}

  ${fmt.label("USAGE")}
    ${fmt.header("cq")} ${fmt.warn("<command>")} ${fmt.detail("[args]")}

  ${fmt.label("COMMANDS")}
    ${fmt.warn("add")} ${fmt.detail('"text"')}    Add a single-line task
    ${fmt.warn("add")}            Add a multi-line task from stdin ${fmt.detail("(Ctrl+D to finish)")}
    ${fmt.warn("edit")}           Open queue.md directly in $EDITOR
    ${fmt.warn("list")}           Show all queued tasks with index
    ${fmt.warn("pop")}            Print + remove first task ${fmt.detail("(used by Stop hook)")}
    ${fmt.warn("clear")}          Remove all tasks
    ${fmt.warn("status")}         Show pending task count
    ${fmt.warn("pause")}          Append PAUSE sentinel at end of queue
    ${fmt.warn("help")}           Show this help

  ${fmt.label("TASK KINDS")}
    ${fmt.slash("⚡ /command")}    Injected as slash command ${fmt.detail("(e.g. /commit, /code-quality)")}
    ${fmt.preview("◆ regular")}     Plain instruction injected as user message
    ${fmt.pause("⏸ PAUSE")}       Stops queue and sends notification

  ${fmt.label("QUEUE FILE")}
    ${fmt.path(QUEUE_FILE)}  ${fmt.detail("(git root of current repo)")}

  ${fmt.label("EXAMPLES")}
    ${fmt.detail('cq add "/commit --split"')}
    ${fmt.detail('cq add "Refactor the auth service to use DI"')}
    ${fmt.detail("cq pause")}
    ${fmt.detail("cq list")}
`);
}

// ============================================================================
// Entry Point
// ============================================================================

const [, , subcommand, ...rest] = process.argv;

switch (subcommand) {
  case "add":
    cmdAdd(rest);
    break;
  case "edit":
    cmdEdit();
    break;
  case "list":
    cmdList();
    break;
  case "pop":
    cmdPop();
    break;
  case "clear":
    cmdClear();
    break;
  case "status":
    cmdStatus();
    break;
  case "pause":
    cmdPause();
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    printHelp();
    break;
  default:
    console.error(fmt.error(`\n  Unknown subcommand: ${subcommand}\n`));
    printHelp();
    process.exit(1);
}
