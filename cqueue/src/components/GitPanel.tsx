import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  AnchorButton,
  Button,
  Divider,
  HTMLTable,
  Icon,
  Intent,
  Popover,
  Tag,
  Tooltip,
} from "@blueprintjs/core";
import type { GitFile, GitStatus, GithubData, WorkflowRun } from "../types";

interface Props {
  gitStatus: GitStatus | null;
  githubData: GithubData | null;
  githubLoading: boolean;
  lastGithubRefresh: Date | null;
  onRefresh: () => void;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function fileStatusIntent(
  status: GitFile["status"],
): "warning" | "success" | "danger" | "primary" | undefined {
  if (status === "M") return "warning";
  if (status === "A") return "success";
  if (status === "D") return "danger";
  if (status === "R") return "primary";
  return undefined;
}

function runStatusIcon(run: WorkflowRun): React.ReactElement {
  if (run.status !== "completed") {
    return <Icon icon="time" size={13} />;
  }
  if (run.conclusion === "success") {
    return <Icon icon="tick-circle" size={13} intent={Intent.SUCCESS} />;
  }
  return <Icon icon="error" size={13} intent={Intent.DANGER} />;
}

// ─── File tree ───────────────────────────────────────────────────────────────

type FileTreeNode =
  | { type: "dir"; name: string; path: string; children: FileTreeNode[] }
  | { type: "file"; name: string; path: string; file: GitFile };

function buildFileTree(files: GitFile[]): FileTreeNode[] {
  const dirMap = new Map<string, Extract<FileTreeNode, { type: "dir" }>>();
  const roots: FileTreeNode[] = [];

  function ensureDir(
    dirPath: string,
  ): Extract<FileTreeNode, { type: "dir" }> {
    if (dirMap.has(dirPath)) return dirMap.get(dirPath)!;
    const parts = dirPath.split("/");
    const name = parts[parts.length - 1]!;
    const parentPath = parts.slice(0, -1).join("/");
    const node: Extract<FileTreeNode, { type: "dir" }> = {
      type: "dir",
      name,
      path: dirPath,
      children: [],
    };
    dirMap.set(dirPath, node);
    if (parentPath) {
      ensureDir(parentPath).children.push(node);
    } else {
      roots.push(node);
    }
    return node;
  }

  for (const file of files) {
    const parts = file.path.split("/");
    const filename = parts[parts.length - 1]!;
    const dirPath = parts.slice(0, -1).join("/");
    const leaf: FileTreeNode = {
      type: "file",
      name: filename,
      path: file.path,
      file,
    };
    if (dirPath) {
      ensureDir(dirPath).children.push(leaf);
    } else {
      roots.push(leaf);
    }
  }

  function sortNodes(nodes: FileTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.type === "dir") sortNodes(node.children);
    }
  }
  sortNodes(roots);

  return roots;
}

function renderNodes(nodes: FileTreeNode[], depth: number): React.ReactElement[] {
  return nodes.flatMap((node) => {
    const indent = 10 + depth * 14;
    if (node.type === "dir") {
      return [
        <div
          key={`dir-${node.path}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            paddingTop: 5,
            paddingBottom: 2,
            paddingLeft: indent,
            paddingRight: 12,
            opacity: 0.55,
            fontSize: 11,
            fontFamily: "var(--bp-typography-family-mono)",
          }}
        >
          <Icon icon="folder-close" size={11} />
          <span>{node.name}</span>
        </div>,
        ...renderNodes(node.children, depth + 1),
      ];
    }
    const intent = fileStatusIntent(node.file.status);
    return [
      <div
        key={`file-${node.path}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingTop: 2,
          paddingBottom: 2,
          paddingLeft: indent,
          paddingRight: 12,
        }}
      >
        <Tag
          minimal
          intent={intent}
          style={{ fontSize: 10, padding: "0 5px", minWidth: 16, textAlign: "center" }}
        >
          {node.file.status}
        </Tag>
        <span
          style={{
            fontFamily: "var(--bp-typography-family-mono)",
            fontSize: 12,
          }}
        >
          {node.name}
        </span>
        {node.file.staged && (
          <Tag minimal style={{ fontSize: 9, opacity: 0.55 }}>
            staged
          </Tag>
        )}
      </div>,
    ];
  });
}

function FileTreeContent({ files }: { files: GitFile[] }) {
  const tree = buildFileTree(files);
  return (
    <div style={{ minWidth: 280, maxHeight: 420, overflow: "auto", padding: "6px 0" }}>
      {renderNodes(tree, 0)}
    </div>
  );
}

// ─── Status dot ──────────────────────────────────────────────────────────────

function StatusDot({
  lastRefresh,
  githubLoading,
  onRefresh,
}: {
  lastRefresh: Date | null;
  githubLoading: boolean;
  onRefresh: () => void;
}) {
  const [bright, setBright] = useState(false);
  const [, setTick] = useState(0);
  const prevLoadingRef = useRef(githubLoading);

  useEffect(() => {
    if (prevLoadingRef.current && !githubLoading && lastRefresh) {
      setBright(true);
      const t = setTimeout(() => setBright(false), 1800);
      return () => clearTimeout(t);
    }
    prevLoadingRef.current = githubLoading;
  }, [githubLoading, lastRefresh]);

  // Re-render every second so the tooltip timestamp stays current
  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const tooltipText = lastRefresh
    ? `GitHub: updated ${timeAgo(lastRefresh.toISOString())} · click to refresh`
    : "GitHub: click to refresh";

  return (
    <Tooltip content={tooltipText} placement="bottom-end">
      <div
        onClick={onRefresh}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: lastRefresh
            ? "var(--bp5-intent-success, #23a26d)"
            : "var(--bp5-text-color-muted, #738091)",
          opacity: bright ? 1 : 0.55,
          transition: bright ? "none" : "opacity 1.5s ease-out",
          cursor: "pointer",
          flexShrink: 0,
          marginLeft: 4,
        }}
      />
    </Tooltip>
  );
}

// ─── Status row ─────────────────────────────────────────────────────────────

function StatusRow({
  gitStatus,
  githubData,
  githubLoading,
  lastGithubRefresh,
  onRefresh,
}: {
  gitStatus: GitStatus;
  githubData: GithubData | null;
  githubLoading: boolean;
  lastGithubRefresh: Date | null;
  onRefresh: () => void;
}) {
  const { branch, ahead, behind, changedFiles, lastTag, distanceFromTag } =
    gitStatus;
  const pr = githubData?.currentPR ?? null;

  const modified = changedFiles.filter((f) => f.status === "M").length;
  const added = changedFiles.filter((f) => f.status === "A").length;
  const deleted = changedFiles.filter((f) => f.status === "D").length;
  const untracked = changedFiles.filter((f) => f.status === "?").length;
  const hasDirtyFiles = changedFiles.length > 0;

  let ciIntent: Intent = Intent.NONE;
  let ciLabel = "";
  if (pr) {
    const { checks } = pr;
    if (checks.total === 0) {
      ciIntent = Intent.NONE;
      ciLabel = "No CI";
    } else if (checks.failing > 0) {
      ciIntent = Intent.DANGER;
      ciLabel = `${checks.failing} failing`;
    } else if (checks.pending > 0) {
      ciIntent = Intent.WARNING;
      ciLabel = `${checks.passing}/${checks.total}`;
    } else {
      ciIntent = Intent.SUCCESS;
      ciLabel = `${checks.passing}/${checks.total} ✓`;
    }
  }

  const reviewIntent =
    pr?.reviewDecision === "APPROVED"
      ? Intent.SUCCESS
      : pr?.reviewDecision === "CHANGES_REQUESTED"
        ? Intent.DANGER
        : Intent.NONE;

  const reviewLabel =
    pr?.reviewDecision === "APPROVED"
      ? "Approved"
      : pr?.reviewDecision === "CHANGES_REQUESTED"
        ? "Changes requested"
        : pr?.reviewDecision === "REVIEW_REQUIRED"
          ? "Review needed"
          : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
        marginBottom: 12,
      }}
    >
      {/* Branch + push/pull */}
      <Tag
        minimal
        icon="git-branch"
        style={{ fontFamily: "var(--bp-typography-family-mono)" }}
      >
        {branch}
      </Tag>
      {ahead > 0 && (
        <Tag intent={Intent.PRIMARY} minimal>
          ↑{ahead}
        </Tag>
      )}
      {behind > 0 && (
        <Tag intent={Intent.WARNING} minimal>
          ↓{behind}
        </Tag>
      )}

      {/* PR info */}
      {pr && (
        <>
          <Divider style={{ height: 16, margin: "0 2px" }} />
          <Tag minimal icon="git-pull-request">
            #{pr.number} · {truncate(pr.title, 40)}
          </Tag>
          {pr.checks.total > 0 && (
            <Tag
              intent={ciIntent}
              minimal
              icon={
                ciIntent === Intent.SUCCESS
                  ? "tick-circle"
                  : ciIntent === Intent.DANGER
                    ? "error"
                    : "time"
              }
            >
              {ciLabel}
            </Tag>
          )}
          {reviewLabel && (
            <Tag
              intent={reviewIntent}
              minimal
              icon={reviewIntent === Intent.SUCCESS ? "endorsed" : "comment"}
            >
              {reviewLabel}
            </Tag>
          )}
          <AnchorButton
            variant="minimal"
            icon="share"
            small
            href={pr.url}
            target="_blank"
            style={{ padding: "0 4px" }}
          />
        </>
      )}

      {/* Tag/release info */}
      {lastTag && (
        <>
          <Divider style={{ height: 16, margin: "0 2px" }} />
          <Tag minimal icon="tag">
            {lastTag}
            {distanceFromTag > 0 ? ` +${distanceFromTag}` : ""}
          </Tag>
        </>
      )}

      {/* Changed files — spacious labels */}
      {hasDirtyFiles && (
        <>
          <Divider style={{ height: 16, margin: "0 2px" }} />
          <Popover
            content={<FileTreeContent files={changedFiles} />}
            interactionKind="click"
            placement="bottom-start"
          >
            <Button variant="minimal" style={{ padding: "2px 6px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {modified > 0 && (
                  <Tag intent={Intent.WARNING} minimal>
                    Modified {modified}
                  </Tag>
                )}
                {added > 0 && (
                  <Tag intent={Intent.SUCCESS} minimal>
                    Added {added}
                  </Tag>
                )}
                {deleted > 0 && (
                  <Tag intent={Intent.DANGER} minimal>
                    Deleted {deleted}
                  </Tag>
                )}
                {untracked > 0 && (
                  <Tag minimal>
                    Untracked {untracked}
                  </Tag>
                )}
              </div>
            </Button>
          </Popover>
        </>
      )}

      {/* Status dot (GitHub refresh indicator) */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
        {gitStatus.githubRepo && (
          <StatusDot
            lastRefresh={lastGithubRefresh}
            githubLoading={githubLoading}
            onRefresh={onRefresh}
          />
        )}
      </div>
    </div>
  );
}

// ─── Commits section ────────────────────────────────────────────────────────

function CommitsSection({ gitStatus }: { gitStatus: GitStatus }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { branchCommits, mainBranch, branch } = gitStatus;

  function toggleExpand(sha: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sha)) next.delete(sha);
      else next.add(sha);
      return next;
    });
  }

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    opacity: 0.5,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 6,
  };

  if (branchCommits.length === 0) {
    return (
      <div>
        <div style={sectionHeaderStyle}>Commits</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            opacity: 0.4,
            paddingTop: 2,
            fontSize: 12,
          }}
        >
          <Icon icon="tick-circle" size={12} />
          <span>
            Up to date
            {branch !== mainBranch ? ` with ${mainBranch}` : ""}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={sectionHeaderStyle}>
        {branchCommits.length} commit{branchCommits.length !== 1 ? "s" : ""}{" "}
        ahead of {mainBranch}
      </div>
      <HTMLTable
        className="bp5-html-table bp5-html-table-condensed"
        style={{ width: "100%", tableLayout: "fixed" }}
      >
        <tbody>
          {branchCommits.map((commit) => {
            const isExpanded = expanded.has(commit.sha);
            const hasBody = commit.body.length > 0;
            return (
              <>
                <tr
                  key={commit.sha}
                  onClick={() => hasBody && toggleExpand(commit.sha)}
                  style={{ cursor: hasBody ? "pointer" : "default" }}
                >
                  <td style={{ width: 60, paddingRight: 8 }}>
                    <code
                      style={{
                        fontFamily: "var(--bp-typography-family-mono)",
                        fontSize: 11,
                        opacity: 0.6,
                      }}
                    >
                      {commit.sha}
                    </code>
                  </td>
                  <td style={{ overflow: "hidden" }}>
                    <span style={{ fontSize: 13 }}>
                      {truncate(commit.subject, 70)}
                    </span>
                  </td>
                  <td
                    style={{
                      width: 70,
                      textAlign: "right",
                      opacity: 0.45,
                      fontSize: 11,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {commit.relativeTime}
                  </td>
                  <td style={{ width: 20, paddingLeft: 0 }}>
                    {hasBody && (
                      <Icon
                        icon={isExpanded ? "chevron-up" : "chevron-down"}
                        size={12}
                      />
                    )}
                  </td>
                </tr>
                {hasBody && isExpanded && (
                  <tr key={`${commit.sha}-body`}>
                    <td colSpan={4} style={{ paddingTop: 0, paddingBottom: 8 }}>
                      <pre
                        style={{
                          fontFamily: "var(--bp-typography-family-mono)",
                          fontSize: 11,
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          opacity: 0.75,
                        }}
                      >
                        {commit.body}
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </HTMLTable>
    </div>
  );
}

// ─── Runs + Release section ──────────────────────────────────────────────────

function RunsSection({
  githubData,
  gitStatus,
  githubRepo,
}: {
  githubData: GithubData;
  gitStatus: GitStatus;
  githubRepo: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [triggering, setTriggering] = useState(false);

  async function handleTriggerRelease() {
    setTriggering(true);
    try {
      await fetch(
        `/api/github/trigger-release?githubRepo=${encodeURIComponent(githubRepo)}&ref=${encodeURIComponent(gitStatus.mainBranch)}`,
        { method: "POST" },
      );
    } finally {
      setTriggering(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          opacity: 0.5,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 6,
        }}
      >
        Workflow Runs
      </div>

      {githubData.workflowRuns.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.4, paddingTop: 2, fontSize: 12 }}>
          <Icon icon="time" size={12} />
          <span>No recent runs</span>
        </div>
      ) : (
        <HTMLTable
          className="bp5-html-table bp5-html-table-condensed"
          style={{ width: "100%", tableLayout: "fixed" }}
        >
          <tbody>
            {githubData.workflowRuns.map((run) => (
              <tr key={run.id}>
                <td style={{ width: 20, paddingRight: 4 }}>
                  {runStatusIcon(run)}
                </td>
                <td style={{ overflow: "hidden" }}>
                  <span style={{ fontSize: 12 }}>{truncate(run.name, 30)}</span>
                </td>
                <td
                  style={{
                    width: 60,
                    textAlign: "right",
                    opacity: 0.45,
                    fontSize: 11,
                    whiteSpace: "nowrap",
                  }}
                >
                  {timeAgo(run.createdAt)}
                </td>
                <td style={{ width: 28, paddingLeft: 0 }}>
                  <AnchorButton
                    variant="minimal"
                    icon="share"
                    small
                    href={run.url}
                    target="_blank"
                    style={{ padding: "0 2px" }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      )}

      {githubData.hasReleaseWorkflow && (
        <div style={{ marginTop: 16 }}>
          <Divider style={{ marginBottom: 12 }} />
          {githubData.latestRelease && (
            <div style={{ fontSize: 12, opacity: 0.55, marginBottom: 8 }}>
              Latest:{" "}
              <AnchorButton
                variant="minimal"
                small
                href={githubData.latestRelease.url}
                target="_blank"
                style={{
                  padding: 0,
                  fontFamily: "var(--bp-typography-family-mono)",
                  fontSize: 12,
                }}
              >
                {githubData.latestRelease.tagName}
              </AnchorButton>
              {" · "}
              {timeAgo(githubData.latestRelease.publishedAt)}
            </div>
          )}
          <Button
            intent={Intent.PRIMARY}
            icon="send-to"
            small
            loading={triggering}
            onClick={() => setConfirmOpen(true)}
          >
            Trigger Release
          </Button>
          <Alert
            isOpen={confirmOpen}
            intent={Intent.PRIMARY}
            confirmButtonText="Trigger"
            cancelButtonText="Cancel"
            loading={triggering}
            onConfirm={() => void handleTriggerRelease()}
            onCancel={() => setConfirmOpen(false)}
          >
            <p>
              Trigger{" "}
              <code style={{ fontFamily: "var(--bp-typography-family-mono)" }}>
                release.yml
              </code>{" "}
              on{" "}
              <code style={{ fontFamily: "var(--bp-typography-family-mono)" }}>
                {gitStatus.mainBranch}
              </code>
              ?
            </p>
          </Alert>
        </div>
      )}
    </div>
  );
}

// ─── Main GitPanel ───────────────────────────────────────────────────────────

export function GitPanel({
  gitStatus,
  githubData,
  githubLoading,
  lastGithubRefresh,
  onRefresh,
}: Props) {
  if (!gitStatus) return null;

  // Show right column only when GitHub data has loaded
  const showGithubColumn = !!gitStatus.githubRepo && githubData !== null;

  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: 4,
        border: "1px solid var(--bp5-card-border-color, rgba(17,20,24,.15))",
      }}
    >
      <StatusRow
        gitStatus={gitStatus}
        githubData={githubData}
        githubLoading={githubLoading}
        lastGithubRefresh={lastGithubRefresh}
        onRefresh={onRefresh}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: showGithubColumn ? "65fr 35fr" : "1fr",
          gap: 24,
        }}
      >
        <CommitsSection gitStatus={gitStatus} />
        {showGithubColumn && (
          <RunsSection
            githubData={githubData!}
            gitStatus={gitStatus}
            githubRepo={gitStatus.githubRepo!}
          />
        )}
      </div>
    </div>
  );
}
