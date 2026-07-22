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
    regionStartSeconds = 0
): void {
    const events = compileAutomationEvents(points, durationSeconds, defaultTempo, changes, regionStartSeconds);
    for (const event of events) {
        if (event.type === 'set') {
            param.setValueAtTime(event.value, event.timeSeconds);
        } else {
            param.linearRampToValueAtTime(event.value, event.timeSeconds);
        }
    }
}
