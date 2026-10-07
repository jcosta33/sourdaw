import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { FERMENTER_OUTPUT_PARAMETER_GUIDANCE } from './FermenterDescriptorGuidanceOutput';
import { FERMENTER_SHAPING_PARAMETER_GUIDANCE } from './FermenterDescriptorGuidanceShaping';
import { FERMENTER_SOURCE_PARAMETER_GUIDANCE } from './FermenterDescriptorGuidanceSources';
import { instrumentGuidance } from './GuidanceProfiles';

/**
 * Guidance for Fermenter, taken from `crates/daw-dsp/src/fermenter`.
 *
 * `MasterSynth::set_param` (`synth.rs`) keeps the effect, mix and layer-count
 * controls itself and hands every other write to the one layer `activeLayer`
 * selects (`layer.rs`). Per voice (`voice.rs` `render`): the engine's
 * oscillator, warp, audio-rate AM, `oscLevel`, added noise, the filter model
 * at a modulated cutoff, `voiceDrive`, then amp envelope × velocity. Layers
 * sum through `layerLevel`/`layerPan`; the sum runs the shared effect chain
 * and `masterGain`. The MSEG shape, step-sequencer pattern and audio-rate
 * modulator waveform are fixed in the engine, and the sampler has no
 * sample-loading path: it plays its built-in one-second 440 Hz tone
 * (`sampler.rs`). The parameter entries are split by stage across the three
 * `FermenterDescriptorGuidance*.ts` companions. The agent reads them in
 * eight-parameter manifest pages that each carry this device guidance and must
 * fit one tool receipt (`deviceManifestPaging.spec.ts`), so all of it stays terse.
 */
export const FERMENTER_GUIDANCE = instrumentGuidance(
    'Pick an engine per layer, shape it with the filter, envelopes and modulation, then set the shared effects and masterGain.',
    [
        'Per-layer controls write only the layer activeLayer selects; set it before editing layers 1 to 3.',
        'masterGain and the effects act on the layer sum; balance with layerLevel before raising masterGain above 1.',
    ],
    ['After the layers sum: distortion, compressor, reverb, delay, chorus, phaser, EQ, stereoWidth, masterGain.'],
    ['Each note takes one voice per layer from a shared ceiling, so raising numLayers lowers polyphony.']
);

export const FERMENTER_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    ...FERMENTER_SOURCE_PARAMETER_GUIDANCE,
    ...FERMENTER_SHAPING_PARAMETER_GUIDANCE,
    ...FERMENTER_OUTPUT_PARAMETER_GUIDANCE,
};
