/**
 * Unified Crumbs Suite — plugin descriptor.
 * Registers the Crumbs as a proper instrument with custom UI (bottom panel).
 */

import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, instrumentGuidance } from './GuidanceProfiles';

const CRUMBS_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'builtin-crumbs',
    name: 'Crumbs',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'instrument',
    // Still native-only, but no longer because the *engine* is: `CrumbsInstance`
    // compiles to wasm and renders through `crumbs-processor` in both the live
    // graph and an offline export. What remains native is getting a sample into
    // it. Every step of that — the file dialog, `load_sample`, the waveform
    // mipmap, onset detection, pitch detection, threshold recording — is a
    // `crumbs_*` Tauri command with no browser counterpart, and
    // `isCrumbsNativeAvailable` refuses the drop path outright off desktop.
    // Offering Crumbs in a browser build would offer a sampler that can never be
    // given a sample. Retire this when sample acquisition has a web path, not
    // before.
    platform: 'native',
    hasCustomUI: true,
    // An instrument keeps sounding for its amp-envelope release after the last
    // note ends, which the export has to capture like any other tail.
    tail: { kind: 'decaySeconds', parameterId: 'release', defaultSeconds: 0.1 },
    parameters: [
        {
            id: 'masterGain',
            deviceId: 'builtin-crumbs',
            name: 'Gain',
            type: 'float',
            value: 0.8,
            defaultValue: 0.8,
            minValue: 0,
            // 0..2, the travel the shipped Gain knob has always offered
            // (`CrumbsControls`, `max={2}`) and the span `setMasterGain` clamps to.
            // The declared maximum was 1, which agreed with neither, and
            // `CrumbsEngine::set_param` does a bare `master_gain.set(value)` with no
            // bound of its own — so the declaration was the only thing that would
            // have truncated a knob at half travel once writes started being
            // clamped against it. Same failure as the Tune range below, found the
            // same way.
            maxValue: 2,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'attack',
            deviceId: 'builtin-crumbs',
            name: 'Attack',
            type: 'float',
            value: 0.001,
            defaultValue: 0.001,
            minValue: 0.001,
            maxValue: 2,
            unit: 's',
            automatable: true,
            hasAutomation: false,
            scaling: 'log',
        },
        {
            id: 'hold',
            deviceId: 'builtin-crumbs',
            name: 'Hold',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: 0,
            maxValue: 2,
            unit: 's',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'decay',
            deviceId: 'builtin-crumbs',
            name: 'Decay',
            type: 'float',
            value: 0.3,
            defaultValue: 0.3,
            minValue: 0.001,
            // 5 s, matching the Dec knob's travel. `CrumbsParam::Decay` is
            // `value.max(0.0)` — no ceiling in the engine — so the declared 2 s
            // would have clipped the top 60% of the control.
            maxValue: 5,
            unit: 's',
            automatable: true,
            hasAutomation: false,
            scaling: 'log',
        },
        {
            id: 'sustain',
            deviceId: 'builtin-crumbs',
            name: 'Sustain',
            type: 'float',
            value: 1.0,
            defaultValue: 1.0,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'release',
            deviceId: 'builtin-crumbs',
            name: 'Release',
            type: 'float',
            value: 0.1,
            defaultValue: 0.1,
            minValue: 0.001,
            // 10 s, matching the Rel knob's travel; `CrumbsParam::Release` is also
            // `value.max(0.0)`. This one additionally feeds the export tail
            // (`tail.parameterId: 'release'`), so an under-declared ceiling would
            // have cut a long release short in a bounce as well as under the knob.
            maxValue: 10,
            unit: 's',
            automatable: true,
            hasAutomation: false,
            scaling: 'log',
        },
        {
            id: 'filterCutoff',
            deviceId: 'builtin-crumbs',
            name: 'Filter Cutoff',
            type: 'float',
            value: 20000,
            defaultValue: 20000,
            minValue: 20,
            maxValue: 20000,
            unit: 'Hz',
            automatable: true,
            hasAutomation: false,
            scaling: 'log',
        },
        {
            // Q, matching the `Reso` knob in `CrumbsControls` and the Q span the
            // engine's SVF resolves (`crumbs::filter`: 0.5 at rest, 20 at the
            // onset of self-oscillation). The floor was 0.1, which the engine
            // saturates to the same coefficients as 0.5 — the bottom 0.4 of an
            // automation lane that drew as usable travel and was not.
            id: 'filterResonance',
            deviceId: 'builtin-crumbs',
            name: 'Filter Resonance',
            type: 'float',
            value: 1,
            defaultValue: 1,
            minValue: 0.5,
            maxValue: 20,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'tune',
            deviceId: 'builtin-crumbs',
            name: 'Tune',
            type: 'float',
            value: 0,
            defaultValue: 0,
            // Semitones, ±24 — the travel and unit the Crumbs Tune knob has
            // always shown ("st"), and the unit `CrumbsEngine::set_param` reads
            // this parameter in. The declared range was ±100 "cents", which
            // agreed with nothing: `clampDeviceParameterValue` is what binds an
            // automation curve or a loaded preset, so a lane drawn on this
            // parameter could deliver 100 to an engine whose knob stops at 24,
            // and could not reach the bottom two thirds of the knob's travel in
            // the units it actually reads. Nobody noticed because the engine
            // stored the value and never read it — see the Tune arm in
            // `crates/daw-dsp/src/crumbs/engine.rs`.
            minValue: -24,
            maxValue: 24,
            unit: 'st',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'pan',
            deviceId: 'builtin-crumbs',
            name: 'Pan',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: -1,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        // ── Voice stack ──────────────────────────────────────────────────────
        //
        // Declared, not deferred. #1474 left these three out on purpose and said
        // so — they had no declared range and therefore no automation surface —
        // and left the decision to the owner. The answer is yes: they become real
        // parameters, automatable and exported, and their panel writes go through
        // `setDeviceParameter` like the other ten.
        //
        // Each range was checked against **both** the knob's travel and the
        // engine's own clamp before being written, which is the check #1474 found
        // three existing rows had failed (`masterGain` declared 1 against a knob
        // that goes to 2, `decay` 2 s against 5 s, `release` 10 s against 5 s —
        // each invisible until something clamped against the declaration, at
        // which point it would have truncated its knob mid-sweep). All three
        // below agree on both sides; the agreement is recorded per row so the
        // next person does not have to re-derive it.
        {
            id: 'stackCount',
            deviceId: 'builtin-crumbs',
            name: 'Voices',
            // `int`, so a delivery lands on a whole voice count. Every integer in
            // 1..8 is a distinct setting the engine really uses — the stack loop
            // runs `count` voices — so there is no `legalSet` to declare, unlike
            // the oversampling factors on Crust and Gluten.
            type: 'int',
            value: 1,
            defaultValue: 1,
            // 1..8: the Voices knob's travel (`CrumbsControls`, `min={1} max={8}
            // step={1}`) and `CrumbsParam::StackCount`'s own
            // `(value as u8).clamp(1, MAX_STACK_VOICES)` with `MAX_STACK_VOICES = 8`
            // (`crates/daw-dsp/src/crumbs/types.rs:438`, `engine.rs:831`).
            minValue: 1,
            maxValue: 8,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'detuneSpread',
            deviceId: 'builtin-crumbs',
            name: 'Detune Spread',
            type: 'float',
            value: 0,
            defaultValue: 0,
            // 0..100 cents. The Detune knob reads out in `¢` and travels 0..100;
            // `CrumbsParam::DetuneSpread` is `value.clamp(0.0, 100.0)`
            // (`engine.rs:834`). The knob's `step: 0.5` is a knob increment, not a
            // legal-value law, so this stays `float` and continuous — the same
            // reading `DeviceParameterLaw` gives every other half-step control.
            minValue: 0,
            maxValue: 100,
            unit: 'cents',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'stackSpread',
            deviceId: 'builtin-crumbs',
            name: 'Stereo Spread',
            type: 'float',
            value: 0,
            defaultValue: 0,
            // 0..1. The Spread knob travels 0..1 and renders it as a percentage;
            // `CrumbsParam::StackSpread` is `value.clamp(0.0, 1.0)`
            // (`engine.rs:837`). The engine reads it as a half-width — voice pan
            // runs `-stack_spread ..= +stack_spread` — so 1 is full width, not
            // double.
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
    ],
};

export const CRUMBS_DESCRIPTOR = applySingleDescriptorGuidance(
    CRUMBS_DESCRIPTOR_DATA,
    descriptorGuidance(
        'builtin-crumbs',
        instrumentGuidance(
            'Load or capture a source, then shape its playback, voice stack, and output as one instrument.',
            ['Check source selection and output gain before adding stacked voices or long release.'],
            ['Playback, tuning, voice count, envelope, and pan controls jointly determine each note.'],
            ['Stacked voices, detune, and high gain can build level and blur note definition.']
        ),
        declaredControl(
            'Sample-instrument control',
            'Changes source playback, voice behavior, tuning, envelope, or output staging.',
            ['Set source and playback mode before layering voices.'],
            ['Dense voice stacks can build level and reduce clarity.']
        )
    )
);
