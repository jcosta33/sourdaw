---
type: research
id: RESEARCH-effects-mastering-ui
title: Progressive disclosure, metering, and gain-matched bypass for plugin UIs
status: open
owner: The Sourdaw team
sources:
  - FabFilter, iZotope, Soundtoys plugin UX; EBU R128 / ITU-R BS.1770 loudness
  - Lock-free SPSC ring-buffer (rtrb) and WebGPU visualization references
---

# Research: Progressive disclosure, metering, and gain-matched bypass for plugin UIs

## Question

How should five existing effect/mastering plugins share one UI framework that
scales from novice to expert, meters without blocking the audio thread, and
makes bypass comparisons honest — all without touching DSP?

## Findings

### R-001 — Five disclosure tiers map novice-to-expert intent

- **Claim:** A Play → Shape → Build → Route → Lab progression lets a user start
  with a few macro controls and descend to full parameter access, matching how
  plugins like FabFilter and iZotope layer complexity.
- **Evidence:** Disclosure-by-expertise is the dominant pattern in modern plugin
  UX; each tier adds controls rather than replacing them.
- **Confidence:** medium
- **Bears on:** the framework (AC-001) and per-plugin assignments (AC-005–009).

### R-002 — Metering must cross threads via a lock-free SPSC ring

- **Claim:** DSP measurements (gain reduction, loudness, spectrum) must be
  published to the UI through a single-producer/single-consumer lock-free ring
  so the audio thread never waits on the UI.
- **Evidence:** `rtrb`-style SPSC rings are the standard real-time→UI bridge;
  mutexes on the audio thread are forbidden.
- **Confidence:** high
- **Bears on:** the metering bridge (AC-003).

### R-003 — Honest A/B requires gain-matched bypass

- **Claim:** Bypass must loudness-match the processed and unprocessed signal per
  EBU R128 so users do not mistake a level increase for a quality improvement.
- **Evidence:** R128 / BS.1770 integrated loudness is the accepted matching
  standard; "louder sounds better" bias is well documented.
- **Confidence:** high
- **Bears on:** gain-matched bypass (AC-004).

### R-004 — Grinder's expert visualization wants WebGPU

- **Claim:** Grinder's amp-sim Lab tier benefits from a GPU-accelerated
  visualization (spectrum / harmonic display) that WebGPU can drive at frame
  rate without taxing the main thread.
- **Evidence:** Real-time spectral displays are GPU-friendly; WebGPU is the
  Chrome-leading path with a fallback concern on other runtimes.
- **Confidence:** medium
- **Bears on:** Grinder visualization (AC-006) and the WebGPU fallback question.

### R-005 — Per-plugin control inventories differ

- **Claim:** Each of the five plugins has its own control set to assign across
  tiers; the assignment is per-plugin and not all plugins necessarily fill all
  five tiers.
- **Evidence:** The source's per-plugin control lists vary in depth (a limiter
  has fewer expert controls than a mastering suite).
- **Confidence:** medium
- **Bears on:** the blocking question on uniform vs variable tier counts.

### R-006 — Explainable mastering assistance can stay DSP-first

- **Claim:** The missing "AI" assistant can remain deterministic and inspectable: learn EQ by
  averaging multi-frame magnitude spectra with `realfft`, smoothing to roughly 31 bands, comparing
  a target against a reference, and emitting an editable curve; a Matchering-style pure-DSP
  reference match should compare RMS, frequency response, peak amplitude, and stereo width; gain
  staging should expose auto-gain, a LUFS target, and dynamic-range analysis.
- **Evidence:** The durable Proof surface already reserves Route-tier reference slots and Lab-tier
  match-EQ/ONNX Suggest controls, while `SPEC-loudness-metering-ebur128` provides the R128
  measurement foundation. The consolidated audit found no user-facing learn/match/auto-gain flow;
  the `realfft` occurrence is transitive lockfile evidence, not an implemented capability.
- **Confidence:** medium
- **Bears on:** Future Proof/mastering-page work; it does not change this spec's current DSP-free
  UI scope.

## Open questions

- [ ] Q-001 — Is the five-tier model uniform across all five plugins, or do some
  (e.g. Crust) collapse to fewer tiers? Confirm per-plugin tier counts.
- [ ] Q-002 — Metering bridge topology: one ring per meter vs one multiplexed
  ring per plugin instance?
- [ ] Q-003 — WebGPU fallback for Grinder's Lab visualization on runtimes
  lacking WebGPU.
- [ ] Q-004 — Which deterministic mastering-assistance slice ships first (learn EQ, reference
  matching, or gain staging), and where does its DSP implementation live? Keep this UI spec
  presentation/metering-only until that ownership is decided.

## Recommendation

Build one shared disclosure framework (R-001) with shared primitives, fed by a
lock-free SPSC metering bridge (R-002) and gain-matched R128 bypass (R-003).
Confirm per-plugin tier counts (Q-001 / R-005) before freezing the selector, and
plan a WebGPU fallback for Grinder (R-004 / Q-003). Keep all DSP untouched — this
is a presentation and metering effort only.
