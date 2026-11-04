import { secondsBetweenBeats, type TempoChange } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';

import { beatAtSecondsFromAnchor } from './beatAtSecondsFromAnchor';

export const SCHEDULE_AHEAD_SECONDS = 0.1;
export const INITIAL_HIGH_WATER_OFFSET_BEATS = 0.0001;

/** The same pass geometry plans initial readiness and every rolling seam. */
export function projectLoopSeamWindow(
    transport: TransportState,
    changes: readonly TempoChange[],
    previousPosition: number,
    position: number,
    lookAheadBeats: number,
    contextSeconds: number
) {
    const horizon = position + lookAheadBeats;
    if (!(
        transport.isLooping &&
        transport.loopEnd > transport.loopStart &&
        previousPosition < transport.loopEnd &&
        position < transport.loopEnd &&
        transport.loopEnd - transport.loopStart > lookAheadBeats &&
        horizon >= transport.loopEnd
    )) {
        return null;
    }
    const secondsToSeam = secondsBetweenBeats(changes, position, transport.loopEnd, transport.tempo);
    const seamAudioTime = contextSeconds + secondsToSeam;
    const wrappedPositionNow = beatAtSecondsFromAnchor(
        changes,
        transport.loopStart,
        contextSeconds - seamAudioTime,
        transport.tempo
    );
    const horizonAudioTime = contextSeconds + secondsBetweenBeats(changes, position, horizon, transport.tempo);
    const wrappedUpTo = Math.min(
        transport.loopEnd,
        beatAtSecondsFromAnchor(changes, transport.loopStart, horizonAudioTime - seamAudioTime, transport.tempo)
    );
    return { secondsToSeam, wrappedPositionNow, wrappedUpTo };
}
