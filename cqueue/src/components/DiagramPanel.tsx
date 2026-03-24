import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogFooter,
  Icon,
  InputGroup,
  OverlayToaster,
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

// Safari uses webkit-prefixed fullscreen API
const fsElement = () =>
  document.fullscreenElement ??
  (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;

const fsExit = () =>
  (document.exitFullscreen ?? (document as Document & { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen)
    ?.call(document);

export function DiagramPanel({ repoPath }: Props) {
  const { isDark } = useTheme();
  const panelRef = useRef<HTMLDivElement>(null);
  const storagePrefix = `cqueue:${repoPath}`;

  // Panel state
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(`${storagePrefix}:diagramsCollapsed`) === "true",
  );
  const [diagrams, setDiagrams] = useState<DiagramMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeDiagram, setActiveDiagram] = useState<string | null>(null);
  const [diagramContent, setDiagramContent] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [svgVersions, setSvgVersions] = useState<Record<string, number>>({});

  // Fullscreen state
  const [appFullscreen, setAppFullscreen] = useState(false);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);

  // Dialog / alert state
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNameError, setNewNameError] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

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

  // ── Open diagram ────────────────────────────────────────────────────────────

  const openDiagram = useCallback(
    async (name: string) => {
      if (name === activeDiagram) return;
      const res = await api.api.diagrams.file
        .get({ query: { path: repoPath, name } })
        .catch(() => null);
      if (res?.data?.ok) {
        setActiveDiagram(name);
        setDiagramContent(res.data.data as string);
        setSaveStatus("idle");
      }
    },
    [activeDiagram, repoPath],
  );

  // ── Save handler (called by DiagramEditor) ──────────────────────────────────

  const handleSave = useCallback(
    async (name: string, excalidraw: string, svg: string) => {
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

  const startRename = (name: string) => {
    setRenameTarget(name);
    setRenameName(name);
    setRenameError("");
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const newNameTrimmed = renameName.trim();
    const otherNames = diagrams.map((d) => d.name).filter((n) => n !== renameTarget);
    const error = validateName(newNameTrimmed, otherNames);
    if (error) {
      setRenameError(error);
      return;
    }

    await api.api.diagrams.rename.post(
      { name: renameTarget, newName: newNameTrimmed },
      { query: { path: repoPath } },
    );

    setDiagrams((prev) =>
      prev.map((d) => (d.name === renameTarget ? { ...d, name: newNameTrimmed } : d)),
    );
    if (activeDiagram === renameTarget) setActiveDiagram(newNameTrimmed);
    setRenameTarget(null);
    setRenameName("");
    setRenameError("");
  };

  // ── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await api.api.diagrams.file.delete({
      query: { path: repoPath, name: deleteTarget },
    });
    setDiagrams((prev) => prev.filter((d) => d.name !== deleteTarget));
    if (activeDiagram === deleteTarget) {
      setActiveDiagram(null);
      setDiagramContent("");
    }
    setDeleteTarget(null);
  };

  // ── Copy SVG path ───────────────────────────────────────────────────────────

  const handleCopySvgPath = (name: string) => {
    const path = `docs/diagrams/${name}.svg`;
    const onSuccess = () => showToast(`Copied: ${path}`);

    if (navigator.clipboard) {
      // HTTPS / localhost context
      void navigator.clipboard.writeText(path).then(onSuccess);
    } else {
      // Fallback for HTTP (cqueue.local served without TLS)
      const ta = document.createElement("textarea");
      ta.value = path;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        onSuccess();
      } catch {
        showToast("Copy failed — check browser permissions");
      }
      document.body.removeChild(ta);
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
    const el = panelRef.current;
    if (!el) return;
    // Must remain synchronous to preserve user-gesture context
    // Safari uses webkitRequestFullscreen
    const req = (el as HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> })
      .requestFullscreen ?? (el as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen;
    if (!req) return;
    req.call(el).catch((err: unknown) => {
      console.warn("Fullscreen request failed:", err);
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
        top: 50,
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
          {/* Diagram grid — always visible */}
          {loading && diagrams.length === 0 ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
              <Spinner size={20} />
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
              }}
            >
              {diagrams.map((d) => (
                <DiagramCard
                  key={d.name}
                  diagram={d}
                  repoPath={repoPath}
                  isActive={activeDiagram === d.name}
                  svgVersion={svgVersions[d.name] ?? d.modifiedAt}
                  onOpen={openDiagram}
                  onRename={startRename}
                  onDelete={(name) => setDeleteTarget(name)}
                  onCopyPath={handleCopySvgPath}
                />
              ))}
              {/* New diagram card */}
              <Card
                interactive
                onClick={() => {
                  setNewName("");
                  setNewNameError("");
                  setNewDialogOpen(true);
                }}
                style={{
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  cursor: "pointer",
                  border: "1.5px dashed var(--bp-surface-border-color-default)",
                  boxShadow: "none",
                  minHeight: 108,
                  background: "transparent",
                }}
              >
                <Icon icon="plus" size={20} color="var(--bp-typography-color-muted)" />
                <span style={{ fontSize: 11, color: "var(--bp-typography-color-muted)" }}>
                  New Diagram
                </span>
              </Card>
            </div>
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
              {/* Editor sub-header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 4,
                  flexShrink: 0,
                }}
              >
                <Icon
                  icon="diagram-tree"
                  size={12}
                  color="var(--bp-typography-color-muted)"
                />
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: "var(--bp-typography-family-mono)",
                    fontWeight: 600,
                    flex: 1,
                  }}
                >
                  {activeDiagram}
                </span>
                <Tooltip content="Copy SVG path" placement="bottom">
                  <Button
                    small
                    variant="minimal"
                    icon="clipboard"
                    onClick={() => handleCopySvgPath(activeDiagram)}
                    style={{ flexShrink: 0 }}
                  />
                </Tooltip>
                <Tooltip content="Rename diagram" placement="bottom">
                  <Button
                    small
                    variant="minimal"
                    icon="edit"
                    onClick={() => startRename(activeDiagram)}
                    style={{ flexShrink: 0 }}
                  />
                </Tooltip>
                <Tooltip content="Delete diagram" placement="bottom">
                  <Button
                    small
                    variant="minimal"
                    icon="trash"
                    intent="danger"
                    onClick={() => setDeleteTarget(activeDiagram)}
                    style={{ flexShrink: 0 }}
                  />
                </Tooltip>
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
                  initialData={diagramContent}
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

      {/* Rename Dialog */}
      <Dialog
        isOpen={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Rename Diagram"
        style={{ width: 360 }}
      >
        <DialogBody>
          <InputGroup
            autoFocus
            placeholder="New name"
            value={renameName}
            onChange={(e) => {
              setRenameName(e.target.value);
              setRenameError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRename();
            }}
            intent={renameError ? "danger" : "none"}
          />
          {renameError && (
            <p
              style={{
                color: "var(--bp-intent-danger-default-color)",
                fontSize: 12,
                margin: "6px 0 0",
              }}
            >
              {renameError}
            </p>
          )}
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={() => setRenameTarget(null)} />
              <Button
                intent="primary"
                text="Rename"
                onClick={() => void handleRename()}
                disabled={!renameName.trim()}
              />
            </>
          }
        />
      </Dialog>

      {/* Delete Confirmation */}
      <Alert
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
        intent="danger"
        confirmButtonText="Delete"
        cancelButtonText="Cancel"
        icon="trash"
      >
        <p>
          Delete <strong>{deleteTarget}</strong>? This removes both the{" "}
          <code>.excalidraw</code> and <code>.svg</code> files and cannot be
          undone.
        </p>
      </Alert>
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
  onRename: (name: string) => void;
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
  const thumbnailSrc = `/api/diagrams/svg?path=${encodeURIComponent(repoPath)}&name=${encodeURIComponent(name)}&v=${svgVersion}`;

  return (
    <Card
      interactive
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
        {isHovered && (
          <>
            <Tooltip content="Copy SVG path" placement="bottom">
              <Button
                small
                variant="minimal"
                icon="clipboard"
                style={{ flexShrink: 0, minWidth: 20, minHeight: 20, padding: 2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyPath(name);
                }}
              />
            </Tooltip>
            <Tooltip content="Rename" placement="bottom">
              <Button
                small
                variant="minimal"
                icon="edit"
                style={{ flexShrink: 0, minWidth: 20, minHeight: 20, padding: 2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(name);
                }}
              />
            </Tooltip>
            <Tooltip content="Delete" placement="bottom">
              <Button
                small
                variant="minimal"
                icon="trash"
                intent="danger"
                style={{ flexShrink: 0, minWidth: 20, minHeight: 20, padding: 2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(name);
                }}
              />
            </Tooltip>
          </>
        )}
      </div>
    </Card>
  );
}
