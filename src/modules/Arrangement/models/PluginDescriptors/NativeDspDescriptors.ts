import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applyDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, effectGuidance, referenceSignalGuidance } from './GuidanceProfiles';

/**
 * Band names for the Dutch Oven's Decay Rate EQ, in band order.
 *
 * The same six the overlay draws (`BAND_LABELS` in `DecayEqOverlay.tsx`), so
 * the generic Inspector and the bespoke panel call each band the same thing.
 */
const DECAY_EQ_BAND_LABELS = ['LF', 'LM', 'Mid', 'UM', 'HF', 'Air'] as const;

/** Premium WASM plugin descriptors (Dutch Oven, Scoring). */
const NATIVE_DSP_DESCRIPTOR_DATA: PluginDescriptor[] = [
    {
        id: 'dutch-oven',
        name: 'Dutch Oven',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: true,
        platform: 'both',
        // Absent on saved legacy devices, which keeps their original FDN
        // damping curve. New devices opt into the normalized curve.
        internalParameterValues: { fdn_damping_version: 2 },
        // `decay` is a normalised coefficient, never seconds — the engines
        // convert it through `#/utils/reverbDecayLaw`, so the tail has to be
        // read through the same law. Reading the raw value as seconds would cap
        // the estimate near 1 s while the FDN reaches ~29.8 s at the top of the
        // knob, truncating the longest reverbs in the export.
        tail: {
            kind: 'mappedDecaySeconds',
            parameterId: 'decay',
            defaultValue: 0.5,
            law: 'dutch-oven-rt60',
            predelayMsParameterId: 'predelay',
        },
        parameters: [
            {
                id: 'mix',
                deviceId: 'dutch-oven',
                name: 'Mix',
                type: 'float',
                value: 0.3,
                defaultValue: 0.3,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                // Unitless by contract: `decay` is a normalised coefficient,
                // never seconds. Every Dutch Oven engine converts it into its
                // own quantity (an RT60 for the FDN, an IR stretch for the
                // convolution path) through `#/utils/reverbDecayLaw`, so this
                // range and that law must be changed together.
                id: 'decay',
                deviceId: 'dutch-oven',
                name: 'Decay',
                type: 'float',
                value: 0.5,
                defaultValue: 0.5,
                minValue: 0,
                maxValue: 0.999,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'damping',
                deviceId: 'dutch-oven',
                name: 'Damping',
                type: 'float',
                // 0.3, not the 0.0005 this shipped with (#1546). `addDevice` writes
                // this number into `parameterValues` and pushes it through
                // `updateDeviceParam`, so it is what a newly added Dutch Oven actually
                // sounds like — and 0.0005 in the tank's `OnePole` takes 0.0087 dB off
                // at Nyquist, leaving the 6-12 kHz band louder than 400-1200 Hz two
                // seconds into the tail.
                //
                // What disagreed with it were the two *reset/default* declarations —
                // `DEFAULT_PARAMS.damping` and the Damp knob's `defaultValue`, both
                // 0.3. The knob's readout was not part of the disagreement: it shows
                // the stored value through `Math.round(v * 100)`, so an old device read
                // "0%" and agreed with the engine, which is why looking at the panel
                // never revealed this. And because the knob is `step={0.001}`, that
                // wrong reset target was the only route back to 0.0005 — once a user
                // touched Damp, the value their device booted at was unreachable.
                //
                // 0.0005 is Dattorro Table 1's own recommended value and was
                // transcribed correctly; what was wrong was shipping a reference
                // preset as a product default. The plate constructor,
                // `DEFAULT_PARAMS.damping` and the knob's `defaultValue` now all read
                // 0.3.
                //
                // One number, five algorithms — and 0.3 was chosen on the plate, which
                // is the algorithm every project runs until something writes the
                // selector. Where it lands elsewhere:
                //
                // - **Spring** — exactly its own constructor value
                //   (`spring.rs:102`, unchanged since the crate's first commit). The
                //   old 0.0005 was overwriting it and pushing its late tail to
                //   +7.36 dB, treble above midrange, the same defect as the plate's.
                //   This restores it. For scale, the open-source spring models that
                //   publish a default cluster at 4.5-8.5 kHz of wet-path low-pass
                //   (Faust `dm.springreverb_demo` Tone 0.5 -> 6500 Hz; daleonov's
                //   SpringReverb Tone 5 -> 6500 Hz; Chowdhury BYOD `damping` 0.5 ->
                //   ~8485 Hz; smiarx/aelapse 4500 Hz); the commercial ones publish
                //   nothing.
                // - **FDN 8/16** — newly added devices use an exponential map where
                //   zero is undamped and 0.3 is a conventional 0.5x HF RT60. Saved
                //   unversioned devices retain the curve they were created with.
                // - **Reverse** — `damping` is bit-dead across the whole range. Already
                //   recorded in `nativeDspEngineGaps.ts` and gated in the panel, so
                //   this value is inert there.
                //
                value: 0.3,
                defaultValue: 0.3,
                minValue: 0,
                maxValue: 0.999,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'predelay',
                deviceId: 'dutch-oven',
                name: 'Pre-Delay',
                type: 'float',
                value: 15,
                defaultValue: 15,
                minValue: 0,
                maxValue: 500,
                unit: 'ms',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'size',
                deviceId: 'dutch-oven',
                name: 'Size',
                type: 'float',
                value: 0.75,
                defaultValue: 0.75,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'mod_rate',
                deviceId: 'dutch-oven',
                name: 'Mod Rate',
                type: 'float',
                value: 1.0,
                defaultValue: 1.0,
                minValue: 0.1,
                maxValue: 5.0,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'mod_depth',
                deviceId: 'dutch-oven',
                name: 'Mod Depth',
                type: 'float',
                value: 0.3,
                defaultValue: 0.3,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'diffusion',
                deviceId: 'dutch-oven',
                name: 'Diffusion',
                type: 'float',
                value: 0.75,
                defaultValue: 0.75,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'high_cut',
                deviceId: 'dutch-oven',
                name: 'High Cut',
                type: 'float',
                value: 12000,
                defaultValue: 12000,
                minValue: 1000,
                maxValue: 20000,
                unit: 'Hz',
                scaling: 'log',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'low_cut',
                deviceId: 'dutch-oven',
                name: 'Low Cut',
                type: 'float',
                value: 80,
                defaultValue: 80,
                minValue: 20,
                maxValue: 1000,
                unit: 'Hz',
                scaling: 'log',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'width',
                deviceId: 'dutch-oven',
                name: 'Width',
                type: 'float',
                value: 1.0,
                defaultValue: 1.0,
                minValue: 0,
                maxValue: 2,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'freeze',
                deviceId: 'dutch-oven',
                name: 'Freeze',
                type: 'bool',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'shimmer',
                deviceId: 'dutch-oven',
                name: 'Shimmer',
                type: 'bool',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'shimmer_amount',
                deviceId: 'dutch-oven',
                name: 'Shimmer Amount',
                type: 'float',
                value: 0.2,
                defaultValue: 0.2,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'shimmer_pitch',
                deviceId: 'dutch-oven',
                name: 'Shimmer Pitch',
                type: 'float',
                value: 1,
                defaultValue: 1,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: false,
                hasAutomation: false,
            },
            {
                id: 'gravity',
                deviceId: 'dutch-oven',
                name: 'Gravity',
                type: 'float',
                value: 0.5,
                defaultValue: 0.5,
                minValue: -1,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'saturation',
                deviceId: 'dutch-oven',
                name: 'Saturation',
                type: 'bool',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: false,
                hasAutomation: false,
            },
            {
                // The plate implements three distinct curves and advertises
                // the parameter in `param_names`; nothing could write it, so
                // every project has heard curve 0 since the engine shipped.
                //
                // `automatable: false` alongside `vintage` and `algorithm`,
                // the device's other selectors: an automation lane
                // interpolates, and a curve index between 0 and 1 is not a
                // curve. The switch belongs on the panel, not on a ramp.
                id: 'saturation_type',
                deviceId: 'dutch-oven',
                name: 'Saturation Curve',
                type: 'int',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 2,
                unit: '',
                automatable: false,
                hasAutomation: false,
            },
            {
                id: 'early_late',
                deviceId: 'dutch-oven',
                name: 'Early/Late',
                type: 'float',
                value: 0.4,
                defaultValue: 0.4,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'density',
                deviceId: 'dutch-oven',
                name: 'Density',
                type: 'float',
                value: 1.0,
                defaultValue: 1.0,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            // ── Decay Rate EQ ──────────────────────────────────────────────
            //
            // Six bands of decay-time multiplier, 0.25x…4.0x, centred at 100,
            // 400, 1200, 3500, 8000 and 12000 Hz. The wire ids and the band
            // order are `PARAM_NAMES` / `default_bands()` in
            // `crates/proof-chamber/src/decay_eq.rs`.
            //
            // These existed as writes long before they existed as parameters:
            // `DecayEqOverlay` has been dragging six nodes into
            // `executeAppAction` since it shipped, and no engine had an arm for
            // any of them (#1539). Because they were not declared here, the
            // engine-gap census could not see them either — its population is
            // the descriptor's — so seventeen controls were greyed out for
            // being inaudible while these six sat live beside them, inaudible
            // on every algorithm.
            //
            // Declared as ordinary rows rather than as a bespoke surface, which
            // is what puts them in reach of the generic Inspector, automation,
            // MIDI learn and the LLM action bridge — none of which knows the
            // overlay exists. `automatable: true`: a decay curve that opens up
            // over the length of a phrase is an ordinary reverb move, and the
            // engine takes these writes at block rate through the same
            // `set_param` every other continuous control uses.
            //
            // The range is the overlay's own travel (`MIN_MULT` / `MAX_MULT` in
            // `DecayEqOverlay.tsx`) and the engine's own clamp
            // (`value.clamp(0.25, 4.0)` in each of the three engines that
            // answer). `declaredRangeVsKnobTravel.spec.ts` welds all three.
            ...([0, 1, 2, 3, 4, 5] as const).map((band) => ({
                id: `decay_eq_${band}`,
                deviceId: 'dutch-oven' as const,
                name: `Decay EQ ${DECAY_EQ_BAND_LABELS[band]}`,
                type: 'float' as const,
                value: 1,
                defaultValue: 1,
                minValue: 0.25,
                maxValue: 4,
                unit: 'x',
                automatable: true,
                hasAutomation: false,
            })),
            {
                id: 'algorithm',
                deviceId: 'dutch-oven',
                name: 'Algorithm',
                type: 'int',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                // 6 is Reverse, the highest value the selector can produce. 4
                // and 5 fall inside the range but select nothing: they belong
                // to the convolution-backed engines, which need an impulse
                // response no code can supply, and the engine dispatch routes
                // them to Plate. This range is not what keeps them unreachable
                // — nothing clamps a parameter write against a descriptor —
                // it just stops the declared range from contradicting both of
                // its neighbours, which at `maxValue: 5` it did.
                maxValue: 6,
                // The set, said where the range cannot say it. `maxValue: 6`
                // makes 4 and 5 look like settings; they are the `_ =>` arm of
                // `crates/proof-chamber/src/lib.rs`, which is Plate. `fallback`
                // rather than `floor` because a `match` has no neighbours —
                // 4 lands on Plate, not on the Spring below it.
                legalSet: { values: [0, 1, 2, 3, 6], resolution: 'fallback', fallback: 0 },
                unit: '',
                automatable: false,
                hasAutomation: false,
            },
            {
                id: 'vintage',
                deviceId: 'dutch-oven',
                name: 'Vintage',
                type: 'int',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 2,
                unit: '',
                automatable: false,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'native-scoring',
        name: 'Scoring',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'analyzer',
        hasCustomUI: true,
        platform: 'both',
        parameters: [
            {
                id: 'a4_hz',
                deviceId: 'native-scoring',
                name: 'A4 Reference',
                type: 'float',
                value: 440,
                defaultValue: 440,
                minValue: 400,
                maxValue: 490,
                unit: 'Hz',
                automatable: false,
                hasAutomation: false,
            },
            {
                id: 'mute',
                deviceId: 'native-scoring',
                name: 'Mute Output',
                type: 'bool',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: false,
                hasAutomation: false,
            },
            {
                id: 'tone',
                deviceId: 'native-scoring',
                name: 'Reference Tone',
                type: 'bool',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: false,
                hasAutomation: false,
            },
        ],
    },
];

const NATIVE_DSP_DESCRIPTORS_GUIDANCE = [
    descriptorGuidance(
        'dutch-oven',
        effectGuidance(
            'Build a spacious reverb tail, then tune damping and wet level in the context of the arrangement.',
            ['Keep wet level and decay conservative while checking low-frequency build-up.'],
            ['Algorithm, decay, damping, diffusion, and modulation jointly determine the tail character.'],
            ['Long bright or frozen tails can mask timing and accumulate energy.'],
            {
                availability: 'not-applicable',
                reason: 'This reverb declares no automatic wet-path output compensation.',
            }
        ),
        declaredControl(
            'Dutch Oven reverb control',
            'Changes the generated reverb tail, its tone, or its wet-path balance.',
            ['Tune algorithm and decay before fine tone and modulation controls.'],
            ['Long, bright, or frozen tails can obscure source detail.']
        )
    ),
    descriptorGuidance(
        'native-scoring',
        referenceSignalGuidance(
            'Generate a reference pitch for tuning and calibration rather than musical processing.',
            ['Mute the reference output before delivery or recording.'],
            ['Reference frequency and tone enable together determine the emitted calibration signal.'],
            ['An enabled reference tone can be unexpectedly audible in a mix.'],
            { availability: 'not-applicable', reason: 'This utility has no automatic audio-level compensation.' }
        ),
        declaredControl(
            'Reference-tone control',
            'Changes calibration pitch or whether the reference output is audible.',
            ['Set frequency before enabling the reference tone.'],
            ['An enabled reference tone can be audible in exports.']
        )
    ),
];

export const NATIVE_DSP_DESCRIPTORS = applyDescriptorGuidance(
    NATIVE_DSP_DESCRIPTOR_DATA,
    NATIVE_DSP_DESCRIPTORS_GUIDANCE
);
