import {
    disposeExactAgentSectionRenderArtifact,
    getExactAgentSectionRenderArtifact,
} from '#/modules/AudioRendering/useCases';

import { readAgentRunState } from '../stores/agentRunStore';
import { selectRetainedSectionRenderManualReviews } from '../stores/selectRetainedSectionRenderManualReviews';

import { agentRunLifecycle } from './agentRunLifecycle';

type ReviewBinding = {
    runId: string;
    batchId: string;
    receiptIdentity: string;
    commandId: string;
    job: Parameters<typeof getExactAgentSectionRenderArtifact>[0]['job'];
    sourceRevision: string;
};

export function settleRetainedSectionRenderManualReview(
    input: ReviewBinding & { disposition: 'accepted' | 'discarded' | 'missing-evidence' }
): void {
    const current = selectRetainedSectionRenderManualReviews(readAgentRunState()).filter(
        (review) =>
            review.runId === input.runId &&
            review.batchId === input.batchId &&
            review.receiptIdentity === input.receiptIdentity &&
            review.commandId === input.commandId &&
            review.sourceRevision === input.sourceRevision &&
            review.job.jobId === input.job.jobId
    );
    if (current.length !== 1) {
        throw new Error('The exact retained render review is stale, ambiguous, or unavailable.');
    }
    const review = current[0]!;
    if (input.disposition === 'missing-evidence') {
        if (review.availability !== 'unavailable') {
            throw new Error(
                'Missing evidence cannot be acknowledged while the exact retained render remains available.'
            );
        }
    } else {
        if (
            review.availability !== 'available' ||
            !getExactAgentSectionRenderArtifact({ job: input.job, sourceRevision: input.sourceRevision })
        ) {
            throw new Error('The exact retained render is no longer available.');
        }
        if (
            input.disposition === 'discarded' &&
            !disposeExactAgentSectionRenderArtifact({ job: input.job, sourceRevision: input.sourceRevision })
        ) {
            throw new Error('The exact retained render could not be discarded.');
        }
    }
    agentRunLifecycle.settlePendingEffectManualReview({
        runId: input.runId,
        batchId: input.batchId,
        receiptIdentity: input.receiptIdentity,
        disposition: input.disposition,
    });
}
