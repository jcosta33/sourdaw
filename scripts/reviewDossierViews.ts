/**
 * Derived views over a parsed review dossier (#2999, spec #2995 AC-009; #3375, spec #3367 AC-004).
 * Each view reads one event kind out of the chain; none re-validates — `parseReviewDossier` has
 * already proven the record these read.
 */

import type { CompletedReviewStance, ReviewDossier, ReviewDossierStance } from './reviewDossier.ts';

export function completedStances(dossier: ReviewDossier): CompletedReviewStance[] {
    return dossier.events
        .filter((event) => event.kind === 'stance-completed')
        .map((event) => ({
            stance: event.stance,
            reviewerModel: event.reviewerModel,
            modelTier: event.modelTier,
            outcome: event.outcome,
            exhaustion: event.exhaustion,
        }));
}

export function acceptedFindings(
    dossier: ReviewDossier
): { findingId: string; path: string; line: number; side: 'LEFT' | 'RIGHT' }[] {
    return dossier.events
        .filter((event) => event.kind === 'finding-accepted')
        .map((event) => ({ findingId: event.findingId, path: event.path, line: event.line, side: event.side }));
}

export function discardedDispositions(
    dossier: ReviewDossier
): { findingId: string; stance: ReviewDossierStance; reason: string }[] {
    return dossier.events
        .filter((event) => event.kind === 'finding-discarded')
        .map((event) => ({ findingId: event.findingId, stance: event.stance, reason: event.reason }));
}

/** The one publication the record binds, or undefined while none has been recorded. */
export function publishedReviewId(dossier: ReviewDossier): number | undefined {
    return dossier.events.find((event) => event.kind === 'review-published')?.reviewId;
}

/** The public comment id each accepted finding produced, bound to the recorded review. */
export function publishedFindings(
    dossier: ReviewDossier
): { findingId: string; reviewId: number; commentId: number }[] {
    return dossier.events
        .filter((event) => event.kind === 'finding-published')
        .map((event) => ({ findingId: event.findingId, reviewId: event.reviewId, commentId: event.commentId }));
}

export type RecordedDeliveryAuthorization = {
    reviewId: number;
    approvalReviewId: number;
    evidenceManifestDigest: string;
    unresolvedThreads: number;
    intent: 'deliver';
};

/** The one delivery authorization the record binds, or undefined while none has been recorded. */
export function deliveryAuthorization(dossier: ReviewDossier): RecordedDeliveryAuthorization | undefined {
    const event = dossier.events.find((entry) => entry.kind === 'delivery-authorized');
    if (!event) {
        return undefined;
    }
    return {
        reviewId: event.reviewId,
        approvalReviewId: event.approvalReviewId,
        evidenceManifestDigest: event.evidenceManifestDigest,
        unresolvedThreads: event.unresolvedThreads,
        intent: event.intent,
    };
}
