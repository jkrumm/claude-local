import { useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Button, InputGroup, Intent } from "@blueprintjs/core";
import { api } from "../lib/api";
import { QueueCard } from "./QueueCard";
import type { QueueTask } from "../types";

interface Props {
  tasks: QueueTask[];
  repoPath: string;
  onTasksChange: (tasks: QueueTask[]) => void;
}

function reindex(tasks: QueueTask[]): QueueTask[] {
  return tasks.map((t, i) => ({ ...t, index: i }));
}

async function syncToServer(
  path: string,
  tasks: QueueTask[],
): Promise<void> {
  await api.api.queue.put({ tasks }, { query: { path } });
}

export function QueuePanel({ tasks, repoPath, onTasksChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [addValue, setAddValue] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = tasks.findIndex((t) => t.index === active.id);
    const newIndex = tasks.findIndex((t) => t.index === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = reindex(arrayMove(tasks, oldIndex, newIndex));
    onTasksChange(reordered);
    void syncToServer(repoPath, reordered);
  };

  const handleDelete = (index: number) => {
    const updated = reindex(tasks.filter((t) => t.index !== index));
    onTasksChange(updated);
    void syncToServer(repoPath, updated);
  };

  const handleUpdate = (index: number, content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const firstLine = trimmed.split("\n")[0];
    let kind: QueueTask["kind"];
    if (firstLine.toUpperCase() === "PAUSE") {
      kind = "pause";
    } else if (firstLine.startsWith("/")) {
      kind = "slash";
    } else {
      kind = "task";
    }

    const updated = reindex(
      tasks.map((t) =>
        t.index === index
          ? {
              ...t,
              content: trimmed,
              preview: firstLine,
              kind,
              lineCount: trimmed.split("\n").length,
            }
          : t,
      ),
    );
    onTasksChange(updated);
    void syncToServer(repoPath, updated);
  };

  const handleAddKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const raw = addValue.trim();
    if (!raw) return;

    const kind: QueueTask["kind"] = raw.startsWith("/") ? "slash" : "task";
    const newTask: QueueTask = {
      index: tasks.length,
      kind,
      content: raw,
      preview: raw.split("\n")[0],
      lineCount: raw.split("\n").length,
    };

    const updated = reindex([...tasks, newTask]);
    onTasksChange(updated);
    void syncToServer(repoPath, updated);
    setAddValue("");
  };

  const handleAddPause = () => {
    const newTask: QueueTask = {
      index: tasks.length,
      kind: "pause",
      content: "PAUSE",
      preview: "PAUSE",
      lineCount: 1,
    };
    const updated = reindex([...tasks, newTask]);
    onTasksChange(updated);
    void syncToServer(repoPath, updated);
  };

  const sortableIds = tasks.map((t) => t.index);

  return (
    <div>
      {/* Section header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            opacity: 0.6,
            textTransform: "uppercase",
          }}
        >
          Queue ({tasks.length})
        </span>
        <Button
          variant="minimal"
          icon={collapsed ? "chevron-right" : "chevron-down"}
          small
          onClick={() => setCollapsed((p) => !p)}
        />
      </div>

      {!collapsed && (
        <>
          {tasks.length === 0 && (
            <p
              style={{
                fontSize: 12,
                opacity: 0.45,
                fontStyle: "italic",
                marginBottom: 10,
              }}
            >
              No tasks queued.
            </p>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sortableIds}
              strategy={verticalListSortingStrategy}
            >
              {tasks.map((task) => (
                <QueueCard
                  key={task.index}
                  task={task}
                  onDelete={() => handleDelete(task.index)}
                  onUpdate={(content) => handleUpdate(task.index, content)}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* Add task row */}
          <div
            style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}
          >
            <div style={{ flex: 1 }}>
              <InputGroup
                inputRef={addInputRef}
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                onKeyDown={handleAddKeyDown}
                placeholder="Add task or /slash-command… (Enter)"
                small
                leftIcon="plus"
                style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
              />
            </div>
            <Button
              intent={Intent.WARNING}
              small
              onClick={handleAddPause}
              style={{ flexShrink: 0 }}
            >
              PAUSE
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
