import { transportStore } from '#/modules/Transport/stores';

import { activeRecordingRef } from '../../stores/activeRecordingRef';

import { recordingPassIndex } from './recordingPassIndex';

type EventPosition = { beat: number; passIndex: number };

/**
 * One admitted event's unwrapped position in the clip opened by this recording.
 * Later passes read the live loop, the basis each pass's take offset is staged
 * on, so an event and the take of its pass agree after the loop is edited.
 */
export function sourceBeat(clipStartBeat: number, position: EventPosition): number | null {
    const pass = recordingPassIndex(position);
    if (!Number.isFinite(position.beat) || pass === null) {
        return null;
    }
    if (pass === 0) {
        return Math.max(0, position.beat - clipStartBeat);
    }
    const loop = transportStore.value;
    if (!activeRecordingRef.startedLooping || !loop || loop.loopEnd <= loop.loopStart) {
        return null;
    }
    return (
        Math.max(0, loop.loopEnd - clipStartBeat) +
        (pass - 1) * (loop.loopEnd - loop.loopStart) +
        Math.max(0, position.beat - loop.loopStart)
    );
}
