import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

type ArtifactRevisionBinding = {
    job: RenderProjectSectionJobSnapshot;
    renderedAt: number;
    sourceRevision: string;
};

type RebindAgentProjectSectionArtifactRevisionsInput = {
    artifacts: readonly ArtifactRevisionBinding[];
    sourceRevision: string;
};

function matchesBinding(
    artifact: NonNullable<typeof agentSectionRenderArtifactStore.value>['artifacts'][number],
    binding: ArtifactRevisionBinding
): boolean {
    const { job } = binding;
    return (
        artifact.jobId === job.jobId &&
        artifact.sectionId === job.sectionId &&
        artifact.sectionName === job.sectionName &&
        artifact.startBeat === job.startBeat &&
        artifact.endBeat === job.endBeat &&
        artifact.sampleRate === job.sampleRate &&
        artifact.tailSeconds === job.tailSeconds &&
        artifact.renderedAt === binding.renderedAt &&
        artifact.sourceRevision === binding.sourceRevision
    );
}

export function rebindAgentProjectSectionArtifactRevisions(
    input: RebindAgentProjectSectionArtifactRevisionsInput
): boolean {
    if (input.artifacts.length === 0) {
        return true;
    }
    const current = agentSectionRenderArtifactStore.value?.artifacts ?? [];
    if (!input.artifacts.every((binding) => current.some((artifact) => matchesBinding(artifact, binding)))) {
        return false;
    }
    agentSectionRenderArtifactStore.set({
        artifacts: current.map((artifact) =>
            input.artifacts.some((binding) => matchesBinding(artifact, binding))
                ? { ...artifact, sourceRevision: input.sourceRevision }
                : artifact
        ),
    });
    return true;
}
