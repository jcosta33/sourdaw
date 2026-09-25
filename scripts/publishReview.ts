#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    REQUIRED_REPOSITORY,
    REVIEWER_BOT_NODE_ID,
    ORCHESTRATOR_USER_NODE_ID,
    assertRequiredRepository,
    authenticateRole,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { composeReviewCommentBody, fail, PR_STATE } from './prContract.ts';
import { reviewBundlePath, type ReviewBundleContext } from './prepareReview.ts';
import {
    type PullRequestRemoteMutationBoundary,
    type PullRequestReviewPublicationMutationBoundary,
    type PullRequestReviewPublicationMutationSerialization,
    currentMutationOwnerFence,
    isReviewPublicationPullRequestMutationLockOwner,
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockOwner,
    withPullRequestReviewPublicationMutationLock,
} from './pullRequestMutationLock.ts';
import {
    readPullRequestReviewState,
    assertIndependentReviewerApproval,
    type ReviewState,
} from './pullRequestReviewState.ts';
import {
    readPublicReviewComments,
    readPublicReviews,
    type PublicReview,
    type PublicReviewComment,
} from './reconstructReviewRounds.ts';
import {
    assertSameApprovalContext,
    publicationApprovalContext,
    readLiveApprovalContext,
} from './reviewApprovalContext.ts';
import { renderReviewDocumentBody } from './reviewApprovalFormat.ts';
import { assertReviewCommentLinesInBundleDiff } from './reviewCommentDiffPreflight.ts';
import {
    assertPublicationEvidence,
    parseAcceptanceDocument,
    parseReviewDocument,
    type AcceptanceDocument,
    type ReviewComment,
    type ReviewDocument,
    type ReviewEvent,
} from './reviewDocumentParser.ts';
import { readDossierStanceDraws } from './reviewDossierPublication.ts';
import { assertReviewerModelDiversity, type AuthorshipLabel } from './reviewerModelDiversity.ts';
import {
    assertAcceptanceAuthorization,
    assertAcceptanceDossierAccounting,
    prepareReviewDossierPublication,
    recordAcceptanceAuthorization,
    recordedPublicationReplay,
    recordPublicationBindings,
} from './reviewPublicationBinding.ts';
import {
    readRemoteReview,
    readReviewComments,
    type PublishedReviewComment,
    type RemotePublishedReview,
} from './reviewPublicationRemoteInspection.ts';

import type { ReviewReassessment } from './reviewRoundEscalation.ts';

export type { PublishedReviewComment } from './reviewPublicationRemoteInspection.ts';

export { renderReviewDocumentBody } from './reviewApprovalFormat.ts';
export {
    parseAcceptanceDocument,
    parseReviewDocument,
    type ApprovalEvidence,
    type ReviewComment,
    type ReviewDocument,
    type ReviewEvent,
} from './reviewDocumentParser.ts';

/**
 * GitHub's review-creation request and the review it hands back use two different vocabularies:
 * the request says `APPROVE` / `REQUEST_CHANGES` / `COMMENT`, the response says `APPROVED` /
 * `CHANGES_REQUESTED` / `COMMENTED`. GitHub can also silently coerce the requested event — most
 * observed when the PR closed or merged between bundle prep and posting — and return 200 with a
 * review whose recorded state does not match what was asked for. Map the two vocabularies
 * explicitly rather than by string coincidence, so a coercion is never mistaken for success.
 */
export const EXPECTED_REVIEW_STATE: Record<ReviewEvent, string> = {
    APPROVE: 'APPROVED',
    REQUEST_CHANGES: 'CHANGES_REQUESTED',
};

export type PublishReviewPort = {
    primaryRoot: () => string;
    pullRequest: (number: number) => { state: string; head: string; labels?: AuthorshipLabel[] };
    readReviewJson: (path: string) => unknown;
    bundleFileExists: (path: string) => boolean;
    readBundleDiff: (path: string) => string;
    writeBundleText?: (path: string, contents: string) => void;
    assertApprovalContext?: (number: number, head: string, bundle: string) => ReviewBundleContext;
    reviewState?: (number: number, expectedHead: string) => ReviewState;
    postReview: (input: {
        number: number;
        commitId: string;
        event: ReviewEvent;
        body: string;
        comments: ReviewComment[];
    }) => { id: number; actorNodeId: string; login: string; actorType?: string; commitId?: string };
    /**
     * The public comments one posted review carries, with their database ids, in creation order
     * (#3375, spec #3367 AC-004). Needed only when a bundle dossier awaits its publication binding.
     */
    reviewComments?: (number: number, reviewId: number) => PublishedReviewComment[];
    /**
     * One already-posted review by id, or undefined when no such review stands. Needed only when a
     * bundle dossier records a publication and the run must replay it instead of re-posting.
     */
    remoteReview?: (number: number, reviewId: number) => RemotePublishedReview | undefined;
    /**
     * The pull request's whole public review history and review comments, needed to count reviewer
     * request-changes rounds for the escalation gate (#4584).
     */
    publicReviews?: (number: number) => PublicReview[];
    publicReviewComments?: (number: number) => PublicReviewComment[];
    log: (message: string) => void;
};

export type PublishReviewAuthentication = {
    minted: { actorNodeId: string };
    session: GhSession;
};

export type PublishReviewCoordinatorDependencies = {
    primaryRoot: () => string;
    serializeMutation: PullRequestReviewPublicationMutationSerialization;
    authenticateReviewer: (primaryRoot: string) => Promise<PublishReviewAuthentication>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    reviewPort: (
        session: GhSession,
        primaryRoot: string,
        markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt'],
        markDefinitiveNoMutationHttpStatus: PullRequestReviewPublicationMutationBoundary['markDefinitiveNoMutationHttpStatus']
    ) => PublishReviewPort;
    publish: (
        number: number,
        prepared: PreparedReviewPublication,
        port: PublishReviewPort,
        boundary: PullRequestReviewPublicationMutationBoundary
    ) => number;
};

export function parsePublishReviewArgs(
    args: string[],
    command: 'review:publish' | 'review:accept' = 'review:publish'
): { number?: number; help: boolean } {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const value = Number(args[0]);
    if (!Number.isSafeInteger(value) || value <= 0 || args.length !== 1) {
        fail(`usage: pnpm ${command} <pr-number>`);
    }
    return { number: value, help: false };
}

export function reviewPublicationPayload(input: {
    commitId: string;
    event: ReviewEvent;
    body: string;
    comments: ReviewComment[];
}): string {
    return JSON.stringify({
        commit_id: input.commitId,
        event: input.event,
        body: input.body,
        comments: input.comments.map((comment) => ({
            path: comment.path,
            line: comment.line,
            side: comment.side,
            body: composeReviewCommentBody(comment),
        })),
    });
}

export function reviewPublicationPayloadDigest(payload: string): string {
    return createHash('sha256').update(payload).digest('hex');
}

export type PreparedReviewPublication = {
    head: string;
    document: ReviewDocument;
    payloadDigest: string;
    approvalContext?: ReviewBundleContext;
    /** The escalation reassessment the dossier gate consumed, when the round threshold required one. */
    reviewReassessment?: ReviewReassessment;
};

function prepareReviewPublication(
    number: number,
    port: PublishReviewPort,
    actorNodeId = REVIEWER_BOT_NODE_ID
): PreparedReviewPublication {
    const pullRequest = port.pullRequest(number);
    const head = pullRequest.head;
    const bundle = reviewBundlePath(port.primaryRoot(), number, head);
    const documentName = actorNodeId === ORCHESTRATOR_USER_NODE_ID ? 'acceptance.json' : 'review.json';
    let parsed: unknown;
    try {
        parsed = port.readReviewJson(join(bundle, documentName));
    } catch {
        fail(`missing ${documentName} at ${join(bundle, documentName)}`);
    }
    const document =
        actorNodeId === ORCHESTRATOR_USER_NODE_ID ? parseAcceptanceDocument(parsed) : parseReviewDocument(parsed);
    assertPublicationEvidence(document, head);
    // The acceptance identity never reads the dossier, and its diversity check is exempt anyway.
    const stanceDraws = actorNodeId === ORCHESTRATOR_USER_NODE_ID ? undefined : readDossierStanceDraws(port, bundle);
    assertReviewerModelDiversity({ actorNodeId, authorLabels: pullRequest.labels ?? [], document, stanceDraws });
    const approvalContext = publicationApprovalContext(number, head, document, port);
    assertReviewCommentLinesInBundleDiff(document.comments, port.readBundleDiff(join(bundle, 'diff.patch')));
    const reviewReassessment =
        actorNodeId !== ORCHESTRATOR_USER_NODE_ID
            ? prepareReviewDossierPublication({ number, head, bundle, document, port })
            : undefined;
    return {
        head,
        document,
        approvalContext,
        reviewReassessment,
        payloadDigest: reviewPublicationPayloadDigest(
            reviewPublicationPayload({
                commitId: head,
                event: document.event,
                body: renderReviewDocumentBody(document),
                comments: document.comments,
            })
        ),
    };
}

function publishPreparedReviewForActor(
    actorNodeId: string,
    number: number,
    prepared: PreparedReviewPublication,
    port: PublishReviewPort,
    boundary?: PullRequestReviewPublicationMutationBoundary
): number {
    const pullRequest = port.pullRequest(number);
    if (pullRequest.state !== PR_STATE.OPEN) {
        fail(`pull request is ${pullRequest.state}; refusing to post a review`);
    }
    if (pullRequest.head !== prepared.head) {
        fail('pull-request head moved; refusing to post a stale review');
    }
    const document =
        actorNodeId === ORCHESTRATOR_USER_NODE_ID
            ? parseAcceptanceDocument(prepared.document)
            : parseReviewDocument(prepared.document);
    if (actorNodeId === ORCHESTRATOR_USER_NODE_ID) {
        assertAcceptancePreconditions(number, prepared.head, document, port);
    }
    assertPublicationEvidence(document, pullRequest.head);
    const context = publicationApprovalContext(number, prepared.head, document, port);
    if (context !== undefined) {
        assertSameApprovalContext(prepared.approvalContext, context);
    }
    const body = renderReviewDocumentBody(document);
    const payloadDigest = reviewPublicationPayloadDigest(
        reviewPublicationPayload({
            commitId: prepared.head,
            event: document.event,
            body,
            comments: document.comments,
        })
    );
    if (payloadDigest !== prepared.payloadDigest) {
        fail('review-publication payload does not match the prepared digest');
    }
    // A dossier that already records its publication replays it: the exact same review stands
    // live, so this run reports its id instead of posting a duplicate.
    if (actorNodeId !== ORCHESTRATOR_USER_NODE_ID) {
        const replayed = recordedPublicationReplay(number, prepared.head, document, actorNodeId, port);
        if (replayed !== undefined) {
            port.log(String(replayed));
            return replayed;
        }
    }
    boundary?.journalReviewPublication({
        expectedHead: prepared.head,
        payloadDigest: prepared.payloadDigest,
        reviewerActorNodeId: actorNodeId,
    });
    const posted = port.postReview({
        number,
        commitId: prepared.head,
        event: document.event,
        body,
        comments: document.comments,
    });
    if (posted.actorNodeId !== actorNodeId) {
        fail(`review was posted by actor ${posted.actorNodeId} (${posted.login}), not ${actorNodeId}`);
    }
    if (
        actorNodeId === ORCHESTRATOR_USER_NODE_ID &&
        (posted.actorType !== 'User' || posted.commitId !== prepared.head)
    ) {
        fail('orchestrator acceptance response does not match the User actor and prepared head');
    }
    if (actorNodeId !== ORCHESTRATOR_USER_NODE_ID) {
        recordPublicationBindings(number, prepared.head, document, posted.id, port, prepared.reviewReassessment);
    } else {
        recordAcceptanceAuthorization(number, prepared.head, document.authorization, posted.id, port);
    }
    port.log(String(posted.id));
    return posted.id;
}

function assertAcceptancePreconditions(
    number: number,
    head: string,
    document: AcceptanceDocument,
    port: PublishReviewPort
): void {
    if (port.reviewState === undefined) {
        fail('orchestrator acceptance requires a complete independent review-state reader');
    }
    const state = port.reviewState(number, head);
    assertIndependentReviewerApproval(number, state);
    assertAcceptanceDossierAccounting(number, head, port);
    assertAcceptanceAuthorization(number, head, document.authorization, state.unresolvedThreads, port);
}

export function publishPreparedReview(
    number: number,
    prepared: PreparedReviewPublication,
    port: PublishReviewPort,
    boundary?: PullRequestReviewPublicationMutationBoundary
): number {
    return publishPreparedReviewForActor(REVIEWER_BOT_NODE_ID, number, prepared, port, boundary);
}

export function publishPreparedAcceptance(
    number: number,
    prepared: PreparedReviewPublication,
    port: PublishReviewPort,
    boundary?: PullRequestReviewPublicationMutationBoundary
): number {
    return publishPreparedReviewForActor(ORCHESTRATOR_USER_NODE_ID, number, prepared, port, boundary);
}

export function publishReview(
    number: number,
    port: PublishReviewPort,
    boundary?: PullRequestReviewPublicationMutationBoundary
): number {
    return publishPreparedReview(number, prepareReviewPublication(number, port), port, boundary);
}

export function shellPort(
    session: GhSession,
    cwd: string = process.cwd(),
    capture: typeof spawnCapture = spawnCapture,
    markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt'] = () => undefined,
    markDefinitiveNoMutationHttpStatus: PullRequestReviewPublicationMutationBoundary['markDefinitiveNoMutationHttpStatus'] = () =>
        undefined
): PublishReviewPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[], input?: string) => capture('gh', args, { cwd: primaryRoot, env: session.env, input });
    return {
        primaryRoot: () => primaryRoot,
        pullRequest: (number) => {
            const pullRequest = parseJson<{ state?: unknown; headRefOid?: unknown; labels?: unknown }>(
                gh(['pr', 'view', String(number), '--repo', REQUIRED_REPOSITORY, '--json', 'state,headRefOid,labels']),
                'review publication pull request'
            );
            if (typeof pullRequest.state !== 'string' || typeof pullRequest.headRefOid !== 'string') {
                fail('review publication pull request is unreadable');
            }
            // `gh pr view --json labels` answers [{name, description}]; the diversity check
            // identifies the authorship label by its `Authored by ` description fence, so both
            // fields travel together. Absent labels mean not-comparable, never fatal.
            const labels = Array.isArray(pullRequest.labels)
                ? pullRequest.labels.flatMap((label): AuthorshipLabel[] => {
                      if (typeof label !== 'object' || label === null) {
                          return [];
                      }
                      const name = (label as Record<string, unknown>).name;
                      if (typeof name !== 'string') {
                          return [];
                      }
                      const description = (label as Record<string, unknown>).description;
                      const entry: AuthorshipLabel = { name };
                      if (typeof description === 'string') {
                          entry.description = description;
                      }
                      return [entry];
                  })
                : undefined;
            return { state: pullRequest.state, head: pullRequest.headRefOid, labels };
        },
        reviewState: (number, head) => readPullRequestReviewState(number, head, REQUIRED_REPOSITORY, gh),
        readReviewJson: (path) => JSON.parse(readFileSync(path, 'utf8')) as unknown,
        bundleFileExists: (path) => existsSync(path),
        readBundleDiff: (path) => readFileSync(path, 'utf8'),
        writeBundleText: (path, contents) => writeFileSync(path, contents),
        assertApprovalContext: (number, head, bundle) =>
            readLiveApprovalContext(primaryRoot, number, head, bundle, session, capture),
        postReview: ({ number, commitId, event, body, comments }) => {
            const input = reviewPublicationPayload({ commitId, event, body, comments });
            markRemoteMutationAttempt();
            let created: string;
            try {
                created = gh(
                    ['api', '--method', 'POST', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/reviews`, '--input', '-'],
                    input
                );
            } catch (error) {
                // GitHub validates a review creation before persisting it, so its 422 answer
                // proves the POST created nothing. Journal that proof into the lock owner so
                // exact-owner recovery can tell this failure apart from an indeterminate one.
                if (error instanceof Error && /\bHTTP 422\b/u.test(error.message)) {
                    markDefinitiveNoMutationHttpStatus(422);
                }
                throw error;
            }
            const response = parseJson<{
                id: number;
                state?: string;
                user?: { node_id?: string; login?: string; type?: string };
                commit_id?: string;
            }>(created, 'create review');
            if (!Number.isSafeInteger(response.id) || response.id <= 0) {
                fail('create review returned an unreadable id');
            }
            const expectedState = EXPECTED_REVIEW_STATE[event];
            if (response.state !== expectedState) {
                fail(
                    `review ${response.id} requested ${event} but GitHub recorded ${response.state ?? 'no state'}; refusing to report success`
                );
            }
            return {
                id: response.id,
                actorNodeId: response.user?.node_id ?? '',
                login: response.user?.login ?? '',
                actorType: response.user?.type,
                commitId: response.commit_id,
            };
        },
        reviewComments: (number, reviewId) => readReviewComments(gh, number, reviewId),
        remoteReview: (number, reviewId) => readRemoteReview(gh, number, reviewId),
        publicReviews: (number) => readPublicReviews(gh, number),
        publicReviewComments: (number) => readPublicReviewComments(gh, number),
        log: (message) => {
            console.log(message);
        },
    };
}

export function defaultPublishReviewCoordinatorDependencies(): PublishReviewCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        serializeMutation: withPullRequestReviewPublicationMutationLock,
        authenticateReviewer: (primaryRoot) => authenticateRole({ primaryRoot, role: 'reviewer' }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        reviewPort: (session, primaryRoot, markRemoteMutationAttempt, markDefinitiveNoMutationHttpStatus) =>
            shellPort(
                session,
                primaryRoot,
                spawnCapture,
                markRemoteMutationAttempt,
                markDefinitiveNoMutationHttpStatus
            ),
        publish: publishPreparedReview,
    };
}

async function coordinateReviewPublication(
    number: number,
    dependencies: PublishReviewCoordinatorDependencies,
    actorNodeId: string
): Promise<void> {
    const primaryRoot = dependencies.primaryRoot();
    try {
        const auth = await dependencies.authenticateReviewer(primaryRoot);
        try {
            if (auth.minted.actorNodeId !== actorNodeId) {
                fail(`authenticated actor ${auth.minted.actorNodeId} is not ${actorNodeId}`);
            }
            assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
            const preflightPort = dependencies.reviewPort(
                auth.session,
                primaryRoot,
                () => undefined,
                () => undefined
            );
            const prepared = prepareReviewPublication(number, preflightPort, actorNodeId);
            if (actorNodeId === ORCHESTRATOR_USER_NODE_ID) {
                assertAcceptancePreconditions(
                    number,
                    prepared.head,
                    parseAcceptanceDocument(prepared.document),
                    preflightPort
                );
            }
            await dependencies.serializeMutation(
                primaryRoot,
                number,
                async (boundary) =>
                    dependencies.publish(
                        number,
                        prepared,
                        dependencies.reviewPort(
                            auth.session,
                            primaryRoot,
                            boundary.markRemoteMutationAttempt,
                            boundary.markDefinitiveNoMutationHttpStatus
                        ),
                        boundary
                    ),
                {
                    reviewPublication: {
                        expectedHead: prepared.head,
                        payloadDigest: prepared.payloadDigest,
                        reviewerActorNodeId: auth.minted.actorNodeId,
                        ownerFence: currentMutationOwnerFence,
                    },
                }
            );
        } finally {
            auth.session.dispose();
        }
    } catch (error) {
        const recovery = retainedReviewPublicationRecoveryCommand(primaryRoot, number);
        if (recovery === undefined) {
            throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}; retained exact review-publication owner: ${recovery}`, { cause: error });
    }
}

export async function coordinatePublishReview(
    number: number,
    dependencies: PublishReviewCoordinatorDependencies = defaultPublishReviewCoordinatorDependencies()
): Promise<void> {
    return coordinateReviewPublication(number, dependencies, REVIEWER_BOT_NODE_ID);
}

export type AcceptReviewCoordinatorDependencies = Omit<PublishReviewCoordinatorDependencies, 'authenticateReviewer'> & {
    authenticateOrchestrator: () => Promise<PublishReviewAuthentication>;
};

export async function coordinateOrchestratorAcceptance(
    number: number,
    dependencies: AcceptReviewCoordinatorDependencies
): Promise<void> {
    const { authenticateOrchestrator: authenticate, ...shared } = dependencies;
    return coordinateReviewPublication(
        number,
        { ...shared, authenticateReviewer: authenticate },
        ORCHESTRATOR_USER_NODE_ID
    );
}

function retainedReviewPublicationRecoveryCommand(primaryRoot: string, number: number): string | undefined {
    try {
        const ownerOid = readPullRequestMutationLockOid(primaryRoot, pullRequestMutationLockRef(number), number);
        if (ownerOid === undefined) {
            return undefined;
        }
        const owner = readPullRequestMutationLockOwner(primaryRoot, ownerOid, number);
        if (!isReviewPublicationPullRequestMutationLockOwner(owner)) {
            return undefined;
        }
        return `pnpm review:publish:recover ${number} --owner ${ownerOid}`;
    } catch {
        return undefined;
    }
}

export async function runPublishReviewCli(
    args: string[],
    dependencies?: PublishReviewCoordinatorDependencies
): Promise<number> {
    const parsed = parsePublishReviewArgs(args);
    if (parsed.help) {
        console.log('Usage: pnpm review:publish <pr-number>');
        return 0;
    }
    if (parsed.number === undefined) {
        fail('usage: pnpm review:publish <pr-number>');
    }
    await coordinatePublishReview(parsed.number, dependencies);
    return 0;
}
