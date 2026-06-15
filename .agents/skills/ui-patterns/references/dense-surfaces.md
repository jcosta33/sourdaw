# Dense editor surfaces

Detailed renderer-surface rules referenced from `ui-patterns/SKILL.md` rule 2 ("React owns
layout; renderer surfaces own pixels") and rule 9 ("Writes go through explicit actions, even
from renderers"). Use Canvas/WebGL/WebGPU-style renderers for timeline lanes, waveform
fields, piano roll, automation surfaces, spectrograms, dense overlays, and hot-path meters —
do not render dense editor surfaces as giant DOM forests.

## Renderer surfaces are presentation hot paths, not business layers

They may own:

- drawing
- hit testing
- pointer interaction hot paths
- render-loop orchestration

They must not quietly become:

- business write owners
- persistence orchestrators
- hidden command executors without explicit boundaries

A renderer may interpret interactions, but writes still go through explicit actions.

## Suspense / error boundaries where appropriate

Async UI should use a structured pending/error model. Do not scatter ad hoc loading/error
handling everywhere when a boundary is the cleaner fit.

## Fallbacks matter

If a renderer backend is platform-dependent, fallback paths must be designed intentionally
rather than treated as negligible.
