import { secondsBetweenBeats, type TempoChange } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';

import { beatAtSecondsFromAnchor } from './beatAtSecondsFromAnchor';

type ProjectionInput = {
    transport: TransportState;
    changes: readonly TempoChange[];
    anchorBeat: number;
    anchorTime: number;
    fromTime: number;
    toTime: number;
    maxWindows: number;
};

type AudioWindow = {
    passIndex: number;
    anchorBeat: number;
    anchorTime: number;
    fromBeat: number;
    toBeat: number;
    fromTime: number;
    toTime: number;
    passEndTime: number;
};

/** Project at most the admitted work allowance, never allocate the requested H/L passes. */
export function projectLoopAudioWindows(input: ProjectionInput) {
    const { transport, changes, anchorBeat, anchorTime, fromTime, toTime, maxWindows } = input;
    const windows: AudioWindow[] = [];
    const refused = () => ({ windows, coveredThrough: fromTime, shortfall: 'unrepresentable' as const });
    const duration = secondsBetweenBeats(changes, transport.loopStart, transport.loopEnd, transport.tempo);
    const firstEnd = anchorTime + secondsBetweenBeats(changes, anchorBeat, transport.loopEnd, transport.tempo);
    if (
        ![duration, firstEnd, anchorTime, fromTime, toTime].every(Number.isFinite) ||
        duration <= 0 ||
        firstEnd <= anchorTime ||
        toTime < fromTime ||
        !Number.isSafeInteger(maxWindows) ||
        maxWindows <= 0
    ) {
        return refused();
    }
    let passIndex = fromTime < firstEnd ? 0 : Math.floor((fromTime - firstEnd) / duration) + 1;
    if (!Number.isSafeInteger(passIndex) || passIndex < 0) return refused();
    // Division can round an exact boundary just below its integer. Compare
    // the projected endpoints once; never enumerate the crossed passes.
    if (firstEnd + passIndex * duration <= fromTime) passIndex++;
    if (passIndex > 0 && firstEnd + (passIndex - 1) * duration > fromTime) passIndex--;
    if (!Number.isSafeInteger(passIndex)) return refused();
    let cursor = fromTime;
    while (cursor < toTime && windows.length < maxWindows) {
        const passAnchorTime = passIndex === 0 ? anchorTime : firstEnd + (passIndex - 1) * duration;
        const passEndTime = firstEnd + passIndex * duration;
        if (!Number.isFinite(passEndTime) || passEndTime <= passAnchorTime || passEndTime <= cursor) {
            return { windows, coveredThrough: cursor, shortfall: 'unrepresentable' as const };
        }
        const passAnchorBeat = passIndex === 0 ? anchorBeat : transport.loopStart;
        const end = Math.min(toTime, passEndTime);
        windows.push({
            passIndex,
            anchorBeat: passAnchorBeat,
            anchorTime: passAnchorTime,
            fromBeat:
                cursor === passAnchorTime
                    ? passAnchorBeat
                    : beatAtSecondsFromAnchor(changes, passAnchorBeat, cursor - passAnchorTime, transport.tempo),
            toBeat:
                end === passEndTime
                    ? transport.loopEnd
                    : beatAtSecondsFromAnchor(changes, passAnchorBeat, end - passAnchorTime, transport.tempo),
            fromTime: cursor,
            toTime: end,
            passEndTime,
        });
        cursor = end;
        passIndex++;
        if (!Number.isSafeInteger(passIndex))
            return { windows, coveredThrough: cursor, shortfall: 'unrepresentable' as const };
    }
    return { windows, coveredThrough: cursor, shortfall: cursor < toTime ? ('pass-budget' as const) : null };
}
