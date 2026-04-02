---
name: read-drawing
description: Read and interpret Excalidraw diagrams (.excalidraw + .svg). Use when given a diagram file path to extract visual and semantic context for the current task.
model: haiku
---

# Excalidraw Diagram Reader

Extract visual + structural understanding from an Excalidraw diagram and inject it as context for the current task.

## Usage

```
/read-drawing /path/to/diagram.svg
/read-drawing /path/to/diagram.excalidraw
/read-drawing /path/to/diagram          # resolves both files automatically
```

---

## Step 1: Resolve File Paths

Strip the extension to get a base path. Use Glob to check which of these exist:
- `<base>.svg`
- `<base>.excalidraw`

Both preferred. Either acceptable. Note what's available before proceeding.

---

## Step 2: Visual Read (Main Thread)

Use the **Read tool** on the `.svg` file. Claude Code is multimodal — the SVG renders as an image. Observe:
- Overall layout, composition, and flow direction
- Color coding and visual hierarchy
- Shape types and spatial groupings
- Apparent purpose from visual structure alone

---

## Step 3: Semantic Analysis (Subagent)

If a `.excalidraw` file exists, launch a **general-purpose subagent** with this task prompt:

> Read the Excalidraw file at `<path>.excalidraw` and produce a structured diagram map.
>
> **Schema rules:**
> - `text.containerId` → this text is the label for that shape (pair them)
> - `arrow.startBinding.elementId` → source shape; `endBinding.elementId` → target shape
> - Resolve element IDs to their labels when describing flows
> - `element.groupIds[]` → shared ID means same logical component
> - `element.frameId` → element lives inside this named frame/section
> - `strokeStyle: "dashed"` = optional/async/secondary flow
> - `type: "diamond"` = decision; `type: "ellipse"` = actor/endpoint; `type: "rectangle"` = process/component
> - Free-floating text (no `containerId`) = annotation, section title, or description
>
> **Produce this output (under 2000 chars):**
>
> TITLE: [inferred from prominent text]
> PURPOSE: [one sentence]
>
> NODES:
> - [shape_type] "label" — [role in the system]
>
> FLOWS:
> - "Source" → "Target" [dashed?] [arrow label if any]
>
> GROUPS/SECTIONS:
> - "Section name": [members]
>
> FREE TEXT: [standalone annotations worth noting]
>
> KEY OBSERVATIONS:
> - [Notable patterns, e.g. decision branching, feedback loops, swimlanes]
> - [Visual encoding, e.g. color semantics if apparent from backgroundColor values]
> - [Flow direction and entry/exit points]

---

## Step 4: Synthesize

Combine the visual read (Step 2) with the subagent's semantic map (Step 3). Produce a **diagram context block** inline in the conversation:

```
### Diagram: [filename or inferred title]

**Visual:** [1-2 sentences from SVG perception]

**Purpose:** [what this diagram communicates]

**Components:**
- [type] "label" — role

**Flows:**
- "A" → "B" — what this means
- "B" → "C" [dashed] — optional path

**Groups/Sections:** [if present]

**Implementation insight:** [the key actionable takeaway — what to build, implement, or understand based on this diagram]
```

This block becomes the working context for whatever task follows.

---

## Excalidraw Schema Reference

### Element Types → Semantic Meaning

| Type | Meaning |
|-|-|
| `rectangle` | Component, module, process, action |
| `ellipse` | Actor, entry/exit point, external system |
| `diamond` | Decision, condition, branch |
| `arrow` | Directed flow, dependency, transition |
| `line` | Boundary, non-directional connection |
| `text` (containerId = null) | Annotation, section title, description |
| `text` (containerId set) | Label of the container shape |
| `frame` | Named section, swimlane, or region |

### Key JSON Relationships

| Property | Meaning |
|-|-|
| `text.containerId` | Text is the label for this element |
| `arrow.startBinding.elementId` | Arrow source |
| `arrow.endBinding.elementId` | Arrow target |
| `shape.boundElements[]` | Connected arrows and labels |
| `element.groupIds[]` | Same ID = same logical group |
| `element.frameId` | Inside this named frame |
| `strokeStyle: "dashed"` | Optional / async / secondary |
| `strokeStyle: "dotted"` | Background / annotation-level |

### Label Resolution Algorithm

1. Collect all `text` elements where `containerId != null`
2. For each: the shape with `id == containerId` gets this text as its label
3. Standalone text (`containerId == null`) → free-floating annotation or title
4. Arrow labels: text where `containerId` matches an arrow `id`
5. Shapes with no bound text → use shape type + position as description

### Spatial Layout Heuristics

- Sort shapes by `y` coordinate → reading order top-to-bottom
- Cluster by similar `x` values → columns or swimlanes
- Large `x`/`y` gaps between clusters = distinct sections (even without frames)
- Arrow `points[]` array: first point = near source, last = near target
