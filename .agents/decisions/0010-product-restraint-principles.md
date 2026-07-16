---
type: adr
id: 0010
title: Product restraint principles (candidate canon)
status: proposed
date: 2026-07-16
owner: The Sourdaw team
sources:
  - .agents/specs/intake/differentiators.md
  - .agents/specs/intake/future-spec.md
  - .agents/specs/intake/audit-deferred-fixes.md
  - .agents/specs/intake/research-killer-features.md
---

# 0010 — Product restraint principles (candidate canon)

## Context

The intake artifact `intake/differentiators.md` carried two blocks of durable
product guidance that no feature specification inherited when the intake was
decomposed: seven **core principles** and five **"What not to overbuild"**
guardrails. They are product canon, not feature scope, so they have no natural
home in any single `.agents/specs/<feature>/spec.md`. This ADR preserves them
verbatim before the source intake file is deleted.

There is an unresolved tension. `intake/differentiators.md` argues for
restraint (lightweight features, quiet provenance, no side-panel sprawl,
immediacy over metadata), while `intake/future-spec.md` frames a maximalist
vision (a large semantic/provenance/branch-lineage object model and an expansive
feature surface). Both were captured as source material; neither has been
ratified as the governing product stance. Recording the restraint principles
here does **not** resolve that tension in restraint's favor — it only keeps the
candidate canon from being lost, and names the conflict for a product-owner
decision.

The seven core principles, verbatim from `intake/differentiators.md`:

> ## 1. Music first
>
> Every advanced system must make writing, editing, arranging, performing, comping, and comparing faster.
>
> ## 2. Branch first, never chaos first
>
> Alternatives should be native to the session, not hacked together with duplicate tracks and muted clips.
>
> ## 3. Preserve meaning, not just bytes
>
> Performance expression, version lineage, and user intent should survive edits, transforms, exports, and runtime changes wherever possible.
>
> ## 4. No invisible state
>
> If playback, rendering, AI, or runtime conditions changed what the user is hearing, the DAW must say so clearly.
>
> ## 5. AI must be subordinate
>
> AI can suggest, branch, transform, or refine. It must not silently overwrite, obscure authorship, or hide its operating mode.
>
> ## 6. Browser and desktop are one project
>
> The same session must remain coherent across light preview, browser editing, and heavyweight native rendering.
>
> ## 7. Advanced features must stay lightweight
>
> No feature should require users to think like a systems architect to finish a song.

The five "What not to overbuild" guardrails, verbatim from
`intake/differentiators.md`:

> ## 1. Do not turn intent into project bureaucracy
>
> No giant object model that asks users to manage statuses, evidence references, and satisfaction scores unless there is a real payoff.
>
> ## 2. Do not make provenance a mainstream headline
>
> Provenance can matter for export, rights, and disclosure, but it should support professional workflows quietly unless the user explicitly needs it.
>
> ## 3. Do not prioritize deep spatial architecture before the DAW wins at core production
>
> Spatial and object workflows are real, but they are not the main reason users will adopt a new browser-native DAW.
>
> ## 4. Do not drown the product in side panels
>
> Every panel must earn its existence by accelerating real work, not by making the system sound advanced.
>
> ## 5. Do not let metadata outrun immediacy
>
> A DAW should feel fast, tactile, and musical.
> The semantic layer must serve that, not compete with it.

## Decision

**Pending product-owner ratification — this ADR records the candidate canon, it
does not enact it.** The seven core principles and five "What not to overbuild"
guardrails above are proposed as durable product canon for Sourdaw. Until a
product owner ratifies them, they are a recorded candidate: preserved so the
guidance survives deletion of `intake/differentiators.md`, but not binding on
feature specs or review. On ratification, this ADR moves to `status: accepted`
and the principles become the reference the "restraint vs maximalism" tension
below is resolved against.

## Open questions

- **Restraint vs maximalism (product-owner call).** `intake/differentiators.md`
  (this ADR's principles) and `intake/future-spec.md` (a maximalist
  semantic/provenance/branch-lineage object model and broad feature surface)
  pull in opposite directions. Ratify which stance governs — the restraint
  principles as stated, the maximalist future-spec vision, or a stated synthesis
  — before either is treated as canon. This ADR stays `proposed` until then.
- **Intake residuals with no feature home.** The following items were surfaced
  during intake decomposition and have no owning spec. They belong in
  `open-decision-docket.md` at consolidation (that docket is being modified by
  other in-flight PRs and is intentionally not touched here); parked here in the
  meantime:
  - **I-25** — Proof vs `Plugin/ProofChamber` duplication. Product decision;
    surface to the maintainer, do not delete code. (Now tracked in `open-decision-docket.md`.)
  - **I-28** — `LocalStorageKeys` legacy keys. File header requires legal
    review; out of scope for an agent. (Now tracked in `open-decision-docket.md`.)
  - **DJ mode / VCV Rack integration** — niche ideas from
    `intake/research-killer-features.md` (DJ mode missing; VCV Rack integration
    and AI-generated modulation patches missing while CV/Gate exists). One line:
    keep or drop. (Now tracked in `open-decision-docket.md`.)

## Status

proposed

Records candidate product canon preserved from `intake/differentiators.md`.
**Not binding until product-owner ratification.**

## Follow-up work

- Obtain product-owner ratification of the restraint principles, resolving them
  against the maximalist future-spec vision; on acceptance, flip to
  `status: accepted`.
- At docket consolidation, migrate the intake residuals (I-25, I-28, DJ
  mode/VCV Rack) from this ADR's Open questions into
  `open-decision-docket.md`.
