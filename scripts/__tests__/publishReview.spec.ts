import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REVIEWER_BOT_NODE_ID, type GhSession } from '../githubAppIdentity.ts';
import {
    coordinatePublishReview,
    defaultPublishReviewCoordinatorDependencies,
    exactPublishedReview,
    inspectReviewPublicationRemote,
    parsePublishReviewArgs,
    parseReviewDocument,
    publishPreparedReview,
    publishReview,
    reviewPublicationPayload,
    reviewPublicationPayloadDigest,
    runRecoverPublishReviewLockCli,
    runPublishReviewCli,
    shellPort,
    type PublishReviewCoordinatorDependencies,
    type PublishReviewPort,
} from '../publishReview.ts';
import {
    type PullRequestMutationLockOwner,
    currentReviewPublicationOwnerFence,
    pullRequestMutationLockRef,
    reviewPublicationRecoveryReceiptRef,
    readPullRequestMutationLockReceipt,
    readPullRequestMutationLockOwner,
    readPullRequestMutationLockOid,
    reviewPublicationOwnerFenceIsLive,
    withPullRequestReviewPublicationMutationLock,
    withPullRequestMutationLock,
    writePullRequestMutationLockOwner,
    writePullRequestMutationLockReceipt,
} from '../pullRequestMutationLock.ts';
import { legacyReviewPublicationIncidents } from '../reviewPublicationLegacyIncidents.ts';

const validComment = {
    path: 'scripts/deliverPullRequest.ts',
    line: 10,
    side: 'RIGHT' as const,
    defect: 'COMMENT still authorizes merge',
    consequence: 'A stale COMMENT could ship',
    done: 'Require reviewer APPROVED on this head',
};

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
        rmSync(root, { recursive: true, force: true });
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
    } = {}
) {
    const calls: string[] = [];
    const logs: string[] = [];
    const posted: { review?: Parameters<PublishReviewPort['postReview']>[0] } = {};
    let head = input.head ?? 'headsha';
    let state = input.state ?? 'OPEN';
    const port: PublishReviewPort = {
        primaryRoot: () => '/repo',
        pullRequest: () => {
            const current = head;
            const currentState = state;
            if (input.laterHead !== undefined) {
                head = input.laterHead;
            }
            if (input.laterState !== undefined) {
                state = input.laterState;
            }
            return { state: currentState, head: current };
        },
        readReviewJson: (path) => {
            calls.push(`read:${path}`);
            if (input.missing === true) {
                throw new Error('ENOENT');
            }
            return input.json ?? { event: 'APPROVE', body: 'ok', comments: [] };
        },
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
        log: (message) => logs.push(message),
    };
    return { port, calls, logs, posted };
}

function createJournaledRecoveryFixture(phase: 'prepared' | 'remote-mutation-attempted' = 'remote-mutation-attempted') {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-recovery-'));
    const number = 42;
    const head = 'a'.repeat(40);
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
            token: '11111111-1111-4111-8111-111111111111',
            operation: 'review-publication',
            number,
            expectedHead: head,
            payloadDigest: digest,
            reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
            ownerFence: { kind: 'pid', pid: 999_999, startedAt: 'Thu Jan 01 00:00:00 1970' },
            mutation: { phase, epoch: 1 },
        },
        number
    );
    runGit(root, ['update-ref', pullRequestMutationLockRef(number), ownerOid]);
    return { root, number, head, ownerOid };
}

function publicationLivenessOwner(
    ownerFence: Extract<Parameters<typeof reviewPublicationOwnerFenceIsLive>[0]['ownerFence'], { kind: string }>
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
                                body: 'ok',
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

    it.each([
        ['closes', { state: 'CLOSED', head: 'headsha' }],
        ['moves', { state: 'OPEN', head: 'moved-head' }],
    ])('does not journal or attempt a review when the pull request %s after preflight', async (_label, lockedPullRequest) => {
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
    });

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
                    pullRequest: () => ({ state: 'OPEN', head: 'a'.repeat(40) }),
                    readReviewJson: () => ({ event: 'APPROVE', body: 'Attacked; held.', comments: [] }),
                    readBundleDiff: () => '',
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
                            body: 'Attacked; held.',
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
            rmSync(root, { recursive: true, force: true });
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
                            ownerFence: currentReviewPublicationOwnerFence,
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
            rmSync(root, { recursive: true, force: true });
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
        expect(calls[1]).toBe('post:headsha:APPROVE:ok');
        expect(logs.at(-1)).toBe('99');
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

    it('still posts an APPROVE document that has a body and no comments', () => {
        const { port, calls } = fakePort({
            json: { event: 'APPROVE', body: 'Attacked the merge gate; it held.', comments: [] },
        });

        publishReview(42, port);

        expect(calls[1]).toBe('post:headsha:APPROVE:Attacked the merge gate; it held.');
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

    it('retains the exact shared owner when the production review POST becomes indeterminate', async () => {
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-publish-lock-'));
        runGit(primaryRoot, ['init', '-b', 'main']);
        const number = 7819;
        const ref = `refs/sourdaw/delivery/pr-${number}`;
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
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

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
        expect(reviewPublicationPayloadDigest(payload)).toBe('15e97754a7af071d05cb92ef1594eb18737a7b9ab7851e2c3409cc9526d51a11');
    });

    it('retains a dead owner that attempted a remote mutation after two no-review reads', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-recovery-'));
        const number = 42;
        const head = 'a'.repeat(40);
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
                    currentOwnerFence: () => ({ kind: 'pid', pid: process.pid, startedAt: 'test-process' }),
                })
            ).rejects.toThrow(/attempted a remote mutation without landed evidence/);
            expect(inspections).toBe(2);
            expect(inspectedNumbers).toEqual([number, number]);
            expect(inspectedHeads).toEqual([head, head]);
            const retainedOid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
            expect(retainedOid).toMatch(/^[0-9a-f]{40}$/);
            expect(retainedOid).not.toBe(ownerOid);
            const retainedOwner = readPullRequestMutationLockOwner(root, retainedOid!, number);
            expect(retainedOwner).toMatchObject({ mutation: { phase: 'remote-mutation-attempted' } });

            await expect(
                runRecoverPublishReviewLockCli([String(number), '--owner', retainedOid!], {
                    primaryRoot: () => root,
                    authenticateReviewer: async () => ({
                        minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                        session: { configDir: '/tmp/reviewer', env: {}, dispose: () => undefined },
                    }),
                    repositoryName: () => 'jcosta33/sourdaw',
                    inspect: () => ({ state: 'OPEN', head, reviews: [] }),
                    isOwnerLive: () => false,
                    currentOwnerFence: () => ({ kind: 'pid', pid: process.pid, startedAt: 'test-process' }),
                })
            ).rejects.toThrow(/attempted a remote mutation without landed evidence/);
            const retryRetainedOid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
            expect(retryRetainedOid).toMatch(/^[0-9a-f]{40}$/);
            expect(readPullRequestMutationLockOwner(root, retryRetainedOid!, number)).toMatchObject({
                mutation: { phase: 'remote-mutation-attempted' },
            });
            expect(readPullRequestMutationLockReceipt(root, number, ownerOid)).toBeUndefined();
            expect(readPullRequestMutationLockReceipt(root, number, retainedOid!)).toBeUndefined();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('releases a dead prepared owner after two definitive no-review reads', async () => {
        const fixture = createJournaledRecoveryFixture('prepared');
        try {
            await expect(
                runRecoverPublishReviewLockCli(
                    [String(fixture.number), '--owner', fixture.ownerOid],
                    recoveryDependencies(fixture.root, (expectedHead) => ({ state: 'OPEN', head: expectedHead, reviews: [] }))
                )
            ).resolves.toBe(0);
            expect(
                readPullRequestMutationLockOid(fixture.root, pullRequestMutationLockRef(fixture.number), fixture.number)
            ).toBeUndefined();
        } finally {
            rmSync(fixture.root, { recursive: true, force: true });
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
            expect(
                readPullRequestMutationLockReceipt(fixture.root, fixture.number, fixture.ownerOid)
            ).toEqual({
                version: 1,
                operation: 'review-publication-recovery',
                number: fixture.number,
                ownerOid: fixture.ownerOid,
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
        }
    });

    it('releases only the exact trusted PR 3342 legacy receipt and owner after no-review reads', async () => {
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
                    }
                )
            ).resolves.toBe(0);
            expect(
                readPullRequestMutationLockOid(
                    fixture.root,
                    pullRequestMutationLockRef(fixture.incident.number),
                    fixture.incident.number
                )
            ).toBeUndefined();
        } finally {
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
        }
    });

    it.each([
        ['invalid JSON', '{'],
        ['missing start-time fence', JSON.stringify({ ...createJournaledRecoveryFixture, version: 3 })],
    ])('retains malformed v3 owner data (%s)', async (_label, contents) => {
        const fixture = createJournaledRecoveryFixture();
        try {
            const malformed =
                contents === '{'
                    ? contents
                    : JSON.stringify({
                          version: 3,
                          pid: 999_999,
                          token: '44444444-4444-4444-8444-444444444444',
                          operation: 'review-publication',
                          number: fixture.number,
                          expectedHead: fixture.head,
                          payloadDigest: 'd'.repeat(64),
                          reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
                          ownerFence: { kind: 'pid', pid: 999_999 },
                          mutation: { phase: 'prepared', epoch: 1 },
                      });
            const oid = writeRawLockOwner(fixture.root, malformed);
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
                    recoveryDependencies(fixture.root, (expectedHead) => ({ state: 'OPEN', head: expectedHead, reviews: [] }))
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            /retained reviewer actor does not match the authenticated reviewer/,
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            rmSync(fixture.root, { recursive: true, force: true });
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
            expect(reviewPublicationOwnerFenceIsLive(groupOwner)).toBe(true);
            writePsOutput('99 42 child-start\n1 1 unrelated-start\n');
            expect(reviewPublicationOwnerFenceIsLive(groupOwner)).toBe(true);
            writePsOutput('42 42 reused-leader-start\n99 42 child-start\n');
            expect(reviewPublicationOwnerFenceIsLive(groupOwner)).toBe(false);
            writePsOutput('1 1 unrelated-start\n');
            expect(reviewPublicationOwnerFenceIsLive(groupOwner)).toBe(false);
            writePsOutput('not a ps row\n');
            expect(() => reviewPublicationOwnerFenceIsLive(groupOwner)).toThrow(/process-group liveness is unreadable/);

            const pidOwner = publicationLivenessOwner({ kind: 'pid', pid: 999_999, startedAt: 'original-pid-start' });
            writePsOutput('original-pid-start\n');
            expect(reviewPublicationOwnerFenceIsLive(pidOwner)).toBe(true);
            writePsOutput('reused-pid-start\n');
            expect(reviewPublicationOwnerFenceIsLive(pidOwner)).toBe(false);
            writePsOutput('', 2);
            expect(() => reviewPublicationOwnerFenceIsLive(pidOwner)).toThrow(/process liveness is unreadable/);
        } finally {
            if (previous === undefined) {
                delete process.env.SOURDAW_TRUSTED_PS_PATH;
            } else {
                process.env.SOURDAW_TRUSTED_PS_PATH = previous;
            }
            rmSync(root, { recursive: true, force: true });
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
            expect(reviewPublicationOwnerFenceIsLive(owner, 'win32')).toBe(true);
            writePowerShellOutput(
                JSON.stringify({ ProcessId: 99, ParentProcessId: 42, CreationDate: '2026-09-02T10:00:01.0000000Z' })
            );
            expect(reviewPublicationOwnerFenceIsLive(owner, 'win32')).toBe(true);
            writePowerShellOutput(
                JSON.stringify([
                    { ProcessId: 42, ParentProcessId: 1, CreationDate: '2026-09-02T11:00:00.0000000Z' },
                    { ProcessId: 98, ParentProcessId: 42, CreationDate: '2026-09-02T10:30:00.0000000Z' },
                ])
            );
            expect(reviewPublicationOwnerFenceIsLive(owner, 'win32')).toBe(true);
            writePowerShellOutput(
                JSON.stringify([
                    { ProcessId: 42, ParentProcessId: 1, CreationDate: '2026-09-02T11:00:00.0000000Z' },
                    { ProcessId: 99, ParentProcessId: 42, CreationDate: '2026-09-02T11:00:01.0000000Z' },
                ])
            );
            expect(reviewPublicationOwnerFenceIsLive(owner, 'win32')).toBe(false);
            writePowerShellOutput(
                JSON.stringify({ ProcessId: 99, ParentProcessId: 1, CreationDate: '2026-09-02T10:00:01.0000000Z' })
            );
            expect(reviewPublicationOwnerFenceIsLive(owner, 'win32')).toBe(false);
            writePowerShellOutput('{');
            expect(() => reviewPublicationOwnerFenceIsLive(owner, 'win32')).toThrow(
                /Windows process liveness is unreadable/
            );
        } finally {
            if (previous === undefined) {
                delete process.env.SOURDAW_TRUSTED_POWERSHELL_PATH;
            } else {
                process.env.SOURDAW_TRUSTED_POWERSHELL_PATH = previous;
            }
            rmSync(root, { recursive: true, force: true });
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
                rmSync(root, { recursive: true, force: true });
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
            rmSync(root, { recursive: true, force: true });
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
            rmSync(root, { recursive: true, force: true });
        }
    });
});
