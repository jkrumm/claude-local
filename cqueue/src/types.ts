import type { RepoInfo } from "../server/lib/repo-scanner";
import type { QueueTask } from "../server/lib/parse-queue";
import type { GitStatus } from "../server/lib/git";

export type { RepoInfo, QueueTask, GitStatus };

export interface RepoDashboardData {
  repo: RepoInfo;
  queue: QueueTask[];
  notes: string;
  git: GitStatus | null;
}
