# Layout Components Specification

## Context

The Sourdaw codebase currently has 1,164+ inline flex declarations and 391+ `flex-col` patterns scattered across the UI. This creates:

- Inconsistent spacing (developers choose arbitrary gap values)
- Duplicated layout code (same 3-4 class combinations repeated everywhere)
- Difficulty maintaining the design system (no single source of truth for spacing)

This spec defines strict layout primitives that enforce the established spacing scale from the audit.

See: `.agents/audits/layout-components/flex-grid-patterns-audit.md`

---

## Goal

Provide a minimal set of layout components (`Stack`, `Row`, `Grid`) that:
1. Enforce the design system spacing scale (1, 2, 3, 4, 6, 8)
2. Cover 80%+ of current layout patterns
3. Are type-safe with strict prop interfaces
4. Follow existing component patterns in `src/components/daw/`

---

## User-Visible Behavior

**For developers:** Instead of writing:
```tsx
<div className="flex flex-col gap-3">
```

They write:
```tsx
<Stack gap={3}>
```

**Constraints enforced:**
- Only valid spacing tokens accepted (no arbitrary values)
- Common alignments available as typed props
- `ref` forwarding supported for all components

---

## Scope

**In scope:**

- `Stack` — Vertical flex container
- `Row` — Horizontal flex container (items-center by default)
- `Grid` — CSS grid container
- `Spacer` — Fixed-size spacing element
- `Divider` — Visual separator with optional spacing

**Non-goals:**

- Complex grid template abstraction (keep inline for panel layouts)
- Responsive breakpoint variants (not needed per codebase analysis)
- Layout animation primitives (out of scope)
- Replacing all existing components immediately (gradual migration)

---

## Requirements

### 1. Stack Component

**Requirement:** Provide vertical stacking with configurable gap.

**Props:**
- `gap?: 0 | 1 | 2 | 3 | 4 | 6 | 8` — Default: 0
- `align?: 'start' | 'center' | 'end' | 'stretch'` — Maps to `items-*`
- `justify?: 'start' | 'center' | 'end' | 'between'` — Maps to `justify-content`
- `grow?: boolean` — Adds `flex-1`
- `shrink?: boolean` — Adds `shrink-0` when false
- `wrap?: boolean` — Adds `flex-wrap`
- `as?: 'div' | 'section' | 'article' | 'aside' | 'header' | 'footer' | 'main' | 'nav'`

**CSS output for `<Stack gap={2} align="center">`:**
```css
/* Default base classes always applied */
display: flex;
flex-direction: column;
min-height: 0; /* Critical for scrollable containers */

/* Conditional based on props */
gap: 0.5rem; /* gap-2 */
align-items: center; /* items-center */
```

**Usage examples:**
```tsx
// Basic vertical section
<Stack gap={3}>
  <Header />
  <Content />
  <Footer />
</Stack>

// Centered knob group
<Stack gap={1} align="center">
  <RotaryKnob />
  <Label />
  <Value />
</Stack>

// Scrollable panel section
<Stack gap={3} grow className="overflow-y-auto">
  {items.map(...)}
</Stack>
```

### 2. Row Component

**Requirement:** Provide horizontal arrangement with items-center default.

**Props:**
- `gap?: 0 | 1 | 2 | 3 | 4 | 6 | 8` — Default: 0
- `align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'` — Default: 'center'
- `justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'` — Default: 'start'
- `grow?: boolean` — Adds `flex-1`
- `shrink?: boolean` — Adds `shrink-0` when false
- `wrap?: boolean` — Adds `flex-wrap`
- `as?: 'div' | 'span'`

**CSS output for `<Row gap={2}>`:**
```css
display: flex;
flex-direction: row;
align-items: center; /* Default, unlike Stack */
gap: 0.5rem;
```

**Usage examples:**
```tsx
// Control strip (replaces DawControlStrip pattern)
<Row gap={2} className="px-2 py-1">
  <Button />
  <Slider />
  <Value />
</Row>

// Header with actions
<Row justify="between">
  <Title />
  <Row gap={2}>
    <Action1 />
    <Action2 />
  </Row>
</Row>

// Metric cluster
<Row gap={1}>
  <Label />
  <Meter />
  <Value />
</Row>
```

### 3. Grid Component

**Requirement:** Provide CSS grid with typed column configurations.

**Props:**
- `cols?: 1 | 2 | 3 | 4 | 5 | 6 | 'none'` — Maps to `grid-cols-*`
- `gap?: 0 | 1 | 2 | 3 | 4 | 6 | 8` — Applies to both x and y
- `gapX?: 0 | 1 | 2 | 3 | 4 | 6 | 8` — Horizontal gap only
- `gapY?: 0 | 1 | 2 | 3 | 4 | 6 | 8` — Vertical gap only
- `flow?: 'row' | 'col'` — Maps to `grid-flow-*`
- `as?: 'div' | 'section'`

**CSS output for `<Grid cols={3} gap={2}>`:**
```css
display: grid;
grid-template-columns: repeat(3, minmax(0, 1fr));
gap: 0.5rem;
```

**Usage examples:**
```tsx
// Knob grid (replaces most grid-cols-2/3 usage)
<Grid cols={3} gap={2}>
  <Knob label="Attack" />
  <Knob label="Decay" />
  <Knob label="Sustain" />
  <Knob label="Release" />
</Grid>

// Form layout
<Grid cols={2} gap={3}>
  <Input label="Name" />
  <Input label="Type" />
  <Input label="Value" className="col-span-2" />
</Grid>
```

### 4. Spacer Component

**Requirement:** Provide fixed-size spacing without using margin.

**Props:**
- `size: 1 | 2 | 3 | 4 | 6 | 8 | 12 | 16` — Size in spacing units
- `axis?: 'x' | 'y'` — Direction (default: both)

**Usage examples:**
```tsx
<Row>
  <Button>Cancel</Button>
  <Spacer size={2} axis="x" />
  <Button variant="primary">Save</Button>
</Row>
```

### 5. Divider Component

**Requirement:** Visual separator with optional surrounding space.

**Props:**
- `spacing?: 0 | 2 | 3 | 4` — Space before and after divider
- `tone?: 'subtle' | 'default' | 'strong'` — Opacity variant
- `axis?: 'x' | 'y'` — Vertical or horizontal divider

**Usage examples:**
```tsx
<Stack gap={3}>
  <SectionA />
  <Divider spacing={3} />
  <SectionB />
</Stack>
```

---

## Constraints

1. **Spacing scale restriction:** Gap/size props only accept `0 | 1 | 2 | 3 | 4 | 6 | 8` (matching Tailwind's spacing scale)
2. **No arbitrary values:** No `gap="12px"` or `gap={20}` — forces design system adherence
3. **Ref support:** All components must forward refs using `React.ref` (React 19 pattern)
4. **HTML attributes:** Components extend native HTML attributes of their `as` element
5. **cn helper:** Use existing `cn()` from `#/helpers/Styles/cn` for class merging
6. **No forwardRef:** Use `ref` as a regular prop (React 19)
7. **Single file per component:** Follow `src/components/daw/` pattern

---

## Design Decisions

### Decision: Gap values restricted to design tokens

**Chosen:** Only accept `0 | 1 | 2 | 3 | 4 | 6 | 8`

**Considered and rejected:**
- Arbitrary numeric values — rejected because it defeats the purpose of design system enforcement
- String values like `'sm' | 'md' | 'lg'` — rejected because Tailwind's numeric scale is already known by the team

### Decision: Row defaults to items-center, Stack defaults to stretch

**Chosen:** Different defaults based on common usage patterns from audit

**Rationale:**
- Audit shows 657 occurrences of `items-center` in row-like layouts
- Vertical stacks typically need `align-items: stretch` for full-width children
- This reduces prop noise for the most common cases

### Decision: No polymorphic `as` prop beyond predefined elements

**Chosen:** Limit `as` to specific HTML elements per component

**Rationale:**
- Prevents misuse (e.g., `<Stack as="span">` which would be invalid)
- Keeps types simpler and faster
- Covers 99% of use cases

### Decision: No responsive breakpoint props

**Chosen:** No `gapMd`, `colsMd`, etc.

**Rationale:**
- Audit found minimal responsive layout usage (DAW is desktop-only)
- Complex responsive needs can use inline classes
- Keeps API surface minimal

---

## Acceptance Criteria

- [ ] All five components (`Stack`, `Row`, `Grid`, `Spacer`, `Divider`) implemented in `src/components/layout/`
- [ ] Each component has corresponding test file in `src/components/layout/__tests__/`
- [ ] TypeScript strictly enforces valid gap/size values (compile error for invalid values)
- [ ] All components forward refs correctly
- [ ] Components render with correct Tailwind classes (verified via snapshot or DOM inspection)
- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm lint` passes with zero errors
- [ ] Components can replace 80%+ of audited patterns (verified by migration examples)

---

## Implementation Notes

### File Structure
```
src/components/layout/
├── Stack.tsx
├── Row.tsx
├── Grid.tsx
├── Spacer.tsx
├── Divider.tsx
├── index.ts        # Barrel export
└── __tests__/
    ├── Stack.spec.tsx
    ├── Row.spec.tsx
    ├── Grid.spec.tsx
    ├── Spacer.spec.tsx
    └── Divider.spec.tsx
```

### Implementation Pattern

Follow the established pattern from `src/components/daw/`:

```tsx
// Stack.tsx
import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cn } from '#/helpers/Styles/cn';

type StackElement = 'div' | 'section' | 'article' | 'aside' | 'header' | 'footer' | 'main' | 'nav';

type GapValue = 0 | 1 | 2 | 3 | 4 | 6 | 8;
type AlignValue = 'start' | 'center' | 'end' | 'stretch';
type JustifyValue = 'start' | 'center' | 'end' | 'between';

type StackProps<T extends StackElement = 'div'> = Omit<HTMLAttributes<T>, 'as'> & {
  as?: T;
  gap?: GapValue;
  align?: AlignValue;
  justify?: JustifyValue;
  grow?: boolean;
  shrink?: boolean;
  wrap?: boolean;
  children: ReactNode;
};

const GAP_CLASS_NAMES: Record<GapValue, string> = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  6: 'gap-6',
  8: 'gap-8',
};

const ALIGN_CLASS_NAMES: Record<AlignValue, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

const JUSTIFY_CLASS_NAMES: Record<JustifyValue, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
};

export const Stack = <T extends StackElement = 'div'>({
  as,
  gap = 0,
  align = 'stretch',
  justify = 'start',
  grow = false,
  shrink = true,
  wrap = false,
  className,
  children,
  ...props
}: StackProps<T>): ReactElement => {
  const Component = as ?? 'div';
  return (
    <Component
      className={cn(
        'flex flex-col min-h-0',
        GAP_CLASS_NAMES[gap],
        ALIGN_CLASS_NAMES[align],
        JUSTIFY_CLASS_NAMES[justify],
        grow && 'flex-1',
        !shrink && 'shrink-0',
        wrap && 'flex-wrap',
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
};
```

### Testing Pattern

```tsx
// __tests__/Stack.spec.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stack } from '../Stack';

describe('Stack', () => {
  it('renders with default classes', () => {
    render(<Stack data-testid="stack">Content</Stack>);
    const element = screen.getByTestId('stack');
    expect(element).toHaveClass('flex', 'flex-col', 'min-h-0');
  });

  it('applies gap class', () => {
    render(<Stack gap={2} data-testid="stack">Content</Stack>);
    expect(screen.getByTestId('stack')).toHaveClass('gap-2');
  });

  it('renders as different element', () => {
    render(<Stack as="section" data-testid="stack">Content</Stack>);
    expect(screen.getByTestId('stack').tagName).toBe('SECTION');
  });

  it('forwards ref', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<Stack ref={ref}>Content</Stack>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
```

### Migration Examples

| Before | After |
|--------|-------|
| `<div className="flex flex-col gap-3">` | `<Stack gap={3}>` |
| `<div className="flex flex-col items-center gap-1">` | `<Stack gap={1} align="center">` |
| `<div className="flex items-center gap-2">` | `<Row gap={2}>` |
| `<div className="flex items-center justify-between">` | `<Row justify="between">` |
| `<div className="grid grid-cols-3 gap-2">` | `<Grid cols={3} gap={2}>` |
| `<div className="space-y-2">` | `<Stack gap={2}>` |

---

## Test Plan

### Manual verification
1. Render each component with all prop combinations
2. Verify correct Tailwind classes in DevTools
3. Verify TypeScript errors for invalid prop values

### Automated tests
1. Unit tests for each component covering:
   - Default rendering
   - Each prop variation
   - ref forwarding
   - className merging
   - `as` prop polymorphism

2. Integration: Replace one existing component's layout (e.g., `DawControlStrip`) and verify no visual regression

---

## Open Questions

1. **[MINOR]** Should we export individual components or require `import { Stack } from '#/components/layout'` via barrel?
   - *Recommendation:* Barrel export for consistency with other component folders

2. **[MINOR]** Should we add a `Inline` component for `flex-wrap` inline layouts?
   - *Recommendation:* Defer until needed (can use `Row wrap>` initially)

3. **[MINOR]** Should `Grid` support `colSpan` helper props on children?
   - *Recommendation:* No, use standard Tailwind `className="col-span-2"` on children

---

## Tradeoffs and Risks

### Tradeoffs

| Approach | Pros | Cons |
|----------|------|------|
| Strict gap typing | Design system enforcement | Occasionally need inline class for special cases |
| Separate Row/Stack | Clear intent, optimized defaults | Two components instead of one Flex |
| No responsive props | Simple API | Occasional inline class needed |

### Risks

1. **Migration effort**: 1,164+ flex occurrences to evaluate
   - Mitigation: Gradual adoption, no forced migration deadline

2. **Developer resistance**: Some may prefer inline classes
   - Mitigation: Document benefits, enforce via code review

3. **Bundle size**: New components add code
   - Mitigation: Tree-shakeable exports, minimal runtime

4. **Breaking changes if API changes**: Strict now may need loosening later
   - Mitigation: Start strict, document API evolution process
