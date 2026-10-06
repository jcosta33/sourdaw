import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, instrumentGuidance } from './GuidanceProfiles';

/**
 * Guidance for Crumbs, taken from `crates/daw-dsp/src/crumbs`.
 *
 * `CrumbsEngine::set_param` writes the envelope and filter values into the
 * Quick and Slice mode settings only (Drum pads carry their own), and a voice
 * reads them at trigger, so they reach notes started after the write. Tune,
 * pan and the stack settings are applied per voice in `note_on` in every
 * mode; `masterGain` is a smoothed multiplier on the summed output.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const CRUMBS_GUIDANCE = instrumentGuidance(
    'Play a loaded sample chromatically, as pads, or as slices, with an amp envelope, a resonant multimode filter and an optional detuned voice stack.',
    [
        'The envelope, filter and resonance parameters set the Quick and Slice modes only; Drum-mode pads keep their own envelope and filter.',
        'Stacked voices are summed without level compensation, so lower masterGain when raising stackCount.',
    ],
    [
        'Envelope, filter, tune, pan and stack settings apply to notes started after the change, while masterGain scales the summed output immediately.',
    ],
    [
        'When sounding voices exhaust the engine’s resampling budget, which happens sooner for voices pitched more than an octave up, a new note is dropped whole rather than played.',
    ]
);

export const CRUMBS_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    masterGain: parameterGuidance(
        'Engine output gain after all voices are summed',
        'Scales the summed output of every sounding voice in every playback mode, smoothed with a 10 ms time constant.',
        0.4,
        1,
        [
            'stackCount adds voices at full level without compensation, so masterGain is where the extra stack level is taken back.',
        ],
        [
            'Above 1 it amplifies past the sample’s own level with no limiter after it, so loud samples, stacks or resonant filtering can clip downstream.',
        ],
        noExternalModulation
    ),
    attack: parameterGuidance(
        'Amp-envelope attack time for Quick and Slice notes',
        'Sets how long each new note takes to rise to full level on an exponential curve before hold and decay.',
        0.001,
        0.05,
        ['hold starts when the attack reaches full level; Drum-mode pads ignore attack and use their own envelope.'],
        [
            'An attack longer than the sample’s own transient fades in over it, softening the onset of drum hits and plucks.',
        ],
        noExternalModulation
    ),
    hold: parameterGuidance(
        'Amp-envelope hold time at full level',
        'Keeps each new note at full level for this long after the attack before decay begins.',
        0,
        0.3,
        ['Inaudible while sustain is 1, because decay has nowhere to fall after the hold.'],
        [
            'A hold longer than short notes keeps them at full level until note-off, so decay and sustain never shape them.',
        ],
        noExternalModulation
    ),
    decay: parameterGuidance(
        'Amp-envelope decay time to the sustain level',
        'Sets how long each new note takes to fall exponentially from full level to sustain after the hold.',
        0.05,
        2,
        ['Has no audible effect at the default sustain of 1; lower sustain first.'],
        ['With sustain near 0, a short decay cuts long samples off early even while the key is held.'],
        noExternalModulation
    ),
    sustain: parameterGuidance(
        'Amp-envelope held level',
        'Sets the fraction of full level a held note settles at after decay.',
        0.3,
        1,
        ['decay and hold only become audible once sustain is below 1.'],
        ['At 0 every held note dies after decay, so sustained or looping samples stop before note-off.'],
        noExternalModulation
    ),
    release: parameterGuidance(
        'Amp-envelope release time after note-off',
        'Sets how long a note fades after its key is released; one-shot playback ignores note-off, so release does not apply there.',
        0.01,
        2,
        [
            'Fades from whatever level attack, decay and sustain reached; the descriptor reports release as the instrument tail.',
        ],
        [
            'Long releases keep voices sounding under later notes, and with stackCount above 1 each released note holds that many of the 128 voices.',
        ],
        noExternalModulation
    ),
    filterCutoff: parameterGuidance(
        'Per-voice multimode filter corner for Quick and Slice notes',
        'Sets the corner of each new note’s state-variable filter, a lowpass unless the panel selects highpass, bandpass or notch; at 20000 Hz the lowpass corner sits at the top of the audio band.',
        200,
        20000,
        ['filterResonance sets the peak at this corner; both are fixed for a note when it starts.'],
        [
            'A low cutoff with high filterResonance puts up to 20 times (+26 dB) gain on whatever sits at the corner, enough to clip a loud sample.',
        ],
        noExternalModulation
    ),
    filterResonance: parameterGuidance(
        'Filter Q from 0.5 to 20',
        'Sets the filter’s gain at the cutoff, from a damped 0.5 to 20 at the onset of self-oscillation; above Q 10 the filter runs at twice the sample rate.',
        0.5,
        8,
        ['The peak lands at filterCutoff, so judge it there; the value is fixed for a note when it starts.'],
        ['Near 20 the filter reaches the onset of self-oscillation and rings at the cutoff on every transient.'],
        noExternalModulation
    ),
    tune: parameterGuidance(
        'Global pitch offset in semitones',
        'Transposes every new note by resampling, so pitch and playback speed move together: +12 plays the sample an octave up in half the time.',
        -24,
        12,
        ['detuneSpread adds its per-voice offsets on top of tune for stacked voices.'],
        [
            'Beyond an octave of upward shift (tune plus the note’s distance above the root) a voice needs a wider anti-alias kernel, and once sounding voices exhaust the resampling budget new notes are dropped silently.',
        ],
        noExternalModulation
    ),
    pan: parameterGuidance(
        'Base stereo position for new voices',
        'Places each new voice with an equal-power pan law; a voice stack spreads around this position.',
        -0.7,
        0.7,
        ['stackSpread offsets stacked voices to either side of pan, and the sum is clamped to −1..1.'],
        [
            'Near the edges the outer stacked voices clamp onto the same hard-panned position, collapsing the spread on that side.',
        ],
        noExternalModulation
    ),
    stackCount: parameterGuidance(
        'Number of unison voices per note',
        'Starts this many voices, from 1 to 8, for every note, each at full level.',
        1,
        4,
        [
            'detuneSpread and stackSpread spread the stacked voices in pitch and pan; with both at 0 the voices are identical.',
        ],
        [
            'Voices add without level compensation, so 4 identical voices reach 4 times (+12 dB) the single-voice level, and each note claims that many of the 128 voices.',
        ],
        noExternalModulation
    ),
    detuneSpread: parameterGuidance(
        'Total pitch spread across the voice stack in cents',
        'Spreads stacked voices evenly across plus or minus half this many cents around the note; inaudible at a stackCount of 1.',
        0,
        40,
        ['Needs stackCount above 1, and its offsets add to tune.'],
        [
            'At 0, with stackSpread also 0, the stacked copies are identical and sum to one louder voice rather than a chorus.',
        ],
        noExternalModulation
    ),
    stackSpread: parameterGuidance(
        'Stereo spread of the voice stack',
        'Pans stacked voices evenly from −stackSpread to +stackSpread around pan; 1 reaches full width.',
        0,
        0.7,
        ['Needs stackCount above 1, and pan offsets the whole spread.'],
        [
            'At 1 the outer voices sit hard left and right, so a mono fold-down sums the centred voices 3 dB louder than the outer ones and the stack’s balance shifts.',
        ],
        noExternalModulation
    ),
};
