import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION } from './GuidanceProfiles';

/**
 * Per-parameter guidance for Fermenter's shared chain and layer mix — reverb,
 * EQ, delay, chorus, phaser, distortion, compressor, stereo width, layer
 * controls and master gain — taken from `crates/daw-dsp/src/fermenter`
 * (`synth.rs`, `effects.rs`, `layer.rs`). `MasterSynth::process_block` runs
 * the summed layers through distortion → compressor → reverb → delay → chorus
 * → phaser → EQ → stereo width → `masterGain`; each mix stage is skipped
 * while its mix is at or below 0.001. The three EQ bands are all peaking
 * bells. `layerLevel` and `layerPan` are per layer; everything else here is
 * global. The text stays terse so each eight-parameter manifest page fits one
 * tool receipt.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const FERMENTER_OUTPUT_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    // ── Reverb ─────────────────────────────────────────────────────────────
    reverbType: parameterGuidance(
        'Reverb algorithm: plate or feedback delay network',
        'Selects 0 plate (two diffusers into a cross-coupled tank) or 1 four-line delay network (25–41 ms lines); both damp at a fixed 0.5.',
        0,
        0,
        ['reverbDecay sets the feedback and reverbMix the crossfade of either.'],
        ['The plate sums its input to mono, so its width does not follow the dry image.'],
        noExternalModulation
    ),
    reverbMix: parameterGuidance(
        'Reverb dry/wet crossfade',
        'Crossfades dry × (1 − mix) with the reverb; at 0.4 the dry is 4.4 dB down.',
        0,
        0.4,
        ['reverbDecay and reverbType set the tail; delay, chorus and phaser follow it.'],
        ['At 1 only the reverb is heard.'],
        noExternalModulation
    ),
    reverbDecay: parameterGuidance(
        'Reverb tank feedback',
        'Sets the plate tank or delay-network feedback gain, 0 to 0.99.',
        0.2,
        0.85,
        ['Heard only when reverbMix is above 0.001.'],
        ['Near 0.99 the tail outlasts the notes by a long way.'],
        noExternalModulation
    ),

    // ── EQ ─────────────────────────────────────────────────────────────────
    eqLowFreq: parameterGuidance(
        'Low EQ band centre frequency',
        'Sets the centre of the low band, a peaking bell rather than a shelf.',
        40,
        250,
        ['Needs eqLowGain beyond ±0.1 dB; eqLowQ sets the width.'],
        ['As a bell it leaves content well below the centre untouched.'],
        noExternalModulation
    ),
    eqLowGain: parameterGuidance(
        'Low EQ band gain',
        'Boosts or cuts the low bell by up to ±24 dB; bypassed within ±0.1 dB.',
        -12,
        6,
        ['Acts at eqLowFreq after the reverb and delay, so it shapes their tails.'],
        ['Low boosts add level before masterGain with no limiter.'],
        noExternalModulation
    ),
    eqLowQ: parameterGuidance(
        'Low EQ band width',
        'Sets the low bell’s Q from 0.1 (wide) to 10 (narrow).',
        0.5,
        2,
        ['Only audible while eqLowGain is active.'],
        ['High Q with a large eqLowGain boost rings at the centre.'],
        noExternalModulation
    ),
    eqMidFreq: parameterGuidance(
        'Mid EQ band centre frequency',
        'Sets the mid bell’s centre from 200 Hz to 8 kHz.',
        250,
        4000,
        ['Needs eqMidGain beyond ±0.1 dB; eqMidQ sets the width.'],
        ['Its range overlaps both other bands, so two bells can stack on one frequency.'],
        noExternalModulation
    ),
    eqMidGain: parameterGuidance(
        'Mid EQ band gain',
        'Boosts or cuts the mid bell by up to ±24 dB; bypassed within ±0.1 dB.',
        -12,
        6,
        ['Acts at eqMidFreq after the time effects.'],
        ['It sits after the distortion and compressor, so they do not limit its boosts.'],
        noExternalModulation
    ),
    eqMidQ: parameterGuidance(
        'Mid EQ band width',
        'Sets the mid bell’s Q from 0.1 to 10.',
        0.5,
        4,
        ['Only audible while eqMidGain is active.'],
        ['A narrow boost on a filterResonance peak adds both gains at one frequency.'],
        noExternalModulation
    ),
    eqHighFreq: parameterGuidance(
        'High EQ band centre frequency',
        'Sets the high bell’s centre from 2 kHz to 20 kHz; it is also a peaking bell.',
        4000,
        12000,
        ['Needs eqHighGain beyond ±0.1 dB; eqHighQ sets the width.'],
        ['As a bell it returns to unity above its centre, unlike a shelf.'],
        noExternalModulation
    ),
    eqHighGain: parameterGuidance(
        'High EQ band gain',
        'Boosts or cuts the high bell by up to ±24 dB; bypassed within ±0.1 dB.',
        -12,
        6,
        ['Acts at eqHighFreq after the reverb and delay.'],
        ['High boosts also lift the reverb and delay returns and any noiseLevel noise.'],
        noExternalModulation
    ),
    eqHighQ: parameterGuidance(
        'High EQ band width',
        'Sets the high bell’s Q from 0.1 to 10.',
        0.3,
        2,
        ['Only audible while eqHighGain is active.'],
        ['A narrow high bell with a large boost adds a tonal peak.'],
        noExternalModulation
    ),

    // ── Delay ──────────────────────────────────────────────────────────────
    delayTime: parameterGuidance(
        'Ping-pong delay time in milliseconds',
        'Sets the repeat spacing in ms, not tempo-synced; 375 ms is a dotted eighth at 120 BPM, and 125–750 ms spans a sixteenth to a dotted quarter there.',
        125,
        750,
        ['delayFeedback sets the repeat count and delayMix their level.'],
        [
            'Changes glide the tap at up to half a sample per sample, bending sounding repeats up to an octave down or a fifth up.',
        ],
        noExternalModulation
    ),
    delayFeedback: parameterGuidance(
        'Ping-pong delay feedback',
        'Returns each repeat to the opposite channel at this gain (0 to 0.95); at 0.6 repeats fall about 4.4 dB each.',
        0.1,
        0.6,
        ['Heard only when delayMix is above 0.001.'],
        ['At 0.95 repeats take about 50 s to fall 60 dB at a 375 ms delayTime.'],
        noExternalModulation
    ),
    delayMix: parameterGuidance(
        'Delay dry/wet crossfade',
        'Crossfades dry × (1 − mix) with the delayed signal.',
        0,
        0.4,
        ['It follows the reverb, so with reverbMix up the repeats carry reverb.'],
        ['At 1 only the repeats remain, so notes sound late by delayTime.'],
        noExternalModulation
    ),

    // ── Chorus ─────────────────────────────────────────────────────────────
    chorusRate: parameterGuidance(
        'Chorus modulation rate',
        'Sets the sine rate of the two delay lines, 90° apart, from 0.1 to 5 Hz.',
        0.2,
        2,
        ['chorusDepth sets the swing; heard only when chorusMix is above 0.001.'],
        ['Faster rates raise the pitch shift of the wet signal at a given chorusDepth.'],
        noExternalModulation
    ),
    chorusDepth: parameterGuidance(
        'Chorus delay swing',
        'Swings a 10 ms delay by ±5 ms × depth; 0.4 swings it ±2 ms.',
        0.2,
        0.7,
        ['chorusRate sets the cycle and chorusMix the level.'],
        ['Deeper swings shift the wet pitch further at every rate.'],
        noExternalModulation
    ),
    chorusMix: parameterGuidance(
        'Chorus dry/wet crossfade',
        'Crossfades dry × (1 − mix) with the modulated delay; dry and wet are equal at 0.5.',
        0,
        0.5,
        ['Follows the delay and precedes the phaser; chorusDepth and chorusRate shape the wet path.'],
        ['At 1 only the modulated delay remains: vibrato, not chorus.'],
        noExternalModulation
    ),

    // ── Phaser ─────────────────────────────────────────────────────────────
    phaserRate: parameterGuidance(
        'Phaser sweep rate',
        'Sets the sweep rate of four allpass stages, the right channel a quarter cycle ahead.',
        0.1,
        1.5,
        ['phaserDepth sets the span; heard only when phaserMix is above 0.001.'],
        ['High rates move the notches several times a second.'],
        noExternalModulation
    ),
    phaserDepth: parameterGuidance(
        'Phaser sweep span',
        'Sweeps 200 + (1 − depth) × 800 Hz to 2000 + depth × 6000 Hz: 1–2 kHz at 0, 600 Hz–5 kHz at 0.5, 200 Hz–8 kHz at 1.',
        0.3,
        1,
        ['phaserRate sets the speed and phaserMix the notch depth.'],
        ['At 0 the sweep stays inside 1–2 kHz.'],
        noExternalModulation
    ),
    phaserMix: parameterGuidance(
        'Phaser dry/wet crossfade',
        'Crossfades dry × (1 − mix) with the allpass chain; the notches come from the sum, deepest at 0.5.',
        0,
        0.5,
        ['phaserDepth and phaserRate move the notches.'],
        ['At 1 only the flat-magnitude allpass output remains, so the notches vanish.'],
        noExternalModulation
    ),

    // ── Distortion ─────────────────────────────────────────────────────────
    distDrive: parameterGuidance(
        'Distortion input gain',
        'Multiplies the summed layers by 1 + 3 × drive, clamps to ±4 and soft-clips at 2× oversampling; at 1 (gain 4) full scale reaches the clamp.',
        0,
        1,
        ['Heard only when distMix is above 0.001; distTone low-passes the result.'],
        ['The wet path stays near ±1, so more drive adds distortion, not level.'],
        noExternalModulation
    ),
    distTone: parameterGuidance(
        'Distortion tone low-pass',
        'Low-passes the distorted signal with coefficient 0.2 + 0.8 × tone; 1 is unfiltered.',
        0.3,
        1,
        ['Filters only the wet path distMix blends.'],
        ['Low values strongly low-pass the wet path against an unfiltered dry.'],
        noExternalModulation
    ),
    distMix: parameterGuidance(
        'Distortion dry/wet crossfade',
        'Crossfades the dry layers with the distorted path, which maps a full-scale peak to about 0.78 even at distDrive 0.',
        0,
        0.5,
        ['First in the chain, so every later effect processes it; distTone shapes the wet path.'],
        ['At 1 every peak is held to the ±1 wet ceiling.'],
        noExternalModulation
    ),

    // ── Compressor ─────────────────────────────────────────────────────────
    compThreshold: parameterGuidance(
        'Compressor threshold in dB',
        'Sets the peak level where reduction starts and the auto makeup, (1 − 1/ratio) × (−threshold)/2 dB: 7.5 dB at −20 dB and 4:1.',
        -30,
        -6,
        ['compRatio sets the reduction and, with it, the makeup.'],
        ['−60 dB at 20:1 adds 28.5 dB of makeup to quiet material.'],
        noExternalModulation
    ),
    compRatio: parameterGuidance(
        'Compressor ratio',
        'Reduces the overshoot above compThreshold by 1 − 1/ratio in dB, from 1:1 to 20:1.',
        2,
        8,
        ['Scales the makeup together with compThreshold.'],
        ['At 1:1 there is no reduction and no makeup.'],
        noExternalModulation
    ),
    compAttack: parameterGuidance(
        'Compressor attack in milliseconds',
        'Sets the rise time constant of the peak detector, which follows the louder channel.',
        1,
        30,
        ['compRelease sets the fall time constant.'],
        ['Short attacks reduce each note’s transient along with the peak.'],
        noExternalModulation
    ),
    compRelease: parameterGuidance(
        'Compressor release in milliseconds',
        'Sets the fall time constant of the peak detector, which keeps falling through silence.',
        50,
        300,
        ['Works with compAttack.'],
        ['Short releases with a high compRatio let gain swing within sustained chords.'],
        noExternalModulation
    ),
    compMix: parameterGuidance(
        'Compressor parallel blend',
        'Blends the dry signal with the compressed, made-up signal.',
        0,
        0.5,
        ['compThreshold and compRatio set the makeup it carries.'],
        ['Makeup also lifts material below the threshold, so compMix raises level.'],
        noExternalModulation
    ),

    // ── Width and layers ───────────────────────────────────────────────────
    stereoWidth: parameterGuidance(
        'Mid/side stereo width',
        'Scales the side of the summed output: 0 mono, 1 unchanged, 2 doubled (+6 dB).',
        0.5,
        1.4,
        ['Scales what unisonSpread, grainPanSpread, layerPan and the effects create.'],
        ['At 0 every upstream stereo result is discarded.'],
        noExternalModulation
    ),
    activeLayer: parameterGuidance(
        'Layer that receives per-layer edits',
        'Writes no audio state: it picks which of four layers later per-layer writes land on.',
        0,
        0,
        ['With numLayers at 1 only layer 0 renders, so edits to layers 1–3 are silent.'],
        ['Edits land on whichever layer it last selected, not necessarily layer 0.'],
        noExternalModulation
    ),
    numLayers: parameterGuidance(
        'Number of sounding layers',
        'Renders layers 0 to numLayers − 1 and starts each note on all; each takes a voice per note from the shared ceiling.',
        1,
        2,
        ['activeLayer picks which layer edits reach; layerLevel and layerPan mix each.'],
        ['An unedited layer plays the engine’s built-in saw settings, not the descriptor defaults.'],
        noExternalModulation
    ),
    layerLevel: parameterGuidance(
        'Per-layer output level',
        'Scales the active layer with an equal-power pan; at centre each channel gets 0.707 × level.',
        0.5,
        1,
        ['layerPan places the same layer; masterGain scales the sum.'],
        ['Several layers at 1 sum, so output rises with numLayers.'],
        noExternalModulation
    ),
    layerPan: parameterGuidance(
        'Per-layer pan',
        'Pans the active layer from −1 to 1 with an equal-power law, centre 3 dB down per channel.',
        -0.7,
        0.7,
        ['Places the layer layerLevel sets; stereoWidth scales the result.'],
        ['At ±1 the layer leaves the opposite channel.'],
        noExternalModulation
    ),

    // ── Master ─────────────────────────────────────────────────────────────
    masterGain: parameterGuidance(
        'Final output gain',
        'Multiplies the whole instrument after stereo width, smoothed; 0.5 to 1 is −6 dB to unity.',
        0.5,
        1,
        ['Scales every layer and effect together, after stereoWidth.'],
        ['Above 1 it amplifies with no limiter, so dense chords can clip downstream.'],
        noExternalModulation
    ),
};
