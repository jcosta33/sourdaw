import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { type OfflineAutomationSegment } from '../deviceStrategy/AudioDeviceStrategy';

import { compileAutomationEvents, type CompileAutomationEventsOptions } from './compileAutomationEvents';
import { compiledEventsToSegments } from './compiledEventsToSegments';

type AutomationTempoChange = { beat: number; tempo: number };

export function compileAutomationSegments(
    points: AutomationPoint[],
    durationSeconds: number,
    defaultTempo: number,
    changes: AutomationTempoChange[],
    sampleRate: number,
    regionStartSeconds = 0,
    projectBeatToSeconds?: (beat: number) => number,
    compensationDelaySec = 0,
    options?: CompileAutomationEventsOptions
): OfflineAutomationSegment[] {
    if (sampleRate <= 0) {
        return [];
    }
    const events = compileAutomationEvents(
        points,
        durationSeconds,
        defaultTempo,
        changes,
        regionStartSeconds,
        projectBeatToSeconds,
        options
    );
    if (events.length === 0) {
        return [];
    }
    return compiledEventsToSegments(events, durationSeconds, sampleRate, compensationDelaySec);
}
