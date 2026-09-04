import { MIDI_TRANSFORM_BEATS_PER_BAR, MIDI_TRANSFORM_CLIP_ARGUMENT } from '../models/MidiTransform';

/**
 * The compile-time facts a caller needs before it can expand a transform: which argument names the
 * clip the notes go into, and how many beats one bar of the contract is. A compiler that restated
 * either would drift out of agreement with the schemas the same contract publishes.
 */
export function getMidiTransformContract() {
    return { beatsPerBar: MIDI_TRANSFORM_BEATS_PER_BAR, clipArgument: MIDI_TRANSFORM_CLIP_ARGUMENT };
}
