import { disposeExactAgentSectionRenderArtifact } from '#/modules/AudioRendering/useCases';

import { readAgentRunState } from '../stores/agentRunStore';

import { agentRunLifecycle } from './agentRunLifecycle';
import { selectRetainedSectionRenderManualReviews } from './selectRetainedSectionRenderManualReviews';

type Review = ReturnType<typeof selectRetainedSectionRenderManualReviews>[number];
type ReviewBinding = Review['binding'];

function hasSameJob(left: ReviewBinding['commands'][number]['jobs'][number], right: typeof left): boolean {
    return (
        left.jobId === right.jobId &&
        left.sectionId === right.sectionId &&
        left.sectionName === right.sectionName &&
        left.startBeat === right.startBeat &&
        left.endBeat === right.endBeat &&
        left.sampleRate === right.sampleRate &&
        left.tailSeconds === right.tailSeconds
    );
}

function hasSameBinding(left: ReviewBinding, right: ReviewBinding): boolean {
    return (
        left.runId === right.runId &&
        left.batchId === right.batchId &&
        left.receiptIdentity === right.receiptIdentity &&
        left.sourceRevision === right.sourceRevision &&
        left.commands.length === right.commands.length &&
        left.commands.every((command, commandIndex) => {
            const candidate = right.commands[commandIndex];
            return (
                candidate !== undefined &&
                command.commandId === candidate.commandId &&
                command.jobs.length === candidate.jobs.length &&
                command.jobs.every((job, jobIndex) => {
                    const candidateJob = candidate.jobs[jobIndex];
                    return candidateJob !== undefined && hasSameJob(job, candidateJob);
                })
            );
        })
    );
}

export function settleRetainedSectionRenderManualReview(input: {
    binding: ReviewBinding;
    disposition: 'accepted' | 'discarded' | 'missing-evidence';
}): void {
    const reviews = selectRetainedSectionRenderManualReviews(readAgentRunState());
    const matchingReviews = reviews.filter((review) => hasSameBinding(review.binding, input.binding));
    if (matchingReviews.length !== 1) {
        throw new Error('The exact retained render review is stale, ambiguous, or unavailable.');
    }
    const current = matchingReviews[0]!;
    if (input.disposition === 'missing-evidence') {
        if (!current.jobs.some((candidate) => candidate.availability === 'unavailable')) {
            throw new Error(
                'Missing evidence cannot be acknowledged while the exact retained render remains available.'
            );
        }
    } else {
        if (current.jobs.some((candidate) => candidate.availability !== 'available')) {
            throw new Error('The exact retained render is no longer available.');
        }
    }
    agentRunLifecycle.settlePendingEffectManualReview({
        runId: input.binding.runId,
        batchId: input.binding.batchId,
        receiptIdentity: input.binding.receiptIdentity,
        sourceRevision: input.binding.sourceRevision,
        disposition: input.disposition,
    });
    if (input.disposition === 'discarded') {
        const undisposed = current.jobs.filter(
            (candidate) =>
                !disposeExactAgentSectionRenderArtifact({
                    job: candidate.job,
                    sourceRevision: input.binding.sourceRevision,
                })
        );
        if (undisposed.length > 0) {
            throw new Error('Review was settled, but one or more retained artifacts could not be discarded.');
        }
    }
}
