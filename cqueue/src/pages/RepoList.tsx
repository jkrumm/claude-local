import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Intent, NonIdealState, Spinner, Tag } from "@blueprintjs/core";
import { api } from "../lib/api";
import { encodePath } from "../lib/path";
import type { RepoInfo } from "../types";

function workspaceLabel(path: string): string {
  if (path.startsWith("/repos/SourceRoot")) return "SourceRoot";
  if (path.startsWith("/repos/IuRoot")) return "IuRoot";
  return "unknown";
}

export function RepoList() {
  const [repos, setRepos] = useState<RepoInfo[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.api.repos
      .get()
      .then(({ data, error }) => {
        if (error) {
          setFetchError(String(error));
          return;
        }
        if (data && data.ok) {
          setRepos(data.data);
        }
      })
      .catch((err: unknown) => setFetchError(String(err)));
  }, []);

  if (fetchError) {
    return (
      <div style={{ padding: 40 }}>
        <NonIdealState
          icon="error"
          title="Failed to load repos"
          description={fetchError}
        />
      </div>
    );
  }

  if (!repos) {
    return (
      <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div style={{ padding: 40 }}>
        <NonIdealState
          icon="folder-open"
          title="No repos found"
          description="Add cqueue.md or cnotes.md to a repo to see it here."
        />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-mono)", marginBottom: 24 }}>
        cqueue
      </h1>
      {repos.map((repo) => (
        <Card
          key={repo.path}
          interactive
          style={{
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
          onClick={() => navigate(`/${encodePath(repo.path)}`)}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              flex: 1,
            }}
          >
            {repo.name}
          </span>
          <Tag minimal>{workspaceLabel(repo.path)}</Tag>
          {repo.hasQueue && (
            <Tag intent={Intent.PRIMARY} minimal>
              queue
            </Tag>
          )}
          {repo.hasNotes && <Tag minimal>notes</Tag>}
        </Card>
      ))}
    </div>
  );
}
