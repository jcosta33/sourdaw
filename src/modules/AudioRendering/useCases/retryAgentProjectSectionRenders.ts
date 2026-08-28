import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { renderAgentProjectSections } from './renderAgentProjectSections';

type RetryAgentProjectSectionRendersInput = {
    approvedJobs: readonly RenderProjectSectionJobSnapshot[];
    jobs: readonly RenderProjectSectionJobSnapshot[];
    sourceRevision: string;
};

export async function retryAgentProjectSectionRenders(input: RetryAgentProjectSectionRendersInput): Promise<void> {
    if (input.jobs.length === 0) {
        return;
    }
    await renderAgentProjectSections({ jobs: input.approvedJobs, sourceRevision: input.sourceRevision });
}
