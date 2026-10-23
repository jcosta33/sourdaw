import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { coordinateAcceptReview, runAcceptReviewCli } from '../acceptReview.ts';
import { shellPort as deliverShellPort } from '../deliverPullRequest.ts';
import {
    AUTHOR_BOT_NODE_ID,
    CI_APPROVAL_LABEL,
    ORCHESTRATOR_USER_NODE_ID,
    REVIEWER_BOT_NODE_ID,
    type GhSession,
} from '../githubAppIdentity.ts';
import { composeReviewCommentBody } from '../prContract.ts';
import { readReviewBundleContext } from '../prepareReview.ts';
import {
    coordinatePublishReview,
    parseAcceptanceDocument,
    publishPreparedAcceptance,
    type AcceptReviewCoordinatorDependencies,
    defaultPublishReviewCoordinatorDependencies,
    parsePublishReviewArgs,
    parseReviewDocument,
    renderReviewDocumentBody,
    publishPreparedReview,
    publishReview,
    reviewPublicationPayload,
    reviewPublicationPayloadDigest,
    runPublishReviewCli,
    shellPort,
    type PublishedReviewComment,
    type PublishReviewCoordinatorDependencies,
    type PublishReviewPort,
    type ReviewDocument,
} from '../publishReview.ts';
import {
    type PullRequestMutationLockOwner,
    currentMutationOwnerFence,
    pullRequestMutationLockRef,
    reviewPublicationRecoveryReceiptRef,
    readPullRequestMutationLockReceipt,
    readPullRequestMutationLockOwner,
    readPullRequestMutationLockOid,
    mutationOwnerFenceIsLive,
    withPullRequestReviewPublicationMutationLock,
    withPullRequestMutationLock,
    writePullRequestMutationLockOwner,
    writePullRequestMutationLockReceipt,
} from '../pullRequestMutationLock.ts';
import { runRecoverPublishReviewLockCli } from '../recoverPublishReviewLock.ts';
import {
    appendReviewDossierEvents,
    authorizedEvidenceDigest,
    parseReviewDossier,
    serializeReviewDossier,
} from '../reviewDossier.ts';
import { buildDossier } from '../reviewDossierChain.ts';
import { buildReviewDossier } from '../reviewDossierPublication.ts';
import {
    acceptedFindings,
    completedStances,
    deliveryAuthorization,
    discardedDispositions,
    publishedFindings,
    publishedReviewId,
} from '../reviewDossierViews.ts';
import { recordPublicationBindings } from '../reviewPublicationBinding.ts';
import { legacyReviewPublicationIncidents } from '../reviewPublicationLegacyIncidents.ts';
import { OPERATOR_ABSENT_ATTESTATION, type RecoveryReceipt } from '../reviewPublicationRecoveryReceipt.ts';
import {
    exactPublishedReview,
    inspectReviewPublicationRemote,
    type RemotePublishedReview,
} from '../reviewPublicationRemoteInspection.ts';
import { planReviewRisk } from '../reviewRiskPolicy.ts';
import { REVIEW_ROUND_FREEZE_THRESHOLD } from '../reviewRoundEscalation.ts';

import type { PublicReview, PublicReviewComment } from '../reconstructReviewRounds.ts';
import type { ReviewDraw } from '../reviewDocumentParser.ts';
import type { ReviewRiskPlan } from '../reviewRiskPolicy.ts';

const validComment = {
    path: 'scripts/deliverPullRequest.ts',
    line: 10,
    side: 'RIGHT' as const,
    defect: 'COMMENT still authorizes merge',
    consequence: 'A stale COMMENT could ship',
    done: 'Require reviewer APPROVED on this head',
};

function approvalEvidence(headSha = 'headsha') {
    return {
        headSha,
        claims: [
            {
                observable: 'Missing evidence prevents posting',
                verification: 'pnpm test:run scripts/__tests__/publishReview.spec.ts',
                observed: 'Missing evidence: no POST and no journal',
            },
        ],
    };
}

function approvalContext(headSha = 'headsha', pr = 42) {
    return { pr, baseRefName: 'main', baseSha: 'base', headSha };
}

// The compact-v1 posted body is exactly the reviewer-written conclusion: no generated footer.
function approvalBody(summary = 'ok') {
    return summary;
}

function removeTemporaryDirectory(root: string): void {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
}

function runGit(root: string, args: string[]): string {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
}

function actualGitDiffForPath(path: string): string {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-diff-path-'));
    try {
        runGit(root, ['init']);
        runGit(root, ['config', 'user.email', 'reviewer@example.test']);
        runGit(root, ['config', 'user.name', 'Reviewer']);
        writeFileSync(join(root, path), 'before\n');
        runGit(root, ['add', '--', path]);
        runGit(root, ['commit', '-m', 'fixture']);
        writeFileSync(join(root, path), 'after\n');
        return runGit(root, ['diff', '--', path]);
    } finally {
        removeTemporaryDirectory(root);
    }
}

function writeRawLockOwner(root: string, contents: string): string {
    const result = spawnSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: root,
        encoding: 'utf8',
        input: contents,
        shell: false,
    });
    if (result.status !== 0) {
        throw new Error(`could not write raw test owner: ${result.stderr}`);
    }
    return result.stdout.trim();
}

function fakePort(
    input: {
        head?: string;
        laterHead?: string;
        state?: string;
        laterState?: string;
        json?: unknown;
        diff?: string;
        missing?: boolean;
        actorNodeId?: string;
        login?: string;
        labels?: { name: string; description?: string }[];
        unresolvedThreads?: number;
    } = {}
) {
    const calls: string[] = [];
    const logs: string[] = [];
    // Label writes stay out of `calls`, whose exact read-then-post sequence many cases pin.
    const labelWrites: string[] = [];
    const posted: { review?: Parameters<PublishReviewPort['postReview']>[0] } = {};
    let head = input.head ?? 'headsha';
    let state = input.state ?? 'OPEN';
    const port: PublishReviewPort = {
        primaryRoot: () => '/repo',
        assertApprovalContext: (number, head) => approvalContext(head, number),
        pullRequest: () => {
            const current = head;
            const currentState = state;
            if (input.laterHead !== undefined) {
                head = input.laterHead;
            }
            if (input.laterState !== undefined) {
                state = input.laterState;
            }
            return { state: currentState, head: current, labels: input.labels };
        },
        readReviewJson: (path) => {
            // A plain fake bundle carries only the review or acceptance document: the publication's
            // dossier probes (risk plan, canonical record, discards) must see them absent, exactly
            // as a bundle prepared before those files existed does. Those probes stay out of `calls`
            // because existing cases pin that log to the document read followed by the POST.
            if (!/(?:^|[/\\])(?:review|acceptance)\.json$/u.test(path)) {
                throw new Error('ENOENT');
            }
            calls.push(`read:${path}`);
            if (input.missing === true) {
                throw new Error('ENOENT');
            }
            const json = input.json ?? {
                format: 'compact-v1',
                event: 'APPROVE',
                body: 'ok',
                comments: [],
                evidence: approvalEvidence(input.head),
            };
            // Every valid fixture must carry the reviewer model, as real review.json files now do;
            // a fixture that sets the key at all (even to undefined) opts out to exercise refusal.
            if (typeof json === 'object' && json !== null && !Array.isArray(json) && !('reviewerModel' in json)) {
                return { ...json, reviewerModel: 'glm-5.3-flash' };
            }
            return json;
        },
        bundleFileExists: (path) => existsSync(path),
        readBundleDiff: () =>
            input.diff ??
            [
                'diff --git a/scripts/deliverPullRequest.ts b/scripts/deliverPullRequest.ts',
                '+++ b/scripts/deliverPullRequest.ts',
                '@@ -10 +10 @@',
                '+review',
            ].join('\n'),
        postReview: (review) => {
            calls.push(`post:${review.commitId}:${review.event}:${review.body}`);
            posted.review = review;
            return {
                id: 99,
                actorNodeId: input.actorNodeId ?? REVIEWER_BOT_NODE_ID,
                login: input.login ?? 'renamed-reviewer[bot]',
            };
        },
        publicReviews: () => [],
        publicReviewComments: () => [],
        // Every approval publication now proves no review thread is open, so the
        // default state reads zero; a case sets `unresolvedThreads` to exercise
        // the refusal.
        reviewState: () => ({
            latestReviewerStateOnHead: null,
            latestReviewerReviewDatabaseId: null,
            unresolvedThreads: input.unresolvedThreads ?? 0,
        }),
        applyApprovalLabel: (number) => labelWrites.push(`apply:${number}`),
        removeApprovalLabel: (number) => labelWrites.push(`remove:${number}`),
        log: (message) => logs.push(message),
    };
    return { port, calls, logs, posted, labelWrites };
}

function createJournaledRecoveryFixture(
    phase: 'prepared' | 'remote-mutation-attempted' = 'remote-mutation-attempted',
    definitiveNoMutationHttpStatus?: 422
) {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-recovery-'));
    const number = 42;
    const head = 'a'.repeat(40);
    runGit(root, ['init']);
    const bundle = join(root, '.agents', 'review-bundles', `${number}-${head}`);
    mkdirSync(bundle, { recursive: true });
    writeFileSync(
        join(bundle, 'review.json'),
        JSON.stringify({
            event: 'APPROVE',
            body: 'Attacked; held.',
            comments: [],
            reviewerModel: 'glm-5.3-flash',
        })
    );
    writeFileSync(join(bundle, 'diff.patch'), '');
    const digest = reviewPublicationPayloadDigest(
        reviewPublicationPayload({ commitId: head, event: 'APPROVE', body: 'Attacked; held.', comments: [] })
    );
    const ownerOid = writePullRequestMutationLockOwner(
        root,
        {
            version: 3,
            pid: 999_999,
            token: '11111111-1111-4111-8111-111111111111',
            operation: 'review-publication',
            number,
            expectedHead: head,
            payloadDigest: digest,
            reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
            ownerFence: { kind: 'pid', pid: 999_999, startedAt: 'Thu Jan 01 00:00:00 1970' },
            mutation: {
                phase,
                epoch: 1,
                ...(definitiveNoMutationHttpStatus === 422 ? { definitiveNoMutationHttpStatus } : {}),
            },
        },
        number
    );
    runGit(root, ['update-ref', pullRequestMutationLockRef(number), ownerOid]);
    return { root, number, head, ownerOid };
}

function writeTrustedPsFixture(root: string): () => void {
    const executable = join(root, 'ps');
    const previous = process.env.SOURDAW_TRUSTED_PS_PATH;
    writeFileSync(
        executable,
        '#!/bin/sh\nif [ "$2" = "pgid=" ]; then printf "%s\\n" "$4"; else printf "%s\\n" "publication-process-start"; fi\n'
    );
    chmodSync(executable, 0o700);
    process.env.SOURDAW_TRUSTED_PS_PATH = executable;
    return () => {
        if (previous === undefined) {
            delete process.env.SOURDAW_TRUSTED_PS_PATH;
        } else {
            process.env.SOURDAW_TRUSTED_PS_PATH = previous;
        }
    };
}

/**
 * Drives the real coordinator, lock, and shell port through a review POST that fails with the
 * given message, leaving exactly the retained owner a real crash would leave for recovery.
 */
async function runFailingReviewPublication(root: string, number: number, head: string, failureMessage: string) {
    const bundle = join(root, '.agents', 'review-bundles', `${number}-${head}`);
    mkdirSync(bundle, { recursive: true });
    writeFileSync(
        join(bundle, 'manifest.json'),
        JSON.stringify({ ...approvalContext(head, number), baseSha: 'b'.repeat(40) })
    );
    writeFileSync(
        join(bundle, 'review.json'),
        JSON.stringify({
            format: 'compact-v1',
            event: 'APPROVE',
            body: 'Attacked; held.',
            comments: [],
            evidence: approvalEvidence(head),
            reviewerModel: 'glm-5.3-flash',
        })
    );
    writeFileSync(join(bundle, 'diff.patch'), '');
    const session: GhSession = { configDir: '/tmp/reviewer', env: {}, dispose: () => undefined };
    const dependencies: PublishReviewCoordinatorDependencies = {
        primaryRoot: () => root,
        serializeMutation: withPullRequestReviewPublicationMutationLock,
        authenticateReviewer: async () => ({ minted: { actorNodeId: REVIEWER_BOT_NODE_ID }, session }),
        repositoryName: () => 'jcosta33/sourdaw',
        reviewPort: (portSession, primaryRoot, markRemoteMutationAttempt, markDefinitiveNoMutationHttpStatus) =>
            shellPort(
                portSession,
                primaryRoot,
                (command, args) => {
                    if (command === 'git' && args[0] === 'rev-parse') {
                        return `${root}/.git`;
                    }
                    if (command === 'gh' && args[0] === 'pr') {
                        return JSON.stringify({
                            number,
                            state: 'OPEN',
                            headRefOid: head,
                            headRefName: 'agent/test',
                            baseRefName: 'main',
                            baseRefOid: 'b'.repeat(40),
                        });
                    }
                    if (command === 'git' && args.includes('fetch')) {
                        return '';
                    }
                    if (command === 'git' && args[0] === 'config') {
                        return '';
                    }
                    if (command === 'git' && args[0] === 'merge-base') {
                        return 'b'.repeat(40);
                    }
                    if (command === 'gh' && args[0] === 'api' && args.includes('--paginate')) {
                        return '[]';
                    }
                    if (command === 'gh' && args[0] === 'api' && args[1] === 'graphql') {
                        // The approval-thread gate reads the live review state before the
                        // post; this head carries no reviews and no open threads.
                        return JSON.stringify({
                            data: {
                                repository: {
                                    pullRequest: {
                                        id: 'PR_kwDOfixture',
                                        headRefOid: head,
                                        reviews: {
                                            nodes: [],
                                            pageInfo: { hasPreviousPage: false, startCursor: null },
                                        },
                                        reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                                    },
                                },
                            },
                        });
                    }
                    if (command === 'gh' && args[0] === 'api') {
                        throw new Error(failureMessage);
                    }
                    throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
                },
                markRemoteMutationAttempt,
                markDefinitiveNoMutationHttpStatus
            ),
        publish: publishPreparedReview,
    };
    await expect(coordinatePublishReview(number, dependencies)).rejects.toThrow(
        new RegExp(
            `retained exact review-publication owner: pnpm review:publish:recover ${number} --owner [0-9a-f]{40}`
        )
    );
}

function publicationLivenessOwner(
    ownerFence: Extract<Parameters<typeof mutationOwnerFenceIsLive>[0]['ownerFence'], { kind: string }>
) {
    let pid: number;
    if (ownerFence.kind === 'pgid') {
        pid = ownerFence.pgid;
    } else if (ownerFence.kind === 'pid') {
        pid = ownerFence.pid;
    } else {
        pid = ownerFence.rootPid;
    }
    return {
        version: 3 as const,
        pid,
        token: '55555555-5555-4555-8555-555555555555',
        operation: 'review-publication' as const,
        number: 42,
        expectedHead: 'a'.repeat(40),
        payloadDigest: 'b'.repeat(64),
        reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
        ownerFence,
        mutation: { phase: 'prepared' as const, epoch: 1 },
    };
}

function createLegacyRecoveryFixture() {
    const fixture = createJournaledRecoveryFixture();
    const legacyOwnerOid = writePullRequestMutationLockOwner(
        fixture.root,
        { version: 1, pid: 999_999, token: '22222222-2222-4222-8222-222222222222' },
        fixture.number
    );
    runGit(fixture.root, ['update-ref', pullRequestMutationLockRef(fixture.number), legacyOwnerOid]);
    return { ...fixture, ownerOid: legacyOwnerOid };
}

function createTrustedIncidentRecoveryFixture() {
    const incident = legacyReviewPublicationIncidents[0];
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-legacy-review-publication-'));
    runGit(root, ['init']);
    const bundle = join(root, '.agents', 'review-bundles', `${incident.number}-${incident.expectedHead}`);
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, 'review.json'), JSON.stringify(incident.preparedPayload));
    writeFileSync(
        join(bundle, 'diff.patch'),
        [
            'diff --git a/scripts/resolveReviewThread.ts b/scripts/resolveReviewThread.ts',
            '--- a/scripts/resolveReviewThread.ts',
            '+++ b/scripts/resolveReviewThread.ts',
            '@@ -5297 +5297 @@',
            '+review',
            'diff --git a/scripts/__tests__/resolveReviewThread.spec.ts b/scripts/__tests__/resolveReviewThread.spec.ts',
            '--- a/scripts/__tests__/resolveReviewThread.spec.ts',
            '+++ b/scripts/__tests__/resolveReviewThread.spec.ts',
            '@@ -5810 +5810 @@',
            '+review',
        ].join('\n')
    );
    const ownerOid = writePullRequestMutationLockOwner(root, incident.owner, incident.number);
    runGit(root, ['update-ref', pullRequestMutationLockRef(incident.number), ownerOid]);
    return { root, incident, ownerOid };
}

function recoveryDependencies(
    root: string,
    inspect: (expectedHead: string) => {
        state: string;
        head: string;
        reviews: Parameters<typeof exactPublishedReview>[0][];
        otherActorReviews?: Parameters<typeof exactPublishedReview>[0][];
    }
) {
    return {
        primaryRoot: () => root,
        authenticateReviewer: async () => ({
            minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
            session: { configDir: '/tmp/reviewer', env: {}, dispose: () => undefined },
        }),
        repositoryName: () => 'jcosta33/sourdaw',
        inspect: (_number: number, _actorNodeId: string, expectedHead: string) => inspect(expectedHead),
        isOwnerLive: () => false,
        currentOwnerFence: () => ({ kind: 'pid' as const, pid: process.pid, startedAt: 'test-process' }),
    };
}

describe('review publish', () => {
    it('refuses fresh approval when the publication context reader is absent', () => {
        const fixture = fakePort();
        expect(() => publishReview(42, { ...fixture.port, assertApprovalContext: undefined })).toThrow(
            /approval context/
        );
        expect(fixture.posted.review).toBeUndefined();
    });

    it('refuses exported prepared approval without its original context', () => {
        const fixture = fakePort();
        const document = parseReviewDocument({
            format: 'compact-v1',
            event: 'APPROVE',
            body: 'ok',
            evidence: approvalEvidence(),
        });
        expect(() =>
            publishPreparedReview(42, { head: 'headsha', document, payloadDigest: 'unused' }, fixture.port)
        ).toThrow(/approval context/);
        expect(fixture.posted.review).toBeUndefined();
    });

    it('refuses a reviewer approval over unresolved review threads before any remote write', () => {
        const fixture = fakePort({ unresolvedThreads: 2 });
        const journal = vi.fn();
        expect(() =>
            publishReview(42, fixture.port, {
                ownerOid: 'owner',
                journalReviewPublication: journal,
                markRemoteMutationAttempt: vi.fn(),
                markDefinitiveNoMutationHttpStatus: vi.fn(),
                registerSuccessfulCompletion: vi.fn(),
            })
        ).toThrow(/has 2 unresolved review thread\(s\); an approval cannot authorize delivery/u);
        // The refusal lands before the publication journal, so no mutation was
        // attempted and nothing posted (#5436).
        expect(journal).not.toHaveBeenCalled();
        expect(fixture.posted.review).toBeUndefined();
        expect(fixture.calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it('still posts a change request over unresolved review threads', () => {
        const fixture = fakePort({
            unresolvedThreads: 1,
            json: { event: 'REQUEST_CHANGES', body: 'Please fix the merge gate.', comments: [validComment] },
        });

        expect(publishReview(42, fixture.port)).toBe(99);
        expect(fixture.posted.review?.event).toBe('REQUEST_CHANGES');
    });

    it.each(['baseSha', 'baseRefName', 'headSha', 'pr'] as const)(
        'refuses approval context %s drift inside the publication fence',
        (field) => {
            const fixture = fakePort();
            const initial = approvalContext();
            const changed = { ...initial, [field]: field === 'pr' ? 43 : 'changed' };
            const read = vi.fn().mockReturnValueOnce(initial).mockReturnValue(changed);
            const journal = vi.fn();
            expect(() =>
                publishReview(
                    42,
                    { ...fixture.port, assertApprovalContext: read },
                    {
                        ownerOid: 'owner',
                        journalReviewPublication: journal,
                        markRemoteMutationAttempt: vi.fn(),
                        markDefinitiveNoMutationHttpStatus: vi.fn(),
                        registerSuccessfulCompletion: vi.fn(),
                    }
                )
            ).toThrow(/approval context/);
            expect(read).toHaveBeenCalledTimes(2);
            expect(journal).not.toHaveBeenCalled();
            expect(fixture.posted.review).toBeUndefined();
        }
    );

    it('allows REQUEST_CHANGES without approval context on a dependent base', () => {
        const fixture = fakePort({
            json: { event: 'REQUEST_CHANGES', body: 'Fix the defect.', comments: [validComment] },
        });
        publishReview(42, { ...fixture.port, assertApprovalContext: undefined });
        expect(fixture.posted.review?.event).toBe('REQUEST_CHANGES');
    });
    it('compact approval publishes the document body verbatim with no evidence footer', () => {
        const evidence = approvalEvidence();
        const { port, posted } = fakePort({
            json: { format: 'compact-v1', event: 'APPROVE', body: 'Attacked; held.', comments: [], evidence },
        });
        publishReview(42, port);
        expect(posted.review?.body).toBe('Attacked; held.');
        expect(posted.review?.body).not.toMatch(/Evidence SHA-256/);

        // A body with surrounding whitespace must post byte for byte: `parseReviewDocument`
        // rejects only a blank body, so trimming here would silently alter what GitHub stores.
        const whitespaceBody = 'Attacked; held.\n';
        const { port: whitespacePort, posted: whitespacePosted } = fakePort({
            json: { format: 'compact-v1', event: 'APPROVE', body: whitespaceBody, comments: [], evidence },
        });
        publishReview(42, whitespacePort);
        expect(whitespacePosted.review?.body).toBe(whitespaceBody);
    });

    it.each(['reviewer', 'acceptance'])('preserves legacy %s payload bytes with and without evidence', (role) => {
        for (const evidence of [undefined, approvalEvidence()]) {
            const raw = {
                event: 'APPROVE',
                body: 'Historical summary.\n',
                comments: [],
                ...(evidence === undefined ? {} : { evidence }),
            };
            const document = role === 'acceptance' ? parseAcceptanceDocument(raw) : parseReviewDocument(raw);
            const attribution = role === 'acceptance' ? 'Orchestrator acceptance on behalf of jcosta33\n\n' : '';
            const appendix =
                evidence === undefined
                    ? ''
                    : '\n\nVerification for headsha\n\nExpected: Missing evidence prevents posting\nCheck: pnpm test:run scripts/__tests__/publishReview.spec.ts\nObserved: Missing evidence: no POST and no journal';
            const expectedBody = `${attribution}Historical summary.\n${appendix}`;
            const expectedPayload = JSON.stringify({
                commit_id: 'headsha',
                event: 'APPROVE',
                body: expectedBody,
                comments: [],
            });
            expect(renderReviewDocumentBody(document)).toBe(expectedBody);
            expect(reviewPublicationPayload({ commitId: 'headsha', ...document })).toBe(expectedPayload);
            expect(reviewPublicationPayloadDigest(expectedPayload)).toBe(
                createHash('sha256').update(expectedPayload).digest('hex')
            );
            expect(role === 'acceptance' ? parseAcceptanceDocument(document) : parseReviewDocument(document)).toEqual(
                document
            );
        }
    });

    it.each([undefined, 'future-v2', null])(
        'refuses noncompact fresh approval format %s through both routes',
        (format) => {
            const raw = {
                ...(format === undefined ? {} : { format }),
                event: 'APPROVE' as const,
                body: 'ok',
                comments: [],
                evidence: approvalEvidence(),
            };
            const fixture = fakePort({ json: raw });
            const journal = vi.fn();
            const boundary = {
                ownerOid: 'owner',
                journalReviewPublication: journal,
                markRemoteMutationAttempt: vi.fn(),
                markDefinitiveNoMutationHttpStatus: vi.fn(),
                registerSuccessfulCompletion: vi.fn(),
            };
            expect(() => publishReview(42, fixture.port, boundary)).toThrow(/format/);
            if (format === undefined) {
                expect(() =>
                    publishPreparedReview(
                        42,
                        { head: 'headsha', document: parseReviewDocument(raw), payloadDigest: 'unused' },
                        fixture.port,
                        boundary
                    )
                ).toThrow(/format/);
            } else {
                expect(() => parseReviewDocument(raw)).toThrow(/format/);
            }
            expect(journal).not.toHaveBeenCalled();
            expect(fixture.posted.review).toBeUndefined();
        }
    );

    it.each([600, 601])(
        'enforces the complete compact public body at %i Unicode code points on both routes',
        (length) => {
            const document = parseReviewDocument({
                format: 'compact-v1',
                event: 'APPROVE',
                body: '🎵'.repeat(length),
                evidence: approvalEvidence(),
            });
            for (const prepared of [false, true]) {
                const fixture = fakePort({ json: document });
                const journal = vi.fn();
                const boundary = {
                    ownerOid: 'owner',
                    journalReviewPublication: journal,
                    markRemoteMutationAttempt: vi.fn(),
                    markDefinitiveNoMutationHttpStatus: vi.fn(),
                    registerSuccessfulCompletion: vi.fn(),
                };
                const body = approvalBody(document.body);
                const publish = () => {
                    if (prepared) {
                        return publishPreparedReview(
                            42,
                            {
                                head: 'headsha',
                                approvalContext: approvalContext(),
                                document,
                                payloadDigest: reviewPublicationPayloadDigest(
                                    reviewPublicationPayload({ commitId: 'headsha', ...document, body })
                                ),
                            },
                            fixture.port,
                            boundary
                        );
                    }
                    return publishReview(42, fixture.port, boundary);
                };
                if (length === 600) {
                    publish();
                    expect(fixture.posted.review?.body).toBe(body);
                    expect([...body]).toHaveLength(600);
                } else {
                    expect(publish).toThrow('601 Unicode code points; maximum is 600');
                    expect(journal).not.toHaveBeenCalled();
                    expect(fixture.posted.review).toBeUndefined();
                }
            }
        }
    );

    it('canonicalizes evidence keys while preserving claim order', () => {
        // Rendering no longer folds evidence into the posted body (no digest), so this
        // exercises `parseApprovalEvidence`'s canonicalization and order-preservation
        // directly against the parsed document's `evidence`, not through the rendered body.
        const claim = approvalEvidence().claims[0];
        if (claim === undefined) {
            throw new Error('missing claim');
        }
        const raw = {
            format: 'compact-v1',
            event: 'APPROVE',
            body: 'ok',
            evidence: {
                claims: [
                    {
                        observed: claim.observed,
                        verification: claim.verification,
                        observable: claim.observable,
                        ignored: 'extra',
                    },
                ],
                headSha: 'headsha',
                ignored: 'extra',
            },
        };
        expect(parseReviewDocument(raw).evidence).toEqual({ headSha: 'headsha', claims: [claim] });
        const second = { observable: 'Other risk', verification: 'Other check', observed: 'Held' };
        const firstOrder = parseReviewDocument({ ...raw, evidence: { headSha: 'headsha', claims: [claim, second] } });
        const reverseOrder = parseReviewDocument({ ...raw, evidence: { headSha: 'headsha', claims: [second, claim] } });
        expect(firstOrder.evidence?.claims).toEqual([claim, second]);
        expect(reverseOrder.evidence?.claims).toEqual([second, claim]);
    });

    it.each([
        undefined,
        null,
        {},
        { headSha: 'old', claims: approvalEvidence().claims },
        { headSha: 'headsha', claims: [] },
        { headSha: 'headsha', claims: [{ observable: ' ', verification: 'check', observed: 'result' }] },
        { headSha: 'headsha', claims: [{ observable: 'expected', verification: 'check\nnext', observed: 'result' }] },
        { headSha: 'headsha', claims: [{ observable: 'expected', verification: 'check', observed: 1 }] },
    ])('approval evidence rejects invalid or stale record %j before mutation', (evidence) => {
        const { port, posted } = fakePort({ json: { format: 'compact-v1', event: 'APPROVE', body: 'ok', evidence } });
        const journal = vi.fn();
        const boundary = {
            ownerOid: 'owner',
            journalReviewPublication: journal,
            markRemoteMutationAttempt: vi.fn(),
            markDefinitiveNoMutationHttpStatus: vi.fn(),
            registerSuccessfulCompletion: vi.fn(),
        };
        expect(() => publishReview(42, port, boundary)).toThrow(/evidence/);
        expect(journal).not.toHaveBeenCalled();
        expect(posted.review).toBeUndefined();
    });

    it('approval evidence is required by the exported prepared publication route', () => {
        const { port, posted } = fakePort();
        expect(() =>
            publishPreparedReview(
                42,
                { head: 'headsha', document: { event: 'APPROVE', body: 'ok', comments: [] }, payloadDigest: 'unused' },
                port
            )
        ).toThrow(/evidence/);
        expect(posted.review).toBeUndefined();
    });

    it('approval evidence renders into the journaled payload and reparses without duplication', () => {
        const raw = { format: 'compact-v1', event: 'APPROVE', body: 'ok', evidence: approvalEvidence() };
        const { port, posted } = fakePort({ json: raw });
        const journal = vi.fn();
        publishReview(42, port, {
            ownerOid: 'owner',
            journalReviewPublication: journal,
            markRemoteMutationAttempt: vi.fn(),
            markDefinitiveNoMutationHttpStatus: vi.fn(),
            registerSuccessfulCompletion: vi.fn(),
        });
        expect(posted.review?.body).toBe(approvalBody());
        if (posted.review === undefined) {
            throw new Error('missing post');
        }
        expect(journal).toHaveBeenCalledWith({
            expectedHead: 'headsha',
            reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
            payloadDigest: reviewPublicationPayloadDigest(reviewPublicationPayload(posted.review)),
        });
        const parsed = parseReviewDocument(raw);
        expect(parseReviewDocument(parsed)).toEqual(parsed);
    });

    it('approval evidence alteration after preparation does not move the prepared digest', () => {
        // `payloadDigest` binds `commit_id`/`event`/`body`/`comments` — the literal bytes
        // `postReview` sends to GitHub — never evidence. Since the posted body no longer folds
        // evidence into a digest, altering an evidence claim between preparation and posting is
        // no longer caught here; `assertPublicationEvidence`'s headSha binding is unaffected.
        const document = parseReviewDocument({
            format: 'compact-v1',
            event: 'APPROVE',
            body: 'ok',
            evidence: approvalEvidence(),
        });
        const payloadDigest = reviewPublicationPayloadDigest(
            reviewPublicationPayload({ commitId: 'headsha', ...document, body: renderReviewDocumentBody(document) })
        );
        const claim = document.evidence?.claims[0];
        if (claim === undefined) {
            throw new Error('missing evidence claim');
        }
        claim.observable = 'Altered after preparation';
        const { port, posted } = fakePort();
        const journal = vi.fn();
        expect(
            publishPreparedReview(
                42,
                { head: 'headsha', document, payloadDigest, approvalContext: approvalContext() },
                port,
                {
                    ownerOid: 'owner',
                    journalReviewPublication: journal,
                    markRemoteMutationAttempt: vi.fn(),
                    markDefinitiveNoMutationHttpStatus: vi.fn(),
                    registerSuccessfulCompletion: vi.fn(),
                }
            )
        ).toBe(99);
        expect(journal).toHaveBeenCalled();
        expect(posted.review?.body).toBe('ok');
    });

    it('approval evidence preserves legacy parse bytes and rejects blocker assertions', () => {
        const legacy = { event: 'APPROVE', body: 'Historical summary.\n', comments: [] };
        expect(JSON.stringify(parseReviewDocument(legacy))).toBe(JSON.stringify(legacy));
        expect(() =>
            parseReviewDocument({
                event: 'REQUEST_CHANGES',
                body: 'Fix',
                comments: [validComment],
                evidence: approvalEvidence(),
            })
        ).toThrow(/evidence/);
    });

    it.each([undefined, 'observable', 'verification', 'observed'] as const)(
        'recovery replay renders a compact document without the footer, evidence-only bundle edit=%s',
        async (alteredEvidenceField) => {
            // The rendered/posted body no longer folds evidence into a digest, so a bundle-file
            // edit confined to evidence content (never the body GitHub actually stores) no longer
            // moves the recovery digest: recovery still matches the retained lock and replays the
            // bare conclusion. This is the accepted consequence of dropping the footer — the
            // `payloadDigest` binds only `commit_id`/`event`/`body`/`comments`, the literal bytes
            // `postReview` sends to GitHub, and evidence tampering is no longer detectable through
            // it. `assertPublicationEvidence`'s headSha binding is unaffected and unchanged.
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-approval-evidence-recovery-'));
            const head = 'a'.repeat(40);
            const number = 42;
            runGit(root, ['init']);
            const restorePs = writeTrustedPsFixture(root);
            try {
                await runFailingReviewPublication(root, number, head, 'socket hang up');
                const ownerOid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
                if (ownerOid === undefined) {
                    throw new Error('missing publication owner');
                }
                if (alteredEvidenceField) {
                    const evidence = approvalEvidence(head);
                    const claim = evidence.claims[0];
                    if (claim === undefined) {
                        throw new Error('missing evidence claim');
                    }
                    claim[alteredEvidenceField] = 'Changed result';
                    writeFileSync(
                        join(root, '.agents', 'review-bundles', `${number}-${head}`, 'review.json'),
                        JSON.stringify({
                            format: 'compact-v1',
                            event: 'APPROVE',
                            body: 'Attacked; held.',
                            comments: [],
                            evidence,
                        })
                    );
                }
                // The body actually posted to GitHub: the bare conclusion, no `Evidence SHA-256` line.
                const postedBody = approvalBody('Attacked; held.');
                const inspect = vi.fn(() => ({
                    state: 'OPEN',
                    head,
                    reviews: [
                        {
                            id: 99,
                            state: 'APPROVED',
                            body: postedBody,
                            commitId: head,
                            actorNodeId: REVIEWER_BOT_NODE_ID,
                            comments: [],
                        },
                    ],
                }));
                await expect(
                    runRecoverPublishReviewLockCli(
                        [String(number), '--owner', ownerOid],
                        recoveryDependencies(root, inspect)
                    )
                ).resolves.toBe(0);
                expect(inspect).toHaveBeenCalledTimes(2);
                expect(
                    readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number)
                ).toBeUndefined();
            } finally {
                restorePs();
                removeTemporaryDirectory(root);
            }
        }
    );

    it('holds the per-PR mutation fence across head validation and review creation', async () => {
        expect(defaultPublishReviewCoordinatorDependencies().serializeMutation).toBe(
            withPullRequestReviewPublicationMutationLock
        );
        const { port } = fakePort();
        const calls: string[] = [];
        const fencedPort: PublishReviewPort = {
            ...port,
            pullRequest: (number) => {
                calls.push('pull-request');
                return port.pullRequest(number);
            },
            postReview: (review) => {
                calls.push('post');
                return port.postReview(review);
            },
        };
        const dependencies: PublishReviewCoordinatorDependencies = {
            primaryRoot: () => '/repo',
            serializeMutation: async (_primaryRoot, number, operation, options) => {
                calls.push(`lock:${number}:acquire`);
                expect(options).toEqual({
                    reviewPublication: {
                        expectedHead: 'headsha',
                        payloadDigest: reviewPublicationPayloadDigest(
                            reviewPublicationPayload({
                                commitId: 'headsha',
                                event: 'APPROVE',
                                body: approvalBody(),
                                comments: [],
                            })
                        ),
                        reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
                        ownerFence: expect.any(Function),
                    },
                });
                try {
                    return await operation({
                        ownerOid: 'f'.repeat(40),
                        markRemoteMutationAttempt: () => calls.push('attempt'),
                        markDefinitiveNoMutationHttpStatus: () => undefined,
                        journalReviewPublication: () => calls.push('journal'),
                        registerSuccessfulCompletion: () => undefined,
                    });
                } finally {
                    calls.push(`lock:${number}:release`);
                }
            },
            authenticateReviewer: async () => {
                calls.push('authenticate');
                return {
                    minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                    session: {
                        configDir: '/tmp/sourdaw-reviewer',
                        env: {},
                        dispose: () => calls.push('dispose'),
                    },
                };
            },
            repositoryName: () => {
                calls.push('repository');
                return 'jcosta33/sourdaw';
            },
            reviewPort: (_session, _primaryRoot, markRemoteMutationAttempt) => ({
                ...fencedPort,
                postReview: (review) => {
                    markRemoteMutationAttempt();
                    return fencedPort.postReview(review);
                },
            }),
            publish: publishPreparedReview,
        };

        await coordinatePublishReview(42, dependencies);

        expect(calls).toEqual([
            'authenticate',
            'repository',
            'pull-request',
            'lock:42:acquire',
            'pull-request',
            'journal',
            'attempt',
            'post',
            'lock:42:release',
            'dispose',
        ]);
    });

    it('does not acquire a publication lock when immutable bundle preflight fails', async () => {
        const { port } = fakePort({ missing: true });
        let acquired = false;
        const dependencies: PublishReviewCoordinatorDependencies = {
            primaryRoot: () => '/repo',
            serializeMutation: async () => {
                acquired = true;
                throw new Error('lock must not be acquired');
            },
            authenticateReviewer: async () => ({
                minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                session: { configDir: '/tmp/sourdaw-reviewer', env: {}, dispose: () => undefined },
            }),
            repositoryName: () => 'jcosta33/sourdaw',
            reviewPort: () => port,
            publish: publishPreparedReview,
        };

        await expect(coordinatePublishReview(42, dependencies)).rejects.toThrow(/missing review\.json/);
        expect(acquired).toBe(false);
    });

    it('refuses a reviewer approval over unresolved threads on the production coordinator route', async () => {
        // The gate lives in the publication preflight every route takes, so the
        // real command path — coordinate to publishPreparedReview — refuses
        // before the lock is acquired, nothing is journaled, and nothing posts
        // (#5436).
        const fixture = fakePort({ unresolvedThreads: 2 });
        let acquired = false;
        const dependencies: PublishReviewCoordinatorDependencies = {
            primaryRoot: () => '/repo',
            serializeMutation: async () => {
                acquired = true;
                throw new Error('lock must not be acquired');
            },
            authenticateReviewer: async () => ({
                minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                session: { configDir: '/tmp/sourdaw-reviewer', env: {}, dispose: () => undefined },
            }),
            repositoryName: () => 'jcosta33/sourdaw',
            reviewPort: () => fixture.port,
            publish: publishPreparedReview,
        };

        await expect(coordinatePublishReview(42, dependencies)).rejects.toThrow(
            /has 2 unresolved review thread\(s\); an approval cannot authorize delivery/u
        );
        expect(acquired).toBe(false);
        expect(fixture.posted.review).toBeUndefined();
        expect(fixture.calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it.each([
        ['closes', { state: 'CLOSED', head: 'headsha' }],
        ['moves', { state: 'OPEN', head: 'moved-head' }],
    ])(
        'does not journal or attempt a review when the pull request %s after preflight',
        async (_label, lockedPullRequest) => {
            const { port } = fakePort();
            const calls: string[] = [];
            let reads = 0;
            const dependencies: PublishReviewCoordinatorDependencies = {
                primaryRoot: () => '/repo',
                serializeMutation: async (_primaryRoot, _number, operation) =>
                    operation({
                        ownerOid: 'f'.repeat(40),
                        journalReviewPublication: () => calls.push('journal'),
                        markRemoteMutationAttempt: () => calls.push('attempt'),
                        markDefinitiveNoMutationHttpStatus: () => undefined,
                        registerSuccessfulCompletion: () => undefined,
                    }),
                authenticateReviewer: async () => ({
                    minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                    session: { configDir: '/tmp/reviewer', env: {}, dispose: () => undefined },
                }),
                repositoryName: () => 'jcosta33/sourdaw',
                reviewPort: () => ({
                    ...port,
                    pullRequest: (number) => {
                        reads += 1;
                        return reads === 1 ? port.pullRequest(number) : lockedPullRequest;
                    },
                    postReview: () => {
                        calls.push('post');
                        throw new Error('must not post');
                    },
                }),
                publish: publishPreparedReview,
            };

            await expect(coordinatePublishReview(42, dependencies)).rejects.toThrow(/refusing to post|head moved/);
            expect(calls).toEqual([]);
        }
    );

    it('reports the exact retained owner and recovery command after an ordinary review POST HTTP 422', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-post-failure-'));
        const number = 3344;
        const executable = join(root, 'ps');
        const previous = process.env.SOURDAW_TRUSTED_PS_PATH;
        let ownerAtPost: { oid: string; owner: Extract<PullRequestMutationLockOwner, { version: 3 }> } | undefined;
        try {
            runGit(root, ['init']);
            writeFileSync(
                executable,
                '#!/bin/sh\nif [ "$2" = "pgid=" ]; then printf "%s\\n" "$4"; else printf "%s\\n" "publication-process-start"; fi\n'
            );
            chmodSync(executable, 0o700);
            process.env.SOURDAW_TRUSTED_PS_PATH = executable;
            const dependencies: PublishReviewCoordinatorDependencies = {
                primaryRoot: () => root,
                serializeMutation: withPullRequestReviewPublicationMutationLock,
                authenticateReviewer: async () => ({
                    minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                    session: { configDir: '/tmp/reviewer', env: {}, dispose: () => undefined },
                }),
                repositoryName: () => 'jcosta33/sourdaw',
                reviewPort: (_session, _primaryRoot, markRemoteMutationAttempt) => ({
                    primaryRoot: () => root,
                    assertApprovalContext: (number, head) => approvalContext(head, number),
                    pullRequest: () => ({ state: 'OPEN', head: 'a'.repeat(40) }),
                    readReviewJson: (path) => {
                        if (path.endsWith('/risk-plan.json')) {
                            throw new Error('ENOENT');
                        }
                        return {
                            format: 'compact-v1',
                            event: 'APPROVE',
                            body: 'Attacked; held.',
                            comments: [],
                            evidence: approvalEvidence('a'.repeat(40)),
                            reviewerModel: 'glm-5.3-flash',
                        };
                    },
                    bundleFileExists: (path) => existsSync(path),
                    readBundleDiff: () => '',
                    publicReviews: () => [],
                    publicReviewComments: () => [],
                    reviewState: () => ({
                        latestReviewerStateOnHead: null,
                        latestReviewerReviewDatabaseId: null,
                        unresolvedThreads: 0,
                    }),
                    postReview: () => {
                        const oid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
                        if (oid === undefined) {
                            throw new Error('publication lock was not acquired before POST');
                        }
                        const owner = readPullRequestMutationLockOwner(root, oid, number);
                        if (owner.version !== 3) {
                            throw new Error('publication lock was not journaled before POST');
                        }
                        ownerAtPost = { oid, owner };
                        markRemoteMutationAttempt();
                        throw new Error('create review failed: HTTP 422');
                    },
                    applyApprovalLabel: () => expect.fail('no label without a standing review'),
                    removeApprovalLabel: () => expect.fail('no label without a standing review'),
                    log: () => undefined,
                }),
                publish: publishPreparedReview,
            };

            await expect(coordinatePublishReview(number, dependencies)).rejects.toThrow(
                /create review failed: HTTP 422; retained exact review-publication owner: pnpm review:publish:recover 3344 --owner [0-9a-f]{40}/
            );
            const retainedOid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
            expect(retainedOid).toMatch(/^[0-9a-f]{40}$/);
            expect(ownerAtPost).toEqual({
                oid: expect.stringMatching(/^[0-9a-f]{40}$/),
                owner: {
                    version: 3,
                    pid: process.pid,
                    token: expect.stringMatching(/^[0-9a-f-]{36}$/),
                    operation: 'review-publication',
                    number,
                    expectedHead: 'a'.repeat(40),
                    payloadDigest: reviewPublicationPayloadDigest(
                        reviewPublicationPayload({
                            commitId: 'a'.repeat(40),
                            event: 'APPROVE',
                            body: approvalBody('Attacked; held.'),
                            comments: [],
                        })
                    ),
                    reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
                    ownerFence: {
                        kind: 'pgid',
                        pgid: process.pid,
                        leaderStartedAt: 'publication-process-start',
                    },
                    mutation: { phase: 'prepared', epoch: 0 },
                },
            });
            expect(retainedOid).not.toBe(ownerAtPost?.oid);
            await expect(coordinatePublishReview(number, dependencies)).rejects.toThrow(
                new RegExp(`--owner ${retainedOid}`)
            );
        } finally {
            if (previous === undefined) {
                delete process.env.SOURDAW_TRUSTED_PS_PATH;
            } else {
                process.env.SOURDAW_TRUSTED_PS_PATH = previous;
            }
            removeTemporaryDirectory(root);
        }
    });

    it.each([
        ['expected head', (_head: string, digest: string, actor: string) => ['b'.repeat(40), digest, actor]],
        ['payload digest', (head: string, _digest: string, actor: string) => [head, 'c'.repeat(64), actor]],
        ['reviewer actor', (head: string, digest: string, _actor: string) => [head, digest, 'other-actor']],
    ])('refuses a publication lock whose acquired %s is not the prepared payload', async (_label, mutate) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-bound-owner-'));
        const number = 42;
        const executable = join(root, 'ps');
        const previous = process.env.SOURDAW_TRUSTED_PS_PATH;
        const expectedHead = 'a'.repeat(40);
        const expectedDigest = reviewPublicationPayloadDigest(
            reviewPublicationPayload({
                commitId: expectedHead,
                event: 'APPROVE',
                body: 'Attacked; held.',
                comments: [],
            })
        );
        try {
            runGit(root, ['init']);
            writeFileSync(
                executable,
                '#!/bin/sh\nif [ "$2" = "pgid=" ]; then printf "%s\\n" "$4"; else printf "%s\\n" "publication-process-start"; fi\n'
            );
            chmodSync(executable, 0o700);
            process.env.SOURDAW_TRUSTED_PS_PATH = executable;
            const [expectedHeadAtLock, digestAtLock, actorAtLock] = mutate(
                expectedHead,
                expectedDigest,
                REVIEWER_BOT_NODE_ID
            );
            if (expectedHeadAtLock === undefined || digestAtLock === undefined || actorAtLock === undefined) {
                throw new Error('publication lock test fixture is incomplete');
            }
            await expect(
                withPullRequestReviewPublicationMutationLock(
                    root,
                    number,
                    async (boundary) => {
                        boundary.journalReviewPublication({
                            expectedHead,
                            payloadDigest: expectedDigest,
                            reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
                        });
                    },
                    {
                        reviewPublication: {
                            expectedHead: expectedHeadAtLock,
                            payloadDigest: digestAtLock,
                            reviewerActorNodeId: actorAtLock,
                            ownerFence: currentMutationOwnerFence,
                        },
                    }
                )
            ).rejects.toThrow(/does not match the prepared payload/);
            expect(readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number)).toBeUndefined();
        } finally {
            if (previous === undefined) {
                delete process.env.SOURDAW_TRUSTED_PS_PATH;
            } else {
                process.env.SOURDAW_TRUSTED_PS_PATH = previous;
            }
            removeTemporaryDirectory(root);
        }
    });

    it('forwards the exact valid CLI pull-request number to the live coordinator', async () => {
        const { port } = fakePort();
        const forwarded: number[] = [];
        const dependencies: PublishReviewCoordinatorDependencies = {
            primaryRoot: () => '/repo',
            serializeMutation: async (_primaryRoot, _number, operation) =>
                operation({
                    ownerOid: 'f'.repeat(40),
                    markRemoteMutationAttempt: () => undefined,
                    markDefinitiveNoMutationHttpStatus: () => undefined,
                    journalReviewPublication: () => undefined,
                    registerSuccessfulCompletion: () => undefined,
                }),
            authenticateReviewer: async () => ({
                minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                session: { configDir: '/tmp/sourdaw-reviewer', env: {}, dispose: () => undefined },
            }),
            repositoryName: () => 'jcosta33/sourdaw',
            reviewPort: () => port,
            publish: (number) => {
                forwarded.push(number);
                return 99;
            },
        };

        await expect(runPublishReviewCli(['7819'], dependencies)).resolves.toBe(0);

        expect(forwarded).toEqual([7819]);
    });

    it('posts as the reviewer bot on the bundle head and prints the review id', () => {
        const { port, calls, logs } = fakePort();

        expect(publishReview(42, port)).toBe(99);
        expect(calls[0]).toBe('read:/repo/.agents/review-bundles/42-headsha/review.json');
        expect(calls[1]).toBe(`post:headsha:APPROVE:${approvalBody()}`);
        expect(logs.at(-1)).toBe('99');
    });

    it('leaves the CI approval label to the coordinator, outside the publication lock', () => {
        const { port, labelWrites } = fakePort();

        publishReview(42, port);

        expect(labelWrites).toEqual([]);
    });

    it('posts REQUEST_CHANGES body and comments when valid', () => {
        const { port, calls, posted } = fakePort({
            json: { event: 'REQUEST_CHANGES', body: 'Please fix the merge gate.', comments: [validComment] },
        });

        publishReview(42, port);

        expect(calls[1]).toContain('REQUEST_CHANGES:Please fix the merge gate.');
        // The recorded call string above never carries the comments array, so it cannot prove the
        // parsed document's comments actually reached postReview — only the captured argument can.
        // This must go red if `publishReview` ever forwards an empty or substituted comments array.
        expect(posted.review?.comments).toEqual([validComment]);
    });

    it('refuses a fresh review document without reviewerModel', () => {
        const { port, calls } = fakePort({
            json: {
                format: 'compact-v1',
                event: 'APPROVE',
                body: 'ok',
                comments: [],
                evidence: approvalEvidence(),
                reviewerModel: undefined,
            },
        });

        expect(() => publishReview(42, port)).toThrow(/review\.json must carry reviewerModel/u);
        expect(calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it('refuses a review whose reviewer model matches the PR authoring-model label', () => {
        const { port, calls } = fakePort({
            labels: [
                { name: 'enhancement', description: 'New feature or request' },
                { name: 'glm-5.3-flash', description: 'Authored by glm-5.3-flash' },
            ],
        });

        expect(() => publishReview(42, port)).toThrow(/matches one of the PR's authoring models/u);
        expect(calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it('posts when the reviewer model differs from the PR authoring-model label', () => {
        const { port, calls } = fakePort({
            labels: [
                { name: 'enhancement', description: 'New feature or request' },
                { name: 'claude-opus-4.5', description: 'Authored by claude-opus-4.5' },
            ],
        });

        expect(publishReview(42, port)).toBe(99);
        expect(calls[1]).toBe(`post:headsha:APPROVE:${approvalBody()}`);
    });

    it('posts the same-model fallback through the publish path when exhaustion is recorded', () => {
        const { port, calls } = fakePort({
            labels: [{ name: 'glm-5.3', description: 'Authored by glm-5.3' }],
            json: {
                format: 'compact-v1',
                event: 'APPROVE',
                body: 'Same-model fallback: reviewed on glm-5.3 after every other harness was unavailable.',
                comments: [],
                evidence: approvalEvidence(),
                reviewerModel: 'glm-5.3',
                modelExhaustion: 'every other harness on this machine is logged out or broken',
            },
        });

        expect(publishReview(42, port)).toBe(99);
        expect(calls[1]).toContain(
            'APPROVE:Same-model fallback: reviewed on glm-5.3 after every other harness was unavailable.'
        );
    });

    it('refuses the same-model fallback on the publish path when the body does not name the model', () => {
        const { port, calls } = fakePort({
            labels: [{ name: 'glm-5.3', description: 'Authored by glm-5.3' }],
            json: {
                format: 'compact-v1',
                event: 'APPROVE',
                body: 'The change held under attack.',
                comments: [],
                evidence: approvalEvidence(),
                reviewerModel: 'glm-5.3',
                modelExhaustion: 'every other harness on this machine is logged out or broken',
            },
        });

        expect(() => publishReview(42, port)).toThrow(/naming the reviewer model/u);
        expect(calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it('refuses the same-model fallback when the body names only the longer prefix-sharing model', () => {
        const { port, calls } = fakePort({
            labels: [{ name: 'glm-5.3', description: 'Authored by glm-5.3' }],
            json: {
                format: 'compact-v1',
                event: 'APPROVE',
                body: 'Reviewed on glm-5.3-flash under the same-model fallback.',
                comments: [],
                evidence: approvalEvidence(),
                reviewerModel: 'glm-5.3',
                modelExhaustion: 'every other harness on this machine is logged out or broken',
            },
        });

        expect(() => publishReview(42, port)).toThrow(/naming the reviewer model/u);
        expect(calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it('treats a bare label name as descriptive, never as the authoring model', () => {
        // A descriptive label that merely shares a model's name carries no `Authored by `
        // description fence, so it must not trigger the diversity refusal.
        const { port } = fakePort({ labels: [{ name: 'glm-5.3-flash' }] });

        expect(publishReview(42, port)).toBe(99);
    });

    it('refuses an inline comment outside the prepared head diff before posting', () => {
        const { port, calls } = fakePort({
            json: {
                event: 'REQUEST_CHANGES',
                body: 'Please fix the merge gate.',
                comments: [{ ...validComment, line: 11 }],
            },
        });

        expect(() => publishReview(42, port)).toThrow(/comments\[0\].*scripts\/deliverPullRequest\.ts.*11.*diff/i);
        expect(calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it.each([
        [
            'deleted LEFT path',
            'deleted.ts',
            'LEFT',
            3,
            ['--- a/deleted.ts', '+++ /dev/null', '@@ -3 +0,0 @@', '-gone'].join('\n'),
        ],
        [
            'added RIGHT path',
            'added.ts',
            'RIGHT',
            5,
            ['--- /dev/null', '+++ b/added.ts', '@@ -0,0 +5 @@', '+new'].join('\n'),
        ],
        [
            'renamed LEFT old path',
            'old.ts',
            'LEFT',
            7,
            ['--- a/old.ts', '+++ b/new.ts', '@@ -7 +7 @@', '-old', '+new'].join('\n'),
        ],
        [
            'renamed RIGHT new path',
            'new.ts',
            'RIGHT',
            7,
            ['--- a/old.ts', '+++ b/new.ts', '@@ -7 +7 @@', '-old', '+new'].join('\n'),
        ],
    ] as const)('accepts %s', (_label, path, side, line, diff) => {
        const { port, calls } = fakePort({
            diff,
            json: {
                event: 'REQUEST_CHANGES',
                body: 'Fix the changed line.',
                comments: [{ ...validComment, path, side, line }],
            },
        });

        publishReview(42, port);

        expect(calls.some((call) => call.startsWith('post:'))).toBe(true);
    });

    const contextHunkDiff = [
        '--- a/context.ts',
        '+++ b/context.ts',
        '@@ -10,3 +10,3 @@',
        ' before',
        '-old',
        '+new',
        ' after',
    ].join('\n');

    // GitHub renders unchanged lines inside a hunk and accepts comments on them from both sides,
    // so preflight must record hunk context lines as commentable, not only advance past them.
    it.each([
        ['RIGHT', 10],
        ['LEFT', 10],
        ['RIGHT', 12],
        ['LEFT', 12],
    ] as const)('accepts an inline comment on an in-hunk context line (%s %s)', (side, line) => {
        const { port, calls } = fakePort({
            diff: contextHunkDiff,
            json: {
                event: 'REQUEST_CHANGES',
                body: 'Fix the context line.',
                comments: [{ ...validComment, path: 'context.ts', side, line }],
            },
        });

        publishReview(42, port);

        expect(calls.some((call) => call.startsWith('post:'))).toBe(true);
    });

    it.each([
        ['RIGHT', 9],
        ['LEFT', 9],
        ['RIGHT', 13],
        ['LEFT', 13],
    ] as const)('refuses an inline comment outside any hunk (%s %s)', (side, line) => {
        const { port, calls } = fakePort({
            diff: contextHunkDiff,
            json: {
                event: 'REQUEST_CHANGES',
                body: 'Fix the context line.',
                comments: [{ ...validComment, path: 'context.ts', side, line }],
            },
        });

        expect(() => publishReview(42, port)).toThrow(/not a changed line/i);
        expect(calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it.each(['space name.ts', 'tab\tname.ts', 'control\u0001name.ts', 'café.ts', 'quote"name.ts', 'back\\slash.ts'])(
        'accepts a real Git diff path containing %j',
        (path) => {
            const { port, calls } = fakePort({
                diff: actualGitDiffForPath(path),
                json: {
                    event: 'REQUEST_CHANGES',
                    body: 'Fix the changed line.',
                    comments: [{ ...validComment, path, side: 'RIGHT', line: 1 }],
                },
            });

            publishReview(42, port);

            expect(calls.some((call) => call.startsWith('post:'))).toBe(true);
        }
    );

    it('strips unquoted Git diff header metadata after a tab', () => {
        const { port, calls } = fakePort({
            diff: [
                '--- a/old name.ts\t2026-09-02 00:00:00 +0000',
                '+++ b/new name.ts\t2026-09-02 00:00:00 +0000',
                '@@ -1 +1 @@',
                '-before',
                '+after',
            ].join('\n'),
            json: {
                event: 'REQUEST_CHANGES',
                body: 'Fix the changed line.',
                comments: [{ ...validComment, path: 'new name.ts', side: 'RIGHT', line: 1 }],
            },
        });

        publishReview(42, port);

        expect(calls.some((call) => call.startsWith('post:'))).toBe(true);
    });

    it.each([
        ['unterminated quoted path', ['--- a/old.ts', '+++ "b/new.ts', '@@ -1 +1 @@', '+after'].join('\n')],
        ['malformed quoted escape', ['--- a/old.ts', '+++ "b/\\999"', '@@ -1 +1 @@', '+after'].join('\n')],
        ['unsafe traversal', ['--- a/old.ts', '+++ "b/../new.ts"', '@@ -1 +1 @@', '+after'].join('\n')],
    ])('rejects a %s in a Git diff header', (_label, diff) => {
        const { port } = fakePort({
            diff,
            json: {
                event: 'REQUEST_CHANGES',
                body: 'Fix the changed line.',
                comments: [{ ...validComment, path: 'new.ts', side: 'RIGHT', line: 1 }],
            },
        });

        expect(() => publishReview(42, port)).toThrow(/not a changed line/i);
    });

    it.each([
        [
            'two SQL deletion lines beginning with --',
            'LEFT',
            [
                'diff --git a/schema.sql b/schema.sql',
                '--- a/schema.sql',
                '+++ b/schema.sql',
                '@@ -10,2 +10,0 @@',
                '--- old',
                '--- older',
            ].join('\n'),
        ],
        [
            'two SQL addition lines beginning with ++',
            'RIGHT',
            [
                'diff --git a/schema.sql b/schema.sql',
                '--- a/schema.sql',
                '+++ b/schema.sql',
                '@@ -10,0 +10,2 @@',
                '+++ new',
                '+++ newer',
            ].join('\n'),
        ],
    ] as const)('accepts %s as hunk content', (_label, side, diff) => {
        const { port, calls } = fakePort({
            diff,
            json: {
                event: 'REQUEST_CHANGES',
                body: 'Fix the SQL marker.',
                comments: [{ ...validComment, path: 'schema.sql', side, line: 11 }],
            },
        });

        publishReview(42, port);

        expect(calls.some((call) => call.startsWith('post:'))).toBe(true);
    });

    it.each([
        [
            'deleted file on RIGHT',
            'deleted.ts',
            'RIGHT',
            3,
            ['--- a/deleted.ts', '+++ /dev/null', '@@ -3 +0,0 @@', '-gone'].join('\n'),
        ],
        [
            'added file on LEFT',
            'added.ts',
            'LEFT',
            5,
            ['--- /dev/null', '+++ b/added.ts', '@@ -0,0 +5 @@', '+new'].join('\n'),
        ],
        [
            'renamed old path on RIGHT',
            'old.ts',
            'RIGHT',
            7,
            ['--- a/old.ts', '+++ b/new.ts', '@@ -7 +7 @@', '-old', '+new'].join('\n'),
        ],
        [
            'renamed new path on LEFT',
            'new.ts',
            'LEFT',
            7,
            ['--- a/old.ts', '+++ b/new.ts', '@@ -7 +7 @@', '-old', '+new'].join('\n'),
        ],
    ] as const)('refuses %s', (_label, path, side, line, diff) => {
        const { port } = fakePort({
            diff,
            json: {
                event: 'REQUEST_CHANGES',
                body: 'Fix the changed line.',
                comments: [{ ...validComment, path, side, line }],
            },
        });

        expect(() => publishReview(42, port)).toThrow(/not a changed line/i);
    });

    it.each([
        ['state', { state: 'APPROVED' }],
        ['actor', { actorNodeId: 'wrong-reviewer' }],
        ['head', { commitId: 'b'.repeat(40) }],
        ['body', { body: 'different' }],
        ['missing remote comment', { comments: [] }],
        [
            'extra remote comment',
            {
                comments: [
                    { path: 'scripts/deliverPullRequest.ts', line: 10, side: 'RIGHT' as const, body: 'a. b. c.' },
                    { path: 'extra.ts', line: 1, side: 'RIGHT' as const, body: 'extra' },
                ],
            },
        ],
        ['path', { comments: [{ path: 'other.ts', line: 10, side: 'RIGHT' as const, body: 'a. b. c.' }] }],
        [
            'line',
            {
                comments: [
                    { path: 'scripts/deliverPullRequest.ts', line: 11, side: 'RIGHT' as const, body: 'a. b. c.' },
                ],
            },
        ],
        [
            'side',
            {
                comments: [
                    { path: 'scripts/deliverPullRequest.ts', line: 10, side: 'LEFT' as const, body: 'a. b. c.' },
                ],
            },
        ],
        [
            'inline comment body',
            {
                comments: [
                    { path: 'scripts/deliverPullRequest.ts', line: 10, side: 'RIGHT' as const, body: 'different' },
                ],
            },
        ],
    ] as const)('rejects an otherwise matching landed review with %s drift', (_label, drift) => {
        const document = {
            event: 'REQUEST_CHANGES' as const,
            body: 'Review body.',
            comments: [{ ...validComment, defect: 'a', consequence: 'b', done: 'c' }],
        };
        const defaultComment = {
            path: 'scripts/deliverPullRequest.ts',
            line: 10,
            side: 'RIGHT' as const,
            body: 'a. b. c.',
        };
        const driftedComments = 'comments' in drift ? drift.comments : undefined;
        const comments: Parameters<typeof exactPublishedReview>[0]['comments'] = [];
        for (const comment of driftedComments ?? [defaultComment]) {
            if (comment === undefined) {
                throw new Error('review drift test fixture is incomplete');
            }
            comments.push({ ...comment });
        }
        const review: Parameters<typeof exactPublishedReview>[0] = {
            id: 1,
            state: 'CHANGES_REQUESTED',
            body: document.body,
            commitId: 'a'.repeat(40),
            actorNodeId: REVIEWER_BOT_NODE_ID,
            ...drift,
            comments,
        };

        expect(exactPublishedReview(review, document, 'a'.repeat(40), REVIEWER_BOT_NODE_ID)).toBe(false);
    });

    it('flattens paginated reviewer responses while excluding prior-head and non-reviewer records', () => {
        const head = 'b'.repeat(40);
        const requests: string[][] = [];
        const gh = (args: string[]): string => {
            requests.push(args);
            const endpoint = args.at(-1);
            if (args[0] === 'pr') {
                return JSON.stringify({ state: 'OPEN', headRefOid: head });
            }
            if (endpoint?.endsWith('/reviews?per_page=100')) {
                return JSON.stringify([
                    [
                        {
                            id: 1,
                            state: 'CHANGES_REQUESTED',
                            body: 'old',
                            commit_id: 'a'.repeat(40),
                            user: { node_id: REVIEWER_BOT_NODE_ID },
                        },
                        { id: 2, state: 'APPROVED', body: 'human', commit_id: head, user: { node_id: 'human' } },
                    ],
                    [
                        {
                            id: 3,
                            state: 'CHANGES_REQUESTED',
                            body: 'exact',
                            commit_id: head,
                            user: { node_id: REVIEWER_BOT_NODE_ID },
                        },
                    ],
                ]);
            }
            if (endpoint?.endsWith('/comments?per_page=100')) {
                return JSON.stringify([
                    [
                        {
                            pull_request_review_id: 3,
                            path: 'one.ts',
                            original_line: 1,
                            side: 'RIGHT',
                            body: 'first',
                        },
                    ],
                    [
                        {
                            pull_request_review_id: 3,
                            path: 'two.ts',
                            original_line: 2,
                            side: 'RIGHT',
                            body: 'second',
                        },
                    ],
                ]);
            }
            throw new Error(`unexpected gh request: ${args.join(' ')}`);
        };

        expect(inspectReviewPublicationRemote(42, REVIEWER_BOT_NODE_ID, head, gh)).toEqual({
            state: 'OPEN',
            head,
            otherActorReviews: [
                {
                    id: 2,
                    state: 'APPROVED',
                    body: 'human',
                    commitId: head,
                    actorNodeId: 'human',
                    comments: [],
                },
            ],
            reviews: [
                {
                    id: 3,
                    state: 'CHANGES_REQUESTED',
                    body: 'exact',
                    commitId: head,
                    actorNodeId: REVIEWER_BOT_NODE_ID,
                    comments: [
                        { path: 'one.ts', line: 1, side: 'RIGHT', body: 'first' },
                        { path: 'two.ts', line: 2, side: 'RIGHT', body: 'second' },
                    ],
                },
            ],
        });
        expect(requests).toEqual([
            ['pr', 'view', '42', '--repo', 'jcosta33/sourdaw', '--json', 'state,headRefOid'],
            ['api', '--paginate', '--slurp', 'repos/jcosta33/sourdaw/pulls/42/reviews?per_page=100'],
            ['api', '--paginate', '--slurp', 'repos/jcosta33/sourdaw/pulls/42/comments?per_page=100'],
        ]);
    });

    it('treats prior-head reviewer records as absent for a new expected head', () => {
        const expectedHead = 'b'.repeat(40);
        const gh = (args: string[]): string => {
            if (args[0] === 'pr') {
                return JSON.stringify({ state: 'OPEN', headRefOid: expectedHead });
            }
            return JSON.stringify([
                [
                    {
                        id: 1,
                        state: 'CHANGES_REQUESTED',
                        body: 'old',
                        commit_id: 'a'.repeat(40),
                        user: { node_id: REVIEWER_BOT_NODE_ID },
                    },
                ],
            ]);
        };

        expect(inspectReviewPublicationRemote(42, REVIEWER_BOT_NODE_ID, expectedHead, gh).reviews).toEqual([]);
    });

    it('uses immutable original coordinates when a closed or advanced pull request nulls current inline coordinates', () => {
        const head = 'a'.repeat(40);
        const gh = (args: string[]): string => {
            if (args[0] === 'pr') {
                return JSON.stringify({ state: 'CLOSED', headRefOid: 'b'.repeat(40) });
            }
            if (args.at(-1)?.endsWith('/reviews?per_page=100')) {
                return JSON.stringify([
                    [
                        {
                            id: 7,
                            state: 'CHANGES_REQUESTED',
                            body: 'body',
                            commit_id: head,
                            user: { node_id: REVIEWER_BOT_NODE_ID },
                        },
                    ],
                ]);
            }
            return JSON.stringify([
                [
                    {
                        pull_request_review_id: 7,
                        path: 'file.ts',
                        original_line: 12,
                        side: 'RIGHT',
                        body: 'immutable comment',
                    },
                ],
            ]);
        };

        expect(inspectReviewPublicationRemote(42, REVIEWER_BOT_NODE_ID, head, gh).reviews[0]?.comments).toEqual([
            { path: 'file.ts', line: 12, side: 'RIGHT', body: 'immutable comment' },
        ]);
    });

    it('rejects the renamed reviewer login when the posted review has the wrong actor ID', () => {
        const { port, logs } = fakePort({ actorNodeId: 'BOT_wrong', login: 'renamed-reviewer[bot]' });

        expect(() => publishReview(42, port)).toThrow(/review was posted by actor BOT_wrong/);
        expect(logs).toEqual([]);
    });

    it('refuses a moved head before posting', () => {
        const { port, calls } = fakePort({ laterHead: 'moved' });

        expect(() => publishReview(42, port)).toThrow(/head moved/);
        expect(calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    // A bare `toThrow()` is satisfied by any failure, including the wrong one — a mutant that
    // removes one guard but leaves a different, coincidentally-firing guard in place keeps the row
    // green. Every row therefore asserts the specific message its own guard raises.
    it.each([
        ['COMMENT', { event: 'COMMENT', comments: [] }, /event must be APPROVE or REQUEST_CHANGES/],
        ['missing event', { comments: [] }, /event must be APPROVE or REQUEST_CHANGES/],
        [
            'empty REQUEST_CHANGES comments',
            { event: 'REQUEST_CHANGES', body: 'n', comments: [] },
            /REQUEST_CHANGES requires comments/,
        ],
        [
            'blank REQUEST_CHANGES body',
            { event: 'REQUEST_CHANGES', body: '  ', comments: [validComment] },
            /REQUEST_CHANGES requires a top-level body/,
        ],
        ['invalid json object', '{', /review\.json must be an object/],
        [
            'APPROVE carrying comments',
            { event: 'APPROVE', body: 'ok', comments: [validComment] },
            /APPROVE must carry no comments/,
        ],
        ['APPROVE with a blank body', { event: 'APPROVE', body: '  ', comments: [] }, /APPROVE requires a body/],
        ['APPROVE with a missing body', { event: 'APPROVE', comments: [] }, /APPROVE requires a body/],
        [
            'a comment supplying legacy body instead of the field contract',
            { event: 'REQUEST_CHANGES', body: 'n', comments: [{ path: 'a.ts', line: 1, side: 'RIGHT', body: 'text' }] },
            /uses body; supply defect, consequence, and done instead/,
        ],
        [
            'a comment with an empty defect',
            {
                event: 'REQUEST_CHANGES',
                body: 'n',
                comments: [{ path: 'a.ts', line: 1, side: 'RIGHT', defect: '', consequence: 'c', done: 'd' }],
            },
            /review\.json comments\[0\] defect is empty/,
        ],
        [
            'a comment with a missing defect',
            {
                event: 'REQUEST_CHANGES',
                body: 'n',
                comments: [{ path: 'a.ts', line: 1, side: 'RIGHT', consequence: 'c', done: 'd' }],
            },
            /review\.json comments\[0\] defect is invalid/,
        ],
        [
            'comments that are not an array',
            { event: 'REQUEST_CHANGES', body: 'n', comments: 'nope' },
            /review\.json comments must be an array/,
        ],
    ])('does not post %s', (_case, json, message) => {
        const { port, calls } = fakePort({ json });

        expect(() => publishReview(42, port)).toThrow(message);
        expect(calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it('refuses an APPROVE document whose comments field is not an array', () => {
        // Unlike the REQUEST_CHANGES row above — where a broken array guard still fails, just for
        // the wrong reason (REQUEST_CHANGES requires comments) — an APPROVE document has nothing
        // else to object: with the array guard gone, this posts cleanly with the malformed field
        // silently dropped. This is the document that actually discriminates the guard.
        const { port } = fakePort({
            json: { event: 'APPROVE', body: 'Attacked the merge gate; it held.', comments: 'nope' },
        });

        expect(() => publishReview(42, port)).toThrow(/review\.json comments must be an array/);
    });

    // A single-element `comments` array cannot tell a real index from a hardcoded `comments[0]`
    // literal, so every index-observing test here puts a VALID comment first and the invalid one
    // second, asserting `comments[1]` — that fails if the message ever hardcodes the wrong index.
    it.each([
        ['defect', { path: 'a.ts', line: 1, side: 'RIGHT' as const, defect: 42, consequence: 'c', done: 'd' }],
        ['consequence', { path: 'a.ts', line: 1, side: 'RIGHT' as const, defect: 'a', consequence: 42, done: 'd' }],
        ['done', { path: 'a.ts', line: 1, side: 'RIGHT' as const, defect: 'a', consequence: 'c', done: 42 }],
    ])('names the %s field and the comment index when it supplies a non-string value', (field, invalidComment) => {
        const { port } = fakePort({
            json: {
                event: 'REQUEST_CHANGES',
                body: 'n',
                comments: [validComment, invalidComment],
            },
        });

        expect(() => publishReview(42, port)).toThrow(new RegExp(`review\\.json comments\\[1\\] ${field} is invalid`));
    });

    describe('comment shape validation guards in parseCommentEntries', () => {
        it.each([
            {
                label: 'null entry at index 0',
                comments: [null],
                expectedError: /review\.json comments\[0\] must be an object/,
            },
            {
                label: 'primitive string entry at index 1',
                comments: [validComment, 'not-an-object'],
                expectedError: /review\.json comments\[1\] must be an object/,
            },
            {
                label: 'array entry at index 1',
                comments: [validComment, []],
                expectedError: /review\.json comments\[1\] must be an object/,
            },
            {
                label: 'missing path at index 0',
                comments: [{ line: 10, side: 'RIGHT', defect: 'd', consequence: 'c', done: 'd' }],
                expectedError: /review\.json comments\[0\] path is invalid/,
            },
            {
                label: 'empty path at index 1',
                comments: [
                    validComment,
                    { path: '', line: 10, side: 'RIGHT', defect: 'd', consequence: 'c', done: 'd' },
                ],
                expectedError: /review\.json comments\[1\] path is invalid/,
            },
            {
                label: 'non-string path at index 1',
                comments: [
                    validComment,
                    { path: 123, line: 10, side: 'RIGHT', defect: 'd', consequence: 'c', done: 'd' },
                ],
                expectedError: /review\.json comments\[1\] path is invalid/,
            },
            {
                label: 'missing line at index 0',
                comments: [{ path: 'a.ts', side: 'RIGHT', defect: 'd', consequence: 'c', done: 'd' }],
                expectedError: /review\.json comments\[0\] line is invalid/,
            },
            {
                label: 'zero line at index 0',
                comments: [{ path: 'a.ts', line: 0, side: 'RIGHT', defect: 'd', consequence: 'c', done: 'd' }],
                expectedError: /review\.json comments\[0\] line is invalid/,
            },
            {
                label: 'negative line at index 1',
                comments: [
                    validComment,
                    { path: 'a.ts', line: -1, side: 'RIGHT', defect: 'd', consequence: 'c', done: 'd' },
                ],
                expectedError: /review\.json comments\[1\] line is invalid/,
            },
            {
                label: 'non-integer line at index 1',
                comments: [
                    validComment,
                    { path: 'a.ts', line: 1.5, side: 'RIGHT', defect: 'd', consequence: 'c', done: 'd' },
                ],
                expectedError: /review\.json comments\[1\] line is invalid/,
            },
            {
                label: 'non-number line string at index 1',
                comments: [
                    validComment,
                    { path: 'a.ts', line: '10', side: 'RIGHT', defect: 'd', consequence: 'c', done: 'd' },
                ],
                expectedError: /review\.json comments\[1\] line is invalid/,
            },
            {
                label: 'missing side at index 0',
                comments: [{ path: 'a.ts', line: 10, defect: 'd', consequence: 'c', done: 'd' }],
                expectedError: /review\.json comments\[0\] side must be LEFT or RIGHT/,
            },
            {
                label: 'invalid side string at index 0',
                comments: [{ path: 'a.ts', line: 10, side: 'TOP', defect: 'd', consequence: 'c', done: 'd' }],
                expectedError: /review\.json comments\[0\] side must be LEFT or RIGHT/,
            },
            {
                label: 'lowercase side at index 1',
                comments: [
                    validComment,
                    { path: 'a.ts', line: 10, side: 'right', defect: 'd', consequence: 'c', done: 'd' },
                ],
                expectedError: /review\.json comments\[1\] side must be LEFT or RIGHT/,
            },
            {
                label: 'non-string side at index 1',
                comments: [
                    validComment,
                    { path: 'a.ts', line: 10, side: 42, defect: 'd', consequence: 'c', done: 'd' },
                ],
                expectedError: /review\.json comments\[1\] side must be LEFT or RIGHT/,
            },
        ])('refuses $label', ({ comments, expectedError }) => {
            const { port } = fakePort({
                json: {
                    event: 'REQUEST_CHANGES',
                    body: 'Please fix',
                    comments,
                },
            });

            expect(() => publishReview(42, port)).toThrow(expectedError);
        });
    });

    it("fires the APPROVE-carries-comments refusal before parsing that comment's fields", () => {
        const { port } = fakePort({
            json: { event: 'APPROVE', body: 'ok', comments: [{ path: 'a.ts', line: 1, side: 'RIGHT' }] },
        });

        expect(() => publishReview(42, port)).toThrow(/APPROVE must carry no comments/);
    });

    it('names the comment index in a byte-ceiling failure raised while parsing a document', () => {
        const longField = 'x'.repeat(300);
        const { port } = fakePort({
            json: {
                event: 'REQUEST_CHANGES',
                body: 'n',
                comments: [
                    validComment,
                    {
                        path: 'a.ts',
                        line: 1,
                        side: 'RIGHT',
                        defect: longField,
                        consequence: longField,
                        done: longField,
                    },
                ],
            },
        });

        expect(() => publishReview(42, port)).toThrow(
            /review\.json comments\[1\] is \d+ bytes, exceeding the 600-byte limit/
        );
    });

    it('names defect, consequence, and done when a comment supplies legacy body', () => {
        const { port } = fakePort({
            json: {
                event: 'REQUEST_CHANGES',
                body: 'n',
                comments: [{ path: 'a.ts', line: 1, side: 'RIGHT', body: 'text' }],
            },
        });

        expect(() => publishReview(42, port)).toThrow(/uses body; supply defect, consequence, and done instead/);
    });

    it('refuses an APPROVE document that carries comments', () => {
        const { port } = fakePort({ json: { event: 'APPROVE', body: 'ok', comments: [validComment] } });

        expect(() => publishReview(42, port)).toThrow(/APPROVE must carry no comments/);
    });

    it('refuses an APPROVE document with a blank body', () => {
        const { port } = fakePort({ json: { event: 'APPROVE', body: '  ', comments: [] } });

        expect(() => publishReview(42, port)).toThrow(/APPROVE requires a body/);
    });

    it('posts an APPROVE document with evidence and no comments', () => {
        const { port, calls } = fakePort({
            json: {
                format: 'compact-v1',
                event: 'APPROVE',
                body: 'Attacked the merge gate; it held.',
                comments: [],
                evidence: approvalEvidence(),
            },
        });

        publishReview(42, port);

        expect(calls[1]).toBe(`post:headsha:APPROVE:${approvalBody('Attacked the merge gate; it held.')}`);
    });

    it('does not post when review.json is missing', () => {
        const { port, calls } = fakePort({ missing: true });

        expect(() => publishReview(42, port)).toThrow(/missing review.json/);
        expect(calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it('parses argv', () => {
        expect(parsePublishReviewArgs(['7'])).toEqual({ number: 7, help: false });
        expect(
            parseReviewDocument({ event: 'APPROVE', body: 'Attacked the merge gate; it held.', comments: [] }).event
        ).toBe('APPROVE');
    });
});

/**
 * GitHub can coerce the `event` a review is posted with — observed live when the target PR closed
 * or merged between bundle preparation and posting — and still answer 200 with a review whose
 * recorded `state` disagrees with what was requested. `publishReview.spec.ts` above only exercises
 * `postReview` through a fake port, so it cannot see that coercion: it is `shellPort`'s own
 * `postReview` that reads the raw `gh` response and must compare `state` against `event` itself.
 * These tests drive `shellPort` with a fake `capture` so no real `gh` is ever reached: the sibling
 * `openLane.spec.ts` documents why `vi.mock('node:child_process')` does not intercept a module
 * under `scripts/` and why a prior spec that trusted it filed a live issue on the public tracker.
 */
describe('shellPort CI approval label', () => {
    const session: GhSession = { configDir: '/tmp/sourdaw-gh', env: {}, dispose: () => undefined };
    const labelPath = `repos/jcosta33/sourdaw/labels/${encodeURIComponent(CI_APPROVAL_LABEL)}`;
    const issueLabelPath = `repos/jcosta33/sourdaw/issues/42/labels/${encodeURIComponent(CI_APPROVAL_LABEL)}`;

    function recordingCapture(answers: Record<string, () => string>) {
        const requests: string[] = [];
        const capture = (command: string, args: string[], options?: { input?: string }): string => {
            if (command === 'git' && args[0] === 'rev-parse') {
                return `${process.cwd()}/.git`;
            }
            const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
            const path = args.find((arg) => arg.startsWith('repos/')) ?? '';
            const request = `${method ?? ''} ${path}${options?.input === undefined ? '' : ` ${options.input}`}`;
            requests.push(request);
            const answer = answers[`${method ?? ''} ${path}`];
            return answer === undefined ? '{}' : answer();
        };
        return { requests, capture };
    }

    function notFound(): never {
        throw new Error('gh: Not Found (HTTP 404)');
    }

    it('takes a stale label off before adding it, so every approval emits a fresh labeled event', () => {
        const { requests, capture } = recordingCapture({});
        shellPort(session, process.cwd(), capture).applyApprovalLabel(42);
        expect(requests).toEqual([
            `GET ${labelPath}`,
            `DELETE ${issueLabelPath}`,
            `POST repos/jcosta33/sourdaw/issues/42/labels ${JSON.stringify({ labels: [CI_APPROVAL_LABEL] })}`,
        ]);
    });

    it('creates the label when the repository lacks it and tolerates its absence from the pull request', () => {
        const { requests, capture } = recordingCapture({
            [`GET ${labelPath}`]: notFound,
            [`DELETE ${issueLabelPath}`]: notFound,
        });
        shellPort(session, process.cwd(), capture).applyApprovalLabel(42);
        expect(requests[1]).toMatch(/^POST repos\/jcosta33\/sourdaw\/labels \{"name":"ci:approved",/u);
        expect(requests.at(-1)).toBe(
            `POST repos/jcosta33/sourdaw/issues/42/labels ${JSON.stringify({ labels: [CI_APPROVAL_LABEL] })}`
        );
    });

    it('treats a label another publication created first as present, and fails on any other refusal', () => {
        const raced = recordingCapture({
            [`GET ${labelPath}`]: notFound,
            'POST repos/jcosta33/sourdaw/labels': () => {
                throw new Error(
                    'gh: Validation Failed (HTTP 422)\n{"errors":[{"resource":"Label","code":"already_exists","field":"name"}]}'
                );
            },
        });
        shellPort(session, process.cwd(), raced.capture).applyApprovalLabel(42);
        expect(raced.requests.at(-1)).toBe(
            `POST repos/jcosta33/sourdaw/issues/42/labels ${JSON.stringify({ labels: [CI_APPROVAL_LABEL] })}`
        );

        const invalid = recordingCapture({
            [`GET ${labelPath}`]: notFound,
            'POST repos/jcosta33/sourdaw/labels': () => {
                throw new Error('gh: Validation Failed (HTTP 422)\n{"errors":[{"code":"invalid","field":"color"}]}');
            },
        });
        expect(() => shellPort(session, process.cwd(), invalid.capture).applyApprovalLabel(42)).toThrow('HTTP 422');
    });

    it('removes the label, succeeding when it is absent and failing on any other error', () => {
        const absent = recordingCapture({ [`DELETE ${issueLabelPath}`]: notFound });
        shellPort(session, process.cwd(), absent.capture).removeApprovalLabel(42);
        expect(absent.requests).toEqual([`DELETE ${issueLabelPath}`]);

        const denied = recordingCapture({
            [`DELETE ${issueLabelPath}`]: () => {
                throw new Error('gh: Resource not accessible by integration (HTTP 403)');
            },
        });
        expect(() => shellPort(session, process.cwd(), denied.capture).removeApprovalLabel(42)).toThrow('HTTP 403');
    });
});

describe('shellPort postReview state verification', () => {
    const session: GhSession = { configDir: '/tmp/sourdaw-gh', env: {}, dispose: () => undefined };

    function fakeCapture(reviewResponse: unknown) {
        return (command: string, args: string[]): string => {
            if (command === 'git' && args[0] === 'rev-parse') {
                return `${process.cwd()}/.git`;
            }
            if (command === 'gh' && args[0] === 'api') {
                return JSON.stringify(reviewResponse);
            }
            throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
        };
    }

    it('fails loudly, naming both the requested event and the recorded state, when GitHub coerces the review', () => {
        const capture = fakeCapture({
            id: 4985383093,
            state: 'APPROVED',
            user: { node_id: REVIEWER_BOT_NODE_ID, login: 'renamed-reviewer[bot]' },
        });
        const port = shellPort(session, process.cwd(), capture);

        expect(() =>
            port.postReview({ number: 2353, commitId: 'sha', event: 'REQUEST_CHANGES', body: 'no', comments: [] })
        ).toThrow(/requested REQUEST_CHANGES but GitHub recorded APPROVED/);
    });

    it('posts successfully when the recorded state agrees with the requested event', () => {
        const events: string[] = [];
        const capture = (command: string, args: string[]): string => {
            if (command === 'git' && args[0] === 'rev-parse') {
                return `${process.cwd()}/.git`;
            }
            if (command === 'gh' && args[0] === 'api') {
                events.push('post');
                return JSON.stringify({
                    id: 42,
                    state: 'CHANGES_REQUESTED',
                    user: { node_id: REVIEWER_BOT_NODE_ID, login: 'renamed-reviewer[bot]' },
                });
            }
            throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
        };
        const port = shellPort(session, process.cwd(), capture, () => events.push('attempt'));

        expect(
            port.postReview({ number: 42, commitId: 'sha', event: 'REQUEST_CHANGES', body: 'no', comments: [] })
        ).toEqual({ id: 42, actorNodeId: REVIEWER_BOT_NODE_ID, login: 'renamed-reviewer[bot]' });
        expect(events).toEqual(['attempt', 'post']);
    });

    it('fetches label names and descriptions for the diversity fence from gh pr view', () => {
        const requests: string[] = [];
        const capture = (command: string, args: string[]): string => {
            if (command === 'git' && args[0] === 'rev-parse') {
                return `${process.cwd()}/.git`;
            }
            if (command === 'gh' && args[0] === 'pr') {
                requests.push(args.join(' '));
                return JSON.stringify({
                    state: 'OPEN',
                    headRefOid: 'headsha',
                    labels: [
                        { name: 'bug', description: 'Something is broken' },
                        { name: 'glm-5.3-flash', description: 'Authored by glm-5.3-flash' },
                        { name: 'no-description' },
                    ],
                });
            }
            throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
        };
        const port = shellPort(session, process.cwd(), capture);

        expect(port.pullRequest(42)).toEqual({
            state: 'OPEN',
            head: 'headsha',
            labels: [
                { name: 'bug', description: 'Something is broken' },
                { name: 'glm-5.3-flash', description: 'Authored by glm-5.3-flash' },
                { name: 'no-description' },
            ],
        });
        // The field list is the acquisition path itself: dropping `labels` from it silently
        // disables the diversity enforcement in production while every fake-port test stays green.
        expect(requests).toEqual([`pr view 42 --repo jcosta33/sourdaw --json state,headRefOid,labels`]);
    });

    it('refuses a same-model review end to end through the production shellPort label fetch', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-diversity-shell-'));
        runGit(root, ['init', '-b', 'main']);
        const head = 'f'.repeat(40);
        const bundle = join(root, '.agents', 'review-bundles', `42-${head}`);
        mkdirSync(bundle, { recursive: true });
        writeFileSync(
            join(bundle, 'review.json'),
            JSON.stringify({
                format: 'compact-v1',
                event: 'APPROVE',
                body: 'Attacked; held.',
                comments: [],
                evidence: approvalEvidence(head),
                reviewerModel: 'glm-5.3-flash',
            })
        );
        writeFileSync(join(bundle, 'diff.patch'), '');
        try {
            const port = shellPort(session, root, (command, args) => {
                if (command === 'git' && args[0] === 'rev-parse') {
                    return `${root}/.git`;
                }
                if (command === 'gh' && args[0] === 'pr') {
                    return JSON.stringify({
                        state: 'OPEN',
                        headRefOid: head,
                        labels: [{ name: 'glm-5.3-flash', description: 'Authored by glm-5.3-flash' }],
                    });
                }
                throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
            });

            expect(() => publishReview(42, port)).toThrow(/matches one of the PR's authoring models/u);
        } finally {
            removeTemporaryDirectory(root);
        }
    });

    it('retains the exact shared owner when the production review POST becomes indeterminate', async () => {
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-publish-lock-'));
        runGit(primaryRoot, ['init', '-b', 'main']);
        const number = 7819;
        const ref = `refs/sourdaw/delivery/pr-${number}`;
        const restorePs = writeTrustedPsFixture(primaryRoot);
        let postAttempted = false;
        let reacquired = false;

        try {
            await expect(
                withPullRequestMutationLock(primaryRoot, number, async ({ markRemoteMutationAttempt }) => {
                    const port = shellPort(
                        session,
                        primaryRoot,
                        (command, args) => {
                            if (command === 'git' && args[0] === 'rev-parse') {
                                return `${primaryRoot}/.git`;
                            }
                            if (command === 'gh' && args[0] === 'api') {
                                postAttempted = true;
                                throw new Error('review POST result is indeterminate');
                            }
                            throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
                        },
                        markRemoteMutationAttempt
                    );
                    port.postReview({
                        number,
                        commitId: 'a'.repeat(40),
                        event: 'APPROVE',
                        body: 'Attacked the owner fence; it held.',
                        comments: [],
                    });
                })
            ).rejects.toThrow('review POST result is indeterminate');
            expect(postAttempted).toBe(true);
            const retainedOwnerOid = runGit(primaryRoot, ['show-ref', '--verify', '--hash', ref]);

            await expect(
                withPullRequestMutationLock(primaryRoot, number, async () => {
                    reacquired = true;
                })
            ).rejects.toThrow(/already being delivered/);
            expect(reacquired).toBe(false);
            expect(runGit(primaryRoot, ['show-ref', '--verify', '--hash', ref])).toBe(retainedOwnerOid);
        } finally {
            restorePs();
            removeTemporaryDirectory(primaryRoot);
        }
    });

    it('journals the definitive no-mutation status when the review POST fails with HTTP 422', () => {
        const capture = (command: string, args: string[]): string => {
            if (command === 'git' && args[0] === 'rev-parse') {
                return `${process.cwd()}/.git`;
            }
            if (command === 'gh' && args[0] === 'api') {
                throw new Error('gh: Validation Failed (HTTP 422): review could not be created');
            }
            throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
        };
        const attestations: number[] = [];
        const port = shellPort(
            session,
            process.cwd(),
            capture,
            () => undefined,
            (status) => attestations.push(status)
        );

        expect(() =>
            port.postReview({ number: 42, commitId: 'sha', event: 'APPROVE', body: 'no', comments: [] })
        ).toThrow('gh: Validation Failed (HTTP 422)');
        expect(attestations).toEqual([422]);
    });

    it.each(['gh: Conflict (HTTP 409)', 'gh: Internal Server Error (HTTP 500)', 'socket hang up'])(
        'does not journal a no-mutation status when the review POST fails with %s',
        (failure) => {
            const capture = (command: string, args: string[]): string => {
                if (command === 'git' && args[0] === 'rev-parse') {
                    return `${process.cwd()}/.git`;
                }
                if (command === 'gh' && args[0] === 'api') {
                    throw new Error(failure);
                }
                throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
            };
            const attestations: number[] = [];
            const port = shellPort(
                session,
                process.cwd(),
                capture,
                () => undefined,
                (status) => attestations.push(status)
            );

            expect(() =>
                port.postReview({ number: 42, commitId: 'sha', event: 'APPROVE', body: 'no', comments: [] })
            ).toThrow(failure);
            expect(attestations).toEqual([]);
        }
    );

    it('posts successfully when APPROVE is recorded as APPROVED', () => {
        const capture = fakeCapture({
            id: 43,
            state: 'APPROVED',
            user: { node_id: REVIEWER_BOT_NODE_ID, login: 'renamed-reviewer[bot]' },
        });
        const port = shellPort(session, process.cwd(), capture);

        expect(port.postReview({ number: 42, commitId: 'sha', event: 'APPROVE', body: '', comments: [] })).toEqual({
            id: 43,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            login: 'renamed-reviewer[bot]',
        });
    });

    it('sends the composed body for each comment, not the raw defect/consequence/done fields', () => {
        let sentInput: string | undefined;
        const capture = (command: string, args: string[], options?: { input?: string }): string => {
            if (command === 'git' && args[0] === 'rev-parse') {
                return `${process.cwd()}/.git`;
            }
            if (command === 'gh' && args[0] === 'api') {
                sentInput = options?.input;
                return JSON.stringify({
                    id: 44,
                    state: 'CHANGES_REQUESTED',
                    user: { node_id: REVIEWER_BOT_NODE_ID, login: 'renamed-reviewer[bot]' },
                });
            }
            throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
        };
        const port = shellPort(session, process.cwd(), capture);

        port.postReview({
            number: 42,
            commitId: 'sha',
            event: 'REQUEST_CHANGES',
            body: 'no',
            comments: [validComment],
        });

        const sent = JSON.parse(sentInput ?? '{}') as {
            comments: { path: string; line: number; side: string; body: string }[];
        };
        expect(sent.comments).toEqual([
            {
                path: 'scripts/deliverPullRequest.ts',
                line: 10,
                side: 'RIGHT',
                body: 'COMMENT still authorizes merge. A stale COMMENT could ship. Require reviewer APPROVED on this head.',
            },
        ]);
    });

    it('pins the canonical review payload bytes and SHA-256 digest', () => {
        const payload = reviewPublicationPayload({
            commitId: '0123456789012345678901234567890123456789',
            event: 'REQUEST_CHANGES',
            body: 'Request changes.',
            comments: [validComment],
        });

        expect(payload).toBe(
            '{"commit_id":"0123456789012345678901234567890123456789","event":"REQUEST_CHANGES","body":"Request changes.","comments":[{"path":"scripts/deliverPullRequest.ts","line":10,"side":"RIGHT","body":"COMMENT still authorizes merge. A stale COMMENT could ship. Require reviewer APPROVED on this head."}]}'
        );
        expect(reviewPublicationPayloadDigest(payload)).toBe(
            '15e97754a7af071d05cb92ef1594eb18737a7b9ab7851e2c3409cc9526d51a11'
        );
    });

    it('retains a dead owner that attempted a remote mutation after two no-review reads', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-recovery-'));
        const number = 42;
        const head = 'a'.repeat(40);
        const firstFence = { kind: 'pid' as const, pid: process.pid, startedAt: 'first-retry-process' };
        const retryFence = { kind: 'pid' as const, pid: process.pid, startedAt: 'second-retry-process' };
        try {
            runGit(root, ['init']);
            const bundle = join(root, '.agents', 'review-bundles', `${number}-${head}`);
            mkdirSync(bundle, { recursive: true });
            writeFileSync(
                join(bundle, 'review.json'),
                JSON.stringify({ event: 'APPROVE', body: 'Attacked; held.', comments: [] })
            );
            writeFileSync(join(bundle, 'diff.patch'), '');
            const digest = reviewPublicationPayloadDigest(
                reviewPublicationPayload({ commitId: head, event: 'APPROVE', body: 'Attacked; held.', comments: [] })
            );
            const ownerOid = writePullRequestMutationLockOwner(
                root,
                {
                    version: 3,
                    pid: 999_999,
                    token: '2cd01237-cf63-4579-9e58-85893794529d',
                    operation: 'review-publication',
                    number,
                    expectedHead: head,
                    payloadDigest: digest,
                    reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
                    ownerFence: { kind: 'pid', pid: 999_999, startedAt: 'Thu Jan 01 00:00:00 1970' },
                    mutation: { phase: 'remote-mutation-attempted', epoch: 1 },
                },
                number
            );
            runGit(root, ['update-ref', pullRequestMutationLockRef(number), ownerOid]);
            let inspections = 0;
            const inspectedNumbers: number[] = [];
            const inspectedHeads: string[] = [];
            await expect(
                runRecoverPublishReviewLockCli([String(number), '--owner', ownerOid], {
                    primaryRoot: () => root,
                    authenticateReviewer: async () => ({
                        minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                        session: { configDir: '/tmp/reviewer', env: {}, dispose: () => undefined },
                    }),
                    repositoryName: () => 'jcosta33/sourdaw',
                    inspect: (inspectedNumber, _actorNodeId, expectedHead) => {
                        inspections += 1;
                        inspectedNumbers.push(inspectedNumber);
                        inspectedHeads.push(expectedHead);
                        return { state: 'OPEN', head, reviews: [] };
                    },
                    isOwnerLive: () => false,
                    currentOwnerFence: () => firstFence,
                })
            ).rejects.toThrow(/attempted a remote mutation without landed evidence/);
            expect(inspections).toBe(2);
            expect(inspectedNumbers).toEqual([number, number]);
            expect(inspectedHeads).toEqual([head, head]);
            const retainedOid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
            expect(retainedOid).toMatch(/^[0-9a-f]{40}$/);
            expect(retainedOid).not.toBe(ownerOid);
            const retainedOwner = readPullRequestMutationLockOwner(root, retainedOid!, number);
            expect(retainedOwner).toMatchObject({
                ownerFence: firstFence,
                mutation: { phase: 'remote-mutation-attempted', epoch: 2 },
            });

            inspections = 0;
            await expect(
                runRecoverPublishReviewLockCli([String(number), '--owner', retainedOid!], {
                    primaryRoot: () => root,
                    authenticateReviewer: async () => ({
                        minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                        session: { configDir: '/tmp/reviewer', env: {}, dispose: () => undefined },
                    }),
                    repositoryName: () => 'jcosta33/sourdaw',
                    inspect: () => {
                        inspections += 1;
                        return { state: 'OPEN', head, reviews: [] };
                    },
                    isOwnerLive: () => false,
                    currentOwnerFence: () => retryFence,
                })
            ).rejects.toThrow(/attempted a remote mutation without landed evidence/);
            expect(inspections).toBe(2);
            const retryRetainedOid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
            expect(retryRetainedOid).toMatch(/^[0-9a-f]{40}$/);
            expect(retryRetainedOid).not.toBe(retainedOid);
            expect(readPullRequestMutationLockOwner(root, retryRetainedOid!, number)).toMatchObject({
                ownerFence: retryFence,
                mutation: { phase: 'remote-mutation-attempted', epoch: 3 },
            });
            expect(readPullRequestMutationLockReceipt(root, number, ownerOid)).toBeUndefined();
            expect(readPullRequestMutationLockReceipt(root, number, retainedOid!)).toBeUndefined();
        } finally {
            removeTemporaryDirectory(root);
        }
    });

    it('releases a dead prepared owner after two definitive no-review reads', async () => {
        const fixture = createJournaledRecoveryFixture('prepared');
        let inspections = 0;
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => {
                        inspections += 1;
                        return { state: 'OPEN', head: expectedHead, reviews: [] };
                    })
                )
            ).resolves.toBe(0);
            expect(inspections).toBe(2);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('releases a journaled HTTP 422 owner after two definitive empty remote reads, then replays its receipt', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-422-recovery-'));
        const number = 3344;
        const head = 'a'.repeat(40);
        const restorePs = writeTrustedPsFixture(root);
        try {
            runGit(root, ['init']);
            await runFailingReviewPublication(root, number, head, 'gh: Validation Failed (HTTP 422)');
            const retainedOid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
            expect(retainedOid).toMatch(/^[0-9a-f]{40}$/);
            expect(readPullRequestMutationLockOwner(root, retainedOid!, number)).toMatchObject({
                mutation: { phase: 'remote-mutation-attempted', epoch: 2, definitiveNoMutationHttpStatus: 422 },
            });

            let inspections = 0;
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(number), '--owner', retainedOid!],
                    recoveryDependencies(root, (expectedHead) => {
                        inspections += 1;
                        return { state: 'OPEN', head: expectedHead, reviews: [] };
                    })
                )
            ).resolves.toBe(0);
            expect(inspections).toBe(2);
            expect(readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number)).toBeUndefined();
            expect(readPullRequestMutationLockReceipt(root, number, retainedOid!)).toMatchObject({
                version: 2,
                operation: 'review-publication-recovery',
                number,
                ownerOid: retainedOid,
                head,
                outcome: 'absent',
            });

            let authenticated = false;
            await expect(
                runRecoverPublishReviewLockCli([String(number), '--owner', retainedOid!], {
                    ...recoveryDependencies(root, () => {
                        throw new Error('replay must not inspect');
                    }),
                    authenticateReviewer: async () => {
                        authenticated = true;
                        throw new Error('replay must not authenticate');
                    },
                })
            ).resolves.toBe(0);
            expect(authenticated).toBe(false);
        } finally {
            restorePs();
            removeTemporaryDirectory(root);
        }
    });

    it.each(['gh: Conflict (HTTP 409)', 'gh: Internal Server Error (HTTP 500)', 'socket hang up'])(
        'retains a journaled owner whose review POST failed with %s',
        async (failureMessage) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-unattested-recovery-'));
            const number = 3344;
            const head = 'a'.repeat(40);
            const restorePs = writeTrustedPsFixture(root);
            try {
                runGit(root, ['init']);
                await runFailingReviewPublication(root, number, head, failureMessage);
                const retainedOid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
                expect(retainedOid).toMatch(/^[0-9a-f]{40}$/);
                const retained = readPullRequestMutationLockOwner(root, retainedOid!, number);
                if (retained.version !== 3) {
                    throw new Error('retained owner is not a journaled publication owner');
                }
                expect(retained.mutation).toEqual({ phase: 'remote-mutation-attempted', epoch: 1 });

                let inspections = 0;
                await expect(
                    runRecoverPublishReviewLockCli(
                        [String(number), '--owner', retainedOid!],
                        recoveryDependencies(root, (expectedHead) => {
                            inspections += 1;
                            return { state: 'OPEN', head: expectedHead, reviews: [] };
                        })
                    )
                ).rejects.toThrow(/attempted a remote mutation without landed evidence/);
                expect(inspections).toBe(2);
                expect(readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number)).not.toBe(
                    retainedOid
                );
            } finally {
                restorePs();
                removeTemporaryDirectory(root);
            }
        }
    );

    it.each(['gh: Conflict (HTTP 409)', 'gh: Internal Server Error (HTTP 500)', 'socket hang up'])(
        'releases an operator-attested absent owner whose review POST failed with %s, then replays its receipt',
        async (failureMessage) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-attested-recovery-'));
            const number = 3344;
            const head = 'a'.repeat(40);
            const restorePs = writeTrustedPsFixture(root);
            try {
                runGit(root, ['init']);
                await runFailingReviewPublication(root, number, head, failureMessage);
                const retainedOid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
                expect(retainedOid).toMatch(/^[0-9a-f]{40}$/);
                const retained = readPullRequestMutationLockOwner(root, retainedOid!, number);
                if (retained.version !== 3) {
                    throw new Error('retained owner is not a journaled publication owner');
                }
                expect(retained.mutation).toEqual({ phase: 'remote-mutation-attempted', epoch: 1 });

                let inspections = 0;
                const inspectedHeads: string[] = [];
                await expect(
                    runRecoverPublishReviewLockCli(
                        [String(number), '--owner', retainedOid!, '--attest-absent'],
                        recoveryDependencies(root, (expectedHead) => {
                            inspections += 1;
                            inspectedHeads.push(expectedHead);
                            return { state: 'OPEN', head: expectedHead, reviews: [] };
                        })
                    )
                ).resolves.toBe(0);
                expect(inspections).toBe(2);
                expect(inspectedHeads).toEqual([head, head]);
                expect(
                    readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number)
                ).toBeUndefined();
                expect(readPullRequestMutationLockReceipt(root, number, retainedOid!)).toEqual({
                    version: 3,
                    operation: 'review-publication-recovery',
                    number,
                    ownerOid: retainedOid,
                    adoptedOwnerOid: expect.stringMatching(/^[0-9a-f]{40}$/),
                    head,
                    payloadDigest: reviewPublicationPayloadDigest(
                        reviewPublicationPayload({
                            commitId: head,
                            event: 'APPROVE',
                            body: 'Attacked; held.',
                            comments: [],
                        })
                    ),
                    outcome: 'absent',
                    absentAttestation: OPERATOR_ABSENT_ATTESTATION,
                });

                let authenticated = false;
                await expect(
                    runRecoverPublishReviewLockCli([String(number), '--owner', retainedOid!], {
                        ...recoveryDependencies(root, () => {
                            throw new Error('replay must not inspect');
                        }),
                        authenticateReviewer: async () => {
                            authenticated = true;
                            throw new Error('replay must not authenticate');
                        },
                    })
                ).resolves.toBe(0);
                expect(authenticated).toBe(false);
            } finally {
                restorePs();
                removeTemporaryDirectory(root);
            }
        }
    );

    it.each([
        [
            'ambiguous landed review evidence',
            (fixture: ReturnType<typeof createJournaledRecoveryFixture>) => {
                const exact = {
                    id: 1,
                    state: 'APPROVED',
                    body: 'Attacked; held.',
                    commitId: fixture.head,
                    actorNodeId: REVIEWER_BOT_NODE_ID,
                    comments: [],
                };
                return {
                    ownerOid: fixture.ownerOid,
                    inspect: (expectedHead: string) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [exact, { ...exact, id: 2 }],
                    }),
                    error: /ambiguous or non-exact remote review evidence/,
                };
            },
        ],
        [
            'non-exact landed review evidence',
            (fixture: ReturnType<typeof createJournaledRecoveryFixture>) => ({
                ownerOid: fixture.ownerOid,
                inspect: (expectedHead: string) => ({
                    state: 'OPEN',
                    head: expectedHead,
                    reviews: [
                        {
                            id: 1,
                            state: 'APPROVED',
                            body: 'drifted body',
                            commitId: fixture.head,
                            actorNodeId: REVIEWER_BOT_NODE_ID,
                            comments: [],
                        },
                    ],
                }),
                error: /ambiguous or non-exact remote review evidence/,
            }),
        ],
        [
            'unauthorized landed review evidence',
            (fixture: ReturnType<typeof createJournaledRecoveryFixture>) => ({
                ownerOid: fixture.ownerOid,
                inspect: (expectedHead: string) => ({
                    state: 'OPEN',
                    head: expectedHead,
                    reviews: [],
                    otherActorReviews: [
                        {
                            id: 3,
                            state: 'APPROVED',
                            body: 'Attacked; held.',
                            commitId: expectedHead,
                            actorNodeId: 'human-actor',
                            comments: [],
                        },
                    ],
                }),
                error: /unauthorized landed review evidence/,
            }),
        ],
        [
            'payload digest drift from the retained lock',
            (fixture: ReturnType<typeof createJournaledRecoveryFixture>) => {
                const owner = readPullRequestMutationLockOwner(fixture.root, fixture.ownerOid, fixture.number);
                if (owner.version !== 3) {
                    throw new Error('test fixture is not a journaled publication owner');
                }
                const driftedOid = writePullRequestMutationLockOwner(
                    fixture.root,
                    { ...owner, payloadDigest: 'c'.repeat(64) },
                    fixture.number
                );
                runGit(fixture.root, [
                    'update-ref',
                    pullRequestMutationLockRef(fixture.number),
                    driftedOid,
                    fixture.ownerOid,
                ]);
                return {
                    ownerOid: driftedOid,
                    inspect: (expectedHead: string) => ({ state: 'OPEN', head: expectedHead, reviews: [] }),
                    error: /payload does not match the retained lock/,
                };
            },
        ],
        [
            'bundle document drift from the retained lock',
            (fixture: ReturnType<typeof createJournaledRecoveryFixture>) => {
                writeFileSync(
                    join(fixture.root, '.agents', 'review-bundles', `${fixture.number}-${fixture.head}`, 'review.json'),
                    JSON.stringify({ event: 'APPROVE', body: 'drifted body', comments: [] })
                );
                return {
                    ownerOid: fixture.ownerOid,
                    inspect: (expectedHead: string) => ({ state: 'OPEN', head: expectedHead, reviews: [] }),
                    error: /payload does not match the retained lock/,
                };
            },
        ],
        [
            'a missing bundle document',
            (fixture: ReturnType<typeof createJournaledRecoveryFixture>) => {
                rmSync(join(fixture.root, '.agents', 'review-bundles', `${fixture.number}-${fixture.head}`), {
                    recursive: true,
                    force: true,
                });
                return {
                    ownerOid: fixture.ownerOid,
                    inspect: (expectedHead: string) => ({ state: 'OPEN', head: expectedHead, reviews: [] }),
                    error: /ENOENT/,
                };
            },
        ],
    ])('does not release an operator-attested absent owner on %s', async (_label, prepare) => {
        const fixture = createJournaledRecoveryFixture();
        try {
            const { ownerOid, inspect, error } = prepare(fixture);
            const lockedOid = readPullRequestMutationLockOid(
                fixture.root,
                pullRequestMutationLockRef(fixture.number),
                fixture.number
            );
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', ownerOid, '--attest-absent'],
                    recoveryDependencies(fixture.root, inspect)
                )
            ).rejects.toThrow(error);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(lockedOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains a live remote-mutation-attempted owner even when the operator attests the review absent', async () => {
        const fixture = createJournaledRecoveryFixture();
        let inspections = 0;
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid, '--attest-absent'],
                    {
                        ...recoveryDependencies(fixture.root, (expectedHead) => {
                            inspections += 1;
                            return { state: 'OPEN', head: expectedHead, reviews: [] };
                        }),
                        isOwnerLive: () => true,
                    }
                )
            ).rejects.toThrow(/still held by a live process/);
            expect(inspections).toBe(0);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('replays an operator-attested absent receipt after the adopted owner survives an interrupted release', async () => {
        const fixture = createJournaledRecoveryFixture();
        let persistedReceipt: RecoveryReceipt | undefined;
        let inspections = 0;
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid, '--attest-absent'],
                    {
                        ...recoveryDependencies(fixture.root, (expectedHead) => {
                            inspections += 1;
                            return { state: 'OPEN', head: expectedHead, reviews: [] };
                        }),
                        afterRecoveryReceiptPersisted: (receipt) => {
                            persistedReceipt = receipt;
                            expect(receipt).toMatchObject({
                                version: 3,
                                outcome: 'absent',
                                absentAttestation: OPERATOR_ABSENT_ATTESTATION,
                            });
                            expect(
                                readPullRequestMutationLockOid(
                                    fixture.root,
                                    pullRequestMutationLockRef(fixture.number),
                                    fixture.number
                                )
                            ).toBe(receipt.adoptedOwnerOid);
                            throw new Error('injected crash after exact receipt persistence');
                        },
                    }
                )
            ).rejects.toThrow(/injected crash after exact receipt persistence/);
            expect(inspections).toBe(2);
            expect(persistedReceipt).toBeDefined();

            let authenticated = false;
            await expect(
                runRecoverPublishReviewLockCli([String(fixture.number), '--owner', fixture.ownerOid], {
                    ...recoveryDependencies(fixture.root, () => {
                        throw new Error('replay must not inspect');
                    }),
                    authenticateReviewer: async () => {
                        authenticated = true;
                        throw new Error('replay must not authenticate');
                    },
                })
            ).resolves.toBe(0);
            expect(authenticated).toBe(false);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBeUndefined();
            expect(readPullRequestMutationLockReceipt(fixture.root, fixture.number, fixture.ownerOid)).toEqual(
                persistedReceipt
            );
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it.each([
        ['a prepared owner', 'prepared' as const, undefined],
        ['a journaled HTTP 422 owner', 'remote-mutation-attempted' as const, 422 as const],
    ])(
        'releases %s with --attest-absent under the journal authorization without recording the attestation',
        async (_label, phase, definitiveNoMutationHttpStatus) => {
            const fixture = createJournaledRecoveryFixture(phase, definitiveNoMutationHttpStatus);
            let inspections = 0;
            try {
                await expect(
                    runRecoverPublishReviewLockCli(
                        [String(fixture.number), '--owner', fixture.ownerOid, '--attest-absent'],
                        recoveryDependencies(fixture.root, (expectedHead) => {
                            inspections += 1;
                            return { state: 'OPEN', head: expectedHead, reviews: [] };
                        })
                    )
                ).resolves.toBe(0);
                expect(inspections).toBe(2);
                expect(
                    readPullRequestMutationLockOid(
                        fixture.root,
                        pullRequestMutationLockRef(fixture.number),
                        fixture.number
                    )
                ).toBeUndefined();
                const receipt = readPullRequestMutationLockReceipt(fixture.root, fixture.number, fixture.ownerOid);
                expect(receipt).toEqual({
                    version: 2,
                    operation: 'review-publication-recovery',
                    number: fixture.number,
                    ownerOid: fixture.ownerOid,
                    adoptedOwnerOid: expect.stringMatching(/^[0-9a-f]{40}$/),
                    head: fixture.head,
                    payloadDigest: reviewPublicationPayloadDigest(
                        reviewPublicationPayload({
                            commitId: fixture.head,
                            event: 'APPROVE',
                            body: 'Attacked; held.',
                            comments: [],
                        })
                    ),
                    outcome: 'absent',
                });
                expect(receipt).not.toHaveProperty('absentAttestation');
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        }
    );

    it('keeps the no-mutation attestation on the adopted owner when recovery is interrupted before the receipt', async () => {
        const fixture = createJournaledRecoveryFixture('remote-mutation-attempted', 422);
        let inspections = 0;
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => {
                        inspections += 1;
                        if (inspections === 2) {
                            throw new Error('remote read failed');
                        }
                        return { state: 'OPEN', head: expectedHead, reviews: [] };
                    })
                )
            ).rejects.toThrow(
                /remote read failed; PR #42 review-publication recovery preserved exact lock owner [0-9a-f]{40}/
            );
            const adoptedOid = readPullRequestMutationLockOid(
                fixture.root,
                pullRequestMutationLockRef(fixture.number),
                fixture.number
            );
            expect(adoptedOid).toMatch(/^[0-9a-f]{40}$/);
            expect(adoptedOid).not.toBe(fixture.ownerOid);
            expect(readPullRequestMutationLockOwner(fixture.root, adoptedOid!, fixture.number)).toMatchObject({
                mutation: { phase: 'remote-mutation-attempted', epoch: 2, definitiveNoMutationHttpStatus: 422 },
            });

            let retries = 0;
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', adoptedOid!],
                    recoveryDependencies(fixture.root, (expectedHead) => {
                        retries += 1;
                        return { state: 'OPEN', head: expectedHead, reviews: [] };
                    })
                )
            ).resolves.toBe(0);
            expect(retries).toBe(2);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('keeps the prepared twin and 422 attestation on the adopted legacy owner when recovery is interrupted before the receipt', async () => {
        const fixture = createTrustedIncidentRecoveryFixture();
        let inspections = 0;
        try {
            await expect(
                runRecoverPublishReviewLockCli([String(fixture.incident.number), '--owner', fixture.ownerOid], {
                    ...recoveryDependencies(fixture.root, (expectedHead) => {
                        inspections += 1;
                        if (inspections === 2) {
                            throw new Error('remote read failed');
                        }
                        return { state: 'OPEN', head: expectedHead, reviews: [] };
                    }),
                    isLegacyOwnerLive: () => false,
                })
            ).rejects.toThrow(
                /remote read failed; PR #3342 review-publication recovery preserved exact lock owner [0-9a-f]{40}/
            );
            const adoptedOid = readPullRequestMutationLockOid(
                fixture.root,
                pullRequestMutationLockRef(fixture.incident.number),
                fixture.incident.number
            );
            expect(adoptedOid).toMatch(/^[0-9a-f]{40}$/);
            expect(adoptedOid).not.toBe(fixture.ownerOid);
            expect(readPullRequestMutationLockOwner(fixture.root, adoptedOid!, fixture.incident.number)).toMatchObject({
                mutation: { phase: 'prepared', epoch: 1 },
                recovery: { legacyOwnerOid: fixture.ownerOid, definitiveNoMutationHttpStatus: 422 },
            });

            let retries = 0;
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.incident.number), '--owner', adoptedOid!],
                    recoveryDependencies(fixture.root, (expectedHead) => {
                        retries += 1;
                        return { state: 'OPEN', head: expectedHead, reviews: [] };
                    })
                )
            ).resolves.toBe(0);
            expect(retries).toBe(2);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    pullRequestMutationLockRef(fixture.incident.number),
                    fixture.incident.number
                )
            ).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains the adopted lock after an injected crash following exact receipt persistence', async () => {
        const fixture = createJournaledRecoveryFixture('prepared');
        let persistedReceipt: RecoveryReceipt | undefined;
        try {
            await expect(
                runRecoverPublishReviewLockCli([String(fixture.number), '--owner', fixture.ownerOid], {
                    ...recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    })),
                    afterRecoveryReceiptPersisted: (receipt) => {
                        persistedReceipt = receipt;
                        expect(receipt.adoptedOwnerOid).not.toBe(fixture.ownerOid);
                        expect(
                            readPullRequestMutationLockReceipt(fixture.root, fixture.number, fixture.ownerOid)
                        ).toEqual(receipt);
                        expect(
                            readPullRequestMutationLockOid(
                                fixture.root,
                                pullRequestMutationLockRef(fixture.number),
                                fixture.number
                            )
                        ).toBe(receipt.adoptedOwnerOid);
                        throw new Error('injected crash after exact receipt persistence');
                    },
                })
            ).rejects.toThrow(/injected crash after exact receipt persistence/);
            expect(persistedReceipt).toBeDefined();
            expect(persistedReceipt!.adoptedOwnerOid).not.toBe(fixture.ownerOid);
            expect(readPullRequestMutationLockReceipt(fixture.root, fixture.number, fixture.ownerOid)).toEqual(
                persistedReceipt
            );
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(persistedReceipt!.adoptedOwnerOid);
            let authenticated = false;
            const replayDependencies = {
                ...recoveryDependencies(fixture.root, (expectedHead) => ({
                    state: 'OPEN',
                    head: expectedHead,
                    reviews: [],
                })),
                authenticateReviewer: async () => {
                    authenticated = true;
                    throw new Error('replay must not authenticate');
                },
            };
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    replayDependencies
                )
            ).resolves.toBe(0);
            expect(authenticated).toBe(false);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBeUndefined();
            expect(readPullRequestMutationLockReceipt(fixture.root, fixture.number, fixture.ownerOid)).toEqual(
                persistedReceipt
            );
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    replayDependencies
                )
            ).resolves.toBe(0);
            expect(authenticated).toBe(false);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('recognizes one exact landed review, records recovery, and makes its exact owner idempotent', async () => {
        const fixture = createJournaledRecoveryFixture();
        const exact = {
            id: 1,
            state: 'APPROVED',
            body: 'Attacked; held.',
            commitId: fixture.head,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            comments: [],
        };
        try {
            const dependencies = recoveryDependencies(fixture.root, (expectedHead) => ({
                state: 'OPEN',
                head: expectedHead,
                reviews: [exact],
            }));

            await expect(
                runRecoverPublishReviewLockCli([String(fixture.number), '--owner', fixture.ownerOid], dependencies)
            ).resolves.toBe(0);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBeUndefined();
            expect(readPullRequestMutationLockReceipt(fixture.root, fixture.number, fixture.ownerOid)).toMatchObject({
                version: 2,
                operation: 'review-publication-recovery',
                number: fixture.number,
                ownerOid: fixture.ownerOid,
                adoptedOwnerOid: expect.stringMatching(/^[0-9a-f]{40}$/),
                head: fixture.head,
                payloadDigest: reviewPublicationPayloadDigest(
                    reviewPublicationPayload({
                        commitId: fixture.head,
                        event: 'APPROVE',
                        body: 'Attacked; held.',
                        comments: [],
                    })
                ),
                outcome: 'landed',
            });
            await expect(
                runRecoverPublishReviewLockCli([String(fixture.number), '--owner', fixture.ownerOid], dependencies)
            ).resolves.toBe(0);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('replays a persisted recovery receipt by releasing only its exact adopted owner', async () => {
        const fixture = createJournaledRecoveryFixture('prepared');
        let authenticated = false;
        try {
            const originalOwner = readPullRequestMutationLockOwner(fixture.root, fixture.ownerOid, fixture.number);
            if (originalOwner.version !== 3) {
                throw new Error('test fixture is not a journaled publication owner');
            }
            const adoptedOid = writePullRequestMutationLockOwner(
                fixture.root,
                {
                    ...originalOwner,
                    pid: process.pid,
                    ownerFence: { kind: 'pid', pid: process.pid, startedAt: 'replay-process' },
                    mutation: { ...originalOwner.mutation, epoch: originalOwner.mutation.epoch + 1 },
                },
                fixture.number
            );
            runGit(fixture.root, [
                'update-ref',
                pullRequestMutationLockRef(fixture.number),
                adoptedOid,
                fixture.ownerOid,
            ]);
            const receiptOid = writePullRequestMutationLockReceipt(
                fixture.root,
                {
                    version: 2,
                    operation: 'review-publication-recovery',
                    number: fixture.number,
                    ownerOid: fixture.ownerOid,
                    adoptedOwnerOid: adoptedOid,
                    head: fixture.head,
                    payloadDigest: 'c'.repeat(64),
                    outcome: 'absent',
                },
                fixture.number
            );
            runGit(fixture.root, [
                'update-ref',
                reviewPublicationRecoveryReceiptRef(fixture.number, fixture.ownerOid),
                receiptOid,
            ]);

            await expect(
                runRecoverPublishReviewLockCli([String(fixture.number), '--owner', fixture.ownerOid], {
                    ...recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    })),
                    authenticateReviewer: async () => {
                        authenticated = true;
                        throw new Error('replay must not authenticate');
                    },
                })
            ).rejects.toThrow(/exact adopted owner, head, and payload/);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(adoptedOid);
            const exactReceiptOid = writePullRequestMutationLockReceipt(
                fixture.root,
                {
                    version: 2,
                    operation: 'review-publication-recovery',
                    number: fixture.number,
                    ownerOid: fixture.ownerOid,
                    adoptedOwnerOid: adoptedOid,
                    head: fixture.head,
                    payloadDigest: originalOwner.payloadDigest,
                    outcome: 'absent',
                },
                fixture.number
            );
            runGit(fixture.root, [
                'update-ref',
                reviewPublicationRecoveryReceiptRef(fixture.number, fixture.ownerOid),
                exactReceiptOid,
                receiptOid,
            ]);

            let replacementOid: string | undefined;
            await expect(
                runRecoverPublishReviewLockCli([String(fixture.number), '--owner', fixture.ownerOid], {
                    ...recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    })),
                    authenticateReviewer: async () => {
                        authenticated = true;
                        throw new Error('replay must not authenticate');
                    },
                    beforeReplayReceiptRelease: (receipt) => {
                        expect(receipt).toMatchObject({
                            number: fixture.number,
                            ownerOid: fixture.ownerOid,
                            adoptedOwnerOid: adoptedOid,
                            head: fixture.head,
                            payloadDigest: originalOwner.payloadDigest,
                            outcome: 'absent',
                        });
                        replacementOid = writePullRequestMutationLockOwner(
                            fixture.root,
                            {
                                ...originalOwner,
                                pid: process.pid,
                                ownerFence: { kind: 'pid', pid: process.pid, startedAt: 'replacement-process' },
                                mutation: { ...originalOwner.mutation, epoch: originalOwner.mutation.epoch + 2 },
                            },
                            fixture.number
                        );
                        runGit(fixture.root, [
                            'update-ref',
                            pullRequestMutationLockRef(fixture.number),
                            replacementOid,
                            adoptedOid,
                        ]);
                    },
                })
            ).rejects.toThrow(/delivery lock ownership changed before release/);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(replacementOid);
            runGit(fixture.root, [
                'update-ref',
                pullRequestMutationLockRef(fixture.number),
                adoptedOid,
                replacementOid!,
            ]);

            await expect(
                runRecoverPublishReviewLockCli([String(fixture.number), '--owner', fixture.ownerOid], {
                    ...recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    })),
                    authenticateReviewer: async () => {
                        authenticated = true;
                        throw new Error('replay must not authenticate');
                    },
                })
            ).resolves.toBe(0);
            expect(authenticated).toBe(false);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBeUndefined();
            await expect(
                runRecoverPublishReviewLockCli([String(fixture.number), '--owner', fixture.ownerOid], {
                    ...recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    })),
                    authenticateReviewer: async () => {
                        authenticated = true;
                        throw new Error('replay must not authenticate');
                    },
                })
            ).resolves.toBe(0);
            expect(authenticated).toBe(false);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains the adopted owner when the exact reviewer review appears between reconciliation reads', async () => {
        const fixture = createJournaledRecoveryFixture();
        const exact = {
            id: 1,
            state: 'APPROVED',
            body: 'Attacked; held.',
            commitId: fixture.head,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            comments: [],
        };
        let inspections = 0;
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => {
                        inspections += 1;
                        return {
                            state: 'OPEN',
                            head: expectedHead,
                            reviews: inspections === 1 ? [] : [exact],
                        };
                    })
                )
            ).rejects.toThrow(/remote state changed during reconciliation.*preserved exact lock owner [0-9a-f]{40}/);
            expect(inspections).toBe(2);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).not.toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it.each([
        ['advanced head', 'OPEN', 'b'.repeat(40)],
        ['closed pull request', 'CLOSED', 'b'.repeat(40)],
    ])('reconciles an exact expected-head review after an %s', async (_label, state, currentHead) => {
        const fixture = createJournaledRecoveryFixture();
        const exact = {
            id: 1,
            state: 'APPROVED',
            body: 'Attacked; held.',
            commitId: fixture.head,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            comments: [],
        };
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, () => ({ state, head: currentHead, reviews: [exact] }))
                )
            ).resolves.toBe(0);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('rejects every legacy v1 owner not named by the trusted incident receipt', async () => {
        const fixture = createLegacyRecoveryFixture();
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    }))
                )
            ).rejects.toThrow(/requires the exact trusted incident receipt/);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it.each([
        ['PID', (value: any) => ({ ...value, owner: { ...value.owner, pid: value.owner.pid + 1 } })],
        [
            'token',
            (value: any) => ({ ...value, owner: { ...value.owner, token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }),
        ],
        ['HTTP status', (value: any) => ({ ...value, definitiveNoMutationHttpStatus: 400 })],
        ['failed payload', (value: any) => ({ ...value, failedPayload: { ...value.failedPayload, body: 'drift' } })],
        [
            'prepared payload',
            (value: any) => ({ ...value, preparedPayload: { ...value.preparedPayload, body: 'drift' } }),
        ],
        ['prepared head', (value: any) => ({ ...value, expectedHead: 'a'.repeat(40) })],
        ['reviewer actor', (value: any) => ({ ...value, reviewerActorNodeId: 'other-actor' })],
    ])('retains the exact PR 3342 owner when trusted incident %s drifts', async (_label, mutate) => {
        const fixture = createTrustedIncidentRecoveryFixture();
        try {
            expect(fixture.ownerOid).toBe(fixture.incident.ownerOid);
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.incident.number), '--owner', fixture.incident.ownerOid],
                    {
                        ...recoveryDependencies(fixture.root, (expectedHead) => ({
                            state: 'OPEN',
                            head: expectedHead,
                            reviews: [],
                        })),
                        isLegacyOwnerLive: () => false,
                        legacyIncident: () => mutate(fixture.incident),
                    }
                )
            ).rejects.toThrow(/exact trusted incident receipt/);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    pullRequestMutationLockRef(fixture.incident.number),
                    fixture.incident.number
                )
            ).toBe(fixture.incident.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('releases only the exact trusted PR 3342 legacy receipt and owner after no-review reads', async () => {
        const fixture = createTrustedIncidentRecoveryFixture();
        let inspections = 0;
        try {
            expect(fixture.ownerOid).toBe(fixture.incident.ownerOid);
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.incident.number), '--owner', fixture.incident.ownerOid],
                    {
                        ...recoveryDependencies(fixture.root, (expectedHead) => {
                            inspections += 1;
                            return { state: 'OPEN', head: expectedHead, reviews: [] };
                        }),
                        isLegacyOwnerLive: () => false,
                    }
                )
            ).resolves.toBe(0);
            expect(inspections).toBe(2);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    pullRequestMutationLockRef(fixture.incident.number),
                    fixture.incident.number
                )
            ).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains a live journaled owner without inspecting or adopting it', async () => {
        const fixture = createJournaledRecoveryFixture();
        try {
            await expect(
                runRecoverPublishReviewLockCli([String(fixture.number), '--owner', fixture.ownerOid], {
                    ...recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    })),
                    isOwnerLive: () => true,
                })
            ).rejects.toThrow(/still held by a live process/);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains a live legacy incident owner without inspecting or adopting it', async () => {
        const fixture = createTrustedIncidentRecoveryFixture();
        let inspections = 0;
        try {
            await expect(
                runRecoverPublishReviewLockCli([String(fixture.incident.number), '--owner', fixture.ownerOid], {
                    ...recoveryDependencies(fixture.root, (expectedHead) => {
                        inspections += 1;
                        return { state: 'OPEN', head: expectedHead, reviews: [] };
                    }),
                    isLegacyOwnerLive: () => true,
                })
            ).rejects.toThrow(/legacy review-publication lock is still held by a live process/);
            expect(inspections).toBe(0);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    pullRequestMutationLockRef(fixture.incident.number),
                    fixture.incident.number
                )
            ).toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    // The trusted incident pins the legacy owner's pid, so no real process can exercise the default
    // `process.kill(pid, 0)` probe's branches deterministically on macOS or Linux (pid 1 would give
    // EPERM but is unreachable through the pinned fixture). Spying on `process.kill` pins the branch
    // contract directly on every platform: ESRCH proceeds, EPERM rethrows, a live process refuses.
    it('continues trusted incident recovery when the default legacy liveness probe reports ESRCH', async () => {
        const fixture = createTrustedIncidentRecoveryFixture();
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
            throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
        });
        let inspections = 0;
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.incident.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => {
                        inspections += 1;
                        return { state: 'OPEN', head: expectedHead, reviews: [] };
                    })
                )
            ).resolves.toBe(0);
            expect(kill).toHaveBeenCalledTimes(1);
            expect(kill).toHaveBeenCalledWith(fixture.incident.owner.pid, 0);
            expect(inspections).toBe(2);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    pullRequestMutationLockRef(fixture.incident.number),
                    fixture.incident.number
                )
            ).toBeUndefined();
        } finally {
            kill.mockRestore();
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('rethrows when the default legacy liveness probe reports EPERM', async () => {
        const fixture = createTrustedIncidentRecoveryFixture();
        const eperm = Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
            throw eperm;
        });
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.incident.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    }))
                )
            ).rejects.toBe(eperm);
            expect(kill).toHaveBeenCalledTimes(1);
            expect(kill).toHaveBeenCalledWith(fixture.incident.owner.pid, 0);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    pullRequestMutationLockRef(fixture.incident.number),
                    fixture.incident.number
                )
            ).toBe(fixture.ownerOid);
        } finally {
            kill.mockRestore();
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses trusted incident recovery when the default legacy liveness probe finds the process alive', async () => {
        const fixture = createTrustedIncidentRecoveryFixture();
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.incident.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    }))
                )
            ).rejects.toThrow(/legacy review-publication lock is still held by a live process/);
            expect(kill).toHaveBeenCalledTimes(1);
            expect(kill).toHaveBeenCalledWith(fixture.incident.owner.pid, 0);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    pullRequestMutationLockRef(fixture.incident.number),
                    fixture.incident.number
                )
            ).toBe(fixture.ownerOid);
        } finally {
            kill.mockRestore();
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('fails closed when the exact-owner adoption CAS loses the shared ref', async () => {
        const fixture = createJournaledRecoveryFixture();
        let replacementOid: string | undefined;
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => {
                        if (replacementOid === undefined) {
                            const owner = readPullRequestMutationLockOwner(
                                fixture.root,
                                fixture.ownerOid,
                                fixture.number
                            );
                            replacementOid = writePullRequestMutationLockOwner(
                                fixture.root,
                                { ...owner, token: '33333333-3333-4333-8333-333333333333' },
                                fixture.number
                            );
                            runGit(fixture.root, [
                                'update-ref',
                                pullRequestMutationLockRef(fixture.number),
                                replacementOid,
                            ]);
                        }
                        return { state: 'OPEN', head: expectedHead, reviews: [] };
                    })
                )
            ).rejects.toThrow(/delivery lock ownership changed before recovery/);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(replacementOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains the owner when current-head reviewer evidence is multiple or non-exact', async () => {
        const fixture = createJournaledRecoveryFixture();
        const exact = {
            id: 1,
            state: 'APPROVED',
            body: 'Attacked; held.',
            commitId: fixture.head,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            comments: [],
        };
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [exact, { ...exact, id: 2 }],
                    }))
                )
            ).rejects.toThrow(/ambiguous or non-exact remote review evidence/);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains the original owner when a single landed reviewer review drifts from the exact document', async () => {
        const fixture = createJournaledRecoveryFixture();
        const drifted = {
            id: 1,
            state: 'APPROVED',
            body: 'drifted body',
            commitId: fixture.head,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            comments: [],
        };
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [drifted],
                    }))
                )
            ).rejects.toThrow(/ambiguous or non-exact remote review evidence/);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains an expected-head review that exactly landed under another actor', async () => {
        const fixture = createJournaledRecoveryFixture();
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                        otherActorReviews: [
                            {
                                id: 3,
                                state: 'APPROVED',
                                body: 'Attacked; held.',
                                commitId: expectedHead,
                                actorNodeId: 'human-actor',
                                comments: [],
                            },
                        ],
                    }))
                )
            ).rejects.toThrow(/unauthorized landed review evidence/);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('recovers an orchestrator acceptance publication past the reviewer approval already landed at the same body', async () => {
        const fixture = createJournaledRecoveryFixture('prepared');
        try {
            const bundle = join(fixture.root, '.agents', 'review-bundles', `${fixture.number}-${fixture.head}`);
            const document = parseAcceptanceDocument({
                format: 'compact-v1',
                event: 'APPROVE',
                body: 'Attacked; held.',
                evidence: approvalEvidence(fixture.head),
            });
            writeFileSync(join(bundle, 'acceptance.json'), JSON.stringify(document));
            const owner = readPullRequestMutationLockOwner(fixture.root, fixture.ownerOid, fixture.number);
            if (owner.version !== 3) {
                throw new Error('expected publication owner');
            }
            const ownerOid = writePullRequestMutationLockOwner(
                fixture.root,
                {
                    ...owner,
                    reviewerActorNodeId: ORCHESTRATOR_USER_NODE_ID,
                    payloadDigest: reviewPublicationPayloadDigest(
                        reviewPublicationPayload({
                            commitId: fixture.head,
                            event: document.event,
                            body: renderReviewDocumentBody(document),
                            comments: document.comments,
                        })
                    ),
                },
                fixture.number
            );
            runGit(fixture.root, [
                'update-ref',
                pullRequestMutationLockRef(fixture.number),
                ownerOid,
                fixture.ownerOid,
            ]);
            await expect(
                runRecoverPublishReviewLockCli([String(fixture.number), '--owner', ownerOid], {
                    ...recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                        otherActorReviews: [
                            {
                                id: 7,
                                state: 'APPROVED',
                                body: 'Attacked; held.',
                                commitId: expectedHead,
                                actorNodeId: REVIEWER_BOT_NODE_ID,
                                comments: [],
                            },
                        ],
                    })),
                    authenticateOrchestrator: async () => ({
                        minted: { actorNodeId: ORCHESTRATOR_USER_NODE_ID },
                        session: { configDir: '/tmp/user', env: {}, dispose: () => undefined },
                    }),
                })
            ).resolves.toBe(0);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('recovers a reviewer publication past the orchestrator acceptance already landed at the same body', async () => {
        const fixture = createJournaledRecoveryFixture('prepared');
        try {
            const bundle = join(fixture.root, '.agents', 'review-bundles', `${fixture.number}-${fixture.head}`);
            const document = parseReviewDocument({
                format: 'compact-v1',
                event: 'APPROVE',
                body: 'Attacked; held.',
                evidence: approvalEvidence(fixture.head),
                reviewerModel: 'claude-sonnet-5',
            });
            writeFileSync(join(bundle, 'review.json'), JSON.stringify(document));
            const owner = readPullRequestMutationLockOwner(fixture.root, fixture.ownerOid, fixture.number);
            if (owner.version !== 3) {
                throw new Error('expected publication owner');
            }
            const ownerOid = writePullRequestMutationLockOwner(
                fixture.root,
                {
                    ...owner,
                    reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
                    payloadDigest: reviewPublicationPayloadDigest(
                        reviewPublicationPayload({
                            commitId: fixture.head,
                            event: document.event,
                            body: renderReviewDocumentBody(document),
                            comments: document.comments,
                        })
                    ),
                },
                fixture.number
            );
            runGit(fixture.root, [
                'update-ref',
                pullRequestMutationLockRef(fixture.number),
                ownerOid,
                fixture.ownerOid,
            ]);
            await expect(
                runRecoverPublishReviewLockCli([String(fixture.number), '--owner', ownerOid], {
                    ...recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                        otherActorReviews: [
                            {
                                id: 8,
                                state: 'APPROVED',
                                body: 'Attacked; held.',
                                commitId: expectedHead,
                                actorNodeId: ORCHESTRATOR_USER_NODE_ID,
                                comments: [],
                            },
                        ],
                    })),
                })
            ).resolves.toBe(0);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('recovers a reviewer approval publication past the orchestrator acceptance already landed at the same body', async () => {
        const fixture = createJournaledRecoveryFixture('prepared');
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                        otherActorReviews: [
                            {
                                id: 8,
                                state: 'APPROVED',
                                body: 'Attacked; held.',
                                commitId: expectedHead,
                                actorNodeId: ORCHESTRATOR_USER_NODE_ID,
                                comments: [],
                            },
                        ],
                    }))
                )
            ).resolves.toBe(0);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains the adopted owner when unauthorized landed evidence appears only on the second read', async () => {
        const fixture = createJournaledRecoveryFixture();
        let calls = 0;
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => {
                        calls += 1;
                        if (calls === 1) {
                            return { state: 'OPEN', head: expectedHead, reviews: [] };
                        }
                        return {
                            state: 'OPEN',
                            head: expectedHead,
                            reviews: [],
                            otherActorReviews: [
                                {
                                    id: 4,
                                    state: 'APPROVED',
                                    body: 'Attacked; held.',
                                    commitId: expectedHead,
                                    actorNodeId: 'human-actor',
                                    comments: [],
                                },
                            ],
                        };
                    })
                )
            ).rejects.toThrow(
                /unauthorized landed review evidence; PR #42 review-publication recovery preserved exact lock owner/
            );
            const retainedOid = readPullRequestMutationLockOid(
                fixture.root,
                pullRequestMutationLockRef(fixture.number),
                fixture.number
            );
            expect(retainedOid).toMatch(/^[0-9a-f]{40}$/);
            expect(retainedOid).not.toBe(fixture.ownerOid);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    reviewPublicationRecoveryReceiptRef(fixture.number, fixture.ownerOid),
                    fixture.number
                )
            ).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains the adopted owner when the pull request closes between reconciliation reads', async () => {
        const fixture = createJournaledRecoveryFixture();
        let calls = 0;
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => {
                        calls += 1;
                        return { state: calls === 1 ? 'OPEN' : 'CLOSED', head: expectedHead, reviews: [] };
                    })
                )
            ).rejects.toThrow(
                /remote state changed during reconciliation; PR #42 review-publication recovery preserved exact lock owner/
            );
            expect(calls).toBe(2);
            const retainedOid = readPullRequestMutationLockOid(
                fixture.root,
                pullRequestMutationLockRef(fixture.number),
                fixture.number
            );
            expect(retainedOid).toMatch(/^[0-9a-f]{40}$/);
            expect(retainedOid).not.toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains the adopted owner when the pull request head advances between reconciliation reads', async () => {
        const fixture = createJournaledRecoveryFixture();
        let calls = 0;
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, () => {
                        calls += 1;
                        return { state: 'OPEN', head: calls === 1 ? 'b'.repeat(40) : 'c'.repeat(40), reviews: [] };
                    })
                )
            ).rejects.toThrow(
                /remote state changed during reconciliation; PR #42 review-publication recovery preserved exact lock owner/
            );
            expect(calls).toBe(2);
            const retainedOid = readPullRequestMutationLockOid(
                fixture.root,
                pullRequestMutationLockRef(fixture.number),
                fixture.number
            );
            expect(retainedOid).toMatch(/^[0-9a-f]{40}$/);
            expect(retainedOid).not.toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains the adopted owner with its exact object id when the second remote read fails', async () => {
        const fixture = createJournaledRecoveryFixture();
        let calls = 0;
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => {
                        calls += 1;
                        if (calls === 2) {
                            throw new Error('remote read failed');
                        }
                        return { state: 'OPEN', head: expectedHead, reviews: [] };
                    })
                )
            ).rejects.toThrow(
                /remote read failed; PR #42 review-publication recovery preserved exact lock owner [0-9a-f]{40}/
            );
            const retainedOid = readPullRequestMutationLockOid(
                fixture.root,
                pullRequestMutationLockRef(fixture.number),
                fixture.number
            );
            expect(retainedOid).toMatch(/^[0-9a-f]{40}$/);
            expect(retainedOid).not.toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it.each([
        ['invalid JSON', '{'],
        [
            'missing start-time fence',
            JSON.stringify({
                version: 3,
                pid: 999_999,
                token: '44444444-4444-4444-8444-444444444444',
                operation: 'review-publication',
                number: 42,
                expectedHead: 'a'.repeat(40),
                payloadDigest: 'd'.repeat(64),
                reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
                ownerFence: { kind: 'pid', pid: 999_999 },
                mutation: { phase: 'prepared', epoch: 1 },
            }),
        ],
    ])('retains malformed v3 owner data (%s)', async (_label, contents) => {
        const fixture = createJournaledRecoveryFixture();
        try {
            const oid = writeRawLockOwner(fixture.root, contents);
            runGit(fixture.root, ['update-ref', pullRequestMutationLockRef(fixture.number), oid]);
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', oid],
                    recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    }))
                )
            ).rejects.toThrow(/delivery lock ownership is malformed/);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(oid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains a valid normal v3 owner with an unexpected top-level key', async () => {
        const fixture = createJournaledRecoveryFixture();
        try {
            const normalOwner = readPullRequestMutationLockOwner(fixture.root, fixture.ownerOid, fixture.number);
            const oid = writeRawLockOwner(fixture.root, JSON.stringify({ ...normalOwner, unexpected: true }));
            runGit(fixture.root, ['update-ref', pullRequestMutationLockRef(fixture.number), oid]);

            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', oid],
                    recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    }))
                )
            ).rejects.toThrow(/delivery lock ownership is malformed/);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(oid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('retains a valid recovered v3 owner with an unexpected top-level key', async () => {
        const fixture = createTrustedIncidentRecoveryFixture();
        try {
            const recoveredOwner = {
                version: 3 as const,
                pid: fixture.incident.owner.pid,
                token: fixture.incident.owner.token,
                operation: 'review-publication' as const,
                number: fixture.incident.number,
                expectedHead: fixture.incident.expectedHead,
                payloadDigest: reviewPublicationPayloadDigest(
                    reviewPublicationPayload({
                        commitId: fixture.incident.expectedHead,
                        event: fixture.incident.preparedPayload.event,
                        body: fixture.incident.preparedPayload.body,
                        comments: fixture.incident.preparedPayload.comments,
                    })
                ),
                reviewerActorNodeId: fixture.incident.reviewerActorNodeId,
                ownerFence: { kind: 'pid' as const, pid: fixture.incident.owner.pid, startedAt: 'test-process' },
                mutation: { phase: 'prepared' as const, epoch: 1 },
                recovery: {
                    legacyOwnerOid: fixture.incident.ownerOid,
                    definitiveNoMutationHttpStatus: 422 as const,
                },
                unexpected: true,
            };
            const oid = writeRawLockOwner(fixture.root, JSON.stringify(recoveredOwner));
            runGit(fixture.root, ['update-ref', pullRequestMutationLockRef(fixture.incident.number), oid]);

            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.incident.number), '--owner', oid],
                    recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    }))
                )
            ).rejects.toThrow(/delivery lock ownership is malformed/);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    pullRequestMutationLockRef(fixture.incident.number),
                    fixture.incident.number
                )
            ).toBe(oid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('rejects a mixed paginated review response before recovery can adopt the owner', async () => {
        const fixture = createJournaledRecoveryFixture();
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) =>
                        inspectReviewPublicationRemote(fixture.number, REVIEWER_BOT_NODE_ID, expectedHead, (args) => {
                            if (args[0] === 'pr') {
                                return JSON.stringify({ state: 'OPEN', headRefOid: expectedHead });
                            }
                            return JSON.stringify([
                                [],
                                {
                                    id: 1,
                                    state: 'APPROVED',
                                    body: 'unexpected bare review',
                                    commit_id: expectedHead,
                                    user: { node_id: REVIEWER_BOT_NODE_ID },
                                },
                            ]);
                        })
                    )
                )
            ).rejects.toThrow(/review-publication recovery reviews are unreadable/);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it.each([
        [
            'uncertain remote read',
            () => {
                throw new Error('remote read is uncertain');
            },
        ],
    ])('retains the original owner on %s', async (_label, inspect) => {
        const fixture = createJournaledRecoveryFixture();
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, inspect)
                )
            ).rejects.toThrow();
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(fixture.ownerOid);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it.each([
        [
            'payload digest',
            (owner: Extract<PullRequestMutationLockOwner, { version: 3 }>) => ({
                ...owner,
                payloadDigest: 'c'.repeat(64),
            }),
            () => undefined,
            /payload does not match the retained lock/,
        ],
        [
            'expected head',
            (owner: Extract<PullRequestMutationLockOwner, { version: 3 }>) => ({
                ...owner,
                expectedHead: 'd'.repeat(40),
            }),
            (fixture: ReturnType<typeof createJournaledRecoveryFixture>) => {
                const bundle = join(fixture.root, '.agents', 'review-bundles', `${fixture.number}-${'d'.repeat(40)}`);
                mkdirSync(bundle, { recursive: true });
                writeFileSync(
                    join(bundle, 'review.json'),
                    JSON.stringify({ event: 'APPROVE', body: 'Attacked; held.', comments: [] })
                );
                writeFileSync(join(bundle, 'diff.patch'), '');
            },
            /payload does not match the retained lock/,
        ],
        [
            'reviewer actor',
            (owner: Extract<PullRequestMutationLockOwner, { version: 3 }>) => ({
                ...owner,
                reviewerActorNodeId: 'other-actor',
            }),
            () => undefined,
            /retained an unknown actor/,
        ],
    ])('retains a prepared v3 lock when its stored %s drifts', async (_label, mutate, prepare, error) => {
        const fixture = createJournaledRecoveryFixture('prepared');
        try {
            const owner = readPullRequestMutationLockOwner(fixture.root, fixture.ownerOid, fixture.number);
            if (owner.version !== 3) {
                throw new Error('test fixture is not a journaled publication owner');
            }
            prepare(fixture);
            const driftedOid = writePullRequestMutationLockOwner(fixture.root, mutate(owner), fixture.number);
            runGit(fixture.root, [
                'update-ref',
                pullRequestMutationLockRef(fixture.number),
                driftedOid,
                fixture.ownerOid,
            ]);
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', driftedOid],
                    recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    }))
                )
            ).rejects.toThrow(error);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBe(driftedOid);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    reviewPublicationRecoveryReceiptRef(fixture.number, driftedOid),
                    fixture.number
                )
            ).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it.each([
        [
            'mutation phase',
            (owner: Extract<PullRequestMutationLockOwner, { version: 3 }>) => ({
                ...owner,
                mutation: { ...owner.mutation, phase: 'remote-mutation-attempted' as const },
            }),
        ],
        [
            'incident receipt binding',
            (owner: Extract<PullRequestMutationLockOwner, { version: 3 }>) => ({
                ...owner,
                recovery: { legacyOwnerOid: 'f'.repeat(40), definitiveNoMutationHttpStatus: 422 as const },
            }),
        ],
    ])('retains an adopted v3 owner when its %s drifts', async (_label, mutate) => {
        const fixture = createTrustedIncidentRecoveryFixture();
        try {
            const payloadDigest = reviewPublicationPayloadDigest(
                reviewPublicationPayload({
                    commitId: fixture.incident.expectedHead,
                    event: fixture.incident.preparedPayload.event,
                    body: fixture.incident.preparedPayload.body,
                    comments: [...fixture.incident.preparedPayload.comments],
                })
            );
            const owner = {
                version: 3 as const,
                pid: fixture.incident.owner.pid,
                token: fixture.incident.owner.token,
                operation: 'review-publication' as const,
                number: fixture.incident.number,
                expectedHead: fixture.incident.expectedHead,
                payloadDigest,
                reviewerActorNodeId: fixture.incident.reviewerActorNodeId,
                ownerFence: { kind: 'pid' as const, pid: fixture.incident.owner.pid, startedAt: 'test-process' },
                mutation: { phase: 'prepared' as const, epoch: 1 },
                recovery: {
                    legacyOwnerOid: fixture.incident.ownerOid,
                    definitiveNoMutationHttpStatus: 422 as const,
                },
            };
            const driftedOid = writePullRequestMutationLockOwner(fixture.root, mutate(owner), fixture.incident.number);
            runGit(fixture.root, [
                'update-ref',
                pullRequestMutationLockRef(fixture.incident.number),
                driftedOid,
                fixture.ownerOid,
            ]);
            await expect(
                runRecoverPublishReviewLockCli([String(fixture.incident.number), '--owner', driftedOid], {
                    ...recoveryDependencies(fixture.root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    })),
                    isOwnerLive: () => false,
                })
            ).rejects.toThrow(/exact journaled incident binding/);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    pullRequestMutationLockRef(fixture.incident.number),
                    fixture.incident.number
                )
            ).toBe(driftedOid);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    reviewPublicationRecoveryReceiptRef(fixture.incident.number, driftedOid),
                    fixture.incident.number
                )
            ).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('uses trusted POSIX process identities and fails closed on unreadable output', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-ps-'));
        const executable = join(root, 'ps');
        const previous = process.env.SOURDAW_TRUSTED_PS_PATH;
        try {
            process.env.SOURDAW_TRUSTED_PS_PATH = executable;
            const writePsOutput = (output: string, status: number = 0) => {
                writeFileSync(executable, `#!/bin/sh\nprintf '%s' '${output}'\nexit ${status}\n`);
                chmodSync(executable, 0o700);
            };
            const groupOwner = publicationLivenessOwner({ kind: 'pgid', pgid: 42, leaderStartedAt: 'leader-start' });
            writePsOutput('42 42 leader-start\n99 42 child-start\n1 1 unrelated-start\n');
            expect(mutationOwnerFenceIsLive(groupOwner)).toBe(true);
            writePsOutput('99 42 child-start\n1 1 unrelated-start\n');
            expect(mutationOwnerFenceIsLive(groupOwner)).toBe(true);
            writePsOutput('42 42 reused-leader-start\n99 42 child-start\n');
            expect(mutationOwnerFenceIsLive(groupOwner)).toBe(false);
            writePsOutput('1 1 unrelated-start\n');
            expect(mutationOwnerFenceIsLive(groupOwner)).toBe(false);
            writePsOutput('not a ps row\n');
            expect(() => mutationOwnerFenceIsLive(groupOwner)).toThrow(/process-group liveness is unreadable/);

            const pidOwner = publicationLivenessOwner({ kind: 'pid', pid: 999_999, startedAt: 'original-pid-start' });
            writePsOutput('original-pid-start\n');
            expect(mutationOwnerFenceIsLive(pidOwner)).toBe(true);
            writePsOutput('reused-pid-start\n');
            expect(mutationOwnerFenceIsLive(pidOwner)).toBe(false);
            writePsOutput('', 2);
            expect(() => mutationOwnerFenceIsLive(pidOwner)).toThrow(/process liveness is unreadable/);
        } finally {
            if (previous === undefined) {
                delete process.env.SOURDAW_TRUSTED_PS_PATH;
            } else {
                process.env.SOURDAW_TRUSTED_PS_PATH = previous;
            }
            removeTemporaryDirectory(root);
        }
    });

    it('uses the trusted Windows process tree when the publication root exits', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-powershell-'));
        const executable = join(root, 'powershell');
        const previous = process.env.SOURDAW_TRUSTED_POWERSHELL_PATH;
        const startedAt = '2026-09-02T10:00:00.0000000Z';
        try {
            process.env.SOURDAW_TRUSTED_POWERSHELL_PATH = executable;
            const writePowerShellOutput = (output: string, status: number = 0) => {
                writeFileSync(executable, `#!/bin/sh\nprintf '%s' '${output}'\nexit ${status}\n`);
                chmodSync(executable, 0o700);
            };
            const owner = publicationLivenessOwner({
                kind: 'win32-process-tree',
                version: 1,
                rootPid: 42,
                rootStartedAt: startedAt,
            });
            writePowerShellOutput(JSON.stringify({ ProcessId: 42, ParentProcessId: 1, CreationDate: startedAt }));
            expect(mutationOwnerFenceIsLive(owner, 'win32')).toBe(true);
            // An exited root whose tree survives is still holding the lock, whether the surviving
            // child started after the root or in the same tick.
            writePowerShellOutput(
                JSON.stringify({ ProcessId: 99, ParentProcessId: 42, CreationDate: '2026-09-02T10:00:01.0000000Z' })
            );
            expect(mutationOwnerFenceIsLive(owner, 'win32')).toBe(true);
            writePowerShellOutput(JSON.stringify({ ProcessId: 99, ParentProcessId: 42, CreationDate: startedAt }));
            expect(mutationOwnerFenceIsLive(owner, 'win32')).toBe(true);
            writePowerShellOutput(
                JSON.stringify({ ProcessId: 99, ParentProcessId: 42, CreationDate: '2026-09-02T09:59:59.0000000Z' })
            );
            expect(mutationOwnerFenceIsLive(owner, 'win32')).toBe(false);
            writePowerShellOutput(
                JSON.stringify([
                    { ProcessId: 42, ParentProcessId: 1, CreationDate: '2026-09-02T11:00:00.0000000Z' },
                    { ProcessId: 98, ParentProcessId: 42, CreationDate: '2026-09-02T10:30:00.0000000Z' },
                ])
            );
            expect(mutationOwnerFenceIsLive(owner, 'win32')).toBe(true);
            writePowerShellOutput(
                JSON.stringify([
                    { ProcessId: 42, ParentProcessId: 1, CreationDate: '2026-09-02T11:00:00.0000000Z' },
                    { ProcessId: 99, ParentProcessId: 42, CreationDate: '2026-09-02T11:00:01.0000000Z' },
                ])
            );
            expect(mutationOwnerFenceIsLive(owner, 'win32')).toBe(false);
            writePowerShellOutput(
                JSON.stringify({ ProcessId: 99, ParentProcessId: 1, CreationDate: '2026-09-02T10:00:01.0000000Z' })
            );
            expect(mutationOwnerFenceIsLive(owner, 'win32')).toBe(false);
            writePowerShellOutput('{');
            expect(() => mutationOwnerFenceIsLive(owner, 'win32')).toThrow(/Windows process liveness is unreadable/);
        } finally {
            if (previous === undefined) {
                delete process.env.SOURDAW_TRUSTED_POWERSHELL_PATH;
            } else {
                process.env.SOURDAW_TRUSTED_POWERSHELL_PATH = previous;
            }
            removeTemporaryDirectory(root);
        }
    });

    it.each(['no receipt', 'mismatched receipt'])(
        'refuses an absent lock with %s before authentication',
        async (shape) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-absent-review-publication-lock-'));
            const number = 42;
            const ownerOid = 'a'.repeat(40);
            let authenticated = false;
            try {
                runGit(root, ['init']);
                if (shape === 'mismatched receipt') {
                    const receiptOid = writePullRequestMutationLockReceipt(root, { version: 1, wrong: true }, number);
                    runGit(root, ['update-ref', reviewPublicationRecoveryReceiptRef(number, ownerOid), receiptOid]);
                }
                await expect(
                    runRecoverPublishReviewLockCli([String(number), '--owner', ownerOid], {
                        ...recoveryDependencies(root, (expectedHead) => ({
                            state: 'OPEN',
                            head: expectedHead,
                            reviews: [],
                        })),
                        authenticateReviewer: async () => {
                            authenticated = true;
                            throw new Error('must not authenticate');
                        },
                    })
                ).rejects.toThrow(`PR #${number} review-publication lock is absent without an exact recovery receipt`);
                expect(authenticated).toBe(false);
            } finally {
                removeTemporaryDirectory(root);
            }
        }
    );

    it('rejects a valid recovery receipt for a different pull request before authentication', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-wrong-recovery-receipt-pr-'));
        const number = 42;
        const ownerOid = 'a'.repeat(40);
        let authenticated = false;
        try {
            runGit(root, ['init']);
            const receiptOid = writePullRequestMutationLockReceipt(
                root,
                {
                    version: 1,
                    operation: 'review-publication-recovery',
                    number: number + 1,
                    ownerOid,
                    head: 'b'.repeat(40),
                    payloadDigest: 'c'.repeat(64),
                    outcome: 'absent',
                },
                number
            );
            runGit(root, ['update-ref', reviewPublicationRecoveryReceiptRef(number, ownerOid), receiptOid]);

            await expect(
                runRecoverPublishReviewLockCli([String(number), '--owner', ownerOid], {
                    ...recoveryDependencies(root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    })),
                    authenticateReviewer: async () => {
                        authenticated = true;
                        throw new Error('must not authenticate');
                    },
                })
            ).rejects.toThrow(`PR #${number} review-publication lock is absent without an exact recovery receipt`);
            expect(authenticated).toBe(false);
        } finally {
            removeTemporaryDirectory(root);
        }
    });

    it.each([
        ['empty object', {}],
        ['array', []],
        [
            'extra key',
            {
                version: 1,
                operation: 'review-publication-recovery',
                number: 42,
                ownerOid: 'a'.repeat(40),
                head: 'b'.repeat(40),
                payloadDigest: 'c'.repeat(64),
                outcome: 'absent',
                extra: true,
            },
        ],
        [
            'uppercase head',
            {
                version: 1,
                operation: 'review-publication-recovery',
                number: 42,
                ownerOid: 'a'.repeat(40),
                head: 'B'.repeat(40),
                payloadDigest: 'c'.repeat(64),
                outcome: 'absent',
            },
        ],
        [
            'short head',
            {
                version: 1,
                operation: 'review-publication-recovery',
                number: 42,
                ownerOid: 'a'.repeat(40),
                head: 'b'.repeat(39),
                payloadDigest: 'c'.repeat(64),
                outcome: 'absent',
            },
        ],
        [
            'uppercase digest',
            {
                version: 1,
                operation: 'review-publication-recovery',
                number: 42,
                ownerOid: 'a'.repeat(40),
                head: 'b'.repeat(40),
                payloadDigest: 'C'.repeat(64),
                outcome: 'absent',
            },
        ],
        [
            'short digest',
            {
                version: 1,
                operation: 'review-publication-recovery',
                number: 42,
                ownerOid: 'a'.repeat(40),
                head: 'b'.repeat(40),
                payloadDigest: 'c'.repeat(63),
                outcome: 'absent',
            },
        ],
        [
            'mismatched owner',
            {
                version: 1,
                operation: 'review-publication-recovery',
                number: 42,
                ownerOid: 'd'.repeat(40),
                head: 'b'.repeat(40),
                payloadDigest: 'c'.repeat(64),
                outcome: 'absent',
            },
        ],
        [
            'unknown outcome',
            {
                version: 1,
                operation: 'review-publication-recovery',
                number: 42,
                ownerOid: 'a'.repeat(40),
                head: 'b'.repeat(40),
                payloadDigest: 'c'.repeat(64),
                outcome: 'other',
            },
        ],
    ])('refuses an absent lock with a malformed recovery receipt: %s', async (_label, receipt) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-malformed-review-publication-receipt-'));
        const number = 42;
        const ownerOid = 'a'.repeat(40);
        let authenticated = false;
        try {
            runGit(root, ['init']);
            const receiptOid = writePullRequestMutationLockReceipt(root, receipt, number);
            runGit(root, ['update-ref', reviewPublicationRecoveryReceiptRef(number, ownerOid), receiptOid]);
            await expect(
                runRecoverPublishReviewLockCli([String(number), '--owner', ownerOid], {
                    ...recoveryDependencies(root, (expectedHead) => ({
                        state: 'OPEN',
                        head: expectedHead,
                        reviews: [],
                    })),
                    authenticateReviewer: async () => {
                        authenticated = true;
                        throw new Error('must not authenticate');
                    },
                })
            ).rejects.toThrow(`PR #${number} review-publication lock is absent without an exact recovery receipt`);
            expect(authenticated).toBe(false);
        } finally {
            removeTemporaryDirectory(root);
        }
    });
});

describe('orchestrator acceptance', () => {
    it('reports the trusted acceptance command for invalid arguments', async () => {
        await expect(runAcceptReviewCli([])).rejects.toThrow('usage: pnpm review:accept');
    });
    function acceptanceFixture(
        input: {
            authActor?: string;
            postedActor?: string;
            postedType?: string;
            postedHead?: string;
            laterHead?: string;
            missingReviewer?: boolean;
            unresolved?: boolean;
            revokeAtFence?: boolean;
            evidenceHead?: string;
        } = {}
    ) {
        const fake = fakePort({
            actorNodeId: input.postedActor ?? ORCHESTRATOR_USER_NODE_ID,
            laterHead: input.laterHead,
            json: {
                format: 'compact-v1',
                event: 'APPROVE',
                body: 'Final contract held.',
                evidence: approvalEvidence(input.evidenceHead),
            },
        });
        const journal = vi.fn();
        const serialize = vi.fn();
        let inFence = false;
        const port: PublishReviewPort = {
            ...fake.port,
            reviewState: () => ({
                latestReviewerStateOnHead:
                    input.missingReviewer || (inFence && input.revokeAtFence) ? null : 'APPROVED',
                latestReviewerReviewDatabaseId: null,
                unresolvedThreads: input.unresolved ? 1 : 0,
            }),
            postReview: (review) => ({
                ...fake.port.postReview(review),
                actorType: input.postedType ?? 'User',
                commitId: input.postedHead ?? 'headsha',
            }),
        };
        const dependencies: AcceptReviewCoordinatorDependencies = {
            primaryRoot: () => '/repo',
            authenticateOrchestrator: async () => ({
                minted: { actorNodeId: input.authActor ?? ORCHESTRATOR_USER_NODE_ID },
                session: { configDir: '/tmp/user', env: {}, dispose: () => undefined },
            }),
            repositoryName: () => 'jcosta33/sourdaw',
            reviewPort: () => port,
            serializeMutation: async (_root, _number, operation, options) => {
                serialize(options);
                inFence = true;
                return operation({
                    ownerOid: 'f'.repeat(40),
                    journalReviewPublication: journal,
                    markRemoteMutationAttempt: () => undefined,
                    markDefinitiveNoMutationHttpStatus: () => undefined,
                    registerSuccessfulCompletion: () => undefined,
                });
            },
            publish: publishPreparedAcceptance,
        };
        return { ...fake, dependencies, journal, serialize };
    }

    it('posts compact acceptance.json with user actor journal after reviewer verification', async () => {
        const fixture = acceptanceFixture();
        await coordinateAcceptReview(42, fixture.dependencies);
        expect(fixture.calls[0]).toContain('/acceptance.json');
        expect(fixture.posted.review?.body).toBe(approvalBody('Final contract held.'));
        expect(fixture.journal).toHaveBeenCalledWith(
            expect.objectContaining({ expectedHead: 'headsha', reviewerActorNodeId: ORCHESTRATOR_USER_NODE_ID })
        );
        // Gate admission accepts only the reviewer App's approval, so the legacy acceptance never labels.
        expect(fixture.labelWrites).toEqual([]);
    });

    it.each([
        { authActor: REVIEWER_BOT_NODE_ID },
        { authActor: 'other' },
        { missingReviewer: true },
        { unresolved: true },
        { revokeAtFence: true },
        { laterHead: 'moved' },
        { evidenceHead: 'stale' },
    ])('refuses invalid admission before journal or POST %j', async (input) => {
        const fixture = acceptanceFixture(input);
        await expect(coordinateAcceptReview(42, fixture.dependencies)).rejects.toThrow();
        expect(fixture.journal).not.toHaveBeenCalled();
        expect(fixture.posted.review).toBeUndefined();
    });

    it.each([{ postedActor: REVIEWER_BOT_NODE_ID }, { postedType: 'Bot' }, { postedHead: 'wrong' }])(
        'refuses a coerced posted actor or head %j',
        async (input) => {
            const fixture = acceptanceFixture(input);
            await expect(coordinateAcceptReview(42, fixture.dependencies)).rejects.toThrow();
            expect(fixture.logs).toEqual([]);
        }
    );

    it('refuses requests for changes in acceptance.json', () => {
        expect(() =>
            parseAcceptanceDocument({ event: 'REQUEST_CHANGES', body: 'no', comments: [validComment] })
        ).toThrow('must APPROVE');
    });

    it.each(
        [
            { format: undefined, altered: false, evidence: false },
            { format: undefined, altered: true, evidence: false },
            { format: undefined, altered: false, evidence: true },
            { format: undefined, altered: true, evidence: true },
            { format: 'compact-v1', altered: false, evidence: true },
            { format: 'compact-v1', altered: true, evidence: true },
        ].flatMap((input) => [true, false].map((acceptance) => ({ ...input, acceptance })))
    )('recovers an exact role publication, %j', async ({ format, altered, evidence, acceptance }) => {
        const fixture = createJournaledRecoveryFixture();
        try {
            const bundle = join(fixture.root, '.agents', 'review-bundles', `${fixture.number}-${fixture.head}`);
            const actorNodeId = acceptance ? ORCHESTRATOR_USER_NODE_ID : REVIEWER_BOT_NODE_ID;
            const raw = {
                ...(format === undefined ? {} : { format }),
                event: 'APPROVE',
                body: 'Final contract held.',
                ...(evidence ? { evidence: approvalEvidence(fixture.head) } : {}),
            };
            const document = acceptance ? parseAcceptanceDocument(raw) : parseReviewDocument(raw);
            writeFileSync(
                join(bundle, acceptance ? 'acceptance.json' : 'review.json'),
                JSON.stringify(altered ? { ...document, body: 'altered' } : document)
            );
            const owner = readPullRequestMutationLockOwner(fixture.root, fixture.ownerOid, fixture.number);
            if (owner.version !== 3) {
                throw new Error('expected publication owner');
            }
            const ownerOid = writePullRequestMutationLockOwner(
                fixture.root,
                {
                    ...owner,
                    reviewerActorNodeId: actorNodeId,
                    payloadDigest: reviewPublicationPayloadDigest(
                        reviewPublicationPayload({
                            commitId: fixture.head,
                            ...document,
                            body: renderReviewDocumentBody(document),
                        })
                    ),
                },
                fixture.number
            );
            runGit(fixture.root, [
                'update-ref',
                pullRequestMutationLockRef(fixture.number),
                ownerOid,
                fixture.ownerOid,
            ]);
            const inspect = vi.fn(() => ({
                state: 'OPEN',
                head: fixture.head,
                reviews: [
                    {
                        id: 99,
                        state: 'APPROVED',
                        body: renderReviewDocumentBody(document),
                        commitId: fixture.head,
                        actorNodeId,
                        comments: [],
                    },
                ],
            }));
            const dependencies = {
                ...recoveryDependencies(fixture.root, inspect),
                authenticateOrchestrator: async () => ({
                    minted: { actorNodeId: ORCHESTRATOR_USER_NODE_ID },
                    session: { configDir: '/tmp/user', env: {}, dispose: () => undefined },
                }),
            };
            if (acceptance) {
                dependencies.authenticateReviewer = async () =>
                    expect.fail('acceptance recovery must not mint reviewer');
            }
            const recovery = runRecoverPublishReviewLockCli(
                [String(fixture.number), '--owner', ownerOid],
                dependencies
            );
            if (altered) {
                await expect(recovery).rejects.toThrow('payload does not match');
                expect(inspect).not.toHaveBeenCalled();
                expect(
                    readPullRequestMutationLockOid(
                        fixture.root,
                        pullRequestMutationLockRef(fixture.number),
                        fixture.number
                    )
                ).toBe(ownerOid);
            } else {
                await expect(recovery).resolves.toBe(0);
                expect(inspect).toHaveBeenCalledTimes(2);
            }
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });
});

describe('fresh reviewer dossier publication', () => {
    const head = 'c'.repeat(40);
    const base = 'd'.repeat(40);
    const number = 42;

    function riskPlan(overrides: Partial<ReviewRiskPlan> = {}): ReviewRiskPlan {
        return {
            format: 'risk-plan-v1',
            pr: number,
            headSha: head,
            baseSha: base,
            riskClasses: ['small'],
            requiredStances: ['correctness', 'test-validity'],
            triggers: ['small:handwritten-lines<=200'],
            ...overrides,
        };
    }

    /** A tooling change under `scripts/`: small by size, but reviewed with the module-boundaries stance. */
    function toolingRiskPlan(): ReviewRiskPlan {
        return riskPlan({
            riskClasses: ['small-tooling'],
            requiredStances: ['correctness', 'module-boundaries', 'test-validity'],
            triggers: ['small-tooling:handwritten-lines<=200:outside-src'],
        });
    }

    /** A patch adding `added` lines to one file, the shape `git diff` writes into a bundle's diff.patch. */
    function patchAdding(path: string, added: number): string {
        return [
            `diff --git a/${path} b/${path}`,
            'index 1111111..2222222 100644',
            `--- a/${path}`,
            `+++ b/${path}`,
            `@@ -1,0 +1,${added} @@`,
            ...Array.from({ length: added }, (_, index) => `+line ${index}`),
            '',
        ].join('\n');
    }

    /** The round's default draws: three distinct stances, one of them strongest. */
    const defaultDraws: ReviewDraw[] = [
        { stance: 'correctness', reviewerModel: 'review-model', tier: 'strongest', outcome: 'clean' },
        { stance: 'test-validity', reviewerModel: 'review-model', tier: 'standard', outcome: 'clean' },
        { stance: 'stale binding', reviewerModel: 'review-model', tier: 'standard', outcome: 'clean' },
    ];

    const reviewDocument: ReviewDocument = {
        format: 'compact-v1',
        event: 'APPROVE',
        body: 'Attacked the dossier gate; it held.',
        comments: [],
        evidence: approvalEvidence(head),
        reviewerModel: 'glm-5.3-flash',
    };

    /** The canonical record publication itself derives for the given round. */
    function derivedRecord(
        input: {
            draws?: ReviewDraw[];
            comments?: { path: string; line: number; side: 'LEFT' | 'RIGHT' }[];
            recommendation?: 'approve' | 'request-changes';
            evidence?: { observable: string; verification: string; observed: string }[];
        } = {}
    ): ReturnType<typeof buildReviewDossier> {
        return buildReviewDossier({
            plan: riskPlan(),
            persisted: undefined,
            draws: input.draws ?? defaultDraws,
            evidence: input.evidence ?? approvalEvidence(head).claims,
            comments: input.comments ?? [],
            recommendation: input.recommendation ?? 'approve',
        });
    }

    const targetDiff = [
        'diff --git a/scripts/target.ts b/scripts/target.ts',
        'index 1111111..2222222 100644',
        '--- a/scripts/target.ts',
        '+++ b/scripts/target.ts',
        '@@ -2,3 +2,4 @@',
        ' context2',
        ' context3',
        ' context4',
        '+added',
        '',
    ].join('\n');

    /** A REQUEST_CHANGES document whose one finding sits on an added line of `targetDiff`. */
    function changesDocument(): Record<string, unknown> {
        return {
            event: 'REQUEST_CHANGES',
            body: 'One blocking finding.',
            comments: [
                {
                    path: 'scripts/target.ts',
                    line: 5,
                    side: 'RIGHT',
                    defect: 'the gate reads the wrong base',
                    consequence: 'a foreign commit slips the authorship gate',
                    done: 'read the comparison base',
                },
            ],
            reviewerModel: 'glm-5.3-flash',
        };
    }

    /** `count` reviewer request-changes rounds in the public history. */
    function requestChangesRounds(count: number): PublicReview[] {
        return Array.from({ length: count }, (_, index) => ({
            id: index + 1,
            state: 'CHANGES_REQUESTED',
            commitId: head,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            body: 'round',
        }));
    }

    function expectedFreezeRefusal(observed: number): string {
        return (
            `review round freeze: PR #${number} has taken ${observed} reviewer request-changes rounds, at or above the freeze threshold ${REVIEW_ROUND_FREEZE_THRESHOLD}; ` +
            'no further reviewer publication is admitted. Respin the change as one consolidated fresh pull request, ' +
            `then close this one with pnpm pr:supersede ${number} once the replacement merges`
        );
    }

    function readJsonFile(path: string): unknown {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        return parsed;
    }

    function refusalMessage(run: () => unknown): string {
        try {
            run();
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
        throw new Error('expected the publication to refuse');
    }

    /** Runs a publication that must refuse before every side effect, returning its message. */
    function refusedBeforeSideEffects(fixture: ReturnType<typeof dossierFixture>): string {
        const journal = vi.fn();
        const message = refusalMessage(() =>
            publishReview(number, fixture.port, {
                ownerOid: 'f'.repeat(40),
                journalReviewPublication: journal,
                markRemoteMutationAttempt: () => undefined,
                markDefinitiveNoMutationHttpStatus: () => undefined,
                registerSuccessfulCompletion: () => undefined,
            })
        );
        expect(fixture.writes).toEqual([]);
        expect(journal).not.toHaveBeenCalled();
        expect(fixture.calls).not.toContain('post');
        expect(fixture.posted.review).toBeUndefined();
        return message;
    }

    function dossierFixture(
        input: {
            plan?: unknown;
            /** The draws review.json carries; null writes none, and an explicit document keeps its own. */
            draws?: unknown;
            /** A raw dossier.json: a persisted record or any retired caller input. */
            dossier?: unknown;
            /** Extra raw bundle files, such as retired caller documents or semantic-ci.json. */
            files?: Record<string, unknown>;
            document?: unknown;
            documentName?: string;
            manifest?: Record<string, unknown>;
            labels?: { name: string; description?: string }[];
            writable?: boolean;
            reviewComments?: PublishedReviewComment[];
            remoteReviews?: Record<number, RemotePublishedReview | undefined>;
            publicReviews?: PublicReview[];
            publicReviewComments?: PublicReviewComment[];
            diff?: string;
            /** Makes the approval context read the bundle manifest, as the production port does. */
            approvalContextReadsManifest?: boolean;
        } = {}
    ) {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-dossier-'));
        const bundle = join(root, '.agents', 'review-bundles', `${number}-${head}`);
        mkdirSync(bundle, { recursive: true });
        writeFileSync(
            join(bundle, 'manifest.json'),
            JSON.stringify(input.manifest ?? { pr: number, baseRefName: 'main', baseSha: base, headSha: head })
        );
        writeFileSync(join(bundle, 'diff.patch'), input.diff ?? '');
        const documentName = input.documentName ?? 'review.json';
        const document = { ...((input.document ?? reviewDocument) as Record<string, unknown>) };
        if (documentName === 'review.json' && !('draws' in document) && input.draws !== null) {
            document.draws = input.draws ?? defaultDraws;
        }
        writeFileSync(join(bundle, documentName), JSON.stringify(document));
        if (input.plan !== undefined) {
            writeFileSync(join(bundle, 'risk-plan.json'), JSON.stringify(input.plan));
        }
        if (input.dossier !== undefined) {
            writeFileSync(join(bundle, 'dossier.json'), JSON.stringify(input.dossier));
        }
        for (const [name, value] of Object.entries(input.files ?? {})) {
            writeFileSync(join(bundle, name), typeof value === 'string' ? value : JSON.stringify(value));
        }
        const calls: string[] = [];
        const logs: string[] = [];
        const writes: { path: string; contents: string }[] = [];
        const labelWrites: string[] = [];
        const posted: { review?: Parameters<PublishReviewPort['postReview']>[0] } = {};
        const port: PublishReviewPort = {
            primaryRoot: () => root,
            assertApprovalContext: (publishedNumber, publishedHead) => {
                calls.push('approvalContext');
                // The production port reads the bundle manifest here, so a case that wants to observe
                // what runs ahead of this read opts into that read instead of the fixed stub.
                if (input.approvalContextReadsManifest === true) {
                    readReviewBundleContext(bundle);
                }
                return approvalContext(publishedHead, publishedNumber);
            },
            pullRequest: () => ({ state: 'OPEN', head, labels: input.labels }),
            readReviewJson: (path) => {
                calls.push(`read:${path}`);
                return readJsonFile(path);
            },
            bundleFileExists: (path) => existsSync(path),
            readBundleDiff: () => input.diff ?? '',
            postReview: (review) => {
                calls.push('post');
                posted.review = review;
                return { id: 99, actorNodeId: REVIEWER_BOT_NODE_ID, login: 'renamed-reviewer[bot]' };
            },
            reviewComments: (_publishedNumber, reviewId) => {
                calls.push(`reviewComments:${reviewId}`);
                return input.reviewComments ?? [];
            },
            reviewState: (_publishedNumber, _expectedHead) => ({
                latestReviewerStateOnHead: 'APPROVED',
                latestReviewerReviewDatabaseId: 99,
                latestReviewerCommitOid: head,
                unresolvedThreads: 0,
            }),
            remoteReview: (_publishedNumber, reviewId) => {
                calls.push(`remoteReview:${reviewId}`);
                return input.remoteReviews?.[reviewId];
            },
            publicReviews: () => input.publicReviews ?? [],
            publicReviewComments: () => input.publicReviewComments ?? [],
            applyApprovalLabel: (labeledNumber) => labelWrites.push(`apply:${labeledNumber}`),
            removeApprovalLabel: (labeledNumber) => labelWrites.push(`remove:${labeledNumber}`),
            log: (message) => logs.push(message),
        };
        if (input.writable !== false) {
            port.writeBundleText = (path: string, contents: string) => {
                writes.push({ path, contents });
                writeFileSync(path, contents);
            };
        }
        return {
            root,
            bundle,
            port,
            calls,
            logs,
            writes,
            posted,
            labelWrites,
            readDossier: () => readJsonFile(join(bundle, 'dossier.json')),
        };
    }

    function acceptanceDocument() {
        return {
            format: 'compact-v1',
            event: 'APPROVE',
            body: 'Final contract held.',
            evidence: approvalEvidence(head),
        };
    }

    function acceptanceDependencies(
        fixture: ReturnType<typeof dossierFixture>,
        accepted: string[] = []
    ): AcceptReviewCoordinatorDependencies {
        const port: PublishReviewPort = {
            ...fixture.port,
            reviewState: () => ({
                latestReviewerStateOnHead: 'APPROVED',
                latestReviewerReviewDatabaseId: null,
                unresolvedThreads: 0,
            }),
            postReview: (review) => {
                accepted.push(review.body);
                return {
                    id: 99,
                    actorNodeId: ORCHESTRATOR_USER_NODE_ID,
                    login: 'jcosta33',
                    actorType: 'User',
                    commitId: head,
                };
            },
        };
        return {
            primaryRoot: () => fixture.root,
            authenticateOrchestrator: async () => ({
                minted: { actorNodeId: ORCHESTRATOR_USER_NODE_ID },
                session: { configDir: '/tmp/user', env: {}, dispose: () => undefined },
            }),
            repositoryName: () => 'jcosta33/sourdaw',
            reviewPort: () => port,
            serializeMutation: async (_root, _number, operation) =>
                operation({
                    ownerOid: 'f'.repeat(40),
                    journalReviewPublication: () => undefined,
                    markRemoteMutationAttempt: () => undefined,
                    markDefinitiveNoMutationHttpStatus: () => undefined,
                    registerSuccessfulCompletion: () => undefined,
                }),
            publish: publishPreparedAcceptance,
        };
    }

    type PlanDisagreement = {
        label: string;
        plan: ReviewRiskPlan;
        manifest?: Record<string, unknown>;
        message: RegExp;
    };

    const PLAN_DISAGREEMENTS: readonly PlanDisagreement[] = [
        {
            label: 'pr against the pull request',
            plan: riskPlan({ pr: 43 }),
            message: /review risk plan pr 43 does not match pull request 42/u,
        },
        {
            label: 'headSha against the live head',
            plan: riskPlan({ headSha: 'e'.repeat(40) }),
            message: /review risk plan headSha e{40} does not match the live head c{40}/u,
        },
        {
            label: 'pr against the manifest',
            plan: riskPlan(),
            manifest: { pr: 43, baseRefName: 'main', baseSha: base, headSha: head },
            message: /review risk plan pr 42 does not match the bundle manifest pr 43/u,
        },
        {
            label: 'headSha against the manifest',
            plan: riskPlan(),
            manifest: { pr: number, baseRefName: 'main', baseSha: base, headSha: 'f'.repeat(40) },
            message: /review risk plan headSha c{40} does not match the bundle manifest headSha f{40}/u,
        },
        {
            label: 'baseSha against the manifest',
            plan: riskPlan(),
            manifest: { pr: number, baseRefName: 'main', baseSha: 'a'.repeat(40), headSha: head },
            message: /review risk plan baseSha d{40} does not match the bundle manifest baseSha a{40}/u,
        },
    ];

    it('publishes a matching plan, deriving the canonical record from review.json and writing it beside it', () => {
        const fixture = dossierFixture({
            plan: riskPlan(),
            document: {
                ...reviewDocument,
                draws: defaultDraws,
                discarded: [{ finding: 'blind-1', reason: 'not reproducible on this head' }],
            },
        });
        try {
            expect(publishReview(number, fixture.port)).toBe(99);
            expect(fixture.posted.review?.event).toBe('APPROVE');
            // Two writes: the canonical record before the POST, then the publication binding after it.
            expect(fixture.writes).toHaveLength(2);
            expect(fixture.writes[0]?.path).toBe(join(fixture.bundle, 'dossier.json'));
            expect(fixture.writes[1]?.path).toBe(join(fixture.bundle, 'dossier.json'));
            expect(fixture.writes[0]?.contents).toBe(derivedRecord().canonical);
            expect(fixture.posted.review).toEqual({
                number,
                commitId: head,
                event: 'APPROVE',
                body: renderReviewDocumentBody(reviewDocument),
                comments: [],
            });

            const persisted = parseReviewDossier(fixture.readDossier());
            expect(persisted.headSha).toBe(head);
            expect(persisted.baseSha).toBe(base);
            expect(persisted.recommendation).toBe('approve');
            expect(persisted.requiredStances).toEqual(['correctness', 'stale binding', 'test-validity']);
            // An APPROVE carries no inline comments, so it accepts no findings and binds only the
            // review, plus the delivery authorization the reviewer publication itself records.
            expect(acceptedFindings(persisted)).toEqual([]);
            expect(publishedReviewId(persisted)).toBe(99);
            expect(publishedFindings(persisted)).toEqual([]);
            expect(deliveryAuthorization(persisted)).toEqual({
                reviewId: 99,
                approvalReviewId: 99,
                unresolvedThreads: 0,
                intent: 'deliver',
                evidenceManifestDigest: authorizedEvidenceDigest(persisted),
            });
            // Discards stay in review.json: they are shape-checked, never posted, and never recorded.
            expect(discardedDispositions(persisted)).toEqual([]);
            expect(completedStances(persisted).map((draw) => [draw.stance, draw.modelTier, draw.outcome])).toEqual([
                ['correctness', 'strongest', 'clean'],
                ['test-validity', 'standard', 'clean'],
                ['stale binding', 'standard', 'clean'],
            ]);
            expect(persisted.evidence).toEqual(approvalEvidence(head).claims);
            expect(fixture.readDossier()).not.toHaveProperty('assessmentImpact');
            expect(fixture.writes[1]?.contents).toBe(serializeReviewDossier(persisted));
            // The pre-POST write is the same record without its post-publication events: the landed
            // review binding and the delivery authorization it carries.
            expect(parseReviewDossier(JSON.parse(fixture.writes[0]!.contents)).events.length).toBe(
                persisted.events.length - 2
            );
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    describe('proportional draw floor (ADR 0054)', () => {
        const docsOnlyPlan = riskPlan({
            riskClasses: ['docs-only'],
            requiredStances: ['correctness'],
            triggers: ['docs-only:all-paths-are-docs'],
        });
        const ordinaryPlan = riskPlan({
            riskClasses: ['ordinary'],
            requiredStances: ['code-craft', 'correctness', 'module-boundaries', 'test-validity'],
            triggers: ['ordinary:handwritten-lines>200'],
        });
        const governancePlan = planReviewRisk({
            pr: number,
            headSha: head,
            baseSha: base,
            paths: [{ path: 'scripts/publishReview.ts', group: 'handwritten', added: 1, deleted: 0, binary: false }],
        });

        it('publishes a docs-only bundle with one draw', () => {
            const fixture = dossierFixture({
                plan: docsOnlyPlan,
                draws: [defaultDraws[1]],
                diff: patchAdding('docs/06-testing.md', 3),
            });
            try {
                expect(publishReview(number, fixture.port)).toBe(99);
                expect(completedStances(parseReviewDossier(fixture.readDossier())).map((draw) => draw.stance)).toEqual([
                    'test-validity',
                ]);
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });

        it('refuses a plan-carrying review.json without draws before any side effect', () => {
            const fixture = dossierFixture({ plan: riskPlan(), draws: null });
            try {
                expect(refusedBeforeSideEffects(fixture)).toBe(
                    `review.json must carry draws for head ${head}: one { stance, reviewerModel, tier, outcome } entry per completed blind draw`
                );
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });

        it.each([
            ['docs-only', 0, 1, docsOnlyPlan, patchAdding('docs/06-testing.md', 3)],
            ['small', 1, 2, riskPlan(), patchAdding('src/modules/Tuner/x.ts', 3)],
            ['ordinary', 2, 3, ordinaryPlan, patchAdding('src/modules/Tuner/x.ts', 250)],
        ] as const)(
            'refuses a %s round with %i distinct stances, below its floor of %i',
            (label, count, floor, plan, diff) => {
                const fixture = dossierFixture({ plan, draws: defaultDraws.slice(0, count), diff });
                try {
                    expect(refusedBeforeSideEffects(fixture)).toBe(
                        `review.json draws cover ${count} distinct stances; the ${label} risk plan requires at least ${floor}`
                    );
                } finally {
                    removeTemporaryDirectory(fixture.root);
                }
            }
        );

        it('refuses a specialist round with no strongest draw, and publishes it with one', () => {
            expect(governancePlan.riskClasses).toEqual(['native-security']);
            const standard = defaultDraws.map((draw): ReviewDraw => ({ ...draw, tier: 'standard' }));
            const governanceDiff = patchAdding('scripts/publishReview.ts', 1);
            const refused = dossierFixture({ plan: governancePlan, draws: standard, diff: governanceDiff });
            try {
                expect(refusedBeforeSideEffects(refused)).toBe(
                    'review.json draws need at least one strongest-tier draw for the native-security risk plan'
                );
            } finally {
                removeTemporaryDirectory(refused.root);
            }
            const admitted = dossierFixture({ plan: governancePlan, diff: governanceDiff });
            try {
                expect(publishReview(number, admitted.port)).toBe(99);
            } finally {
                removeTemporaryDirectory(admitted.root);
            }
        });

        it('refuses a hand-edited risk plan that lowers the floor below what the bundle diff earns', () => {
            const fixture = dossierFixture({
                plan: riskPlan(),
                draws: defaultDraws.slice(0, 2),
                diff: patchAdding('src/modules/Tuner/x.ts', 250),
            });
            try {
                expect(refusedBeforeSideEffects(fixture)).toBe(
                    'review risk plan riskClasses small differ from the ordinary the bundle diff.patch earns'
                );
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });

        it('refuses a risk plan that drops a specialist class the bundle diff earns', () => {
            const fixture = dossierFixture({
                plan: riskPlan(),
                diff: patchAdding('.github/CODEOWNERS', 1),
            });
            try {
                expect(refusedBeforeSideEffects(fixture)).toBe(
                    'review risk plan riskClasses small differ from the native-security the bundle diff.patch earns'
                );
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });

        it('refuses an unknown draw tier before any side effect', () => {
            const fixture = dossierFixture({ plan: riskPlan(), draws: [{ ...defaultDraws[0], tier: 'heroic' }] });
            try {
                expect(refusedBeforeSideEffects(fixture)).toBe(
                    'review.json draws[0].tier must be one of economy, standard, strongest, found "heroic"'
                );
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });

        it.each([
            ['draws[0].stance', { draws: [{ ...defaultDraws[0], stance: `ghp_${'A'.repeat(24)}` }] }],
            ['draws[0].reviewerModel', { draws: [{ ...defaultDraws[0], reviewerModel: `ghp_${'B'.repeat(24)}` }] }],
            ['discarded[0].finding', { discarded: [{ finding: `ghp_${'C'.repeat(24)}`, reason: 'not reproducible' }] }],
            ['discarded[0].reason', { discarded: [{ finding: 'blind-1', reason: `ghp_${'D'.repeat(24)}` }] }],
        ])('refuses a credential-shaped %s before any side effect', (field, fields) => {
            const fixture = dossierFixture({
                plan: riskPlan(),
                document: { ...reviewDocument, draws: defaultDraws, ...fields },
            });
            try {
                expect(refusedBeforeSideEffects(fixture)).toBe(
                    `review.json ${field} value at index 0 contains a GitHub token`
                );
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });

        it('refuses an APPROVE carrying inline comments on a plan-carrying bundle', () => {
            const fixture = dossierFixture({
                plan: riskPlan(),
                document: { ...reviewDocument, comments: [{ path: 'scripts/target.ts', line: 5, side: 'RIGHT' }] },
            });
            try {
                expect(refusedBeforeSideEffects(fixture)).toBe(
                    'APPROVE must carry no comments; an inline comment opens a thread that blocks the merge'
                );
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });

        it('refuses to post when the pull-request head moved after the record was derived', () => {
            const fixture = dossierFixture({ plan: riskPlan() });
            let reads = 0;
            fixture.port.pullRequest = () => {
                reads += 1;
                return { state: 'OPEN', head: reads === 1 ? head : 'e'.repeat(40) };
            };
            try {
                expect(refusalMessage(() => publishReview(number, fixture.port))).toBe(
                    'pull-request head moved; refusing to post a stale review'
                );
                expect(fixture.calls).not.toContain('post');
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });

        it('ignores retired caller documents, logging one line, and replaces a caller dossier input', () => {
            const fixture = dossierFixture({
                plan: riskPlan(),
                dossier: { format: 'dossier-input-v1', stances: [] },
                files: {
                    'stances.json': '{ not even json',
                    'discarded.json': [],
                    'reassessment.json': {},
                    'semantic-ci.json': { format: 'semantic-ci-v1', state: 'no-assessment', reason: 'red-check' },
                },
            });
            try {
                expect(publishReview(number, fixture.port)).toBe(99);
                expect(fixture.logs.filter((line) => line.startsWith('review:publish ignores'))).toEqual([
                    `review:publish ignores stances.json, discarded.json, reassessment.json, dossier.json (caller input) in ${fixture.bundle}: review.json is the only caller document`,
                ]);
                expect(fixture.calls.some((call) => call.endsWith('semantic-ci.json'))).toBe(false);
                expect(parseReviewDossier(fixture.readDossier()).format).toBe('dossier-v1');
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });
    });

    describe('review round freeze (ADR 0054)', () => {
        it('publishes a fresh review below the freeze', () => {
            const fixture = dossierFixture({
                plan: riskPlan(),
                publicReviews: requestChangesRounds(REVIEW_ROUND_FREEZE_THRESHOLD - 1),
            });
            try {
                expect(publishReview(number, fixture.port)).toBe(99);
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });

        it.each([
            ['an APPROVE', reviewDocument],
            ['a REQUEST_CHANGES', changesDocument()],
        ])('refuses %s at the freeze before approval context or any write', (_label, document) => {
            const fixture = dossierFixture({
                plan: riskPlan(),
                document,
                diff: targetDiff,
                // An unusable manifest proves the freeze is decided before the approval context reads it.
                manifest: { pr: number, baseRefName: 'main', headSha: head },
                approvalContextReadsManifest: true,
                publicReviews: requestChangesRounds(REVIEW_ROUND_FREEZE_THRESHOLD),
            });
            try {
                expect(refusedBeforeSideEffects(fixture)).toBe(expectedFreezeRefusal(REVIEW_ROUND_FREEZE_THRESHOLD));
                expect(fixture.calls).not.toContain('approvalContext');
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });

        it('freezes a plan-less legacy bundle too, naming the observed count', () => {
            const fixture = dossierFixture({ publicReviews: requestChangesRounds(REVIEW_ROUND_FREEZE_THRESHOLD + 2) });
            try {
                expect(refusedBeforeSideEffects(fixture)).toBe(
                    expectedFreezeRefusal(REVIEW_ROUND_FREEZE_THRESHOLD + 2)
                );
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });

        it('counts only reviewer request-changes rounds toward the freeze', () => {
            const fixture = dossierFixture({
                plan: riskPlan(),
                publicReviews: [
                    ...requestChangesRounds(REVIEW_ROUND_FREEZE_THRESHOLD - 1),
                    { id: 90, state: 'APPROVED', commitId: head, actorNodeId: REVIEWER_BOT_NODE_ID, body: 'approval' },
                    {
                        id: 91,
                        state: 'APPROVED',
                        commitId: head,
                        actorNodeId: ORCHESTRATOR_USER_NODE_ID,
                        body: 'accept',
                    },
                    {
                        id: 92,
                        state: 'CHANGES_REQUESTED',
                        commitId: head,
                        actorNodeId: ORCHESTRATOR_USER_NODE_ID,
                        body: 'rejection',
                    },
                ],
            });
            try {
                expect(publishReview(number, fixture.port)).toBe(99);
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });

        it('replays a recorded publication at the freeze without posting again', () => {
            const remoteReviews: Record<number, RemotePublishedReview | undefined> = {};
            const fixture = dossierFixture({ plan: riskPlan(), remoteReviews });
            try {
                expect(publishReview(number, fixture.port)).toBe(99);
                const review = fixture.posted.review;
                if (review === undefined) {
                    throw new Error('expected the APPROVE to have posted');
                }
                remoteReviews[99] = {
                    id: 99,
                    state: 'APPROVED',
                    body: review.body,
                    commitId: head,
                    actorNodeId: REVIEWER_BOT_NODE_ID,
                    comments: [],
                };
                fixture.port.publicReviews = () => requestChangesRounds(REVIEW_ROUND_FREEZE_THRESHOLD);
                expect(publishReview(number, fixture.port)).toBe(99);
                expect(fixture.calls.filter((call) => call === 'post')).toHaveLength(1);
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        });
    });

    it.each([
        { label: 'missing reviewer', reviewerState: null, reviewerId: null, reviewerHead: null },
        { label: 'approval without an id', reviewerState: 'APPROVED', reviewerId: null, reviewerHead: head },
    ])('refuses a fresh APPROVE with $label identity before terminal binding', (input) => {
        const fixture = dossierFixture({ plan: riskPlan() });
        fixture.port.reviewState = () => ({
            latestReviewerStateOnHead: input.reviewerState,
            latestReviewerReviewDatabaseId: input.reviewerId,
            latestReviewerCommitOid: input.reviewerHead,
            unresolvedThreads: 0,
        });
        try {
            expect(() => publishReview(number, fixture.port)).toThrow(/incomplete reviewer approval identity/);

            expect(fixture.calls.filter((call) => call === 'post')).toHaveLength(1);
            expect(fixture.writes).toHaveLength(1);
            const persisted = parseReviewDossier(fixture.readDossier());
            expect(publishedReviewId(persisted)).toBeUndefined();
            expect(deliveryAuthorization(persisted)).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    describe('repair actor admission below the freeze threshold', () => {
        function malformedRepairFixture(actorNodeId: string | null) {
            const root: PublicReviewComment = {
                id: 100,
                reviewId: 1,
                actorNodeId: REVIEWER_BOT_NODE_ID,
                path: 'scripts/target.ts',
                line: 5,
                side: 'RIGHT',
                body: 'blocking finding',
            };
            return dossierFixture({
                plan: riskPlan(),
                publicReviews: [
                    {
                        id: 1,
                        state: 'CHANGES_REQUESTED',
                        commitId: head,
                        actorNodeId: REVIEWER_BOT_NODE_ID,
                        body: 'round',
                    },
                ],
                publicReviewComments: [
                    root,
                    { ...root, id: 101, actorNodeId, inReplyToId: root.id, body: 'sourdaw-repair-v1 {not json' },
                ],
            });
        }

        it.each(['BOT_foreign', ORCHESTRATOR_USER_NODE_ID, null])(
            'publishes a fresh review despite malformed repair text from untrusted actor %s',
            (actorNodeId) => {
                const fixture = malformedRepairFixture(actorNodeId);
                try {
                    expect(publishReview(number, fixture.port)).toBe(99);
                    expect(fixture.calls.filter((call) => call === 'post')).toEqual(['post']);
                    const persisted = parseReviewDossier(fixture.readDossier());
                    expect(persisted.events.some((event) => event.kind === 'review-reassessed')).toBe(false);
                } finally {
                    removeTemporaryDirectory(fixture.root);
                }
            }
        );

        it.each([AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID])(
            'refuses malformed repair text from authorized actor %s before any publication POST or write',
            (actorNodeId) => {
                const fixture = malformedRepairFixture(actorNodeId);
                try {
                    expect(() => publishReview(number, fixture.port)).toThrow(/repair/u);
                    expect(fixture.posted.review).toBeUndefined();
                    expect(fixture.calls).not.toContain('post');
                    expect(fixture.calls).not.toContain('approvalContext');
                    expect(fixture.writes).toEqual([]);
                } finally {
                    removeTemporaryDirectory(fixture.root);
                }
            }
        );
    });

    it('binds the deliver reader to the authorized dossier digest the writer recorded', () => {
        const fixture = dossierFixture({ plan: riskPlan() });
        try {
            expect(publishReview(number, fixture.port)).toBe(99);
            const persisted = parseReviewDossier(fixture.readDossier());
            const authorization = deliveryAuthorization(persisted);
            if (authorization === undefined) {
                throw new Error('expected a recorded delivery authorization');
            }

            const deliverPort = deliverShellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => {
                        throw new Error('the dossier reader must not use the shell');
                    },
                    run: () => {
                        throw new Error('the dossier reader must not use the shell');
                    },
                },
                { primaryRoot: fixture.root }
            );

            const binding = deliverPort.reviewBundleDeliveryAuthorization(number, head);
            expect(binding.kind).toBe('required');
            if (binding.kind !== 'required') {
                throw new Error('unreachable');
            }
            // The production reader recomputes authorizedEvidenceDigest, matching the digest the
            // writer recorded as the authorization's evidence manifest.
            expect(binding.dossierDigest).toBe(authorization.evidenceManifestDigest);

            // A later appended dossier event changes the recomputed digest: the reader derives it
            // from the live record rather than a stored or cached value.
            const appended = appendReviewDossierEvents(persisted, [
                {
                    kind: 'finding-accepted',
                    findingId: 'later-finding',
                    path: 'scripts/target.ts',
                    line: 1,
                    side: 'RIGHT',
                },
            ]);
            writeFileSync(join(fixture.bundle, 'dossier.json'), serializeReviewDossier(appended));

            const rebinding = deliverPort.reviewBundleDeliveryAuthorization(number, head);
            if (rebinding.kind !== 'required') {
                throw new Error('unreachable');
            }
            expect(rebinding.dossierDigest).not.toBe(binding.dossierDigest);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('replays the recorded publication on a second run without re-posting or rewriting', () => {
        const landedReview: RemotePublishedReview = {
            id: 99,
            state: 'APPROVED',
            body: 'Attacked the dossier gate; it held.',
            commitId: head,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            comments: [],
        };
        const fixture = dossierFixture({
            plan: riskPlan(),
            remoteReviews: { 99: landedReview },
        });
        try {
            expect(publishReview(number, fixture.port)).toBe(99);
            const first = fixture.readDossier();
            expect(fixture.writes).toHaveLength(2);

            expect(publishReview(number, fixture.port)).toBe(99);
            expect(fixture.writes).toHaveLength(2);
            expect(fixture.readDossier()).toEqual(first);
            expect(fixture.calls.filter((call) => call === 'post')).toHaveLength(1);
            expect(fixture.calls).toContain('remoteReview:99');
            expect(parseReviewDossier(fixture.readDossier()).dossierDigest).toBe(
                parseReviewDossier(first).dossierDigest
            );
            // The replay keeps the single delivery authorization the first APPROVE recorded.
            expect(deliveryAuthorization(parseReviewDossier(fixture.readDossier()))).toEqual({
                reviewId: 99,
                approvalReviewId: 99,
                unresolvedThreads: 0,
                intent: 'deliver',
                evidenceManifestDigest: authorizedEvidenceDigest(parseReviewDossier(first)),
            });
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses to re-post when the recorded publication no longer stands live and exact', () => {
        const fixture = dossierFixture({ plan: riskPlan() });
        try {
            expect(publishReview(number, fixture.port)).toBe(99);

            const message = refusalMessage(() => publishReview(number, fixture.port));
            expect(message).toMatch(/recorded review publication 99 does not stand live and exact/u);
            expect(fixture.calls.filter((call) => call === 'post')).toHaveLength(1);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    /**
     * The bundle's own persisted record for the head, omitting the impact. `reviewId` adds the
     * record's self-asserted publication; without it the record is the unpublished pre-field shape.
     */
    function canonicalPersistedDossier(reviewId?: number): unknown {
        const publication = reviewId === undefined ? [] : [{ kind: 'review-published' as const, reviewId }];
        return buildDossier({
            pr: number,
            headSha: head,
            baseSha: base,
            riskClasses: ['small'],
            requiredStances: ['correctness', 'stale binding', 'test-validity'],
            events: [
                {
                    kind: 'stance-completed',
                    stance: 'correctness',
                    reviewerModel: 'review-model',
                    modelTier: 'strongest',
                    outcome: 'clean',
                },
                {
                    kind: 'stance-completed',
                    stance: 'test-validity',
                    reviewerModel: 'review-model',
                    modelTier: 'standard',
                    outcome: 'clean',
                },
                {
                    kind: 'stance-completed',
                    stance: 'stale binding',
                    reviewerModel: 'review-model',
                    modelTier: 'standard',
                    outcome: 'clean',
                },
                ...publication,
            ],
            evidence: [
                {
                    observable: 'the canonical dossier is persisted beside review.json',
                    verification: 'pnpm test:run scripts/__tests__/publishReview.spec.ts',
                    observed: 'one canonical dossier.json on disk',
                },
            ],
            limitations: [],
            recommendation: 'approve',
        });
    }

    it('refuses a fabricated publication claim that omits the impact and names no live review', () => {
        const fixture = dossierFixture({ plan: riskPlan(), dossier: canonicalPersistedDossier(424242) });
        try {
            const message = refusalMessage(() => publishReview(number, fixture.port));

            // The cause is the failed authentication, not the omitted field.
            expect(message).toMatch(/recorded review publication 424242 does not stand live and exact/u);
            expect(fixture.calls).not.toContain('post');
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('publishes a pre-ADR bundle whose unpublished record stands in for the draws its review.json lacks', () => {
        const historical = canonicalPersistedDossier();
        const fixture = dossierFixture({ plan: riskPlan(), dossier: historical, draws: null });
        try {
            writeFileSync(join(fixture.bundle, 'dossier.json'), serializeReviewDossier(parseReviewDossier(historical)));
            const before = readFileSync(join(fixture.bundle, 'dossier.json'), 'utf8');
            expect(serializeReviewDossier(parseReviewDossier(JSON.parse(before)))).toBe(before);
            expect(publishReview(number, fixture.port)).toBe(99);
            expect(fixture.calls).toContain('post');
            expect(fixture.writes).toHaveLength(1);
            expect(publishedReviewId(parseReviewDossier(fixture.readDossier()))).toBe(99);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('replays a pre-field record with no impact once its publication authenticates live', () => {
        const landedReview: RemotePublishedReview = {
            id: 5272945685,
            state: 'APPROVED',
            body: 'Attacked the dossier gate; it held.',
            commitId: head,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            comments: [],
        };
        const fixture = dossierFixture({
            plan: riskPlan(),
            dossier: canonicalPersistedDossier(5272945685),
            remoteReviews: { 5272945685: landedReview },
        });
        try {
            const before = fixture.readDossier();

            expect(publishReview(number, fixture.port)).toBe(5272945685);
            expect(fixture.calls).not.toContain('post');
            expect(fixture.writes).toHaveLength(0);
            expect(fixture.readDossier()).toEqual(before);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('replays a recorded publication without re-deriving its risk plan from the diff', () => {
        const landedReview: RemotePublishedReview = {
            id: 5272945685,
            state: 'APPROVED',
            body: 'Attacked the dossier gate; it held.',
            commitId: head,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            comments: [],
        };
        const fixture = dossierFixture({
            plan: riskPlan(),
            diff: patchAdding('src/modules/Tuner/x.ts', 250),
            dossier: canonicalPersistedDossier(5272945685),
            remoteReviews: { 5272945685: landedReview },
        });
        try {
            expect(publishReview(number, fixture.port)).toBe(5272945685);
            expect(fixture.calls).not.toContain('post');
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('binds the landed review and each posted comment into the dossier on REQUEST_CHANGES', () => {
        const comment = {
            path: 'scripts/target.ts',
            line: 5,
            side: 'RIGHT' as const,
            defect: 'the gate reads the wrong base',
            consequence: 'a foreign commit slips the authorship gate',
            done: 'read the comparison base',
        };
        const changesDocument = {
            event: 'REQUEST_CHANGES',
            body: 'One blocking finding.',
            comments: [comment],
            reviewerModel: 'glm-5.3-flash',
        };
        const diff = [
            'diff --git a/scripts/target.ts b/scripts/target.ts',
            'index 1111111..2222222 100644',
            '--- a/scripts/target.ts',
            '+++ b/scripts/target.ts',
            '@@ -2,3 +2,4 @@',
            ' context2',
            ' context3',
            ' context4',
            '+added',
            '',
        ].join('\n');
        const postedComment: PublishedReviewComment = {
            id: 2329000042,
            path: comment.path,
            line: comment.line,
            side: comment.side,
            body: 'rendered',
        };
        const fixture = dossierFixture({
            plan: toolingRiskPlan(),
            document: changesDocument,
            diff,
            reviewComments: [postedComment],
        });
        try {
            expect(publishReview(number, fixture.port)).toBe(99);
            expect(fixture.posted.review?.event).toBe('REQUEST_CHANGES');
            expect(fixture.calls).toContain('reviewComments:99');

            const persisted = parseReviewDossier(fixture.readDossier());
            expect(persisted.recommendation).toBe('request-changes');
            expect(acceptedFindings(persisted)).toEqual([
                { findingId: 'comment-0', path: comment.path, line: comment.line, side: 'RIGHT' },
            ]);
            expect(publishedReviewId(persisted)).toBe(99);
            expect(publishedFindings(persisted)).toEqual([
                { findingId: 'comment-0', reviewId: 99, commentId: 2329000042 },
            ]);
            // REQUEST_CHANGES records no delivery authorization: only the reviewer APPROVE does.
            expect(deliveryAuthorization(persisted)).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    /** A REQUEST_CHANGES bundle whose one finding binds to the comment the fake POST lands. */
    function changesRequestedFixture(remoteReviews: Record<number, RemotePublishedReview | undefined>) {
        const comment = {
            path: 'scripts/target.ts',
            line: 5,
            side: 'RIGHT' as const,
            defect: 'the gate reads the wrong base',
            consequence: 'a foreign commit slips the authorship gate',
            done: 'read the comparison base',
        };
        return dossierFixture({
            plan: toolingRiskPlan(),
            document: {
                event: 'REQUEST_CHANGES',
                body: 'One blocking finding.',
                comments: [comment],
                reviewerModel: 'glm-5.3-flash',
            },
            diff: [
                'diff --git a/scripts/target.ts b/scripts/target.ts',
                'index 1111111..2222222 100644',
                '--- a/scripts/target.ts',
                '+++ b/scripts/target.ts',
                '@@ -2,3 +2,4 @@',
                ' context2',
                ' context3',
                ' context4',
                '+added',
                '',
            ].join('\n'),
            reviewComments: [{ id: 2329000042, path: comment.path, line: comment.line, side: 'RIGHT', body: 'r' }],
            remoteReviews,
        });
    }

    /** The review GitHub holds after the fake POST, so a re-run can replay it live and exact. */
    function landedReview(review: Parameters<PublishReviewPort['postReview']>[0]): RemotePublishedReview {
        return {
            id: 99,
            state: review.event === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED',
            body: review.body,
            commitId: head,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            comments: review.comments.map((comment) => ({
                path: comment.path,
                line: comment.line,
                side: comment.side,
                body: composeReviewCommentBody(comment),
            })),
        };
    }

    /**
     * Drives the real coordinator over the real publication lock. The fake POST marks the remote
     * mutation exactly as production does, so any failure inside the lock after it strands the owner.
     */
    async function publishUnderLock(
        fixture: ReturnType<typeof dossierFixture>,
        label: { apply: (labeled: number) => void; remove: (labeled: number) => void }
    ): Promise<void> {
        const executable = join(fixture.root, 'ps');
        writeFileSync(
            executable,
            '#!/bin/sh\nif [ "$2" = "pgid=" ]; then printf "%s\\n" "$4"; else printf "%s\\n" "publication-process-start"; fi\n'
        );
        chmodSync(executable, 0o700);
        const previous = process.env.SOURDAW_TRUSTED_PS_PATH;
        process.env.SOURDAW_TRUSTED_PS_PATH = executable;
        try {
            await coordinatePublishReview(number, {
                primaryRoot: () => fixture.root,
                serializeMutation: withPullRequestReviewPublicationMutationLock,
                authenticateReviewer: async () => ({
                    minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                    session: { configDir: '/tmp/reviewer', env: {}, dispose: () => undefined },
                }),
                repositoryName: () => 'jcosta33/sourdaw',
                reviewPort: (_session, _primaryRoot, markRemoteMutationAttempt) => ({
                    ...fixture.port,
                    postReview: (review) => {
                        markRemoteMutationAttempt();
                        return fixture.port.postReview(review);
                    },
                    applyApprovalLabel: label.apply,
                    removeApprovalLabel: label.remove,
                }),
                publish: publishPreparedReview,
            });
        } finally {
            if (previous === undefined) {
                delete process.env.SOURDAW_TRUSTED_PS_PATH;
            } else {
                process.env.SOURDAW_TRUSTED_PS_PATH = previous;
            }
        }
    }

    const forbidden = (labeled: number): never => {
        throw new Error(`unexpected label write on ${labeled}`);
    };
    const labelDenied = (): never => {
        throw new Error('gh: Resource not accessible by integration (HTTP 403)');
    };
    const labelFailure =
        `review 99 stands on PR #${number}, but the ci:approved label write failed ` +
        `(gh: Resource not accessible by integration (HTTP 403)); ` +
        `re-run pnpm review:publish ${number} to replay the review and retry the label`;

    it('labels an approved head only after its dossier binding stands and the lock is released', async () => {
        const fixture = dossierFixture({ plan: riskPlan() });
        const observed: string[] = [];
        try {
            runGit(fixture.root, ['init']);
            await publishUnderLock(fixture, {
                apply: (labeled) => {
                    const persisted = parseReviewDossier(fixture.readDossier());
                    observed.push(
                        `apply:${labeled}:${String(publishedReviewId(persisted))}:` +
                            `${String(deliveryAuthorization(persisted)?.reviewId)}:` +
                            `${String(readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(labeled), labeled))}`
                    );
                },
                remove: forbidden,
            });
            expect(observed).toEqual([`apply:${number}:99:99:undefined`]);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('releases the lock when the approval label fails, and a plain re-run replays and labels', async () => {
        const remoteReviews: Record<number, RemotePublishedReview | undefined> = {};
        const fixture = dossierFixture({ plan: riskPlan(), remoteReviews });
        try {
            runGit(fixture.root, ['init']);
            await expect(publishUnderLock(fixture, { apply: labelDenied, remove: forbidden })).rejects.toThrow(
                labelFailure
            );
            expect(readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(number), number)).toBe(
                undefined
            );
            const persisted = parseReviewDossier(fixture.readDossier());
            expect(publishedReviewId(persisted)).toBe(99);
            expect(deliveryAuthorization(persisted)?.reviewId).toBe(99);

            const review = fixture.posted.review;
            if (review === undefined) {
                throw new Error('expected the APPROVE to have posted');
            }
            remoteReviews[99] = landedReview(review);
            const applied: number[] = [];
            await publishUnderLock(fixture, { apply: (labeled) => applied.push(labeled), remove: forbidden });
            expect(applied).toEqual([number]);
            expect(fixture.calls.filter((call) => call === 'post')).toHaveLength(1);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('releases the lock when label removal fails after REQUEST_CHANGES, and a plain re-run replays and removes', async () => {
        const remoteReviews: Record<number, RemotePublishedReview | undefined> = {};
        const fixture = changesRequestedFixture(remoteReviews);
        try {
            runGit(fixture.root, ['init']);
            await expect(publishUnderLock(fixture, { apply: forbidden, remove: labelDenied })).rejects.toThrow(
                labelFailure
            );
            expect(readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(number), number)).toBe(
                undefined
            );
            const persisted = parseReviewDossier(fixture.readDossier());
            expect(publishedReviewId(persisted)).toBe(99);
            expect(deliveryAuthorization(persisted)).toBeUndefined();

            const review = fixture.posted.review;
            if (review === undefined) {
                throw new Error('expected the REQUEST_CHANGES to have posted');
            }
            remoteReviews[99] = landedReview(review);
            const removed: number[] = [];
            await publishUnderLock(fixture, { apply: forbidden, remove: (labeled) => removed.push(labeled) });
            expect(removed).toEqual([number]);
            expect(fixture.calls.filter((call) => call === 'post')).toHaveLength(1);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses the binding when the landed review carries another comment shape', () => {
        const comment = {
            path: 'scripts/target.ts',
            line: 5,
            side: 'RIGHT' as const,
            defect: 'the gate reads the wrong base',
            consequence: 'a foreign commit slips the authorship gate',
            done: 'read the comparison base',
        };
        const diff = [
            'diff --git a/scripts/target.ts b/scripts/target.ts',
            'index 1111111..2222222 100644',
            '--- a/scripts/target.ts',
            '+++ b/scripts/target.ts',
            '@@ -2,3 +2,4 @@',
            ' context2',
            ' context3',
            ' context4',
            '+added',
            '',
        ].join('\n');
        const fixture = dossierFixture({
            plan: toolingRiskPlan(),
            document: {
                event: 'REQUEST_CHANGES',
                body: 'One blocking finding.',
                comments: [comment],
                reviewerModel: 'glm-5.3-flash',
            },
            diff,
            reviewComments: [],
        });
        try {
            const message = refusalMessage(() => publishReview(number, fixture.port));
            expect(message).toMatch(/review 99 carries 0 public comments, not the document's 1/u);
            expect(fixture.calls).toContain('post');
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses the binding when a landed comment does not match the document positionally', () => {
        const comment = {
            path: 'scripts/target.ts',
            line: 5,
            side: 'RIGHT' as const,
            defect: 'the gate reads the wrong base',
            consequence: 'a foreign commit slips the authorship gate',
            done: 'read the comparison base',
        };
        const diff = [
            'diff --git a/scripts/target.ts b/scripts/target.ts',
            'index 1111111..2222222 100644',
            '--- a/scripts/target.ts',
            '+++ b/scripts/target.ts',
            '@@ -2,3 +2,4 @@',
            ' context2',
            ' context3',
            ' context4',
            '+added',
            '',
        ].join('\n');
        const fixture = dossierFixture({
            plan: toolingRiskPlan(),
            document: {
                event: 'REQUEST_CHANGES',
                body: 'One blocking finding.',
                comments: [comment],
                reviewerModel: 'glm-5.3-flash',
            },
            diff,
            reviewComments: [{ id: 2329000043, path: 'scripts/other.ts', line: 5, side: 'RIGHT', body: 'rendered' }],
        });
        try {
            const message = refusalMessage(() => publishReview(number, fixture.port));
            expect(message).toMatch(/review 99 comment 0 \(scripts\/other\.ts:5:RIGHT\) does not match the document/u);
            expect(fixture.calls).toContain('post');
            // The refusal lands before the binding write, so only the pre-POST canonical record persisted.
            expect(fixture.writes).toHaveLength(1);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses to replay when the landed review drifts from the recorded publication', () => {
        const remoteReviews: Record<number, RemotePublishedReview | undefined> = {};
        const fixture = dossierFixture({ plan: riskPlan(), remoteReviews });
        try {
            expect(publishReview(number, fixture.port)).toBe(99);

            remoteReviews[99] = {
                id: 99,
                state: 'APPROVED',
                body: 'A tampered summary.',
                commitId: head,
                actorNodeId: REVIEWER_BOT_NODE_ID,
                comments: [],
            };
            const message = refusalMessage(() => publishReview(number, fixture.port));
            expect(message).toMatch(/recorded review publication 99 does not stand live and exact/u);
            expect(fixture.calls.filter((call) => call === 'post')).toHaveLength(1);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses to replay when the recorded publication leaves an accepted finding unbound', () => {
        const comment = {
            path: 'scripts/target.ts',
            line: 5,
            side: 'RIGHT' as const,
            defect: 'the gate reads the wrong base',
            consequence: 'a foreign commit slips the authorship gate',
            done: 'read the comparison base',
        };
        const diff = [
            'diff --git a/scripts/target.ts b/scripts/target.ts',
            'index 1111111..2222222 100644',
            '--- a/scripts/target.ts',
            '+++ b/scripts/target.ts',
            '@@ -2,3 +2,4 @@',
            ' context2',
            ' context3',
            ' context4',
            '+added',
            '',
        ].join('\n');
        const { canonical } = derivedRecord({
            comments: [{ path: comment.path, line: comment.line, side: comment.side }],
            recommendation: 'request-changes',
            evidence: [],
        });
        // A chain recording the review but not its finding: exactly one review-published, no finding-published.
        const bound = appendReviewDossierEvents(parseReviewDossier(JSON.parse(canonical)), [
            { kind: 'review-published', reviewId: 99 },
        ]);
        const fixture = dossierFixture({
            plan: riskPlan(),
            dossier: JSON.parse(serializeReviewDossier(bound)),
            document: {
                event: 'REQUEST_CHANGES',
                body: 'One blocking finding.',
                comments: [comment],
                reviewerModel: 'glm-5.3-flash',
            },
            diff,
            remoteReviews: {
                99: {
                    id: 99,
                    state: 'CHANGES_REQUESTED',
                    body: 'One blocking finding.',
                    commitId: head,
                    actorNodeId: REVIEWER_BOT_NODE_ID,
                    comments: [
                        {
                            path: comment.path,
                            line: comment.line,
                            side: comment.side,
                            body: composeReviewCommentBody(comment),
                        },
                    ],
                },
            },
        });
        try {
            const message = refusalMessage(() => publishReview(number, fixture.port));
            expect(message).toMatch(/lacks public comment bindings for: comment-0/u);
            expect(fixture.calls).not.toContain('post');
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses to bind a dossier that already records a publication', () => {
        const { canonical } = derivedRecord({ comments: [], recommendation: 'approve' });
        const bound = appendReviewDossierEvents(parseReviewDossier(JSON.parse(canonical)), [
            { kind: 'review-published', reviewId: 98 },
        ]);
        const fixture = dossierFixture({ plan: riskPlan(), dossier: JSON.parse(serializeReviewDossier(bound)) });
        const document: Parameters<typeof recordPublicationBindings>[2] = {
            event: 'APPROVE',
            body: 'Attacked the dossier gate; it held.',
            comments: [],
        };
        try {
            expect(() => recordPublicationBindings(number, head, document, 99, fixture.port)).toThrow(
                /review dossier already binds publication 98; refusing to rebind to 99/u
            );
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses a recorded publication whose dossier chain was tampered with', () => {
        const { canonical } = derivedRecord({
            comments: [{ path: 'scripts/target.ts', line: 5, side: 'RIGHT' as const }],
            recommendation: 'request-changes',
            evidence: [],
        });
        const tampered = JSON.parse(canonical) as { events: Record<string, unknown>[] };
        tampered.events.push({
            kind: 'review-published',
            reviewId: 99,
            sequence: tampered.events.length,
            previousDigest: 'x'.repeat(64),
            digest: 'y'.repeat(64),
        });
        const fixture = dossierFixture({ plan: riskPlan(), dossier: tampered });
        try {
            const message = refusalMessage(() => publishReview(number, fixture.port));
            expect(message).toMatch(/previousDigest does not chain/u);
            expect(fixture.calls).not.toContain('post');
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('publishes two draws on one stance and persists both completed entries', () => {
        const fixture = dossierFixture({
            plan: riskPlan(),
            draws: [
                { stance: 'correctness', reviewerModel: 'review-model', tier: 'strongest', outcome: 'clean' },
                { stance: 'correctness', reviewerModel: 'review-model-2', tier: 'strongest', outcome: 'findings' },
                { stance: 'test-validity', reviewerModel: 'review-model', tier: 'standard', outcome: 'clean' },
                { stance: 'stale binding', reviewerModel: 'review-model', tier: 'standard', outcome: 'clean' },
            ],
        });
        try {
            expect(publishReview(number, fixture.port)).toBe(99);
            const persisted = parseReviewDossier(fixture.readDossier());
            // The stance set is the dispatch; the second draw extends model diversity, not the count.
            expect(persisted.requiredStances).toEqual(['correctness', 'stale binding', 'test-validity']);
            expect(
                persisted.events
                    .filter((event) => event.kind === 'stance-completed')
                    .map((event) => event.reviewerModel)
            ).toEqual(['review-model', 'review-model-2', 'review-model', 'review-model']);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('keeps the whole-round fallback working when the dossier draws carry no authoring-model draw', () => {
        const fixture = dossierFixture({
            plan: riskPlan(),
            labels: [{ name: 'glm-5.3-flash', description: 'Authored by glm-5.3-flash' }],
            document: {
                ...reviewDocument,
                body: 'Whole-round fallback: reviewed on glm-5.3-flash after every other harness was unavailable.',
                modelExhaustion: 'every other harness on this machine is logged out or broken',
            },
        });
        try {
            expect(publishReview(number, fixture.port)).toBe(99);
            expect(fixture.posted.review?.event).toBe('APPROVE');
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('replays a published pre-ADR mixed-round record unchanged, without the draws its review.json never had', () => {
        const mixedBody =
            'Mixed round: test-validity ran on review-model; correctness fell back to glm-5.3-flash, the only harness left for it.';
        const landedReview: RemotePublishedReview = {
            id: 99,
            state: 'APPROVED',
            body: mixedBody,
            commitId: head,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            comments: [],
        };
        // A record the retired contract persisted: a per-draw exhaustion, a recorded impact, a
        // reassessment event, and a delivery authorization bound to the publication.
        const published = appendReviewDossierEvents(
            buildDossier({
                pr: number,
                headSha: head,
                baseSha: base,
                riskClasses: ['small'],
                requiredStances: ['correctness', 'test-validity'],
                events: [
                    {
                        kind: 'stance-completed',
                        stance: 'correctness',
                        reviewerModel: 'glm-5.3-flash',
                        modelTier: 'strongest',
                        outcome: 'clean',
                        exhaustion: 'every other harness on this machine was committed to another lane',
                    },
                    {
                        kind: 'stance-completed',
                        stance: 'test-validity',
                        reviewerModel: 'review-model',
                        modelTier: 'standard',
                        outcome: 'clean',
                    },
                    { kind: 'review-published', reviewId: 99 },
                ],
                evidence: [],
                limitations: ['semantic-ci red-check'],
                recommendation: 'approve',
                assessmentImpact: 'limitation-only',
            }),
            [{ kind: 'review-reassessed', roundsObserved: 3, threshold: 3, action: 'continue', reason: 'rescoped' }]
        );
        const authorized = appendReviewDossierEvents(published, [
            {
                kind: 'delivery-authorized',
                reviewId: 99,
                approvalReviewId: 99,
                evidenceManifestDigest: authorizedEvidenceDigest(published),
                unresolvedThreads: 0,
                intent: 'deliver',
            },
        ]);
        const fixture = dossierFixture({
            plan: riskPlan(),
            labels: [{ name: 'glm-5.3-flash', description: 'Authored by glm-5.3-flash' }],
            document: { ...reviewDocument, body: mixedBody },
            draws: null,
            dossier: JSON.parse(serializeReviewDossier(authorized)),
            remoteReviews: { 99: landedReview },
            publicReviews: requestChangesRounds(REVIEW_ROUND_FREEZE_THRESHOLD),
        });
        try {
            const before = readFileSync(join(fixture.bundle, 'dossier.json'), 'utf8');
            // The replay posts nothing, so neither the freeze nor the diversity rule that admitted
            // the original post re-runs against it.
            expect(publishReview(number, fixture.port)).toBe(99);
            expect(fixture.writes).toEqual([]);
            expect(readFileSync(join(fixture.bundle, 'dossier.json'), 'utf8')).toBe(before);
            expect(fixture.calls).not.toContain('post');

            const deliverPort = deliverShellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => {
                        throw new Error('the dossier reader must not use the shell');
                    },
                    run: () => {
                        throw new Error('the dossier reader must not use the shell');
                    },
                },
                { primaryRoot: fixture.root }
            );
            const binding = deliverPort.reviewBundleDeliveryAuthorization(number, head);
            if (binding.kind !== 'required') {
                throw new Error('unreachable');
            }
            expect(binding.authorization?.reviewId).toBe(99);
            expect(binding.dossierDigest).toBe(authorizedEvidenceDigest(published));
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it.each(['observable', 'verification', 'observed'] as const)(
        'refuses an approval evidence claim carrying a credential in %s and never posts',
        (field) => {
            const claim = {
                observable: 'the evidence gate refuses a credential',
                verification: 'pnpm test:run scripts/__tests__/publishReview.spec.ts',
                observed: 'no POST and no journal',
                [field]: `ghp_${'A'.repeat(24)}`,
            };
            const fixture = dossierFixture({
                plan: riskPlan(),
                document: {
                    ...reviewDocument,
                    evidence: { headSha: head, claims: [claim] },
                },
            });
            try {
                const message = refusalMessage(() => publishReview(number, fixture.port));
                expect(message).toMatch(
                    new RegExp(`review evidence claim\\[0\\]\\.${field} value at index 0 contains a GitHub token`, 'u')
                );
                expect(fixture.calls).not.toContain('post');
                expect(fixture.posted.review).toBeUndefined();
                expect(fixture.writes).toEqual([]);
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        }
    );

    it.each(PLAN_DISAGREEMENTS)(
        'refuses a plan whose $label disagrees and never posts',
        ({ plan, manifest, message }) => {
            const bundleInput: { plan: unknown; manifest?: Record<string, unknown> } = { plan };
            if (manifest !== undefined) {
                bundleInput.manifest = manifest;
            }
            const fixture = dossierFixture(bundleInput);
            try {
                expect(refusalMessage(() => publishReview(number, fixture.port))).toMatch(message);
                expect(fixture.calls).not.toContain('post');
                expect(fixture.posted.review).toBeUndefined();
                expect(fixture.writes).toEqual([]);
            } finally {
                removeTemporaryDirectory(fixture.root);
            }
        }
    );

    it('publishes a bundle with no risk plan exactly as before and writes no dossier', () => {
        const fixture = dossierFixture();
        try {
            expect(publishReview(number, fixture.port)).toBe(99);
            expect(fixture.posted.review?.event).toBe('APPROVE');
            expect(fixture.writes).toEqual([]);
            expect(fixture.calls.some((call) => call.endsWith('dossier.json'))).toBe(false);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('publishes a legacy bundle whose manifest generated list omits the risk plan', () => {
        const fixture = dossierFixture({
            manifest: {
                pr: number,
                baseRefName: 'main',
                baseSha: base,
                headSha: head,
                generated: ['diff.patch', 'manifest.json', 'pr.md', 'review-size.json'],
            },
        });
        try {
            expect(publishReview(number, fixture.port)).toBe(99);
            expect(fixture.posted.review?.event).toBe('APPROVE');
            expect(fixture.writes).toEqual([]);
            expect(fixture.calls.some((call) => call.endsWith('dossier.json'))).toBe(false);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses a risk plan file that exists but does not parse and never posts', () => {
        const fixture = dossierFixture({ plan: riskPlan() });
        writeFileSync(join(fixture.bundle, 'risk-plan.json'), '{ not a risk plan');
        try {
            const message = refusalMessage(() => publishReview(number, fixture.port));
            expect(message).toMatch(/risk-plan\.json/u);
            expect(message).toMatch(/does not parse/u);
            expect(fixture.calls).not.toContain('post');
            expect(fixture.posted.review).toBeUndefined();
            expect(fixture.writes).toEqual([]);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses a manifest that records generating the risk plan while the file is absent', () => {
        const fixture = dossierFixture({
            manifest: {
                pr: number,
                baseRefName: 'main',
                baseSha: base,
                headSha: head,
                generated: ['diff.patch', 'manifest.json', 'risk-plan.json'],
            },
        });
        try {
            const message = refusalMessage(() => publishReview(number, fixture.port));
            expect(message).toMatch(/missing review risk plan at .*risk-plan\.json/u);
            expect(fixture.calls).not.toContain('post');
            expect(fixture.posted.review).toBeUndefined();
            expect(fixture.writes).toEqual([]);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses a fresh dossier it cannot persist rather than skipping the durable record', () => {
        const fixture = dossierFixture({ plan: riskPlan(), writable: false });
        try {
            const message = refusalMessage(() => publishReview(number, fixture.port));
            expect(message).toMatch(/cannot write .*dossier\.json: the port has no bundle writer/u);
            expect(fixture.calls).not.toContain('post');
            expect(fixture.posted.review).toBeUndefined();
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses orchestrator acceptance when a plan-carrying bundle has no dossier', async () => {
        const fixture = dossierFixture({
            plan: riskPlan(),
            document: acceptanceDocument(),
            documentName: 'acceptance.json',
        });
        try {
            await expect(coordinateAcceptReview(number, acceptanceDependencies(fixture))).rejects.toThrow(
                /acceptance requires the head's review dossier/u
            );
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses orchestrator acceptance when the dossier records no publication', async () => {
        const { canonical } = derivedRecord({ comments: [], recommendation: 'approve' });
        const fixture = dossierFixture({
            plan: riskPlan(),
            dossier: JSON.parse(canonical),
            document: acceptanceDocument(),
            documentName: 'acceptance.json',
        });
        try {
            await expect(coordinateAcceptReview(number, acceptanceDependencies(fixture))).rejects.toThrow(
                /acceptance requires the dossier to record its review publication/u
            );
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses orchestrator acceptance when an accepted finding lacks its public binding', async () => {
        const { canonical } = derivedRecord({
            comments: [{ path: 'scripts/target.ts', line: 5, side: 'RIGHT' as const }],
            recommendation: 'request-changes',
            evidence: [],
        });
        const withPublication = appendReviewDossierEvents(parseReviewDossier(JSON.parse(canonical)), [
            { kind: 'review-published', reviewId: 99 },
        ]);
        const fixture = dossierFixture({
            plan: riskPlan(),
            dossier: JSON.parse(serializeReviewDossier(withPublication)),
            document: acceptanceDocument(),
            documentName: 'acceptance.json',
        });
        try {
            await expect(coordinateAcceptReview(number, acceptanceDependencies(fixture))).rejects.toThrow(
                /acceptance requires every accepted finding to bind one public comment; unbound: comment-0/u
            );
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('posts orchestrator acceptance when the dossier accounting is complete', async () => {
        const { canonical } = derivedRecord({ comments: [], recommendation: 'approve' });
        const withPublication = appendReviewDossierEvents(parseReviewDossier(JSON.parse(canonical)), [
            { kind: 'review-published', reviewId: 99 },
        ]);
        const dossierJson = JSON.parse(serializeReviewDossier(withPublication));
        const fixture = dossierFixture({
            plan: riskPlan(),
            dossier: dossierJson,
            document: {
                ...acceptanceDocument(),
                authorization: {
                    intent: 'deliver',
                    approvalReviewId: 99,
                    unresolvedThreads: 0,
                    evidenceManifestDigest: withPublication.dossierDigest,
                },
            },
            documentName: 'acceptance.json',
        });
        const accepted: string[] = [];
        try {
            await coordinateAcceptReview(number, acceptanceDependencies(fixture, accepted));
            expect(accepted).toEqual(['Final contract held.']);
            // One write: the delivery-authorized binding appended after the acceptance POST lands.
            expect(fixture.writes).toHaveLength(1);
            expect(fixture.writes[0]?.path).toBe(join(fixture.bundle, 'dossier.json'));
            const persisted = parseReviewDossier(fixture.readDossier());
            expect(deliveryAuthorization(persisted)).toEqual({
                reviewId: 99,
                approvalReviewId: 99,
                evidenceManifestDigest: withPublication.dossierDigest,
                unresolvedThreads: 0,
                intent: 'deliver',
            });
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    function acceptanceWithAuthorization() {
        const { canonical } = derivedRecord({ comments: [], recommendation: 'approve' });
        const withPublication = appendReviewDossierEvents(parseReviewDossier(JSON.parse(canonical)), [
            { kind: 'review-published', reviewId: 99 },
        ]);
        return { withPublication };
    }

    it('refuses orchestrator acceptance of a plan-carrying bundle without an authorization block', async () => {
        const { withPublication } = acceptanceWithAuthorization();
        const fixture = dossierFixture({
            plan: riskPlan(),
            dossier: JSON.parse(serializeReviewDossier(withPublication)),
            document: acceptanceDocument(),
            documentName: 'acceptance.json',
        });
        try {
            await expect(coordinateAcceptReview(number, acceptanceDependencies(fixture))).rejects.toThrow(
                /requires an authorization block/u
            );
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it.each([
        {
            label: 'an approval review id that is not the recorded publication',
            authorization: (dossierDigest: string) => ({
                intent: 'deliver',
                approvalReviewId: 97,
                unresolvedThreads: 0,
                evidenceManifestDigest: dossierDigest,
            }),
            message: /approvalReviewId 97 does not match the dossier's recorded publication 99/u,
        },
        {
            label: 'an unresolved-thread count that was never observed',
            authorization: (dossierDigest: string) => ({
                intent: 'deliver',
                approvalReviewId: 99,
                unresolvedThreads: 1,
                evidenceManifestDigest: dossierDigest,
            }),
            message: /unresolvedThreads 1 does not match the observed 0/u,
        },
        {
            label: 'an evidence-manifest digest that is not the dossier’s own',
            authorization: (_dossierDigest: string) => ({
                intent: 'deliver',
                approvalReviewId: 99,
                unresolvedThreads: 0,
                evidenceManifestDigest: 'e'.repeat(64),
            }),
            message: /evidenceManifestDigest does not match the dossier's digest/u,
        },
    ])('refuses orchestrator acceptance carrying %s', async ({ authorization, message }) => {
        const { withPublication } = acceptanceWithAuthorization();
        const fixture = dossierFixture({
            plan: riskPlan(),
            dossier: JSON.parse(serializeReviewDossier(withPublication)),
            document: {
                ...acceptanceDocument(),
                authorization: authorization(withPublication.dossierDigest),
            },
            documentName: 'acceptance.json',
        });
        try {
            await expect(coordinateAcceptReview(number, acceptanceDependencies(fixture))).rejects.toThrow(message);
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses a duplicate delivery authorization already recorded in the dossier', async () => {
        const { withPublication } = acceptanceWithAuthorization();
        // The reviewer publication itself records the delivery authorization on APPROVE: reviewId and
        // approvalReviewId both bind the just-posted reviewer review (99). Acceptance must refuse to
        // mint a second one.
        const alreadyAuthorized = appendReviewDossierEvents(withPublication, [
            {
                kind: 'delivery-authorized',
                reviewId: 99,
                approvalReviewId: 99,
                evidenceManifestDigest: withPublication.dossierDigest,
                unresolvedThreads: 0,
                intent: 'deliver',
            },
        ]);
        const fixture = dossierFixture({
            plan: riskPlan(),
            dossier: JSON.parse(serializeReviewDossier(alreadyAuthorized)),
            document: {
                ...acceptanceDocument(),
                authorization: {
                    intent: 'deliver',
                    approvalReviewId: 99,
                    unresolvedThreads: 0,
                    evidenceManifestDigest: alreadyAuthorized.dossierDigest,
                },
            },
            documentName: 'acceptance.json',
        });
        try {
            await expect(coordinateAcceptReview(number, acceptanceDependencies(fixture))).rejects.toThrow(
                /already records delivery authorization 99; refusing a duplicate authorization/u
            );
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });

    it('refuses an authorization block on a legacy bundle with no evidence manifest', async () => {
        const fixture = dossierFixture({
            document: {
                ...acceptanceDocument(),
                authorization: {
                    intent: 'deliver',
                    approvalReviewId: 99,
                    unresolvedThreads: 0,
                    evidenceManifestDigest: 'e'.repeat(64),
                },
            },
            documentName: 'acceptance.json',
        });
        try {
            await expect(coordinateAcceptReview(number, acceptanceDependencies(fixture))).rejects.toThrow(
                /acceptance authorization cannot bind: the legacy bundle .* carries no evidence manifest/u
            );
        } finally {
            removeTemporaryDirectory(fixture.root);
        }
    });
});

describe('review.json round record', () => {
    const base = {
        event: 'REQUEST_CHANGES',
        body: 'One blocking finding.',
        comments: [validComment],
        reviewerModel: 'glm-5.3-flash',
    };
    const draw = { stance: 'stale replay binding', reviewerModel: 'review-model', tier: 'standard', outcome: 'clean' };

    it('parses draws and discards, and omits both keys when absent', () => {
        expect(
            parseReviewDocument({ ...base, draws: [draw], discarded: [{ finding: 'f', reason: 'r' }] })
        ).toMatchObject({ draws: [draw], discarded: [{ finding: 'f', reason: 'r' }] });
        const bare = parseReviewDocument(base);
        expect(bare).not.toHaveProperty('draws');
        expect(bare).not.toHaveProperty('discarded');
    });

    it.each([
        ['a non-array draws', { draws: {} }, 'review.json draws must be an array'],
        [
            'an extra draw field',
            { draws: [{ ...draw, exhaustion: 'x' }] },
            'review.json draws[0] fields must be outcome,reviewerModel,stance,tier, found exhaustion,outcome,reviewerModel,stance,tier',
        ],
        [
            'an unknown outcome',
            { draws: [{ ...draw, outcome: 'blocker-found' }] },
            'review.json draws[0].outcome must be one of clean, findings, found "blocker-found"',
        ],
        [
            'a blank stance',
            { draws: [{ ...draw, stance: '' }] },
            'review.json draws[0].stance value at index 0 is blank',
        ],
        [
            'a repeated stance and model',
            { draws: [draw, draw] },
            'review.json draws[1] repeats stance stale replay binding on review-model',
        ],
        ['a non-array discarded', { discarded: 'x' }, 'review.json discarded must be an array'],
        [
            'a discard with a stance',
            { discarded: [{ finding: 'f', reason: 'r', stance: 's' }] },
            'review.json discarded[0] fields must be finding,reason, found finding,reason,stance',
        ],
    ])('refuses %s', (_label, fields, message) => {
        expect(() => parseReviewDocument({ ...base, ...fields })).toThrow(message);
    });
});
