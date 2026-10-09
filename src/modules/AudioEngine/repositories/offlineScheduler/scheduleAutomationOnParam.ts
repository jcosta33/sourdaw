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
    changes: AutomationTempoChange[],
    regionStartSeconds: number,
    projectBeatToSeconds: (beat: number) => number,
    compensationDelaySec = 0,
    options?: CompileAutomationEventsOptions
): void {
    const events = compileAutomationEvents(
        points,
        durationSeconds,
        changes,
        regionStartSeconds,
        projectBeatToSeconds,
        options
    );
    scheduleCompiledEventsOnParam(param, events, compensationDelaySec);
}
