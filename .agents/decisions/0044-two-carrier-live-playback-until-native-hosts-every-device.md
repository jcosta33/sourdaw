---
type: adr
id: 0044
title: Live playback runs on two carriers, split per strip, until the native engine can host every device
status: accepted
date: 2026-09-04
owner: The Sourdaw team
sources:
    - src/modules/AudioEngine/useCases/livePlayback/stripCarriers.ts
    - src/modules/AudioEngine/useCases/livePlayback/projectLiveGraphTopology.ts
    - src/modules/AudioEngine/useCases/livePlayback/startNativeLiveGraphSession.ts
    - src/modules/AudioEngine/useCases/livePlayback/stopNativeLiveGraphSession.ts
    - src/modules/AudioEngine/useCases/trackAudioControls/setNativeCarriedTracks.ts
    - src/modules/AudioEngine/engine/TrackNode.ts
    - src/modules/AudioEngine/engine/hostedPluginControls.ts
    - crates/sourdaw-native/src/commands/graph.rs
    - .agents/decisions/0031-native-plugin-format-strategy.md
    - https://github.com/jcosta33/sourdaw/issues/3564
---

# 0044 - Live playback runs on two carriers, split per strip, until the native engine can host every device

## Context

Sourdaw hosts CLAP and VST3 plugins in a native process ([ADR 0031](0031-native-plugin-format-strategy.md)),
and the native engine now builds a real live graph with a real timeline. Web Audio hosts everything
else the product sounds: the built-in WASM devices, the synths, and the live input a musician
monitors while recording.

Neither engine can play a whole project. The native engine has no body for a WASM built-in and no
MIDI hosting, so a track carrying either is a track it would build wrong or refuse. Web Audio cannot
run a CLAP or VST3 plugin at all; until now it stood a bridge node in the plugin's place and pumped
audio out to the native host and back per block, which bought the plugin's sound at the cost of a
round trip on the strip.

So the question is not which engine wins. It is what the unit of the answer is. A global switch
picks one engine for the whole project and gives up whatever the other one alone can play — with a
plugin anywhere in the project, that means either no plugins or no built-ins. Anything finer needs a
rule that can be trusted per track, because the two failure modes are not symmetric: a track claimed
by the native engine that it cannot actually build goes silent, and a track left on Web Audio that
the native engine also plays is heard twice, doubled and slightly out of phase.

## Decision

**The carrier is decided per strip, by one law, in one place.**
`AudioEngine/useCases/livePlayback/stripCarriers.ts` is a pure projection from the strip tracks, the
programme, the engine's attach state, and the set of input-monitored tracks to a carrier per track:
`native`, or `web` with a reason. Only tracks get an answer. A bus never does — both carriers route
into it, so it is shared infrastructure rather than a thing one of them owns.

A track is native only when the engine can represent all of it: it has something scheduled to play,
it is not monitoring live input, every device in its chain has a native body — a `knead` built-in, or
a plugin the engine reports attached — and every bus its output path and its sends reach is
representable by the same test, all the way to master. A routing cycle is answered rather than
recursed. Each of these is a `web` answer with a reason, and the reason is written for a musician
because it is what a musician is shown.

**The producer reads the law; it does not restate it.** `projectLiveGraphTopology` calls the
projection once and sets `contributesAudio` on a track strip to exactly `carrier === 'native'`. That
flag is the native mapper's permission to refuse the whole batch when a device has no body, so the
law and the engine's own admission test are the same test. An audible session schedules clips only
for the strips it carries; a shadowed one still schedules everything, because a shadowed session
sounds nothing and exists to be compared.

**Web Audio gives up exactly the strips the session claims.** `TrackNode` holds two gates — one on
the destination edge, one on the pre-fader send tap — and `setNativeCarriedTracks` closes them for
the carried set. The session claims that set optimistically, before the first `await` that could
leave the gates open across a slow IPC, and re-states it after the engine rebinds newly attached
plugins. Every path that declines, and stopping the session, releases every gate first, before any
further IPC and whether or not a backend exists: a stuck-closed gate is silence, and silence is the
one outcome no fallback recovers from.

**The Web Audio external-plugin device becomes a pass-through.** It is a unity gain node that carries
its neighbours' audio through unchanged and keeps only the parameter and bypass IPC the plugin's rack
UI needs. No audio leaves this process and comes back, so the device contributes zero delay
compensation.

**Every plugin that cannot be heard is told to the user.** A session that declines, and a track whose
plugin the native engine could not take, each raise a notice naming what is silent and why —
deduplicated so a repeated transport start does not repeat it. A console line is not an answer: a
musician hitting play on a track with a reverb they cannot hear needs to know the reverb is the
reason.

## Consequences

A project mixing plugins and built-ins plays, whole, with each track on the engine that can sound
it — which no single-carrier arrangement does.

Five costs are accepted for the duration of the split, each with a lane of its own:

- The two carriers do not share a roll latency. A native-carried track and a Web Audio one start
  from the same transport position but travel different output paths, so they are aligned only as
  closely as the two paths happen to agree (#3577).
- A track meter reads the Web Audio strip's render. For a native-carried track that render is gated
  out of the output, so the meter shows a level nothing is hearing (#3578).
- `pnpm desktop:measure` reads the Web Audio master to decide whether audio reached the output. A
  fully native-carried project therefore reports "not reached" while sounding correctly, and the
  measurement stays unreliable until a native master meter lands (#3565).
- The graph command surface carries no master gain. A native-carried strip leaves through the native
  device without crossing the Web Audio master fader, so it plays about 1.9 dB hot at the 0.8 default
  and answers no move of that fader mid-take, until a `set-master-gain` command travels with the
  topology (#3596).
- A device-chain change on a rolling native-carried strip that the native engine cannot host is
  declined and takes effect on the next play (#3575).

Each of those is a symptom of the split itself, not of the mechanism chosen for it: they are the
price of two carriers, and they disappear with the second carrier rather than being fixed
independently.

The law is deliberately conservative in one direction only. Where the answer is uncertain — a plugin
whose attach state has not been reported yet, a bus the engine might build — the track stays on Web
Audio. Web Audio is the carrier that has always played everything, so its wrong answer is a plugin
that goes unheard and is announced, while the other wrong answer is a track that goes silent with
nothing to say about it.

This arrangement is transitional and its reversal condition is written into it. When the native
engine hosts MIDI and carries native bodies for the built-in devices, every strip is representable,
every track is native, and the carrier law, the gates, and the notices are deleted rather than
extended — the last strip leaving Web Audio removes the only reason any of them exist.
