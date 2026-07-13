---
type: research
id: RESEARCH-orchestra-spectral-modeling
title: Orchestra spectral modeling synthesis (SMS) — restored source research
status: draft
owner: The Sourdaw team
sources:
  - research/factory/advanced-instruments.md
---

# Orchestra spectral modeling synthesis (SMS) — restored source research

This note restores research content from `research/factory/advanced-instruments.md`
(git `bb84b0e`) that informs the SMS spec but was dropped during migration. The
SMS spec's `## Dropped from sources` referred to "onset-detection literature" as
design rationale; the verbatim source material is recovered here so that pointer
is true.

## Restored from research/factory/advanced-instruments.md — Spectral Modeling Synthesis (SMS)

Source section: "Orchestral Physical Modeling & Resynthesis → Missing/Changed Features".

> - **Spectral Modeling Synthesis (SMS):** Deterministic sinusoids + stochastic
>   noise + explicit transient handling for phrase morphing and vibrato spectral
>   envelope modulation (SEM).

The dropped capability here is **vibrato spectral envelope modulation (SEM)**: the
original lists SEM as an explicit SMS capability alongside phrase morphing. The
migrated spec preserved SMS analysis (partials + noise + transients) and phrase
morphing but lost the SEM capability as a named application of the spectral model.

## Restored from research/factory/advanced-instruments.md — Transient Detection (ODFs)

Source section: "Slicing, Resampling, and Time-Stretch → Missing/Changed Features".

> - **Transient Detection (ODFs) for Auto-slicing:**
>     - Energy envelope derivative
>     - Spectral flux
>     - Phase/complex-domain methods
>     - Multi-band fusion

The original enumerates **four** onset-detection functions (ODFs). The migrated
spec's non-blocking open question lists spectral flux, complex-domain, and
multi-band, but lost **energy envelope derivative** from the ODF family. All four
ODFs are recorded here verbatim so the family is complete.
