#!/usr/bin/env bun

/**
 * Tests for the protect-branches PreToolUse hook.
 *
 * The hook is symlinked live into ~/.claude/hooks, so a regression here changes
 * real behaviour immediately, and the two failure directions are not symmetric.
 * A false allow lets Claude push to a branch that must go through a PR. A false
 * block is worse than annoying: it is silent about *which* repo it protected,
 * so a fleet run reads it as "this repo is protected" and abandons a push that
 * was always allowed. Both directions are covered below.
 */

import { describe, expect, test } from "bun:test";
import { inspectGit, inspectPush, repoDirectories } from "./protect-branches";

const HOME = process.env.HOME ?? "";

describe("inspectGit — the subcommand is not always at index 1", () => {
  test("plain invocation", () => {
    expect(inspectGit(["git", "push", "origin", "master"])).toEqual({
      subcommand: "push",
      args: ["origin", "master"],
      cDirs: [],
    });
  });

  test("global flags are walked, not counted", () => {
    expect(inspectGit(["git", "-C", "/repo", "-c", "user.name=x", "push"])).toEqual({
      subcommand: "push",
      args: [],
      cDirs: ["/repo"],
    });
  });

  test("a wrapper prefix does not hide the invocation", () => {
    expect(inspectGit(["timeout", "60", "git", "push"])?.subcommand).toBe("push");
  });

  test("a non-git command is not one", () => {
    expect(inspectGit(["bun", "test"])).toBeNull();
  });

  test("git with only global flags has no subcommand", () => {
    expect(inspectGit(["git", "--version"])?.subcommand).toBeNull();
  });
});

describe("inspectPush — a protected branch named in prose is data", () => {
  test("an explicit refspec is a protected-ref push", () => {
    expect(inspectPush("git push origin master")).toEqual({ kind: "protected-ref" });
    expect(inspectPush("git push origin HEAD:main")).toEqual({ kind: "protected-ref" });
    expect(inspectPush("git push origin +HEAD:refs/heads/master")).toEqual({
      kind: "protected-ref",
    });
  });

  test("a bare push defers to the current branch", () => {
    expect(inspectPush("git push")).toEqual({ kind: "current-branch" });
    expect(inspectPush("git push origin")).toEqual({ kind: "current-branch" });
    expect(inspectPush("git push -u origin HEAD")).toEqual({ kind: "current-branch" });
  });

  test("a feature branch is neither", () => {
    expect(inspectPush("git push origin feat/thing")).toEqual({ kind: "none" });
    expect(inspectPush("git push --force-with-lease origin feat/thing")).toEqual({ kind: "none" });
  });

  test("hard force outranks everything, on any branch", () => {
    expect(inspectPush("git push --force origin feat/thing")).toEqual({ kind: "hard-force" });
    expect(inspectPush("git push -f origin feat/thing")).toEqual({ kind: "hard-force" });
  });

  test("--force-with-lease is not a hard force", () => {
    expect(inspectPush("git push --force-with-lease origin feat/x")).toEqual({ kind: "none" });
  });

  test("no push at all", () => {
    expect(inspectPush("git commit -m 'ship it'")).toEqual({ kind: "none" });
    expect(inspectPush("echo 'git push origin master'")).toEqual({ kind: "none" });
  });

  test("the branch name inside a commit message body is not a push target", () => {
    // The regression that blocked writing the hook's own docblock: the old
    // whole-string scan matched `master` anywhere, heredoc bodies included.
    const command = [
      "git commit -F - <<'EOF' && git push origin feat/x",
      "fix: stop the hook blocking every push to master in other repos",
      "EOF",
    ].join("\n");
    expect(inspectPush(command)).toEqual({ kind: "none" });
  });

  test("a value-taking flag does not become a refspec", () => {
    expect(inspectPush("git push -o ci.skip origin feat/x")).toEqual({ kind: "none" });
  });

  test("deleting a protected branch is still a protected-ref push", () => {
    expect(inspectPush("git push origin --delete master")).toEqual({ kind: "protected-ref" });
  });
});

describe("repoDirectories — the target repo, not the session's", () => {
  const session = `${HOME}/SourceRoot/dotfiles`;

  test("no target named: the session cwd", () => {
    expect(repoDirectories("git push origin master", session)).toEqual([session]);
  });

  test("a leading cd REPLACES the session cwd", () => {
    // The bug this file exists for: a session in a PR-required repo must not
    // decide the fate of a push that happens somewhere else.
    const dirs = repoDirectories(`cd ${HOME}/SourceRoot && git push origin master`, session);
    expect(dirs).toEqual([`${HOME}/SourceRoot`]);
    expect(dirs).not.toContain(session);
  });

  test("git -C names the target without moving the shell", () => {
    const dirs = repoDirectories(`git -C ${HOME}/SourceRoot push origin master`, session);
    expect(dirs).toEqual([`${HOME}/SourceRoot`]);
  });

  test("a relative -C resolves against the cd, which is where git runs", () => {
    // Both are real targets — the -C repo and the directory the shell stands
    // in — so both are reported, most specific first.
    const dirs = repoDirectories(`cd ${HOME} && git -C SourceRoot push origin master`, session);
    expect(dirs).toEqual([`${HOME}/SourceRoot`, HOME]);
  });

  test("a target that does not exist falls back to the session cwd, not to nothing", () => {
    expect(repoDirectories("git -C /no/such/dir push origin master", session)).toEqual([session]);
  });

  test("several targets are all reported", () => {
    const dirs = repoDirectories(
      `git -C ${HOME}/SourceRoot push origin master && git -C ${HOME} push origin master`,
      session
    );
    expect(dirs).toEqual([`${HOME}/SourceRoot`, HOME]);
  });
});
