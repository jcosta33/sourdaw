import { type registerMidiTransforms } from '#/modules/Command/stores';

import { generateChordProgressionTransform } from './chordProgressionTransform';
import { generateDrumPatternTransform } from './drumPatternTransform';
import { generateMelodyTransform } from './melodyTransform';

/**
 * The generators this module supplies for the command contract's transform names. Bootstrap hands
 * this map to the registry; nothing here knows what the compiler does with the notes, and nothing in
 * Command or the compiler depends on this module.
 */
export const MIDI_TRANSFORM_IMPLEMENTATIONS: Parameters<typeof registerMidiTransforms>[0] = {
    chordProgression: generateChordProgressionTransform,
    drumPattern: generateDrumPatternTransform,
    melody: generateMelodyTransform,
};
