import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

import { declareOverdubRegisteredState } from './declareOverdubRegisteredState';
import { findLiveClip } from './findLiveClip';
import { type DetachedOverdubClip, landOverdubPass } from './landOverdubPass';
import { readLiveClipIds } from './readLiveClipIds';

/**
 * Settle a take's buffers at the transport's recording falling edge.
 *
 * A clip the recorder opened is committed after the transport stops, and its
 * commit flushes its buffer, so that buffer stays until then — unless its clip
 * is gone, when the take was discarded and its rows are dropped unwritten. A
 * carried-over clip's buffer also holds this take's rows after the earlier
 * take's, and they get their registered-parameter declarations now, ahead of
 * that commit (`declareOverdubRegisteredState`). A clip the recorder did not open
 * (an overdub into an existing clip) has no commit: its buffer comes off the take
 * state now, so the next take starts empty, and the pass lands as ONE undoable
 * action (`appendOverdubControllers`) once the returned promise settles
 * (`landOverdubPass`), with its declarations against the clip's rows by then and
 * a lift for each pedal still down on the clip's closing line. A pass with no
 * rows adds no history entry.
 */
export function endRecordedControllerTake(): Promise<void> {
    const { buffers, openedClipIds, carriedOverClips, heldPedalSeeds, bendRangeSeeds, pitchBendSeeds } =
        recordedControllerTakeState;
    const liveClipIds = readLiveClipIds();
    const pass: DetachedOverdubClip[] = [];

    for (const clipId of [...buffers.keys()]) {
        if (openedClipIds.has(clipId)) {
            if (!liveClipIds.has(clipId)) {
                buffers.delete(clipId);
            } else if (carriedOverClips.has(clipId)) {
                declareOverdubRegisteredState(clipId);
            }
            continue;
        }
        const clip = findLiveClip(clipId);
        const buffer = buffers.get(clipId);
        buffers.delete(clipId);
        if (clip && buffer) {
            pass.push({ clip, buffer });
        }
    }
    for (const seeds of [heldPedalSeeds, bendRangeSeeds, pitchBendSeeds]) {
        for (const clipId of [...seeds.keys()]) {
            if (!liveClipIds.has(clipId)) {
                seeds.delete(clipId);
            }
        }
    }
    return landOverdubPass(pass);
}
