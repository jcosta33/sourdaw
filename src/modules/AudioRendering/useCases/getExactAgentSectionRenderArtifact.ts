import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { getAgentSectionRenderArtifacts } from './getAgentSectionRenderArtifacts';

type ExactArtifactBinding = { job: RenderProjectSectionJobSnapshot; sourceRevision: string };

function matches(
    binding: ExactArtifactBinding,
    artifact: ReturnType<typeof getAgentSectionRenderArtifacts>[number]
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
        artifact.sourceRevision === binding.sourceRevision
    );
}

/** Returns one live retained artifact only when every immutable job field still agrees. */
export function getExactAgentSectionRenderArtifact(binding: ExactArtifactBinding) {
    const matchesForBinding = getAgentSectionRenderArtifacts().filter((artifact) => matches(binding, artifact));
    return matchesForBinding.length === 1 ? matchesForBinding[0]! : null;
}
