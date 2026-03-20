---
name: pencil-design
description: Pencil MCP design workflow with basalt-ui tokens — open .pen files, import CSS variables, build visual references
context: main
agent: general-purpose
---

# Pencil Design Skill

Workflow for designing with Pencil MCP using basalt-ui tokens.

## Token Source of Truth

**Never copy token values into .pen files or skill content.**

Read tokens directly from:
```
/Users/johannes.krumm/SourceRoot/basalt-ui/packages/basalt-ui/src/index.css
```

Key sections in `index.css`:
- `:root` block (lines ~81–392): Foundation palette, semantic tokens, expressive colors, blue variants, chart palette
- `.dark` block (lines ~395–473): Dark mode overrides
- `@theme inline` block (lines ~559–728): Typography scale, spacing, radius, shadows

## Key Tokens (reference index.css for actual values)

**Design philosophy:** OKLCH color space, zinc-based neutrals (dark-1 through dark-4, light-1 through light-4), blue primary accent, expressive semantic colors (red/orange/yellow/green/purple), sequential chart blues (chart-blue-1 through chart-blue-8).

**Semantic surface tokens:** `--background`, `--foreground`, `--card`, `--muted`, `--border`, `--primary`, `--accent`, `--destructive`

**Typography:** `--font-size-display` (64px) down to `--font-size-caption` (12px), `--font-heading` (Instrument Sans Variable), `--font-mono` (JetBrains Mono Variable)

**Spacing scale:** 4px base unit — 0, 1(4px), 2(8px), 3(12px), 4(16px), 6(24px), 8(32px), 12(48px), 16(64px), 32(128px)

**Radius:** `--radius-sm` (4px), `--radius` (8px), `--radius-lg` (10px), `--radius-full` (9999px)

## Pencil MCP Workflow

### 1. Open the design file

```
mcp__pencil__open_document("/Users/johannes.krumm/SourceRoot/basalt-ui/packages/basalt-ui/design/basalt-ui.pen")
```

For a new app file: open a new document at the app's `design/` directory.

### 2. Set variables from CSS

Read `index.css`, then use `set_variables` to import token values as Pencil variables. Map OKLCH values to hex/sRGB for Pencil compatibility (Pencil doesn't render OKLCH natively — convert via browser DevTools or oklch.com).

Example pattern:
```json
{
  "background-light": "#fbfaf9",
  "background-dark": "#1e1e24",
  "primary": "#6f8db0",
  "foreground-light": "#3f3f4f",
  "foreground-dark": "#f0eff4"
}
```

Use theming axes `light` / `dark` so token swaps work via variable themes.

### 3. Build reference frames with batch_design

Get guidelines first:
```
mcp__pencil__get_guidelines("design-system")
```

Reference frame structure for `basalt-ui.pen`:
- **Color Palette** — foundation tones (light-1 to light-4, dark-1 to dark-4), expressive colors (red/orange/yellow/green/purple), blue variants, chart blues
- **Typography Scale** — display through caption, with font families shown
- **Spacing & Radius** — visual ruler for spacing scale, radius examples
- **Shadows** — sm/md/lg/xl shadow examples on cards
- **ShadCN Components** — button (primary/secondary/destructive/ghost), badge, card, input with actual token values applied

### 4. Verify visually

After each major section:
```
mcp__pencil__get_screenshot(nodeId="<frame-id>")
```

Check that colors match the design system intent: warm (not stark) backgrounds, blue primary accent, proper contrast between light/dark surfaces.

## Master Design File

**Path:** `packages/basalt-ui/design/basalt-ui.pen`

This is the living visual reference for all basalt-ui projects. It is NOT a shared Pencil library (Pencil doesn't support cross-file libraries) — it's the canonical starting point.

When creating a new app's design files, open the master file to verify token values, then create a new `.pen` file in the app's `design/` directory.

## Design Conventions

- **OKLCH philosophy:** All colors are perceptually uniform. When adjusting colors, work in OKLCH space (L=lightness, C=chroma, H=hue).
- **Warm, not stark:** Never pure black/white. Use `dark-1` (near-black) and `light-1` (near-white) instead.
- **Zinc-based neutrals:** The hue of dark tones is ~285° (slightly purple-gray), light tones ~270-90° (warm).
- **Restricted scale:** Only defined spacing/font values exist. No arbitrary values.
- **Semantic over literal:** Always use semantic tokens (`--primary`, `--background`) not raw foundation values (`--blue`, `--light-2`) in component designs.
