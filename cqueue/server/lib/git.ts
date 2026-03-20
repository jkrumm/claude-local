export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  insertions: number;
  deletions: number;
  stagedCount: number;
}

function run(args: string[]): string | null {
  const result = Bun.spawnSync(["git", ...args], { stderr: "ignore" });
  if (result.exitCode !== 0) return null;
  return new TextDecoder().decode(result.stdout).trim();
}

export function getGitStatus(repoPath: string): GitStatus | null {
  const branch = run(["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch) return null;

  let ahead = 0;
  let behind = 0;
  const aheadBehind = run([
    "-C",
    repoPath,
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...@{upstream}",
  ]);
  if (aheadBehind) {
    const parts = aheadBehind.split(/\s+/);
    ahead = parseInt(parts[0] ?? "0", 10) || 0;
    behind = parseInt(parts[1] ?? "0", 10) || 0;
  }

  let insertions = 0;
  let deletions = 0;
  const shortstat = run(["-C", repoPath, "diff", "--shortstat"]);
  if (shortstat) {
    const insMatch = shortstat.match(/(\d+) insertion/);
    const delMatch = shortstat.match(/(\d+) deletion/);
    insertions = insMatch ? parseInt(insMatch[1], 10) : 0;
    deletions = delMatch ? parseInt(delMatch[1], 10) : 0;
  }

  const stagedOutput = run([
    "-C",
    repoPath,
    "diff",
    "--cached",
    "--name-only",
  ]);
  const stagedCount =
    stagedOutput && stagedOutput.length > 0
      ? stagedOutput.split("\n").filter(Boolean).length
      : 0;

  return { branch, ahead, behind, insertions, deletions, stagedCount };
}
