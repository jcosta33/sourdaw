import { type AgentMeasurementWindow } from './cutAgentMeasurementWindow';

/** The range every window falls inside: what one render must cover to hold them all. */
export function readAgentMeasurementSpan(windows: readonly AgentMeasurementWindow[]): AgentMeasurementWindow {
    return {
        startBeat: Math.min(...windows.map((window) => window.startBeat)),
        endBeat: Math.max(...windows.map((window) => window.endBeat)),
    };
}
