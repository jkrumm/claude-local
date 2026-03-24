import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogFooter,
  Icon,
  InputGroup,
  OverlayToaster,
  Popover,
  Spinner,
  Tooltip,
} from "@blueprintjs/core";
import { api } from "../lib/api";
import { useTheme } from "../main";
import { DiagramEditor } from "./DiagramEditor";
import type { SaveStatus } from "./DiagramEditor";

interface DiagramMeta {
  name: string;
  hasSvg: boolean;
  modifiedAt: number;
}

interface Props {
  repoPath: string;
}

const EMPTY_EXCALIDRAW = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "cqueue",
  elements: [],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

// Module-level toaster singleton — created once on first use
let _toaster: OverlayToaster | null = null;
function showToast(message: string) {
  const show = (t: OverlayToaster) =>
    t.show({ message, intent: "success", icon: "tick-circle", timeout: 2500 });

  if (_toaster) {
    show(_toaster);
  } else {
    void OverlayToaster.createAsync({ position: "top-right" }).then((t) => {
      _toaster = t;
      show(t);
    });
  }
}

type DocWithWebkit = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void>;
};
type ElWithWebkit = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

const fsElement = () =>
  document.fullscreenElement ?? (document as DocWithWebkit).webkitFullscreenElement;

const fsEnter = (el: HTMLElement) => {
  if (el.requestFullscreen) return el.requestFullscreen();
  if ((el as ElWithWebkit).webkitRequestFullscreen) return (el as ElWithWebkit).webkitRequestFullscreen!();
  return Promise.reject(new Error("Fullscreen not supported"));
};

const fsExit = () => {
  if (document.exitFullscreen) return document.exitFullscreen();
  if ((document as DocWithWebkit).webkitExitFullscreen) return (document as DocWithWebkit).webkitExitFullscreen!();
  return Promise.resolve();
};

export function DiagramPanel({ repoPath }: Props) {
  const { isDark } = useTheme();
  const panelRef = useRef<HTMLDivElement>(null);
  const hasRestoredRef = useRef(false);
  const storagePrefix = `cqueue:${repoPath}`;

  // Panel state
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(`${storagePrefix}:diagramsCollapsed`) === "true",
  );
  const [diagrams, setDiagrams] = useState<DiagramMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeDiagram, setActiveDiagram] = useState<string | null>(null);
  const [openDiagrams, setOpenDiagrams] = useState<string[]>([]);
  const [diagramContents, setDiagramContents] = useState<Record<string, string>>({});
  const [diagBrowserOpen, setDiagBrowserOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [svgVersions, setSvgVersions] = useState<Record<string, number>>({});

  // Fullscreen state
  const [appFullscreen, setAppFullscreen] = useState(false);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);

  // New diagram dialog state
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNameError, setNewNameError] = useState("");

  // Sub-header inline rename/delete state
  const [subRenameOpen, setSubRenameOpen] = useState(false);
  const [subRenameValue, setSubRenameValue] = useState("");
  const [subDeleteOpen, setSubDeleteOpen] = useState(false);

  const isFullscreen = appFullscreen || browserFullscreen;

  // ── Fetch diagrams ──────────────────────────────────────────────────────────

  const fetchDiagrams = useCallback(async () => {
    setLoading(true);
    const res = await api.api.diagrams
      .get({ query: { path: repoPath } })
      .catch(() => null);
    setLoading(false);
    if (res?.data?.ok) setDiagrams(res.data.data as DiagramMeta[]);
  }, [repoPath]);

  useEffect(() => {
    fetchDiagrams();
  }, [fetchDiagrams]);

  // Persist open tabs + active diagram (only write, never delete — avoids clearing on mount before restore)
  useEffect(() => {
    if (openDiagrams.length > 0) {
      localStorage.setItem(`${storagePrefix}:openDiagrams`, JSON.stringify(openDiagrams));
    }
  }, [openDiagrams, storagePrefix]);

  useEffect(() => {
    if (activeDiagram !== null) {
      localStorage.setItem(`${storagePrefix}:activeDiagram`, activeDiagram);
    }
  }, [activeDiagram, storagePrefix]);

  // ── Open diagram ────────────────────────────────────────────────────────────

  const openDiagram = useCallback(
    async (name: string) => {
      // Already active — nothing to do
      if (name === activeDiagram) return;
      // Already open in another tab — just switch
      if (openDiagrams.includes(name)) {
        setActiveDiagram(name);
        setDiagBrowserOpen(false);
        return;
      }
      // New tab: fetch content, then activate
      const res = await api.api.diagrams.file
        .get({ query: { path: repoPath, name } })
        .catch(() => null);
      if (res?.data?.ok) {
        setDiagramContents((prev) => ({ ...prev, [name]: res.data.data as string }));
        setOpenDiagrams((prev) => [...prev, name]);
        setActiveDiagram(name);
        setSaveStatus("idle");
        setDiagBrowserOpen(false);
      }
    },
    [activeDiagram, openDiagrams, repoPath],
  );

  const closeTab = (name: string) => {
    const newOpen = openDiagrams.filter((n) => n !== name);
    setOpenDiagrams(newOpen);
    setDiagramContents((prev) => { const { [name]: _, ...rest } = prev; return rest; });
    if (activeDiagram === name) {
      const idx = openDiagrams.indexOf(name);
      setActiveDiagram(newOpen[idx] ?? newOpen[idx - 1] ?? null);
    }
  };

  // Restore open tabs + active diagram after initial load (must be after openDiagram)
  useEffect(() => {
    if (hasRestoredRef.current || diagrams.length === 0) return;
    hasRestoredRef.current = true;

    const savedActive = localStorage.getItem(`${storagePrefix}:activeDiagram`);
    const savedOpenRaw = localStorage.getItem(`${storagePrefix}:openDiagrams`);
    const savedOpen: string[] = savedOpenRaw ? (JSON.parse(savedOpenRaw) as string[]) : [];

    const validOpen = savedOpen.filter((n) => diagrams.some((d) => d.name === n));
    const validActive = savedActive && diagrams.some((d) => d.name === savedActive) ? savedActive : null;

    // Ensure active tab is included in the open list
    const toOpen = validActive && !validOpen.includes(validActive)
      ? [...validOpen, validActive]
      : validOpen;

    if (toOpen.length === 0) return;

    void Promise.all(
      toOpen.map((name) =>
        api.api.diagrams.file
          .get({ query: { path: repoPath, name } })
          .then((res) => (res?.data?.ok ? { name, content: res.data.data as string } : null))
          .catch(() => null),
      ),
    ).then((results) => {
      const loaded = results.filter((r): r is { name: string; content: string } => r !== null);
      if (loaded.length === 0) return;
      const contents: Record<string, string> = {};
      const openNames: string[] = [];
      for (const { name, content } of loaded) {
        contents[name] = content;
        openNames.push(name);
      }
      setDiagramContents(contents);
      setOpenDiagrams(openNames);
      setActiveDiagram(validActive && openNames.includes(validActive) ? validActive : openNames[0]);
      setSaveStatus("idle");
    });
  }, [diagrams, storagePrefix, repoPath]);

  // ── Save handler (called by DiagramEditor) ──────────────────────────────────

  const handleSave = useCallback(
    async (name: string, excalidraw: string, svg: string) => {
      setDiagramContents((prev) => ({ ...prev, [name]: excalidraw }));
      await api.api.diagrams.file.put(
        { excalidraw, svg },
        { query: { path: repoPath, name } },
      );
      setSvgVersions((prev) => ({ ...prev, [name]: Date.now() }));
      setDiagrams((prev) =>
        prev.map((d) => (d.name === name ? { ...d, hasSvg: true } : d)),
      );
    },
    [repoPath],
  );

  // ── New diagram ─────────────────────────────────────────────────────────────

  const validateName = (name: string, existingNames: string[]): string => {
    const trimmed = name.trim();
    if (!trimmed) return "Name is required";
    if (!/^[a-zA-Z0-9 \-_]+$/.test(trimmed))
      return "Only letters, numbers, spaces, hyphens and underscores allowed";
    if (existingNames.includes(trimmed))
      return "A diagram with this name already exists";
    return "";
  };

  const handleCreateDiagram = async () => {
    const name = newName.trim();
    const error = validateName(
      name,
      diagrams.map((d) => d.name),
    );
    if (error) {
      setNewNameError(error);
      return;
    }

    await api.api.diagrams.file.put(
      { excalidraw: EMPTY_EXCALIDRAW, svg: "" },
      { query: { path: repoPath, name } },
    );

    const newMeta: DiagramMeta = { name, hasSvg: false, modifiedAt: Date.now() };
    setDiagrams((prev) => [newMeta, ...prev]);
    setNewDialogOpen(false);
    setNewName("");
    setNewNameError("");
    await openDiagram(name);
  };

  // ── Rename ──────────────────────────────────────────────────────────────────

  const handleRename = useCallback(
    async (name: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === name) return;
      await api.api.diagrams.rename.post(
        { name, newName: trimmed },
        { query: { path: repoPath } },
      );
      setDiagrams((prev) => prev.map((d) => (d.name === name ? { ...d, name: trimmed } : d)));
      setOpenDiagrams((prev) => prev.map((n) => (n === name ? trimmed : n)));
      setDiagramContents((prev) => {
        const { [name]: content, ...rest } = prev;
        return content !== undefined ? { ...rest, [trimmed]: content } : rest;
      });
      if (activeDiagram === name) setActiveDiagram(trimmed);
    },
    [repoPath, activeDiagram],
  );

  // ── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(
    async (name: string) => {
      await api.api.diagrams.file.delete({ query: { path: repoPath, name } });
      setDiagrams((prev) => prev.filter((d) => d.name !== name));
      setDiagramContents((prev) => { const { [name]: _, ...rest } = prev; return rest; });
      setOpenDiagrams((prev) => {
        const newOpen = prev.filter((n) => n !== name);
        if (activeDiagram === name) {
          const idx = prev.indexOf(name);
          setActiveDiagram(newOpen[idx] ?? newOpen[idx - 1] ?? null);
        }
        return newOpen;
      });
    },
    [repoPath, activeDiagram],
  );

  // ── Copy SVG path ───────────────────────────────────────────────────────────

  const handleCopySvgPath = (name: string) => {
    const path = `docs/diagrams/${name}.svg`;
    const copyFallback = () => {
      const ta = document.createElement("textarea");
      ta.value = path;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        const ok = document.execCommand("copy");
        showToast(ok ? `Copied: ${path}` : "Copy failed");
      } catch {
        showToast("Copy failed");
      }
      document.body.removeChild(ta);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(path)
        .then(() => showToast(`Copied: ${path}`))
        .catch(copyFallback);
    } else {
      copyFallback();
    }
  };

  // ── Collapse ────────────────────────────────────────────────────────────────

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(`${storagePrefix}:diagramsCollapsed`, String(next));
      return next;
    });
  };

  // ── App fullscreen (focus mode) ─────────────────────────────────────────────

  const toggleAppFullscreen = () => {
    if (fsElement()) void fsExit();
    setAppFullscreen((prev) => !prev);
  };

  // ── Browser fullscreen ──────────────────────────────────────────────────────

  const toggleBrowserFullscreen = useCallback(() => {
    if (fsElement()) {
      void fsExit();
      return;
    }
    void fsEnter(document.documentElement).catch(() => {
      // WKWebView / embedded Safari don't expose the Fullscreen API — fall back to CSS focus mode
      setAppFullscreen(true);
    });
  }, []);

  useEffect(() => {
    const handler = () => {
      const isFs = !!fsElement();
      setBrowserFullscreen(isFs);
      if (!isFs) setAppFullscreen(false);
    };
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler);
    };
  }, []);

  // ── Status dot ──────────────────────────────────────────────────────────────

  const dotColor =
    saveStatus === "synced"
      ? "#72CA9B"
      : "var(--bp-typography-color-muted)";

  const dotTooltip =
    saveStatus === "synced"
      ? "Saved — SVG exported"
      : saveStatus === "saving"
        ? "Saving diagram and exporting SVG…"
        : "Up to date";

  // ── Panel styles ─────────────────────────────────────────────────────────────

  const appFullscreenStyle: React.CSSProperties = appFullscreen
    ? {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        overflowY: "auto",
        padding: 24,
        background: isDark
          ? "var(--bp-palette-dark-gray-1)"
          : "var(--bp-palette-light-gray-5)",
        display: "flex",
        flexDirection: "column",
      }
    : {};

  const browserFullscreenStyle: React.CSSProperties = browserFullscreen
    ? {
        height: "100vh",
        overflowY: "auto",
        padding: 24,
        background: isDark
          ? "var(--bp-palette-dark-gray-1)"
          : "var(--bp-palette-light-gray-5)",
        display: "flex",
        flexDirection: "column",
      }
    : {};

  const panelStyle: React.CSSProperties = {
    ...appFullscreenStyle,
    ...browserFullscreenStyle,
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div ref={panelRef} style={panelStyle}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: collapsed ? 0 : 12,
          flexShrink: 0,
        }}
      >
        <p className="section-label" style={{ flexShrink: 0 }}>
          Diagrams
        </p>
        <Button
          variant="minimal"
          small
          icon={collapsed ? "chevron-right" : "chevron-down"}
          onClick={toggleCollapse}
          style={{ flexShrink: 0 }}
        />

        {!collapsed && (
          <>
            {/* Status dot — only visible when a diagram is active */}
            {activeDiagram !== null && (
              <Tooltip content={dotTooltip} placement="bottom">
                <div
                  role="status"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: dotColor,
                    flexShrink: 0,
                    transition: "background 0.4s",
                    cursor: "default",
                  }}
                />
              </Tooltip>
            )}

            <div style={{ flex: 1 }} />

            {/* Per-diagram actions — copy, rename, delete */}
            {activeDiagram !== null && (
              <>
                <Tooltip content="Copy SVG path" placement="bottom">
                  <Button
                    small
                    variant="minimal"
                    icon="clipboard"
                    onClick={() => handleCopySvgPath(activeDiagram)}
                    style={{ flexShrink: 0 }}
                  />
                </Tooltip>
                <Popover
                  isOpen={subRenameOpen}
                  onInteraction={(next) => { if (!next) setSubRenameOpen(false); }}
                  placement="bottom-end"
                  content={
                    <div style={{ padding: 12, width: 220 }}>
                      <InputGroup
                        small
                        autoFocus
                        value={subRenameValue}
                        onChange={(e) => setSubRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { void handleRename(activeDiagram, subRenameValue); setSubRenameOpen(false); }
                          if (e.key === "Escape") setSubRenameOpen(false);
                        }}
                      />
                      <div style={{ marginTop: 8, display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <Button small text="Cancel" onClick={() => setSubRenameOpen(false)} />
                        <Button small intent="primary" text="Rename" onClick={() => { void handleRename(activeDiagram, subRenameValue); setSubRenameOpen(false); }} />
                      </div>
                    </div>
                  }
                >
                  <Tooltip content="Rename" placement="bottom" disabled={subRenameOpen}>
                    <Button
                      small
                      variant="minimal"
                      icon="edit"
                      onClick={() => { setSubRenameValue(activeDiagram); setSubRenameOpen(true); }}
                      style={{ flexShrink: 0 }}
                    />
                  </Tooltip>
                </Popover>
                <Popover
                  isOpen={subDeleteOpen}
                  onInteraction={(next) => { if (!next) setSubDeleteOpen(false); }}
                  placement="bottom-end"
                  content={
                    <div style={{ padding: 12 }}>
                      <p style={{ margin: "0 0 8px", fontSize: 13 }}>Delete "{activeDiagram}"?</p>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <Button small text="Cancel" onClick={() => setSubDeleteOpen(false)} />
                        <Button small text="Delete" onClick={() => { void handleDelete(activeDiagram); setSubDeleteOpen(false); }} />
                      </div>
                    </div>
                  }
                >
                  <Tooltip content="Delete" placement="bottom" disabled={subDeleteOpen}>
                    <Button
                      small
                      variant="minimal"
                      icon="trash"
                      onClick={() => setSubDeleteOpen(true)}
                      style={{ flexShrink: 0 }}
                    />
                  </Tooltip>
                </Popover>
              </>
            )}

            {/* New diagram */}
            <Tooltip content="New diagram" placement="bottom">
              <Button
                small
                variant="minimal"
                icon="plus"
                onClick={() => { setNewName(""); setNewNameError(""); setNewDialogOpen(true); }}
                style={{ flexShrink: 0 }}
              />
            </Tooltip>

            {/* Diagram browser — only when a diagram is open */}
            {activeDiagram !== null && (
              <Popover
                isOpen={diagBrowserOpen}
                onInteraction={(next) => setDiagBrowserOpen(next)}
                placement="bottom-end"
                content={
                  <div style={{ padding: 8, width: 380, maxHeight: 420, overflowY: "auto" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                      {diagrams.map((d) => (
                        <DiagramCard
                          key={d.name}
                          diagram={d}
                          repoPath={repoPath}
                          isActive={d.name === activeDiagram}
                          svgVersion={svgVersions[d.name] ?? d.modifiedAt}
                          onOpen={(name) => { void openDiagram(name); setDiagBrowserOpen(false); }}
                          onRename={(name, newName) => void handleRename(name, newName)}
                          onDelete={(name) => void handleDelete(name)}
                          onCopyPath={handleCopySvgPath}
                        />
                      ))}
                      <Card

                        onClick={() => { setNewName(""); setNewNameError(""); setNewDialogOpen(true); setDiagBrowserOpen(false); }}
                        style={{
                          padding: 8, display: "flex", flexDirection: "column",
                          alignItems: "center", justifyContent: "center", gap: 6,
                          cursor: "pointer", border: "1.5px dashed var(--bp-surface-border-color-default)",
                          boxShadow: "none", minHeight: 108, background: "transparent",
                        }}
                      >
                        <Icon icon="plus" size={20} color="var(--bp-typography-color-muted)" />
                        <span style={{ fontSize: 11, color: "var(--bp-typography-color-muted)" }}>New Diagram</span>
                      </Card>
                    </div>
                  </div>
                }
              >
                <Tooltip content="Switch diagram" placement="bottom" disabled={diagBrowserOpen}>
                  <Button variant="minimal" small icon="diagram-tree" style={{ flexShrink: 0 }} />
                </Tooltip>
              </Popover>
            )}

            {/* Focus mode (hide other panels) */}
            <Tooltip
              content={appFullscreen ? "Exit focus mode" : "Focus mode — hide other panels"}
              placement="bottom"
            >
              <Button
                variant="minimal"
                small
                icon={appFullscreen ? "minimize" : "maximize"}
                onClick={toggleAppFullscreen}
                style={{ flexShrink: 0 }}
              />
            </Tooltip>

            {/* Browser fullscreen */}
            <Tooltip
              content={browserFullscreen ? "Exit fullscreen" : "Browser fullscreen"}
              placement="bottom"
            >
              <Button
                variant="minimal"
                small
                icon="fullscreen"
                onClick={toggleBrowserFullscreen}
                style={{ flexShrink: 0 }}
              />
            </Tooltip>

          </>
        )}
      </div>

      {/* Body */}
      {!collapsed && (
        <div
          style={
            isFullscreen
              ? { flex: 1, display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }
              : { display: "flex", flexDirection: "column", gap: 12 }
          }
        >
          {/* Diagram grid — only when no diagram is open */}
          {activeDiagram === null && (
            loading && diagrams.length === 0 ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
                <Spinner size={20} />
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {diagrams.map((d) => (
                  <DiagramCard
                    key={d.name}
                    diagram={d}
                    repoPath={repoPath}
                    isActive={false}
                    svgVersion={svgVersions[d.name] ?? d.modifiedAt}
                    onOpen={openDiagram}
                    onRename={(name, newName) => void handleRename(name, newName)}
                    onDelete={(name) => void handleDelete(name)}
                    onCopyPath={handleCopySvgPath}
                  />
                ))}
                <Card
                  interactive
                  onClick={() => { setNewName(""); setNewNameError(""); setNewDialogOpen(true); }}
                  style={{
                    padding: 8, display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 6,
                    cursor: "pointer", border: "1.5px dashed var(--bp-surface-border-color-default)",
                    boxShadow: "none", minHeight: 108, background: "transparent",
                  }}
                >
                  <Icon icon="plus" size={20} color="var(--bp-typography-color-muted)" />
                  <span style={{ fontSize: 11, color: "var(--bp-typography-color-muted)" }}>New Diagram</span>
                </Card>
              </div>
            )
          )}

          {/* Active diagram editor */}
          {activeDiagram !== null && (
            <div
              style={
                isFullscreen
                  ? { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }
                  : { display: "flex", flexDirection: "column" }
              }
            >
              {/* Tab strip */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  borderBottom: "1px solid var(--bp-surface-border-color-default)",
                  marginBottom: 4,
                  flexShrink: 0,
                  overflowX: "auto",
                }}
              >
                {openDiagrams.map((name) => (
                  <div
                    key={name}
                    onClick={() => setActiveDiagram(name)}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "4px 10px 4px",
                      cursor: "pointer", flexShrink: 0,
                      borderBottom: name === activeDiagram
                        ? "2px solid var(--bp-intent-primary-default-color)"
                        : "2px solid transparent",
                      color: name === activeDiagram
                        ? "var(--bp-typography-color-default)"
                        : "var(--bp-typography-color-muted)",
                      userSelect: "none",
                    }}
                  >
                    <span style={{ fontSize: 11, fontFamily: "var(--bp-typography-family-mono)" }}>
                      docs/diagrams/{name}.svg
                    </span>
                    <span
                      onClick={(e) => { e.stopPropagation(); closeTab(name); }}
                      style={{ cursor: "pointer", fontSize: 14, lineHeight: 1, opacity: 0.5, marginLeft: 2 }}
                    >×</span>
                  </div>
                ))}
              </div>

              {/* Canvas container */}
              <div
                style={
                  isFullscreen
                    ? {
                        flex: 1,
                        minHeight: 0,
                        border: "1px solid var(--bp-surface-border-color-default)",
                        borderRadius: 3,
                        overflow: "hidden",
                      }
                    : {
                        height: 550,
                        border: "1px solid var(--bp-surface-border-color-default)",
                        borderRadius: 3,
                        overflow: "hidden",
                      }
                }
              >
                <DiagramEditor
                  key={activeDiagram}
                  name={activeDiagram}
                  initialData={diagramContents[activeDiagram] ?? ""}
                  isDark={isDark}
                  onSave={handleSave}
                  onStatusChange={setSaveStatus}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* New Diagram Dialog */}
      <Dialog
        isOpen={newDialogOpen}
        onClose={() => setNewDialogOpen(false)}
        title="New Diagram"
        style={{ width: 360 }}
      >
        <DialogBody>
          <InputGroup
            autoFocus
            placeholder="Diagram name"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              setNewNameError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateDiagram();
            }}
            intent={newNameError ? "danger" : "none"}
          />
          {newNameError && (
            <p
              style={{
                color: "var(--bp-intent-danger-default-color)",
                fontSize: 12,
                margin: "6px 0 0",
              }}
            >
              {newNameError}
            </p>
          )}
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={() => setNewDialogOpen(false)} />
              <Button
                intent="primary"
                text="Create"
                onClick={() => void handleCreateDiagram()}
                disabled={!newName.trim()}
              />
            </>
          }
        />
      </Dialog>

    </div>
  );
}

// ── DiagramCard ───────────────────────────────────────────────────────────────

interface DiagramCardProps {
  diagram: DiagramMeta;
  repoPath: string;
  isActive: boolean;
  svgVersion: number;
  onOpen: (name: string) => void;
  onRename: (name: string, newName: string) => void;
  onDelete: (name: string) => void;
  onCopyPath: (name: string) => void;
}

function DiagramCard({
  diagram,
  repoPath,
  isActive,
  svgVersion,
  onOpen,
  onRename,
  onDelete,
  onCopyPath,
}: DiagramCardProps) {
  const { name, hasSvg } = diagram;
  const [isHovered, setIsHovered] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const showActions = isHovered || renameOpen || deleteOpen;
  const thumbnailSrc = `/api/diagrams/svg?path=${encodeURIComponent(repoPath)}&name=${encodeURIComponent(name)}&v=${svgVersion}`;

  const doRename = () => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenameError("Name required"); return; }
    if (!/^[a-zA-Z0-9 \-_]+$/.test(trimmed)) { setRenameError("Letters, numbers, spaces, - _ only"); return; }
    onRename(name, trimmed);
    setRenameOpen(false);
    setRenameError("");
  };

  return (
    <Card
      onClick={() => onOpen(name)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        padding: 8,
        cursor: "pointer",
        outline: isActive ? "2px solid var(--bp-intent-primary-default-color)" : "none",
        outlineOffset: -2,
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      {/* Thumbnail — white background always for SVG readability */}
      <div
        style={{
          width: "100%",
          height: 72,
          background: "#ffffff",
          borderRadius: 2,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 6,
          flexShrink: 0,
        }}
      >
        {hasSvg ? (
          <img
            key={svgVersion}
            src={thumbnailSrc}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            alt={name}
          />
        ) : (
          <Icon icon="diagram-tree" size={22} color="#aaa" />
        )}
      </div>

      {/* Name + hover action buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, minHeight: 20 }}>
        <span
          style={{
            fontSize: 11,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: "20px",
          }}
          title={name}
        >
          {name}
        </span>
        {showActions && (
          <>
            <Tooltip content="Copy SVG path" placement="bottom">
              <Button
                small
                variant="minimal"
                icon="clipboard"
                style={{ flexShrink: 0, minWidth: 20, minHeight: 20, padding: 2 }}
                onClick={(e) => { e.stopPropagation(); onCopyPath(name); }}
              />
            </Tooltip>
            <Popover
              isOpen={renameOpen}
              onInteraction={(next) => { if (!next) { setRenameOpen(false); setRenameError(""); } }}
              placement="bottom-end"
              content={
                <div onClick={(e) => e.stopPropagation()} style={{ padding: 12, width: 220 }}>
                  <InputGroup
                    small
                    autoFocus
                    value={renameValue}
                    intent={renameError ? "danger" : "none"}
                    onChange={(e) => { setRenameValue(e.target.value); setRenameError(""); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") doRename();
                      if (e.key === "Escape") { setRenameOpen(false); setRenameError(""); }
                    }}
                  />
                  {renameError && (
                    <p style={{ color: "var(--bp-intent-danger-default-color)", fontSize: 11, margin: "4px 0 0" }}>
                      {renameError}
                    </p>
                  )}
                  <div style={{ marginTop: 8, display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <Button small text="Cancel" onClick={(e) => { e.stopPropagation(); setRenameOpen(false); setRenameError(""); }} />
                    <Button small intent="primary" text="Rename" onClick={(e) => { e.stopPropagation(); doRename(); }} />
                  </div>
                </div>
              }
            >
              <Tooltip content="Rename" placement="bottom" disabled={renameOpen}>
                <Button
                  small
                  variant="minimal"
                  icon="edit"
                  style={{ flexShrink: 0, minWidth: 20, minHeight: 20, padding: 2 }}
                  onClick={(e) => { e.stopPropagation(); setRenameValue(name); setRenameOpen(true); }}
                />
              </Tooltip>
            </Popover>
            <Popover
              isOpen={deleteOpen}
              onInteraction={(next) => { if (!next) setDeleteOpen(false); }}
              placement="bottom-end"
              content={
                <div onClick={(e) => e.stopPropagation()} style={{ padding: 12 }}>
                  <p style={{ margin: "0 0 8px", fontSize: 13 }}>Delete "{name}"?</p>
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <Button small text="Cancel" onClick={(e) => { e.stopPropagation(); setDeleteOpen(false); }} />
                    <Button small text="Delete" onClick={(e) => { e.stopPropagation(); onDelete(name); setDeleteOpen(false); }} />
                  </div>
                </div>
              }
            >
              <Tooltip content="Delete" placement="bottom" disabled={deleteOpen}>
                <Button
                  small
                  variant="minimal"
                  icon="trash"
                  style={{ flexShrink: 0, minWidth: 20, minHeight: 20, padding: 2 }}
                  onClick={(e) => { e.stopPropagation(); setDeleteOpen(true); }}
                />
              </Tooltip>
            </Popover>
          </>
        )}
      </div>
    </Card>
  );
}
