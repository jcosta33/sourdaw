import { type AppAction } from '#/utils/handlerContract';

/** The section renders in words, or `null` until their jobs are materialized. */
export function describeExactSectionRender(
    action: Extract<AppAction, { type: 'renderProjectSections' }>
): string | null {
    if (!action.payload.jobs) {
        return null;
    }
    const jobs = action.payload.jobs
        .map(
            (job) =>
                `"${job.sectionName}" (${job.sectionId}) beats ${String(job.startBeat)}–${String(job.endBeat)} as ${job.jobId} at ${String(job.sampleRate)} Hz with ${String(job.tailSeconds)} s tail`
        )
        .join(', ');
    return `Render ${jobs} into session-owned artifacts; undo removes them and redo renders fresh artifacts`;
}
