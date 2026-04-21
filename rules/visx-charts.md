# Visx Charts — Library Conventions

Applies to any project using [visx](https://airbnb.io/visx) for charting. Keeps charts visually consistent and makes AI contributions predictable. Project-specific primitives/tokens live alongside the project — this file captures the discipline.

## Why visx (and not Recharts)

Visx exposes low-level primitives so we can build exactly the chart we want. The trade-off is that each chart duplicates structure unless we enforce shared building blocks. **Primitives + a small kind-registry is the contract, not optional polish.**

## Every chart has

1. **ChartCard** wrapper — never a raw AntD `<Card>`. Gives title + info-tooltip + extra slot, consistent margin.
2. **ChartLegend** — never hand-rolled legend markup. Supports `line | bar | split | splitLine` shapes and optional highlight state.
3. **ChartTooltip** + `TooltipHeader` + `TooltipRow` + `TooltipBody` — never import `@visx/tooltip` directly.
4. **AxisLeftNumeric** + **AxisBottomDate** — never raw `<AxisLeft>`/`<AxisBottom>` (they miss theme tokens + smart ticks).
5. **HoverOverlay** for mouse capture, **HoverContext** for cross-chart crosshair sync, **useChartTooltip** for tip state.
6. **Theme-aware colors** via `useVxTheme()` (re-renders on toggle) + `VX` tokens. **Never** raw hex literals in chart files. **Never** `localStorage.getItem('theme')`.

**Exemption:** sparklines (tiny inline charts without legend/tooltip) live under `charts/sparklines/` and don't have to compose `ChartCard`/`ChartLegend`/`ChartTooltip` — but still must use VX tokens and `useVxTheme`.

## How to add a new chart

1. **Is it the second instance of an existing pattern?** Extract a kind component into `charts/kinds/` and migrate both call sites. (Rule of Three: don't extract on the first, don't wait past the third.)
2. **Is it genuinely unique (like a dual-panel MACD)?** Stay bespoke — compose the primitives directly. Keep it in the page's chart file, not in `charts/kinds/`.
3. **Does it add a new semantic color / shape / sizing?** Add it to `tokens.ts` (`VX`), not inline.

## Tokens (`tokens.ts`)

Two concerns, separated:

- **Semantic palette** (`good / bad / warn / goodSolid / badSolid / grid / crosshair / …`) — theme-agnostic, used directly.
- **Per-metric series colors** (`VX.series.hrv`, `.restingHr`, …) — also theme-agnostic, give each metric a stable identity.
- **Theme-dependent neutrals** (line, axis, tooltip bg/text) — accessed via `useVxTheme()` which reads `ThemeContext`.

Per-theme pairs live on `VX` as `fooDark`/`fooLight`; `useVxTheme` resolves. Consumers **only** consume the resolved hook.

## Kind components

A "kind" is a recurring chart shape reusable across datasets. Props are declarative; bespoke escape hatches (`renderExtraTooltipRows`, etc.) are fine but shouldn't grow into god-object configs.

**Characteristic props of a good kind:**
- `data`, `width`, `height`, `chartId`
- `getX`, `getY` accessors (generic over point type)
- Zones / thresholds / refLines as plain arrays
- `seriesLabel`, `formatValue`, `tooltipLabel?`
- No `children` render-prop unless you genuinely need it — config-first.

**Anti-pattern:** a single `<Chart type="..." config={...} />` component that switches by kind. That's the Recharts trap. Prefer N small kinds.

## Dark/light mode

Theme reactivity is a `ThemeContext` — toggling updates charts live. `useVxTheme()` is the only correct way to read it. Palette entries that don't change between themes (semantic good/bad, series colors) live directly on `VX`.

## Guardrails

- `no-restricted-imports` bans `@visx/tooltip` in chart files (enforce in lint config).
- Raw hex literals in chart files should be caught by review — oxlint doesn't support `no-restricted-syntax`, but once a rule exists in markdown and the primitives are ergonomic, the violation should look weird in diff.
- `ChartCard`/`ChartLegend`/`ChartTooltip` contract is social/markdown-enforced. It's easier to compose them than work around them.

## Rule of thumb

> If the new chart doesn't fit the primitives, add a kind — don't loosen the primitives.
