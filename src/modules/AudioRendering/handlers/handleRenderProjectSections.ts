import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { getAgentSectionRenderArtifacts } from '../useCases/getAgentSectionRenderArtifacts';
import { renderAgentProjectSections } from '../useCases/renderAgentProjectSections';

type RenderProjectSectionsAction = Extract<AppAction, { type: 'renderProjectSections' }>;

function getJobs(action: RenderProjectSectionsAction): readonly RenderProjectSectionJobSnapshot[] | null {
    const jobs = action.payload.jobs;
    if (!jobs || jobs.length === 0 || jobs.length !== action.payload.sectionIds.length) {
        return null;
    }
    const jobIds = new Set<string>();
    return jobs.every((job, index) => {
        const valid =
            action.payload.sectionIds[index] === job.sectionId &&
            job.jobId.length > 0 &&
            !jobIds.has(job.jobId) &&
            Number.isFinite(job.startBeat) &&
            Number.isFinite(job.endBeat) &&
            job.endBeat > job.startBeat &&
            Number.isInteger(job.sampleRate) &&
            job.sampleRate >= 8_000 &&
            job.sampleRate <= 192_000 &&
            Number.isFinite(job.tailSeconds) &&
            job.tailSeconds >= 0;
        jobIds.add(job.jobId);
        return valid;
    })
        ? jobs
        : null;
}

function artifactsDoNotConflict(jobs: readonly RenderProjectSectionJobSnapshot[]): boolean {
    const artifactsByJobId = new Map(getAgentSectionRenderArtifacts().map((artifact) => [artifact.jobId, artifact]));
    return jobs.every((job) => {
        const artifact = artifactsByJobId.get(job.jobId);
        return (
            artifact === undefined ||
            (artifact.sectionId === job.sectionId &&
                artifact.sectionName === job.sectionName &&
                artifact.startBeat === job.startBeat &&
                artifact.endBeat === job.endBeat &&
                artifact.sampleRate === job.sampleRate &&
                artifact.tailSeconds === job.tailSeconds)
        );
    });
}

export const handleRenderProjectSections = createHandler<'renderProjectSections'>({
    canReapplyAfterDivergence: (action) => {
        const jobs = getJobs(action);
        return jobs !== null && artifactsDoNotConflict(jobs);
    },
    validate: (action) => {
        const jobs = getJobs(action);
        return jobs !== null && artifactsDoNotConflict(jobs);
    },
    execute: (action, context) => {
        const jobs = getJobs(action);
        if (!jobs || !artifactsDoNotConflict(jobs)) {
            return { status: 'conflict' };
        }
        let sourceRevision: string | null = null;
        const render = () => {
            sourceRevision ??= captureProjectRevision();
            return renderAgentProjectSections({ jobs, sourceRevision, signal: context?.signal });
        };
        return { status: 'written', afterCommit: render, afterAmbiguousCommit: render };
    },
    describe: (action) => {
        const jobs = getJobs(action);
        const label = jobs
            ? `Render ${jobs.map((job) => `"${job.sectionName}" (${job.sectionId}) as ${job.jobId}`).join(', ')} into session-owned artifacts`
            : 'Render project sections into session-owned artifacts';
        return {
            label,
            inverseAction:
                jobs && artifactsDoNotConflict(jobs)
                    ? {
                          type: 'removeRenderedProjectSections',
                          payload: { sectionIds: [...action.payload.sectionIds], jobs: [...jobs] },
                      }
                    : null,
        };
    },
    undoable: true,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
});
