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
 * global.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const FERMENTER_OUTPUT_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    // ── Reverb ─────────────────────────────────────────────────────────────
    reverbType: parameterGuidance(
        'Reverb algorithm: plate or feedback delay network',
        'Selects 0 plate (two diffusers into a cross-coupled tank) or 1 four-line feedback delay network with 25 to 41 ms lines; both damp at a fixed 0.5.',
        0,
        0,
        ['reverbDecay sets either algorithm’s feedback and reverbMix its crossfade.'],
        [
            'The plate sums its input to mono before the tank, so the reverb’s width does not follow the dry stereo image.',
        ],
        noExternalModulation
    ),
    reverbMix: parameterGuidance(
        'Reverb dry/wet crossfade',
        'Crossfades dry × (1 − mix) with the reverb; at 0.4 the dry is already 4.4 dB down, and the stage is skipped below 0.001.',
        0,
        0.4,
        ['reverbDecay and reverbType set the tail it exposes; the delay, chorus and phaser follow it in the chain.'],
        ['At 1 the dry signal is removed entirely and only the reverb is heard.'],
        noExternalModulation
    ),
    reverbDecay: parameterGuidance(
        'Reverb tank feedback',
        'Sets the feedback gain of the plate tank or delay network (0 to 0.99); higher values lengthen the tail.',
        0.2,
        0.85,
        ['Heard only when reverbMix is above 0.001.'],
        ['Near 0.99 the tail lasts long after the notes stop and builds under sustained chords.'],
        noExternalModulation
    ),

    // ── EQ ─────────────────────────────────────────────────────────────────
    eqLowFreq: parameterGuidance(
        'Low EQ band centre frequency',
        'Sets the centre of the low band, which is a peaking bell rather than a shelf.',
        40,
        250,
        ['Heard only when eqLowGain is beyond ±0.1 dB; eqLowQ sets the bell width.'],
        [
            'As a bell it lifts or cuts around the centre only, so content below it is left untouched rather than shelved.',
        ],
        noExternalModulation
    ),
    eqLowGain: parameterGuidance(
        'Low EQ band gain',
        'Boosts or cuts the low bell by up to ±24 dB; the band is bypassed until its gain moves beyond ±0.1 dB.',
        -12,
        6,
        ['Acts at eqLowFreq with width eqLowQ, after the reverb and delay, so it also shapes their tails.'],
        ['Large low boosts after the effects add level before masterGain with no limiter.'],
        noExternalModulation
    ),
    eqLowQ: parameterGuidance(
        'Low EQ band width',
        'Sets the low bell’s Q from 0.1 (very wide) to 10 (narrow).',
        0.5,
        2,
        ['Shapes the bell at eqLowFreq; only audible while eqLowGain is active.'],
        ['High Q with a large eqLowGain boost rings at the band centre.'],
        noExternalModulation
    ),
    eqMidFreq: parameterGuidance(
        'Mid EQ band centre frequency',
        'Sets the centre of the mid peaking bell from 200 Hz to 8 kHz.',
        250,
        4000,
        ['Heard only when eqMidGain is beyond ±0.1 dB; eqMidQ sets its width.'],
        ['Overlaps the low and high bells at the ends of its range, so two bands can stack on one frequency.'],
        noExternalModulation
    ),
    eqMidGain: parameterGuidance(
        'Mid EQ band gain',
        'Boosts or cuts the mid bell by up to ±24 dB; bypassed until its gain moves beyond ±0.1 dB.',
        -12,
        6,
        ['Acts at eqMidFreq with width eqMidQ, after the time effects.'],
        [
            'Mid boosts after the distortion and compressor are not controlled by them, so peaks reach the output unchecked.',
        ],
        noExternalModulation
    ),
    eqMidQ: parameterGuidance(
        'Mid EQ band width',
        'Sets the mid bell’s Q from 0.1 to 10.',
        0.5,
        4,
        ['Shapes the bell at eqMidFreq; only audible while eqMidGain is active.'],
        ['A narrow mid boost placed on a filterResonance peak adds the two gains at one frequency.'],
        noExternalModulation
    ),
    eqHighFreq: parameterGuidance(
        'High EQ band centre frequency',
        'Sets the centre of the high band, also a peaking bell, from 2 kHz to 20 kHz.',
        4000,
        12000,
        ['Heard only when eqHighGain is beyond ±0.1 dB; eqHighQ sets its width.'],
        [
            'As a bell it returns to unity above its centre, so it cannot lift everything above a corner the way a shelf would.',
        ],
        noExternalModulation
    ),
    eqHighGain: parameterGuidance(
        'High EQ band gain',
        'Boosts or cuts the high bell by up to ±24 dB; bypassed until its gain moves beyond ±0.1 dB.',
        -12,
        6,
        ['Acts at eqHighFreq with width eqHighQ, after the reverb and delay.'],
        ['High boosts also brighten the reverb and delay returns and any noise from noiseLevel.'],
        noExternalModulation
    ),
    eqHighQ: parameterGuidance(
        'High EQ band width',
        'Sets the high bell’s Q from 0.1 to 10.',
        0.3,
        2,
        ['Shapes the bell at eqHighFreq; only audible while eqHighGain is active.'],
        ['A narrow high bell with a large boost turns into a piercing tone on bright engines.'],
        noExternalModulation
    ),

    // ── Delay ──────────────────────────────────────────────────────────────
    delayTime: parameterGuidance(
        'Ping-pong delay time in milliseconds',
        'Sets the repeat spacing in milliseconds with no tempo sync; the default 375 ms is a dotted eighth at 120 BPM, and 125 to 750 ms spans a sixteenth to a dotted quarter there.',
        125,
        750,
        ['delayFeedback sets how many repeats sound and delayMix their level.'],
        [
            'A change glides the read tap at up to half a sample per sample, so moving the time while repeats sound bends their pitch by up to an octave down or a fifth up.',
        ],
        noExternalModulation
    ),
    delayFeedback: parameterGuidance(
        'Ping-pong delay feedback',
        'Returns each repeat to the opposite channel at this gain (0 to 0.95); at 0.6 repeats fall about 4.4 dB each.',
        0.1,
        0.6,
        ['Heard only when delayMix is above 0.001; delayTime sets the spacing of the repeats it sustains.'],
        ['At 0.95 the repeats take about 50 s to fall 60 dB at the default 375 ms delayTime.'],
        noExternalModulation
    ),
    delayMix: parameterGuidance(
        'Delay dry/wet crossfade',
        'Crossfades dry × (1 − mix) with the delayed signal; the stage is skipped below 0.001.',
        0,
        0.4,
        ['Comes after the reverb, so with reverbMix raised the repeats carry the reverb too.'],
        ['At 1 only the delayed signal remains, so notes sound late by delayTime.'],
        noExternalModulation
    ),

    // ── Chorus ─────────────────────────────────────────────────────────────
    chorusRate: parameterGuidance(
        'Chorus modulation rate',
        'Sets the sine rate of the two delay lines, offset 90° between channels, from 0.1 to 5 Hz.',
        0.2,
        2,
        ['chorusDepth sets the delay swing this rate moves through; heard only when chorusMix is above 0.001.'],
        ['Fast rates with a large chorusDepth make an audible pitch wobble rather than a thickening.'],
        noExternalModulation
    ),
    chorusDepth: parameterGuidance(
        'Chorus delay swing',
        'Swings a 10 ms delay by ±5 ms × depth, so the default 0.4 swings it ±2 ms.',
        0.2,
        0.7,
        ['chorusRate sets how fast the swing cycles; chorusMix how much is heard.'],
        ['The deeper the swing, the larger the pitch shift of the wet signal at every rate.'],
        noExternalModulation
    ),
    chorusMix: parameterGuidance(
        'Chorus dry/wet crossfade',
        'Crossfades dry × (1 − mix) with the modulated delay; equal parts at 0.5 give the deepest chorus.',
        0,
        0.5,
        ['Comes after the delay and before the phaser; chorusDepth and chorusRate shape the wet path.'],
        ['Above 0.5 the dry fades out and at 1 only the modulated delay remains, which is vibrato rather than chorus.'],
        noExternalModulation
    ),

    // ── Phaser ─────────────────────────────────────────────────────────────
    phaserRate: parameterGuidance(
        'Phaser sweep rate',
        'Sets the sine sweep rate of the four allpass stages, with the right channel a quarter cycle ahead.',
        0.1,
        1.5,
        ['phaserDepth sets the frequency span swept; heard only when phaserMix is above 0.001.'],
        ['Fast rates sweep the notches quickly enough to sound like a warble.'],
        noExternalModulation
    ),
    phaserDepth: parameterGuidance(
        'Phaser sweep span',
        'Sweeps from 200 + (1 − depth) × 800 Hz to 2000 + depth × 6000 Hz: 1 to 2 kHz at 0, 600 Hz to 5 kHz at the default, 200 Hz to 8 kHz at 1.',
        0.3,
        1,
        ['phaserRate sets the sweep speed and phaserMix how deep the notches are.'],
        ['At low depth the sweep stays inside 1 to 2 kHz, where the moving notches can read as a nasal tone.'],
        noExternalModulation
    ),
    phaserMix: parameterGuidance(
        'Phaser dry/wet crossfade',
        'Crossfades dry × (1 − mix) with the allpass chain; the notches come from summing the two, so they are deepest at 0.5.',
        0,
        0.5,
        ['phaserDepth and phaserRate set where and how fast the notches move.'],
        ['At 1 only the allpass output remains, whose magnitude is flat, so the phasing effect disappears.'],
        noExternalModulation
    ),

    // ── Distortion ─────────────────────────────────────────────────────────
    distDrive: parameterGuidance(
        'Distortion input gain',
        'Multiplies the summed layers by 1 + 3 × drive, clamps to ±4 and soft-clips with 2× oversampling; at 1 (gain 4) a full-scale input already reaches the clamp.',
        0,
        1,
        ['Heard only when distMix is above 0.001; distTone low-passes the result.'],
        [
            'The wet path is capped near ±1 whatever drive reaches it, so higher drive adds distortion but no more level.',
        ],
        noExternalModulation
    ),
    distTone: parameterGuidance(
        'Distortion tone low-pass',
        'Sets a one-pole low-pass on the distorted signal with coefficient 0.2 + 0.8 × tone; 1 leaves it unfiltered.',
        0.3,
        1,
        ['Filters only the distortion’s wet path, blended by distMix.'],
        ['Low values darken the distorted path heavily, so mixed in it can sound muffled against the dry signal.'],
        noExternalModulation
    ),
    distMix: parameterGuidance(
        'Distortion dry/wet crossfade',
        'Crossfades the dry layers with the distorted path; the stage is skipped below 0.001, and even at distDrive 0 the distorted path maps a full-scale peak to about 0.78.',
        0,
        0.5,
        [
            'Comes first in the effect chain, so the compressor, reverb and delay all process its output; distDrive and distTone shape the wet path it blends.',
        ],
        ['At 1 every louder peak is flattened to the distortion’s ±1 ceiling.'],
        noExternalModulation
    ),

    // ── Compressor ─────────────────────────────────────────────────────────
    compThreshold: parameterGuidance(
        'Compressor threshold in dB',
        'Sets the peak level above which gain is reduced; it also sets the automatic makeup, (1 − 1/ratio) × (−threshold)/2 dB, which is 7.5 dB at the default −20 dB and 4:1.',
        -30,
        -6,
        ['compRatio sets the reduction above it and, with it, the makeup; compMix blends the result.'],
        ['Low thresholds raise the makeup on everything: −60 dB at 20:1 adds 28.5 dB to quiet material.'],
        noExternalModulation
    ),
    compRatio: parameterGuidance(
        'Compressor ratio',
        'Reduces level above compThreshold by 1 − 1/ratio of the overshoot in dB, from 1:1 to 20:1.',
        2,
        8,
        ['Scales the automatic makeup together with compThreshold.'],
        ['At 1:1 there is no reduction and no makeup, so compMix changes nothing.'],
        noExternalModulation
    ),
    compAttack: parameterGuidance(
        'Compressor attack in milliseconds',
        'Sets the time constant with which the peak detector, the louder of the two channels, rises.',
        1,
        30,
        ['compRelease sets the fall; compThreshold decides when the detector’s level causes reduction.'],
        [
            'Short attacks clamp each note’s transient along with the peak, which can flatten plucks and percussive engines.',
        ],
        noExternalModulation
    ),
    compRelease: parameterGuidance(
        'Compressor release in milliseconds',
        'Sets the time constant with which the peak detector falls after the signal drops.',
        50,
        300,
        ['Works with compAttack; the detector keeps following silence so the release continues between notes.'],
        ['Short releases with a high compRatio pump audibly on sustained chords.'],
        noExternalModulation
    ),
    compMix: parameterGuidance(
        'Compressor parallel blend',
        'Blends the dry signal with the compressed and made-up signal; the stage is skipped below 0.001.',
        0,
        0.5,
        ['compThreshold and compRatio set the makeup the blend carries into the output.'],
        [
            'The makeup also lifts material below the threshold, so raising compMix raises overall level before masterGain.',
        ],
        noExternalModulation
    ),

    // ── Width and layers ───────────────────────────────────────────────────
    stereoWidth: parameterGuidance(
        'Mid/side stereo width',
        'Scales the side signal of the summed output: 0 is mono, 1 unchanged and 2 doubles the side (+6 dB).',
        0.5,
        1.4,
        ['Widens or narrows what unisonSpread, grainPanSpread, layerPan and the stereo effects created.'],
        [
            'At 0 the output is mono, discarding every stereo result upstream, from unison and grain spread to layer pans and the stereo effects.',
        ],
        noExternalModulation
    ),
    activeLayer: parameterGuidance(
        'Layer that receives per-layer edits',
        'Writes no audio state: it only chooses which of the four layers later per-layer writes land on, and note handling and rendering never read it.',
        0,
        0,
        ['With numLayers at 1 only layer 0 renders, so edits sent to layers 1 to 3 change nothing audible.'],
        [
            'Every per-layer control lands on whichever layer this selected last, so a later edit meant for layer 0 changes another layer if it was left elsewhere.',
        ],
        noExternalModulation
    ),
    numLayers: parameterGuidance(
        'Number of sounding layers',
        'Renders layers 0 to numLayers − 1 and starts every note on each; each layer takes one voice per note from the shared ceiling, so 2 layers halve the notes that can sound.',
        1,
        2,
        ['activeLayer chooses which layer later edits reach; layerLevel and layerPan mix each layer.'],
        [
            'A layer never edited plays the engine’s built-in settings rather than the descriptor defaults, so raising numLayers can add an unexpected saw layer on top.',
        ],
        noExternalModulation
    ),
    layerLevel: parameterGuidance(
        'Per-layer output level',
        'Multiplies the active layer’s output with an equal-power pan, so at centre each channel receives 0.707 × layerLevel.',
        0.5,
        1,
        ['layerPan positions the same layer; masterGain scales the sum of every layer afterwards.'],
        ['Several layers at 1 add in level, so the summed output rises with numLayers.'],
        noExternalModulation
    ),
    layerPan: parameterGuidance(
        'Per-layer pan',
        'Pans the active layer from −1 (left) to 1 (right) with an equal-power law, the centre 3 dB down per channel.',
        -0.7,
        0.7,
        ['Places the layer that layerLevel sets; stereoWidth then scales the resulting side signal.'],
        ['At ±1 the layer drops out of the opposite channel entirely.'],
        noExternalModulation
    ),

    // ── Master ─────────────────────────────────────────────────────────────
    masterGain: parameterGuidance(
        'Final output gain',
        'Multiplies the whole instrument after stereo width as the last stage, smoothed; 0.5 to 1 spans −6 dB to unity.',
        0.5,
        1,
        ['Scales every layer and every effect return together, after stereoWidth.'],
        ['Above 1 it amplifies after every effect with no limiter, so dense chords can clip downstream.'],
        noExternalModulation
    ),
};
