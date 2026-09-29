import { type AutomationPoint } from '../../models/AutomationViewTypes';

import { compileAutomationEvents, type CompileAutomationEventsOptions } from './compileAutomationEvents';
import { scheduleCompiledEventsOnParam } from './scheduleCompiledEventsOnParam';

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
    compensationDelaySec = 0,
    options?: CompileAutomationEventsOptions
): void {
    const events = compileAutomationEvents(
        points,
        durationSeconds,
        defaultTempo,
        changes,
        regionStartSeconds,
        projectBeatToSeconds,
        options
    );
    scheduleCompiledEventsOnParam(param, events, compensationDelaySec);
}
