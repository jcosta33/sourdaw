import { describe, expect, it, vi } from 'vitest';

import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { retryAgentProjectSectionRenders } from '../retryAgentProjectSectionRenders';

const mocks = vi.hoisted(() => ({ renderSections: vi.fn() }));

vi.mock('../renderAgentProjectSections', () => ({ renderAgentProjectSections: mocks.renderSections }));

function createJob(jobId: string): RenderProjectSectionJobSnapshot {
    return {
        jobId,
        sectionId: `section-${jobId}`,
        sectionName: jobId,
        startBeat: 0,
        endBeat: 16,
        sampleRate: 44_100,
        tailSeconds: 0,
    };
}

describe('retryAgentProjectSectionRenders', () => {
    it('preserves retained approved jobs while retrying only the missing job set', async () => {
        const retainedJob = createJob('render-retained');
        const missingJob = createJob('render-missing');
        const validateArtifactAttachment = vi.fn(() => null);
        const onRenderAttempt = vi.fn();
        mocks.renderSections.mockResolvedValue(undefined);

        await retryAgentProjectSectionRenders({
            approvedJobs: [retainedJob, missingJob],
            jobs: [missingJob],
            sourceRevision: 'revision-render',
            validateArtifactAttachment,
            onRenderAttempt,
        });

        expect(mocks.renderSections).toHaveBeenCalledExactlyOnceWith({
            jobs: [missingJob],
            retentionProtectedJobIds: [retainedJob.jobId, missingJob.jobId],
            sourceRevision: 'revision-render',
            validateArtifactAttachment,
            onRenderAttempt,
        });
    });
});
