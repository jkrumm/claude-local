import { Intent, Tag } from "@blueprintjs/core";
import type { GitStatus } from "../types";

interface Props {
  git: GitStatus | null;
  repoName: string;
}

export function GitStatusBar({ git }: Props) {
  if (!git) return null;

  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center", marginRight: 8 }}>
      <Tag minimal style={{ fontFamily: "var(--bp-typography-family-mono)" }}>
        {git.branch}
      </Tag>
      {git.ahead > 0 && (
        <Tag intent={Intent.PRIMARY} minimal>
          ↑{git.ahead}
        </Tag>
      )}
      {git.behind > 0 && (
        <Tag intent={Intent.WARNING} minimal>
          ↓{git.behind}
        </Tag>
      )}
      {git.insertions > 0 && (
        <Tag intent={Intent.SUCCESS} minimal>
          +{git.insertions}
        </Tag>
      )}
      {git.deletions > 0 && (
        <Tag intent={Intent.DANGER} minimal>
          −{git.deletions}
        </Tag>
      )}
      {git.stagedCount > 0 && (
        <Tag intent={Intent.WARNING} minimal>
          {git.stagedCount} staged
        </Tag>
      )}
    </span>
  );
}
