import { basename } from "path";

interface Workspace {
  name: string;          // "SourceRoot" — derived from env var basename
  containerPath: string; // "/repos/personal" — internal Docker mount
}

function buildWorkspaces(): Workspace[] {
  const entries: Array<{ envVar: string; containerPath: string }> = [
    { envVar: process.env.PERSONAL_REPOS_PATH ?? "", containerPath: "/repos/personal" },
    { envVar: process.env.WORK_REPOS_PATH ?? "", containerPath: "/repos/work" },
  ];

  return entries
    .filter((e) => e.envVar)
    .map((e) => ({ name: basename(e.envVar), containerPath: e.containerPath }));
}

export const WORKSPACES: Workspace[] = buildWorkspaces();

/** "/repos/personal/vps" → "/SourceRoot/vps" */
export function toDisplayPath(containerPath: string): string {
  for (const ws of WORKSPACES) {
    if (containerPath.startsWith(ws.containerPath + "/")) {
      return containerPath.replace(ws.containerPath, "/" + ws.name);
    }
  }
  return containerPath;
}

/** "/SourceRoot/vps" → "/repos/personal/vps" */
export function toContainerPath(displayPath: string): string {
  for (const ws of WORKSPACES) {
    if (displayPath.startsWith("/" + ws.name + "/")) {
      return displayPath.replace("/" + ws.name, ws.containerPath);
    }
  }
  return displayPath;
}

/** Container roots to scan — e.g. ["/repos/personal", "/repos/work"] */
export const WORKSPACE_ROOTS = WORKSPACES.map((ws) => ws.containerPath);
