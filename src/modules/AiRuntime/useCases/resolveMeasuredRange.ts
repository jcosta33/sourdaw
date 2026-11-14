import { readSecondsAtBeat } from '#/modules/Transport/stores';

import { type MeasurementFailure } from '../models/MeasurementBudget';
import { type ProjectContextSection } from '../models/ProjectContext';
import { readAgentResourceLimits } from '../stores/agentResourceLimitsStore';

import { type parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';
import { readMeasurementRenderedSeconds } from './readMeasurementRenderedSeconds';
import { resolveAnalysisMeasureBeats } from './resolveAnalysisMeasureBeats';

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];

/** A resolved measurement range: its beats, the seconds it measures and the seconds its render processes. */
export type MeasuredRange = {
    startBeat: number;
    endBeat: number;
    sectionId: string | null;
    measuredSeconds: number;
    renderedSeconds: number;
};

/** The beat range the arguments name, with the seconds it measures and the seconds its render processes. */
export function resolveMeasuredRange(
    range: ParsedArguments['range'],
    sections: readonly ProjectContextSection[]
): { status: 'range'; range: MeasuredRange } | { status: 'failure'; failure: MeasurementFailure } {
    const resolved = resolveAnalysisMeasureBeats(range, sections);
    if (resolved.status === 'failure') {
        return resolved;
    }
    const { startBeat, endBeat, sectionId } = resolved.beats;
    const { measurementMeasuredSeconds, measurementRenderedSeconds } = readAgentResourceLimits();
    const measuredSeconds = readSecondsAtBeat({ beat: endBeat }) - readSecondsAtBeat({ beat: startBeat });
    const renderedSeconds = readMeasurementRenderedSeconds(endBeat);
    if (measuredSeconds > measurementMeasuredSeconds || renderedSeconds > measurementRenderedSeconds) {
        return {
            status: 'failure',
            failure: {
                code: 'range-exceeds-ceiling',
                safeMessage: `A measurement covers at most ${String(measurementMeasuredSeconds)} s and ends within ${String(measurementRenderedSeconds)} s of the project start.`,
                retryable: true,
            },
        };
    }
    return { status: 'range', range: { startBeat, endBeat, sectionId, measuredSeconds, renderedSeconds } };
}
