import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    REVIEWER_BOT_NODE_ID,
    assertRequiredRepository,
    authenticateRole,
    isReviewerBotNodeId,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import { reviewBundlePath } from './prepareReview.ts';
import {
    parseReviewDocument,
    reviewPublicationPayload,
    reviewPublicationPayloadDigest,
    type PublishReviewAuthentication,
    type ReviewDocument,
} from './publishReview.ts';
import {
    currentReviewPublicationOwnerFence,
    isReviewPublicationPullRequestMutationLockOwner,
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockOwner,
    readPullRequestMutationLockReceipt,
    recordReviewPublicationRecoveryReceipt,
    replacePullRequestMutationLockOwner,
    releasePullRequestMutationLockOwner,
    reviewPublicationOwnerFenceIsLive,
    type PullRequestMutationLockOwner,
    type PullRequestMutationLockOwnerFence,
} from './pullRequestMutationLock.ts';
import { assertReviewCommentLinesInBundleDiff } from './reviewCommentDiffPreflight.ts';
import { legacyReviewPublicationIncidents } from './reviewPublicationLegacyIncidents.ts';
import {
    hasExactRecoveryReceipt,
    isMatchingRecoveryReceipt,
    isReplayableAdoptedRecoveryReceipt,
    recoveryReceipt,
} from './reviewPublicationRecoveryReceipt.ts';
import {
    exactPublishedReview,
    inspectReviewPublicationRemote,
    type RecoveryInspection,
} from './reviewPublicationRemoteInspection.ts';

type ReviewPublicationLockOwner = Extract<PullRequestMutationLockOwner, { version: 3 }>;

type LegacyReviewPublicationIncident = (typeof legacyReviewPublicationIncidents)[number];

export type RecoverPublishReviewArgs = {
    number?: number;
    owner?: string;
    help: boolean;
};

type PersistedRecoveryReceipt = {
    version: 2;
    number: number;
    ownerOid: string;
    adoptedOwnerOid: string;
    head: string;
    payloadDigest: string;
    outcome: 'absent' | 'landed';
};

export type RecoverPublishReviewDependencies = {
    primaryRoot: () => string;
    authenticateReviewer: (primaryRoot: string) => Promise<PublishReviewAuthentication>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    inspect: (
        number: number,
        expectedActorNodeId: string,
        expectedHead: string,
        session: GhSession,
        primaryRoot: string
    ) => RecoveryInspection;
    isOwnerLive?: (owner: ReviewPublicationLockOwner) => boolean;
    currentOwnerFence?: () => PullRequestMutationLockOwnerFence;
    isLegacyOwnerLive?: (pid: number) => boolean;
    legacyIncident?: (number: number, ownerOid: string) => LegacyReviewPublicationIncident | undefined;
    beforeReplayReceiptRelease?: (receipt: PersistedRecoveryReceipt) => void;
    afterRecoveryReceiptPersisted?: (receipt: PersistedRecoveryReceipt) => void;
};

const recoverPublishReviewUsage = 'usage: pnpm review:publish:recover <pr-number> --owner <lock-object-id>';

export function parseRecoverPublishReviewArgs(args: string[]): RecoverPublishReviewArgs {
    if (args.length === 1 && args[0] === '--help') {
        return { help: true };
    }
    if (args.length !== 3 || !/^[1-9][0-9]*$/u.test(args[0] ?? '') || args[1] !== '--owner') {
        fail(recoverPublishReviewUsage);
    }
    const number = Number(args[0]);
    const owner = args[2];
    if (!Number.isSafeInteger(number) || owner === undefined || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(owner)) {
        fail(recoverPublishReviewUsage);
    }
    return { number, owner: owner.toLowerCase(), help: false };
}

function defaultRecoverPublishReviewDependencies(): RecoverPublishReviewDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        authenticateReviewer: (primaryRoot) => authenticateRole({ primaryRoot, role: 'reviewer' }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        inspect: (number, expectedActorNodeId, expectedHead, session, primaryRoot) => {
            const gh = (args: string[]) => spawnCapture('gh', args, { env: session.env, cwd: primaryRoot });
            return inspectReviewPublicationRemote(number, expectedActorNodeId, expectedHead, gh);
        },
        isOwnerLive: reviewPublicationOwnerFenceIsLive,
    };
}

function requireLegacyReviewPublicationIncident(
    incident: LegacyReviewPublicationIncident | undefined
): LegacyReviewPublicationIncident {
    if (incident === undefined) {
        fail('legacy review-publication recovery requires the exact trusted incident receipt');
    }
    return incident;
}

function requireReviewPublicationOwner(
    owner: PullRequestMutationLockOwner,
    number: number
): ReviewPublicationLockOwner {
    if (!isReviewPublicationPullRequestMutationLockOwner(owner)) {
        fail(`PR #${number} recovery requires a review-publication lock owner`);
    }
    return owner;
}

type AttestedRecoveryOwner = {
    originalOwner: PullRequestMutationLockOwner;
    journaledOwner: ReviewPublicationLockOwner | undefined;
    legacyIncident: LegacyReviewPublicationIncident | undefined;
    expectedHead: string;
    expectedActorNodeId: string;
};

export async function runRecoverPublishReviewLockCli(
    args: string[],
    dependencies: RecoverPublishReviewDependencies = defaultRecoverPublishReviewDependencies()
): Promise<number> {
    const parsed = parseRecoverPublishReviewArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${recoverPublishReviewUsage.slice('usage: '.length)}`);
        return 0;
    }
    const number = parsed.number!;
    const ownerOid = parsed.owner!;
    const primaryRoot = dependencies.primaryRoot();
    const replayed = recoverFromPersistedReceiptIfPossible(primaryRoot, number, ownerOid, dependencies);
    if (replayed !== undefined) {
        return replayed;
    }
    const attestation = attestRecoveryOwner(primaryRoot, number, ownerOid, dependencies);
    return reconcileRecoveredOwner(primaryRoot, number, ownerOid, attestation, dependencies);
}

function recoverFromPersistedReceiptIfPossible(
    primaryRoot: string,
    number: number,
    ownerOid: string,
    dependencies: RecoverPublishReviewDependencies
): number | undefined {
    const currentOid = readPullRequestMutationLockOid(primaryRoot, pullRequestMutationLockRef(number), number);
    const persistedReceipt = readPullRequestMutationLockReceipt(primaryRoot, number, ownerOid);
    if (currentOid === undefined) {
        if (isMatchingRecoveryReceipt(persistedReceipt, number, ownerOid)) {
            console.log(`review-publication-lock-already-recovered:${number}:${ownerOid}`);
            return 0;
        }
        fail(`PR #${number} review-publication lock is absent without an exact recovery receipt`);
    }
    if (currentOid !== ownerOid) {
        replayAdoptedRecoveryReceipt(primaryRoot, number, ownerOid, currentOid, persistedReceipt, dependencies);
        return 0;
    }
    return undefined;
}

function replayAdoptedRecoveryReceipt(
    primaryRoot: string,
    number: number,
    ownerOid: string,
    currentOid: string,
    persistedReceipt: unknown,
    dependencies: RecoverPublishReviewDependencies
): void {
    if (!isReplayableAdoptedRecoveryReceipt(persistedReceipt, number, ownerOid, currentOid)) {
        fail(`PR #${number} delivery lock ownership changed before recovery`);
    }
    const adoptedOwner = readPullRequestMutationLockOwner(primaryRoot, currentOid, number);
    if (
        !isReviewPublicationPullRequestMutationLockOwner(adoptedOwner) ||
        adoptedOwner.expectedHead !== persistedReceipt.head ||
        adoptedOwner.payloadDigest !== persistedReceipt.payloadDigest
    ) {
        fail('review-publication recovery receipt does not attest the exact adopted owner, head, and payload');
    }
    dependencies.beforeReplayReceiptRelease?.(persistedReceipt);
    releasePullRequestMutationLockOwner(primaryRoot, number, currentOid);
    console.log(`review-publication-lock-recovered:${number}:${ownerOid}:${persistedReceipt.outcome}`);
}

function attestRecoveryOwner(
    primaryRoot: string,
    number: number,
    ownerOid: string,
    dependencies: RecoverPublishReviewDependencies
): AttestedRecoveryOwner {
    const originalOwner = readPullRequestMutationLockOwner(primaryRoot, ownerOid, number);
    const legacyIncident =
        originalOwner.version === 1
            ? requireTrustedLegacyIncident(number, ownerOid, originalOwner, dependencies)
            : undefined;
    const journaledOwner =
        originalOwner.version === 1 ? undefined : requireReviewPublicationOwner(originalOwner, number);
    if (journaledOwner !== undefined) {
        requireExactJournaledIncidentBinding(number, journaledOwner);
    }
    assertRecoveryOwnerNotLive(number, originalOwner, journaledOwner, dependencies);
    const expectedHead = legacyIncident?.expectedHead ?? journaledOwner?.expectedHead;
    const expectedActorNodeId = legacyIncident?.reviewerActorNodeId ?? journaledOwner?.reviewerActorNodeId;
    if (expectedHead === undefined || expectedActorNodeId === undefined) {
        fail(`PR #${number} recovery requires a review-publication lock owner`);
    }
    return { originalOwner, journaledOwner, legacyIncident, expectedHead, expectedActorNodeId };
}

function requireTrustedLegacyIncident(
    number: number,
    ownerOid: string,
    originalOwner: Extract<PullRequestMutationLockOwner, { version: 1 }>,
    dependencies: RecoverPublishReviewDependencies
): LegacyReviewPublicationIncident {
    const trustedIncident = legacyReviewPublicationIncidents.find(
        (candidate) => candidate.number === number && candidate.ownerOid === ownerOid
    );
    const incident = (dependencies.legacyIncident ?? findLegacyIncident)(number, ownerOid);
    if (
        trustedIncident === undefined ||
        incident === undefined ||
        JSON.stringify(incident) !== JSON.stringify(trustedIncident) ||
        originalOwner.pid !== incident.owner.pid ||
        originalOwner.token !== incident.owner.token ||
        incident.definitiveNoMutationHttpStatus !== 422
    ) {
        fail('legacy review-publication recovery requires the exact trusted incident receipt');
    }
    return requireLegacyReviewPublicationIncident(incident);
}

function findLegacyIncident(number: number, ownerOid: string): LegacyReviewPublicationIncident | undefined {
    return legacyReviewPublicationIncidents.find(
        (candidate) => candidate.number === number && candidate.ownerOid === ownerOid
    );
}

function requireExactJournaledIncidentBinding(number: number, journaledOwner: ReviewPublicationLockOwner): void {
    const recovery = journaledOwner.recovery;
    if (recovery === undefined) {
        return;
    }
    const recoveryIncident = legacyReviewPublicationIncidents.find(
        (candidate) => candidate.number === number && candidate.ownerOid === recovery.legacyOwnerOid
    );
    if (
        recoveryIncident === undefined ||
        journaledOwner.expectedHead !== recoveryIncident.expectedHead ||
        journaledOwner.reviewerActorNodeId !== recoveryIncident.reviewerActorNodeId ||
        journaledOwner.payloadDigest !==
            reviewPublicationPayloadDigest(
                reviewPublicationPayload({
                    commitId: recoveryIncident.expectedHead,
                    event: recoveryIncident.preparedPayload.event,
                    body: recoveryIncident.preparedPayload.body,
                    comments: recoveryIncident.preparedPayload.comments,
                })
            ) ||
        journaledOwner.mutation.phase !== 'prepared' ||
        journaledOwner.mutation.epoch !== 1
    ) {
        fail('review-publication recovery requires an exact journaled incident binding');
    }
}

function assertRecoveryOwnerNotLive(
    number: number,
    originalOwner: PullRequestMutationLockOwner,
    journaledOwner: ReviewPublicationLockOwner | undefined,
    dependencies: RecoverPublishReviewDependencies
): void {
    if (
        journaledOwner !== undefined &&
        (dependencies.isOwnerLive ?? reviewPublicationOwnerFenceIsLive)(journaledOwner)
    ) {
        fail(`PR #${number} review-publication lock is still held by a live process`);
    }
    if (originalOwner.version !== 1) {
        return;
    }
    if (dependencies.isLegacyOwnerLive?.(originalOwner.pid) === true) {
        fail(`PR #${number} legacy review-publication lock is still held by a live process`);
    }
    if (dependencies.isLegacyOwnerLive === undefined) {
        try {
            process.kill(originalOwner.pid, 0);
            fail(`PR #${number} legacy review-publication lock is still held by a live process`);
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
                throw error;
            }
        }
    }
}

async function reconcileRecoveredOwner(
    primaryRoot: string,
    number: number,
    ownerOid: string,
    attestation: AttestedRecoveryOwner,
    dependencies: RecoverPublishReviewDependencies
): Promise<number> {
    const auth = await dependencies.authenticateReviewer(primaryRoot);
    try {
        if (!isReviewerBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${REVIEWER_BOT_NODE_ID}`);
        }
        if (auth.minted.actorNodeId !== attestation.expectedActorNodeId) {
            fail('review-publication recovery retained reviewer actor does not match the authenticated reviewer');
        }
        assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
        const document = readRecoveryBundleDocument(primaryRoot, number, attestation);
        const expectedDigest = requireMatchingRecoveryDigest(number, attestation, document);
        const first = dependencies.inspect(
            number,
            attestation.expectedActorNodeId,
            attestation.expectedHead,
            auth.session,
            primaryRoot
        );
        assertNoUnauthorizedLandedEvidence(first, document, attestation.expectedHead);
        assertSingleExactLandedReview(first, document, attestation.expectedHead, attestation.expectedActorNodeId);
        const adoptedOwner = adoptedRecoveryOwner(number, ownerOid, attestation, expectedDigest, dependencies);
        const adoptedOid = replacePullRequestMutationLockOwner(primaryRoot, number, ownerOid, adoptedOwner);
        try {
            return releaseAdoptedOwnerWithRecoveryReceipt(
                primaryRoot,
                number,
                ownerOid,
                adoptedOid,
                first,
                document,
                attestation,
                expectedDigest,
                dependencies,
                auth.session
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
                `${message}; PR #${number} review-publication recovery preserved exact lock owner ${adoptedOid}`,
                { cause: error }
            );
        }
    } finally {
        auth.session.dispose();
    }
}

function readRecoveryBundleDocument(
    primaryRoot: string,
    number: number,
    attestation: AttestedRecoveryOwner
): ReviewDocument {
    const bundle = reviewBundlePath(primaryRoot, number, attestation.expectedHead);
    const document = parseReviewDocument(JSON.parse(readFileSync(join(bundle, 'review.json'), 'utf8')) as unknown);
    assertReviewCommentLinesInBundleDiff(document.comments, readFileSync(join(bundle, 'diff.patch'), 'utf8'));
    if (
        attestation.legacyIncident !== undefined &&
        JSON.stringify(document) !== JSON.stringify(attestation.legacyIncident.preparedPayload)
    ) {
        fail('legacy review-publication recovery bundle does not match the trusted incident receipt');
    }
    return document;
}

function requireMatchingRecoveryDigest(
    number: number,
    attestation: AttestedRecoveryOwner,
    document: ReviewDocument
): string {
    const payloadDigest = reviewPublicationPayloadDigest(
        reviewPublicationPayload({
            commitId: attestation.expectedHead,
            event: document.event,
            body: document.body,
            comments: document.comments,
        })
    );
    const expectedDigest =
        attestation.legacyIncident === undefined
            ? requireReviewPublicationOwner(attestation.originalOwner, number).payloadDigest
            : reviewPublicationPayloadDigest(
                  reviewPublicationPayload({
                      commitId: attestation.expectedHead,
                      event: attestation.legacyIncident.preparedPayload.event,
                      body: attestation.legacyIncident.preparedPayload.body,
                      comments: attestation.legacyIncident.preparedPayload.comments,
                  })
              );
    if (payloadDigest !== expectedDigest) {
        fail('review-publication recovery payload does not match the retained lock');
    }
    return expectedDigest;
}

function assertNoUnauthorizedLandedEvidence(
    inspection: RecoveryInspection,
    document: ReviewDocument,
    expectedHead: string
): void {
    if (
        (inspection.otherActorReviews ?? []).some((review) =>
            exactPublishedReview(review, document, expectedHead, review.actorNodeId)
        )
    ) {
        fail('review-publication recovery found unauthorized landed review evidence');
    }
}

function assertSingleExactLandedReview(
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

function adoptedRecoveryOwner(
    number: number,
    ownerOid: string,
    attestation: AttestedRecoveryOwner,
    expectedDigest: string,
    dependencies: RecoverPublishReviewDependencies
): PullRequestMutationLockOwner {
    const { originalOwner, journaledOwner, legacyIncident, expectedHead, expectedActorNodeId } = attestation;
    return {
        version: 3 as const,
        pid: process.pid,
        token: randomUUID(),
        operation: 'review-publication' as const,
        number,
        expectedHead,
        payloadDigest: expectedDigest,
        reviewerActorNodeId: expectedActorNodeId,
        ownerFence: dependencies.currentOwnerFence?.() ?? currentReviewPublicationOwnerFence(),
        mutation: {
            phase: legacyIncident === undefined ? journaledOwner!.mutation.phase : ('prepared' as const),
            epoch:
                legacyIncident === undefined
                    ? requireReviewPublicationOwner(originalOwner, number).mutation.epoch + 1
                    : 1,
            // An attested no-mutation proof must survive adoption: without it a crash between
            // adoption and receipt persistence recreates the unrecoverable owner it closed.
            ...(legacyIncident === undefined && journaledOwner!.mutation.definitiveNoMutationHttpStatus === 422
                ? { definitiveNoMutationHttpStatus: 422 as const }
                : {}),
        },
        ...(legacyIncident !== undefined
            ? {
                  recovery: {
                      legacyOwnerOid: ownerOid,
                      definitiveNoMutationHttpStatus: 422 as const,
                  },
              }
            : {}),
    };
}

function releaseAdoptedOwnerWithRecoveryReceipt(
    primaryRoot: string,
    number: number,
    ownerOid: string,
    adoptedOid: string,
    first: RecoveryInspection,
    document: ReviewDocument,
    attestation: AttestedRecoveryOwner,
    expectedDigest: string,
    dependencies: RecoverPublishReviewDependencies,
    session: GhSession
): number {
    const second = dependencies.inspect(
        number,
        attestation.expectedActorNodeId,
        attestation.expectedHead,
        session,
        primaryRoot
    );
    assertNoUnauthorizedLandedEvidence(second, document, attestation.expectedHead);
    assertReconciliationStable(first, second, document, attestation.expectedHead, attestation.expectedActorNodeId);
    const outcome = second.reviews.length === 1 ? 'landed' : 'absent';
    const absentReleaseIsAttested =
        attestation.journaledOwner?.mutation.phase === 'prepared' ||
        attestation.legacyIncident?.definitiveNoMutationHttpStatus === 422 ||
        attestation.journaledOwner?.mutation.definitiveNoMutationHttpStatus === 422;
    if (outcome === 'absent' && !absentReleaseIsAttested) {
        fail(
            'review-publication recovery cannot release an owner that attempted a remote mutation without landed evidence'
        );
    }
    const receipt = recoveryReceipt(number, ownerOid, adoptedOid, attestation.expectedHead, expectedDigest, outcome);
    recordReviewPublicationRecoveryReceipt(primaryRoot, number, ownerOid, receipt);
    if (!hasExactRecoveryReceipt(readPullRequestMutationLockReceipt(primaryRoot, number, ownerOid), receipt)) {
        fail('review-publication recovery receipt does not attest the exact owner, head, payload, and outcome');
    }
    dependencies.afterRecoveryReceiptPersisted?.(receipt);
    releasePullRequestMutationLockOwner(primaryRoot, number, adoptedOid);
    console.log(`review-publication-lock-recovered:${number}:${ownerOid}:${outcome}`);
    return 0;
}

function assertReconciliationStable(
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
        (second.reviews.length === 1 &&
            !exactPublishedReview(second.reviews[0]!, document, expectedHead, expectedActorNodeId))
    ) {
        fail('review-publication recovery remote state changed during reconciliation');
    }
}
