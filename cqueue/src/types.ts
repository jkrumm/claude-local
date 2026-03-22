import type { RepoInfo } from "../server/lib/repo-scanner";
import type { QueueTask } from "../server/lib/parse-queue";
import type { GitStatus } from "../server/lib/git";
import type { CompletedTask } from "../server/lib/db";

export type { RepoInfo, QueueTask, GitStatus, CompletedTask };

export interface RepoDashboardData {
  repo: RepoInfo;
  queue: QueueTask[];
  notes: string;
  git: GitStatus | null;
}
