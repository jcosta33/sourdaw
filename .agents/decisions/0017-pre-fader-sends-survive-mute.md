---
type: adr
id: 0017
title: Pre-fader sends survive mute; solo-in-place gates them
status: accepted
date: 2026-08-12
owner: The Sourdaw team
sources:
  - AUDIT-effects-routing FX-8 (workspace artifact, retired after promotion)
---

# 0017 — Pre-fader sends survive mute; solo-in-place gates them

**Accepted 2026-08-12.** Resolved from primary sources under the owner's standing direction that decision gates are research tasks. Supersedes nothing.

Promoted from a workspace audit (`AUDIT-effects-routing`, finding FX-8) because the research and the
reasoning existed nowhere else and the artifact was being retired.

## Context

`setMute` zeroes `postFaderGain` (`src/modules/AudioEngine/engine/TrackNode.ts`), which sits
downstream of `preFaderTap` in the chain `gainNode → devices → preFaderTap → faderNode →
postFaderGain`. Pre-fader sends tap `preFaderTap`, upstream of the mute node. A muted track therefore
still feeds its pre-fader sends to buses and returns.

There is **no industry standard** here. Primary sources split three ways:

| Behaviour | DAWs |
| --- | --- |
| Pre-fader sends survive mute | Pro Tools; Ableton Live (the pre tap is taken before "the pan, volume and track-active controls") |
| Mute kills pre-fader sends | Logic Pro (changed deliberately in 9.1.2 — "pre-fader sends on the channel strip are now muted as expected"); Reaper (default, overridable since ~6.74); Studio One |
| User preference | Cubase / Nuendo — *Mute Pre-Send when Mute*, off by default |

Hardware splits the same way: classic analog desks and UA cue sends survive the cut; A&H SQ and
Yamaha CL do not.

The tension is genuine. A performer's headphone mix must not die because the engineer mutes a
channel, which argues for surviving. "Mute means silence" argues against.

## Decision

**Keep the shipped behaviour: pre-fader sends survive mute, in both the live and offline runtimes.**
This matches the Pro Tools / Ableton / Cubase-default model.

**Solo-in-place is different and is already settled.** A non-soloed track closes `preFaderTap` itself
through `setTrackSoloGate`, so it stops feeding sends, buses and sidechain keys alike. Leaking
pre-fader sends through solo-in-place is undesirable in every model — without the gate, a soloed mix
carries every non-soloed track's reverb tail. Solo-safe and bus-routed tracks are never gated, so the
solo-safe escape hatch still holds a return open.

## Alternatives rejected

**Logic/Reaper model — mute kills pre-fader sends.** Small change in both runtimes: move the live tap
downstream of the mute node and drop the offline cue-send branch. Rejected because it **silently
re-mixes every existing project that uses a muted cue send**, with no migration path.

**Cubase model — ship the above with a workspace preference.** Medium: adds a setting and a persisted
field. Deferred rather than rejected; revisit if users ask.

## Consequences

Export agrees with what the user hears. PR #794 fixed a mirror-image defect in the offline path,
where `renderOffline` expressed mute twice — `postFaderGain = 0` *and* exclusion from the scheduling
set. The strip node matches live topology, but the scheduling exclusion silenced the strip outright
and killed a pre-fader send the live engine keeps alive, so export lost cue-send content the engineer
was monitoring. Muted tracks carrying a pre-fader send to a live bus are scheduled again;
solo-gated tracks stay excluded.

Distinct from the solo store-vs-engine split (audit finding OE-4); this is the
pre-fader-tap-vs-mute-node topology.
