/**
 * The review dossier's publication-binding validation (#3375, spec #3367 AC-004), split out of
 * `reviewDossier.ts` so that module stays under its `max-lines` ceiling. This owns the structural
 * rules over the publication-binding events — at most one recorded publication, any finding bound
 * at most once, and every published finding naming an accepted one and the one recorded publication.
 */

import { fail } from './prContract.ts';

import type { ReviewDossierEvent } from './reviewDossier.ts';

export type PublicationBindings = {
    reviewId: number | undefined;
    findings: Map<string, Extract<ReviewDossierEvent, { kind: 'finding-published' }>>;
    authorization: Extract<ReviewDossierEvent, { kind: 'delivery-authorized' }> | undefined;
    reassessment: Extract<ReviewDossierEvent, { kind: 'review-reassessed' }> | undefined;
};

/**
 * Collects the publication-binding events, refusing the structural violations on sight: at most
 * one recorded publication, and any finding bound at most once. Binding-to-disposition rules run
 * in `assertPublicationBindings` after the disposition sets are complete, so the record's own
 * event order — bindings always append after the dispositions — is not part of the rule.
 */
export function collectPublicationBindings(events: readonly ReviewDossierEvent[]): PublicationBindings {
    const bindings: PublicationBindings = {
        reviewId: undefined,
        findings: new Map(),
        authorization: undefined,
        reassessment: undefined,
    };
    for (const event of events) {
        if (event.kind === 'review-published') {
            if (bindings.reviewId !== undefined) {
                fail(`review dossier records more than one publication: ${bindings.reviewId} and ${event.reviewId}`);
            }
            bindings.reviewId = event.reviewId;
        }
        if (event.kind === 'finding-published') {
            if (bindings.findings.has(event.findingId)) {
                fail(`review dossier publishes finding ${event.findingId} more than once`);
            }
            bindings.findings.set(event.findingId, event);
        }
        if (event.kind === 'delivery-authorized') {
            if (bindings.authorization !== undefined) {
                fail(
                    `review dossier records more than one delivery authorization: ${bindings.authorization.reviewId} and ${event.reviewId}`
                );
            }
            if (bindings.reviewId === undefined) {
                fail(`review dossier records delivery authorization ${event.reviewId} without a recorded publication`);
            }
            if (event.approvalReviewId !== bindings.reviewId) {
                fail(
                    `review dossier delivery authorization ${event.reviewId} binds approval ${event.approvalReviewId}, not the recorded publication ${bindings.reviewId}`
                );
            }
            bindings.authorization = event;
        }
        if (event.kind === 'review-reassessed') {
            if (bindings.reassessment !== undefined) {
                fail(`review dossier records more than one round reassessment`);
            }
            bindings.reassessment = event;
        }
    }
    return bindings;
}

/** Every published finding binds an accepted one, and names the one recorded publication. */
export function assertPublicationBindings(bindings: PublicationBindings, accepted: ReadonlySet<string>): void {
    for (const event of bindings.findings.values()) {
        if (!accepted.has(event.findingId)) {
            fail(`review dossier publishes finding ${event.findingId}, which no accepted finding carries`);
        }
        if (bindings.reviewId === undefined) {
            fail(`review dossier publishes finding ${event.findingId} without recording the publication's review id`);
        }
        if (event.reviewId !== bindings.reviewId) {
            fail(
                `review dossier finding ${event.findingId} binds review ${event.reviewId}, not the recorded publication ${bindings.reviewId}`
            );
        }
    }
}
