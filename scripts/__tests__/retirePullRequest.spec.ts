import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from '../canonicalRecord.ts';
import { renderConfirmationReply } from '../confirmReviewRepairs.ts';
import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import {
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockOwner,
    withPullRequestMutationLock,
    type PullRequestMutationSerialization,
} from '../pullRequestMutationLock.ts';
import {
    parseRetirementRecord,
    renderRetirementMarker,
    retirementReviewBodyDigest,
    type RetirementRecord,
} from '../retirementRecord.ts';
import {
    inspectRetirementReviewState,
    parseRetirePullRequestArgs,
    retirePullRequest,
    serializedRetirePullRequest,
    type RetirePullRequestPort,
    type RetirementReviewState,
} from '../retirePullRequest.ts';
import { renderReviewRepairReply, type ReviewRepairRecord } from '../reviewRepair.ts';
import { commentClientMutationId, type IssueComment, type SupersededPullRequest } from '../supersedePullRequestGh.ts';

const pr = 5361;
const head = 'a'.repeat(40);
const findingId = '1001';
const reviewId = 'PRR_requested';
const threadId = 'PRRT_1';
const repairId = '1002';
const confirmationId = '1003';
const repair: ReviewRepairRecord = {
    format: 'repair-v1',
    pr,
    thread: threadId,
    finding: { commentId: Number(findingId), path: 'scripts/test-health-gate-scripts.sh', line: 237, side: 'RIGHT' },
    commit: head,
    summary: 'Corrected the audit note.',
    evidence: [],
    head,
};
const record: RetirementRecord = {
    format: 'retirement-v1',
    pr,
    head,
    base: 'main',
    rationale: 'The obsolete source branch was retired; the unsuppressed hosted scan now passes.',
    evidence: [
        {
            url: 'https://github.com/jcosta33/sourdaw/actions/runs/39926416970',
            observation: 'Scheduled scan detected its positive control and found no real target leak.',
        },
    ],
    findings: [
        {
            rootCommentId: findingId,
            threadId,
            authorRepairCommentId: repairId,
            reviewerConfirmationCommentId: confirmationId,
        },
    ],
    reviewBodies: [
        { reviewId, bodyDigest: retirementReviewBodyDigest('One audit fact is wrong.'), rootCommentIds: [findingId] },
    ],
};

function comment(id: string, body: string, authorNodeId: string): IssueComment {
    return {
        id: `IC_${id}`,
        fullDatabaseId: id,
        body,
        authorNodeId,
        authorLogin: 'bot[bot]',
        authorType: 'Bot',
    };
}

function reviewState(): RetirementReviewState {
    return {
        threads: [
            {
                threadId,
                rootCommentId: findingId,
                rootReviewId: reviewId,
                resolved: true,
                replies: [
                    { id: repairId, body: renderReviewRepairReply(repair), authorNodeId: AUTHOR_BOT_NODE_ID },
                    {
                        id: confirmationId,
                        body: renderConfirmationReply(repair, head),
                        authorNodeId: REVIEWER_BOT_NODE_ID,
                    },
                ],
            },
        ],
        requestedReviews: [{ reviewId, body: 'One audit fact is wrong.', head }],
    };
}

type FixtureOptions = {
    head?: string;
    headRepository?: string | null;
    base?: string;
    reviewState?: RetirementReviewState;
    afterCommentReviewState?: RetirementReviewState;
    closeError?: boolean;
    closeMovesHead?: boolean;
};

function fixture(options: FixtureOptions = {}) {
    const calls: string[] = [];
    let state = 'OPEN';
    let closedAt: string | null = null;
    let currentHead = options.head ?? head;
    let comments: IssueComment[] = [];
    let commentPosted = false;
    const inspect = (): SupersededPullRequest => ({
        number: pr,
        state,
        head: currentHead,
        headRefName: 'agent/4944/nightly-secret-scan-bacteria-fingerprint',
        headRepository: options.headRepository === undefined ? 'jcosta33/sourdaw' : options.headRepository,
        repository: 'jcosta33/sourdaw',
        base: options.base ?? 'main',
        merged: false,
        closedAt,
        comments: [...comments],
    });
    const port: RetirePullRequestPort = {
        inspect: () => inspect(),
        inspectReviewThreads: () => [],
        inspectRetirementReviewState: () => {
            calls.push('reviews');
            if (commentPosted) {
                return options.afterCommentReviewState ?? options.reviewState ?? reviewState();
            }
            return options.reviewState ?? reviewState();
        },
        comment: (_number, body) => {
            calls.push('comment');
            commentPosted = true;
            const created = comment('2001', body, AUTHOR_BOT_NODE_ID);
            comments.push(created);
            return { ...created, clientMutationId: commentClientMutationId(pr, body) };
        },
        close: () => {
            calls.push('close');
            if (options.closeError) {
                throw new Error('close transport lost');
            }
            state = 'CLOSED';
            closedAt = '2026-10-24T00:00:00Z';
            if (options.closeMovesHead) {
                currentHead = 'b'.repeat(40);
            }
            return { closedAt };
        },
        deleteComment: (id) => {
            calls.push('delete');
            comments = comments.filter((entry) => entry.id !== id);
        },
        log: (message) => calls.push(message),
    };
    return { calls, port, state: () => inspect() };
}

async function withLockRoot(operation: (root: string) => Promise<void>): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-retirement-lock-'));
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_TRACE2_EVENT', '0');
    try {
        execFileSync('git', ['init', '--quiet'], { cwd: root });
        await operation(root);
    } finally {
        vi.unstubAllEnvs();
        rmSync(root, { recursive: true, force: true });
    }
}

const serializeFixture: PullRequestMutationSerialization = (root, number, operation) =>
    withPullRequestMutationLock(root, number, operation, {
        ownerFence: { kind: 'pid', pid: process.pid, startedAt: 'retirement-fixture-process' },
    });

function runSerialized(root: string, port: RetirePullRequestPort) {
    return serializedRetirePullRequest(root, pr, head, record, AUTHOR_BOT_NODE_ID, port, serializeFixture);
}

function ownerOid(root: string): string | undefined {
    return readPullRequestMutationLockOid(root, pullRequestMutationLockRef(pr), pr);
}

describe('native obsolete pull-request retirement', () => {
    it('reproduces the missing native path by requiring a confirmed-repair record to close exactly once', () => {
        const { calls, port, state } = fixture();

        expect(retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toBe('pull-request-retired:5361');
        expect(state().state).toBe('CLOSED');
        expect(state().comments).toHaveLength(1);
        expect(state().comments[0]?.body).toBe(renderRetirementMarker(record));
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual(['comment', 'close']);

        expect(retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toBe('pull-request-retired:5361');
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual(['comment', 'close']);
    });

    const refusalCases: [string, string, RetirementRecord, RetirementReviewState, string, string][] = [
        ['wrong actor', REVIEWER_BOT_NODE_ID, record, reviewState(), head, 'main'],
        ['moved head', AUTHOR_BOT_NODE_ID, record, reviewState(), 'b'.repeat(40), 'main'],
        ['moved base', AUTHOR_BOT_NODE_ID, record, reviewState(), head, 'other'],
        [
            'unresolved root',
            AUTHOR_BOT_NODE_ID,
            record,
            { ...reviewState(), threads: [{ ...reviewState().threads[0]!, resolved: false }] },
            head,
            'main',
        ],
        ['missing root', AUTHOR_BOT_NODE_ID, record, { ...reviewState(), threads: [] }, head, 'main'],
        [
            'unmapped body review',
            AUTHOR_BOT_NODE_ID,
            record,
            { ...reviewState(), requestedReviews: [{ reviewId: 'PRR_other', body: 'An additional issue.', head }] },
            head,
            'main',
        ],
    ];

    it.each(refusalCases)('refuses %s before any remote write', (_label, actor, input, reviews, actualHead, base) => {
        const { calls, port } = fixture({ head: actualHead, base, reviewState: reviews });

        expect(() => retirePullRequest(pr, head, input, actor, port)).toThrow();
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual([]);
    });

    it('refuses a reviewer confirmation whose record digest differs from the author repair', () => {
        const changed = { ...repair, summary: 'Different repair.' };
        const reviews = reviewState();
        reviews.threads[0]!.replies[1] = {
            id: confirmationId,
            body: renderConfirmationReply(changed, head),
            authorNodeId: REVIEWER_BOT_NODE_ID,
        };
        const { calls, port } = fixture({ reviewState: reviews });

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual([]);
    });

    it('refuses a confirmation that predates the selected repair before any mutation', () => {
        const reviews = reviewState();
        reviews.threads[0]!.replies[0]!.id = '1003';
        reviews.threads[0]!.replies[1]!.id = '1002';
        const input = {
            ...record,
            findings: [
                { ...record.findings[0]!, authorRepairCommentId: '1003', reviewerConfirmationCommentId: '1002' },
            ],
        };
        const { calls, port, state } = fixture({ reviewState: reviews });

        expect(() => retirePullRequest(pr, head, input, AUTHOR_BOT_NODE_ID, port)).toThrow(/confirmation.*repair/u);
        expect(state()).toMatchObject({ state: 'OPEN', comments: [] });
        expect(calls.filter((call) => ['comment', 'delete', 'close'].includes(call))).toEqual([]);
    });

    it.each(['initial', 'prewrite', 'preclose', 'postclose', 'closed replay'] as const)(
        'refuses same-ID review-body edits at %s proof',
        (phase) => {
            const { calls, port, state } = fixture();
            if (phase === 'closed replay') {
                retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port);
            }
            let reads = 0;
            const editAt = { initial: 1, prewrite: 2, preclose: 3, postclose: 4, 'closed replay': 1 }[phase];
            port.inspectRetirementReviewState = () => {
                const reviews = reviewState();
                if (++reads >= editAt) {
                    reviews.requestedReviews[0]!.body += ' A new independent blocker.';
                }
                return reviews;
            };
            const beforeWrites = calls.filter((call) => ['comment', 'delete', 'close'].includes(call));

            expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow(/review.*body/u);
            const writes = calls.filter((call) => ['comment', 'delete', 'close'].includes(call));
            if (phase === 'initial' || phase === 'prewrite' || phase === 'closed replay') {
                expect(writes).toEqual(beforeWrites);
            } else if (phase === 'preclose') {
                expect(writes).toEqual(['comment', 'delete']);
                expect(state()).toMatchObject({ state: 'OPEN', comments: [] });
            } else {
                expect(writes).toEqual(['comment', 'close']);
                expect(state().state).toBe('CLOSED');
                expect(state().comments).toHaveLength(1);
            }
        }
    );

    it.each([null, 'fork-owner/sourdaw'])('refuses a %s source repository before any write', (headRepository) => {
        const { calls, port } = fixture({ headRepository });
        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual([]);
    });

    it('refuses a retirement with no confirmed finding or requested review', () => {
        const { calls, port } = fixture({ reviewState: { threads: [], requestedReviews: [] } });
        expect(() =>
            retirePullRequest(pr, head, { ...record, findings: [], reviewBodies: [] }, AUTHOR_BOT_NODE_ID, port)
        ).toThrow();
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual([]);
    });

    it('compensates a newly posted marker when the review-root set changes before close', () => {
        const changed = reviewState();
        changed.threads.push({ ...changed.threads[0]!, threadId: 'PRRT_new', rootCommentId: '1004' });
        const { calls, port, state } = fixture({ afterCommentReviewState: changed });

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
        expect(state().state).toBe('OPEN');
        expect(state().comments).toEqual([]);
        expect(calls.filter((call) => call === 'comment' || call === 'close' || call === 'delete')).toEqual([
            'comment',
            'delete',
        ]);
    });

    it('preserves the exact marker and refuses success when close transport is ambiguous', () => {
        const { calls, port, state } = fixture({ closeError: true });

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow(/close transport lost/u);
        expect(state().comments).toHaveLength(1);
        expect(calls).not.toContain('delete');
    });

    it('refuses post-close head movement and preserves the marker for investigation', () => {
        const { calls, port, state } = fixture({ closeMovesHead: true });
        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
        expect(state().state).toBe('CLOSED');
        expect(state().comments).toHaveLength(1);
        expect(calls).not.toContain('delete');
    });

    it('refuses closure if its sole marker disappears at the last PR proof', () => {
        const { calls, port, state } = fixture();
        const inspect = port.inspect;
        let reads = 0;
        port.inspect = (number) => {
            if (++reads === 4) {
                port.deleteComment('IC_2001');
            }
            return inspect(number);
        };

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow(/marker/u);
        expect(calls).not.toContain('close');
        expect(state()).toMatchObject({ state: 'OPEN', comments: [] });
    });

    it('rejects malformed, duplicate-key and credential-shaped records before publication', () => {
        expect(() => parseRetirementRecord('{"format":"retirement-v1","format":"retirement-v1"}')).toThrow();
        expect(() => parseRetirementRecord(JSON.stringify({ ...record, rationale: 'Bearer abc123' }))).toThrow();
    });

    it.each(['initial', 'closed replay'] as const)('refuses unbound historical review bodies on %s', (phase) => {
        const { calls, port, state } = fixture();
        if (phase === 'closed replay') {
            retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port);
        }
        const historical = { ...record, reviewBodies: [{ reviewId, rootCommentIds: [findingId] }] };
        const before = state();
        const writes = [...calls];
        expect(() => parseRetirementRecord(canonicalJson(historical))).toThrow(/missing or unexpected fields/u);
        expect(() =>
            retirePullRequest(pr, head, parseRetirementRecord(canonicalJson(historical)), AUTHOR_BOT_NODE_ID, port)
        ).toThrow();
        expect(state()).toEqual(before);
        expect(calls).toEqual(writes);
    });

    it.each(['OPEN', 'CLOSED'] as const)('refuses to adopt an unbound historical marker on an %s PR', (state) => {
        const current = fixture();
        const inspect = current.port.inspect;
        const historical = { ...record, reviewBodies: [{ reviewId, rootCommentIds: [findingId] }] };
        current.port.inspect = (number) => ({
            ...inspect(number),
            state,
            closedAt: state === 'CLOSED' ? '2026-10-24T00:00:00Z' : null,
            comments: [comment('2001', `sourdaw-retirement-v1 ${canonicalJson(historical)}`, AUTHOR_BOT_NODE_ID)],
        });

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, current.port)).toThrow();
        expect(current.calls.filter((call) => ['comment', 'delete', 'close'].includes(call))).toEqual([]);
    });

    it('binds exact UTF-8 review-body bytes without trimming or interpreting prose', () => {
        expect(retirementReviewBodyDigest('One audit fact is wrong.')).toBe(record.reviewBodies[0]!.bodyDigest);
        expect(retirementReviewBodyDigest('One audit fact is wrong.\n')).not.toBe(record.reviewBodies[0]!.bodyDigest);
        expect(() =>
            parseRetirementRecord(
                canonicalJson({ ...record, reviewBodies: [{ ...record.reviewBodies[0], bodyDigest: 'a'.repeat(40) }] })
            )
        ).toThrow(/SHA-256/u);
    });

    it('holds the real owner through all reads and writes, then releases before reporting success', async () => {
        await withLockRoot(async (root) => {
            const { port, calls } = fixture();
            const inspect = port.inspect;
            port.inspect = (number) => {
                expect(ownerOid(root)).toBeDefined();
                return inspect(number);
            };
            const comment = port.comment;
            const close = port.close;
            const checkAttempt = () => {
                const oid = ownerOid(root);
                expect(oid).toBeDefined();
                expect(readPullRequestMutationLockOwner(root, oid!, pr)).toMatchObject({
                    version: 4,
                    operation: 'delivery',
                    mutation: { phase: 'remote-mutation-attempted' },
                });
            };
            port.comment = (number, body) => {
                checkAttempt();
                return comment(number, body);
            };
            port.close = (number) => {
                checkAttempt();
                return close(number);
            };
            port.log = (message) => {
                expect(ownerOid(root)).toBeUndefined();
                calls.push(message);
            };

            await expect(runSerialized(root, port)).resolves.toBe('pull-request-retired:5361');
            await expect(runSerialized(root, port)).resolves.toBe('pull-request-retired:5361');
            expect(calls.filter((call) => ['comment', 'close', 'delete'].includes(call))).toEqual(['comment', 'close']);
            expect(ownerOid(root)).toBeUndefined();
        });
    });

    it('releases a read-only refusal and a verified complete OPEN rollback while still refusing', async () => {
        await withLockRoot(async (root) => {
            const refused = fixture({ head: 'b'.repeat(40) });
            await expect(runSerialized(root, refused.port)).rejects.toThrow();
            expect(ownerOid(root)).toBeUndefined();
            const changed = reviewState();
            changed.requestedReviews[0]!.body += ' A later blocker.';
            const rolledBack = fixture({ afterCommentReviewState: changed });
            const deleteComment = rolledBack.port.deleteComment;
            rolledBack.port.deleteComment = (id) => {
                const oid = ownerOid(root);
                expect(oid).toBeDefined();
                expect(readPullRequestMutationLockOwner(root, oid!, pr)).toMatchObject({
                    mutation: { phase: 'remote-mutation-attempted' },
                });
                deleteComment(id);
            };
            await expect(runSerialized(root, rolledBack.port)).rejects.toThrow(/review.*body/u);
            expect(rolledBack.state()).toMatchObject({ state: 'OPEN', comments: [] });
            expect(rolledBack.calls).not.toContain('pull-request-retired:5361');
            expect(ownerOid(root)).toBeUndefined();
        });
    });

    it.each([
        'comment ambiguity',
        'close ambiguity',
        'failed rollback',
        'unverified rollback',
        'post-close body drift',
    ] as const)('retains the real journaled owner and recovery route after %s', async (failure) => {
        await withLockRoot(async (root) => {
            const changed = reviewState();
            changed.requestedReviews[0]!.body += ' A later blocker.';
            const current = fixture({
                closeError: failure === 'close ambiguity',
                afterCommentReviewState: failure.includes('rollback') ? changed : undefined,
            });
            if (failure === 'comment ambiguity') {
                const comment = current.port.comment;
                current.port.comment = (number, body) => {
                    comment(number, body);
                    throw new Error('comment transport lost');
                };
            } else if (failure === 'failed rollback') {
                current.port.deleteComment = () => {
                    throw new Error('delete denied');
                };
            } else if (failure === 'unverified rollback') {
                const inspect = current.port.inspect;
                let deleted = false;
                const deleteComment = current.port.deleteComment;
                current.port.deleteComment = (id) => {
                    deleteComment(id);
                    deleted = true;
                };
                current.port.inspect = (number) => {
                    if (deleted) {
                        throw new Error('rollback verification unavailable');
                    }
                    return inspect(number);
                };
            } else if (failure === 'post-close body drift') {
                current.port.inspectRetirementReviewState = () =>
                    current.state().state === 'CLOSED' ? changed : reviewState();
            }
            const attempt = runSerialized(root, current.port);
            await expect(attempt).rejects.toThrow(/preserved lock owner/u);
            const oid = ownerOid(root);
            expect(oid).toBeDefined();
            expect(readPullRequestMutationLockOwner(root, oid!, pr)).toMatchObject({
                version: 4,
                operation: 'delivery',
                mutation: { phase: 'remote-mutation-attempted' },
            });
            await expect(attempt).rejects.toThrow(`pnpm deliver --recover-lock ${pr} --owner ${oid}`);
            expect(current.calls).not.toContain('pull-request-retired:5361');
            const beforeRetry = [...current.calls];
            await expect(runSerialized(root, current.port)).rejects.toThrow(/already being delivered/u);
            expect(current.calls).toEqual(beforeRetry);
            expect(ownerOid(root)).toBe(oid);
        });
    });

    it('requires exact CLI head and record arguments', () => {
        expect(parseRetirePullRequestArgs(['5361', '--head', head, '--record', '/tmp/retirement.json'])).toMatchObject({
            number: pr,
            head,
            recordPath: '/tmp/retirement.json',
        });
        expect(() => parseRetirePullRequestArgs(['5361', '--record', '/tmp/retirement.json'])).toThrow();
    });

    it.each([
        ['other-owner/sourdaw', pr],
        ['jcosta33/sourdaw', pr + 1],
    ])('refuses review read bound to repository %s and PR %i', (repository, number) => {
        const page = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
        const gh = () =>
            JSON.stringify({
                data: {
                    repository: {
                        nameWithOwner: repository,
                        pullRequest: { number, reviewThreads: page, reviews: page },
                    },
                },
            });
        expect(() => inspectRetirementReviewState(pr, gh)).toThrow();
    });
});
