import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alignment,
  Button,
  Navbar,
  NavbarGroup,
  NavbarHeading,
  NonIdealState,
  Spinner,
} from "@blueprintjs/core";
import { api } from "../lib/api";
import { GitPanel } from "../components/GitPanel";
import { UsageTags } from "../components/UsageTags";
import { QueuePanel } from "../components/QueuePanel";
import { NotesPanel } from "../components/NotesPanel";
import { DiagramPanel } from "../components/DiagramPanel";
import { useTheme } from "../main";
import type {
  CompletedTask,
  GithubData,
  GitStatus,
  QueueTask,
  RepoDashboardData,
} from "../types";

class DashboardErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40 }}>
          <NonIdealState
            icon="error"
            title="Dashboard error"
            description={this.state.error.message}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

function RepoDashboardInner() {
  const { workspace, repo } = useParams<{ workspace: string; repo: string }>();
  const navigate = useNavigate();
  const { mode, toggle } = useTheme();

  const repoPath = workspace && repo ? `/${workspace}/${repo}` : null;

  const [data, setData] = useState<RepoDashboardData | null>(null);
  const [tasks, setTasks] = useState<QueueTask[]>([]);
  const [notes, setNotes] = useState<string>("");
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
  const [notesExternallyChanged, setNotesExternallyChanged] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sseDisconnected, setSseDisconnected] = useState(false);
  const [githubData, setGithubData] = useState<GithubData | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [lastGithubRefresh, setLastGithubRefresh] = useState<Date | null>(null);

  const evtSourceRef = useRef<EventSource | null>(null);
  const isEditingRef = useRef(false);

  const fetchData = async (path: string) => {
    const result = await api.api.repo
      .get({ query: { path } })
      .catch((err: unknown) => {
        setFetchError(String(err));
        return null;
      });
    if (!result) return;
    if (result.error) {
      setFetchError(String(result.error));
      return;
    }
    if (result.data?.ok) {
      const d = result.data.data as RepoDashboardData;
      setData(d);
      setTasks(d.queue);
      setNotes(d.notes);
    }
  };

  const fetchQueue = async (path: string) => {
    const result = await api.api.queue.get({ query: { path } }).catch(() => null);
    if (result?.data?.ok) {
      setTasks(result.data.data as QueueTask[]);
    }
  };

  const fetchCompleted = async (path: string) => {
    const result = await api.api["completed-tasks"]
      .get({ query: { path } })
      .catch(() => null);
    if (result?.data?.ok) {
      setCompletedTasks(result.data.data as CompletedTask[]);
    }
  };

  const fetchGitStatus = useCallback(async (path: string) => {
    const result = await api.api.repo.get({ query: { path } }).catch(() => null);
    if (result?.data?.ok) {
      const d = result.data.data as RepoDashboardData;
      setData((prev) => (prev ? { ...prev, git: d.git } : prev));
    }
  }, []);

  const fetchGithubData = useCallback(async (git: GitStatus) => {
    if (!git.githubRepo) return;
    setGithubLoading(true);
    try {
      const res = await fetch(
        `/api/github?githubRepo=${encodeURIComponent(git.githubRepo)}&branch=${encodeURIComponent(git.branch)}`,
      );
      const json = (await res.json()) as { ok: boolean; data: GithubData };
      if (json.ok) {
        setGithubData(json.data);
        setLastGithubRefresh(new Date());
      }
    } catch {
      // GitHub data is optional — silently ignore failures
    } finally {
      setGithubLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!repoPath) return;

    fetchData(repoPath);
    fetchCompleted(repoPath);

    let isActive = true;

    const connect = () => {
      const evtSource = new EventSource(
        `/api/events?path=${encodeURIComponent(repoPath)}`,
      );
      evtSourceRef.current = evtSource;

      evtSource.addEventListener("change", (e: MessageEvent) => {
        const payload = JSON.parse(e.data as string) as {
          file: "queue" | "notes";
        };
        if (payload.file === "queue" && !isEditingRef.current) {
          fetchQueue(repoPath);
          fetchCompleted(repoPath);
        } else if (payload.file === "notes") {
          setNotesExternallyChanged(true);
        }
      });

      evtSource.onerror = () => {
        if (!isActive) return;
        evtSource.close();
        evtSourceRef.current = null;
        const showTimer = setTimeout(() => {
          if (isActive) setSseDisconnected(true);
        }, 2000);
        setTimeout(() => {
          clearTimeout(showTimer);
          if (isActive) {
            setSseDisconnected(false);
            connect();
          }
        }, 5000);
      };
    };

    connect();

    // Polling fallback for SSE gaps
    const pollInterval = setInterval(() => {
      if (!isEditingRef.current) {
        fetchQueue(repoPath);
        fetchCompleted(repoPath);
      }
    }, 2000);

    return () => {
      isActive = false;
      clearInterval(pollInterval);
      evtSourceRef.current?.close();
      evtSourceRef.current = null;
    };
    // fetchData / fetchQueue use stable setters; repoPath is the only dep that matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath]);

  // Local git + GitHub polling every 15s
  useEffect(() => {
    if (!repoPath) return;
    const git = data?.git;

    if (git?.githubRepo) fetchGithubData(git);
    fetchGitStatus(repoPath);

    const interval = setInterval(() => {
      fetchGitStatus(repoPath);
      if (git?.githubRepo) fetchGithubData(git);
    }, 15000);
    return () => clearInterval(interval);
  }, [repoPath, data?.git?.githubRepo, data?.git?.branch, fetchGithubData, fetchGitStatus]);

  if (!repoPath) {
    return (
      <div style={{ padding: 40 }}>
        <NonIdealState icon="error" title="Invalid path" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div style={{ padding: 40 }}>
        <NonIdealState
          icon="error"
          title="Failed to load repo"
          description={fetchError}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <Navbar>
        <NavbarGroup align={Alignment.START}>
          <Button
            variant="minimal"
            icon="arrow-left"
            onClick={() => navigate("/")}
          />
          <NavbarHeading
            style={{ fontFamily: "var(--bp-typography-family-mono)" }}
          >
            {data.repo.name}
          </NavbarHeading>
        </NavbarGroup>
        <NavbarGroup align={Alignment.END}>
          {sseDisconnected && (
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--bp5-intent-danger)",
                marginRight: 8,
                flexShrink: 0,
              }}
              title="Disconnected"
            />
          )}
          <UsageTags />
          <Button
            variant="minimal"
            icon={
              mode === "light" ? "moon" : mode === "dark" ? "desktop" : "flash"
            }
            onClick={toggle}
          />
        </NavbarGroup>
      </Navbar>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          padding: 24,
        }}
      >
        <GitPanel
          repoPath={repoPath}
          gitStatus={data.git}
          githubData={githubData}
          githubLoading={githubLoading}
          lastGithubRefresh={lastGithubRefresh}
          onRefresh={() => {
            void fetchGitStatus(repoPath);
            if (data.git) void fetchGithubData(data.git);
          }}
        />
        <QueuePanel
          tasks={tasks}
          repoPath={repoPath}
          completedTasks={completedTasks}
          onTasksChange={(updated) => {
            setTasks(updated);
          }}
        />
        <DiagramPanel repoPath={repoPath} />
        <NotesPanel
          notes={notes}
          repoPath={repoPath}
          externallyChanged={notesExternallyChanged}
          onExternalChangeAck={() => setNotesExternallyChanged(false)}
        />
      </div>
    </div>
  );
}

export function RepoDashboard() {
  return (
    <DashboardErrorBoundary>
      <RepoDashboardInner />
    </DashboardErrorBoundary>
  );
}
