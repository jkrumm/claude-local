import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alignment,
  Button,
  Navbar,
  NavbarGroup,
  NavbarHeading,
  NonIdealState,
  Spinner,
  Tag,
} from "@blueprintjs/core";
import { api } from "../lib/api";
import { decodePath } from "../lib/path";
import { GitStatusBar } from "../components/GitStatusBar";
import { QueuePanel } from "../components/QueuePanel";
import { NotesPanel } from "../components/NotesPanel";
import { useTheme } from "../main";
import type { QueueTask, RepoDashboardData } from "../types";

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
  const { encodedPath } = useParams<{ encodedPath: string }>();
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();

  const repoPath = encodedPath ? decodePath(encodedPath) : null;

  const [data, setData] = useState<RepoDashboardData | null>(null);
  const [tasks, setTasks] = useState<QueueTask[]>([]);
  const [notes, setNotes] = useState<string>("");
  const [notesExternallyChanged, setNotesExternallyChanged] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sseDisconnected, setSseDisconnected] = useState(false);

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

  useEffect(() => {
    if (!repoPath) return;

    fetchData(repoPath);

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
        } else if (payload.file === "notes") {
          setNotesExternallyChanged(true);
        }
      });

      evtSource.onerror = () => {
        if (!isActive) return;
        setSseDisconnected(true);
        evtSource.close();
        evtSourceRef.current = null;
        setTimeout(() => {
          if (isActive) {
            setSseDisconnected(false);
            connect();
          }
        }, 5000);
      };
    };

    connect();

    return () => {
      isActive = false;
      evtSourceRef.current?.close();
      evtSourceRef.current = null;
    };
    // fetchData / fetchQueue use stable setters; repoPath is the only dep that matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath]);

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
          <NavbarHeading style={{ fontFamily: "var(--font-mono)" }}>
            {data.repo.name}
          </NavbarHeading>
        </NavbarGroup>
        <NavbarGroup align={Alignment.END}>
          {sseDisconnected && (
            <Tag intent="danger" minimal style={{ marginRight: 8 }}>
              Disconnected
            </Tag>
          )}
          <GitStatusBar git={data.git} repoName={data.repo.name} />
          <Button
            variant="minimal"
            icon={isDark ? "flash" : "moon"}
            onClick={toggle}
          />
        </NavbarGroup>
      </Navbar>

      <div style={{ padding: 24 }}>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            opacity: 0.5,
            fontSize: 12,
            marginBottom: 24,
          }}
        >
          {repoPath}
        </p>

        <div style={{ marginBottom: 32 }}>
          <QueuePanel
            tasks={tasks}
            repoPath={repoPath}
            onTasksChange={(updated) => {
              setTasks(updated);
            }}
          />
        </div>

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
