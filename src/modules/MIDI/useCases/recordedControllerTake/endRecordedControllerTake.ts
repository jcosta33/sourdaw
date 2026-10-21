import { trackStore } from '#/modules/Arrangement/stores';

import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

import { writeRecordedControllerRows } from './writeRecordedControllerRows';

/**
 * Settle a take's buffers at the transport's recording falling edge.
 *
 * A clip the recorder opened is committed after the transport stops, and its
 * commit flushes its buffer, so that buffer stays until then — unless its clip
 * is gone, when the take was discarded and its rows are dropped unwritten. A
 * clip the recorder did not open (an overdub into an existing clip) has no
 * commit, so its rows land now.
 */
export function endRecordedControllerTake(): void {
    const { buffers, openedClipIds } = recordedControllerTakeState;
    const liveClipIds = new Set(trackStore.value?.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));

    for (const [clipId, buffer] of [...buffers]) {
        if (openedClipIds.has(clipId)) {
            if (!liveClipIds.has(clipId)) {
                buffers.delete(clipId);
            }
            continue;
        }
        buffers.delete(clipId);
        if (liveClipIds.has(clipId)) {
            writeRecordedControllerRows({ clipId, cc: buffer.cc, pitchBend: buffer.pitchBend });
        }
    }
}
