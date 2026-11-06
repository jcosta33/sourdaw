import { midiFragmentWindowEntry, shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';

import { type Clip } from '../../models/Track';

/**
 * The content fields of a Delete Time right fragment, which plays the source
 * from the span end with its head on the span start. A MIDI fragment takes the
 * MIDI fragment law (`midiFragmentWindowEntry`); the audio offset stays in
 * source coordinates advanced by the consumed span while the head rides the
 * compressing relocation by −duration, so the audio anchor rides that
 * relocation — composed, the consumed advance cancels the offset advance, the
 * region `audioOffsetBeats - (startBeat - loopOriginBeat)` stays the source's
 * own, and the entry lands at the cut phase. Unanchored sources keep the key
 * absent — the inverse plan's snapshot is compared structurally against the
 * normalized live state (#5198).
 */
export function deletedRightContentEntry(clip: Clip, operation: { startBeat: number; endBeat: number }) {
    if (clip.type === 'midi') {
        return midiFragmentWindowEntry(clip, operation.endBeat, operation.startBeat);
    }
    return { midiOffsetBeats: 0, ...shiftLoopOriginEntry(clip, operation.startBeat - operation.endBeat) };
}
