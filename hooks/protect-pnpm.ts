#!/usr/bin/env bun

/**
 * PreToolUse hook: Claude Code must not run pnpm commands directly.
 *
 * vite+ (vp) is the unified toolchain that wraps pnpm under the hood.
 * All package management and script execution should go through `vp`.
 *
 * BLOCKED:
 *   pnpm <any command>   — use `vp` equivalent instead
 *
 * COMMON MAPPINGS:
 *   pnpm install           → vp install
 *   pnpm add <pkg>         → vp add <pkg>
 *   pnpm remove <pkg>      → vp remove <pkg>
 *   pnpm run <script>      → vp run <script>
 *   pnpm exec <bin>        → vp exec <bin>
 *   pnpm dlx <pkg>         → vp dlx <pkg>
 *   pnpm update            → vp update
 *   pnpm outdated          → vp outdated
 *   pnpm list              → vp list
 *   pnpm why <pkg>         → vp why <pkg>
 *   pnpm -r / --filter     → use `vp pm <cmd>` to forward workspace commands to pnpm
 *
 * TO BYPASS:
 *   Run the pnpm command directly in your terminal — the hook does not apply.
 *   Only do this if you are certain vp cannot fulfil the need.
 */

interface HookInput {
  tool_name: string;
  tool_input?: { command?: string; [key: string]: unknown };
}

function block(reason: string): never {
  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
  process.stdout.write(output);
  process.exit(0);
}

const input: HookInput = JSON.parse(await Bun.stdin.text());

if (input.tool_name !== "Bash") process.exit(0);

const command = (input.tool_input?.command ?? "").trim();

// Match any command that starts with or contains a bare `pnpm` invocation.
// Negative lookahead avoids false positives on e.g. "echo pnpm" or paths.
if (/(?:^|&&|\||;)\s*pnpm\b/.test(command)) {
  // Try to suggest a vp equivalent based on the subcommand used
  const subMatch = command.match(/\bpnpm\s+(\S+)/);
  const sub = subMatch?.[1] ?? "";

  const suggestions: Record<string, string> = {
    install: "vp install",
    i: "vp install",
    add: "vp add <pkg>",
    remove: "vp remove <pkg>",
    rm: "vp remove <pkg>",
    un: "vp remove <pkg>",
    uninstall: "vp remove <pkg>",
    run: "vp run <script>",
    exec: "vp exec <bin>",
    dlx: "vp dlx <pkg>",
    update: "vp update",
    up: "vp update",
    outdated: "vp outdated",
    list: "vp list",
    ls: "vp list",
    why: "vp why <pkg>",
    explain: "vp why <pkg>",
    "": "vp <subcommand>",
  };

  const suggestion = suggestions[sub] ?? `vp ${sub}`;

  block(
    [
      "Direct pnpm usage is blocked in Claude Code.",
      "",
      "vite+ (vp) is the unified toolchain — use it instead:",
      `  Suggested equivalent: ${suggestion}`,
      "",
      "Common mappings:",
      "  pnpm install          →  vp install",
      "  pnpm add <pkg>        →  vp add <pkg>",
      "  pnpm remove <pkg>     →  vp remove <pkg>",
      "  pnpm run <script>     →  vp run <script>",
      "  pnpm exec <bin>       →  vp exec <bin>",
      "  pnpm dlx <pkg>        →  vp dlx <pkg>",
      "  pnpm update           →  vp update",
      "  pnpm outdated         →  vp outdated",
      "  pnpm list             →  vp list",
      "  pnpm why <pkg>        →  vp why <pkg>",
      "  pnpm -r / --filter    →  vp pm <cmd>  (forwards workspace cmds to pnpm)",
      "",
      "If vp cannot fulfil this need, run the pnpm command directly in your terminal.",
    ].join("\n")
  );
}

process.exit(0);
