import { type AutomationPoint } from '../../models/AutomationViewTypes';

import { compileAutomationEvents } from './compileAutomationEvents';

type AutomationTempoChange = {
    beat: number;
    tempo: number;
};

export function scheduleAutomationOnParam(
    param: AudioParam,
    points: AutomationPoint[],
    durationSeconds: number,
    defaultTempo: number,
    changes: AutomationTempoChange[],
    regionStartSeconds = 0,
    projectBeatToSeconds?: (beat: number) => number,
    compensationDelaySec = 0
): void {
    const events = compileAutomationEvents(
        points,
        durationSeconds,
        defaultTempo,
        changes,
        regionStartSeconds,
        projectBeatToSeconds
    );
    if (events.length === 0) {
        return;
    }

    // Clip scheduling shifts audio by the track's latency compensation;
    // automation must shift identically or it lands offset against the
    // audio it shapes (M-038). The region-start seed is re-anchored at
    // time 0 so the param holds the correct value across the gap the
    // shift opens before the first compensated event.
    const seed = events[0]!;
    if (compensationDelaySec > 0 && seed.type === 'set' && seed.timeSeconds === 0) {
        param.setValueAtTime(seed.value, 0);
    }
    for (const event of events) {
        const timeSeconds = event.timeSeconds + compensationDelaySec;
        if (event.type === 'set') {
            param.setValueAtTime(event.value, timeSeconds);
        } else {
            param.linearRampToValueAtTime(event.value, timeSeconds);
        }
    }
}
