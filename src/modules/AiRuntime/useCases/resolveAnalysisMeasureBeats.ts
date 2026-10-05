import { type ProjectContextSection } from '../models/ProjectContext';

type MeasureRangeArgument = { sectionId: string } | { startBeat: number; endBeat: number };

type MeasureBeats = { startBeat: number; endBeat: number; sectionId: string | null };

type MeasureFailure = { code: string; safeMessage: string; retryable: boolean };

/** The beat range an `analysis.measure` range names, read from the loop's sections, or why it names none. */
export function resolveAnalysisMeasureBeats(
    range: MeasureRangeArgument,
    sections: readonly ProjectContextSection[]
): { status: 'range'; beats: MeasureBeats } | { status: 'failure'; failure: MeasureFailure } {
    let beats: MeasureBeats;
    if ('sectionId' in range) {
        const section = sections.find((candidate) => candidate.id === range.sectionId);
        if (section === undefined) {
            return {
                status: 'failure',
                failure: {
                    code: 'unknown-section',
                    safeMessage: `Section ${range.sectionId} is not in the project.`,
                    retryable: true,
                },
            };
        }
        beats = { startBeat: section.startBeat, endBeat: section.endBeat, sectionId: section.id };
    } else {
        beats = { startBeat: range.startBeat, endBeat: range.endBeat, sectionId: null };
    }
    if (beats.startBeat >= beats.endBeat) {
        return {
            status: 'failure',
            failure: { code: 'invalid-range', safeMessage: 'The range must start before it ends.', retryable: true },
        };
    }
    return { status: 'range', beats };
}
