import {
    REVIEWER_BOT_NODE_ID,
    ORCHESTRATOR_USER_NODE_ID,
    assertRequiredRepository,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import { shellPort, type PublishReviewPort, type ReviewDocument } from './publishReview.ts';
import {
    currentMutationOwnerFence,
    isReviewPublicationPullRequestMutationLockOwner,
    readPullRequestMutationLockOwner,
    readPullRequestMutationLockReceipt,
    withPullRequestReviewPublicationMutationLock,
} from './pullRequestMutationLock.ts';
import { recordRecoveredPublicationBindings } from './reviewPublicationBinding.ts';
import { hasExactRecoveryReceipt, type RecoveryReceipt } from './reviewPublicationRecoveryReceipt.ts';
import { exactPublishedReview, type RecoveryInspection } from './reviewPublicationRemoteInspection.ts';

import type { AttestedRecoveryOwner, RecoverPublishReviewDependencies } from './recoverPublishReviewLock.ts';

type AdoptionChecks = {
    attestOwner: (
        primaryRoot: string,
        number: number,
        ownerOid: string,
        attestAbsent: boolean,
        dependencies: RecoverPublishReviewDependencies
    ) => AttestedRecoveryOwner;
    readDocument: (primaryRoot: string, number: number, attestation: AttestedRecoveryOwner) => ReviewDocument;
    requireDigest: (number: number, attestation: AttestedRecoveryOwner, document: ReviewDocument) => string;
};

function requireReviewOwner(primaryRoot: string, number: number, oid: string) {
    const owner = readPullRequestMutationLockOwner(primaryRoot, oid, number);
    if (!isReviewPublicationPullRequestMutationLockOwner(owner)) {
        fail(`PR #${number} recovery requires a review-publication lock owner`);
    }
    return owner;
}

/** Adopt only a retained landed publication after a new native CAS lock and two live exact reads. */
export async function adoptLandedRecoveryReceipt(
    primaryRoot: string,
    number: number,
    ownerOid: string,
    receipt: RecoveryReceipt,
    dependencies: RecoverPublishReviewDependencies,
    checks: AdoptionChecks
): Promise<number> {
    const originalOwner = requireReviewOwner(primaryRoot, number, ownerOid);
    return withPullRequestReviewPublicationMutationLock(
        primaryRoot,
        number,
        async () => {
            if (!hasExactRecoveryReceipt(readPullRequestMutationLockReceipt(primaryRoot, number, ownerOid), receipt)) {
                fail('review-publication recovery receipt changed during adoption');
            }
            const attestation = checks.attestOwner(primaryRoot, number, ownerOid, false, dependencies);
            if (receipt.head !== attestation.expectedHead || receipt.payloadDigest !== originalOwner.payloadDigest) {
                fail('review-publication recovery receipt does not attest the original owner, head, and payload');
            }
            const adoptedOwner = requireReviewOwner(primaryRoot, number, receipt.adoptedOwnerOid);
            if (
                adoptedOwner.expectedHead !== attestation.expectedHead ||
                adoptedOwner.payloadDigest !== receipt.payloadDigest ||
                adoptedOwner.reviewerActorNodeId !== attestation.expectedActorNodeId
            ) {
                fail('review-publication recovery receipt does not attest the exact adopted owner, head, and payload');
            }
            if (attestation.expectedActorNodeId !== REVIEWER_BOT_NODE_ID) {
                fail('landed receipt adoption requires the reviewer publication actor');
            }
            const auth = await dependencies.authenticateReviewer(primaryRoot);
            try {
                if (auth.minted.actorNodeId !== attestation.expectedActorNodeId) {
                    fail(
                        'review-publication recovery retained reviewer actor does not match the authenticated reviewer'
                    );
                }
                assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
                const document = checks.readDocument(primaryRoot, number, attestation);
                checks.requireDigest(number, attestation, document);
                const second = inspectLandedReceipt(
                    number,
                    primaryRoot,
                    attestation,
                    document,
                    auth.session,
                    dependencies
                );
                recordRecoveredPublicationBindings(
                    {
                        number,
                        head: attestation.expectedHead,
                        liveHead: second.head,
                        state: second.state,
                        reviewId: second.reviews[0]!.id,
                        actorNodeId: attestation.expectedActorNodeId,
                    },
                    document,
                    (dependencies.publicationPort ?? recoveryPublicationPort)(auth.session, primaryRoot)
                );
                console.log(`review-publication-lock-already-recovered:${number}:${ownerOid}`);
                return 0;
            } finally {
                auth.session.dispose();
            }
        },
        {
            reviewPublication: {
                expectedHead: originalOwner.expectedHead,
                payloadDigest: originalOwner.payloadDigest,
                reviewerActorNodeId: originalOwner.reviewerActorNodeId,
                ownerFence: dependencies.currentOwnerFence ?? currentMutationOwnerFence,
            },
        }
    );
}

function inspectLandedReceipt(
    number: number,
    primaryRoot: string,
    attestation: AttestedRecoveryOwner,
    document: ReviewDocument,
    session: GhSession,
    dependencies: RecoverPublishReviewDependencies
): RecoveryInspection {
    const inspect = () =>
        dependencies.inspect(number, attestation.expectedActorNodeId, attestation.expectedHead, session, primaryRoot);
    const first = inspect();
    assertNoUnauthorizedLandedEvidence(first, document, attestation.expectedHead, attestation.expectedActorNodeId);
    assertSingleExactLandedReview(first, document, attestation.expectedHead, attestation.expectedActorNodeId);
    const second = inspect();
    assertNoUnauthorizedLandedEvidence(second, document, attestation.expectedHead, attestation.expectedActorNodeId);
    assertReconciliationStable(first, second, document, attestation.expectedHead, attestation.expectedActorNodeId);
    if (second.reviews.length !== 1) {
        fail('review-publication recovery receipt attests landed but no exact review stands live');
    }
    return second;
}

export function recoveryPublicationPort(session: GhSession, primaryRoot: string): PublishReviewPort {
    return { ...shellPort(session, primaryRoot), primaryRoot: () => primaryRoot };
}

function sanctionedOtherPublicationActorNodeId(expectedActorNodeId: string): string {
    if (expectedActorNodeId === ORCHESTRATOR_USER_NODE_ID) {
        return REVIEWER_BOT_NODE_ID;
    }
    if (expectedActorNodeId !== REVIEWER_BOT_NODE_ID) {
        fail(`review-publication recovery attested an unexpected actor: ${expectedActorNodeId}`);
    }
    return ORCHESTRATOR_USER_NODE_ID;
}

export function assertNoUnauthorizedLandedEvidence(
    inspection: RecoveryInspection,
    document: ReviewDocument,
    expectedHead: string,
    expectedActorNodeId: string
): void {
    const sanctionedOtherActorNodeId = sanctionedOtherPublicationActorNodeId(expectedActorNodeId);
    if (
        (inspection.otherActorReviews ?? []).some(
            (review) =>
                review.actorNodeId !== sanctionedOtherActorNodeId &&
                exactPublishedReview(review, document, expectedHead, review.actorNodeId)
        )
    ) {
        fail('review-publication recovery found unauthorized landed review evidence');
    }
}

export function assertSingleExactLandedReview(
    inspection: RecoveryInspection,
    document: ReviewDocument,
    expectedHead: string,
    expectedActorNodeId: string
): void {
    if (
        inspection.reviews.length > 1 ||
        (inspection.reviews.length === 1 &&
            !exactPublishedReview(inspection.reviews[0]!, document, expectedHead, expectedActorNodeId))
    ) {
        fail('review-publication recovery found ambiguous or non-exact remote review evidence');
    }
}

export function assertReconciliationStable(
    first: RecoveryInspection,
    second: RecoveryInspection,
    document: ReviewDocument,
    expectedHead: string,
    expectedActorNodeId: string
): void {
    if (
        second.state !== first.state ||
        second.head !== first.head ||
        second.reviews.length !== first.reviews.length ||
        (second.reviews.length === 1 && second.reviews[0]!.id !== first.reviews[0]!.id) ||
        (second.reviews.length === 1 &&
            !exactPublishedReview(second.reviews[0]!, document, expectedHead, expectedActorNodeId))
    ) {
        fail('review-publication recovery remote state changed during reconciliation');
    }
}
