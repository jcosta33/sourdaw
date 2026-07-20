# src/components — Agent Guidelines

Shared UI design system. Three families:

- **`ui/`** — shadcn/Radix primitives ("new-york" style, neutral base, lucide icons; `components.json`).
- **`layout/`** — `Grid`, `Row`, `Stack`, `Spacer`, `Divider` (+ barrel `index.ts`).
- **`daw/`** — ~60 DAW-specific components (`Fader`, `RotaryKnob`, `LED`, `LatchButton`, `ValueField`, the `Daw*` panel/meter/plugin-card family) and `visualizers/` — 8 DSP-curve canvases (`EQCurve`, `CompressorCurve`, `FilterResponse`, `ADSREnvelope`, `DistortionCurve`, `DelayTaps`, `OscillatorWaveform`, `ReverbDecay`).

## Hard rules (deps **error**)

- No **direct** business-store or use-case imports, and no **transitive** reach of use cases. Data arrives via props/hooks; parent views wire stores.
- Keep components presentation-pure — domain logic belongs in the owning module.

## Conventions

- Class merging via `cn()` (`src/utils/Styles/cn.ts` — clsx + tailwind-merge).
- Per-device stylesheets live in `src/styles/utilities/modules/*.css` (one per styled device — 11 today) — not beside components.
- Every component has a colocated `__tests__/` spec; keep it that way.
- Known drift: `components.json` shadcn aliases still point at legacy `#/helpers` paths — `src/helpers/` is nearly empty. Don't follow those aliases when generating new shadcn components; place them under `ui/`.
