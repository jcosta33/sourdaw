import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { agentSectionRenderArtifactStore } from '../stores/agentSectionRenderArtifactStore';

import { scheduleAgentSectionRenderArtifactExpiry } from './scheduleAgentSectionRenderArtifactExpiry';

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
): void {
    if (input.artifacts.length === 0) {
        return;
    }
    const current = agentSectionRenderArtifactStore.value?.artifacts ?? [];
    const missingJobIds = input.artifacts
        .filter((binding) => !current.some((artifact) => matchesBinding(artifact, binding)))
        .map(({ job }) => job.jobId);
    // A bound artifact that vanished before the rebind would silently leave the
    // committed revision without its render evidence, so this cannot degrade to
    // a no-op.
    if (missingJobIds.length > 0) {
        throw new Error(`Section render artifacts vanished before the revision rebind: ${missingJobIds.join(', ')}`);
    }
    agentSectionRenderArtifactStore.set({
        artifacts: current.map((artifact) =>
            input.artifacts.some((binding) => matchesBinding(artifact, binding))
                ? { ...artifact, sourceRevision: input.sourceRevision }
                : artifact
        ),
    });
    scheduleAgentSectionRenderArtifactExpiry();
}
