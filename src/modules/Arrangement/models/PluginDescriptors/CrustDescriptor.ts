/**
 * Crust — limiter/saturator plugin descriptor.
 *
 * Parameter data is inlined here rather than imported from the Crust
 * module. Models must not cross module boundaries; duplication is intentional.
 */

import { type PluginDescriptor, type PluginParamDef } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, effectGuidance } from './GuidanceProfiles';

const CRUST_PARAMS: readonly PluginParamDef[] = [
    { id: 'gain', label: 'Gain', min: 0, max: 18, default: 0, unit: 'dB', step: 0.1 },
    { id: 'ceiling', label: 'Ceiling', min: -6, max: 0, default: -0.3, unit: 'dBTP', step: 0.1 },
    { id: 'lookahead', label: 'Lookahead', min: 0, max: 10, default: 2, unit: 'ms', step: 0.1 },
    { id: 'attack', label: 'Attack', min: 0, max: 100, default: 0, unit: 'ms', step: 0.1 },
    // The switch that decides whether `attack` above is the attack at all.
    // `CrustEngine::apply_envelope` takes the algorithm profile's time constant
    // while this is on and the declared control only while it is off, and it
    // defaults on — so `attack` was declared, automatable, and discarded by the
    // engine unless someone opened the Crust panel and turned this off there.
    // An auto switch over the manual time constants is the standard shape for
    // this control (Waves L2's ARC, Ableton's Compressor "Auto Release"), and
    // like both of those it is two-position and defaults to auto.
    { id: 'attackAuto', label: 'Attack Auto', min: 0, max: 1, default: 1, unit: '', step: 1 },
    { id: 'release', label: 'Release', min: 0, max: 1000, default: 0, unit: 'ms', step: 1 },
    // Same switch for the release, with one extra engine behaviour behind it:
    // `apply_envelope` also forces the auto branch when `release` is 0, which
    // is that control's own default. So the release is program-dependent until
    // *both* this is off and `release` is above zero.
    { id: 'releaseAuto', label: 'Release Auto', min: 0, max: 1, default: 1, unit: '', step: 1 },
    { id: 'channelLinkTransient', label: 'Link Trans', min: 0, max: 100, default: 100, unit: '%', step: 1 },
    { id: 'channelLinkRelease', label: 'Link Rel', min: 0, max: 100, default: 100, unit: '%', step: 1 },
    { id: 'truePeak', label: 'True Peak', min: 0, max: 1, default: 1, unit: '', step: 1 },
    // The cascade in `crates/daw-dsp/src/crust/oversample.rs` builds powers of
    // two and `normalize_factor` floors anything else onto one, so the 26
    // integers this range used to offer alongside these six were positions the
    // engine could not tell apart. Measured, not argued:
    // `dawDspCrustOversampling.spec.ts` renders every integer in 1..32 through
    // the checked-in wasm and finds exactly these six distinct outputs.
    {
        id: 'oversampling',
        label: 'Oversampling',
        min: 1,
        max: 32,
        default: 4,
        unit: 'x',
        step: 1,
        legalSet: { values: [1, 2, 4, 8, 16, 32], resolution: 'floor' },
    },
    // The saturation stage's own enable, which `Saturator::is_idle` reads as
    // the first branch of the process path — a per-stage bypass of the kind
    // every module in a mastering suite carries (iZotope Ozone's per-module
    // power button). It defaults off, and `satDrive` and `satMix` below are
    // declared and automatable, so until this could be moved a lane drawn on
    // either of them rendered nothing.
    { id: 'satEnabled', label: 'Sat On', min: 0, max: 1, default: 0, unit: '', step: 1 },
    { id: 'satDrive', label: 'Sat Drive', min: 0, max: 18, default: 0, unit: 'dB', step: 0.1 },
    { id: 'satMix', label: 'Sat Mix', min: 0, max: 100, default: 0, unit: '%', step: 1 },
    { id: 'deltaListen', label: 'Delta', min: 0, max: 1, default: 0, unit: '', step: 1 },
    { id: 'scHpfFreq', label: 'SC HPF', min: 20, max: 200, default: 60, unit: 'Hz', step: 1 },
];

const CRUST_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'crust',
    name: 'Crust',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: CRUST_PARAMS.map((param) => ({
        id: param.id,
        deviceId: 'crust',
        name: param.label,
        type: param.step === 1 ? 'int' : 'float',
        value: param.default,
        defaultValue: param.default,
        minValue: param.min,
        maxValue: param.max,
        legalSet: param.legalSet,
        unit: param.unit,
        automatable: true,
        hasAutomation: false,
    })),
};

export const CRUST_DESCRIPTOR = applySingleDescriptorGuidance(
    CRUST_DESCRIPTOR_DATA,
    descriptorGuidance(
        'crust',
        effectGuidance(
            'Limit and saturate a signal while preserving a deliberate ceiling and downstream headroom.',
            ['Set ceiling before driving gain and compare loudness against bypass.'],
            ['Gain drives limiting and saturation while timing and oversampling shape artifacts.'],
            ['Aggressive drive can flatten transients and create misleading loudness.'],
            { availability: 'unavailable', reason: 'Crust declares no automatic loudness matching.' }
        ),
        declaredControl(
            'Limiter and saturator control',
            'Changes peak handling, harmonic density, or output ceiling.',
            ['Set ceiling before gain and timing.'],
            ['High drive can flatten transients or overload later stages.']
        )
    )
);
