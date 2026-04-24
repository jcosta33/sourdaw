# Layout Patterns Audit: Flex/Grid Usage Analysis

## Scope

This audit covers all Tailwind CSS flexbox and grid layout patterns across the Sourdaw codebase (`src/**/*.tsx`). The goal is to identify existing layout patterns to inform the design of standardized layout components (`Flex`, `Grid`, `Row`, `Column`, `Stack`, etc.).

**Excludes:**

- One-off utility classes for specific visual effects
- Canvas/WebGL renderer surfaces (they own their own pixels)
- Third-party component library internals

---

## Goal

Establish a set of strict, consistent layout primitives that enforce spacing standards and reduce layout fragmentation across the DAW UI.

---

## Relevant Code Paths

- `src/components/daw/*.tsx` — 60+ DAW-specific UI primitives
- `src/components/ui/*.tsx` — Base UI components (shadcn-based)
- `src/modules/*/presentations/**/*.tsx` — Module-specific views
- `src/helpers/Styles/cn.ts` — Class name merging utility

---

## Current Behavior

### 1. Flexbox Patterns

#### Base Flex Usage

| Pattern               | Count  | Context                              |
| --------------------- | ------ | ------------------------------------ |
| `flex` (base)         | ~1,164 | Universal container base             |
| `flex-col`            | ~391   | Vertical stacking (dominant)         |
| `flex-row`            | ~5     | Explicit horizontal (default is row) |
| `flex-wrap`           | ~122   | Responsive wrapping                  |
| `flex-1` / `flex-[n]` | ~222   | Fluid growth                         |
| `shrink-0`            | ~225   | Fixed-width protection               |

#### Alignment Patterns

| Pattern           | Count | Primary Use                              |
| ----------------- | ----- | ---------------------------------------- |
| `items-center`    | ~657  | Center alignment (overwhelming favorite) |
| `items-start`     | ~45   | Top/left alignment                       |
| `items-end`       | ~29   | Bottom/right alignment                   |
| `justify-center`  | ~164  | Center on main axis                      |
| `justify-between` | ~129  | Space between                            |
| `justify-start`   | ~17   | Pack to start                            |
| `justify-end`     | ~17   | Pack to end                              |

#### Gap/Spacing Patterns

| Pattern        | Count | Notes            |
| -------------- | ----- | ---------------- |
| `gap-1` (4px)  | ~351  | Very common      |
| `gap-2` (8px)  | ~363  | **Most popular** |
| `gap-3` (12px) | ~170  | Section spacing  |
| `gap-4` (16px) | ~38   | Larger sections  |
| `gap-6` (24px) | ~8    | Rare             |
| `gap-x-2`      | ~16   | Horizontal only  |
| `gap-y-3`      | ~14   | Vertical only    |

**Space between (legacy pattern):**
| Pattern | Count | Usage |
|---------|-------|-------|
| `space-y-1` | ~67 | Vertical stack spacing |
| `space-y-2` | ~50 | Medium vertical spacing |
| `space-y-3` | ~34 | Section spacing |

### 2. Grid Patterns

#### Grid Column Configurations

| Pattern       | Count | Use Case                          |
| ------------- | ----- | --------------------------------- |
| `grid-cols-2` | ~59   | Form layouts, knob pairs          |
| `grid-cols-3` | ~23   | Knob rows, parameter groups       |
| `grid-cols-4` | ~15   | Topology selectors, larger groups |
| `grid-cols-1` | ~12   | Mobile/single column              |
| `grid-cols-5` | ~4    | Rare                              |
| `grid-cols-8` | ~1    | Very rare                         |

#### Complex Grid Templates

~23 occurrences using CSS Grid template syntax:

- `grid-cols-[15rem_minmax(0,1fr)_16rem]` — Three-column panel layouts
- `grid-cols-[minmax(0,1fr)_260px]` — Main + sidebar
- `grid-cols-[minmax(0,1fr)_3.75rem]` — Content + meter

### 3. Common Layout Combinations

| Combination                         | Frequency | Use Case                       |
| ----------------------------------- | --------- | ------------------------------ |
| `flex items-center gap-2`           | ~222      | Horizontal control rows        |
| `flex flex-col gap-3`               | ~104      | Vertical sections              |
| `flex items-center justify-between` | Common    | Header/toolbar layouts         |
| `flex items-center justify-center`  | Common    | Centered content               |
| `grid grid-cols-2 gap-2`            | Common    | 2-column parameter grids       |
| `flex flex-col items-center gap-1`  | Common    | Knob groups, centered controls |
| `flex min-h-0 flex-col gap-3`       | Common    | Scrollable panel sections      |

### 4. Panel Layout Architecture

**Standard Three-Column Layout** (seen in instrument panels):

```tsx
<div className="grid h-full min-h-0 grid-cols-[15rem_minmax(0,1fr)_16rem] gap-3">
    <aside className="flex min-h-0 flex-col gap-3">...</aside>
    <section className="flex min-h-0 flex-col gap-3">...</section>
    <aside className="flex min-h-0 flex-col gap-3">...</aside>
</div>
```

**App Shell Layout** (`AppShell.tsx`):

```tsx
<div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-app">
    <TransportBar />
    <div className="flex flex-1 overflow-hidden">
        {/* Left panels */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">{/* Main content */}</div>
        {/* Right panels */}
    </div>
    <StatusBar />
</div>
```

### 5. Existing Layout-Like Components

Components that already encapsulate layout patterns:

| Component              | Location                                      | Layout Provided                          |
| ---------------------- | --------------------------------------------- | ---------------------------------------- |
| `DawPanelSurface`      | `src/components/daw/DawPanelSurface.tsx`      | `flex flex-col` with tone variants       |
| `DawControlStrip`      | `src/components/daw/DawControlStrip.tsx`      | `flex items-center gap-2`                |
| `DawDialogBody`        | `src/components/daw/DawDialogBody.tsx`        | `flex flex-col gap-4`                    |
| `DawDialogFooter`      | `src/components/daw/DawDialogFooter.tsx`      | `flex items-center gap-2` with alignment |
| `DawUtilitySection`    | `src/components/daw/DawUtilitySection.tsx`    | Section with header/body layout          |
| `DawPluginRail`        | `src/components/daw/DawPluginRail.tsx`        | `flex flex-col gap-3` scrollable         |
| `DawPluginSectionCard` | `src/components/daw/DawPluginSectionCard.tsx` | `flex flex-col gap-3`                    |
| `DawMetricCluster`     | `src/components/daw/DawMetricCluster.tsx`     | `flex items-center gap-1`                |
| `DawPluginMetricStrip` | `src/components/daw/DawPluginMetricStrip.tsx` | `flex flex-wrap` with alignment          |

---

## Findings

### Key Observations

1. **Vertical stacking dominates**: `flex-col` is used 78x more than explicit `flex-row`, indicating the UI is primarily organized in vertical sections.

2. **Gap-2 is the sweet spot**: 8px spacing (`gap-2`) is the most common, followed closely by 4px (`gap-1`). This suggests a dense, compact UI appropriate for a DAW.

3. **Items-center is overwhelming**: 93% of alignment uses `items-center`, indicating most layouts vertically center their children.

4. **Space-y-\* is legacy**: The `space-y-*` pattern (67 occurrences) should be replaced with `flex flex-col gap-*` for consistency.

5. **Grid is primarily for forms**: `grid-cols-2` and `grid-cols-3` dominate, used almost exclusively for parameter knob layouts.

6. **Complex grid templates are panel-specific**: The `grid-cols-[...]` syntax is used for high-level panel architecture (sidebar | main | sidebar) and should not be abstracted.

7. **Shrink-0 is critical**: 225 occurrences of `shrink-0` show that fixed-width elements (knobs, buttons) must protect themselves from compression.

8. **Min-h-0 is essential**: Scrollable flex children consistently use `min-h-0` to prevent overflow issues.

---

## Priorities

1. **Create Stack component** — Replace the 104+ occurrences of `flex flex-col gap-3` and 391 total `flex-col` patterns
2. **Create Row component** — Standardize the 222+ occurrences of `flex items-center gap-2`
3. **Create Grid component** — Replace the 59+ `grid-cols-2` parameter layouts
4. **Deprecate space-y-\* usage** — Migrate 67 occurrences to Stack

---

## Open Issues

| #   | Issue                                               | Representative Files                                               | Needed                                            |
| --- | --------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| 1   | Inconsistent gap values across similar layouts      | `GenericDeviceLayout.tsx`, `GlutenPanel.tsx`, `FermenterPanel.tsx` | Standardized spacing scale enforced by components |
| 2   | `space-y-*` pattern mixed with `gap-*`              | `EnvelopeSection.tsx` (line 58)                                    | Migration to consistent gap-based Stack           |
| 3   | Inline flex/grid classes repeated hundreds of times | Entire codebase                                                    | Layout components that encapsulate patterns       |
| 4   | No enforcement of spacing scale                     | —                                                                  | Restricted gap prop values (1, 2, 3, 4, 6, 8)     |
| 5   | Complex grid templates hardcoded                    | `GlutenPanel.tsx` (line 342), `AppShell.tsx`                       | Document as intentional, do not abstract          |

---

## Open Questions

1. **[MINOR]** Should the layout components support `as` polymorphism like `DawPanelSurface`?
2. **[MINOR]** Should gap values be restricted to the design system scale (1,2,3,4,6,8) or allow arbitrary values?
3. **[MINOR]** How should layout components handle the `shrink-0` / `flex-1` pattern for children?

---

## Risks

1. **Migration complexity**: 1,164+ `flex` occurrences need evaluation for migration priority
2. **Bundle size**: Adding new components without tree-shaking could increase bundle
3. **Developer confusion**: Two ways to do layouts during transition period
4. **Breaking changes**: If existing components are modified rather than replaced

---

## Suggested Approaches

1. **Create new components in `src/components/layout/`** — Do not modify existing `daw` components initially
2. **Start with strict prop interfaces** — Restrict gap to valid design tokens only
3. **Document migration path** — Provide before/after examples for common patterns
4. **Use in new code first** — Validate API in new features before widespread migration
5. **Gradual migration** — Tag old patterns with TODO comments during normal development

---

## Recommendation

Start with three core components:

1. **`Stack`** — Vertical flex with configurable gap
2. **`Row`** — Horizontal flex with items-center, configurable gap and justification
3. **`Grid`** — CSS grid with configurable columns and gap

These cover ~80% of layout patterns. Implement in `src/components/layout/` following the patterns established in `src/components/daw/` (cn helper, HTML attributes extension, ref support).

See the companion spec file for detailed component specifications.

---

## Verification notes (2026-04-14)

### Pass 1

| Note               | Detail                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pattern counts** | Tables under **Current Behavior** use approximate `rg`-style counts from an earlier snapshot; re-run searches before using counts in CI or specs. |
| **Scope**          | No code changes in this pass — audit text only.                                                                                                   |

---

## Resolved

_None yet — this is the initial audit._
