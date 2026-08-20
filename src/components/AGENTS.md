# src/components — Agent Guidelines

Shared UI design system. `ui/` holds shadcn/Radix primitives ("new-york" style, neutral base,
lucide icons; `components.json`), `layout/` holds layout primitives behind a barrel `index.ts`, and
`daw/` holds DAW-specific controls plus the canvas-drawn DSP-curve displays under `visualizers/`.

## Hard rules (deps **error**)

- No business-store or use-case import, **direct or transitive**. Data arrives via props and hooks;
  parent views wire the stores.
- Components stay presentation-pure. Domain logic belongs to the owning module.

## Conventions

- Merge classes with `cn()` (`src/utils/Styles/cn.ts` — clsx + tailwind-merge).
- A device's stylesheet lives in `src/styles/utilities/modules/*.css`, one per styled device, never
  beside the component.
- Colocate every component's spec in its `__tests__/`.
- Generated shadcn components go under `ui/`; `components.json` aliases resolve there and to
  `src/utils`.
