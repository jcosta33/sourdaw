import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { renderAgentProjectSections } from './renderAgentProjectSections';

type RetryAgentProjectSectionRendersInput = {
    jobs: readonly RenderProjectSectionJobSnapshot[];
    sourceRevision: string;
};

export async function retryAgentProjectSectionRenders(input: RetryAgentProjectSectionRendersInput): Promise<void> {
    if (input.jobs.length === 0) {
        return;
    }
    await renderAgentProjectSections(input);
}
