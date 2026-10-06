import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION } from './GuidanceProfiles';

/**
 * Per-parameter guidance for Fermenter's sound sources — the engine selector,
 * oscillator, unison, noise, drift, warp, audio-rate modulation, the additive,
 * plucked-string, granular, sampler and FM engines, and per-voice drive —
 * taken from `crates/daw-dsp/src/fermenter` (`voice.rs`, `oscillator.rs`,
 * `noise.rs`, `spectral.rs`, `additive.rs`, `physical.rs`, `granular.rs`,
 * `sampler.rs`, `fm.rs`). Every id here is per layer: `MasterSynth::set_param`
 * hands it to the layer `activeLayer` selects.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const FERMENTER_SOURCE_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    // ── Oscillator ─────────────────────────────────────────────────────────
    oscEngine: parameterGuidance(
        'Synthesis engine selector for the active layer',
        'Selects 0 wavetable, 1 band-limited analog, 2 four-operator FM, 3 plucked string, 4 granular, 5 additive or 6 sampler; the window stops at 5 because the sampler plays only its built-in one-second 440 Hz decaying tone.',
        0,
        5,
        [
            'Decides which engine controls are heard: oscWaveform and unisonVoices act on engines 0 and 1, the fm* controls on 2, ks* on 3, grain* on 4, additive* on 5 and sampler* on 6.',
        ],
        [
            'The plucked string is excited only at note-on, so switching a held note onto engine 3 silences it until the next note.',
        ],
        noExternalModulation
    ),
    oscWaveform: parameterGuidance(
        'Oscillator waveform: sine, saw, square or triangle',
        'Picks 0 sine, 1 saw, 2 square or 3 triangle for the wavetable, analog and unison oscillators; saw and square are the two whose harmonics fall only as 1/n, while sine has one harmonic and triangle falls as 1/n².',
        1,
        2,
        [
            'On engine 1 the square reads pulseWidth; FM, plucked string, granular, additive and sampler ignore it, and the grains always read the saw table.',
        ],
        [
            'Moving it rewrites notes already sounding on the next block, so automating it mid-note switches the timbre abruptly.',
        ],
        noExternalModulation
    ),
    oscLevel: parameterGuidance(
        'Oscillator level before noise and filter',
        'Multiplies the engine output, whose tables peak at 1, before noise is added and before the filter; 0.5 to 1 spans −6 dB to full scale.',
        0.5,
        1,
        [
            'noiseLevel is added after this gain, so oscLevel also sets the oscillator-to-noise balance, and it sets how hard filterDrive and voiceDrive are driven.',
        ],
        ['At 0 the engine is silent and only the noise from noiseLevel reaches the filter.'],
        noExternalModulation
    ),
    oscCoarse: parameterGuidance(
        'Coarse transpose in semitones',
        'Shifts every engine’s pitch by whole semitones (coarse + fine/100); the window reaches two octaves down but one up because the band-limited tables halve their harmonic count per octave and additive partials at or above Nyquist are dropped.',
        -24,
        12,
        [
            'Adds to oscFine and to every pitch modulation; the plucked string, granular, additive and sampler engines all follow it.',
        ],
        [
            'The plucked string’s delay buffer holds only 1/20 s, so a transposition that takes a low note under 20 Hz is clamped to 20 Hz instead.',
        ],
        noExternalModulation
    ),
    oscFine: parameterGuidance(
        'Fine tune in cents',
        'Offsets pitch continuously by up to ±100 cents; ±25 cents keeps a layer within a quarter-tone of the others for layer-against-layer detuning.',
        -25,
        25,
        [
            'Combines with oscCoarse as one offset in semitones, and is a per-layer value, so it detunes one layer against another when numLayers is above 1.',
        ],
        ['Past ±50 cents the layer sits nearer the neighbouring semitone, which oscCoarse reaches exactly.'],
        noExternalModulation
    ),
    pulseWidth: parameterGuidance(
        'Pulse duty cycle of the analog square',
        'Sets the high fraction of the analog pulse (0.05 to 0.95); widths w and 1 − w have the same harmonic magnitudes, so 0.1 to 0.5 covers every distinct tone.',
        0.1,
        0.5,
        [
            'Heard only with oscEngine at 1, oscWaveform at 2 and unisonVoices at 1; with more unison voices engine 1 renders the wavetable bank and drops the pulse width.',
        ],
        ['On every other engine or waveform it changes nothing, so automating it there has no audible result.'],
        noExternalModulation
    ),

    // ── Unison ─────────────────────────────────────────────────────────────
    unisonVoices: parameterGuidance(
        'Unison oscillator count per note',
        'Stacks up to 16 detuned wavetable oscillators per note, scaled by 1/√count; each copy is another oscillator computed for every sounding note.',
        1,
        8,
        ['unisonDetune and unisonSpread act only above 1; FM (oscEngine 2) and engines 3 to 6 ignore the stack.'],
        [
            'On engine 1, any value above 1 replaces the analog oscillator with the wavetable bank, so the analog waveform and pulse width are lost.',
        ],
        noExternalModulation
    ),
    unisonDetune: parameterGuidance(
        'Total unison detune in cents',
        'Spreads the copies evenly from −detune/2 to +detune/2 cents, so 50 puts the outermost copies 25 cents either side of the note.',
        0,
        50,
        ['Needs unisonVoices above 1; unisonSpread pans the same copies that this detunes.'],
        [
            'At 100 the outer copies sit a full semitone apart (±50 cents), which reads as out of tune rather than thick on sustained notes.',
        ],
        noExternalModulation
    ),
    unisonSpread: parameterGuidance(
        'Unison stereo spread',
        'Pans the copies evenly from −spread to +spread with an equal-power law; at 1 the outermost copies are hard left and right.',
        0.5,
        1,
        [
            'Needs unisonVoices above 1, and stereoWidth then scales the side signal it creates for the whole instrument.',
        ],
        [
            'The pan is restored after the mono filter as a level balance that is exact only while one copy dominates, so with many copies the stereo image is an approximation.',
        ],
        noExternalModulation
    ),

    // ── Noise and drift ────────────────────────────────────────────────────
    noiseLevel: parameterGuidance(
        'Noise mixed into the voice before the filter',
        'Adds noise peaking at ±noiseLevel after oscLevel and before the filter, on every engine; 0.3 sets white-noise peaks about 10 dB under a full-scale oscillator.',
        0,
        0.3,
        [
            'noiseColor picks the noise colour, and oscLevel does not scale it, so the two set their balance independently.',
        ],
        ['At 1 the noise peaks match a full-scale oscillator and can bury the pitched signal.'],
        noExternalModulation
    ),
    noiseColor: parameterGuidance(
        'Noise colour: white, pink or brown',
        'Selects 0 white, 1 pink (eight-row running sum ÷ 9) or 2 brown (a leaky integrator multiplied by 10 and hard-clamped to ±1).',
        0,
        1,
        ['Heard only when noiseLevel is above 0.'],
        [
            'Brown noise is hard-clamped at ±1 after a tenfold gain, so its loud excursions are flattened rather than passed through.',
        ],
        noExternalModulation
    ),
    oscDrift: parameterGuidance(
        'Slow random pitch drift amount',
        'Wanders each voice’s pitch by up to ±5 cents × oscDrift through a slow 0.18 Hz and 0.51 Hz mixture; 0.5 stays within ±2.5 cents.',
        0,
        0.5,
        ['Multiplies the voice frequency on top of oscCoarse, oscFine and every pitch modulation.'],
        [
            'The amount is written into the voices that exist at the time rather than stored on the layer, so a voice swapped in from the steal-fade pool after a voice steal plays without it.',
        ],
        noExternalModulation
    ),

    // ── Time-domain warp ──────────────────────────────────────────────────
    warpMode: parameterGuidance(
        'Waveform warp algorithm',
        'Selects 0 off, 1 sync, 2 sample-and-bit reduction, 3 squeeze, 4 bend, 5 formant comb or 6 fold; the window stops at 4 because fold can return up to 3.4 × full scale and formant reads a phase that moves only on engines 0 and 1.',
        0,
        4,
        [
            'Does nothing until warpAmount is above 0.001; sync and formant read the oscillator phase, which does not advance on oscEngine 2 to 6, so there they act as fixed gain or offset changes rather than timbral ones.',
        ],
        [
            'Squeeze adds a DC bias of 2 × warpAmount − 1, so low amounts push the waveform toward −1 and leave an offset the low-pass filter passes.',
        ],
        noExternalModulation
    ),
    warpAmount: parameterGuidance(
        'Warp intensity',
        'Scales the chosen warp: at 0.5 reduction keeps 9 bits and holds each value for about 17 samples, squeeze is unbiased, and fold’s four folds still return inside its threshold.',
        0,
        0.5,
        ['Acts only through warpMode; at 0 every mode passes the oscillator unchanged.'],
        [
            'Above about 0.71 fold needs more than its four folds, so at 1 a full-scale input leaves at up to 3.4, far above the oscillator’s own peak.',
        ],
        noExternalModulation
    ),

    // ── Audio-rate modulation ─────────────────────────────────────────────
    audioModRate: parameterGuidance(
        'Audio-rate modulator frequency',
        'Sets a fixed-Hz sine modulator (it does not follow the played note) from 0 to 5000 Hz; at 0 its phase never moves and it outputs nothing.',
        0,
        1000,
        [
            'Heard only when audioModDepth is above 0.001 and audioModTarget is not 0; the modulator restarts at every note-on.',
        ],
        [
            'Because the rate is fixed in Hz rather than a ratio of the note, one setting gives harmonic sidebands on some notes and inharmonic ones on others.',
        ],
        noExternalModulation
    ),
    audioModDepth: parameterGuidance(
        'Audio-rate modulation depth',
        'Scales the modulator: ±depth octaves of pitch, a 1 ± depth amplitude multiplier, or ±2 × depth on the cutoff multiplier, depending on the target.',
        0,
        0.5,
        ['audioModTarget chooses which of the three it scales and audioModRate sets its frequency.'],
        [
            'At 1 on the amplitude target the gain swings to 0 and 2 every cycle, and on the filter target the trough already reaches the 20 Hz clamp from 0.5.',
        ],
        noExternalModulation
    ),
    audioModTarget: parameterGuidance(
        'Audio-rate modulation destination',
        'Selects 0 off, 1 pitch (FM), 2 amplitude (AM and ring) or 3 filter cutoff; the window stops at 2 because the filter route adds ±2 × depth to the cutoff multiplier.',
        0,
        2,
        ['audioModDepth and audioModRate do nothing while this is 0.'],
        [
            'The filter route can pull the cutoff to its 20 Hz clamp on every modulator trough, which chops the note at the modulator rate.',
        ],
        noExternalModulation
    ),

    // ── Additive ───────────────────────────────────────────────────────────
    additivePartials: parameterGuidance(
        'Additive partial count',
        'Sums up to 64 sine partials of a 1/n series and divides by √count, so fewer partials are louder: 8 peak near 0.59 and 32 near 0.32 of full scale.',
        8,
        32,
        [
            'Heard on oscEngine 5; additiveTilt, additiveOdd and additiveInharm reshape the same partials, and partials at or above Nyquist are dropped.',
        ],
        [
            'Partials above 32 only add content to notes whose 33rd partial is still below Nyquist (fundamentals under about 727 Hz at 48 kHz), while their extra √count division lowers every note.',
        ],
        noExternalModulation
    ),
    additiveTilt: parameterGuidance(
        'Additive spectral tilt',
        'Multiplies partial n by (n − 1)^(tilt/6), about tilt dB per doubling; at +6 the upper partials approach equal amplitude and the peak rises from about 0.32 to 3.9 of full scale.',
        -6,
        2,
        ['Shapes the partials additivePartials enables; additiveOdd attenuates the even ones on top of this tilt.'],
        [
            'Positive tilt raises level steeply as well as brightness, so a sweep toward +6 can add over 20 dB at the engine output.',
        ],
        noExternalModulation
    ),
    additiveOdd: parameterGuidance(
        'Even-partial attenuation',
        'Scales even partials by 1 − amount: 0.5 lowers them 6 dB, 0.9 lowers them 20 dB and 1 removes them for a square-like odd series.',
        0,
        0.9,
        ['Applies to the partials additivePartials enables, after additiveTilt.'],
        ['Removing the even partials hollows the tone and lowers its level, since half the series drops out.'],
        noExternalModulation
    ),
    additiveInharm: parameterGuidance(
        'Additive inharmonicity',
        'Moves partial n to n × (1 + B × n²) of the fundamental; by 0.01 the tenth partial already sits where the twentieth harmonic would.',
        0,
        0.01,
        [
            'Stretches the partials additivePartials enables; even the first partial rises by a factor of 1 + amount, about 17 cents at 0.01, while the upper series spreads as n².',
        ],
        [
            'Stretched partials reach Nyquist sooner, and the engine stops at the first partial past it, so high values also cut the partial count on upper notes.',
        ],
        noExternalModulation
    ),

    // ── Plucked string ─────────────────────────────────────────────────────
    ksDamping: parameterGuidance(
        'String loop damping',
        'Sets the loop low-pass coefficient to 1 − 0.5 × damping on every block; at 0 the loop has no loss filter, and at 0.99 the coefficient falls to about 0.5.',
        0.1,
        0.9,
        ['Heard on oscEngine 3; ksBrightness sets the initial excitation, and this sets how fast it dies.'],
        [
            'Near 0 the string barely decays on its own, so the ampSustain and ampRelease envelope alone decide when the note ends.',
        ],
        noExternalModulation
    ),
    ksBrightness: parameterGuidance(
        'String excitation brightness',
        'Low-passes the noise burst that excites the string at note-on with coefficient 0.1 to 1; 1 is an unfiltered burst.',
        0.3,
        1,
        ['Heard on oscEngine 3; ksDamping then darkens the string as it rings.'],
        ['It is read only at note-on, so changing it while a note rings has no effect on that note.'],
        noExternalModulation
    ),

    // ── Granular ───────────────────────────────────────────────────────────
    grainDensity: parameterGuidance(
        'Grains started per second',
        'Starts one grain every 1/density seconds; at the default 50 ms grain size, 20 per second is the first density with no gaps between grains.',
        20,
        80,
        [
            'grainSize sets how long each grain lasts, so density × size is the number overlapping; heard on oscEngine 4.',
        ],
        ['Only 32 grains can sound at once, so when density × grainSize exceeds 32 new grains are silently skipped.'],
        noExternalModulation
    ),
    grainSize: parameterGuidance(
        'Grain length in milliseconds',
        'Sets each grain’s Hann-windowed length; short grains leave gaps at low density, and long overlapping grains blur the stereo pan.',
        20,
        200,
        [
            'grainDensity × grainSize sets the overlap; grainPanSpread positions are restored less accurately as grains overlap.',
        ],
        [
            'The pan is restored after the mono filter as a balance, measured at 14.6 % error at 20 grains/s and 200 ms and 48.3 % at 100 grains/s and 500 ms.',
        ],
        noExternalModulation
    ),
    grainPosition: parameterGuidance(
        'Grain start phase within the saw cycle',
        'Sets the phase (0 to 1) of the single saw cycle each grain starts reading from; it does not scan through any sample, so 0 and 1 are the same start.',
        0,
        0.5,
        ['grainSpray randomises each grain’s start around this phase.'],
        [
            'Every grain repeats the same saw cycle from this phase, so moving it changes only where each grain’s window opens on the cycle, not the material heard.',
        ],
        noExternalModulation
    ),
    grainSpray: parameterGuidance(
        'Random spread of grain start phase',
        'Adds a random ±spray to each grain’s start phase, clamped to 0 to 1 rather than wrapped.',
        0,
        0.5,
        ['Spreads around grainPosition; heard on oscEngine 4.'],
        [
            'Because the phase is clamped rather than wrapped, with grainPosition at 0 every negative draw lands on 0 and the spread is one-sided.',
        ],
        noExternalModulation
    ),
    grainPitchVar: parameterGuidance(
        'Random grain pitch spread in semitones',
        'Detunes each grain by a uniform random ±pitchVar semitones at its start; ±2 keeps every grain within a whole tone of the note.',
        0,
        2,
        [
            'Each grain keeps the pitch it started with, so glide from portamentoTime and LFO pitch from lfoPitchAmount reach only grains started afterwards.',
        ],
        ['At 12 grains land anywhere in a two-octave band and the note loses a clear pitch.'],
        noExternalModulation
    ),
    grainPanSpread: parameterGuidance(
        'Random grain pan spread',
        'Pans each grain to a random position within ±spread using a linear law; the pair is then restored as a balance after the mono filter.',
        0,
        0.8,
        ['Overlap from grainDensity × grainSize degrades how faithfully the pan survives the filter.'],
        [
            'Grain pans are random, so even at full spread a passage can lean to one side until enough grains average it out.',
        ],
        noExternalModulation
    ),

    // ── Sampler ────────────────────────────────────────────────────────────
    samplerMode: parameterGuidance(
        'Sampler playback mode',
        'Selects 0 one-shot (64-sample fade at the end), 1 loop (64-sample crossfade at the loop point) or 2 ping-pong (reverses at both ends with no crossfade).',
        0,
        1,
        ['samplerStart and samplerEnd set the region played or looped; heard on oscEngine 6.'],
        [
            'The source is the built-in one-second 440 Hz tone, and middle C plays it at 440 Hz, so the sampler sounds nine semitones above the note played.',
        ],
        noExternalModulation
    ),
    samplerStart: parameterGuidance(
        'Sample start point',
        'Sets where playback starts, and the loop start, as a fraction of the one-second source, which decays as e^(−8t): by 0.5 it is about 35 dB down.',
        0,
        0.5,
        ['samplerEnd is kept at least 0.01 after it; in loop and ping-pong it is also the loop start.'],
        ['Late start points begin in the quiet tail of the decaying source, so the note can be barely audible.'],
        noExternalModulation
    ),
    samplerEnd: parameterGuidance(
        'Sample end point',
        'Sets where one-shot playback stops and loops turn, as a fraction of the source; it is forced at least 0.01 past samplerStart.',
        0.25,
        1,
        ['Works with samplerStart and samplerMode to set the played region.'],
        [
            'A one-shot that reaches its end goes silent while the amp envelope still holds the voice, so a note held past the end leaves ampRelease nothing to shape.',
        ],
        noExternalModulation
    ),

    // ── Per-voice drive ───────────────────────────────────────────────────
    voiceDrive: parameterGuidance(
        'Per-voice saturation after the filter',
        'Multiplies each voice’s filtered signal by 1 + drive into a rational tanh curve that reaches 1 at an input of 3, so up to 2 a full-scale voice lands at the curve’s knee.',
        0,
        2,
        ['Follows filterDrive, which saturates at the filter; oscLevel sets the level reaching both.'],
        [
            'The curve is not a ceiling: past an input of 3 it keeps rising (about 1.46 at drive 10 with a full-scale voice), so high drive raises level as well as distortion.',
        ],
        noExternalModulation
    ),

    // ── FM ─────────────────────────────────────────────────────────────────
    fmAlgorithm: parameterGuidance(
        'FM operator routing',
        'Selects one of eight routings: 0 stack 4→3→2→1, 1 pairs 2→1 and 4→3, 2 Y 3→1 and 4→2→1, 3 all carriers, 4 fork, 5 and 6 with fixed operator-4 feedback, 7 one pair plus two carriers; 0 to 2 use at most two carriers and no fixed feedback.',
        0,
        2,
        [
            'Decides which of fmLevel1 to fmLevel4 are carrier volumes and which are modulation depths; changing it also rebuilds the routing fmModAmount scales.',
        ],
        ['Algorithm 3 sums all four operators, 2.6 at the default levels, so switching to it raises level sharply.'],
        noExternalModulation
    ),
    fmRatio1: parameterGuidance(
        'Operator 1 frequency ratio',
        'Sets operator 1’s frequency as a multiple of the note; operator 1 is a carrier in every algorithm, so 0.5 sounds an octave down and 4 two octaves up.',
        0.5,
        4,
        ['Pitch relationships with fmRatio2 to fmRatio4 decide whether the sidebands are harmonic.'],
        [
            'Because operator 1 is always heard, a non-integer ratio moves the perceived pitch away from the note played.',
        ],
        noExternalModulation
    ),
    fmRatio2: parameterGuidance(
        'Operator 2 frequency ratio',
        'Sets operator 2’s frequency multiple; it modulates operator 1 in every algorithm except 3, where it is a carrier.',
        0.5,
        8,
        [
            'fmLevel2 and fmModAmount set how deeply it modulates; integer ratios against fmRatio1 keep the sidebands harmonic.',
        ],
        [
            'Operators are plain sines with no band-limiting, so high ratios push sidebands of upper notes past Nyquist where they fold back inharmonically.',
        ],
        noExternalModulation
    ),
    fmRatio3: parameterGuidance(
        'Operator 3 frequency ratio',
        'Sets operator 3’s frequency multiple; it modulates operator 2 or 1 in algorithms 0, 2, 4, 5 and 6 and is a carrier in 1, 3 and 7.',
        0.5,
        8,
        [
            'fmLevel3 scales it; in algorithm 1 it is heard directly beside operator 1, so its ratio against fmRatio1 sets an interval.',
        ],
        ['In the carrier algorithms a non-integer ratio adds a second, inharmonic pitch rather than a sideband.'],
        noExternalModulation
    ),
    fmRatio4: parameterGuidance(
        'Operator 4 frequency ratio',
        'Sets operator 4’s frequency multiple; it heads the modulation chain in algorithms 0, 1, 2, 4 and 6 and is a carrier in 3, 5 and 7.',
        0.5,
        8,
        ['fmLevel4 scales it, and in algorithms 5 and 6 it also feeds back on itself at a fixed 0.5 or 0.7.'],
        [
            'As a carrier in algorithms 3, 5 and 7 a non-integer ratio sounds as a separate inharmonic tone beside the note.',
        ],
        noExternalModulation
    ),
    fmLevel1: parameterGuidance(
        'Operator 1 output level',
        'Scales operator 1, which is a carrier in all eight algorithms, so it is always an output volume; it also scales the signal fmFeedback feeds back.',
        0.5,
        1,
        ['fmFeedback multiplies this operator’s own output, so lowering fmLevel1 also weakens the feedback.'],
        ['At 0 algorithms 0, 2, 4 and 6, whose only carrier is operator 1, go silent.'],
        noExternalModulation
    ),
    fmLevel2: parameterGuidance(
        'Operator 2 level (mostly modulation depth)',
        'Scales operator 2; as a modulator its depth is level × fmModAmount × 2π radians, so 0.1 to 0.8 spans about 0.6 to 5 radians at fmModAmount 1.',
        0.1,
        0.8,
        ['fmModAmount multiplies its depth; in algorithm 3 it is a carrier and sets volume instead.'],
        [
            'Raising it adds upper sidebands quickly, so at full level with fmModAmount above 1 the tone turns harsh and aliases on high notes.',
        ],
        noExternalModulation
    ),
    fmLevel3: parameterGuidance(
        'Operator 3 level',
        'Scales operator 3: a modulation depth in algorithms 0, 2, 4, 5 and 6, a carrier volume in 1, 3 and 7.',
        0,
        0.6,
        ['fmAlgorithm decides its role, and fmModAmount scales it only where it modulates.'],
        [
            'The same value means depth in one algorithm and volume in another, so changing fmAlgorithm can make operator 3 jump from timbre to loudness.',
        ],
        noExternalModulation
    ),
    fmLevel4: parameterGuidance(
        'Operator 4 level',
        'Scales operator 4: the top modulator in algorithms 0, 1, 2, 4 and 6, a carrier in 3, 5 and 7.',
        0,
        0.5,
        ['fmRatio4 sets its frequency; in algorithms 5 and 6 its fixed self-feedback scales with this level.'],
        [
            'In algorithms 5 and 7 it is heard directly, so the low default that works as a modulator can be too quiet or too loud as a carrier.',
        ],
        noExternalModulation
    ),
    fmFeedback: parameterGuidance(
        'Operator 1 self-feedback',
        'Feeds operator 1’s previous output back into its own phase, in radians scaled by its level; it reaches only operator 1, not the fixed operator-4 feedback.',
        0,
        0.5,
        ['fmLevel1 scales the signal fed back; fmAlgorithm 5 and 6 add their own fixed feedback on operator 4.'],
        [
            'Feedback turns the carrier’s sine toward a saw-like, noisier tone that is heard directly on every algorithm.',
        ],
        noExternalModulation
    ),
    fmModAmount: parameterGuidance(
        'Global FM modulation depth',
        'Rescales every active routing in the algorithm to this amount, multiplying each modulator’s depth; keep it above 0 because 0 latches the routing off.',
        0.25,
        2,
        ['Multiplies the depth set by fmLevel2, fmLevel3 and fmLevel4 wherever they modulate.'],
        [
            'At 0 each voice configured there loses its routing entries, and raising fmModAmount again restores no modulation in those voices until fmAlgorithm changes.',
        ],
        noExternalModulation
    ),
};
