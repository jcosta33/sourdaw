import { transposeForChordTrack as transposeForChordTrackTransformer } from '../transformers/chordTransposer';
import { type ChordEvent } from '../models/ChordEvent';

export function transposeForChordTrack(
    pitch: number,
    referenceChord: ChordEvent | null,
    targetChord: ChordEvent | null
): number {
    return transposeForChordTrackTransformer(pitch, referenceChord, targetChord);
}
