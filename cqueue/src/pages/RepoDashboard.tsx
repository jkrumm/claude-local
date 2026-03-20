import { useEffect, useRef, useState } from "react";
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
import { decodePath } from "../lib/path";
import { GitStatusBar } from "../components/GitStatusBar";
import { QueuePanel } from "../components/QueuePanel";
import { useTheme } from "../main";
import type { QueueTask, RepoDashboardData } from "../types";

export function RepoDashboard() {
  const { encodedPath } = useParams<{ encodedPath: string }>();
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();

  const [data, setData] = useState<RepoDashboardData | null>(null);
  const [tasks, setTasks] = useState<QueueTask[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const evtSourceRef = useRef<EventSource | null>(null);
  const isEditingRef = useRef(false);

  const repoPath = encodedPath ? decodePath(encodedPath) : null;

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
    }
  };

  useEffect(() => {
    if (!repoPath) return;

    fetchData(repoPath);

    const evtSource = new EventSource(
      `/api/events?path=${encodeURIComponent(repoPath)}`,
    );
    evtSourceRef.current = evtSource;
    evtSource.addEventListener("change", () => {
      if (!isEditingRef.current) {
        fetchData(repoPath);
      }
    });

    return () => {
      evtSource.close();
      evtSourceRef.current = null;
    };
    // fetchData is stable — repoPath is the only dep that matters
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

        <div>
          <h3>Notes</h3>
        </div>
      </div>
    </div>
  );
}
