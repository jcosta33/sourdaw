---
type: spec
id: SPEC-parameter-automation-coverage
subject: which device parameters a lane may drive, and which of those survive an offline render — decided per parameter, not per device
status: draft
repo: sourdaw
date: 2026-08-04
blocked_by: SPEC-offline-live-collapse
blocks: none recorded
governs: ADR 0015 (every guard here), ADR 0016 ruling 3 (no legacy path)
sources:
  - .agents/specs/render-parity-instrumentation/spec.md (Phase 1, landed)
  - .agents/specs/offline-live-collapse/spec.md (Phase 2, ready)
  - .agents/artifacts/sourdaw/SURVEY-ultracode-scope.md — offline-native-effect-automation-dropped,
    automation-param-id-dual-registry, offline-automation-census-blind, proofchamber-handrolled-block-rate-automation
  - .agents/decisions/0015-a-guard-must-be-able-to-fail.md
  - .agents/decisions/0016-ultracode-session-scope-and-standard.md
---

# Parameter-level automation coverage

Phase 2 asks a per-**device** question: does this device accept a scheduled parameter at all? Four
devices answer no, and Phase 2's AC-4 fixes them. Answering that question exposes a second one it
does not ask and its census cannot see: **inside the three devices that do accept scheduled
parameters, most of their automatable parameters still do not.** Fermenter reaches 15 of 105.

That gap is not in the survey. `offline-native-effect-automation-dropped` names Gluten, Bacteria,
Grinder, Proof and (wrongly) Knead — the device-level class.
`proofchamber-handrolled-block-rate-automation` notes in passing that ProofChamber "covers exactly
two parameters". Nothing anywhere records that Fermenter, the flagship instrument, drops ninety.

**This spec is about the parameter-level class only.** The device-level class belongs to Phase 2 and
is not re-opened here.

---

## 1. The measurement, re-derived

Enumerate `NATIVE_DSP_DEVICE_FACTORIES`
(`src/modules/AudioEngine/repositories/deviceStrategy/nativeDspDeviceFactories.ts:173`), cross each
entry with the `automatable: true` parameters its `getBuiltinPlugins()` descriptor declares, and
intersect with the parameters the device's node accepts through `acceptsScheduledParam`. Measured on
`f6d398786`:

```
FACTORIES=13   VERDICTS=20   EXEMPTIONS=285

fermenter        15/105        gluten            0/43
toaster           3/4          crust             0/13
levain            0/4          bacteria          0/62
builtin-crumbs    0/10         grinder           0/41
grand-boule       0/3          proof             0/3
dutch-oven        2/17         native-scoring    0/0
knead            NO DESCRIPTOR
```

**The 285 splits in two, and keeping them apart is the whole point of this spec.**

| Class | Count | Devices | What one row means |
| --- | --- | --- | --- |
| **Device-level** | **179** | levain 4, builtin-crumbs 10, grand-boule 3, gluten 43, crust 13, bacteria 62, grinder 41, proof 3 | The node declares no `scheduleParam` at all. One reason covers every parameter on the device. Phase 2 AC-4 owns four of these eight. |
| **Parameter-level** | **106** | fermenter 90, dutch-oven 15, toaster 1 | The device *does* schedule. This parameter is not in its map. Every row needs its own reason. |

179 + 106 = 285. **An earlier count of 265 device-level pairs circulated and does not reconcile:
265 + 106 = 371, not 285.** Re-derived here it is 179. Do not carry the 265 forward.

The 106, by declared parameter type:

| | `float` | `int` | `bool` | total |
| --- | --- | --- | --- | --- |
| fermenter | 72 | 18 | 0 | 90 |
| dutch-oven | 13 | 0 | 2 | 15 |
| toaster | 1 | 0 | 0 | 1 |
| **total** | **86** | **18** | **2** | **106** |

The eighteen Fermenter `int` parameters are: `oscEngine`, `oscWaveform`, `oscCoarse`, `oscFine`,
`unisonVoices`, `noiseColor`, `warpMode`, `audioModTarget`, `additivePartials`, `samplerMode`,
`filterModel`, `filterMode`, `fmAlgorithm`, `lfoShape`, `portamentoMode`, `reverbType`,
`activeLayer`, `numLayers`. The two `bool` are dutch-oven `freeze` and `shimmer`. **That histogram
is a signal for AC-1, not its answer** — `oscCoarse` is an `int` a DAW automates and `oscEngine` is
an `int` no DAW automates, and both land in the same column.

### The command that produces it

There is no committed instrument for this today — building one is AC-2. Until it exists, the table
above is reproduced by writing this probe, running it, and deleting it. It is deterministic: two
runs on `f6d398786` produced byte-identical output, both `exit 0`.

```ts
// src/modules/AudioEngine/repositories/deviceStrategy/__tests__/tmpCensusProbe.spec.ts
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { getBuiltinPlugins } from '#/modules/Arrangement/useCases';
import { FERMENTER_AUTOMATION_PARAM_IDS } from '../../../engine/FermenterNode';
import { PROOF_CHAMBER_AUTOMATION_PARAM_IDS } from '../../../engine/ProofChamberNode';
import { TOASTER_AUTOMATION_PARAM_IDS } from '../../../engine/ToasterNode';
import { NATIVE_DSP_DEVICE_FACTORIES } from '../nativeDspDeviceFactories';

const SCHEDULED: Record<string, Readonly<Record<string, number>>> = {
    fermenter: FERMENTER_AUTOMATION_PARAM_IDS,
    toaster: TOASTER_AUTOMATION_PARAM_IDS,
    'dutch-oven': PROOF_CHAMBER_AUTOMATION_PARAM_IDS,
};

describe('census probe', () => {
    it('prints', () => {
        const plugins = getBuiltinPlugins();
        let verdicts = 0;
        let exemptions = 0;
        const lines: string[] = [];
        const paramLevel: string[] = [];
        for (const factory of NATIVE_DSP_DEVICE_FACTORIES) {
            const descriptors = plugins.filter((p) => factory.matches(p.id));
            if (descriptors.length === 0) {
                lines.push(`${factory.type} NO DESCRIPTOR`);
                continue;
            }
            const automatable = descriptors.flatMap((d) => d.parameters.filter((p) => p.automatable));
            const sched = SCHEDULED[factory.type];
            const covered = automatable.filter((p) => sched !== undefined && Object.hasOwn(sched, p.id));
            verdicts += covered.length;
            exemptions += automatable.length - covered.length;
            lines.push(`${factory.type} ${covered.length}/${automatable.length}`);
            if (sched !== undefined) {
                for (const p of automatable) {
                    if (!Object.hasOwn(sched, p.id)) {
                        paramLevel.push(`${factory.type}\t${p.type}\t${p.id}\t${p.minValue}..${p.maxValue}`);
                    }
                }
            }
        }
        writeFileSync(
            '/tmp/census.txt',
            [
                `FACTORIES=${NATIVE_DSP_DEVICE_FACTORIES.length}   VERDICTS=${verdicts}   EXEMPTIONS=${exemptions}`,
                ...lines,
                `PARAM_LEVEL_GAP=${paramLevel.length}`,
                ...paramLevel,
            ].join('\n')
        );
    });
});
```

```
pnpm test:run src/modules/AudioEngine/repositories/deviceStrategy/__tests__/tmpCensusProbe.spec.ts
```

The exact file keeps collection inside the affected surface.

### `knead NO DESCRIPTOR` is a different defect and gets its own criterion

`knead` is in `NATIVE_DSP_DEVICE_FACTORIES` and in `NATIVE_DSP_DEVICE_TYPES`
(`src/utils/nativeDspDeviceTypes.ts:44`) and has no arm in `NativeDspDescriptors.ts` and no
`KneadDescriptor.ts`. A device with an incomplete descriptor declares parameters and covers some of
them. A device with **no** descriptor is outside all three laws at once, and two of them fail open —
see AC-6. It is not an exemption row and must not be entered as one.

---

## 2. Four things to confront before listing anything

### 2.1 `automatable: true` was never a per-parameter judgement in the descriptors that carry the gap

Six descriptor files set `automatable` exactly once, inside the `.map()` that builds every parameter
in the family:

| File | Line | Parameters it covers |
| --- | --- | --- |
| `FermenterDescriptor.ts` | `:197` | all 105 |
| `BacteriaDescriptor.ts` | `:144` | all 62 |
| `GlutenDescriptor.ts` | `:89` | all 43 |
| `GrinderDescriptor.ts` | `:91` | all 41 |
| `CrustDescriptor.ts` | `:43` | all 13 |
| `FaustEffectDescriptors.ts` | `:32` | all |

The same `.map()` derives the type from a step hint — `type: param.step === 1 ? 'int' : 'float'`
(`FermenterDescriptor.ts:190`) — so a Fermenter parameter's `automatable` flag and its declared type
are both mechanical, and neither records a decision about that parameter.

By contrast the hand-authored descriptors do decide per parameter and do write `false`:
`NativeDspDescriptors.ts` marks dutch-oven's `Algorithm`, `Vintage` and `Saturation`
non-automatable; `LevainDescriptor.ts` marks two; `BuiltinInstrumentDescriptors.ts` and
`BuiltinEffectDescriptors.ts` mark many.

**So "declared `automatable: true`" carries information for dutch-oven and none for Fermenter.** A
plan that treats all 106 as a work queue is planning against a constant. That is why AC-1 is the
audit and everything else depends on it.

### 2.2 The Phase-1 null test is the right instrument and does not reach a single parameter here today

`liveOfflineNullTest.spec.ts` + `nullTestRenderHarness.ts` (budget ≤ −90 dBFS, anything above
−60 dBFS a defect) is the correct acceptance instrument in principle: an automated parameter that
does not reach the offline path is exactly a live/offline divergence, which is what that harness
subtracts. **It reaches none of these 106 parameters, for two independent reasons, and both must be
stated wherever this spec's acceptance is claimed.**

- **Device coverage.** Its own header, `liveOfflineNullTest.spec.ts:83-88`: four of nineteen builtin
  device types are fixtured, and **no wasm device at all**. Fermenter, Toaster and ProofChamber are
  all wasm devices. Closing this is Phase 2 AC-0's browser harness, which is **not built**.
- **Automation coverage.** Its own header, `:89-90`: *"All `AudioParam` automation. Params are
  settled before frame 0; a lane that moves during the render is out of scope by construction."*
  **Phase 2 AC-0 does not close this.** AC-0 drives "an identical parameter set and note sequence";
  a moving lane is a fixture class neither harness has.

Both are needed. Neither exists. **Zero of this spec's parameters are provable by null test today**
— so AC-4 splits its evidence into what is writable now and what is deferred, and the deferred half
is a committed list with a row per parameter, not a caveat sentence.

### 2.3 Correcting a descriptor removes a live capability, and that is an owner decision

`isDeviceParameterAutomatable` (`DeviceParameterLaw.ts:74-79`) is not only the lane picker's filter
(`automationViewHelpers.ts:49,79`). It is read by the **live** applier at
`applyAutomation.ts:45-53`, whose own docblock says the flag "is now read here, where the decision
is actually made, rather than only where lanes are offered."

So flipping a parameter to `automatable: false` stops an existing lane from driving it **in
playback**, not merely in a bounce. Per the campaign brief that is "what capability is removed" — an
owner decision, forked with reasoning and a recommendation before the edit. ADR 0016 ruling 3
removes the option of a version-gated path: whatever is decided applies to every existing project
with no legacy branch.

### 2.4 Every parameter moved into coverage grows an unpinned positional mirror

The scheduled path deliberately bypasses the string bridge. `FermenterNode.ts:294-313` posts
`{ type: 'paramAutomation', paramId, segments }` where `paramId` is the ordinal from
`FERMENTER_AUTOMATION_PARAM_IDS` (`:31-46`); the worklet interpolates and calls
`inst.set_param_by_id(paramId, value)` (`fermenterProcessor.ts:433-458`); Rust indexes
`AUTOMATION_PARAM_NAMES: [&str; 15]` positionally (`crates/daw-dsp/src/fermenter/mod.rs:43-59,
94-98`).

**The two tables use different names on each side by design** — `oscLevel`/`osc_level`,
`filterCutoff`/`cutoff`, `filterResonance`/`resonance`, `lfoPitchAmount`/`mod_lfo_to_pitch`,
`filterEnvAmount`/`mod_env_to_filter`. Their only contract is ordinal agreement, and no textual pin
can express it. Survey `automation-param-id-dual-registry` (VERIFIED) records that Toaster's third
is pinned behaviourally by `src/modules/AudioEngine/wasm/__tests__/dawDspToasterAutomation.spec.ts`
against the shipped binary, and that **Fermenter's fifteen and ProofChamber's two are not.**

Growing that unpinned array from 15 toward 105 before pinning it is the defect, not the fix. AC-3
therefore blocks AC-4.

---

## 3. Primary sources

- **`AudioParamDescriptor.automationRate: 'a-rate'`** and `AudioWorkletProcessor.parameterDescriptors`
  — `process()` receives a `Float32Array` of render-quantum length, **or length 1 when the value is
  constant across the block**. Cited because it is the alternative delivery mechanism this spec does
  **not** adopt (see Out of scope), and because `grinderProcessor.ts` already uses it for eleven
  contract params, so the comparison is available in-repo rather than hypothetical.
- **Render quantum — 128 frames**; 128/48000 = 2.667 ms is the Phase-1 cost-table budget. Relevant
  because the offline scheduled path resolves **once per quantum**, not per sample:
  `this._applyParamAutomation(currentFrame)` at `fermenterProcessor.ts:527`, called from `process()`
  at block start. **Say "block-rate", not "sample-accurate", anywhere this spec's coverage is
  described.**
- **VST3 `IParameterChanges`, AU `AudioUnitScheduleParameters`, CLAP `clap_event_param_value`** —
  every commercial host delivers automation as timestamped parameter events on the same processing
  call that renders the block, so bounce and playback consume one event stream. The survey cites
  these as the standard approach for the device-level class; they are equally the standard for the
  parameter-level class and settle the "which parameters" question the same way: **hosts expose the
  plugin's own declared automatable set, and a plugin declares a mode switch as a stepped or
  discrete parameter rather than omitting it.** That is the source for AC-1 admitting a third class
  rather than a binary.

Re-check each against the version read; the W3C REC (17 June 2021) and the Editor's Draft renumber.

## 4. Findings this spec acts on that carry `not independently verified`

**None.** The four survey findings this spec touches — `offline-native-effect-automation-dropped`,
`automation-param-id-dual-registry`, `offline-automation-census-blind`,
`proofchamber-handrolled-block-rate-automation` — are all marked VERIFIED, and the first two carry
verifier corrections this spec has adopted rather than restated (Knead has no descriptor; Toaster's
ordinals are already behaviourally pinned). The central measurement in §1 is new and was derived
here, not inherited.

---

## 5. Acceptance criteria

Each states an observable behaviour, the evidence that settles it, and the mutation that reds its
guard. ADR 0015 governs all of them: a guard for which no mutation exists is decoration — delete it
and say so.

**Ordering is mandatory.** AC-1 produces the number every later criterion is sized against; AC-3
gates AC-4; AC-5 needs AC-1's class-(b) list and an owner answer before a single descriptor edit.

| Stage | Contents |
| --- | --- |
| 1 | AC-1 (the audit), AC-2 (the census) — AC-2 may run in parallel, but AC-1's classification is what its exemption rows carry |
| 2 | AC-3 (the ordinal pin), AC-5 fork (the owner question) — both are gates, not fixes |
| 3 | AC-4 (per-parameter coverage, class (a)), AC-5 edits (class (b)), AC-6 (Knead) |

### AC-1 — Every one of the 106 parameter-level pairs is classified, the split is published, and the real number is stated

**This is the spec.** The other criteria are how its answer is enforced.

Not every parameter declared `automatable: true` should be schedulable. Continuous ones plainly
should — cutoff, gain, drive, detune, mix, decay. Structural ones plainly should not — engine type,
sample id, filter model, layer selection. **Where a parameter is declared automatable but is
structurally unschedulable, the descriptor is wrong and correcting it is the fix**, not building a
scheduler path for it. No DAW automates an oscillator's engine selector as a ramp.

**Three classes, and the third is not optional.** A binary split forces the two dutch-oven `bool`
parameters and `oscCoarse` into whichever side is less wrong, and a reviewer cannot tell afterwards
which rows were judged and which were rounded.

- **(a) continuous** — the value is meaningful at every point between two settings, and a ramp
  through it is a musical result. Fix: wire it (AC-3, then AC-4).
- **(b) structural** — the value selects a discrete configuration, and intermediate values are not
  states the engine has. Fix: `automatable: false` (AC-5). Reverb `freeze` is **not** here merely
  for being `bool`; a reverb freeze is an automated switch in every host that ships one.
- **(c) discrete-but-automatable** — a curve over it is meaningful, but only as a **step**, never a
  ramp. Integer musical steps (`oscCoarse` in semitones, `oscFine` in cents) and switches
  (`freeze`, `shimmer`). Fix: either a hold semantic the current contract cannot express — the
  offline `OfflineAutomationSegment` is `{startFrame, endFrame, startValue, endValue}` and the
  processor linearly interpolates it (`fermenterProcessor.ts:446-451`), while live runs an
  exponential `slewStep` (`applyAutomation.ts:248`) — or reclassification to (b) with the reason
  recorded. **Class (c) resolving entirely into (b) is an acceptable and reportable outcome.**

**The rubric is stated once and applied uniformly**, and each row carries: device, parameter id,
declared type, declared range, whether the engine setter quantises the value it receives, what a
shipping DAW does with the equivalent control, and the verdict with its reason. Rows are not
grouped; 106 rows.

**State the real number.** The size of AC-3 and AC-4 is `count(a) + count(c)-resolved-to-(a)`, and
the size of AC-5 is `count(b)`. **It may be far below 106.** If most of the 106 are descriptor
errors, say so plainly and in the PR title — that materially changes the size of everything after
it and is stop condition 1, not a disappointment.

**Evidence.**

1. **The classification table, committed** under `.agents/specs/parameter-automation-coverage/`,
   one row per pair, totalling 106, with the three counts stated at the top.
2. **A failing reproduction for the class-(b) verdict, not an assertion of taste.** Live automation
   slews **every** device parameter — `slewStep(prev, value, AUTOMATION_SLEW_ALPHA)`
   (`applyAutomation.ts:248`) — and the only law applied afterwards is a range clamp:
   `clampDeviceParameterValue` (`DeviceParameterLaw.ts:49-64`) compares against `minValue`/`maxValue`
   and performs **no step or integer quantisation anywhere**. So a lane on `oscEngine` delivers
   fractional engine indices to the DSP today, in playback. A spec that drives a lane from
   `oscEngine = 0` toward `oscEngine = 6` and asserts the sequence of values the device receives
   contains non-integers is the reproduction. Mutation: adding step quantisation to the write law
   reds it. **This is a live-path defect the audit surfaces, and it argues class (b) from behaviour
   rather than from opinion.**
3. **Totality, enforced by AC-2's census**: a pair in the population with no classification row
   reds. Mutation: adding a synthetic automatable parameter to a scheduling-capable descriptor must
   red the totality check without anyone editing the census.

**The population is enumerated from the registry at test time** — `NATIVE_DSP_DEVICE_FACTORIES`
crossed with `getBuiltinPlugins()` — never from the table in §1 and never from a list in the
classification file. See §7.

### AC-2 — A per-parameter census that keeps the number knowable, and reports the two classes separately

Phase 2 AC-3 rewrites `offlineAutomationCoverage.spec.ts` as a per-**device** census. That census
cannot see this spec's subject: a device passes it the moment it schedules one parameter. This AC is
the per-**parameter** verdict.

**Only one census may exist.** Whichever of the two lands second extends the first; it does not
introduce a second population, a second exemption table or a second file. If Phase 2 AC-3 lands
first, this AC is a strengthening of it and says so in the PR.

Requirements, satisfying ADR 0015 rule 2 in full:

- **(i) Population from the registry production uses.** Every entry in `NATIVE_DSP_DEVICE_FACTORIES`
  crossed with every `automatable: true` parameter its `getBuiltinPlugins()` descriptor declares.
  Cardinality pinned against `NATIVE_DSP_DEVICE_FACTORIES.length` **sourced directly**, not derived
  from the census's own walk.
- **(ii) A verdict per pair.** `NativeDspDeviceStrategy.resolveOfflineAutomation(parameterId)`
  (`NativeDspDeviceStrategy.ts:49-55`) returns a non-null binding, or the pair carries an exemption
  row.
- **(iii) A named, reason-bearing exemption table**, in the shape `nodelessOfflineDeviceTypes.ts`
  and `unrenderableCatalogDeviceTypes.ts` already use. Each parameter-level row carries its AC-1
  class.
- **(iv) The two classes are counted and asserted separately.** Device-level rows (the node declares
  no `scheduleParam`) carry one shared reason and one count; parameter-level rows carry individual
  reasons and their own count. Today: **179 device-level, 106 parameter-level, 285 total, 20
  verdicts.** A census reporting only a total hides the entire subject of this spec — that is how
  the gap survived Phase 2's own census design.
- **(v) `knead` produces a distinct `NO DESCRIPTOR` verdict**, not an exemption row.

**Mutations, all five required.** The first four are Phase 2 AC-3's set; the fifth is what makes
this census per-parameter rather than per-device.

1. Deleting an exemption row while the pair is still incapable must red.
2. Making an exempt pair capable without deleting its row must red — the exemption cannot rot.
3. Called with a synthetic factory that declares automatable params and supplies no `scheduleParam`,
   the census reports it.
4. **With the production registry**, adding a synthetic incapable entry to
   `NATIVE_DSP_DEVICE_FACTORIES` must red — this exercises the *enumeration*, which is the half that
   historically went blind.
5. **Adding one parameter to `FERMENTER_AUTOMATION_PARAM_IDS` without deleting its exemption row
   must red, and removing one must red the opposite way.** Mutation 4 alone leaves a per-device
   census green through all 90.

**Do not assert against `coveredFamilies > 1`.** That is the assertion ADR 0015 opens with, and the
device it is satisfied by is the one this spec is about.

### AC-3 — The ordinal binding is derived from one source, or pinned behaviourally, before any parameter is added

Blocks AC-4 entirely.

The requirement is that the ordinal an offline segment carries reaches the parameter the TS map
names, and that inserting an entry cannot shift the parameters already scheduled. Two acceptable
shapes, in order of preference:

1. **One source.** A `#[wasm_bindgen] automation_param_names() -> Vec<String>` read at worklet init
   and used to build the TS map, or codegen from the Rust source. The repo already generates worklet
   glue and stamps provenance in `scripts/`. This is the survey's remedy for
   `automation-param-id-dual-registry` and it makes the rest of this AC unnecessary.
2. **A behavioural pin**, if 1 is deferred. For **each** id in `FERMENTER_AUTOMATION_PARAM_IDS` and
   `PROOF_CHAMBER_AUTOMATION_PARAM_IDS`, drive that ordinal through the real shipped wasm instance
   and assert the parameter that moves is the one the map names — the pattern
   `src/modules/AudioEngine/wasm/__tests__/dawDspToasterAutomation.spec.ts` already uses for
   Toaster's three.

**A name-to-name string comparison does not satisfy this and must not be offered as an alternative.**
The two sides use different names deliberately (`oscLevel`/`osc_level`,
`lfoPitchAmount`/`mod_lfo_to_pitch`), so a textual pin is unwritable, and a length pin
(`AUTOMATION_PARAM_NAMES: [&str; 15]` against `Object.keys(...).length`) compares two hand-written
constants and survives a transposition — ADR 0015 rule 3.

**Evidence:** whichever shape ships, plus the mutation. Mutation: **transposing two entries in
`crates/daw-dsp/src/fermenter/mod.rs:43-59` reds it.** Under shape 1 that is a compile-or-runtime
consequence; under shape 2 it is a named behavioural assertion. If the mutation is run against a
checked-in `.wasm` rather than a rebuild, say so and run `pnpm wasm:verify` in the same PR — a
conflict-free rebase ships stale wasm silently.

**Sizing note for the PR, not a requirement:** shape 2 costs one behavioural assertion per id, and
AC-4 will add up to ninety more ids. That asymmetry is the argument for shape 1 and the PR should
make it with the count attached.

### AC-4 — Each class-(a) parameter renders as a moving value in an export, proven per parameter

**Two pieces of evidence per parameter, and the second is deferred, not waived.**

**Evidence 1 — the value stream at the setter. Writable today, in Vitest, with no browser.** The
offline interpolation is JavaScript, not Rust: `_applyParamAutomation`
(`fermenterProcessor.ts:433-458`) walks the segment schedule, interpolates, and calls
`inst.set_param_by_id(paramId, value)`; it is invoked once per quantum from `process()` at `:527`.
The processors already have unit harnesses under `src/modules/AudioEngine/services/__tests__/`
(`grinderProcessorTestHarness.ts` is the model). So, per parameter: render N quanta with a lane, and
again with the lane's initial value held static, and assert **the sequence of `set_param_by_id`
calls for that ordinal differs between the two runs** and matches the compiled segments sampled at
the quantum grid, within a tolerance the PR states and justifies.

Mutation: restoring the `continue` at `automationScheduling.ts:217` for that device reds every
class-(a) row on it — the two runs become identical.

**Evidence 2 — the signal-level null. Deferred, listed, and closed later.** Budget ≤ **−90 dBFS**,
anything above **−60 dBFS** a defect, not tolerance. Per §2.2 it needs **both** Phase 2 AC-0's
browser harness (device coverage) **and** a moving-lane fixture class, which AC-0 does not itself
add. Requirement: **a committed deferred list with one row per class-(a) parameter**, each row
naming the fixture that will null it and what it will null against. Not a sentence in a header; a
table that shrinks as rows close.

**The observation point is part of the claim, and the header must say so.** Evidence 1 proves the
value reached the engine's parameter setter. It does **not** prove the audio changed. A parameter
whose setter writes a field nothing reads passes evidence 1 and fails evidence 2 — which is exactly
why evidence 2 is not optional and why "wired" is not a synonym for "audible" anywhere in this
spec's PRs.

**The binding delivers the right parameter at the right frame** is AC-3's, not this AC's. An
inverted ordinal produces a not-frozen render *and* a conforming value stream, so neither half of
this AC catches it.

**Do not describe the result as sample-accurate.** Offline resolves once per 128-frame quantum
(`:527`); live applies on the scheduler tick with an exponential slew. Both are block-scale, they
are different block scales, and the null in evidence 2 is what bounds the difference.

### AC-5 — Every class-(b) descriptor row is corrected, after the owner has answered

**The fork comes first and is a gate.** Per §2.3, `automatable: false` removes live automation for
that parameter, so an existing project's lane stops driving in playback. Fork it with the complete
class-(b) list, its count, what each row does today when automated, the recommendation and what
would change it. ADR 0016 ruling 3 means there is no version-gated path: the answer applies to every
existing project.

Do not soften this into "flip them and note it in the PR", and do not fork it before AC-1 —
a question without the list and the count offloads the work instead of doing it.

**Evidence, after the answer.**

1. The descriptor edits, one per class-(b) row.
2. A spec asserting, for each class-(b) pair, that `isDeviceParameterAutomatable` returns `false`
   **and** that `applyAutomation` performs no device write when a lane exists on it — the flag is
   read in two places and only the second is the behaviour. Mutation: restoring `automatable: true`
   on one row reds both assertions.
3. AC-2's census rows for those pairs disappear from the parameter-level count, and the count in the
   census's own header moves. Mutation: reverting one descriptor edit restores its row.

**A descriptor-only correction is inert for a device with no descriptor.**
`isDeviceParameterAutomatable` returns **`true`** when no descriptor is found
(`DeviceParameterLaw.ts:76-78`), so class (b) has no reach into Knead. That is AC-6.

### AC-6 — Knead has a parameter descriptor, or its absence of one is recorded and enforced

`knead` is a factory entry and a canonical native device type with no descriptor anywhere. Three
laws read the descriptor, and **two of the three fail open**:

- **The lane picker** offers nothing (`automationViewHelpers.ts:49`) — fails closed, correctly.
- **The range law** returns the value unchanged: `clampDeviceParameterValue` returns early when no
  descriptor is found (`DeviceParameterLaw.ts:50-53`). **Fails open — no clamp at all.**
- **The automatable law** returns `true` when no descriptor is found
  (`DeviceParameterLaw.ts:76-78`). **Fails open.**

So any `parameterValues` key a Knead device carries is automatable by a lane created outside the
picker — a preset, a model action, an AI action, or a project file — and its writes are unclamped.
`applyAutomation`'s gate is `device.parameterValues[parameterId] !== undefined`
(`applyAutomation.ts:45-53`), which is a data check, not a law.

**The case-folding gap is part of this criterion.** `isKneadDevice` is
`deviceType.toLowerCase() === 'knead'` (`KneadNode.ts:23-25`), called out as deliberate at
`nativeDspDeviceTypes.ts:58-59`, while descriptor lookup is exact — so a descriptor published under
id `knead` still would not bind a device stored as `Knead`. Whichever branch is taken must close it.

**Either branch is acceptable; the reason must be stated.** Publish a descriptor, or record in a
named reason-bearing table that Knead has no automatable parameter surface and enforce that the
fail-open laws cannot reach it.

**Evidence:** a census verdict that reds when `knead` carries a `parameterValues` key with no
descriptor row and no exemption. Mutation: adding one such key reds it.

**"Knead has no descriptor" is not evidence.** It is an absence assertion with no presence pin
(ADR 0015 rule 4), satisfied forever the day the descriptor lookup goes blind. Pin the presence of
the descriptor set Knead is absent from, and assert the absence against that.

---

## 6. Two traps this spec's guards must not fall into

Written explicitly because the session that produced this spec hit them four times.

**(a) A guard can exercise the exact path, produce output, assert what it means to, and still be
blind — because the defective branch is only reachable at a non-default parameter value.** An RT
guard sat at the default `unison_voices` of 1, where the allocating branch early-returns. A cost
bench measured Levain without committing its sample bank, so every realism stage early-returned and
the row timed a device with the expensive part switched off.

This spec's subject is full of defaults that are the uninteresting branch: `unisonVoices` defaults
to 1, `oscEngine` to 0, dutch-oven `freeze` and `shimmer` to off. Requirement: **every AC-1
evidence-2 and AC-4 guard states the two values it drives between and why the engine behaves
differently between them**, and every fixture commits the state the interesting branch needs. A
guard that drives a parameter across a span the engine treats as one state is green by construction.

**(b) A census matching a bare identifier stays green when the *call* is deleted and an *import*
survives.** Every coverage assertion in this spec matches a **call actually made at runtime** —
`resolveOfflineAutomation(...)` returning a binding, `binding.apply(...)` receiving segments,
`set_param_by_id(...)` observed with its ordinal and value — through a spy or the real value stream.
**No assertion here may be satisfied by a symbol appearing in a file.**

## 7. Every device and parameter list is derived from the registry at test time

Hand-maintained device lists in this repository are unreliable, and the evidence is specific:
**Crust has now been missing from four of them** — the cost-bench header, `DEVICE_IDS`, the worklet
import list (all three recorded in the Phase-1 outcome, which found them all claiming Crust "has no
Rust engine at all" while `crates/daw-dsp/src/crust/` had shipped one), and Phase 2's own AC-0
enumeration.

**Requirement, binding on every criterion above:** any device list, parameter list or population this
spec relies on is derived from `NATIVE_DSP_DEVICE_FACTORIES` and `getBuiltinPlugins()` **at test
time**. Not written out by hand, not copied from §1's table, not pasted into a fixture. A device or
parameter added to the registry appears in every guard here without anyone editing a guard; a device
removed disappears from all of them. `crates/daw-dsp/tests/quantum_bench_census.rs` is the shape —
it derives the population from the crate source and compares it against the bench.

The tables in §1 and the classification file in AC-1 are **published measurements**, not sources.
Any guard that reads either of them as its population fails this requirement.

## 8. Out of scope

- **The device-level class** — Gluten, Bacteria, Grinder, Proof and the rest of the 179. Phase 2
  AC-4 owns four of them; the remaining four (Levain, Crumbs, Grand Boule, Crust) stay as reasoned
  exemption rows in the one census.
- **The a-rate `parameterDescriptors` migration.** Phase 2 AC-4 rules it out of Phase 2 as an
  L-shaped migration belonging to Phase 5's "one implementation per transform"; ruling it *in* here
  would silently re-open that. If AC-1's class-(a) count is large enough that ninety `paramAutomation`
  ordinals is the wrong shape, that is a finding to report against stop condition 3, not a scope
  expansion to take.
- **ProofChamber's hand-rolled block-rate interpolator**
  (`proofchamber-handrolled-block-rate-automation`) — Phase 2 Ambiguity 1 leaves it out and moves it
  with the a-rate migration. This spec adds parameters to that interpolator's coverage; it does not
  replace the interpolator.
- **Knead's 2048-sample PDC report**, Knead's offline correction (Phase 2 AC-6) and Knead's clip
  table. AC-6 here is about the *descriptor*, and only that.
- **Modulation and MIDI-FX parameters.** Different populations, different write paths.
- **Desktop**, per ADR 0016 ruling 1.

## 9. Stop conditions

Report; do not design around.

1. **Class (a) is empty or near-empty** — every parameter-level gap turns out to be a descriptor
   error. There is then no engine work in this spec at all: it collapses to AC-1 + AC-2 + AC-5 + AC-6,
   AC-3 and AC-4 are dropped, and Phase 2's device-level AC-4 is the whole of the real automation
   work in the programme. **This is a good outcome and must be reported as the headline, not buried.**
2. **Class (b) is large and the owner declines the descriptor corrections.** The product then
   declares parameters automatable that cannot be automated correctly on either leg, and this spec
   cannot be satisfied as written — the requirement becomes step semantics for structural
   parameters, which is a different and larger job than either AC-4 or AC-5.
3. **The ordinal mirror cannot be derived from one source and the behavioural pin does not scale.**
   No `#[wasm_bindgen]` export is reachable at worklet init, codegen is refused, and per-id
   behavioural pinning at the class-(a) count is not affordable. Report rather than adding entries
   to an unpinned positional array — and note that pinning against a checked-in binary inherits
   survey stop condition 8's provenance problem.
4. **Phase 2 AC-0 does not land, or lands without a moving-lane fixture class.** AC-4 evidence 2 is
   then unobtainable for every parameter here, and this spec's acceptance is a setter-level
   assertion only. **Narrow the claim in every header and every PR** — do not call a setter
   assertion a parity proof, and do not widen the null budget to make some other harness produce a
   number.
5. **A class-(a) parameter cannot be made schedulable without allocating on the render thread.**
   `_paramAutomation` is a growing `Array` searched linearly per quantum
   (`fermenterProcessor.ts:150, 285-292, 438`). Ninety concurrent schedules on one device is a shape
   nobody has sized. If per-parameter scheduling cannot be made RT-safe at the class-(a) count, the
   count is the problem: report the measurement rather than accepting the allocation.
6. **The measurement in §1 does not reproduce.** If a re-derivation on a later commit does not
   return `FACTORIES=13 VERDICTS=20 EXEMPTIONS=285` splitting 179/106, the population moved.
   Re-derive, publish the new numbers, and re-size before planning against the old ones.

## 10. Verification

- Failing reproduction first for each behavioural criterion, with real output pasted. AC-1's
  evidence 2 and AC-5 both change what an existing project does in **playback**, not only in a
  bounce; a fix without a red-first cannot be told apart from moving the defect.
- Every guard mutation-checked with the reding assertion named, per ADR 0015. Every census
  enumerated from a registry at test time (§7), with a reason-bearing exemption table, a committed
  broken fixture, and a mutation that exercises the **enumeration** and not only the verdict.
- Every coverage assertion matches a call observed at runtime, never an identifier in text (§6b).
- Every guard names the two parameter values it drives between and why they differ to the engine
  (§6a).
- Every `file:line` in a PR re-derived against the branch it ships from. The citations here were
  checked against `f6d398786`; they go stale.
- Run each affected test once through guarded package scripts; quote its exit code.
- If any Rust change lands, `pnpm wasm:verify` in the same PR — a conflict-free rebase ships stale
  wasm silently.
- No config, baseline or expected value edited to make a gate pass unless the value genuinely
  changed and the measurement is stated.

## 11. Status

**draft.** The campaign brief requires adversarial review before implementation. Not ready.
