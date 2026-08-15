# src/components — Agent Guidelines

Shared UI design system. Three families:

- **`ui/`** — shadcn/Radix primitives ("new-york" style, neutral base, lucide icons; `components.json`).
- **`layout/`** — `Grid`, `Row`, `Stack`, `Spacer`, `Divider` (+ barrel `index.ts`).
- **`daw/`** — DAW-specific controls (faders, knobs, LEDs, value fields, the `Daw*` panel/meter/plugin-card family) and `visualizers/` — canvas-drawn DSP-curve displays.

## Hard rules (deps **error**)

- No **direct** business-store or use-case imports, and no **transitive** reach of use cases. Data arrives via props/hooks; parent views wire stores.
- Keep components presentation-pure — domain logic belongs in the owning module.

## Conventions

- Class merging via `cn()` (`src/utils/Styles/cn.ts` — clsx + tailwind-merge).
- Per-device stylesheets live in `src/styles/utilities/modules/*.css` (one per styled device) — not beside components.
- Every component has a colocated `__tests__/` spec; keep it that way.
- Generated shadcn components belong under `ui/`; `components.json` aliases resolve there and to `src/utils`.
