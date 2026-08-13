import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { getAgentSectionRenderArtifacts } from '../useCases/getAgentSectionRenderArtifacts';
import { removeAgentProjectSectionArtifacts } from '../useCases/removeAgentProjectSectionArtifacts';

type RemoveRenderedProjectSectionsAction = Extract<AppAction, { type: 'removeRenderedProjectSections' }>;

function currentArtifactsMatch(action: RemoveRenderedProjectSectionsAction): boolean {
    const artifactsByJobId = new Map(getAgentSectionRenderArtifacts().map((artifact) => [artifact.jobId, artifact]));
    return action.payload.jobs.every((job, index) => {
        if (action.payload.sectionIds[index] !== job.sectionId) {
            return false;
        }
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

export const handleRemoveRenderedProjectSections = createHandler<'removeRenderedProjectSections'>({
    validate: currentArtifactsMatch,
    execute: (action) => {
        if (!currentArtifactsMatch(action)) {
            return { status: 'conflict' };
        }
        const remove = () => removeAgentProjectSectionArtifacts({ jobs: action.payload.jobs });
        return { status: 'written', afterCommit: remove, afterAmbiguousCommit: remove };
    },
    describe: (action) => ({
        label: `Remove session render artifacts ${action.payload.jobs.map((job) => job.jobId).join(', ')}`,
        inverseAction: currentArtifactsMatch(action)
            ? {
                  type: 'renderProjectSections',
                  payload: { sectionIds: [...action.payload.sectionIds], jobs: [...action.payload.jobs] },
              }
            : null,
    }),
    undoable: true,
    requiresAbortCompensation: false,
});
