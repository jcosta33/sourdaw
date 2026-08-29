import { disposeExactAgentSectionRenderArtifact } from '#/modules/AudioRendering/useCases';

import { readAgentRunState } from '../stores/agentRunStore';
import { selectRetainedSectionRenderManualReviews } from '../stores/selectRetainedSectionRenderManualReviews';

import { agentRunLifecycle } from './agentRunLifecycle';

type ReviewBinding = {
    runId: string;
    batchId: string;
    receiptIdentity: string;
    commandId: string;
    job: {
        jobId: string;
        sectionId: string;
        sectionName: string;
        startBeat: number;
        endBeat: number;
        sampleRate: number;
        tailSeconds: number;
    };
    sourceRevision: string;
};

export function settleRetainedSectionRenderManualReview(
    input: ReviewBinding & { disposition: 'accepted' | 'discarded' | 'missing-evidence' }
): void {
    const reviews = selectRetainedSectionRenderManualReviews(readAgentRunState());
    const current = reviews.filter(
        (review) =>
            review.runId === input.runId &&
            review.batchId === input.batchId &&
            review.receiptIdentity === input.receiptIdentity &&
            review.commandId === input.commandId &&
            review.sourceRevision === input.sourceRevision &&
            review.job.jobId === input.job.jobId &&
            review.job.sectionId === input.job.sectionId &&
            review.job.sectionName === input.job.sectionName &&
            review.job.startBeat === input.job.startBeat &&
            review.job.endBeat === input.job.endBeat &&
            review.job.sampleRate === input.job.sampleRate &&
            review.job.tailSeconds === input.job.tailSeconds
    );
    if (current.length !== 1) {
        throw new Error('The exact retained render review is stale, ambiguous, or unavailable.');
    }
    const aggregate = reviews.filter(
        (candidate) =>
            candidate.runId === input.runId &&
            candidate.batchId === input.batchId &&
            candidate.receiptIdentity === input.receiptIdentity &&
            candidate.sourceRevision === input.sourceRevision
    );
    if (aggregate.length === 0) {
        throw new Error('The retained render review aggregate is stale.');
    }
    if (input.disposition === 'missing-evidence') {
        if (!aggregate.some((candidate) => candidate.availability === 'unavailable')) {
            throw new Error(
                'Missing evidence cannot be acknowledged while the exact retained render remains available.'
            );
        }
    } else {
        if (aggregate.some((candidate) => candidate.availability !== 'available')) {
            throw new Error('The exact retained render is no longer available.');
        }
    }
    agentRunLifecycle.settlePendingEffectManualReview({
        runId: input.runId,
        batchId: input.batchId,
        receiptIdentity: input.receiptIdentity,
        disposition: input.disposition,
    });
    if (input.disposition === 'discarded') {
        const undisposed = aggregate.filter(
            (candidate) =>
                !disposeExactAgentSectionRenderArtifact({
                    job: candidate.job,
                    sourceRevision: candidate.sourceRevision,
                })
        );
        if (undisposed.length > 0) {
            throw new Error('Review was settled, but one or more retained artifacts could not be discarded.');
        }
    }
}
