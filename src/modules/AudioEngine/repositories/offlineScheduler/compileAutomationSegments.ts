import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { type OfflineAutomationSegment } from '../deviceStrategy/AudioDeviceStrategy';

import { compileAutomationEvents, type CompileAutomationEventsOptions } from './compileAutomationEvents';
import { compiledEventsToSegments } from './compiledEventsToSegments';

type AutomationTempoChange = { beat: number; tempo: number };

export function compileAutomationSegments(
    points: AutomationPoint[],
    durationSeconds: number,
    changes: AutomationTempoChange[],
    sampleRate: number,
    regionStartSeconds: number,
    projectBeatToSeconds: (beat: number) => number,
    compensationDelaySec = 0,
    options?: CompileAutomationEventsOptions
): OfflineAutomationSegment[] {
    if (sampleRate <= 0) {
        return [];
    }
    const events = compileAutomationEvents(
        points,
        durationSeconds,
        changes,
        regionStartSeconds,
        projectBeatToSeconds,
        options
    );
    // An empty compile — a lane whose scope window misses the region —
    // converts to no segments (`compiledEventsToSegments` guards it).
    return compiledEventsToSegments(events, durationSeconds, sampleRate, compensationDelaySec);
}
