import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Callout,
  Icon,
  Menu,
  MenuItem,
  Popover,
  Spinner,
  Tree,
} from "@blueprintjs/core";
import type { TreeNodeInfo } from "@blueprintjs/core";
import { api } from "../lib/api";
import { MarkdownEditor } from "./MarkdownEditor";

interface Props {
  notes: string;
  repoPath: string;
  externallyChanged: boolean;
  onExternalChangeAck: () => void;
}

// Build Blueprint Tree nodes from flat file paths
function buildFileTree(
  files: string[],
  expandedFolders: Set<string>,
  selectedFile: string | null,
): TreeNodeInfo[] {
  interface DirNode {
    children: Map<string, DirNode>;
    files: string[];
    path: string;
  }

  const root: DirNode = { children: new Map(), files: [], path: "" };

  for (const file of files) {
    const parts = file.split("/");
    let current = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      const dirPath = parts.slice(0, i + 1).join("/");
      if (!current.children.has(dir)) {
        current.children.set(dir, {
          children: new Map(),
          files: [],
          path: dirPath,
        });
      }
      current = current.children.get(dir)!;
    }

    current.files.push(file);
  }

  function toTreeNodes(node: DirNode): TreeNodeInfo[] {
    const nodes: TreeNodeInfo[] = [];

    const dirs = [...node.children.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    for (const [name, child] of dirs) {
      const isExpanded = expandedFolders.has(child.path);
      nodes.push({
        id: child.path,
        label: name,
        icon: isExpanded ? "folder-open" : "folder-close",
        isExpanded,
        childNodes: toTreeNodes(child),
      });
    }

    for (const file of node.files.sort()) {
      const fileName = file.split("/").pop()!;
      nodes.push({
        id: file,
        label: fileName,
        icon: "document",
        isSelected: file === selectedFile,
      });
    }

    return nodes;
  }

  return toTreeNodes(root);
}

export function NotesPanel({
  notes,
  repoPath,
  externallyChanged,
  onExternalChangeAck,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState(notes);
  const [cnoteVersion, setCnoteVersion] = useState(0);
  const [fileVersion, setFileVersion] = useState(0);
  const [mdFiles, setMdFiles] = useState<string[] | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);

  // localStorage
  const storagePrefix = `cqueue:${repoPath}`;

  const [recentFiles, setRecentFiles] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(`${storagePrefix}:recentMds`) ?? "[]",
      );
    } catch {
      return [];
    }
  });

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`${storagePrefix}:mdTreeExpanded`);
      if (stored) return new Set(JSON.parse(stored));
    } catch {
      /* ignore */
    }
    return new Set(["docs"]);
  });

  // Fetch markdown files when tree popover opens
  useEffect(() => {
    if (treeOpen && mdFiles === null) {
      api.api["markdown-files"]
        .get({ query: { path: repoPath } })
        .then((res) => {
          if (res.data?.ok) setMdFiles(res.data.data as string[]);
        });
    }
  }, [treeOpen, mdFiles, repoPath]);

  const handleFileSelect = async (file: string) => {
    if (selectedFile === file) {
      setTreeOpen(false);
      return;
    }
    const res = await api.api["markdown-file"]
      .get({ query: { path: repoPath, file } })
      .catch(() => null);
    if (res?.data?.ok) {
      setSelectedFile(file);
      setEditorContent(res.data.data as string);
      setFileVersion((v) => v + 1);
      setTreeOpen(false);
      // Update recents
      const updated = [file, ...recentFiles.filter((f) => f !== file)].slice(
        0,
        10,
      );
      setRecentFiles(updated);
      localStorage.setItem(
        `${storagePrefix}:recentMds`,
        JSON.stringify(updated),
      );
    }
  };

  const handleSwitchToCnote = async () => {
    if (!selectedFile) return;
    const res = await api.api.notes
      .get({ query: { path: repoPath } })
      .catch(() => null);
    const content = res?.data?.ok ? (res.data.data as string) : notes;
    setSelectedFile(null);
    setEditorContent(content);
    setCnoteVersion((v) => v + 1);
  };

  const handleCnoteReload = async () => {
    const res = await api.api.notes
      .get({ query: { path: repoPath } })
      .catch(() => null);
    if (res?.data?.ok) {
      setEditorContent(res.data.data as string);
      setCnoteVersion((v) => v + 1);
    }
    onExternalChangeAck();
  };

  const persistExpansion = (next: Set<string>) => {
    setExpandedFolders(next);
    localStorage.setItem(
      `${storagePrefix}:mdTreeExpanded`,
      JSON.stringify([...next]),
    );
  };

  const handleTreeNodeClick = (node: TreeNodeInfo) => {
    if (node.childNodes) {
      const next = new Set(expandedFolders);
      if (next.has(node.id as string)) next.delete(node.id as string);
      else next.add(node.id as string);
      persistExpansion(next);
    } else {
      handleFileSelect(node.id as string);
    }
  };

  const handleNodeExpand = (node: TreeNodeInfo) => {
    const next = new Set(expandedFolders);
    next.add(node.id as string);
    persistExpansion(next);
  };

  const handleNodeCollapse = (node: TreeNodeInfo) => {
    const next = new Set(expandedFolders);
    next.delete(node.id as string);
    persistExpansion(next);
  };

  const treeNodes = useMemo(
    () =>
      mdFiles
        ? buildFileTree(mdFiles, expandedFolders, selectedFile)
        : [],
    [mdFiles, expandedFolders, selectedFile],
  );

  // Save functions
  const editorSave = selectedFile
    ? (content: string) =>
        api.api["markdown-file"].put(
          { content },
          { query: { path: repoPath, file: selectedFile } },
        )
    : (content: string) =>
        api.api.notes.put({ content }, { query: { path: repoPath } });

  const contentKey = selectedFile
    ? `${selectedFile}:${fileVersion}`
    : `cnotes:${cnoteVersion}`;

  return (
    <div>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <p className="section-label">Notes</p>
        <Button
          variant="minimal"
          small
          icon={collapsed ? "chevron-right" : "chevron-down"}
          onClick={() => setCollapsed((c) => !c)}
        />
        <div style={{ flex: 1 }} />
        {!collapsed && (
          <div style={{ display: "flex", gap: 4 }}>
            <Button
              small
              text="CNote"
              variant="outlined"
              active={!selectedFile}
              onClick={handleSwitchToCnote}
            />
            <Popover
              content={
                <Menu>
                  {recentFiles.map((file) => (
                    <MenuItem
                      key={file}
                      text={file}
                      icon="document"
                      active={selectedFile === file}
                      onClick={() => handleFileSelect(file)}
                    />
                  ))}
                </Menu>
              }
              placement="bottom-end"
              minimal
            >
              <Button
                small
                text="Recent"
                variant="outlined"
                rightIcon="caret-down"
                disabled={recentFiles.length === 0}
              />
            </Popover>
            <Popover
              content={
                <div
                  className="md-file-tree"
                  style={{
                    maxHeight: 300,
                    overflowY: "auto",
                    minWidth: 220,
                    padding: 4,
                  }}
                >
                  {mdFiles === null ? (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        padding: 16,
                      }}
                    >
                      <Spinner size={20} />
                    </div>
                  ) : mdFiles.length === 0 ? (
                    <div style={{ padding: 8, opacity: 0.5, fontSize: 12 }}>
                      No markdown files found
                    </div>
                  ) : (
                    <Tree
                      contents={treeNodes}
                      onNodeClick={handleTreeNodeClick}
                      onNodeExpand={handleNodeExpand}
                      onNodeCollapse={handleNodeCollapse}
                    />
                  )}
                </div>
              }
              placement="bottom-end"
              minimal
              isOpen={treeOpen}
              onInteraction={(next) => setTreeOpen(next)}
            >
              <Button
                small
                text="All MDs"
                variant="outlined"
                rightIcon="caret-down"
              />
            </Popover>
          </div>
        )}
      </div>

      {/* External change warning (cnotes only) */}
      {externallyChanged && !selectedFile && !collapsed && (
        <Callout intent="warning" style={{ marginBottom: 8 }}>
          Notes changed externally —{" "}
          <Button variant="minimal" small onClick={handleCnoteReload}>
            Reload
          </Button>
        </Callout>
      )}

      {/* Selected file indicator */}
      {selectedFile && !collapsed && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 8,
          }}
        >
          <Icon icon="document" size={12} />
          <span
            style={{
              fontFamily: "var(--bp-typography-family-mono)",
              fontSize: 12,
              opacity: 0.7,
            }}
          >
            {selectedFile}
          </span>
          <Button
            variant="minimal"
            small
            icon="cross"
            onClick={handleSwitchToCnote}
            style={{ marginLeft: "auto" }}
          />
        </div>
      )}

      {/* Editor — always mounted, hidden when collapsed */}
      <div style={{ display: collapsed ? "none" : "block" }}>
        <MarkdownEditor
          content={editorContent}
          contentKey={contentKey}
          onSave={editorSave}
          placeholder={
            selectedFile
              ? `Editing ${selectedFile}...`
              : "Session notes..."
          }
        />
      </div>
    </div>
  );
}
