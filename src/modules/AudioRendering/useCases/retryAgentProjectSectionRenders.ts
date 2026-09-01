import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { renderAgentProjectSections } from './renderAgentProjectSections';

type RetryAgentProjectSectionRendersInput = {
    approvedJobs: readonly RenderProjectSectionJobSnapshot[];
    jobs: readonly RenderProjectSectionJobSnapshot[];
    sourceRevision: string;
    validateArtifactAttachment?: () => string | null;
    onRenderAttempt?: (job: RenderProjectSectionJobSnapshot) => void;
};

export async function retryAgentProjectSectionRenders(input: RetryAgentProjectSectionRendersInput): Promise<void> {
    if (input.jobs.length === 0) {
        return;
    }
    await renderAgentProjectSections({
        jobs: input.jobs,
        retentionProtectedJobIds: input.approvedJobs.map((job) => job.jobId),
        replaceMismatchedRevisionArtifacts: true,
        sourceRevision: input.sourceRevision,
        validateArtifactAttachment: input.validateArtifactAttachment,
        onRenderAttempt: input.onRenderAttempt,
    });
}
