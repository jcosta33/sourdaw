import { secondsBetweenBeats, type TempoChange } from '../../models/TempoMap';

type Input = {
    changes: readonly TempoChange[];
    accumulatedPosition: number;
    trackStartBeat: number;
    defaultTempo: number;
    startTime: number;
    schedulingAnchor: number;
    compensation: number;
    now: number;
    elapsed: number;
    windowStartBeat: number | null;
    floorAnchorTime: number;
    initialFloor: boolean;
    duration: number;
};
/** Resolve held content and exhausted buffers before any graph allocation. */
export function projectFrozenTrackWindow({
    changes,
    accumulatedPosition,
    trackStartBeat,
    defaultTempo,
    startTime,
    schedulingAnchor,
    compensation,
    now,
    elapsed,
    windowStartBeat,
    floorAnchorTime,
    initialFloor,
    duration,
}: Input) {
    let floorSeconds = initialFloor ? Math.max(startTime, schedulingAnchor + compensation) : startTime;
    if (windowStartBeat !== null && windowStartBeat > trackStartBeat) {
        floorSeconds = Math.max(
            floorSeconds,
            floorAnchorTime +
                secondsBetweenBeats(changes, accumulatedPosition, windowStartBeat, defaultTempo) +
                compensation
        );
    }
    const audibleStartSeconds = Math.max(startTime, floorSeconds);
    const skipSeconds = audibleStartSeconds - startTime;

    const exhausted = (startTime < now && elapsed >= duration) || skipSeconds >= duration;
    return { audibleStartSeconds, skipSeconds, exhausted };
}
