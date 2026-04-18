# Layout Components Migration Spec

## Context

New layout components (`Stack`, `Row`, `Grid`, `Spacer`, `Divider`) have been created in `src/components/layout/`. These enforce strict spacing tokens and replace the 1,164+ inline flex/grid patterns scattered across the codebase.

This spec guides the systematic migration from inline Tailwind classes to the new layout primitives.

**Prerequisites:**
- Audit: `.agents/audits/layout-components/flex-grid-patterns.md`
- Components: `src/components/layout/*.tsx`

---

## Goal

Migrate 80%+ of qualifying inline flex/grid patterns to the new layout components while maintaining visual parity and passing all existing tests.

---

## User-visible behavior

The migration is **invariant** — end users must see zero visual or interaction changes. The observable invariants:

- Every migrated surface renders pixel-identical (within AA subpixel rendering tolerance) to its pre-migration state in Chromium.
- Hover, focus, keyboard, and scroll behavior are unchanged.
- No layout thrash or reflow regressions; frame time under load does not regress.

## Constraints

- Follow the existing `Stack / Row / Grid / Spacer / Divider` API — do not invent new props or extend the primitive during migration.
- No `useMemo`, `useCallback`, `React.memo`, or `forwardRef` (React 19 + React Compiler).
- Never regress `pnpm deps:validate` or `pnpm typecheck`.
- Manual edits only — no codemods or automated bulk-rewrite scripts (`AGENTS.md`).

## Design decisions

- **Decision:** A primitive match must preserve gap *and* direction semantics. When an inline class is ambiguous (e.g., `flex gap-2` without `flex-col`), it is treated as a `Row` unless the surrounding context clearly implies a column.
- **Decision:** Migrate by file group, not by class pattern, to amortize review cost and keep visual regressions local.
- **Decision:** Ad-hoc patterns outside the primitive's vocabulary (e.g., custom grids with `auto-cols-min`) are left in place; the 80% target explicitly excludes them.

## Test plan

- After each file migration batch: run the full test suite (`pnpm test`) and visual-regression snapshots for the affected surfaces.
- Run `pnpm deps:validate` per every 10 files touched (`AGENTS.md` reflex rule).
- Manual spot checks on the high-traffic surfaces listed under "Priority Migration Files" before declaring the migration shippable.

---

## Scope

### In Scope

1. **Stack migrations** — Replace `flex flex-col gap-*` patterns
2. **Row migrations** — Replace `flex items-center gap-*` patterns  
3. **Grid migrations** — Replace `grid grid-cols-* gap-*` patterns
4. **Space-y migrations** — Replace `space-y-*` with Stack
5. **Spacer migrations** — Replace ad-hoc spacing divs
6. **Divider migrations** — Replace visual separator patterns

### Out of Scope (DO NOT MIGRATE)

1. **Complex grid templates** — `grid-cols-[15rem_minmax(0,1fr)_16rem]` (panel layouts)
2. **Canvas/WebGL surfaces** — Renderer components own their pixels
3. **Third-party component internals** — Don't modify library code
4. **Dynamic class construction** — Classes built via `cn()` with complex conditionals
5. **Responsive breakpoint patterns** — No responsive props in new components

---

## Migration Patterns

### Stack Migrations

#### Pattern 1: Basic vertical stack
```tsx
// BEFORE:
<div className="flex flex-col gap-3">
  <Item />
  <Item />
</div>

// AFTER:
<Stack gap={3}>
  <Item />
  <Item />
</Stack>
```

#### Pattern 2: Centered vertical stack (knob groups)
```tsx
// BEFORE:
<div className="flex flex-col items-center gap-1">
  <RotaryKnob />
  <Label />
</div>

// AFTER:
<Stack gap={1} align="center">
  <RotaryKnob />
  <Label />
</Stack>
```

#### Pattern 3: Scrollable panel section
```tsx
// BEFORE:
<div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
  {items.map(...)}
</div>

// AFTER:
<Stack gap={3} className="overflow-y-auto">
  {items.map(...)}
</Stack>
```
**Note:** `min-h-0` is included by default in Stack.

#### Pattern 4: Space-y replacement
```tsx
// BEFORE:
<div className="space-y-2">
  <Item />
  <Item />
</div>

// AFTER:
<Stack gap={2}>
  <Item />
  <Item />
</Stack>
```

#### Pattern 5: Grow/shrink patterns
```tsx
// BEFORE:
<div className="flex flex-1 flex-col gap-3">
  <Content />
</div>

// AFTER:
<Stack gap={3} grow>
  <Content />
</Stack>
```

#### Pattern 6: Shrink-0 protection
```tsx
// BEFORE:
<div className="flex shrink-0 flex-col gap-2">
  <FixedContent />
</div>

// AFTER:
<Stack gap={2} shrink={false}>
  <FixedContent />
</Stack>
```

---

### Row Migrations

#### Pattern 1: Basic horizontal row
```tsx
// BEFORE:
<div className="flex items-center gap-2">
  <Button />
  <Input />
</div>

// AFTER:
<Row gap={2}>
  <Button />
  <Input />
</Row>
```

#### Pattern 2: Space-between header
```tsx
// BEFORE:
<div className="flex items-center justify-between">
  <Title />
  <Actions />
</div>

// AFTER:
<Row justify="between">
  <Title />
  <Actions />
</Row>
```

#### Pattern 3: Control strip (DawControlStrip pattern)
```tsx
// BEFORE:
<div className="daw-control-strip flex min-w-0 shrink-0 items-center gap-2 px-2 py-1">
  {children}
</div>

// AFTER:
<Row gap={2} shrink={false} className="daw-control-strip px-2 py-1">
  {children}
</Row>
```
**Note:** Keep existing `daw-control-strip` class for styling hooks.

#### Pattern 4: Justify center
```tsx
// BEFORE:
<div className="flex items-center justify-center">
  <Spinner />
</div>

// AFTER:
<Row justify="center">
  <Spinner />
</Row>
```

#### Pattern 5: Wrap patterns
```tsx
// BEFORE:
<div className="flex flex-wrap items-center gap-2">
  {chips.map(...)}
</div>

// AFTER:
<Row wrap gap={2}>
  {chips.map(...)}
</Row>
```

#### Pattern 6: Non-centered alignment
```tsx
// BEFORE:
<div className="flex items-start gap-3">
  <TopAligned />
</div>

// AFTER:
<Row gap={3} align="start">
  <TopAligned />
</Row>
```

---

### Grid Migrations

#### Pattern 1: 2-column grid
```tsx
// BEFORE:
<div className="grid grid-cols-2 gap-2">
  <Knob />
  <Knob />
</div>

// AFTER:
<Grid cols={2} gap={2}>
  <Knob />
  <Knob />
</Grid>
```

#### Pattern 2: 3-column parameter grid
```tsx
// BEFORE:
<div className="grid grid-cols-3 gap-x-2 gap-y-3">
  {params.map(...)}
</div>

// AFTER:
<Grid cols={3} gapX={2} gapY={3}>
  {params.map(...)}
</Grid>
```

#### Pattern 3: Nested in flex container
```tsx
// BEFORE:
<div className="flex flex-col gap-3">
  <div className="grid grid-cols-4 gap-2">
    {items.map(...)}
  </div>
</div>

// AFTER:
<Stack gap={3}>
  <Grid cols={4} gap={2}>
    {items.map(...)}
  </Grid>
</Stack>
```

---

### Spacer Migrations

#### Pattern 1: Horizontal spacing in Row
```tsx
// BEFORE:
<Row gap={2}>
  <Button>Cancel</Button>
  <div className="w-2" />  {/* or similar */}
  <Button variant="primary">Save</Button>
</Row>

// AFTER:
<Row gap={2}>
  <Button>Cancel</Button>
  <Spacer size={2} axis="x" />
  <Button variant="primary">Save</Button>
</Row>
```

#### Pattern 2: Vertical spacing in Stack
```tsx
// BEFORE:
<Stack gap={2}>
  <Section />
  <div className="h-4" />
  <Section />
</Stack>

// AFTER:
<Stack gap={2}>
  <Section />
  <Spacer size={4} axis="y" />
  <Section />
</Stack>
```

---

### Divider Migrations

#### Pattern 1: Horizontal divider
```tsx
// BEFORE:
<Stack gap={3}>
  <SectionA />
  <div className="h-px w-full bg-border/40" />
  <SectionB />
</Stack>

// AFTER:
<Stack gap={3}>
  <SectionA />
  <Divider spacing={3} />
  <SectionB />
</Stack>
```

#### Pattern 2: Vertical divider
```tsx
// BEFORE:
<Row gap={2}>
  <Content />
  <div className="h-full w-px bg-border/40" />
  <Sidebar />
</Row>

// AFTER:
<Row gap={2}>
  <Content />
  <Divider axis="y" />
  <Sidebar />
</Row>
```

#### Pattern 3: Subtle divider
```tsx
// BEFORE:
<div className="h-px w-full bg-border/20" />

// AFTER:
<Divider tone="subtle" />
```

---

## Priority Migration Files

Based on audit frequency, migrate these high-impact patterns first:

### Tier 1: Highest Impact (gap-2, items-center patterns)
- `src/components/daw/DawControlStrip.tsx` — Iconic pattern, 222+ similar usages
- `src/components/daw/DawDialogFooter.tsx` — Uses `flex items-center gap-2`
- `src/components/daw/DawMetricCluster.tsx` — Uses `flex items-center gap-1`
- `src/components/daw/DawPluginMetricStrip.tsx` — Uses `flex flex-wrap`

### Tier 2: High Impact (flex-col gap-3 patterns)
- `src/modules/Fermenter/presentations/components/EnvelopeSection.tsx` — Uses `space-y-2`
- `src/modules/Gluten/presentations/views/GlutenPanel.tsx` — Multiple grid patterns
- `src/modules/Workspace/presentations/views/Inspector/GenericDeviceLayout.tsx` — Grid patterns

### Tier 3: Medium Impact (Grid patterns)
- Any file with `grid-cols-2` or `grid-cols-3` in parameter/knob layouts
- Files with `grid-cols-4` for topology selectors

---

## Migration Process

### For Each File:

1. **Identify patterns** — Search for qualifying patterns in the file
2. **Import components** — Add to imports:
   ```tsx
   import { Stack, Row, Grid } from '#/components/layout';
   ```
3. **Migrate one pattern at a time** — Don't batch too many changes
4. **Verify visually** — Run dev server, check the UI
5. **Run tests** — `pnpm vitest run src/path/to/file.spec.tsx`
6. **Commit** — Small, focused commits

### Validation Checklist Per Migration:

- [ ] Visual appearance unchanged
- [ ] No TypeScript errors (`pnpm typecheck`)
- [ ] Tests pass (`pnpm test src/path`)
- [ ] `pnpm deps:validate` passes (check for import issues)

---

## Common Pitfalls

### Pitfall 1: Removing needed classes
```tsx
// WRONG:
<Stack gap={2}>  {/* Missing 'grow' */}
  <Content />
</Stack>

// CORRECT:
<Stack gap={2} grow>  {/* Preserved flex-1 behavior */}
  <Content />
</Stack>
```

### Pitfall 2: Wrong default alignment
```tsx
// BEFORE:
<div className="flex flex-col gap-2">  {/* stretch by default */}

// WRONG (changes behavior):
<Stack gap={2}>  {/* stretch — correct */}

// BUT for Row:
// BEFORE:
<div className="flex items-start gap-2">

// WRONG (uses wrong default):
<Row gap={2}>  {/* center — incorrect! */}

// CORRECT:
<Row gap={2} align="start">
```

### Pitfall 3: Conditional classes
```tsx
// DON'T MIGRATE — too complex:
<div className={cn(
  'flex gap-2',
  isVertical ? 'flex-col' : 'flex-row',
  condition && 'items-center'
)}>

// KEEP AS-IS or refactor logic first
```

### Pitfall 4: Missing data attributes or refs
```tsx
// BEFORE:
<div ref={containerRef} data-track-id={id} className="flex flex-col gap-2">

// WRONG:
<Stack gap={2}>  {/* Lost ref and data attribute! */}

// CORRECT:
<Stack ref={containerRef} data-track-id={id} gap={2}>
```

### Pitfall 5: Complex grid templates
```tsx
// DON'T MIGRATE:
<div className="grid grid-cols-[15rem_minmax(0,1fr)_16rem] gap-3">
  
// KEEP AS-IS — this is panel architecture, not component layout
```

### Pitfall 6: Inline styles interaction
```tsx
// BEFORE:
<div className="flex flex-col gap-2" style={{ height: computedHeight }}>

// CORRECT:
<Stack gap={2} style={{ height: computedHeight }}>
  {/* HTML attributes still work */}
</Stack>
```

---

## Edge Cases

### Edge Case 1: Component wrapping with extra classes
```tsx
// BEFORE:
<div className="flex flex-col gap-2 custom-layout-class">

// AFTER:
<Stack gap={2} className="custom-layout-class">
```

### Edge Case 2: Event handlers
```tsx
// BEFORE:
<div onClick={handleClick} className="flex flex-col gap-2">

// AFTER:
<Stack gap={2} onClick={handleClick}>
```

### Edge Case 3: Ref forwarding
```tsx
// BEFORE:
<div ref={ref} className="flex flex-col gap-2">

// AFTER:
<Stack ref={ref} gap={2}>
```

### Edge Case 4: Polymorphic 'as' prop
```tsx
// BEFORE:
<section className="flex flex-col gap-3">

// AFTER:
<Stack as="section" gap={3}>
```

---

## Acceptance Criteria

- [ ] All Tier 1 files migrated
- [ ] At least 50% of qualifying patterns migrated across codebase
- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm deps:validate` passes with zero violations
- [ ] All existing tests pass
- [ ] No visual regressions in migrated components (verified manually)

---

## Implementation Notes

### Search Regex for Finding Patterns

Use these regex patterns to find migration candidates:

```regex
# Stack candidates
className="[^"]*flex flex-col gap-\d[^"]*"
className="[^"]*space-y-\d[^"]*"

# Row candidates  
className="[^"]*flex items-center gap-\d[^"]*"
className="[^"]*flex items-center justify-between[^"]*"

# Grid candidates
className="[^"]*grid grid-cols-\d gap-\d[^"]*"

# Exclude patterns (don't migrate)
className="[^"]*grid-cols-\[[^"]*"  # Complex templates
className="[^"]*flex-\d[^"]*"        # Dynamic flex values
```

### Migration Order Recommendation

1. Start with `DawControlStrip.tsx` — simplest, well-tested
2. Migrate `DawDialogFooter.tsx` — uses alignment variants
3. Pick one panel file (e.g., `EnvelopeSection.tsx`) for vertical patterns
4. Pick one grid-heavy file (e.g., `GlutenPanel.tsx`) for grid patterns
5. Batch process remaining files by pattern type

### Verification Command

```bash
# After each file migration:
pnpm typecheck && pnpm vitest run src/path/to/file.spec.tsx

# Periodic full validation:
pnpm deps:validate
```

---

## Open Questions

1. **[MINOR]** Should we migrate `space-x-*` patterns (horizontal space between)?
   - *Recommendation:* Yes, use `Row gap={N}`

2. **[MINOR]** Should we keep semantic class names like `daw-control-strip`?
   - *Recommendation:* Yes, add them via `className` prop for styling hooks

3. **[MINOR]** How to handle deeply nested conditionals?
   - *Recommendation:* Don't migrate if more than 2 conditions affect layout classes

---

## Tradeoffs and Risks

| Risk | Mitigation |
|------|------------|
| Visual regression | Migrate one pattern at a time, verify in browser |
| Bundle size increase | Components are tree-shakeable, minimal runtime |
| Breaking existing code | Strict typing prevents invalid prop values |
| Migration fatigue | Focus on high-impact patterns first (Tier 1) |
| Mixed patterns during transition | Document in code comments: `// TODO: migrate to Stack` |

---

## Implementation Status

- **What is implemented:** Core layout primitives (`Stack`, `Row`, `Grid`, `Spacer`, `Divider`) are fully implemented in `src/components/layout/` with a robust API supporting gap, align, justify, and other flex/grid properties.
- **What is not implemented:** Moved to `.agents/specs/missing/spec-of-the-gaps.md`.
- **What is done well:** The primitive components are well-typed and provide a clean, consistent way to handle layout that abstracts away repetitive Tailwind classes.
- **What needs refactoring:** Moved to `.agents/specs/missing/spec-of-the-gaps.md`.
