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
 * `FermenterDescriptorGuidance*.ts` companions.
 */
export const FERMENTER_GUIDANCE = instrumentGuidance(
    'Play a layered voice: choose an engine per layer, shape it with the filter, envelopes and modulation, then set the shared effects chain and master gain.',
    [
        'Per-layer controls write only the layer activeLayer selects at the moment of the write, so set activeLayer before editing a layer other than the first.',
        'masterGain and the effect mixes act on the sum of every layer; balance layers with layerLevel before raising masterGain above 1.',
    ],
    [
        'The shared chain runs distortion, compressor, reverb, delay, chorus, phaser, EQ, stereoWidth and masterGain in that order, after every layer is summed.',
    ],
    [
        'Each note takes one voice per playable layer from one shared voice ceiling, so raising numLayers lowers how many notes can sound at once.',
    ]
);

export const FERMENTER_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    ...FERMENTER_SOURCE_PARAMETER_GUIDANCE,
    ...FERMENTER_SHAPING_PARAMETER_GUIDANCE,
    ...FERMENTER_OUTPUT_PARAMETER_GUIDANCE,
};
