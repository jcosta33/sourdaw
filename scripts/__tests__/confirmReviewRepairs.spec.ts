import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    CONFIRM_USAGE,
    confirmReplyClientMutationId,
    confirmResolveClientMutationId,
    confirmReviewRepairs,
    coordinateConfirmReviewRepairs,
    defaultConfirmReviewRepairsCoordinatorDependencies,
    isAncestorExitStatus,
    parseConfirmReviewRepairsArgs,
    postConfirmationReply,
    readPullRequestBase,
    readPullRequestHead,
    readReviewThreads,
    renderConfirmationReply,
    resolveConfirmedThread,
    runConfirmReviewRepairsCli,
    shellIsAncestor,
    shellPort,
    type ConfirmReviewRepairsCoordinatorDependencies,
    type ConfirmReviewRepairsPort,
} from '../confirmReviewRepairs.ts';
import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID, type GhSession } from '../githubAppIdentity.ts';
import {
    confirmClientMutationId,
    parseReviewRepairReply,
    renderReviewRepairReply,
    selectEligibleRepairs,
    type ReviewRepairRecord,
    type ReviewRepairThreadState,
} from '../reviewRepair.ts';

const PR = 3_000;
const THREAD = 'PRRT_kwDOconfirm';
const SECOND_THREAD = 'PRRT_kwDOconfirm2';
const THIRD_THREAD = 'PRRT_kwDOconfirm3';
const HEAD = 'a'.repeat(40);
const BASE = 'f'.repeat(40);
const MOVED_HEAD = 'c'.repeat(40);
const COMMIT = 'b'.repeat(40);
const OTHER_COMMIT = 'd'.repeat(40);
const ROOT_COMMENT_ID = 5_001;
const SECOND_ROOT_COMMENT_ID = 5_002;
const THIRD_ROOT_COMMENT_ID = 5_003;
const FINDING_PATH = ['scripts', 'confirmReviewRepairs.ts'].join('/');
const SECOND_FINDING_PATH = ['scripts', 'reviewRepair.ts'].join('/');
const FINDING_LINE = 42;
const SUMMARY = 'Bind the repair to the commit that addresses it.';
const REFUSED_MESSAGE = `refusing to confirm 1 review thread(s) on PR #${PR}`;

function recordFor(overrides: Partial<ReviewRepairRecord> = {}): ReviewRepairRecord {
    return {
        format: 'repair-v1',
        pr: PR,
        thread: THREAD,
        finding: { commentId: ROOT_COMMENT_ID, path: FINDING_PATH, line: FINDING_LINE, side: 'RIGHT' },
        commit: COMMIT,
        summary: SUMMARY,
        evidence: [],
        head: HEAD,
        ...overrides,
    };
}

/** The bytes the author's `review:repair` posts, rendered by the contract that reads them back. */
function authorRecordReply(record: ReviewRepairRecord = recordFor()): string {
    return renderReviewRepairReply(record);
}

/** The contract's record marker line alone, as a bot composing the record by hand posts it. */
function bareRecordMarker(record: ReviewRepairRecord = recordFor()): string {
    const lines = renderReviewRepairReply(record).split('\n');
    return lines[lines.length - 1] ?? '';
}

function subjectThread(overrides: Partial<ReviewRepairThreadState> = {}): ReviewRepairThreadState {
    return {
        thread: THREAD,
        resolved: false,
        rootCommentId: ROOT_COMMENT_ID,
        rootPath: FINDING_PATH,
        rootLine: FINDING_LINE,
        rootSide: 'RIGHT',
        replies: [
            { id: ROOT_COMMENT_ID, body: 'Defect. Consequence. Fix.', authorNodeId: REVIEWER_BOT_NODE_ID },
            { id: 9_001, body: authorRecordReply(), authorNodeId: AUTHOR_BOT_NODE_ID },
        ],
        ...overrides,
    };
}

/** The threads of a clean batch: one finding per thread, each bound to the head through its commit. */
function cleanThreads(): ReviewRepairThreadState[] {
    return [
        subjectThread(),
        subjectThread({
            thread: SECOND_THREAD,
            rootCommentId: SECOND_ROOT_COMMENT_ID,
            rootPath: SECOND_FINDING_PATH,
            replies: [
                {
                    id: SECOND_ROOT_COMMENT_ID,
                    body: 'Another defect.',
                    authorNodeId: REVIEWER_BOT_NODE_ID,
                },
                {
                    id: 9_002,
                    body: authorRecordReply(
                        recordFor({
                            thread: SECOND_THREAD,
                            finding: {
                                commentId: SECOND_ROOT_COMMENT_ID,
                                path: SECOND_FINDING_PATH,
                                line: FINDING_LINE,
                                side: 'RIGHT',
                            },
                        })
                    ),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                },
            ],
        }),
    ];
}

type Mutation = { kind: 'post' | 'resolve'; thread: string; clientMutationId: string; body?: string };

/**
 * The fake applies every mutation to the thread state it reads back, so a test claiming a re-run
 * resolves nothing is observing the first pass's resolutions rather than a scripted second state.
 */
function fakePort(
    initialHead: string = HEAD,
    initialThreads: ReviewRepairThreadState[] = cleanThreads(),
    isAncestor: (commit: string, head: string) => boolean = (_commit, target) => target === HEAD
) {
    const calls: string[] = [];
    const logs: string[] = [];
    const mutations: Mutation[] = [];
    let postedReplies = 0;
    // Fresh objects per run, so a mutation the command applies never reaches the caller's fixture.
    const threads = new Map(
        initialThreads.map((thread) => [thread.thread, { ...thread, replies: [...thread.replies] }] as const)
    );
    const port: ConfirmReviewRepairsPort = {
        pullRequestHead: (pr) => {
            calls.push(`head:${pr}`);
            return initialHead;
        },
        pullRequestBase: (pr) => {
            calls.push(`base:${pr}`);
            return BASE;
        },
        readThreads: (pr) => {
            calls.push(`threads:${pr}`);
            const current: ReviewRepairThreadState[] = [];
            for (const thread of threads.values()) {
                current.push({ ...thread, replies: [...thread.replies] });
            }
            return current;
        },
        postConfirmation: (thread, body, clientMutationId) => {
            calls.push(`post:${thread}`);
            mutations.push({ kind: 'post', thread, clientMutationId, body });
            // The reply is applied to the thread state a later run reads back, so a rerun's decision
            // to skip the post observes the first pass's post rather than a scripted state.
            const current = threads.get(thread);
            if (current !== undefined) {
                threads.set(thread, {
                    ...current,
                    replies: [
                        ...current.replies,
                        { id: 9_800 + postedReplies, body, authorNodeId: REVIEWER_BOT_NODE_ID },
                    ],
                });
                postedReplies += 1;
            }
        },
        resolve: (thread, clientMutationId) => {
            calls.push(`resolve:${thread}`);
            mutations.push({ kind: 'resolve', thread, clientMutationId });
            const current = threads.get(thread);
            if (current !== undefined) {
                threads.set(thread, { ...current, resolved: true });
            }
        },
        isAncestor: (commit, head) => {
            calls.push(`isAncestor:${commit}:${head}`);
            return isAncestor(commit, head);
        },
        log: (message) => {
            logs.push(message);
        },
    };
    return { port, calls, logs, mutations, threads };
}

describe('parseConfirmReviewRepairsArgs', () => {
    it('should read the pull request and the head', () => {
        expect(parseConfirmReviewRepairsArgs([String(PR), '--head', HEAD])).toEqual({
            number: PR,
            head: HEAD,
            help: false,
        });
    });

    it('should refuse a missing head flag', () => {
        expect(() => parseConfirmReviewRepairsArgs([String(PR)])).toThrow(CONFIRM_USAGE);
        expect(() => parseConfirmReviewRepairsArgs([String(PR), HEAD])).toThrow(CONFIRM_USAGE);
    });

    it('should refuse an abbreviated head', () => {
        expect(() => parseConfirmReviewRepairsArgs([String(PR), '--head', HEAD.slice(0, 7)])).toThrow(CONFIRM_USAGE);
    });

    it('should refuse an unknown flag', () => {
        expect(() => parseConfirmReviewRepairsArgs([String(PR), '--heads', HEAD])).toThrow(CONFIRM_USAGE);
    });

    it('should refuse a non-numeric pull request', () => {
        for (const number of ['abc', '0', '-3', '3.5', '']) {
            expect(() => parseConfirmReviewRepairsArgs([number, '--head', HEAD]), number).toThrow(CONFIRM_USAGE);
        }
    });

    it('should accept --help alone and refuse it beside other arguments', () => {
        expect(parseConfirmReviewRepairsArgs(['--help'])).toEqual({ help: true });
        expect(() => parseConfirmReviewRepairsArgs(['--help', String(PR)])).toThrow('--help takes no other arguments');
    });
});

describe('confirmClientMutationIds', () => {
    it('should derive both ids from the contract id plus a distinct suffix', () => {
        expect(confirmReplyClientMutationId(PR, THREAD, HEAD)).toBe(
            `${confirmClientMutationId(PR, THREAD, HEAD)}:reply`
        );
        expect(confirmResolveClientMutationId(PR, THREAD, HEAD)).toBe(
            `${confirmClientMutationId(PR, THREAD, HEAD)}:resolve`
        );
        expect(confirmReplyClientMutationId(PR, THREAD, HEAD)).not.toBe(
            confirmResolveClientMutationId(PR, THREAD, HEAD)
        );
    });

    it('should change when the head changes, so a rerun on a new head is a new request', () => {
        expect(confirmReplyClientMutationId(PR, THREAD, HEAD)).not.toBe(
            confirmReplyClientMutationId(PR, THREAD, MOVED_HEAD)
        );
    });
});

describe('renderConfirmationReply', () => {
    it('should carry a human sentence and the contract record the author marker reads back', () => {
        const body = renderConfirmationReply(recordFor());
        expect(body).toContain('Confirmed against the current head');
        // The canonical form is the contract's own rendering, not a second one this module invents.
        expect(body).toContain(renderReviewRepairReply(recordFor()));
        expect(parseReviewRepairReply(body)).toEqual(recordFor());
    });
});

describe('confirmReviewRepairs', () => {
    it('should resolve every eligible thread in one pass with both mutations in order', () => {
        const { port, calls, logs, mutations } = fakePort();
        expect(confirmReviewRepairs(PR, HEAD, port)).toEqual({ resolved: [THREAD, SECOND_THREAD] });
        expect(calls).toEqual([
            `head:${PR}`,
            `base:${PR}`,
            `threads:${PR}`,
            `isAncestor:${COMMIT}:${HEAD}`,
            `isAncestor:${COMMIT}:${BASE}`,
            `isAncestor:${COMMIT}:${HEAD}`,
            `isAncestor:${COMMIT}:${BASE}`,
            `post:${THREAD}`,
            `resolve:${THREAD}`,
            `post:${SECOND_THREAD}`,
            `resolve:${SECOND_THREAD}`,
        ]);
        expect(mutations).toEqual([
            {
                kind: 'post',
                thread: THREAD,
                clientMutationId: confirmReplyClientMutationId(PR, THREAD, HEAD),
                body: renderConfirmationReply(recordFor()),
            },
            {
                kind: 'resolve',
                thread: THREAD,
                clientMutationId: confirmResolveClientMutationId(PR, THREAD, HEAD),
            },
            {
                kind: 'post',
                thread: SECOND_THREAD,
                clientMutationId: confirmReplyClientMutationId(PR, SECOND_THREAD, HEAD),
                body: renderConfirmationReply(
                    recordFor({
                        thread: SECOND_THREAD,
                        finding: {
                            commentId: SECOND_ROOT_COMMENT_ID,
                            path: SECOND_FINDING_PATH,
                            line: FINDING_LINE,
                            side: 'RIGHT',
                        },
                    })
                ),
            },
            {
                kind: 'resolve',
                thread: SECOND_THREAD,
                clientMutationId: confirmResolveClientMutationId(PR, SECOND_THREAD, HEAD),
            },
        ]);
        expect(logs).toEqual([`repair-confirmed:${PR}:${THREAD}`, `repair-confirmed:${PR}:${SECOND_THREAD}`]);
    });

    it('should post the confirmation reply the author marker parses back to the confirmed record', () => {
        const { port, mutations } = fakePort();
        confirmReviewRepairs(PR, HEAD, port);
        const posted = mutations.filter((entry) => entry.kind === 'post');
        expect(posted.map((entry) => parseReviewRepairReply(entry.body ?? ''))).toEqual([
            recordFor(),
            recordFor({
                thread: SECOND_THREAD,
                finding: {
                    commentId: SECOND_ROOT_COMMENT_ID,
                    path: SECOND_FINDING_PATH,
                    line: FINDING_LINE,
                    side: 'RIGHT',
                },
            }),
        ]);
    });

    it('should resolve nothing on a rerun of a clean batch', () => {
        const { port, logs, mutations } = fakePort();
        const first = confirmReviewRepairs(PR, HEAD, port);
        const second = confirmReviewRepairs(PR, HEAD, port);
        expect(first).toEqual({ resolved: [THREAD, SECOND_THREAD] });
        expect(second).toEqual({ resolved: [] });
        expect(mutations).toHaveLength(4);
        expect(logs).toEqual([
            `repair-confirmed:${PR}:${THREAD}`,
            `repair-confirmed:${PR}:${SECOND_THREAD}`,
            `repair-ignored:${PR}:${THREAD}:already resolved`,
            `repair-ignored:${PR}:${SECOND_THREAD}:already resolved`,
        ]);
    });

    it('should skip the confirmation reply a rerun finds already posted and complete the resolve', () => {
        const { port: base, mutations } = fakePort();
        let resolveFails = true;
        const port: ConfirmReviewRepairsPort = {
            ...base,
            resolve: (thread, clientMutationId) => {
                if (resolveFails) {
                    resolveFails = false;
                    throw new Error(`resolve exploded on ${thread}`);
                }
                base.resolve(thread, clientMutationId);
            },
        };

        expect(() => confirmReviewRepairs(PR, HEAD, port)).toThrow(`resolve exploded on ${THREAD}`);
        expect(confirmReviewRepairs(PR, HEAD, port)).toEqual({ resolved: [THREAD, SECOND_THREAD] });

        const posted = mutations.filter((entry) => entry.kind === 'post');
        expect(posted.map((entry) => entry.thread)).toEqual([THREAD, SECOND_THREAD]);
    });

    it('should not post a second confirmation when the thread already carries the bare record marker', () => {
        const record = recordFor();
        const thread = subjectThread({
            replies: [
                ...subjectThread().replies,
                { id: 9_103, body: bareRecordMarker(record), authorNodeId: REVIEWER_BOT_NODE_ID },
            ],
        });
        const { port, mutations } = fakePort(HEAD, [thread]);
        expect(confirmReviewRepairs(PR, HEAD, port)).toEqual({ resolved: [THREAD] });
        expect(mutations.map((entry) => entry.kind)).toEqual(['resolve']);
    });

    it('should keep the client mutation ids stable across runs', () => {
        const { port, mutations } = fakePort();
        confirmReviewRepairs(PR, HEAD, port);
        confirmReviewRepairs(PR, HEAD, port);
        expect(mutations.map((entry) => entry.clientMutationId)).toEqual([
            confirmReplyClientMutationId(PR, THREAD, HEAD),
            confirmResolveClientMutationId(PR, THREAD, HEAD),
            confirmReplyClientMutationId(PR, SECOND_THREAD, HEAD),
            confirmResolveClientMutationId(PR, SECOND_THREAD, HEAD),
        ]);
    });

    it('should confirm the remaining eligible threads when some are already resolved', () => {
        const threads = cleanThreads();
        const { port, logs, mutations } = fakePort(HEAD, [{ ...threads[0]!, resolved: true }, threads[1]!]);
        expect(confirmReviewRepairs(PR, HEAD, port)).toEqual({ resolved: [SECOND_THREAD] });
        expect(mutations.map((entry) => entry.thread)).toEqual([SECOND_THREAD, SECOND_THREAD]);
        expect(logs).toEqual([
            `repair-ignored:${PR}:${THREAD}:already resolved`,
            `repair-confirmed:${PR}:${SECOND_THREAD}`,
        ]);
    });

    it('should refuse a stale head before reading threads or mutating anything', () => {
        const { port, calls, mutations, logs } = fakePort(MOVED_HEAD);
        expect(() => confirmReviewRepairs(PR, HEAD, port)).toThrow(`head moved: ${MOVED_HEAD} is not ${HEAD}`);
        expect(calls).toEqual([`head:${PR}`]);
        expect(mutations).toEqual([]);
        expect(logs).toEqual([]);
    });

    it('should fail closed on a duplicate record without resolving or posting anything', () => {
        const duplicate = recordFor({ commit: OTHER_COMMIT, summary: 'A second, distinct repair of the finding.' });
        const threads = cleanThreads();
        const { port, logs, mutations } = fakePort(HEAD, [
            {
                ...threads[0]!,
                replies: [
                    ...threads[0]!.replies,
                    { id: 9_003, body: authorRecordReply(duplicate), authorNodeId: AUTHOR_BOT_NODE_ID },
                ],
            },
            threads[1]!,
        ]);
        expect(() => confirmReviewRepairs(PR, HEAD, port)).toThrow(REFUSED_MESSAGE);
        expect(mutations).toEqual([]);
        expect(logs).toEqual([]);
    });

    it('should fail closed on a record that binds another finding without resolving anything', () => {
        const badFinding = recordFor({
            finding: { commentId: 7_777, path: FINDING_PATH, line: FINDING_LINE, side: 'RIGHT' },
        });
        const threads = cleanThreads();
        const { port, mutations } = fakePort(HEAD, [
            subjectThread({
                replies: [
                    threads[0]!.replies[0]!,
                    { id: 9_004, body: authorRecordReply(badFinding), authorNodeId: AUTHOR_BOT_NODE_ID },
                ],
            }),
            threads[1]!,
        ]);
        expect(() => confirmReviewRepairs(PR, HEAD, port)).toThrow(REFUSED_MESSAGE);
        expect(mutations).toEqual([]);
    });

    it('should fail closed on a record whose commit is not an ancestor of the head', () => {
        // Only the second thread's OTHER_COMMIT record is a non-ancestor: the first thread's COMMIT
        // record stays eligible, so the refusal is driven by the second record and the batch aborts whole.
        const threads = cleanThreads();
        const secondRecord = recordFor({
            thread: SECOND_THREAD,
            commit: OTHER_COMMIT,
            finding: {
                commentId: SECOND_ROOT_COMMENT_ID,
                path: SECOND_FINDING_PATH,
                line: FINDING_LINE,
                side: 'RIGHT',
            },
        });
        const batch = [
            threads[0]!,
            {
                ...threads[1]!,
                replies: [
                    threads[1]!.replies[0]!,
                    { id: 9_009, body: authorRecordReply(secondRecord), authorNodeId: AUTHOR_BOT_NODE_ID },
                ],
            },
        ];
        const isAncestor = (commit: string, head: string) => commit === COMMIT && head === HEAD;
        const selection = selectEligibleRepairs({
            threads: batch,
            pr: PR,
            head: HEAD,
            base: BASE,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            reviewerNodeId: REVIEWER_BOT_NODE_ID,
            isAncestor,
        });
        expect(selection.eligible.map((entry) => entry.thread)).toEqual([THREAD]);
        expect(selection.refused).toEqual([
            { thread: SECOND_THREAD, reason: `commit ${OTHER_COMMIT} is not an ancestor of head ${HEAD}` },
        ]);

        const { port, calls, mutations } = fakePort(HEAD, batch, isAncestor);
        expect(() => confirmReviewRepairs(PR, HEAD, port)).toThrow(REFUSED_MESSAGE);
        expect(mutations).toEqual([]);
        expect(calls).toContain(`isAncestor:${COMMIT}:${HEAD}`);
    });

    it('should fail closed on a record whose commit is the pull request base', () => {
        // BASE is the pull request base and also an ancestor of the head, which is exactly what the
        // ancestry-only gate accepted before the reviewed range was enforced.
        const threads = cleanThreads();
        const baseRecord = recordFor({
            thread: SECOND_THREAD,
            commit: BASE,
            finding: {
                commentId: SECOND_ROOT_COMMENT_ID,
                path: SECOND_FINDING_PATH,
                line: FINDING_LINE,
                side: 'RIGHT',
            },
        });
        const batch = [
            threads[0]!,
            {
                ...threads[1]!,
                replies: [
                    threads[1]!.replies[0]!,
                    { id: 9_010, body: authorRecordReply(baseRecord), authorNodeId: AUTHOR_BOT_NODE_ID },
                ],
            },
        ];
        const isAncestor = (commit: string, target: string) =>
            commit === BASE || (target === HEAD && commit === COMMIT);
        const selection = selectEligibleRepairs({
            threads: batch,
            pr: PR,
            head: HEAD,
            base: BASE,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            reviewerNodeId: REVIEWER_BOT_NODE_ID,
            isAncestor,
        });
        expect(selection.eligible.map((entry) => entry.thread)).toEqual([THREAD]);
        expect(selection.refused).toEqual([
            { thread: SECOND_THREAD, reason: `commit ${BASE} is an ancestor of the pull request base ${BASE}` },
        ]);

        const { port, mutations } = fakePort(HEAD, batch, isAncestor);
        expect(() => confirmReviewRepairs(PR, HEAD, port)).toThrow(REFUSED_MESSAGE);
        expect(mutations).toEqual([]);
    });

    it('should refuse a rerun whose thread carries a confirmation for a different record', () => {
        const { port: base, threads } = fakePort(HEAD, [subjectThread()]);
        let resolveFails = true;
        const port: ConfirmReviewRepairsPort = {
            ...base,
            resolve: (thread, clientMutationId) => {
                if (resolveFails) {
                    resolveFails = false;
                    throw new Error(`resolve exploded on ${thread}`);
                }
                base.resolve(thread, clientMutationId);
            },
        };
        expect(() => confirmReviewRepairs(PR, HEAD, port)).toThrow(`resolve exploded on ${THREAD}`);

        // The author edits the recorded repair in place to a different record on the same head and
        // commit, leaving the partial pass's confirmation naming the record the reviewer read.
        const current = threads.get(THREAD);
        if (current === undefined) {
            throw new Error('the partial pass must leave the subject thread in place');
        }
        const edited = recordFor({ summary: 'A rewritten summary for the same finding and commit.' });
        threads.set(THREAD, {
            ...current,
            replies: current.replies.map((reply) =>
                reply.authorNodeId === AUTHOR_BOT_NODE_ID ? { ...reply, body: authorRecordReply(edited) } : reply
            ),
        });

        const selection = selectEligibleRepairs({
            threads: Array.from(threads.values(), (thread) => ({ ...thread, replies: [...thread.replies] })),
            pr: PR,
            head: HEAD,
            base: BASE,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            reviewerNodeId: REVIEWER_BOT_NODE_ID,
            isAncestor: (_commit, target) => target === HEAD,
        });
        expect(selection.refused).toEqual([
            { thread: THREAD, reason: 'thread already carries a confirmation for a different record' },
        ]);
        expect(() => confirmReviewRepairs(PR, HEAD, port)).toThrow(REFUSED_MESSAGE);
    });

    it('should refuse a thread that already carries two identical confirmations', () => {
        const confirmation = renderConfirmationReply(recordFor());
        const thread = subjectThread({
            replies: [
                ...subjectThread().replies,
                { id: 9_101, body: confirmation, authorNodeId: REVIEWER_BOT_NODE_ID },
                { id: 9_102, body: confirmation, authorNodeId: REVIEWER_BOT_NODE_ID },
            ],
        });
        const selection = selectEligibleRepairs({
            threads: [thread],
            pr: PR,
            head: HEAD,
            base: BASE,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            reviewerNodeId: REVIEWER_BOT_NODE_ID,
            isAncestor: (_commit, target) => target === HEAD,
        });
        expect(selection.refused).toEqual([
            { thread: THREAD, reason: 'thread already carries 2 identical confirmations' },
        ]);

        const { port, mutations } = fakePort(HEAD, [thread]);
        expect(() => confirmReviewRepairs(PR, HEAD, port)).toThrow(REFUSED_MESSAGE);
        expect(mutations).toEqual([]);
    });

    it('should fail closed on a record bound to another head', () => {
        const threads = cleanThreads();
        const staleRecord = recordFor({ head: MOVED_HEAD });
        const { port, mutations } = fakePort(HEAD, [
            subjectThread({
                replies: [
                    threads[0]!.replies[0]!,
                    { id: 9_005, body: authorRecordReply(staleRecord), authorNodeId: AUTHOR_BOT_NODE_ID },
                ],
            }),
            threads[1]!,
        ]);
        expect(() => confirmReviewRepairs(PR, HEAD, port)).toThrow(REFUSED_MESSAGE);
        expect(mutations).toEqual([]);
    });

    it('should fail closed on a malformed record rather than confirm it', () => {
        const threads = cleanThreads();
        const { port, mutations } = fakePort(HEAD, [
            subjectThread({
                replies: [
                    threads[0]!.replies[0]!,
                    { id: 9_006, body: 'sourdaw-repair-v1 {"format":"repair-v1"}', authorNodeId: AUTHOR_BOT_NODE_ID },
                ],
            }),
        ]);
        expect(() => confirmReviewRepairs(PR, HEAD, port)).toThrow('review repair record fields must be');
        expect(mutations).toEqual([]);
    });

    it('should not read a foreign actor marker as the author record', () => {
        const { port, logs, mutations } = fakePort(HEAD, [
            subjectThread({
                replies: [
                    { id: ROOT_COMMENT_ID, body: 'Defect.', authorNodeId: REVIEWER_BOT_NODE_ID },
                    { id: 9_007, body: authorRecordReply(), authorNodeId: REVIEWER_BOT_NODE_ID },
                ],
            }),
        ]);
        expect(confirmReviewRepairs(PR, HEAD, port)).toEqual({ resolved: [] });
        expect(mutations).toEqual([]);
        expect(logs).toEqual([`repair-ignored:${PR}:${THREAD}:no repair recorded`]);
    });

    it('should stop at the failing mutation and leave the earlier resolutions standing', () => {
        const { port: base, mutations, logs } = fakePort();
        const thirdRecord = recordFor({
            thread: THIRD_THREAD,
            finding: {
                commentId: THIRD_ROOT_COMMENT_ID,
                path: FINDING_PATH,
                line: FINDING_LINE,
                side: 'RIGHT',
            },
        });
        const threads = [
            ...cleanThreads(),
            subjectThread({
                thread: THIRD_THREAD,
                rootCommentId: THIRD_ROOT_COMMENT_ID,
                replies: [
                    { id: THIRD_ROOT_COMMENT_ID, body: 'A third defect.', authorNodeId: REVIEWER_BOT_NODE_ID },
                    { id: 9_008, body: authorRecordReply(thirdRecord), authorNodeId: AUTHOR_BOT_NODE_ID },
                ],
            }),
        ];
        const failing: ConfirmReviewRepairsPort = {
            ...base,
            readThreads: () => threads,
            resolve: (thread, clientMutationId) => {
                if (thread === SECOND_THREAD) {
                    throw new Error(`resolve exploded on ${thread}`);
                }
                mutations.push({ kind: 'resolve', thread, clientMutationId });
            },
        };
        expect(() => confirmReviewRepairs(PR, HEAD, failing)).toThrow(`resolve exploded on ${SECOND_THREAD}`);
        // The first thread's resolve mutation was applied before the failure and is not rolled back.
        expect(mutations.map((entry) => entry.thread)).toEqual([THREAD, THREAD, SECOND_THREAD]);
        expect(logs).toEqual([`repair-confirmed:${PR}:${THREAD}`]);
    });
});

describe('readReviewThreads', () => {
    function threadNode(overrides: Record<string, unknown> = {}) {
        return {
            id: THREAD,
            isResolved: false,
            comments: {
                nodes: [
                    {
                        id: String(ROOT_COMMENT_ID),
                        body: 'Defect.',
                        path: FINDING_PATH,
                        line: FINDING_LINE,
                        side: 'RIGHT',
                        author: { __typename: 'Bot', login: 'r', id: REVIEWER_BOT_NODE_ID },
                    },
                    {
                        id: '9001',
                        body: 'record',
                        path: null,
                        line: null,
                        side: null,
                        author: { __typename: 'Bot', login: 'a', id: AUTHOR_BOT_NODE_ID },
                    },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
            },
            ...overrides,
        };
    }

    function page(nodes: unknown[], pageInfo: Record<string, unknown>) {
        return { data: { repository: { pullRequest: { reviewThreads: { nodes, pageInfo } } } } };
    }

    function recordingGh(respond: (call: { query: string; fields: Record<string, string> }) => unknown) {
        const calls: { query: string; fields: Record<string, string>; args: string[] }[] = [];
        const gh = (args: string[]) => {
            const fields: Record<string, string> = {};
            for (let index = 4; index < args.length; index += 2) {
                const [key, ...rest] = (args[index + 1] ?? '').split('=');
                fields[key ?? ''] = rest.join('=');
            }
            const call = { query: (args[3] ?? '').slice('query='.length), fields, args };
            calls.push(call);
            return JSON.stringify(respond(call));
        };
        return { gh, calls };
    }

    it('should read the thread root comment and every reply in one query', () => {
        const { gh, calls } = recordingGh(() => page([threadNode()], { hasNextPage: false, endCursor: null }));
        expect(readReviewThreads(PR, gh, [])).toEqual([
            {
                thread: THREAD,
                resolved: false,
                rootCommentId: ROOT_COMMENT_ID,
                rootPath: FINDING_PATH,
                rootLine: FINDING_LINE,
                rootSide: 'RIGHT',
                replies: [
                    { id: ROOT_COMMENT_ID, body: 'Defect.', authorNodeId: REVIEWER_BOT_NODE_ID },
                    { id: 9_001, body: 'record', authorNodeId: AUTHOR_BOT_NODE_ID },
                ],
            },
        ]);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.query).toContain('reviewThreads(first:100');
        expect(calls[0]?.fields.number).toBe(String(PR));
    });

    it('should follow thread pagination with the cursor', () => {
        const { gh, calls } = recordingGh((call) => {
            if (call.fields.cursor === undefined) {
                return page([], { hasNextPage: true, endCursor: 'CURSOR' });
            }
            return page([threadNode()], { hasNextPage: false, endCursor: null });
        });
        expect(readReviewThreads(PR, gh, []).map((thread) => thread.thread)).toEqual([THREAD]);
        expect(calls).toHaveLength(2);
        expect(calls[1]?.fields.cursor).toBe('CURSOR');
        expect(calls[1]?.query).toContain('after:$cursor');
    });

    it('should refuse unreadable thread data and a repeated cursor', () => {
        const { gh: unreadable } = recordingGh(() => page([{}], { hasNextPage: false, endCursor: null }));
        expect(() => readReviewThreads(PR, unreadable, [])).toThrow(
            `PR #${PR} review threads is not a readable pull-request review thread`
        );
        const { gh: repeated } = recordingGh(() => page([], { hasNextPage: true, endCursor: 'CURSOR' }));
        expect(() => readReviewThreads(PR, repeated, [])).toThrow(
            `PR #${PR} review threads returned invalid thread pagination`
        );
    });

    it('should refuse a Bot comment that carries no author node id', () => {
        const { gh } = recordingGh(() =>
            page(
                [
                    threadNode({
                        comments: {
                            nodes: [
                                {
                                    id: '1',
                                    body: 'root',
                                    path: FINDING_PATH,
                                    line: 1,
                                    side: 'LEFT',
                                    author: { __typename: 'Bot', login: 'a' },
                                },
                            ],
                            pageInfo: { hasNextPage: false, endCursor: null },
                        },
                    }),
                ],
                { hasNextPage: false, endCursor: null }
            )
        );
        expect(() => readReviewThreads(PR, gh, [])).toThrow('carries no author node id');
    });

    it('should read a human comment as a reply no selection acts on and still confirm the author repair', () => {
        const record = recordFor();
        const { gh } = recordingGh(() =>
            page(
                [
                    threadNode({
                        comments: {
                            nodes: [
                                {
                                    id: String(ROOT_COMMENT_ID),
                                    body: 'Defect. Consequence. Fix.',
                                    path: FINDING_PATH,
                                    line: FINDING_LINE,
                                    side: 'RIGHT',
                                    author: { __typename: 'Bot', login: 'r', id: REVIEWER_BOT_NODE_ID },
                                },
                                {
                                    id: '9000',
                                    // A distinct repair-shaped record: if a non-Bot author were read as an
                                    // author repair, this second record would refuse the thread as ambiguous.
                                    body: authorRecordReply(
                                        recordFor({ commit: OTHER_COMMIT, summary: 'A person pasted this.' })
                                    ),
                                    path: null,
                                    line: null,
                                    side: null,
                                    author: { __typename: 'User', login: 'jcosta33' },
                                },
                                {
                                    id: '9001',
                                    body: authorRecordReply(record),
                                    path: null,
                                    line: null,
                                    side: null,
                                    author: { __typename: 'Bot', login: 'a', id: AUTHOR_BOT_NODE_ID },
                                },
                            ],
                            pageInfo: { hasNextPage: false, endCursor: null },
                        },
                    }),
                ],
                { hasNextPage: false, endCursor: null }
            )
        );

        const threads = readReviewThreads(PR, gh, []);
        expect(threads[0]?.replies.map((reply) => reply.authorNodeId)).toEqual([
            REVIEWER_BOT_NODE_ID,
            null,
            AUTHOR_BOT_NODE_ID,
        ]);
        const selection = selectEligibleRepairs({
            threads,
            pr: PR,
            head: HEAD,
            base: BASE,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            reviewerNodeId: REVIEWER_BOT_NODE_ID,
            isAncestor: (_commit, target) => target === HEAD,
        });
        expect(selection.eligible.map((entry) => entry.thread)).toEqual([THREAD]);
        expect(selection.refused).toEqual([]);
    });

    it('should read a deleted account as a reply no selection acts on and still resolve the repair', () => {
        const record = recordFor();
        const { gh } = recordingGh(() =>
            page(
                [
                    threadNode({
                        comments: {
                            nodes: [
                                {
                                    id: String(ROOT_COMMENT_ID),
                                    body: 'Defect. Consequence. Fix.',
                                    path: FINDING_PATH,
                                    line: FINDING_LINE,
                                    side: 'RIGHT',
                                    author: { __typename: 'Bot', login: 'r', id: REVIEWER_BOT_NODE_ID },
                                },
                                {
                                    id: '9000',
                                    // A distinct repair-shaped record from a deleted account: were its
                                    // null author to refuse the read, the whole transaction would abort.
                                    body: authorRecordReply(
                                        recordFor({
                                            commit: OTHER_COMMIT,
                                            summary: 'The deleted account pasted this.',
                                        })
                                    ),
                                    path: null,
                                    line: null,
                                    side: null,
                                    author: null,
                                },
                                {
                                    id: '9001',
                                    body: authorRecordReply(record),
                                    path: null,
                                    line: null,
                                    side: null,
                                    author: { __typename: 'Bot', login: 'a', id: AUTHOR_BOT_NODE_ID },
                                },
                            ],
                            pageInfo: { hasNextPage: false, endCursor: null },
                        },
                    }),
                ],
                { hasNextPage: false, endCursor: null }
            )
        );

        const threads = readReviewThreads(PR, gh, []);
        expect(threads[0]?.replies.map((reply) => reply.authorNodeId)).toEqual([
            REVIEWER_BOT_NODE_ID,
            null,
            AUTHOR_BOT_NODE_ID,
        ]);
        const selection = selectEligibleRepairs({
            threads,
            pr: PR,
            head: HEAD,
            base: BASE,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            reviewerNodeId: REVIEWER_BOT_NODE_ID,
            isAncestor: (_commit, target) => target === HEAD,
        });
        expect(selection.eligible.map((entry) => entry.thread)).toEqual([THREAD]);
        expect(selection.refused).toEqual([]);
        expect(confirmReviewRepairs(PR, HEAD, fakePort(HEAD, threads).port)).toEqual({ resolved: [THREAD] });
    });

    it('should refuse an empty comment page that claims another page instead of draining forever', () => {
        let emptyPages = 0;
        const { gh } = recordingGh((call) => {
            if (call.query.includes('node(id:$threadId)')) {
                emptyPages += 1;
                return {
                    data: {
                        node: {
                            comments: {
                                nodes: [],
                                pageInfo: {
                                    hasNextPage: emptyPages < 2,
                                    endCursor: `EMPTY_CURSOR_${emptyPages}`,
                                },
                            },
                        },
                    },
                };
            }
            return page(
                [
                    threadNode({
                        comments: {
                            nodes: [
                                {
                                    id: String(ROOT_COMMENT_ID),
                                    body: 'Defect.',
                                    path: FINDING_PATH,
                                    line: FINDING_LINE,
                                    side: 'RIGHT',
                                    author: { __typename: 'Bot', login: 'r', id: REVIEWER_BOT_NODE_ID },
                                },
                            ],
                            pageInfo: { hasNextPage: true, endCursor: 'COMMENT_CURSOR' },
                        },
                    }),
                ],
                { hasNextPage: false, endCursor: null }
            );
        });

        expect(() => readReviewThreads(PR, gh, [])).toThrow(
            `PR #${PR} review threads returned an empty comment page while claiming another`
        );
    });

    it('should find an author repair recorded past the first comment page', () => {
        const record = recordFor();
        const { gh, calls } = recordingGh((call) => {
            if (call.query.includes('node(id:$threadId)')) {
                return {
                    data: {
                        node: {
                            comments: {
                                nodes: [
                                    {
                                        id: '9002',
                                        body: authorRecordReply(record),
                                        path: null,
                                        line: null,
                                        side: null,
                                        author: { __typename: 'Bot', login: 'a', id: AUTHOR_BOT_NODE_ID },
                                    },
                                ],
                                pageInfo: { hasNextPage: false, endCursor: null },
                            },
                        },
                    },
                };
            }
            return page(
                [
                    threadNode({
                        comments: {
                            nodes: [
                                {
                                    id: String(ROOT_COMMENT_ID),
                                    body: 'Defect. Consequence. Fix.',
                                    path: FINDING_PATH,
                                    line: FINDING_LINE,
                                    side: 'RIGHT',
                                    author: { __typename: 'Bot', login: 'r', id: REVIEWER_BOT_NODE_ID },
                                },
                            ],
                            pageInfo: { hasNextPage: true, endCursor: 'COMMENT_CURSOR' },
                        },
                    }),
                ],
                { hasNextPage: false, endCursor: null }
            );
        });

        const threads = readReviewThreads(PR, gh, []);
        expect(calls).toHaveLength(2);
        expect(calls[1]?.fields.threadId).toBe(THREAD);
        expect(calls[1]?.fields.cursor).toBe('COMMENT_CURSOR');
        const selection = selectEligibleRepairs({
            threads,
            pr: PR,
            head: HEAD,
            base: BASE,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            reviewerNodeId: REVIEWER_BOT_NODE_ID,
            isAncestor: (_commit, target) => target === HEAD,
        });
        expect(selection.eligible.map((entry) => entry.thread)).toEqual([THREAD]);
        expect(selection.ignored).toEqual([]);
    });
});

describe('readPullRequestHead', () => {
    it('should read the live head of the pull request', () => {
        const gh = (args: string[]) => {
            expect(args.join(' ')).toContain('headRefOid');
            return JSON.stringify({ data: { repository: { pullRequest: { headRefOid: HEAD } } } });
        };
        expect(readPullRequestHead(PR, gh, [])).toBe(HEAD);
    });

    it('should refuse a pull request with no readable head', () => {
        const gh = () => JSON.stringify({ data: { repository: { pullRequest: {} } } });
        expect(() => readPullRequestHead(PR, gh, [])).toThrow(`PR #${PR} head is not a readable pull request head`);
    });
});

describe('readPullRequestBase', () => {
    it('should read the live base of the pull request', () => {
        const gh = (args: string[]) => {
            expect(args.join(' ')).toContain('baseRefOid');
            return JSON.stringify({ data: { repository: { pullRequest: { baseRefOid: BASE } } } });
        };
        expect(readPullRequestBase(PR, gh, [])).toBe(BASE);
    });

    it('should refuse a pull request with no readable base', () => {
        const gh = () => JSON.stringify({ data: { repository: { pullRequest: {} } } });
        expect(() => readPullRequestBase(PR, gh, [])).toThrow(`PR #${PR} base is not a readable pull request base`);
    });
});

describe('postConfirmationReply and resolveConfirmedThread', () => {
    it('should reply with the confirmation body and resolve through the named mutations', () => {
        const calls: { query: string; fields: Record<string, string> }[] = [];
        const gh = (args: string[]) => {
            const fields: Record<string, string> = {};
            for (let index = 4; index < args.length; index += 2) {
                const [key, ...rest] = (args[index + 1] ?? '').split('=');
                fields[key ?? ''] = rest.join('=');
            }
            const query = (args[3] ?? '').slice('query='.length);
            calls.push({ query, fields });
            if (query.includes('addPullRequestReviewThreadReply')) {
                return JSON.stringify({
                    data: {
                        addPullRequestReviewThreadReply: {
                            clientMutationId: fields.clientMutationId,
                            comment: { id: 'PRRC_reply', body: fields.body },
                        },
                    },
                });
            }
            return JSON.stringify({
                data: {
                    resolveReviewThread: {
                        clientMutationId: fields.clientMutationId,
                        thread: { id: fields.threadId, isResolved: true },
                    },
                },
            });
        };
        postConfirmationReply(THREAD, 'body', 'mutation-id', gh);
        resolveConfirmedThread(THREAD, 'mutation-id', gh);
        expect(calls[0]?.query).toContain('addPullRequestReviewThreadReply');
        expect(calls[1]?.query).toContain('resolveReviewThread');
        expect(calls[1]?.fields.threadId).toBe(THREAD);
    });

    it('should refuse a reply receipt whose body is not the confirmation', () => {
        const gh = () =>
            JSON.stringify({
                data: {
                    addPullRequestReviewThreadReply: { clientMutationId: 'mutation-id', comment: { body: 'other' } },
                },
            });
        expect(() => postConfirmationReply(THREAD, 'body', 'mutation-id', gh)).toThrow(
            `addPullRequestReviewThreadReply returned an invalid result for ${THREAD}`
        );
    });

    it('should refuse a resolve receipt naming another thread', () => {
        const gh = () =>
            JSON.stringify({
                data: { resolveReviewThread: { clientMutationId: 'mutation-id', thread: { id: 'PRRT_other' } } },
            });
        expect(() => resolveConfirmedThread(THREAD, 'mutation-id', gh)).toThrow(
            `resolveReviewThread returned an invalid result for ${THREAD}`
        );
    });
});

describe('shellPort', () => {
    it('should run gh and git from the primary root with the session environment', () => {
        const parent = mkdtempSync(join(tmpdir(), 'confirm-shell-'));
        mkdirSync(join(parent, 'primary', '.git'), { recursive: true });
        // `resolvePrimaryRoot` realpaths what the capture returns, so the fixture and the expectation
        // must agree on the resolved path.
        const root = realpathSync(join(parent, 'primary'));
        const commands: { command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv }[] = [];
        const session: GhSession = { configDir: '/config', env: { GH_TOKEN: 'token' }, dispose: () => undefined };
        try {
            const port = shellPort(session, root, (command, args, options) => {
                commands.push({ command, args, cwd: options?.cwd, env: options?.env });
                if (command === 'git' && args[0] === 'rev-parse') {
                    return `${join(root, '.git')}\n`;
                }
                if (command !== 'gh') {
                    return '';
                }
                if (args[0] === 'repo') {
                    return 'jcosta33/sourdaw';
                }
                const query = args[3] ?? '';
                if (query.includes('headRefOid')) {
                    return JSON.stringify({ data: { repository: { pullRequest: { headRefOid: HEAD } } } });
                }
                if (query.includes('baseRefOid')) {
                    return JSON.stringify({ data: { repository: { pullRequest: { baseRefOid: BASE } } } });
                }
                if (query.includes('reviewThreads')) {
                    return JSON.stringify({
                        data: {
                            repository: {
                                pullRequest: {
                                    reviewThreads: {
                                        nodes: [
                                            {
                                                id: THREAD,
                                                isResolved: false,
                                                comments: {
                                                    nodes: [
                                                        {
                                                            id: String(ROOT_COMMENT_ID),
                                                            body: 'Defect.',
                                                            path: FINDING_PATH,
                                                            line: FINDING_LINE,
                                                            side: 'RIGHT',
                                                            author: {
                                                                __typename: 'Bot',
                                                                login: 'r',
                                                                id: REVIEWER_BOT_NODE_ID,
                                                            },
                                                        },
                                                    ],
                                                    pageInfo: { hasNextPage: false, endCursor: null },
                                                },
                                            },
                                        ],
                                        pageInfo: { hasNextPage: false, endCursor: null },
                                    },
                                },
                            },
                        },
                    });
                }
                return '';
            });
            expect(port.pullRequestHead(PR)).toBe(HEAD);
            expect(port.pullRequestBase(PR)).toBe(BASE);
            expect(port.readThreads(PR).map((thread) => thread.thread)).toEqual([THREAD]);
            const ghCall = commands.find((entry) => entry.command === 'gh');
            expect(ghCall?.cwd).toBe(root);
            expect(ghCall?.env).toEqual({ GH_TOKEN: 'token' });
        } finally {
            rmSync(parent, { recursive: true, force: true });
        }
    });

    it('should read exit zero and exit one from git merge-base --is-ancestor as the two answers', () => {
        const calls: string[][] = [];
        const spawn = (command: string, args: string[]) => {
            calls.push([command, ...args]);
            return { status: calls.length === 1 ? 0 : 1, stderr: '' };
        };
        const isAncestor = shellIsAncestor('/repo', undefined, spawn);
        expect(isAncestor(COMMIT, HEAD)).toBe(true);
        expect(isAncestor(OTHER_COMMIT, HEAD)).toBe(false);
        expect(calls[0]).toEqual(['git', 'merge-base', '--is-ancestor', COMMIT, HEAD]);
    });

    it('should refuse a git merge-base --is-ancestor failure that is neither answer', () => {
        expect(() => isAncestorExitStatus(128, 'git: bad revision')).toThrow('git: bad revision');
    });
});

function fakeDependencies(
    overrides: Partial<ConfirmReviewRepairsCoordinatorDependencies> = {},
    actorNodeId: string = REVIEWER_BOT_NODE_ID
) {
    const events: string[] = [];
    const dependencies: ConfirmReviewRepairsCoordinatorDependencies = {
        primaryRoot: () => '/repo',
        authenticateReviewer: async (primaryRoot) => {
            events.push(`auth:${primaryRoot}`);
            return {
                minted: { actorNodeId },
                session: {
                    configDir: '/config',
                    env: {},
                    dispose: () => {
                        events.push('dispose');
                    },
                },
            };
        },
        repositoryName: () => 'jcosta33/sourdaw',
        port: () => fakePort().port,
        confirm: (number, head) => {
            events.push(`confirm:${number}:${head}`);
            return { resolved: [THREAD] };
        },
        ...overrides,
    };
    return { dependencies, events };
}

describe('coordinateConfirmReviewRepairs', () => {
    it('should authenticate the reviewer App and confirm the batch', async () => {
        const { dependencies, events } = fakeDependencies();
        await coordinateConfirmReviewRepairs(PR, HEAD, dependencies);
        expect(events).toEqual(['auth:/repo', `confirm:${PR}:${HEAD}`, 'dispose']);
    });

    it('should refuse an actor that is not the reviewer bot, and still dispose the session', async () => {
        const { dependencies, events } = fakeDependencies({}, AUTHOR_BOT_NODE_ID);
        await expect(coordinateConfirmReviewRepairs(PR, HEAD, dependencies)).rejects.toThrow(
            `minted actor ${AUTHOR_BOT_NODE_ID} is not ${REVIEWER_BOT_NODE_ID}`
        );
        expect(events).toEqual(['auth:/repo', 'dispose']);
    });

    it('should refuse a foreign repository', async () => {
        const { dependencies } = fakeDependencies({ repositoryName: () => 'someone/else' });
        await expect(coordinateConfirmReviewRepairs(PR, HEAD, dependencies)).rejects.toThrow(
            'refusing to operate on someone/else'
        );
    });
});

describe('runConfirmReviewRepairsCli', () => {
    it('should confirm the batch the arguments name', async () => {
        const { dependencies, events } = fakeDependencies();
        await expect(runConfirmReviewRepairsCli([String(PR), '--head', HEAD], dependencies)).resolves.toBe(0);
        expect(events).toContain(`confirm:${PR}:${HEAD}`);
    });

    it('should print usage for --help without authenticating', async () => {
        const { dependencies, events } = fakeDependencies();
        const printed = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            await expect(runConfirmReviewRepairsCli(['--help'], dependencies)).resolves.toBe(0);
            expect(printed).toHaveBeenCalledWith(`Usage: ${CONFIRM_USAGE.slice('usage: '.length)}`);
        } finally {
            printed.mockRestore();
        }
        expect(events).toEqual([]);
    });

    it('should refuse arguments that are not the usage', async () => {
        const { dependencies } = fakeDependencies();
        await expect(runConfirmReviewRepairsCli([String(PR)], dependencies)).rejects.toThrow(CONFIRM_USAGE);
    });
});

describe('defaultConfirmReviewRepairsCoordinatorDependencies', () => {
    it('should bind the reviewer role and the module confirm function', () => {
        const dependencies = defaultConfirmReviewRepairsCoordinatorDependencies();
        expect(dependencies.confirm).toBe(confirmReviewRepairs);
    });
});
