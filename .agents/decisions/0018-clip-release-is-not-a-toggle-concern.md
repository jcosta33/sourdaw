---
type: adr
id: 0018
title: Release actions belong to gate-style launches, not to toggle
status: accepted
date: 2026-08-12
owner: The Sourdaw team
sources:
  - .agents/artifacts/sourdaw/SPEC-session-launcher-engine.md
---

# 0018 — Release actions belong to gate-style launches, not to toggle

**Accepted 2026-08-12.** Resolved from primary sources under the owner's standing direction that decision gates are research tasks. Resolves `SPEC-session-launcher-engine` DG-002.

## Context

The spec asks whether `OnReleaseAction` applies to Toggle-mode clips or only to Gate/Momentary. AC-004
requires trigger and release modes to form a closed state machine with **one** release effect, so the
answer decides whether Toggle can have two competing end paths.

This is greenfield: `src/modules/SessionLauncher/stores/sessionLaunchStore.ts` is a
`Record<trackId, sceneIndex>` documented in-file as "explicitly unwired from playback", and the only
launch-adjacent state machine in the module is LoopStation's `LoopSlotState`. No trigger mode, gate,
toggle, repeat or release action exists anywhere. So no existing project can be silently re-mixed by
either choice, and the tiebreaker that decided ADR 0017 does not apply.

## What the industry does

**Ableton Live 12, §16.2 Launch Modes** — release is explicitly a no-op for Toggle:

- "Trigger: down starts the clip; up is ignored."
- "Gate: down starts the clip; up stops the clip."
- "Toggle: down starts the clip; up is ignored." — the clip "will stop on the next down."
- "Repeat: As long as the mouse switch/key is held, the clip is triggered repeatedly."

The same wording appears in the Live 11 manual §14.2, so it is stable across versions.

**Bitwig Studio has no Toggle mode at all.** Its Launcher Clip Parameters split the concern into
three orthogonal parameters, and release is a first-class always-present action with four values:
"Continue — Let the clip play and do nothing"; "Stop — Stops the clip"; "Return — Returns to the
previously playing clip"; "Next Action — Trigger the clip's Next Action immediately on release".
Bitwig states plainly: "Triggering a clip is distinct from releasing it; these are two separate
actions." Live's Trigger is Bitwig's `on Release: Continue`; Live's Gate is `on Release: Stop`.

**No primary source documents a release action applied to a Toggle-mode clip.** The two reference
implementations reach the same place by opposite routes — Live keeps Toggle and makes release
meaningless for it; Bitwig keeps release and deletes Toggle.

## Decision

**`OnReleaseAction` applies only to gate-style launches. Toggle ignores release; a Toggle clip ends
on its next down.**

Model release as Bitwig does — an orthogonal parameter whose default is `Continue` — rather than as a
property of a mode enum. Under that model "Trigger" and "Gate" are not separate modes at all, they
are `on Release: Continue` and `on Release: Stop`, and AC-004's "one release effect" invariant holds
by construction because there is exactly one release parameter.

## Alternatives rejected

**Apply `OnReleaseAction` to Toggle as well.** No shipping DAW does this. It gives a Toggle clip two
pending end paths — the release action and the next down — which is the double-fire AC-004 forbids,
and would need explicit cancellation rules that neither reference implementation has had to invent.

## Consequences

If we adopt the orthogonal model, the mode enum shrinks and `Repeat` remains the only genuinely
distinct trigger behaviour (retrigger at the clip quantization rate while held). Bitwig's four
release values are a good starting vocabulary; `Return` in particular has no Live equivalent and is
worth having.

Live's Legato is a separate axis again — a Legato clip "takes over the play position from whatever
clip was played in that track before" — and should not be folded into either the trigger or the
release parameter.

## Sources

- Ableton Live 12 Reference Manual §16.2, §16.3 — https://www.ableton.com/en/live-manual/12/launching-clips/
- Ableton Live 11 Reference Manual §14.2 — https://www.ableton.com/en/live-manual/11/launching-clips/
- Bitwig Studio User Guide, Launcher Clip Parameters — https://www.bitwig.com/userguide/latest/acquiring_and_working_with_launcher_clips
- Bitwig Studio User Guide, Triggering Launcher Clips — https://www.bitwig.com/userguide/latest/triggering_launcher_clips_0/
