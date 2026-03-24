import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Spinner } from "@blueprintjs/core";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";

export type SaveStatus = "idle" | "dirty" | "saving" | "synced";

interface Props {
  name: string;
  initialData: string;
  isDark: boolean;
  onSave: (name: string, excalidraw: string, svg: string) => Promise<void>;
  onStatusChange: (status: SaveStatus) => void;
}

const ExcalidrawComponent = React.lazy(() => import("./ExcalidrawLazy"));

export function DiagramEditor({
  name,
  initialData,
  isDark,
  onSave,
  onStatusChange,
}: Props) {
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{
    elements: Parameters<NonNullable<React.ComponentProps<typeof ExcalidrawComponent>["onChange"]>>[0];
    appState: Parameters<NonNullable<React.ComponentProps<typeof ExcalidrawComponent>["onChange"]>>[1];
    files: Parameters<NonNullable<React.ComponentProps<typeof ExcalidrawComponent>["onChange"]>>[2];
  } | null>(null);
  const statusRef = useRef<SaveStatus>("idle");
  const onSaveRef = useRef(onSave);
  const onStatusChangeRef = useRef(onStatusChange);

  // Keep refs up to date without re-creating callbacks
  onSaveRef.current = onSave;
  onStatusChangeRef.current = onStatusChange;

  const setStatus = useCallback((status: SaveStatus) => {
    statusRef.current = status;
    onStatusChangeRef.current(status);
  }, []);

  const parsedInitialData = useMemo(() => {
    if (!initialData) {
      return { elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {}, scrollToContent: true };
    }
    try {
      const parsed = JSON.parse(initialData) as {
        elements?: unknown[];
        appState?: Record<string, unknown>;
        files?: Record<string, unknown>;
      };
      return {
        elements: parsed.elements ?? [],
        appState: parsed.appState ?? {},
        files: parsed.files ?? {},
        scrollToContent: true,
      };
    } catch {
      return { elements: [], appState: {}, files: {}, scrollToContent: true };
    }
    // Only parse on mount — DiagramEditor remounts via key prop on diagram switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSave = useCallback(async () => {
    const pending = pendingSaveRef.current;
    if (!pending) return;

    pendingSaveRef.current = null;
    setStatus("saving");

    try {
      const { serializeAsJSON, exportToSvg } = await import("@excalidraw/excalidraw");

      const excalidrawJson = serializeAsJSON(
        pending.elements,
        pending.appState,
        pending.files,
        "local",
      );

      const svgEl = await exportToSvg({
        elements: pending.elements,
        appState: {
          ...pending.appState,
          exportWithDarkMode: false, // always export light-mode SVG for doc embedding
        },
        files: pending.files,
        exportPadding: 16,
      });

      const svgString = new XMLSerializer().serializeToString(svgEl);

      await onSaveRef.current(name, excalidrawJson, svgString);
      setStatus("synced");

      setTimeout(() => {
        if (statusRef.current === "synced") setStatus("idle");
      }, 2000);
    } catch {
      setStatus("dirty");
    }
  }, [name, setStatus]);

  const flushSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (pendingSaveRef.current) {
      void doSave();
    }
  }, [doSave]);

  const scheduleDebounce = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void doSave();
    }, 3_000);
  }, [doSave]);

  const handleChange = useCallback(
    (
      elements: Parameters<NonNullable<React.ComponentProps<typeof ExcalidrawComponent>["onChange"]>>[0],
      appState: Parameters<NonNullable<React.ComponentProps<typeof ExcalidrawComponent>["onChange"]>>[1],
      files: Parameters<NonNullable<React.ComponentProps<typeof ExcalidrawComponent>["onChange"]>>[2],
    ) => {
      pendingSaveRef.current = { elements, appState, files };
      if (statusRef.current === "idle" || statusRef.current === "synced") {
        setStatus("dirty");
      }
      scheduleDebounce();
    },
    [scheduleDebounce, setStatus],
  );

  // Flush on window blur (tab switch, browser minimize)
  useEffect(() => {
    window.addEventListener("blur", flushSave);
    return () => window.removeEventListener("blur", flushSave);
  }, [flushSave]);

  // Flush on unmount (diagram switch, panel collapse)
  useEffect(() => {
    return () => {
      flushSave();
    };
  }, [flushSave]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <React.Suspense
        fallback={
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
            }}
          >
            <Spinner size={32} />
          </div>
        }
      >
        <ExcalidrawComponent
          initialData={parsedInitialData}
          excalidrawAPI={(api) => {
            excalidrawAPIRef.current = api;
          }}
          onChange={handleChange}
          theme={isDark ? "dark" : "light"}
          UIOptions={{
            canvasActions: {
              toggleTheme: null,
              export: false,
              saveToActiveFile: false,
            },
          }}
        />
      </React.Suspense>
    </div>
  );
}
