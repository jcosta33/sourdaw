---
type: spec
id: SPEC-grandboule-aftertouch-mapping
subject: whether GrandBoule has an aftertouch source at all, and the closed set of destinations a struck-string model can honestly accept — decided per destination, not per device
status: draft
repo: sourdaw
date: 2026-08-07
blocked_by: nothing
blocks: none recorded
governs: ADR 0015 (every guard here), ADR 0016 rulings 2 and 3
supersedes: the prose refusal at src/modules/GrandBoule/presentations/components/MidiCalibrationPanel.tsx:9-14
sources:
  - .agents/decisions/0015-a-guard-must-be-able-to-fail.md
  - .agents/decisions/0016-ultracode-session-scope-and-standard.md
  - crates/daw-dsp/AGENTS.md — the allocation-free/lock-free RT contract and its default-state trap
  - src-tauri/AGENTS.md — "Real-time invariants (hard)"
  - Pianoteq 9 user manual, Modartt — https://www.modartt.com/user_manual?product=pianoteq&lang=en
  - Arturia Augmented GRAND PIANO user manual 1.0.0 EN §6.2.4 —
    https://dl.arturia.net/products/augmented-grand-piano/manual/augmented-grand-piano_Manual_1_0_0_EN.pdf
  - Synthogy Ivory II manual, ch. 12 "MIDI Response", p. 66
  - Roland SC-8820 Owner's Manual, MIDI Implementation appendix p. 168 —
    https://cdn.roland.com/assets/media/pdf/SC-8820_OM.pdf
  - VSL Synchron Pianos, Play View — https://www.vsl.co.at/en/manuals/synchron-pianos/play-view
---

# GrandBoule aftertouch — an assignable source, not a baked-in response

GrandBoule's fixed `afterTouchSensitivity` knob was removed as precedent-free. Nothing in the
premium tier ships a sensitivity control into an implicit piano pressure response. That removal was
correct and this spec does not re-open it.

What it left behind is a different question, and this spec is only about that one: **if aftertouch
is to exist on GrandBoule at all, it exists as an assignable map source with a response curve, bound
to nothing by default** — and the set of destinations it may be bound to is small, closed, and
argued from the physical model rather than asserted.

Per ADR 0016 ruling 2 the default for a browser-capable capability is **build it**, not remove it.
Per ruling 3 there are no users: whatever is decided applies with no version gate and no shim.

---

## 1. What exists today, in code

Measured on `2b141b033`. Every claim below is a file the implementation will touch.

### The pressure drop is deliberate and pinned

`crates/daw-dsp/src/grand_boule/engine.rs:495-512` declares
`note_expression(&mut self, midi_note, channel, bend_semitones, _pressure: f32, _slide: f32)`.
The two underscore-prefixed parameters are the drop; only `voice.set_expression_bend(bend_semitones)`
at `:509` runs. Its docblock (`:489-494`) states the reason: a struck string "has no continuous
pressure or timbre response to model — key aftertouch does not re-excite a string, and the engine
has no per-voice brightness control — so `pressure` and `slide` are accepted and deliberately
dropped rather than faked."

That behaviour is pinned by **`pressure_and_slide_are_dropped_rather_than_faked`**
(`crates/daw-dsp/src/grand_boule/engine.rs:1868`). It renders 40 blocks of a held note, renders the
same note again after `note_expression(69, 2, 0.0, 1.0, 1.0)` — zero bend, **full** pressure, **full**
slide — and asserts `assert_eq!(plain, pressed)`.

**This guard is well-formed and this spec does not weaken it.** It drives pressure between 0.0 and
1.0, which is the two-value requirement ADR 0015 asks for, and it sits at a non-default pressure on
the interesting side. AC-5 governs what happens to it.

The same refusal is written in two more places, both of which the implementation must revise rather
than contradict: `src/modules/AudioEngine/engine/noteExpression.ts:59-61` and
`src/modules/GrandBoule/presentations/components/MidiCalibrationPanel.tsx:9-14`. The panel comment
already prescribes the correct shape — "an assignable modulation source with a response curve, bound
to nothing by default" — so this spec **implements an existing recorded position**; it did not
discover a gap.

### The wire is already built, and dies three gates early

Channel pressure (`MIDI_CHANNEL_PRESSURE = 0xd0`, `src/modules/MIDI/models/WebMidiTypes.ts:63-68`)
is parsed by `parseWebMidiMessage` (`src/modules/MIDI/repositories/webMidi/messageHandlers.ts`),
dispatched at `src/modules/MIDI/useCases/webMidiInput/handleWebMidiMessage.ts:108-112`, normalised
to 0..1 by `normalizeNoteExpression` (`noteExpression.ts:117`), posted by
`src/modules/AudioEngine/engine/GrandBouleNode.ts:564-565`, and consumed by
`src/modules/AudioEngine/worklets/grandBouleEngineCore.ts:242`. It then hits `_pressure`.

**But it does not get that far on an ordinary keyboard.**
`src/modules/MIDI/useCases/webMidiInput/handleWebMidiChannelPressure.ts:10` opens with
`if (!getMpeEnabled() || channel < 1) return;`. A single-channel controller sending `0xD0` on
channel 0 — which is what an ordinary aftertouch keyboard does — is discarded at that line and never
reaches the plumbing at all. Any spec that treats "the wire exists" as "the source works" is wrong
by one gate. AC-2 owns this.

**Polyphonic key pressure (`0xA0`) does not exist anywhere in this repository** — no status
constant, no parse arm, no type variant, no Rust path. See §5.

### The expression registry is the single source of truth

`NOTE_EXPRESSION_DEVICES` (`src/modules/AudioEngine/engine/noteExpression.ts:63`) declares
`'grand-boule': { controlsKey: 'grandBouleControls', dimensions: ['pitchBend'] }` at `:74`. Its
header states that the live path, the scheduled path and the editor's availability surface all read
that one table.

### The engine's runtime surface is eighteen global scalars

`engine.rs:457-483` is the complete `set_param` match: `master_gain`, `soundboard_send`,
`sympathetic_send`, `hammer_hardness`, `tone_tilt`, `stereo_width`, `velocity_curve`, `temperament`,
`hammer_hardness_scale`, `hammer_mass_scale`, `soundboard_brightness`, `sympathetic_level`,
`body_resonance`, `tone_color`, `stretch_amount`, `attack_bite`, `sustain_threshold`,
`cc_smoothing_ms`, and `_ => {}`. **Unknown keys are silently swallowed** — which is itself a
hazard for any guard that asserts a write "landed" without measuring audio.

There is no `set_param_by_id` for this device and no per-voice parameter surface. **Every one of the
eighteen is a global engine scalar, not per-voice.** That single fact decides the mono-pressure
policy in §3.

### The sympathetic bank

`crates/daw-dsp/src/grand_boule/sympathetic.rs`, struct `Sympathetic` (`:34`): 24 high-Q biquad
modes (`SYMPATHETIC_MODES = 24`, `:19`) deliberately detuned off the played harmonic lattice.

Its gain is one product, formed at `engine.rs:609-611`:

```rust
// 2. Sympathetic bank: combine preset send with model level.
let sym_amount = self.sympathetic_send * self.sympathetic_level * 2.0;
let sympathetic = self.sympathetic.tick(bridge) * sym_amount;
```

`sympathetic_send` (default `0.25`) is the user/preset send; `sympathetic_level` (default `0.5`) is
the piano-model level written by the morph engine. Both are `set_param` keys. The bank's input is
the summed bridge force of all sounding voices (`:601`); its output goes **both** into the soundboard
drive (`:615`) and directly into the mono sum (`:634`).

**The bank's damping is pedal-derived, not a parameter**: `engine.rs:383-384` calls
`self.sympathetic.set_damping(self.pedals.sympathetic_damping())` every block, and
`DAMPED_BANDWIDTH_HZ = 40.0` against `UNDAMPED_BANDWIDTH_HZ = 0.8` (`sympathetic.rs:23-27`). **With
the dampers down the bank is nearly inert.** This is the single most important fact for AC-4's
guard and it is exactly the trap the campaign keeps hitting — see §6.

### The mechanical-noise layer exists, and has no runtime control whatsoever

`crates/daw-dsp/src/grand_boule/mechanical_noise.rs`, struct `MechanicalNoise` (`:71`), enum
`NoiseEvent` (`:16`) with `KeyDown`, `HammerLetoff`, `DamperLift`, `PedalDown`, `StringPrecursor`.
Fixed 32-burst pool, round-robin, no allocation. Summed flat into the output at `engine.rs:621-622`
and `:635`.

Three facts that decide §3:

1. **It is event-triggered bursts, not a continuous bed.** `KeyDown` and `HammerLetoff` fire once at
   note-on (`engine.rs:214-216`), `StringPrecursor` at note-on when `bite_velocity > 0.0` (`:225-226`),
   `DamperLift` once in `note_off` at a hardcoded `0.5` (`:346`). Durations are 3–20 ms
   (`mechanical_noise.rs:100-103`).
2. **`PedalDown` is never triggered anywhere in the crate.** It is defined and dead.
3. **There is no gain field, no setter, and no `set_param` key for the noise layer.** The five levels
   are a hardcoded `match` (`mechanical_noise.rs:99-109`). `MechanicalNoise` carries only
   `sample_rate`, `bursts`, `next_slot`, `rng_state`. The one runtime control that touches it is
   `attack_bite`, and it scales only the `StringPrecursor` *trigger velocity* at `engine.rs:223` —
   applied at trigger time, so it cannot modulate a burst already ringing.

### The calibration surface

`src/modules/GrandBoule/models/GrandBouleMidiCalibration.ts` holds five fields;
`MIDI_CALIBRATION_RANGES` (`:32`) is the clamp table `setMidiCalibrationParam` keys into — **a new
field absent from it clamps against `undefined`**. Only two of the five reach the engine, via
`syncMidiCalibrationToEngine` (`useCases/calibrateGrandBouleMidi/syncMidiCalibrationToEngine.ts:30`).

`src/modules/GrandBoule/presentations/components/__tests__/MidiCalibrationPanel.spec.tsx:20` is
titled *"offers exactly the five calibratable parameters, and no aftertouch control"* and asserts
both `queryByText(/aftertouch/i)).not.toBeInTheDocument()` (`:31`) and
`getAllByRole('slider')).toHaveLength(5)` (`:32`). **Two assertions in a landed spec contradict this
one.** AC-7 owns them; they are not to be quietly edited.

---

## 2. Primary sources — what was verified, and what was dropped

The campaign's research rule is binding: never answer an architectural question from memory when a
normative source exists. Every citation below was fetched and read. **Four claims that this spec was
briefed to carry did not survive verification and have been dropped.** Recording the drops is part
of the deliverable — a spec carrying an unverified claim is worse than a spec with fewer anchors.

### Verified

**Pianoteq 9 user manual (Modartt)** — the direct physical-model comparator. Read from the rendered
official manual, four separate passages:

- **Aftertouch has its own response curve, alongside and separate from the others.** §9 Velocity
  panel: *"The upper menu lets you separately adjust Velocity, Note-off, Pedal and Aftertouch
  velocities."* The curve is editable — control points added and removed by mouse.
- **The recommended starting state unbinds almost everything.** MIDI section: you can *"Unassign all
  controllers except pedals and Pitch Bend by choosing Current MIDI Mapping: Minimalistic
  (recommended for starting)"*. Controller assignment is flagged *"experienced users only"*.
- **Aftertouch is framed as a non-piano feature.** The feature list reads *"Polyphonic Aftertouch
  (particularly interesting for the clavichord)"*. The parenthesis is the point: on the flagship
  physical-model piano product, aftertouch is advertised for the clavichord, not the grand.
- **The one documented aftertouch destination is damping, not tone.** §9.2: *"Aftertouch: notes are
  dampened according to their Aftertouch value when using the sustain pedal (adjustable with the
  Aftertouch curve)."* It is one of two options the user clicks — opt-in, not default. **The
  destination is the damper, the one part of a piano still mechanically live after escapement.**
  This is the strongest single anchor in this spec and it argues §3 directly.

**Arturia Augmented GRAND PIANO, manual 1.0.0 EN, §6.2.4 KEYS, printed p. 46** — *"This page lets
you create custom curves for how they respond… they're simpler and have a maximum of four
breakpoints each."* Aftertouch is explicitly among the four assignable player sources: *"Aftertouch:
Shapes output in response to finger pressure after initial key strike. Note that not all keyboards
sense aftertouch."* Each source gets four assignable destination slots. Confirms the per-source
break-point curve shape.

**Synthogy Ivory II manual, ch. 12 "Tips for Using Ivory II" → "MIDI Response", printed p. 66** —
*"Pitchbend, Modulation Wheel, Channel Pressure (Aftertouch), and Program Change commands do not
have any effect."* A flat denial, broader than aftertouch alone. Caveat to carry: the copy read was
a third-party mirror (Synthogy gates manuals behind registration); PDF metadata is vendor-authored
(`Ivory II.book`, FrameMaker, 2011). **Do not extend this to Ivory 3**, which is a different engine
and ships MIDI 2.0 Piano Profile support.

**Roland SC-8820 Owner's Manual, MIDI Implementation appendix, p. 168, `●Channel Pressure`** —
*"The resulting effect is determined by System Exclusive messages. With the initial settings there
will be no effect."* The same remark appears for `●Polyphonic Key Pressure` at p. 166.

> **Re-attributed.** This spec was briefed to cite "the Roland GM2 spec". The phrase is in a Roland
> **product manual**, not in the General MIDI 2 specification — the GM2 Controller Destination
> Setting document is member-gated at midi.org and was **not read**. The SC-8820 is a GM2-compatible
> module and carries the GM2 `Controller Destination Setting` SysEx at p. 171, so it is legitimately
> GM2-era Roland documentation, but the citation must say *SC-8820 Owner's Manual*, never *the GM2
> spec*. Cite it that way or not at all.

**VSL Synchron Pianos, Play View** — the control-assignment *model* is verified from the rendered
page: right-click any control for a context menu offering *"Assigned Source: not visible if not
assigned"*, *"Learn: Click to MIDI-learn"*, and *"Available Control Sources: Choose from this
list."* **"Not visible if not assigned" is a default-unbound product, stated by the vendor**, and
that is the half of the VSL citation this spec relies on.

### Dropped, with reasons

**Pianoteq's mono-pressure policy ("only highest active note").** **Dropped.** The phrase does not
appear in the Pianoteq 9 manual. It traces to a single user forum post (SteveLy, forum.modartt.com
thread 4115, post #10, January 2016) describing a "Mono Aftertouch" option under the AT curve. A
user post about a ten-year-old release is not normative and cannot carry an architectural decision.
**§3's mono policy is therefore argued from GrandBoule's own code — every engine scalar is global —
and not from Pianoteq.** That argument is stronger anyway: it is a fact about the system being
specified.

**VSL's "Aftertouch and Aftertouch-Release among its control sources".** **Dropped.** The enumerated
control-source list is not published in the online manual. The Play View page documents only that a
list exists ("Choose from this list") and never prints it; the Synchron Player pages carry no
occurrence of "aftertouch" once rendered. Raw-HTML greps returned zero, but the pages are
JS-rendered, so that is **not** evidence of absence either — this is an honest *cannot reach*, not a
refutation. Do not cite VSL for the presence of an aftertouch source.

**Spectrasonics Keyscape's "explicit denial".** **Refuted; dropped.** The sentence the claim rests
on is *"MIDI Control Change, Notes, and Program Change messages are supported, but Pitch Bend and
Aftertouch messages are not currently supported in the MIDI Learn system"* — scoped to the MIDI
Learn subsystem, and shared **verbatim** STEAM-engine boilerplate: the identical sentence ships in
the Omnisphere 2 reference guide, and Omnisphere documents *"Aftertouch – The MIDI note pressure
value (Channel or Polyphonic Aftertouch)"* as a modulation source. A sentence that coexists with
full aftertouch modulation in a sibling product cannot be read as a denial. Keyscape's manual is
**silent** on whether the instrument responds to aftertouch — silence is not denial, and this spec
claims neither.

**NI Noire "routes aftertouch by default to its mechanical layer".** **Refuted as worded; dropped
as briefed, retained in corrected form.** The Noire manual (24 pp., 2019) mentions aftertouch
exactly twice, both on p. 12 under §2.2.2 *Ambience*, both the same trailing sentence: *"You can
also trigger additional piano noises when using aftertouch."* Three corrections: it is the **PIANIST
ambience** group, not the MECHANICAL group (§2.1.2, p. 7, whose controls never mention aftertouch);
it is **gated on the PIANIST On/Off button**, so it is conditional rather than a default; and the
manual makes **no exclusivity claim** about tone or dynamics. The defensible residue — *the one
field precedent for acoustic-piano aftertouch points it at a noise layer rather than at tone* — is
real and is used in §3. The words "default" and "mechanical" are not.

---

## 3. The destination argument

**The rule this section applies:** a destination survives only if a continuous, post-strike change
in it corresponds to something in the modelled instrument that is *still mechanically live* while
the key is held. Everything else is a fake, and ADR 0016 ruling 3 gives no room to ship a fake
behind a flag.

### The escapement argument, stated once

In a piano action the jack releases the knuckle before the hammer reaches the string. From that
moment the hammer is in free flight; it strikes, rebounds, and is caught by the back check. **No
force the player applies afterwards reaches that hammer or that string's excitation.** Pressing
harder into an already-depressed key changes nothing about the note that is sounding. This is not a
modelling shortcut — it is the mechanism the whole action exists to produce, and it is why the
existing docblock at `engine.rs:489-494` is right.

It is corroborated in the field by products that decline the mapping outright: Ivory II (*"Channel
Pressure (Aftertouch) … do not have any effect"*) and the Roland SC-8820 (*"With the initial
settings there will be no effect"*).

**What escapement does not settle** is the damper. The damper is the one part of the mechanism the
player still controls after the strike — it is held clear for as long as the key is down. That is
the gap every survivor below has to fit through, and it is exactly where Pianoteq puts its one
documented aftertouch destination (§9.2, damping of sustained notes).

### Survives: sympathetic-resonance bank gain — the only one

**The destination is the product `sym_amount` at `engine.rs:609-611`**, reached through the existing
`sympathetic_send` `set_param` key. Grounds:

- It is the one **coupling** in the model rather than an excitation. The bank's input is the live
  bridge force of currently-sounding strings (`engine.rs:601`); its output is energy other strings
  are accepting *right now*, continuously, for as long as the note rings. Changing it mid-note does
  not retroactively alter how a hammer struck anything.
- It is **damper-mediated**, which is the one channel escapement leaves open. The bank's bandwidth is
  already driven from damper state every block (`engine.rs:382`), so pressure joins a control the
  model already treats as continuous and post-strike.
- It is **already runtime-settable and already global**, so it needs no new engine surface.
- It has the closest documented precedent: Pianoteq's single acoustic aftertouch destination is
  damping behaviour on sustained notes.

**The honest caveat, which the implementation must not launder away:** real aftertouch pressure past
the key bed does *not* raise the damper further — the damper is fully clear at key-down. So this is
a **convention with a physical rationale, not a physical measurement.** It is defensible because it
modulates a coupling that is genuinely still live, not because a piano does it. State it that way in
the UI copy and in every PR. If that caveat cannot be stated honestly, stop condition 1 applies.

### Argued and cut: the mechanical-noise layer

This was the strongest candidate after sympathetic gain, and Noire (corrected, §2) is the only field
precedent for pointing piano aftertouch at noise rather than tone. **It is cut on GrandBoule's own
code**, on a ground that is not about taste:

**GrandBoule's noise layer has nothing for a continuous signal to ride.** It is a burst generator,
not a bed (§1). `KeyDown`, `HammerLetoff` and `StringPrecursor` all fire once, at note-on, over
3–10 ms — *before any pressure value exists*, since pressure is by definition post-strike.
`DamperLift` fires once at note-off. By the time a pressure value is non-zero, every burst that note
will ever produce has already decayed or has not been triggered yet. A pressure→noise-level mapping
would be applied to silence.

Two further cuts, either alone sufficient:

- **There is no runtime gain to bind to.** `MechanicalNoise` has no gain field, no setter, and no
  `set_param` key; the five levels are a hardcoded `match`. Naming it a destination is also
  specifying new engine surface, which this spec declines to do for a destination it has already
  cut on behaviour.
- **`PedalDown` never fires**, so the one burst type a *held* gesture might plausibly relate to does
  not sound at all.

**This is a cut, not a deferral.** If a continuous mechanical/ambience bed is ever added to
GrandBoule, the question re-opens on its own merits and against a re-verified Noire reading — but
it re-opens as new work, not as a reserved slot in this spec.

### Cut without qualification: string tone, pitch, and dynamics

Not string tone (`tone_tilt`, `tone_color`, `soundboard_brightness`, `hammer_hardness`), not pitch,
not dynamics (`master_gain`, `velocity_curve`). Two independent grounds, either sufficient:

1. **Escapement.** The hammer is in free flight; the player controls nothing about that note's tone.
   A pressure→brightness map is the exact "faking" the existing docblock and guard refuse.
2. **Precedent.** Ivory II denies the mapping outright; the SC-8820 ships it inert; Pianoteq's only
   documented acoustic use is damping; Noire's only documented use is a noise layer. **No verified
   source in §2 shows any acoustic piano product mapping aftertouch to tone, pitch or level by
   default.**

`master_gain` deserves its own sentence because it is the tempting one: a pressure→volume map is
trivial to build and immediately audible, which makes it the most likely thing to appear in an
implementation PR under time pressure. It is a swell pedal on an instrument that has no swell. It is
cut.

### The mono-pressure policy, decided from our own code

**Channel pressure maps to a single global source value; there is no per-note pressure path.**

The reason is structural, not stylistic: **all eighteen of GrandBoule's `set_param` keys are global
engine scalars** (§1). There is no per-voice parameter surface to route a per-note value into.
Channel pressure → a global scalar is coherent. Polyphonic pressure → a global scalar is not — it
would silently collapse per-note intent into whichever note wrote last.

The policy must therefore be **stated and enforced**, not left implicit: when several notes are
held, the source takes one value derived from the incoming channel-pressure stream, and per-note
pressure is not represented. **Which reduction that is — last-write, maximum, or highest active
note — is left to design** (§7); this spec requires only that exactly one is chosen, documented, and
pinned by a guard that distinguishes it from the alternatives.

Polyphonic key pressure is **out of scope with a stated reason**, not deferred vaguely: see §5.

---

## 4. Acceptance criteria

Each states an observable behaviour, the evidence that settles it, and the mutation that reds its
guard. ADR 0015 governs all of them: a guard for which no mutation exists is decoration — delete it
and say so.

**Every guard below names the two values it drives between, and no guard sits at a default.** That
clause is not boilerplate here. `crates/daw-dsp/AGENTS.md` records the same trap in its own words:
each RT guard "drives its engine into a *configured, audibly active* state and asserts non-silence,
because most of these engines early-return when every stage is at its default — a guard wrapped
around an unconfigured instance passes without executing any DSP." §6 states which defaults are the
dead branch for *this* subject.

**Ordering is mandatory.** AC-2 gates AC-4 — a source that never receives pressure on an ordinary
keyboard cannot be shown to drive anything. AC-5 gates the whole set: the existing guard's
replacement defines what is still forbidden before anything is wired.

| Stage | Contents |
| --- | --- |
| 1 | AC-5 (redefine the refusal), AC-2 (the MPE gate) |
| 2 | AC-1 (the source, default-unbound), AC-3 (the curve) |
| 3 | AC-4 (the one destination, audible), AC-6 (RT), AC-7 (the panel spec) |

### AC-1 — An aftertouch source exists on GrandBoule and is bound to nothing by default

A GrandBoule instance exposes channel pressure as a named, assignable map source. **A freshly
created instance, and every shipped preset, has it bound to no destination.** Loading a project
saved before this feature yields an unbound source (ADR 0016 ruling 3: no version gate, no
migration branch — an absent binding is simply unbound).

Precedent: Pianoteq's recommended starting mapping *"Unassign all controllers except pedals and
Pitch Bend"*; VSL's *"Assigned Source: not visible if not assigned"*.

**Evidence.**

1. A spec asserting that a default-constructed GrandBoule state has an aftertouch source present and
   its binding empty, **and** that rendering a held note with pressure driven 0.0 → 1.0 produces
   sample-identical output — i.e. the default state still satisfies the §1 guard's claim.
   Mutation: giving the source any non-empty default binding reds the second assertion.
2. Totality over shipped presets, enumerated **from the preset catalogue at test time**
   (`src/modules/GrandBoule/repositories/grandBoulePresetCatalog.ts`), never from a list in a
   fixture. Mutation: adding a preset with a bound aftertouch source reds it without anyone editing
   the guard.

**The two values:** binding absent vs binding present. **Not** pressure 0 vs 0 — a guard that drives
pressure across a span while the source is unbound is green by construction and proves nothing about
the binding.

### AC-2 — Channel pressure reaches GrandBoule from a non-MPE keyboard

`handleWebMidiChannelPressure.ts:10`'s `if (!getMpeEnabled() || channel < 1) return;` currently
discards channel pressure from every ordinary controller. After this AC, channel pressure on any
channel reaches the GrandBoule source with MPE disabled.

**This is the difference between the feature working and the feature existing.** It is also the AC
most likely to be skipped, because every MPE-mode manual test passes without it.

**Evidence:** a spec that feeds a `0xD0` message on **channel 0 with MPE disabled** and asserts the
GrandBoule source value moves; and a second asserting the MPE per-note path is unchanged, since that
gate exists for a reason and this AC must not flatten it. Mutation: restoring the early return reds
the first and leaves the second green.

**The two values:** MPE disabled / channel 0 (today: dropped) vs MPE enabled / channel ≥ 1 (today:
delivered). A guard that only exercises the second is testing the path that already works — this is
§6(a) in its exact form.

### AC-3 — The source carries a response curve, and the curve changes the delivered value

Raw pressure passes through a per-source response curve before reaching any destination. Precedent:
Pianoteq's separately adjustable Aftertouch curve; Arturia's max-four-breakpoint per-source curve.

**Evidence:** for a fixed input pressure held constant, two different curve settings deliver two
different source values, with both values asserted. Mutation: bypassing the curve (returning raw
normalised pressure) reds it.

**The two values:** the curve setting, not the pressure. **A guard that varies pressure at a fixed
curve does not test the curve** — it tests the mapping, which is AC-4. This is a distinct assertion
and must not be folded into AC-4's.

The curve's representation is **left to design** (§7).

### AC-4 — Bound to sympathetic-bank gain, aftertouch changes rendered audio

The single destination of §3. With the source bound to sympathetic gain, a change in pressure while
a note is held changes the **rendered output of the engine**, measured at the engine boundary.

**The fixture must commit four non-default states or it measures nothing.** This is the criterion
where this campaign's most-repeated failure would land:

1. **Sustain pedal engaged.** The bank's bandwidth is damper-driven (`engine.rs:383-384`); at
   `DAMPED_BANDWIDTH_HZ = 40.0` the bank is nearly inert. **A guard with the pedal at its default
   rest position measures a bank that is switched off**, drives pressure across its full range, sees
   a difference below noise, and either fails mysteriously or is "fixed" by widening a tolerance.
2. **A note actually sounding and ringing.** The bank's input is bridge force (`:601`); with no
   voice, `tick(0.0)` and the destination is unobservable at any gain.
3. **`sympathetic_send` and `sympathetic_level` both non-zero.** `sym_amount` is their product
   (`:609-611`); either at zero makes the entire destination a multiplication by zero, and the
   morph engine writes `sympathetic_level` per piano model.
4. **A measurement window past the attack**, so what is measured is the coupled ring and not the
   hammer transient, which pressure must not touch.

**Evidence.**

1. Render a held note twice under identical fixtures, varying **only** pressure between two stated
   values, and assert the two renders differ by a margin the PR states and justifies. Measure at the
   **engine output**, per `crates/daw-dsp/AGENTS.md`: *"The observation point is part of the claim."*
2. **A `set_param` assertion does not satisfy this AC.** `crates/daw-dsp/AGENTS.md` is explicit —
   *"Guarding `set_param` is not guarding `process`."* Worse here: `engine.rs`'s match ends in
   `_ => {}`, so a misspelled key is silently swallowed and a field-level assertion would pass over
   a destination that never moved. Assert rendered audio.
3. Mutation: reverting the destination write — restoring `_pressure` at `engine.rs:500` — makes the
   two renders identical and reds it.

**The two values:** two pressure values, both stated, **both with the fixture in the state where the
engine behaves differently between them**. Naming the two values is not enough; the PR must say why
the engine differs between them, which for this destination means naming the pedal state.

### AC-5 — The refusal is narrowed, not deleted, and still forbids tone, pitch and dynamics

`pressure_and_slide_are_dropped_rather_than_faked` (`engine.rs:1868`) asserts
`assert_eq!(plain, pressed)` for a full-pressure, full-slide expression call. Once pressure has a
destination that guard is **false as written** — and deleting it would remove the only thing
standing between this feature and a pressure→brightness map.

**It is replaced by a narrower guard that can still fail**, and the replacement must be in the same
PR as the first destination write.

Requirements:

- **Slide stays dropped, unconditionally.** Nothing in this spec gives `_slide` a destination. The
  replacement asserts a slide-only expression call still renders identically. **The two values:**
  slide 0.0 vs 1.0, pressure held at 0.
- **Pressure with the source unbound stays dropped** — this is AC-1's evidence 1, and it is what
  preserves the original guard's meaning for the default product.
- **Pressure never reaches a forbidden destination.** With the source bound to sympathetic gain and
  driven 0.0 → 1.0, assert the forbidden scalars — `tone_tilt`, `tone_color`,
  `soundboard_brightness`, `hammer_hardness`, `master_gain`, `velocity_curve` — are unchanged. This
  is the guard that survives the feature and stops the next PR widening it.
- `NOTE_EXPRESSION_DEVICES` (`noteExpression.ts:74`) is updated in the same change, since its header
  declares it the single source of truth for the live path, the scheduled path and the editor.

Mutation: adding a pressure term to any forbidden scalar reds the third assertion. Mutation:
routing pressure into `set_expression_bend` reds the slide/bend assertions.

Per ADR 0015's consequences clause, the PR states which guard was changed, what it used to prove,
and what now covers that property.

### AC-6 — Mapping evaluation is control-rate and the audio path stays allocation-free and lock-free

`crates/daw-dsp/AGENTS.md` states the contract: **"Allocation-free, lock-free audio path. This is
the RT contract; keep it passing."** `src-tauri/AGENTS.md` §"Real-time invariants (hard)": **"no heap
allocation, no locks, no IPC"** on the audio path.

Requirements:

- Pressure arrives as a MIDI event and is reduced to a source value and applied to the destination
  **at event or block boundary, control-rate** — never per-sample, and never by allocating a
  schedule.
- No new allocation, lock, or unbounded structure on the render path. The `MechanicalNoise` fixed
  32-burst pool is the shape to match: preallocated, no growth.
- Smoothing, if any, uses a fixed-size state — GrandBoule already has `cc_smoothing_ms` and
  `pedals.set_cc_smoothing_ms` for exactly this on the pedal path.

**Evidence:** `grand_boule_process_does_not_allocate_with_notes_held`
(`crates/daw-dsp/tests/device_process_rt.rs:901`) covers the pressure path **with the AC-4 fixture
state committed** — pedal engaged, note sounding, source bound, pressure non-zero — because per that
file's own rule a guard around an unconfigured instance executes no DSP. It already holds three
notes and asserts non-silence (`:930-933`); pedal state and a bound source are what this AC adds.
Mutation: allocating inside the pressure application aborts the test.

**Two things the PR must state or the evidence is void.** The interceptor is **debug-only**: with
`assert_no_alloc`'s `disable_release` feature on by default, `assert_no_alloc(f)` is literally `f()`
in release. Run `cargo test` in debug or you are proving nothing. And a violation calls
`handle_alloc_error`, which **aborts** — expect `SIGABRT` with `memory allocation of N bytes failed`,
not a normal test failure.

If any Rust change lands, `pnpm wasm:verify` runs in the same PR — a conflict-free rebase ships stale
wasm silently.

### AC-7 — The two contradicted assertions in the landed panel spec are replaced deliberately

`MidiCalibrationPanel.spec.tsx:31` asserts no `/aftertouch/i` text and `:32` asserts exactly five
sliders. Both become false. **They are not to be quietly edited**, and the count is not to be bumped
from 5 to 6 with no other change — that converts a meaningful assertion into a tautology tracking
whatever the panel happens to render.

Requirements: the replacement asserts the aftertouch control is **present and routed** — the
conditional-rendering gate, absent vs present-and-wired-to-its-callback — per the house rule that a
test verifies a callback argument, a state mutation, or a rendering gate, never mere existence. The
prose refusal at `MidiCalibrationPanel.tsx:9-14` is rewritten to state the new position rather than
deleted; it is the record of why the shape is a map source and not a sensitivity knob.

Any new calibration field is added to `MIDI_CALIBRATION_RANGES`
(`GrandBouleMidiCalibration.ts:32`) in the same change, or `setMidiCalibrationParam` clamps against
`undefined`. Mutation: removing the range row reds a clamp assertion.

**Also fix in passing, since the file is open:** `resetMidiCalibration.ts:25` says "Four of the six
values" for a type with five fields. It is wrong today.

---

## 5. Out of scope

- **Polyphonic key pressure (`0xA0`), with a stated reason.** Not deferred vaguely — ruled out on
  two independent grounds. (i) It does not exist anywhere in this repository: no status constant, no
  parse arm in `messageHandlers.ts`, no type variant, no Rust path. Supporting it is work in
  `WebMidiTypes.ts`, `messageHandlers.ts`, `handleWebMidiMessage.ts` and a new handler — **it is a
  MIDI-module feature, not a GrandBoule feature**, and it does not belong in this spec's diff.
  (ii) Even delivered, it would have nowhere to land: all eighteen GrandBoule engine scalars are
  global (§1, §3), so per-note pressure would collapse to a global value and misrepresent itself.
  The brief asked for poly pressure "if it is cheap to support". **It is not cheap, and this is the
  measurement that answers the question.** If poly pressure is wanted, it is its own spec, and its
  first requirement is a per-voice parameter surface GrandBoule does not have.
- **MPE slide (CC 74) and any per-voice timbre control.** `_slide` stays dropped; AC-5 pins it.
- **A per-voice parameter surface for GrandBoule.** Large, and nothing here needs it.
- **Reusing the `Automation` modulation matrix.** `ModulatorKind`
  (`src/modules/Automation/models/Modulator.ts:1`) is `'lfo' | 'envelope' | 'step'` with no MIDI
  source kind, and `ModulatorMapping` (`:30`) targets `targetParamId` — a coherent host for this
  source, but adopting it is a design decision (§7), not a requirement.
- **`ControlSurface` MIDI learn.** `MidiMapping` (`stores/midiLearnStore.ts:15`) is keyed on
  `(channel, cc)` with no source discriminator; channel pressure has no CC number and cannot be
  expressed without a schema change. Noted so nobody rediscovers it mid-implementation.
- **Automating the aftertouch source or its destination from a lane.** GrandBoule is `0/3` in the
  automation census and is an explicit reasoned exclusion in
  `.agents/specs/parameter-automation-coverage/spec.md`. Do not silently re-open it.
- **Mechanical-noise runtime surface** (a gain field, a `set_param` key, the dead `PedalDown`
  trigger). Cut in §3; if it is wanted it is wanted for its own reasons.
- **Desktop**, per ADR 0016 ruling 1. Web target is Chromium-only per the Chrome-first capability
  position; no second-engine branch is added for this feature.

---

## 6. Two traps this spec's guards must not fall into

**(a) A guard can exercise the exact path, produce output, assert what it means to, and still be
blind — because the defective branch is only reachable at a non-default value.** This is the
campaign's most-repeated failure and `crates/daw-dsp/AGENTS.md` already records it in the RT guards'
own terms.

The defaults that are the dead branch **for this subject**, named so no fixture drifts onto them:

| Default | Why it is the uninteresting branch |
| --- | --- |
| Sustain pedal at rest | `sympathetic.set_damping` from `pedals.sympathetic_damping()` (`engine.rs:382`) puts the bank at `DAMPED_BANDWIDTH_HZ = 40.0`. The destination is effectively switched off. |
| No note sounding | Bank input is bridge force (`engine.rs:601`). `tick(0.0)` — nothing to modulate at any gain. |
| Aftertouch source unbound (the AC-1 default) | Correct for AC-1, fatal for AC-4. A pressure sweep against an unbound source is green by construction. |
| MPE disabled | Correct end state for AC-2, but pressure is dropped at `handleWebMidiChannelPressure.ts:10` *today*. An AC-4 fixture that routes through the live MIDI path with MPE off measures nothing until AC-2 lands — which is why AC-2 gates AC-4. |
| `sympathetic_send` or `sympathetic_level` at 0 | `sym_amount` is their product (`engine.rs:609-611`). Zero either factor and the destination is a multiply by zero. |

**(b) An assertion that matches a symbol rather than a call.** `engine.rs`'s `set_param` match ends
in `_ => {}`, so a wrong key is a silent no-op. Every coverage claim here matches **rendered audio or
an observed call**, never an identifier in a file and never a field read back from the struct that
the same test wrote.

---

## 7. Deliberately left to design

A spec states requirements and acceptance criteria. A design states the mechanism and waits for a
measurement. **The following are not specified here, on purpose — specifying them would prejudge a
measurement or a UX judgement that has not been made.** An implementation PR that picks one of these
and states why is doing its job; a reviewer must not treat the absence as an omission.

1. **The response curve's representation.** Arturia uses a max-four-breakpoint curve; Pianoteq uses
   arbitrary editable control points; GrandBoule's existing velocity control is a single exponent
   (`velocityCurveExponent`). AC-3 requires only that the curve exists and demonstrably changes the
   delivered value. Which representation is a UX call plus a consistency call against the panel's
   existing knobs.
2. **The depth and shape of pressure → `sym_amount`.** Linear, perceptual, or a bounded offset; and
   what maximum depth is musical. This is a **measurement at the engine output**, not a number to
   assert in advance. AC-4 requires a stated, justified margin — it does not fix the law.
3. **Where the source lives.** A new field on `GrandBouleMidiCalibration` alongside the existing five,
   or a new `ModulatorKind` in the `Automation` matrix reused by every device. The second is more
   general and more invasive; the first is local and duplicates a concept. Both satisfy every AC
   here. **Not decided.**
4. **The mono-pressure reduction.** §3 requires exactly one of last-write / maximum / highest-active-
   note to be chosen, documented, and pinned by a guard that distinguishes it from the alternatives.
   **Which one is design** — and the Pianoteq precedent that would have settled it did not verify
   (§2).
5. **Smoothing.** Whether pressure needs slew on its way to gain, and with what time constant.
   `cc_smoothing_ms` exists for the pedal path and may be the right precedent or the wrong one. AC-6
   constrains only that whatever is chosen is fixed-size and control-rate.
6. **The panel's control layout** — where the source and its curve sit, and whether the destination
   binding is a menu or a learn gesture.

---

## 8. Stop conditions

Report; do not design around. **Reporting a stop condition is a successful outcome in this
programme, not a failure.**

1. **Implementation would require faking a pressure response the physical model refutes.** If
   sympathetic-bank gain turns out not to be reachable honestly — if the only way to make aftertouch
   *audible* is to touch hammer, string or output level — **report and build nothing.** The correct
   outcome is then that GrandBoule keeps `pressure_and_slide_are_dropped_rather_than_faked` exactly
   as it stands at `engine.rs:1868` and this spec closes unimplemented. That is a good result: the
   removal of `afterTouchSensitivity` was right, and confirming that no honest destination exists
   confirms it twice.
2. **The one destination is inaudible at any honest depth.** If pressure → `sym_amount` cannot be
   heard without a depth that swamps the bank or audibly pumps the ring, the destination list is
   empty and stop condition 1 applies. **Do not widen the destination list to find something
   audible** — that is how `master_gain` gets in.
3. **AC-2 cannot be satisfied without breaking MPE routing.** If channel pressure cannot reach a
   global source on channel 0 without disturbing the per-note MPE path at
   `handleWebMidiChannelPressure.ts`, report the conflict. A global source and a per-note source
   competing for one message is a MIDI-module design question, not something to resolve inside a
   GrandBoule PR.
4. **AC-5's replacement cannot be made to fail.** If no mutation reds the narrowed refusal guard, it
   is decoration — per ADR 0015 say so and delete it rather than keeping it because it is green,
   and state plainly that nothing then prevents a future PR mapping pressure to tone.
5. **The RT guard cannot be driven into an audibly active state.** If the `device_process_rt.rs`
   `grand_boule` arm cannot commit pedal-engaged, note-sounding, source-bound state, AC-6 has no
   evidence and the RT claim is unproven. **Narrow the claim; do not assert an unexercised path is
   allocation-free.**
6. **The §1 measurements do not reproduce.** The `set_param` list, the `sym_amount` product, the MPE
   gate and the noise-burst trigger sites were read on `2b141b033`. If a re-derivation on a later
   commit disagrees, re-derive and re-argue §3 before implementing against this text — §3's
   destination list is downstream of those facts and does not survive them changing.

---

## 9. Verification

- Failing reproduction first for each behavioural criterion, with real output pasted.
- Every guard mutation-checked with the reding assertion named, per ADR 0015. Every guard states the
  two values it drives between **and why the engine behaves differently between them** (§6a).
- Every coverage assertion matches rendered audio or an observed call, never an identifier in a file
  and never a field the same test wrote (§6b).
- AC-4 measured at the engine output — *"The observation point is part of the claim"*
  (`crates/daw-dsp/AGENTS.md`).
- Run affected RT guard targets in **debug**; a release run proves nothing (AC-6).
- Run each affected test once through guarded package scripts; quote its exit code.
- `pnpm typecheck` and `pnpm typecheck:test` at zero; `pnpm deps:validate` after any cross-module
  move.
- If any Rust change lands, `pnpm wasm:verify` in the same PR.
- Every `file:line` in a PR re-derived against the branch it ships from. The citations here were
  checked against `2b141b033`; they go stale.
- No config, baseline, expected value or tolerance edited to make a gate pass unless the value
  genuinely changed and the measurement is stated. Widening AC-4's margin to obtain a difference is
  the specific evasion this spec is most exposed to.

---

## 10. Status

**draft.** The campaign requires adversarial review before implementation. Not ready.

Two things a reviewer should attack first: whether **sympathetic-bank gain survives §3's own rule**
(the caveat in §3 concedes that pressure does not physically raise a damper further — is that
convention honest enough to ship, or does stop condition 1 already apply?), and whether **§2's four
dropped citations leave the destination argument standing on enough** — with Pianoteq's mono policy,
VSL's source list, the Keyscape denial and Noire's default all removed, the load is carried by
Pianoteq §9.2, Ivory II p. 66 and the SC-8820 p. 168, and by GrandBoule's own code.
