import { useEffect, useRef, useState } from "react";
import EasyMDE from "easymde";
import { Button, Callout } from "@blueprintjs/core";
import { api } from "../lib/api";
import "easymde/dist/easymde.min.css";

interface Props {
  notes: string;
  repoPath: string;
  externallyChanged: boolean;
  onExternalChangeAck: () => void;
}

export function NotesPanel({
  notes,
  repoPath,
  externallyChanged,
  onExternalChangeAck,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<EasyMDE | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!textareaRef.current) return;

    const editor = new EasyMDE({
      element: textareaRef.current,
      initialValue: notes,
      spellChecker: false,
      autosave: { enabled: false, uniqueId: "cqueue-notes" },
      toolbar: [
        "bold",
        "italic",
        "heading",
        "|",
        "quote",
        "unordered-list",
        "ordered-list",
        "|",
        "link",
        "image",
        "code",
        "|",
        "preview",
        "side-by-side",
        "fullscreen",
      ] as EasyMDE.Options["toolbar"],
      placeholder: "Session notes...",
    });

    editorRef.current = editor;

    editor.codemirror.on("change", () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        api.api.notes
          .put({ content: editor.value() }, { query: { path: repoPath } })
          .catch(() => {});
      }, 1000);
    });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      editor.toTextArea();
      editorRef.current = null;
    };
    // Initialize once on mount; repoPath won't change during component lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReload = async () => {
    const result = await api.api.notes.get({ query: { path: repoPath } });
    if (result.data?.ok && editorRef.current) {
      editorRef.current.value(result.data.data as string);
    }
    onExternalChangeAck();
  };

  return (
    <div>
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            fontSize: 12,
            letterSpacing: "0.1em",
            opacity: 0.7,
          }}
        >
          NOTES
        </span>
        <Button
          variant="minimal"
          small
          icon={collapsed ? "chevron-right" : "chevron-down"}
          onClick={() => setCollapsed((c) => !c)}
        />
      </div>

      {externallyChanged && !collapsed && (
        <Callout intent="warning" style={{ marginBottom: 8 }}>
          Notes changed externally —{" "}
          <Button variant="minimal" small onClick={handleReload}>
            Reload
          </Button>
        </Callout>
      )}

      {/* Always rendered so EasyMDE stays mounted; hidden via CSS when collapsed */}
      <div style={{ display: collapsed ? "none" : "block" }}>
        <textarea ref={textareaRef} />
      </div>
    </div>
  );
}
