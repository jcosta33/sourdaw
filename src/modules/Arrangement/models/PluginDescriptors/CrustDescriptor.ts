/**
 * Crust — limiter/saturator plugin descriptor.
 *
 * Parameter data is inlined here rather than imported from the Crust
 * module. Models must not cross module boundaries; duplication is intentional.
 */

import { type PluginDescriptor, type PluginParamDef } from '../DeviceParameterTypes';

const CRUST_PARAMS: readonly PluginParamDef[] = [
    { id: 'gain', label: 'Gain', min: 0, max: 18, default: 0, unit: 'dB', step: 0.1 },
    { id: 'ceiling', label: 'Ceiling', min: -6, max: 0, default: -0.3, unit: 'dBTP', step: 0.1 },
    { id: 'lookahead', label: 'Lookahead', min: 0, max: 10, default: 2, unit: 'ms', step: 0.1 },
    { id: 'attack', label: 'Attack', min: 0, max: 100, default: 0, unit: 'ms', step: 0.1 },
    { id: 'release', label: 'Release', min: 0, max: 1000, default: 0, unit: 'ms', step: 1 },
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
        legalValues: [1, 2, 4, 8, 16, 32],
    },
    { id: 'satDrive', label: 'Sat Drive', min: 0, max: 18, default: 0, unit: 'dB', step: 0.1 },
    { id: 'satMix', label: 'Sat Mix', min: 0, max: 100, default: 0, unit: '%', step: 1 },
    { id: 'deltaListen', label: 'Delta', min: 0, max: 1, default: 0, unit: '', step: 1 },
    { id: 'scHpfFreq', label: 'SC HPF', min: 20, max: 200, default: 60, unit: 'Hz', step: 1 },
];

export const CRUST_DESCRIPTOR: PluginDescriptor = {
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
        legalValues: param.legalValues,
        unit: param.unit,
        automatable: true,
        hasAutomation: false,
    })),
};
