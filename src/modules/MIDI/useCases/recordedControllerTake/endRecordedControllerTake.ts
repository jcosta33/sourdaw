import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

import { declareOverdubRegisteredState } from './declareOverdubRegisteredState';
import { findLiveClip } from './findLiveClip';
import { planRecordedControllers } from './planRecordedControllers';
import { readLiveClipIds } from './readLiveClipIds';
import { writeRecordedControllerRows } from './writeRecordedControllerRows';

/**
 * Settle a take's buffers at the transport's recording falling edge.
 *
 * A clip the recorder opened is committed after the transport stops, and its
 * commit flushes its buffer, so that buffer stays until then — unless its clip
 * is gone, when the take was discarded and its rows are dropped unwritten. A
 * carried-over clip's buffer also holds this take's rows after the earlier
 * take's, and they get their registered-parameter declarations now, ahead of
 * that commit (`declareOverdubRegisteredState`). A clip the recorder did not open
 * (an overdub into an existing clip) has no commit, so its rows land now, with
 * the same declarations against the clip's stored rows and a lift for each pedal
 * still down on the clip's closing line.
 */
export function endRecordedControllerTake(): void {
    const { buffers, openedClipIds, carriedOverClips, heldPedalSeeds, bendRangeSeeds } = recordedControllerTakeState;
    const liveClipIds = readLiveClipIds();

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
        if (clip) {
            declareOverdubRegisteredState(clipId);
        }
        const rows = clip ? planRecordedControllers({ clip }) : undefined;
        buffers.delete(clipId);
        if (rows) {
            writeRecordedControllerRows({ clipId, cc: rows.cc, pitchBend: rows.pitchBend });
        }
    }
    for (const seeds of [heldPedalSeeds, bendRangeSeeds]) {
        for (const clipId of [...seeds.keys()]) {
            if (!liveClipIds.has(clipId)) {
                seeds.delete(clipId);
            }
        }
    }
}
