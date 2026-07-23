---
type: audit
id: AUDIT-effects-routing
scope: Effects & routing — buses, sends/returns, sidechain, signal-flow ordering, wet/dry, freeze/bounce routing integrity
repo: sourdaw
branch: audit/effects-routing
base: origin/main @ 74eb3061d0f91c80584c6264dec0907ed29935a0
date: 2026-07-23
method: sus-audit (observe, prove, prescribe nothing — remediation sketches are non-binding)
---

# Effects & Routing — Audit

AUDIT ONLY. No production code changed. Findings are evidence-anchored to `file:line` on the branch
base SHA above. Remediation sketches are sized S/M/L and are directional, not prescriptive. Prior audits
(`AUDIT-offline-export.md`, `AUDIT-midi-handling.md`, `AUDIT-automation.md`) are cross-referenced, not
re-litigated.

---

## 1. Golden Standard (first-class DAW effects & routing)

Grounding references (external, authoritative):

1. **Send/bus architecture & pre/post-fader semantics.** A post-fader send taps *after* the channel
   fader (effect follows the mix move); a pre-fader send taps *before* the fader and **keeps feeding the
   bus even with the fader down / channel muted** (used for cue/monitor mixes and for sidechain keys that
   must not depend on the fader). Send level is an independent control; effects sends are conventionally
   post-fader, cue sends pre-fader. Sweetwater — *Pre vs Post Fader*:
   <https://www.sweetwater.com/insync/pre-versus-post-fader/>; Sound on Sound — *Pro Tools: Using Sends*:
   <https://www.soundonsound.com/techniques/pro-tools-using-sends>; eMastered:
   <https://emastered.com/blog/pre-fader-vs-post-fader>
2. **Sidechain routing & key tap.** The key is fed by a send (pre- or post-fader) into a processor's
   **dedicated sidechain input** on a *different* track; the key path should be level-consistent and, on
   plugin-latency-bearing chains, time-aligned to the detector. Sweetwater — *Sidechaining*:
   <https://www.sweetwater.com/insync/sidechaining-how-it-works-why-its-cool/>
3. **Routing-loop prevention (Web Audio).** In the Web Audio graph a cycle **must contain at least one
   `DelayNode`, or every node in the cycle is muted**; a zero/short delay in a cycle is clamped to one
   render block. A first-class router must therefore detect/prevent feedback cycles (self-send, bus→bus)
   before they silently mute or run away. W3C Web Audio API 1.1 (cycles):
   <https://www.w3.org/TR/webaudio-1.1/>; MDN `DelayNode`:
   <https://developer.mozilla.org/en-US/docs/Web/API/DelayNode>; WebAudio issue #75 (cycle semantics):
   <https://github.com/WebAudio/web-audio-api/issues/75>
4. **Plugin-delay compensation (PDC).** The host reads each track's reported plugin latency, finds the
   session maximum, and delays every other track to match, preserving timing/phase — applied identically
   live and on bounce. Freezing/bouncing bakes the chain and removes its latency. Sweetwater — *Automatic
   Delay Compensation*: <https://www.sweetwater.com/insync/automatic-delay-compensation/>; Ableton — *Delay
   Compensation FAQ*: <https://help.ableton.com/hc/en-us/articles/209072409-Delay-Compensation-FAQ>
5. **Live↔offline signal-flow parity.** Offline render must reproduce the live routing graph exactly —
   device order, bus/return topology, send taps, sidechain keys, and mute/solo — so "export = what you
   monitor." MDN `OfflineAudioContext`:
   <https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext>

Distilled acceptance bar used for grading:

- **Send fidelity**: pre/post-fader tap honored; send level law usable; each key/send wired **once**.
- **Loop safety**: self-send and bus→bus cycles are prevented or delay-guarded, not silently summed.
- **Alignment**: plugin latency compensated consistently (or consistently absent) live and offline; the
  sidechain key is level- and time-consistent with the detector's main input.
- **Parity**: offline reproduces live device order, bus/return topology, sends, keys, mute/solo.
- **Controls do what they say**: a user-facing routing surface actually changes the audio graph.

---

## 2. Current-State Map

**Live strip topology** — `AudioEngine/engine/TrackNode.ts` constructor (`:53-108`):
`gainNode → [device chain] → preFaderTap → faderNode(0.8) → postFaderGain(mute) → panNode → (meterNode) →
analyserNode → destination`. `setGain`→`faderNode` (`:172`), `setMute`→`postFaderGain=0` (`:180`),
`setPan`→`panNode` (`:176`). `rebuildChain` (`:271-320`) rewires generators (summed in parallel) vs
effects (serial) in `deviceNodes` array order, then `routeOutput`.

**Live output routing** — `TrackNode.getDefaultDestination` (`:205-212`): `hw_out`/empty → `masterGainNode`;
else `getBusGainNode(outputId) || getTrackGainNode(outputId)`, **falling back to `masterGainNode`** when
absent. `routeOutput` (`:214-233`) connects `analyserNode → destination` (adjustment-bus insert takes
priority).

**Live sends** — `createWebAudioEngine.setSend` (`:783-811`): tap = `preFader ? preFaderTap : analyserNode`
(`:807`), `tap → sendGain(level, clamped 0–1) → busStrip.gainNode`. Pre/post handoff is gap-free via
`crossfadeSendTap` (`:823-865`). `reconnectRoutingForTrack` (`:372-397`) re-taps sends + sidechain on
rebuild. Buses are ordinary track strips wrapped by `BusNode` (`ensureBusStrip` `:597-609`).

**Live sidechain** — `applySidechainRoute` (`:961-989`): key `sourceNode = sourceStrip.analyserNode`
(`:980`, post-fader/pan/mute) → unity `scGain` → `deviceNode.inputNode` **input index 1** (`:982`) of a
`builtin-sidechain-compressor` worklet (2-in/1-out, `TrackNode.ts:392`). Fallback queue
`pendingSidechainRoutes` replays on recovery (`:945-959`).

**Offline strip** — `offlineRender/createOfflineTrackStrip.ts`: `inputNode → buildDeviceChain → preFaderTap
→ faderNode(gain) → postFaderGain(mute) → panNode → outputNode`. Bus strip = the track's `inputNode`
(`createOfflineBusStrip.ts`). `buildDeviceChain.ts:65-102` orders devices, routing 0-input generators into
the chain position.

**Offline routing/sends** — `renderOffline.ts:154-181`: output to master / bus `gainNode` / target track
`inputNode` (same silent master fallback, `:163-166`); `track.sends` wired `:169-180` with
`preFader ? preFaderTap : outputNode`.

**Offline sidechain** — wired by **both** `connectOfflineSidechainRoutes` (`renderOffline.ts:147`,
`repositories/offlineRouting/connectOfflineSidechainRoutes.ts`) **and** `wireOfflineSidechainRoutes`
(`renderOffline.ts:185`, `offlineRender/wireOfflineSidechainRoutes.ts`); both tap `sourceStrip.outputNode`
→ unity gain → compressor input 1 (mirrors live analyserNode tap — the prompt's "pre-fader tap" hint is
incorrect; re-derived from code + the wirer's own docstring).

**Routing matrix (UI)** — `Routing/presentations/views/RoutingMatrix.tsx` (mounted in
`WorkspaceShell/.../AppShell.tsx:501,517`) → `useCases/routingMatrix/toggleRoutingConnection.ts` →
`stores/routingMatrixStore.ts`.

**PDC** — `useCases/latencyCompensation/compensation/*`: real per-device latency reported by WASM devices
(`engine/wasmDeviceRegistry.ts:347,385,430,436,498,507,578,597` → `reportLatency`); `getCompensationDelay`
consumed **only** offline (`offlineRender/scheduleTrackClips.ts:221`) and in offline automation
(`offlineScheduler/automationScheduling.ts`). No consumer in `createWebAudioEngine.ts` / `TrackNode.ts`.

**Solo (live)** — `Arrangement/useCases/toggleTrackState/applySoloLogic.ts` → `setTrackGain`/`setTrackMute`
(engine nodes only; store-vs-engine split covered by **OE-4**, cross-referenced).

**Freeze/bounce** — `Arrangement/useCases/freezeBounce/{freezeTrack,bounceTrack}.ts` render via the
single-track `freezeBounce/renderOffline.ts` (MIDI-instrument triangle stub is **MD-4 Blocker**,
cross-referenced). Frozen playback injects the baked buffer at `preFaderTap`
(`Transport/useCases/scheduling/scheduleFrozenTrack.ts:31`).

---

## 3. Findings (severity-ranked)

### FX-1 — Offline mixdown double-wires the sidechain key → ~2× key signal (over-ducking in exported audio) — **Blocker**
**Evidence.** `renderOffline.ts` calls **two** sidechain wirers unconditionally in the same render:
- `connectOfflineSidechainRoutes({ offlineCtx, routes: sidechainRoutes, … })` — `:147`. Body:
  `sourceStrip.outputNode.connect(routeGain)` → `routeGain.connect(targetDevice.node.inputNode, 0, 1)`
  (`connectOfflineSidechainRoutes.ts:50-53`), unity gain (`:49`).
- `wireOfflineSidechainRoutes(offlineCtx, trackStripsById, deviceEntriesByTrack, sidechainStore.value?.routes)`
  — `:185`. Body: `sourceStrip.outputNode.connect(scGain)` → `scGain.connect(targetEntry.node.inputNode, 0, 1)`
  (`wireOfflineSidechainRoutes.ts:52-54`), unity gain (`:51`).

Both iterate the **same** `sidechainStore` routes, target the **same** `builtin-sidechain-compressor`
`inputNode` at the **same** input index 1, and neither dedups against the other (`connectOffline` dedups
only within itself via a local `Set`; `wireOffline` has no dedup at all). Web Audio **sums** the two
parallel unity connections, so the compressor's detector sees ~2× the key amplitude (~+6 dB).

Git lineage: `connectOfflineSidechainRoutes` predates `wireOfflineSidechainRoutes` (added by #616,
commit `acbfde0a7`); #616 added the second wirer without removing the first, so the mixdown path wires
every key twice.

**Failure mode.** Every exported mixdown that relies on sidechain ducking ducks **harder than live**
(and harder than intended) — a deterministic, silent corruption of deliverable audio, keyed to how hot
each source is. **Firing condition:** any project with ≥1 persisted sidechain route, mixdown export.
**Blast radius:** all sidechained mixdowns. (Deliverable-audio corruption, consistent with the Blocker
grading used for **MD-4**.)

**Remediation sketch (S).** One offline sidechain wirer, called once; delete or gate the duplicate call.
Add a regression asserting each compressor sidechain input has exactly one inbound key edge per route.

---

### FX-2 — No routing feedback-loop / cycle prevention (self-send and bus→bus cycles unguarded) — **Major**
**Evidence.** Neither the use-case nor engine send path rejects a cycle:
- `Routing/useCases/busControls/setSend.ts` guards only `acceptsRoutingEndpoint`; it does **not** reject
  `sourceTrackId === busId`. A self-send makes `setSend`→`ensureBusStrip(busId=sourceId)` return the
  track's own strip, wiring `analyserNode → sendGain → gainNode` (its own input) —
  `createWebAudioEngine.ts:807-809` — a direct feedback cycle.
- Buses are track strips whose `outputId` may target another bus: `getDefaultDestination` resolves
  `getBusGainNode(outputId)` (`TrackNode.ts:211`) with no ancestry check, so bus A→bus B→bus A is a cycle.
- Whole-scope search for cycle/loop guards in routing: `grep -ni "feedback\|cycle\|loop\|visited" ` over
  `createWebAudioEngine.ts` / `TrackNode.ts` / `Routing/**` yields only the unrelated transport-loop
  fields and the PDC `visited` set (`getTrackLatency`) — **no routing-graph cycle detection anywhere.**

Per golden standard #3 a Web Audio cycle without a `DelayNode` **mutes** every node in it (or, with a
sub-block delay, is clamped) — so a mis-toggled route silently kills audio or risks runaway rather than
erroring. `RoutingMatrix.tsx:76` blocks only the self (`isSelf`) cell cosmetically, and that surface is
inert anyway (FX-3).

**Failure mode.** A user routing a bus back into its own chain (or a track to a bus that returns to it)
silently mutes the cycle or destabilises the graph, with no validation or feedback. **Blast radius:** any
multi-bus / return-heavy session; small sessions rarely hit it.

**Remediation sketch (M).** Reject self-send in `setSend`; validate the send/output graph for cycles
(DFS over `sends` + `outputId`) before wiring, surfacing a user error instead of a muted/looping graph.

---

### FX-3 — The Routing Matrix panel is a dead control: toggles change no audio — **Major**
**Status: FIXED in #728** — the matrix now reads the real routing read-model (`track.sends` / `track.outputId`) and toggles dispatch the Arrangement `setSend`/`removeSend`/`setTrackOutput` use cases; the dead `routingMatrixStore` and `toggleRoutingConnection` are removed (per the #716 decision to wire, not retire).
**Evidence.** `toggleRoutingConnection.ts` only mutates `routingMatrixStore` (`.set({ connections })`);
it never calls `setSend`/`setTrackOutput`/any engine API. Whole-scope search for consumers of the store's
connections: `grep -rln routingMatrixStore src/` → only `routingMatrixStore.ts`, `stores/index.ts`,
`RoutingMatrix.tsx`, `toggleRoutingConnection.ts`; and `RoutingMatrix.tsx` is the sole reader of
`.connections` (`:24,76`). Nothing in `AudioEngine` reads it. Yet the panel is **user-facing** — mounted
in the bottom dock's `routing` tab (`AppShell.tsx:501,517`) — and its own docstring claims it is
"connecting track outputs to buses, sends, and sidechain inputs" (`RoutingMatrix.tsx:1-4`), with cells
labelled `Connect {src} → {dest}` (`:95`). Real routing lives entirely in `track.outputId` + `track.sends`
(driven elsewhere), so every click in this matrix is a no-op on the audio graph.

**Failure mode.** A user wires routes in a labelled matrix and hears no change; the persisted store state
never reaches the engine. **Blast radius:** anyone who opens the Routing panel.

**Remediation sketch (M).** Either bridge `routingMatrixStore` connections to `setSend`/`setTrackOutput`
through a use case (and into the CRDT write path), or remove/flag the panel until it is wired. Confirm
intended scope first (Open Questions).

---

### FX-4 — Plugin-delay compensation applied offline but never in the live graph (parity break + live flam) — **Major**
**Evidence.** WASM devices report real latency into the registry (`wasmDeviceRegistry.ts:347,385,430,436,
498,507,578,597` → `reportLatency`, ms = `latency/sampleRate*1000`); the sidechain compressor reports a
block of latency (`getDeviceLatencyMs.ts:18-20`). Offline **uses** it: `getCompensationDelay(track.id)`
shifts clip scheduling (`scheduleTrackClips.ts:221`) and automation seeds (`automationScheduling.ts:45,63,
77,117`). The **live** engine does not: whole-scope search of `createWebAudioEngine.ts` and `TrackNode.ts`
for `getCompensationDelay` / `getTrackLatency` / `createDelay` / `DelayNode` → **none**. No `DelayNode` is
inserted per track for PDC live.

**Failure mode.** Live monitoring flams: a track with a high-latency WASM/plugin chain plays late relative
to low-latency tracks, and phase-sensitive layers smear — while the **export removes that error** (offline
compensates). This is a live↔offline parity break (golden standard #4/#5) in the opposite direction to the
usual "export ≠ what you hear": here export is aligned and live is not. **Blast radius:** any session
mixing latency-bearing devices (Proof, Bacteria, Gluten, plugins) against low-latency tracks.

**Remediation sketch (L).** Insert per-track compensation `DelayNode`s in the live strip driven by the
same `getCompensationDelay`, recomputed on device add/remove/bypass; keep live and offline on one PDC path.

---

### FX-5 — Sidechain key has no time-alignment to the detector's main input — **Minor**
**Evidence.** The key is tapped raw: live `sourceStrip.analyserNode → scGain → inputNode(1)`
(`createWebAudioEngine.ts:980-982`); offline `sourceStrip.outputNode → gain → inputNode(1)`
(`connectOfflineSidechainRoutes.ts:50-53`, `wireOfflineSidechainRoutes.ts:52-54`). No `DelayNode` /
lookahead aligns the key to the compressor's own input latency, and (FX-4) no cross-track PDC exists live.
Whole-scope search `grep -ni "lookahead\|keyDelay\|alignKey\|DelayNode" AudioEngine/**` finds only device
DSP delay lines (flanger/reverb predelay), none on the key path.

**Failure mode.** When the keyed track or the compressor's chain carries latency, gain reduction triggers
early/late relative to the audio it ducks — smeared transient ducking. **Blast radius:** latency-bearing
sidechain setups; subtle for zero-latency built-ins.

**Remediation sketch (M).** Align the key to the detector via the PDC path (FX-4) or a short key
`DelayNode`; apply identically live and offline.

---

### FX-6 — `getDefaultDestination` silently reroutes to master when the target bus/track is missing — **Minor**
**Evidence.** `TrackNode.getDefaultDestination` returns `masterGainNode` when
`getBusGainNode(outputId) || getTrackGainNode(outputId)` is undefined (`TrackNode.ts:211-212`); offline
mirrors it (`renderOffline.ts:163-166`). Deleting a bus that tracks still target (`removeBusStrip`
`:611-624` tears down the bus and its sends but does not rewrite dependents' `outputId`) makes those tracks
**silently reappear on master** at full level instead of erroring or going silent.

**Failure mode.** A routing/output that resolves to nothing lands on master unannounced — surprising
level/summing after bus deletion. **Blast radius:** sessions that delete buses with live dependents.

**Remediation sketch (S).** On bus removal, reconcile dependents' `outputId` (or surface a broken-route
warning) rather than silently defaulting to master.

---

### FX-7 — Send and fader level law is raw linear 0–1 (no dB / equal-power taper) — **Minor**
**Evidence.** Sends: `setSend` clamps `Math.max(0,Math.min(1,level))` and sets `sendGain.gain.value=level`
(`createWebAudioEngine.ts:794-806`); offline identical (`renderOffline.ts:175`). Fader:
`faderNode.gain` default `0.8`, `setGain` clamps to `[0,1]` linear (`TrackNode.ts:56,172-174`). No dB
mapping or equal-power law anywhere for sends/faders (grep `equalPower|constant.power|Math.pow.*20|dbToGain`
in the send/fader path → none). Pan uses `pan/50` linear-pan, not equal-power (`TrackNode.ts:176-178`).

**Failure mode.** Linear amplitude gives poor low-level control resolution and non-standard send/pan
feel; not a correctness bug but a mixing-ergonomics gap vs first-class DAWs. **Blast radius:** all
mixing. (Pre/post-fader tap selection itself **is** correctly honored — see §2 — so this is law, not
topology.)

**Remediation sketch (M).** Map fader/send UI values through a dB taper to gain; use equal-power pan.

---

### FX-8 — Mute (and solo-in-place attenuation) do not silence pre-fader sends — **Minor**
**Evidence.** `setMute` zeroes `postFaderGain` (`TrackNode.ts:180`), which sits **downstream** of
`preFaderTap` (`gainNode → devices → preFaderTap → faderNode → postFaderGain → …`, `:89-97`). Pre-fader
sends tap `preFaderTap` (`:238`, `createWebAudioEngine.ts:807`), **upstream** of the mute node, so a muted
track still feeds its pre-fader sends to buses/returns. Solo-in-place mutes non-soloed tracks through the
same `setTrackMute` engine path (`applySoloLogic.ts:52` → `setTrackMute` → `postFaderGain`), so **a
soloed mix still leaks every non-soloed track's pre-fader sends into return buses** (e.g. reverb tails of
"muted" tracks audible during solo).

**Convention nuance.** Pre-fader sends intentionally ignore the *fader* (golden standard #1), and some
DAWs also keep them alive under mute (cue sends); but leaking pre-fader sends through **solo-in-place** is
usually undesirable. Distinct from **OE-4** (which is the solo store-vs-engine split); this is the
pre-fader-tap-vs-mute-node topology angle. **Blast radius:** sessions using pre-fader sends with mute/solo.

**Remediation sketch (M).** Decide mute/solo semantics for pre-fader sends explicitly (e.g. solo-safe
sends, or gate pre-fader sends under solo) and apply consistently live and offline.

---

### FX-9 — Stem export renders sidechain compressors keyless (no key wiring in `exportStems`) — **Minor**
**Evidence.** Whole-scope search: `connectOfflineSidechainRoutes` / `wireOfflineSidechainRoutes` are called
**only** in `renderOffline.ts` (`:147,185`); `exportStems.ts` calls neither. Each stem renders in its own
`OfflineAudioContext` (per the offline-export audit §2), so the key source track is typically absent from
that context and the compressor runs with no key input — ducking is absent in stems while present in the
full mixdown.

**Failure mode.** A sidechained track's stem lacks its ducking, diverging from the mixdown and from live.
Whether this is a defect depends on the intended stem policy (isolated stems inherently cannot key from
another stem's source). **Blast radius:** stem exports of sidechained material. Cross-ref OE-4 open
question on stem audibility policy.

**Remediation sketch (S/M).** Define stem sidechain policy: bake key-derived gain reduction into the
keyed track's stem, or document keyless stems as intended.

---

## 4. Verified-OK (no finding)

- **Sends & sidechain FROM a frozen track keep working live.** The baked buffer is injected at
  `preFaderTap` (`scheduleFrozenTrack.ts:31`), upstream of both send taps (`preFaderTap` / `analyserNode`)
  and the live sidechain key tap (`analyserNode`), so a frozen track still feeds its sends and still keys
  sidechains. (Static topology; not an A/B render.)
- **Offline sidechain tap point matches live** (both post-fader: live `analyserNode`, offline
  `outputNode`) — the assigned "pre-fader tap" hint is incorrect; corrected from code.
- **Pre/post-fader send tap selection is honored** live (`:807`) and offline (`renderOffline.ts:176`);
  the live pre↔post handoff is gap-free (`crossfadeSendTap`).
- **Device order is array-deterministic** and generator-vs-effect handling is equivalent live
  (`rebuildChain`) and offline (`buildDeviceChain`).

---

## 5. Remediation Roadmap (sequenced)

Counts: **1 Blocker, 3 Major, 5 Minor** (FX-1…FX-9).

1. **Deliverable-audio corruption first** — FX-1 (remove the duplicate offline sidechain wirer): tiny
   change, corrupts every sidechained export today.
2. **User-facing correctness** — FX-3 (wire or retire the Routing Matrix) and FX-2 (cycle/self-send
   guard): both are "controls that silently do the wrong thing."
3. **Alignment parity** — FX-4 (live PDC) then FX-5 (key alignment on the shared PDC path).
4. **Routing hygiene** — FX-6 (bus-removal reconciliation), FX-8 (pre-fader send mute/solo policy),
   FX-9 (stem sidechain policy).
5. **Ergonomics** — FX-7 (dB/equal-power laws).

---

## 6. Open Questions

- **Routing Matrix intent (FX-3):** is the panel WIP toward a real router, or should it be removed? Its
  store state is not on the CRDT write path either.
- **Pre-fader send under mute/solo (FX-8):** intended cue-send behavior, or should solo-in-place gate
  pre-fader sends? Needs a product decision, applied to both runtimes.
- **Stem sidechain policy (FX-9):** bake key-derived ducking into keyed stems, or accept keyless stems?
  (Ties to OE-4's stem-audibility open question.)
- **Live PDC scope (FX-4):** is live plugin-delay compensation in scope, or is the offline-only
  compensation an accepted limitation?

---

## 7. Unverified / not covered

- No dynamic browser render/A-B was performed; FX-1's "~2×/+6 dB" and FX-4/FX-5 timing claims are argued
  from graph topology and summing semantics, not measured decoded output.
- Bus/return summing headroom and the exact gain-staging of nested bus→bus chains were read, not metered.
- Freeze/bounce file-writing/cleanup and the MD-4 triangle-stub renderer are cross-referenced, not
  re-audited here.
- Native (Rust/cpal) mixer routing beyond the TS bridge was out of scope.

---

## Cross-references

- **OE-4** (`AUDIT-offline-export.md`): solo store-vs-engine split — FX-8 is the distinct
  pre-fader-tap-vs-mute-node angle; FX-9 ties to OE-4's stem-audibility open question.
- **MD-4** (`AUDIT-midi-handling.md`): freeze/bounce MIDI triangle-stub renderer (Blocker) — the freeze
  routing in §4 is verified-OK independent of that renderer defect.
