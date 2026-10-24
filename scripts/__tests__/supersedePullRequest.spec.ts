import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runDeliverCli } from '../deliverPullRequest.ts';
import { parseFindingLineage, renderFindingLineage, type FindingLineage } from '../findingLineage.ts';
import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import { supersessionCommentBody } from '../prContract.ts';
import {
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockOwner,
    withPullRequestMutationLock,
    type PullRequestMutationSerialization,
} from '../pullRequestMutationLock.ts';
import {
    parseSupersedePullRequestArgs,
    readFindingLineageFile,
    serializedSupersedePullRequest,
    supersedePullRequest,
} from '../supersedePullRequest.ts';
import {
    commentClientMutationId,
    deleteComment,
    inspectIssueComments,
    inspectPullRequest,
    inspectReviewThreads,
    shellPort,
    type IssueComment,
    type SupersedePullRequestPort,
    type SupersededReviewThread,
    type SupersededPullRequest,
} from '../supersedePullRequestGh.ts';

const oldNumber = 2244;
const parentNumber = 2245;
const replacementNumber = 2246;
const head = 'a'.repeat(40);
const movedHead = 'b'.repeat(40);
const parentHead = 'd'.repeat(40);
const parentBranch = 'fix/4380/refine-pending-proposal';
const findingA = '1001';
const findingB = '1002';
const databaseBase = 9223372036854775808n;
const oldComment: IssueComment = {
    id: 'IC_old',
    fullDatabaseId: String(databaseBase - 1n),
    body: 'old',
    authorNodeId: 'BOT_reviewer',
    authorLogin: 'reviewer[bot]',
    authorType: 'Bot',
};
const repairedEntry = {
    findingId: findingA,
    disposition: 'repaired' as const,
    replacementPr: replacementNumber,
    replacementFindingId: '2001',
    reason: '',
};
const repairedLineage: FindingLineage = {
    format: 'lineage-v1',
    oldPr: oldNumber,
    replacementPr: replacementNumber,
    entries: [repairedEntry],
};
const receiptBody = supersessionCommentBody(replacementNumber);
const parentLineage: FindingLineage = {
    format: 'lineage-v1',
    oldPr: parentNumber,
    replacementPr: replacementNumber,
    entries: [],
};
const parentLineageBody = renderFindingLineage(parentLineage);
function markerComment(
    id: string,
    fullDatabaseId: string,
    body: string,
    authorType = 'Bot',
    authorNodeId: string | null = AUTHOR_BOT_NODE_ID
): IssueComment {
    return {
        id,
        fullDatabaseId,
        body,
        authorNodeId,
        authorLogin: authorNodeId === AUTHOR_BOT_NODE_ID ? 'renamed-author[bot]' : 'foreign[bot]',
        authorType,
    };
}
function changeMarker(
    comments: IssueComment[],
    body: string,
    change: (comment: IssueComment) => IssueComment
): IssueComment[] {
    return comments.map((comment) => {
        if (comment.body === body) {
            return change(comment);
        }
        return comment;
    });
}
const validParentComments: [IssueComment, IssueComment] = [
    markerComment('IC_parent_receipt', String(databaseBase + 20n), receiptBody),
    markerComment('IC_parent_lineage', String(databaseBase + 21n), parentLineageBody),
];
/**
 * The canonical marker body for `repairedLineage`, pinned as literal bytes rather than through the
 * serializer under test. Sorted keys and no whitespace outside strings are the promise, so an
 * indentation or ordering change must break this expectation instead of silently moving with it.
 */
const lineageBody =
    'Finding lineage: #2244 superseded by #2246; repaired 1, transferred 0, discarded 0\n' +
    'sourdaw-lineage-v1 {"entries":[{"disposition":"repaired","findingId":"1001","reason":"","replacementFindingId":"2001","replacementPr":2246}],"format":"lineage-v1","oldPr":2244,"replacementPr":2246}';
const defaultThreads: SupersededReviewThread[] = [{ threadId: 'PRRT_1', rootCommentId: findingA }];

type Input = {
    observeOperation?: (operation: string) => void;
    heads?: string[];
    authorNodeId?: string;
    replacementState?: string;
    replacementStates?: string[];
    replacementBases?: string[];
    replacementHeadRepository?: string | null;
    oldHeadRepository?: string | null;
    initialState?: string;
    throwAfterComment?: boolean;
    concurrentCommentOnThrow?: boolean;
    concurrentCommentBeforeConvergence?: boolean;
    foreignLowerCommentBeforeConvergence?: boolean;
    closeBeforeConvergence?: boolean;
    throwCloseWithConcurrentState?: boolean;
    throwCloseOnceWithoutState?: boolean;
    failDelete?: boolean;
    returnedCommentBody?: string;
    bases?: string[];
    baseRefs?: SupersededPullRequest['baseRef'][];
    changedClosedAtAfterClose?: boolean;
    deleteCommentAfterClose?: boolean;
    editCommentAfterComment?: boolean;
    returnedCommentClientMutationId?: string;
    returnedCommentAuthorType?: string;
    existingCommentCount?: number;
    existingLineageCount?: number;
    existingCommentAuthorType?: string;
    threads?: SupersededReviewThread[];
    threadsBeforeClose?: SupersededReviewThread[];
    parentStates?: string[];
    parentMerged?: boolean;
    parentHeads?: string[];
    parentHeadRefNames?: string[];
    parentHeadRepositories?: (string | null)[];
    parentBases?: string[];
    parentRepositories?: string[];
    parentClosedAts?: (string | null)[];
    parentComments?: IssueComment[];
    parentCommentsByInspection?: IssueComment[][];
    parentThreads?: SupersededReviewThread[];
    parentThreadsByRead?: SupersededReviewThread[][];
    removeParentReceiptDuringClose?: boolean;
    precloseParentProofChildComments?: (comments: IssueComment[]) => IssueComment[];
    finalParentProofChildComments?: (comments: IssueComment[]) => IssueComment[];
};

function fakePort(input: Input = {}) {
    const calls: string[] = [];
    let index = 0;
    let state = input.initialState ?? 'OPEN';
    let closeCalled = false;
    let closeFailures = 0;
    let commentCalled = false;
    let concurrentCommentAdded = false;
    let closedAt: string | null = state === 'CLOSED' ? '2026-08-20T12:00:00Z' : null;
    let postedCount = 0;
    let threadReads = 0;
    let parentInspections = 0;
    let parentThreadReads = 0;
    let replacementInspections = 0;
    let comments: IssueComment[] = [oldComment];
    let parentComments = Array.from(input.parentComments ?? validParentComments);
    const postedIds: string[] = [];
    const allocate = (body: string): IssueComment => {
        postedCount += 1;
        return markerComment(
            `IC_post_${postedCount}`,
            String(databaseBase + 100n + BigInt(postedCount)),
            body,
            input.returnedCommentAuthorType ?? 'Bot'
        );
    };
    for (let commentIndex = 0; commentIndex < (input.existingCommentCount ?? 0); commentIndex += 1) {
        comments.push(
            markerComment(
                `IC_seed_receipt_${commentIndex}`,
                String(databaseBase + BigInt(commentIndex)),
                receiptBody,
                input.existingCommentAuthorType ?? 'Bot'
            )
        );
    }
    for (let commentIndex = 0; commentIndex < (input.existingLineageCount ?? 0); commentIndex += 1) {
        comments.push(
            markerComment(
                `IC_seed_lineage_${commentIndex}`,
                String(databaseBase + 10n + BigInt(commentIndex)),
                lineageBody
            )
        );
    }
    const snapshot = (number: number) => {
        if (number === oldNumber) {
            const inspection = index++;
            let baseRef = input.baseRefs?.[inspection];
            if (baseRef === undefined) {
                baseRef = input.baseRefs?.at(-1);
            }
            if (baseRef === undefined) {
                baseRef = { name: parentBranch, repository: 'jcosta33/sourdaw', target: parentHead };
            }
            return {
                number,
                state,
                head: input.heads?.[inspection] ?? head,
                headRefName: 'fix/old-pull-request',
                headRepository: input.oldHeadRepository === undefined ? 'jcosta33/sourdaw' : input.oldHeadRepository,
                repository: 'jcosta33/sourdaw',
                base: input.bases?.[inspection] ?? input.bases?.at(-1) ?? 'main',
                baseRef,
                // GitHub may retain a historical baseRefOid while baseRef.target has moved.
                baseRefOid: 'e'.repeat(40),
                merged: false,
                closedAt,
                comments,
            };
        }
        if (number === parentNumber) {
            const inspection = parentInspections++;
            if (inspection === 2 && input.precloseParentProofChildComments !== undefined) {
                comments = input.precloseParentProofChildComments(comments);
            }
            if (inspection === 3 && input.finalParentProofChildComments !== undefined) {
                comments = input.finalParentProofChildComments(comments);
            }
            const headRepository = input.parentHeadRepositories?.[inspection];
            return {
                number,
                state: input.parentStates?.[inspection] ?? 'CLOSED',
                head: input.parentHeads?.[inspection] ?? parentHead,
                headRefName: input.parentHeadRefNames?.[inspection] ?? parentBranch,
                headRepository: headRepository === undefined ? 'jcosta33/sourdaw' : headRepository,
                repository: input.parentRepositories?.[inspection] ?? 'jcosta33/sourdaw',
                base: input.parentBases?.[inspection] ?? 'main',
                merged: input.parentMerged ?? false,
                closedAt: input.parentClosedAts?.[inspection] ?? '2026-08-19T12:00:00Z',
                comments: input.parentCommentsByInspection?.[inspection] ?? parentComments,
            };
        }
        const inspection = replacementInspections++;
        return {
            number,
            state: input.replacementStates?.[inspection] ?? input.replacementState ?? 'MERGED',
            head: 'c'.repeat(40),
            headRefName: 'fix/replacement-pull-request',
            headRepository:
                input.replacementHeadRepository === undefined ? 'jcosta33/sourdaw' : input.replacementHeadRepository,
            repository: 'jcosta33/sourdaw',
            base: input.replacementBases?.[inspection] ?? 'main',
            merged: true,
            closedAt: '2026-08-20T12:00:00Z',
            comments: [],
        };
    };
    const port: SupersedePullRequestPort = {
        assertCurrentPullRequest: () => undefined,
        inspect: (number) => {
            input.observeOperation?.(`inspect:${number}`);
            calls.push(`inspect:${number}`);
            if (
                number === oldNumber &&
                input.concurrentCommentBeforeConvergence &&
                !concurrentCommentAdded &&
                comments.length > 1
            ) {
                concurrentCommentAdded = true;
                comments = [...comments, markerComment('IC_concurrent', String(databaseBase + 200n), receiptBody)];
            }
            if (
                number === oldNumber &&
                input.foreignLowerCommentBeforeConvergence &&
                !concurrentCommentAdded &&
                commentCalled
            ) {
                concurrentCommentAdded = true;
                comments = [
                    ...comments,
                    markerComment('IC_foreign', String(databaseBase - 10n), receiptBody),
                    markerComment('IC_foreign_lineage', String(databaseBase - 9n), lineageBody),
                ];
            }
            if (number === oldNumber && input.closeBeforeConvergence && commentCalled) {
                state = 'CLOSED';
                closedAt = '2026-08-20T12:00:00Z';
            }
            if (number === oldNumber && input.throwCloseWithConcurrentState && closeCalled) {
                state = 'CLOSED';
                closedAt = '2026-08-20T12:00:01Z';
            }
            if (number === oldNumber && closeCalled && input.changedClosedAtAfterClose) {
                closedAt = '2026-08-20T12:00:02Z';
            }
            if (number === oldNumber && closeCalled && input.deleteCommentAfterClose) {
                comments = comments.filter((comment) => comment.id !== postedIds[0]);
            }
            if (number === oldNumber && !closeCalled && input.editCommentAfterComment) {
                comments = comments.map((comment) =>
                    comment.id === postedIds[0] ? { ...comment, body: 'Edited' } : comment
                );
            }
            return snapshot(number);
        },
        inspectReviewThreads: (number) => {
            input.observeOperation?.(`threads:${number}`);
            calls.push(`threads:${number}`);
            if (number === parentNumber) {
                const inspection = parentThreadReads++;
                return input.parentThreadsByRead?.[inspection] ?? input.parentThreads ?? [];
            }
            threadReads += 1;
            if (threadReads > 1 && input.threadsBeforeClose !== undefined) {
                return input.threadsBeforeClose;
            }
            return input.threads ?? defaultThreads;
        },
        comment: (number, body) => {
            input.observeOperation?.(`comment:${number}`);
            calls.push(`comment:${number}:${body}`);
            commentCalled = true;
            const created = allocate(input.returnedCommentBody ?? body);
            comments = [...comments, created];
            postedIds.push(created.id);
            if (input.throwAfterComment) {
                if (input.concurrentCommentOnThrow) {
                    comments = [...comments, markerComment('IC_concurrent', String(databaseBase + 300n), body)];
                }
                throw new Error('comment transport lost');
            }
            return {
                ...created,
                clientMutationId: input.returnedCommentClientMutationId ?? commentClientMutationId(number, body),
            };
        },
        close: (number) => {
            input.observeOperation?.(`close:${number}`);
            calls.push(`close:${number}`);
            closeCalled = true;
            if (input.throwCloseWithConcurrentState) {
                throw new Error('close transport lost');
            }
            if (input.throwCloseOnceWithoutState && closeFailures === 0) {
                closeFailures += 1;
                throw new Error('close transport lost');
            }
            state = 'CLOSED';
            closedAt = '2026-08-20T12:00:00Z';
            if (input.removeParentReceiptDuringClose) {
                parentComments = parentComments.filter((comment) => comment.body !== receiptBody);
            }
            return { closedAt };
        },
        deleteComment: (id) => {
            input.observeOperation?.(`delete:${id}`);
            calls.push(`delete:${id}`);
            if (input.failDelete) {
                throw new Error('delete denied');
            }
            comments = comments.filter((comment) => comment.id !== id);
        },
        log: (message) => {
            input.observeOperation?.(`log:${message}`);
            calls.push(`log:${message}`);
        },
    };
    return {
        port,
        calls,
        authorNodeId: input.authorNodeId ?? AUTHOR_BOT_NODE_ID,
        posted: () => [...postedIds],
        state: () => ({ state, closedAt, comments }),
    };
}

const run = (
    port: SupersedePullRequestPort,
    lineage: FindingLineage = repairedLineage,
    nodeId: string = AUTHOR_BOT_NODE_ID
) => supersedePullRequest(oldNumber, head, replacementNumber, lineage, nodeId, port);

const runWithParent = (port: SupersedePullRequestPort) =>
    supersedePullRequest(oldNumber, head, replacementNumber, repairedLineage, AUTHOR_BOT_NODE_ID, port, parentNumber);

async function withLockRoot(operation: (root: string) => Promise<void>): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-supersession-lock-'));
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
        ownerFence: { kind: 'pid', pid: process.pid, startedAt: 'supersession-fixture-process' },
    });

function runSerialized(
    root: string,
    port: SupersedePullRequestPort,
    lineage: FindingLineage = repairedLineage,
    serialization: PullRequestMutationSerialization = serializeFixture,
    supersededParentNumber?: number
) {
    return serializedSupersedePullRequest(
        root,
        {
            oldNumber: lineage.oldPr,
            expectedHead: head,
            replacementNumber,
            supersededParentNumber,
            lineage,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            port,
        },
        serialization
    );
}

function retainedOwner(root: string): string {
    const oid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber);
    expect(oid).toBeDefined();
    if (oid === undefined) {
        throw new Error('expected a retained supersession lock');
    }
    return oid;
}

function nativeSupersessionFixture(root: string, moveAtRead?: number) {
    let currentHead = head;
    let state = 'OPEN';
    let closedAt: string | null = null;
    let commentReads = 0;
    let moveAt = moveAtRead;
    const comments = [
        oldComment,
        markerComment('IC_receipt', '2001', receiptBody),
        markerComment('IC_lineage', '2002', lineageBody),
    ];
    const events: string[] = [];
    const capture = (command: string, args: string[]): string => {
        if (command === 'git') {
            return join(root, '.git');
        }
        const query = args.find((arg) => arg.startsWith('query=')) ?? '';
        if (query.includes('headRefOid')) {
            const number = Number(args.find((arg) => arg.startsWith('number='))?.slice(7));
            events.push(number === oldNumber ? 'old-core' : 'replacement-core');
            const old = number === oldNumber;
            return JSON.stringify({
                data: {
                    repository: {
                        nameWithOwner: 'jcosta33/sourdaw',
                        pullRequest: {
                            id: old ? 'PR_old' : 'PR_replacement',
                            number,
                            state: old ? state : 'MERGED',
                            headRefOid: old ? currentHead : 'c'.repeat(40),
                            headRefName: old ? 'fix/old' : 'fix/replacement',
                            headRepository: { nameWithOwner: 'jcosta33/sourdaw' },
                            baseRefName: 'main',
                            baseRef: null,
                            merged: !old,
                            closedAt: old ? closedAt : '2026-10-24T00:00:00Z',
                        },
                    },
                },
            });
        }
        if (query.includes('node(id:$subjectId)')) {
            const id = args.find((arg) => arg.startsWith('subjectId='))?.slice(10);
            if (id === 'PR_old') {
                events.push('old-comments');
                commentReads += 1;
                if (commentReads === moveAt) {
                    currentHead = movedHead;
                }
            } else {
                events.push('replacement-comments');
            }
            return JSON.stringify({
                data: {
                    node: {
                        id,
                        comments: {
                            nodes: (id === 'PR_old' ? comments : []).map((entry) => ({
                                id: entry.id,
                                fullDatabaseId: entry.fullDatabaseId,
                                body: entry.body,
                                author: {
                                    id: entry.authorNodeId,
                                    login: entry.authorLogin,
                                    __typename: entry.authorType,
                                },
                            })),
                            pageInfo: { hasNextPage: false, endCursor: null },
                        },
                    },
                },
            });
        }
        if (query.includes('closePullRequest(input:')) {
            events.push('close');
            state = 'CLOSED';
            closedAt = '2026-10-24T00:00:00Z';
            const clientMutationId = args.find((arg) => arg.startsWith('clientMutationId='))?.slice(17);
            return JSON.stringify({
                data: { closePullRequest: { clientMutationId, pullRequest: { id: 'PR_old', state, closedAt } } },
            });
        }
        throw new Error(`unexpected native supersession query: ${query}`);
    };
    const port: SupersedePullRequestPort = {
        ...shellPort({ configDir: root, env: {}, dispose: () => undefined }, root, capture),
        inspectReviewThreads: () => defaultThreads,
        log: (message) => events.push(message),
    };
    return {
        port,
        events,
        state: () => state,
        moveOnReplay: () => {
            moveAt = commentReads + 1;
        },
    };
}

const LINEAGE_MARKER = 'sourdaw-lineage-v1';

function lineagePayloadOf(body: string): string {
    const marker = body.split('\n').find((line) => line.startsWith(LINEAGE_MARKER));
    if (marker === undefined) {
        throw new Error(`no lineage marker line in ${JSON.stringify(body)}`);
    }
    return marker.slice(LINEAGE_MARKER.length).trim();
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The spec's own key-sorted, whitespace-free encoding, an independent expectation for the payload. */
function canonicalJson(value: unknown): string {
    if (isUnknownArray(value)) {
        return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
    }
    if (isUnknownRecord(value)) {
        const members = Object.entries(value)
            .sort(([left], [right]) => (left < right ? -1 : 1))
            .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
        return `{${members.join(',')}}`;
    }
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    throw new Error(`the lineage payload carries a value this spec cannot canonicalize: ${typeof value}`);
}

function whitespaceOutsideStrings(json: string): string[] {
    const found: string[] = [];
    let insideString = false;
    let escaped = false;
    for (const character of json) {
        if (insideString) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                insideString = false;
            }
            continue;
        }
        if (character === '"') {
            insideString = true;
        } else if (/\s/u.test(character)) {
            found.push(character);
        }
    }
    return found;
}

function sortedKeysEverywhere(value: unknown): boolean {
    if (isUnknownArray(value)) {
        return value.every((entry) => sortedKeysEverywhere(entry));
    }
    if (!isUnknownRecord(value)) {
        return true;
    }
    const keys = Object.keys(value);
    const sorted = [...keys].sort();
    return (
        keys.every((key, index) => key === sorted[index]) &&
        Object.values(value).every((entry) => sortedKeysEverywhere(entry))
    );
}

describe('pull-request supersession', () => {
    it('keeps the real supersession inspection and close adapters valid on an unchanged head', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root);
            await expect(runSerialized(root, current.port)).resolves.toBe('pull-request-superseded:2244:2246');
            await expect(runSerialized(root, current.port)).resolves.toBe('pull-request-superseded:2244:2246');
            expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
            expect(current.events[current.events.indexOf('close') - 1]).toBe('old-core');
        });
    });

    it('keeps a moved native head from closing after the final composite marker read', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, 3);
            await expect(runSerialized(root, current.port)).rejects.toThrow();
            expect(current.events).not.toContain('close');
            expect(current.state()).toBe('OPEN');
        });
    });

    it('rejects CLOSED supersession replay when native comments follow a moved head', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root);
            await runSerialized(root, current.port);
            current.moveOnReplay();
            await expect(runSerialized(root, current.port)).rejects.toThrow();
            expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
        });
    });
    it('uses client mutation receipts for forward comment and close mutations', () => {
        const source = readFileSync(join(import.meta.dirname, '../supersedePullRequestGh.ts'), 'utf8');
        expect(source).toContain(
            'addComment(input:{subjectId:$subjectId,body:$body,clientMutationId:$clientMutationId})'
        );
        expect(source).toContain(
            'closePullRequest(input:{pullRequestId:$pullRequestId,clientMutationId:$clientMutationId})'
        );
        expect(source).toContain('headRefOid headRefName headRepository{nameWithOwner} baseRefName merged closedAt');
        expect(source).not.toMatch(/\bauthor\s*\{\s*id\b/);
        expect(source.match(/author\{login __typename \.\.\. on Bot\{id\}\}/g)).toHaveLength(2);
    });
    it.each([
        null,
        {
            name: parentBranch,
            repository: { nameWithOwner: 'jcosta33/sourdaw' },
            target: { oid: parentHead },
        },
    ])('reads the live base ref %j rather than a cached base SHA', (baseRef) => {
        const calls: string[][] = [];
        const value = inspectPullRequest(
            oldNumber,
            (args) => {
                calls.push(args);
                if (args.includes(`number=${oldNumber}`)) {
                    return JSON.stringify({
                        data: {
                            repository: {
                                nameWithOwner: 'jcosta33/sourdaw',
                                pullRequest: {
                                    id: 'PR_old',
                                    number: oldNumber,
                                    state: 'OPEN',
                                    merged: false,
                                    headRefOid: head,
                                    headRefName: 'fix/old',
                                    headRepository: null,
                                    baseRefName: parentBranch,
                                    baseRefOid: movedHead,
                                    baseRef,
                                    closedAt: null,
                                },
                            },
                        },
                    });
                }
                return JSON.stringify({
                    data: {
                        node: {
                            id: 'PR_old',
                            comments: {
                                nodes: [],
                                pageInfo: { hasNextPage: false, endCursor: null },
                            },
                        },
                    },
                });
            },
            new Map()
        );
        if (baseRef === null) {
            expect(value.baseRef).toBeNull();
        } else {
            expect(value.baseRef).toEqual({ name: parentBranch, repository: 'jcosta33/sourdaw', target: parentHead });
        }
        expect(calls[0]?.join(' ')).toContain('baseRef{name repository{nameWithOwner} target{oid}}');
        expect(calls).toHaveLength(2);
    });
    it.each([
        ['missing', { data: { deleteIssueComment: { clientMutationId: null } } }],
        ['mismatched', { data: { deleteIssueComment: { clientMutationId: 'IC_other' } } }],
    ])('rejects a %s delete-comment receipt', (_case, response) => {
        expect(() => deleteComment('IC_new', () => JSON.stringify(response))).toThrow(
            /delete supersession comment returned an invalid result/i
        );
    });
    it('paginates over 100 pull-request comments before supersession compensation can compare them', () => {
        const first = Array.from({ length: 100 }, (_, index) => ({
            id: `IC_${index}`,
            fullDatabaseId: String(index + 1),
            body: 'old',
            author: { id: 'BOT_reviewer', login: 'reviewer[bot]' },
        }));
        const final = {
            id: 'IC_100',
            fullDatabaseId: '9223372036854775808',
            body: 'Superseded by #2246.',
            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author' },
        };
        const calls: string[][] = [];
        const comments = inspectIssueComments('PR_kwDOExample', (args) => {
            calls.push(args);
            const firstPage = calls.length === 1;
            return JSON.stringify({
                data: {
                    node: {
                        id: 'PR_kwDOExample',
                        comments: {
                            nodes: firstPage ? first : [final],
                            pageInfo: { hasNextPage: firstPage, endCursor: firstPage ? 'issue-comments-1' : null },
                        },
                    },
                },
            });
        });
        expect(comments).toHaveLength(101);
        expect(comments.at(-1)?.id).toBe('IC_100');
        expect(calls[1]).toContain('cursor=issue-comments-1');
    });
    it('rejects partial GraphQL data with errors before accepting issue comments', () => {
        expect(() =>
            inspectIssueComments('PR_kwDOExample', () =>
                JSON.stringify({
                    data: {
                        node: {
                            id: 'PR_kwDOExample',
                            comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                        },
                    },
                    errors: [{ message: 'partial failure' }],
                })
            )
        ).toThrow(/invalid GraphQL envelope/i);
    });
    it('reads review-thread root comment database ids as findings across pages', () => {
        const calls: string[][] = [];
        const rootComments = (databaseId: number, id: string) => ({
            nodes: [{ id, databaseId }],
            pageInfo: { hasNextPage: false, endCursor: null },
        });
        const firstPageNodes = [{ id: 'PRRT_1', comments: rootComments(1001, 'PRRC_1') }];
        const secondPageNodes = [{ id: 'PRRT_2', comments: rootComments(1002, 'PRRC_2') }];
        const threads = inspectReviewThreads(oldNumber, (args) => {
            calls.push(args);
            const firstPage = calls.length === 1;
            return JSON.stringify({
                data: {
                    repository: {
                        pullRequest: {
                            reviewThreads: {
                                nodes: firstPage ? firstPageNodes : secondPageNodes,
                                pageInfo: { hasNextPage: firstPage, endCursor: firstPage ? 'threads-1' : null },
                            },
                        },
                    },
                },
            });
        });
        expect(threads).toEqual([
            { threadId: 'PRRT_1', rootCommentId: '1001' },
            { threadId: 'PRRT_2', rootCommentId: '1002' },
        ]);
        expect(calls[1]).toContain('cursor=threads-1');
    });
    it('refuses a repeated review-thread root comment rather than collapsing two findings', () => {
        expect(() =>
            inspectReviewThreads(oldNumber, () =>
                JSON.stringify({
                    data: {
                        repository: {
                            pullRequest: {
                                reviewThreads: {
                                    nodes: [
                                        { id: 'PRRT_1', comments: { nodes: [{ id: 'PRRC_1', databaseId: 1001 }] } },
                                        { id: 'PRRT_2', comments: { nodes: [{ id: 'PRRC_2', databaseId: 1001 }] } },
                                    ],
                                    pageInfo: { hasNextPage: false, endCursor: null },
                                },
                            },
                        },
                    },
                })
            )
        ).toThrow(/two review threads rooted at comment 1001/i);
    });

    it.each([
        ['repeated', 'issue-comments-1'],
        ['empty', ''],
    ])('fails closed on a %s issue-comment cursor', (_case, cursor) => {
        let call = 0;
        expect(() =>
            inspectIssueComments('PR_kwDOExample', () => {
                call += 1;
                return JSON.stringify({
                    data: {
                        node: {
                            id: 'PR_kwDOExample',
                            comments: {
                                nodes: [],
                                pageInfo: { hasNextPage: true, endCursor: cursor },
                            },
                        },
                    },
                });
            })
        ).toThrow(/pagination/i);
    });
    it('rejects a valid-looking comment page for a different subject node', () => {
        expect(() =>
            inspectIssueComments('PR_kwDOExample', () =>
                JSON.stringify({
                    data: {
                        node: {
                            id: 'PR_other',
                            comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                        },
                    },
                })
            )
        ).toThrow(/invalid issue comments/i);
    });

    it('parses strict arguments with a required lineage path', () => {
        expect(
            parseSupersedePullRequestArgs([
                '2244',
                '--head',
                head,
                '--replacement',
                '2246',
                '--lineage',
                '/tmp/lineage.json',
            ])
        ).toMatchObject({
            oldNumber: 2244,
            head,
            replacementNumber: 2246,
            lineagePath: '/tmp/lineage.json',
        });
        expect(
            parseSupersedePullRequestArgs([
                '2244',
                '--head',
                head,
                '--replacement',
                '2246',
                '--superseded-parent',
                '2245',
                '--lineage',
                '/tmp/lineage.json',
            ])
        ).toMatchObject({
            oldNumber: 2244,
            head,
            replacementNumber: 2246,
            supersededParentNumber: 2245,
            lineagePath: '/tmp/lineage.json',
        });
        for (const args of [
            [],
            ['2244', '--replacement', '2246', '--head', head, '--lineage', '/tmp/lineage.json'],
            ['2244', '--head', head, '--replacement', '2244', '--lineage', '/tmp/lineage.json'],
            ['2244', '--head', head, '--replacement', '2246'],
            ['2244', '--head', head, '--replacement', '2246', '--lineage', '   '],
            [
                '2244',
                '--head',
                head,
                '--replacement',
                '2246',
                '--superseded-parent',
                '2246',
                '--lineage',
                '/tmp/lineage.json',
            ],
        ]) {
            expect(() => parseSupersedePullRequestArgs(args)).toThrow(/usage/i);
        }
    });

    it('refuses a missing lineage file by naming it', () => {
        const missing = join(tmpdir(), 'sourdaw-lineage-3001-does-not-exist.json');
        expect(() => readFindingLineageFile(missing)).toThrow(/cannot read finding lineage file/i);
        expect(() => readFindingLineageFile(missing)).toThrow(missing);
    });
    it('refuses a malformed lineage document by naming it and the problem', () => {
        const directory = mkdtempSync(join(tmpdir(), 'sourdaw-lineage-3001-'));
        try {
            const malformed = join(directory, 'malformed.json');
            writeFileSync(malformed, 'sourdaw-lineage-v1 {not json');
            expect(() => readFindingLineageFile(malformed)).toThrow(malformed);
            expect(() => readFindingLineageFile(malformed)).toThrow(/not a valid lineage/i);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
    it('accepts a lineage file as a bare JSON object or a rendered marker body', () => {
        const directory = mkdtempSync(join(tmpdir(), 'sourdaw-lineage-3001-'));
        try {
            const bare = join(directory, 'bare.json');
            const rendered = join(directory, 'rendered.md');
            writeFileSync(bare, JSON.stringify(repairedLineage));
            writeFileSync(rendered, lineageBody);
            expect(readFindingLineageFile(bare)).toEqual(repairedLineage);
            expect(readFindingLineageFile(rendered)).toEqual(repairedLineage);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
    it('refuses a bare lineage document that repeats a key instead of reading it last-wins', () => {
        const directory = mkdtempSync(join(tmpdir(), 'sourdaw-lineage-3001-'));
        try {
            const duplicated = join(directory, 'duplicated.json');
            const payload =
                '{"format":"lineage-v1","oldPr":2244,"replacementPr":2246,"entries":[{"findingId":"1001","disposition":"discarded","disposition":"repaired","replacementPr":2246,"replacementFindingId":"2001","reason":""}]}';
            writeFileSync(duplicated, payload);
            expect(JSON.parse(payload)).toEqual(repairedLineage);
            expect(() => readFindingLineageFile(duplicated)).toThrow(/repeats the key "disposition"/i);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
    it('refuses a space-before-colon bare lineage document that repeats a key instead of reading it last-wins', () => {
        const directory = mkdtempSync(join(tmpdir(), 'sourdaw-lineage-3001-'));
        try {
            const duplicated = join(directory, 'duplicated-spaced.json');
            const payload =
                '{"format" : "lineage-v1", "oldPr" : 2244, "replacementPr" : 2246, "entries" : [{"findingId" : "1001", "disposition" : "discarded", "disposition" : "repaired", "replacementPr" : 2246, "replacementFindingId" : "2001", "reason" : ""}]}';
            writeFileSync(duplicated, payload);
            expect(JSON.parse(payload)).toEqual(repairedLineage);
            expect(() => readFindingLineageFile(duplicated)).toThrow(
                /repeats the key "disposition" instead of reading it last-wins/i
            );
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
    it('accepts a bare lineage document with unique keys in any formatting', () => {
        const directory = mkdtempSync(join(tmpdir(), 'sourdaw-lineage-3001-'));
        try {
            const expected: FindingLineage = {
                ...repairedLineage,
                entries: [repairedEntry, { ...repairedEntry, findingId: findingB }],
            };
            const formatted = join(directory, 'formatted.json');
            const unsorted = {
                entries: expected.entries.map((entry) => ({
                    reason: entry.reason,
                    replacementPr: entry.replacementPr,
                    replacementFindingId: entry.replacementFindingId,
                    disposition: entry.disposition,
                    findingId: entry.findingId,
                })),
                replacementPr: replacementNumber,
                oldPr: oldNumber,
                format: 'lineage-v1',
            };
            writeFileSync(formatted, JSON.stringify(unsorted, null, 4));
            expect(readFindingLineageFile(formatted)).toEqual(expected);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it.each([
        ['wrong actor', REVIEWER_BOT_NODE_ID, {}],
        ['replacement open', AUTHOR_BOT_NODE_ID, { replacementState: 'OPEN' }],
    ])('refuses %s without mutations', (_name, nodeId, input) => {
        const { port, calls } = fakePort(input);
        expect(() => run(port, repairedLineage, nodeId)).toThrow();
        expect(calls.filter((call) => !call.startsWith('inspect') && !call.startsWith('threads:'))).toEqual([]);
    });

    it('posts the receipt and the lineage marker, closes, and verifies', () => {
        const { port, calls, authorNodeId } = fakePort();
        expect(run(port, repairedLineage, authorNodeId)).toBe('pull-request-superseded:2244:2246');
        expect(calls).toEqual([
            'threads:2244',
            'inspect:2244',
            'inspect:2246',
            `comment:2244:${receiptBody}`,
            `comment:2244:${lineageBody}`,
            'inspect:2244',
            'inspect:2244',
            'threads:2244',
            'close:2244',
            'inspect:2244',
            'log:pull-request-superseded:2244:2246',
        ]);
    });
    it('accepts a cross-base child when its own-repository parent was natively superseded', () => {
        const { port, calls } = fakePort({
            bases: [parentBranch, parentBranch, parentBranch, parentBranch],
            parentHeadRepositories: ['jcosta33/sourdaw', 'jcosta33/sourdaw', 'jcosta33/sourdaw', 'jcosta33/sourdaw'],
        });
        expect(runWithParent(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it('accepts a stale cached child base SHA when the live base ref identifies the parent final head', () => {
        const { port, calls } = fakePort({ bases: Array.from({ length: 12 }, () => parentBranch) });
        expect(runWithParent(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it('replays exact closed child markers after legitimate base-ref deletion without writes', () => {
        const { port, calls } = fakePort({
            initialState: 'CLOSED',
            bases: [parentBranch],
            baseRefs: [null],
            existingCommentCount: 1,
            existingLineageCount: 1,
        });
        expect(runWithParent(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => /^(?:comment|delete|close):/.test(call))).toEqual([]);
    });
    it('does not admit an incomplete closed replay after base-ref deletion', () => {
        const { port, calls } = fakePort({
            initialState: 'CLOSED',
            bases: [parentBranch],
            baseRefs: [null],
            existingCommentCount: 1,
        });
        expect(() => runWithParent(port)).toThrow(/lineage marker/i);
        expect(calls.filter((call) => /^(?:comment|delete|close):/.test(call))).toEqual([]);
    });
    it.each(['markers', 'findings'])('refuses closed replay when %s change during parent proof', (change) => {
        const { port, calls } = fakePort({
            initialState: 'CLOSED',
            bases: [parentBranch],
            baseRefs: [null],
            existingCommentCount: 1,
            existingLineageCount: 1,
        });
        const originalInspect = port.inspect;
        const originalThreads = port.inspectReviewThreads;
        let parentRead = false;
        port.inspect = (number) => {
            const value = originalInspect(number);
            if (number === parentNumber) {
                parentRead = true;
            }
            if (number === oldNumber && parentRead && change === 'markers') {
                return { ...value, comments: value.comments.filter((comment) => comment.body !== lineageBody) };
            }
            return value;
        };
        port.inspectReviewThreads = (number) => {
            const findings = originalThreads(number);
            if (number === oldNumber && parentRead && change === 'findings') {
                return [...findings, { threadId: 'PRRT_late', rootCommentId: findingB }];
            }
            return findings;
        };
        expect(() => runWithParent(port)).toThrow();
        expect(calls.filter((call) => /^(?:comment|delete|close|log):/.test(call))).toEqual([]);
    });
    it('does not ignore a contradictory present base ref during completed replay', () => {
        const { port, calls } = fakePort({
            initialState: 'CLOSED',
            bases: [parentBranch],
            baseRefs: [{ name: parentBranch, repository: 'jcosta33/sourdaw', target: movedHead }],
            existingCommentCount: 1,
            existingLineageCount: 1,
        });
        expect(() => runWithParent(port)).toThrow(/live base ref/i);
        expect(calls.filter((call) => /^(?:comment|delete|close):/.test(call))).toEqual([]);
    });
    it('keeps same-base supersession independent of live base and head repositories', () => {
        const { port, calls } = fakePort({
            baseRefs: [null],
            oldHeadRepository: null,
            replacementHeadRepository: null,
        });
        expect(run(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it.each([
        ['target', { name: parentBranch, repository: 'jcosta33/sourdaw', target: movedHead }],
        ['repository', { name: parentBranch, repository: 'fork/sourdaw', target: parentHead }],
        ['name', { name: 'fix/reused', repository: 'jcosta33/sourdaw', target: parentHead }],
        ['missing', null],
    ] satisfies [string, SupersededPullRequest['baseRef']][])(
        'revalidates live base ref %s during each last parent proof',
        (_case, changedRef) => {
            for (const phase of ['before-write', 'before-close', 'after-close'] as const) {
                const { port, calls, state } = fakePort({ bases: [parentBranch] });
                const originalInspect = port.inspect;
                let parentReads = 0;
                let changed = false;
                const parentRead = { 'before-write': 2, 'before-close': 3, 'after-close': 4 }[phase];
                port.inspect = (number) => {
                    const value = originalInspect(number);
                    if (number === parentNumber && ++parentReads === parentRead) {
                        changed = true;
                    }
                    if (number === oldNumber && changed) {
                        return { ...value, baseRef: changedRef };
                    }
                    return value;
                };
                expect(() => runWithParent(port)).toThrow(phase === 'after-close' ? /ambiguous/i : /live base ref/i);
                expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
                if (phase === 'before-write') {
                    expect(calls.filter((call) => /^(?:comment|delete|close):/.test(call))).toEqual([]);
                } else if (phase === 'before-close') {
                    expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
                    expect(state().comments).toEqual([oldComment]);
                } else {
                    expect(state().state).toBe('CLOSED');
                    expect(state().comments.map((comment) => comment.body)).toEqual([
                        oldComment.body,
                        receiptBody,
                        lineageBody,
                    ]);
                    expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
                }
            }
        }
    );
    it.each([
        ['reused branch name', { name: parentBranch, repository: 'jcosta33/sourdaw', target: movedHead }],
        ['foreign base ref', { name: parentBranch, repository: 'fork/sourdaw', target: parentHead }],
        ['another ref name', { name: 'fix/another-parent', repository: 'jcosta33/sourdaw', target: parentHead }],
        ['missing live base ref', null],
    ] satisfies [string, SupersededPullRequest['baseRef']][])(
        'refuses a %s before admitting a fresh stacked closure',
        (_case, baseRef) => {
            const { port, calls } = fakePort({ bases: [parentBranch], baseRefs: [baseRef] });
            expect(() => runWithParent(port)).toThrow(/live base ref/i);
            expect(calls.filter((call) => /^(?:comment|delete|close):/.test(call))).toEqual([]);
        }
    );
    it.each(['added', 'removed'])('refuses child findings %s during the last parent proof before close', (change) => {
        const { port, calls, state } = fakePort({ bases: Array.from({ length: 12 }, () => parentBranch) });
        const originalInspect = port.inspect;
        const originalThreads = port.inspectReviewThreads;
        let parentReads = 0;
        let changed = false;
        port.inspect = (number) => {
            const value = originalInspect(number);
            if (number === parentNumber && ++parentReads === 3) {
                changed = true;
            }
            return value;
        };
        port.inspectReviewThreads = (number) => {
            const findings = originalThreads(number);
            if (number === oldNumber && changed) {
                if (change === 'removed') {
                    return [];
                }
                return [...findings, { threadId: 'PRRT_late', rootCommentId: findingB }];
            }
            return findings;
        };
        expect(() => runWithParent(port)).toThrow(/finding set changed/i);
        expect(state().state).toBe('OPEN');
        expect(state().comments).toEqual([oldComment]);
        expect(calls.filter((call) => /^(?:close|log):/.test(call))).toEqual([]);
    });
    it.each(['added', 'removed'])(
        'reports ambiguity for child findings %s during the final parent proof after close',
        (change) => {
            const { port, calls, state } = fakePort({ bases: Array.from({ length: 12 }, () => parentBranch) });
            const originalInspect = port.inspect;
            const originalThreads = port.inspectReviewThreads;
            let parentReads = 0;
            let changed = false;
            port.inspect = (number) => {
                const value = originalInspect(number);
                if (number === parentNumber && ++parentReads === 4) {
                    changed = true;
                }
                return value;
            };
            port.inspectReviewThreads = (number) => {
                const findings = originalThreads(number);
                if (number === oldNumber && changed) {
                    if (change === 'removed') {
                        return [];
                    }
                    return [...findings, { threadId: 'PRRT_late', rootCommentId: findingB }];
                }
                return findings;
            };
            expect(() => runWithParent(port)).toThrow(/ambiguous.*finding set changed/i);
            expect(state().state).toBe('CLOSED');
            expect(state().comments.map((comment) => comment.body)).toEqual([
                oldComment.body,
                receiptBody,
                lineageBody,
            ]);
            expect(calls.filter((call) => /^(?:delete|log):/.test(call))).toEqual([]);
        }
    );
    it.each([null, 'fork-owner/sourdaw'])('does not require a %s replacement head repository', (headRepository) => {
        const { port, calls } = fakePort({ replacementHeadRepository: headRepository });
        expect(run(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it.each([
        ['fork parent', ['fork-owner/sourdaw']],
        ['missing parent head repository', [null]],
        ['changed parent head repository', ['jcosta33/sourdaw', 'fork-owner/sourdaw']],
    ] satisfies [string, (string | null)[]][])(
        'refuses a %s identity before child writes',
        (_case, parentHeadRepositories) => {
            const { port, calls } = fakePort({
                bases: [parentBranch, parentBranch, parentBranch, parentBranch],
                parentHeadRepositories,
            });
            expect(() => runWithParent(port)).toThrow(/head repository/i);
            expect(calls.filter((call) => /^(?:comment|delete|close):/.test(call))).toEqual([]);
        }
    );
    it('reports ambiguity and preserves closed-child evidence when parent authority disappears during close', () => {
        const { port, calls, state } = fakePort({
            bases: [parentBranch, parentBranch, parentBranch, parentBranch],
            removeParentReceiptDuringClose: true,
        });
        expect(() => runWithParent(port)).toThrow(/ambiguous/i);
        expect(state().state).toBe('CLOSED');
        expect(state().comments.map((comment) => comment.body)).toEqual([oldComment.body, receiptBody, lineageBody]);
        expect(calls.filter((call) => call.startsWith('delete:') || call.startsWith('log:'))).toEqual([]);
    });
    describe.each([
        ['receipt', receiptBody],
        ['lineage', lineageBody],
    ])('child %s marker during the last parent proof before close', (_marker, body) => {
        it.each([
            ['removal', (comments: IssueComment[]) => comments.filter((comment) => comment.body !== body), false],
            [
                'body change',
                (comments: IssueComment[]) =>
                    changeMarker(comments, body, (comment) => ({ ...comment, body: `${body}\nEdited` })),
                true,
            ],
            [
                'identity replacement',
                (comments: IssueComment[]) =>
                    changeMarker(comments, body, () =>
                        markerComment('IC_replacement_marker', String(databaseBase + 500n), body)
                    ),
                false,
            ],
            [
                'actor change',
                (comments: IssueComment[]) =>
                    changeMarker(comments, body, (comment) => ({ ...comment, authorNodeId: REVIEWER_BOT_NODE_ID })),
                true,
            ],
            [
                'actor type change',
                (comments: IssueComment[]) =>
                    changeMarker(comments, body, (comment) => ({ ...comment, authorType: 'User' })),
                true,
            ],
            [
                'duplicate',
                (comments: IssueComment[]) => [
                    ...comments,
                    markerComment('IC_duplicate_marker', String(databaseBase + 501n), body),
                ],
                false,
            ],
        ] satisfies [string, (comments: IssueComment[]) => IssueComment[], boolean][])(
            'refuses %s before closing and preserves comments outside verified compensation',
            (_case, change, retainsCreatedMarkers) => {
                let changedComments: IssueComment[] | undefined;
                const { port, calls, state, posted } = fakePort({
                    bases: [parentBranch],
                    precloseParentProofChildComments: (comments) => {
                        changedComments = change(comments);
                        return changedComments;
                    },
                });
                expect(() => runWithParent(port)).toThrow(/marker|receipt/i);
                expect(changedComments).toBeDefined();
                expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
                expect(state().state).toBe('OPEN');
                expect(state().closedAt).toBeNull();
                expect(state().comments).toContainEqual(oldComment);
                if (retainsCreatedMarkers) {
                    expect(state().comments).toEqual(changedComments);
                    expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
                } else {
                    expect(state().comments).toEqual(
                        changedComments?.filter((comment) => !posted().includes(comment.id))
                    );
                    const expectedDeletes = posted()
                        .filter((id) => changedComments?.some((comment) => comment.id === id))
                        .map((id) => `delete:${id}`);
                    expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(expectedDeletes);
                }
                expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
            }
        );
    });
    it.each([
        ['lineage removal', (comments: IssueComment[]) => comments.filter((comment) => comment.body !== lineageBody)],
        ['receipt removal', (comments: IssueComment[]) => comments.filter((comment) => comment.body !== receiptBody)],
        [
            'receipt body change',
            (comments: IssueComment[]) =>
                changeMarker(comments, receiptBody, (comment) => ({ ...comment, body: supersessionCommentBody(9999) })),
        ],
        [
            'receipt identity replacement',
            (comments: IssueComment[]) =>
                changeMarker(comments, receiptBody, () =>
                    markerComment('IC_replacement_receipt', String(databaseBase + 500n), receiptBody)
                ),
        ],
        [
            'receipt actor change',
            (comments: IssueComment[]) =>
                changeMarker(comments, receiptBody, (comment) => ({ ...comment, authorNodeId: REVIEWER_BOT_NODE_ID })),
        ],
        [
            'lineage actor type change',
            (comments: IssueComment[]) =>
                changeMarker(comments, lineageBody, (comment) => ({ ...comment, authorType: 'User' })),
        ],
        [
            'duplicate receipt',
            (comments: IssueComment[]) => [
                ...comments,
                markerComment('IC_duplicate_receipt', String(databaseBase + 501n), receiptBody),
            ],
        ],
    ] satisfies [string, (comments: IssueComment[]) => IssueComment[]][])(
        'reports post-close ambiguity for %s during the final parent proof',
        (_case, change) => {
            let changedComments: IssueComment[] | undefined;
            const { port, calls, state } = fakePort({
                bases: [parentBranch],
                finalParentProofChildComments: (comments) => {
                    changedComments = change(comments);
                    return changedComments;
                },
            });
            expect(() => runWithParent(port)).toThrow(/ambiguous/i);
            expect(changedComments).toBeDefined();
            expect(state().state).toBe('CLOSED');
            expect(state().closedAt).toBe('2026-08-20T12:00:00Z');
            expect(state().comments).toEqual(changedComments);
            expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
            expect(calls.filter((call) => /^(?:delete|log):/.test(call))).toEqual([]);
        }
    );
    it('keeps the exact-base requirement when no superseded parent is named', () => {
        const { port, calls } = fakePort({ bases: [parentBranch] });
        expect(() => run(port)).toThrow(`replacement PR #${replacementNumber} does not target ${parentBranch}`);
        expect(calls.filter((call) => /^(?:comment|delete|close):/.test(call))).toEqual([]);
        expect(calls).not.toContain(`inspect:${parentNumber}`);
    });
    it.each([
        ['parent is open', { parentStates: ['OPEN'] }, /not closed without merge/i],
        ['parent was merged', { parentMerged: true }, /not closed without merge/i],
        ['parent owns another head branch', { parentHeadRefNames: ['fix/other-parent'] }, /does not own old base/i],
        ['parent targets another base', { parentBases: ['release'] }, /does not target replacement base/i],
        ['parent is in another repository', { parentRepositories: ['other/sourdaw'] }, /required repository/i],
        ['receipt is missing', { parentComments: [validParentComments[1]] }, /exactly one supersession receipt/i],
        [
            'receipt is duplicated',
            {
                parentComments: [
                    ...validParentComments,
                    markerComment('IC_parent_receipt_2', String(databaseBase + 22n), receiptBody),
                ],
            },
            /exactly one supersession receipt/i,
        ],
        [
            'receipt is foreign',
            {
                parentComments: [
                    markerComment(
                        'IC_parent_receipt',
                        String(databaseBase + 20n),
                        receiptBody,
                        'Bot',
                        REVIEWER_BOT_NODE_ID
                    ),
                    validParentComments[1],
                ],
            },
            /not an exact author-bot marker/i,
        ],
        [
            'receipt names another replacement',
            {
                parentComments: [
                    markerComment('IC_parent_receipt', String(databaseBase + 20n), supersessionCommentBody(9999)),
                    validParentComments[1],
                ],
            },
            /does not name replacement/i,
        ],
        ['lineage is missing', { parentComments: [validParentComments[0]] }, /exactly one finding lineage marker/i],
        [
            'lineage is duplicated',
            {
                parentComments: [
                    ...validParentComments,
                    markerComment('IC_parent_lineage_2', String(databaseBase + 23n), parentLineageBody),
                ],
            },
            /exactly one finding lineage marker/i,
        ],
        [
            'lineage is foreign',
            {
                parentComments: [
                    validParentComments[0],
                    markerComment(
                        'IC_parent_lineage',
                        String(databaseBase + 21n),
                        parentLineageBody,
                        'Bot',
                        REVIEWER_BOT_NODE_ID
                    ),
                ],
            },
            /not an exact author-bot marker/i,
        ],
        [
            'lineage is malformed',
            {
                parentComments: [
                    validParentComments[0],
                    markerComment(
                        'IC_parent_lineage',
                        String(databaseBase + 21n),
                        'Finding lineage: corrupt\nsourdaw-lineage-v1 {bad json'
                    ),
                ],
            },
            /finding lineage marker/i,
        ],
        [
            'lineage names another replacement',
            {
                parentComments: [
                    validParentComments[0],
                    markerComment(
                        'IC_parent_lineage',
                        String(databaseBase + 21n),
                        renderFindingLineage({ ...parentLineage, replacementPr: 9999 })
                    ),
                ],
            },
            /does not match replacement pull request/i,
        ],
        [
            'lineage omits a live parent finding',
            { parentThreads: [{ threadId: 'PRRT_parent', rootCommentId: '3001' }] },
            /has no entry for finding 3001/i,
        ],
    ] satisfies [string, Input, RegExp][])(
        'refuses cross-base proof when %s, without child writes',
        (_case, input, expected) => {
            const { port, calls } = fakePort({ ...input, bases: [parentBranch] });
            expect(() => runWithParent(port)).toThrow(expected);
            expect(calls.filter((call) => /^(?:comment|delete|close):/.test(call))).toEqual([]);
        }
    );
    it('refuses a changed parent proof before the first child write', () => {
        const { port, calls } = fakePort({
            bases: [parentBranch],
            parentHeads: [parentHead, movedHead],
        });
        expect(() => runWithParent(port)).toThrow(/live base ref does not identify superseded parent/i);
        expect(calls.filter((call) => /^(?:comment|delete|close):/.test(call))).toEqual([]);
    });
    it('compensates child markers when the parent proof changes before close', () => {
        const changedParentComments = [
            validParentComments[0],
            markerComment('IC_parent_lineage_moved', String(databaseBase + 21n), parentLineageBody),
        ];
        const { port, calls, state } = fakePort({
            bases: [parentBranch, parentBranch, parentBranch],
            parentCommentsByInspection: [validParentComments, validParentComments, changedParentComments],
        });
        expect(() => runWithParent(port)).toThrow(/proof changed during supersession/i);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_post_1', 'delete:IC_post_2']);
        expect(state().comments).toEqual([oldComment]);
    });
    it('reuses existing child markers while revalidating the stacked parent through close', () => {
        const { port, calls } = fakePort({
            bases: [parentBranch, parentBranch, parentBranch, parentBranch],
            existingCommentCount: 1,
            existingLineageCount: 1,
        });
        expect(runWithParent(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('comment:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
        expect(calls.filter((call) => call === `inspect:${parentNumber}`)).toHaveLength(4);
    });
    it('posts and validates the lineage marker before the close', () => {
        const { port, calls, authorNodeId } = fakePort();
        run(port, repairedLineage, authorNodeId);
        const lineagePosted = calls.indexOf(`comment:2244:${lineageBody}`);
        expect(lineagePosted).toBeGreaterThan(-1);
        expect(lineagePosted).toBeLessThan(calls.indexOf('close:2244'));
    });
    it('records an empty lineage for a pull request with no review threads', () => {
        const emptyLineage: FindingLineage = {
            format: 'lineage-v1',
            oldPr: oldNumber,
            replacementPr: replacementNumber,
            entries: [],
        };
        const { port, calls, authorNodeId } = fakePort({ threads: [] });
        expect(run(port, emptyLineage, authorNodeId)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('comment:'))).toEqual([
            `comment:2244:${receiptBody}`,
            `comment:2244:${renderFindingLineage(emptyLineage)}`,
        ]);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });

    it('pins the canonical lineage marker bytes rather than whatever the serializer returns', () => {
        expect(renderFindingLineage(repairedLineage)).toBe(lineageBody);
    });
    it('parses the canonical lineage marker bytes it printed', () => {
        expect(parseFindingLineage(lineageBody)).toEqual(repairedLineage);
    });
    it('refuses a lineage payload that repeats a key instead of reading it last-wins', () => {
        const duplicated = `${LINEAGE_MARKER} {"entries":[{"disposition":"discarded","disposition":"repaired","findingId":"1001","reason":"","replacementFindingId":"2001","replacementPr":2246}],"format":"lineage-v1","oldPr":2244,"replacementPr":2246}`;
        expect(JSON.parse(duplicated.slice(LINEAGE_MARKER.length))).toEqual(repairedLineage);
        expect(() => parseFindingLineage(duplicated)).toThrow(
            /finding lineage marker line is not the canonical key-sorted, whitespace-free JSON record/i
        );
    });
    it('pins the serializer byte form as key-sorted, whitespace-free bytes that re-encode to themselves', () => {
        const payload = lineagePayloadOf(renderFindingLineage(repairedLineage));
        const parsed: unknown = JSON.parse(payload);
        expect(canonicalJson(parsed)).toBe(payload);
        expect(sortedKeysEverywhere(parsed)).toBe(true);
        expect(whitespaceOutsideStrings(payload)).toEqual([]);
        const indented = JSON.stringify(parsed, null, 2);
        const unsorted =
            '{"format":"lineage-v1","oldPr":2244,"replacementPr":2246,"entries":[{"findingId":"1001","disposition":"repaired","replacementPr":2246,"replacementFindingId":"2001","reason":""}]}';
        const indentedValue: unknown = JSON.parse(indented);
        const unsortedValue: unknown = JSON.parse(unsorted);
        expect(indentedValue).toEqual(parsed);
        expect(unsortedValue).toEqual(parsed);
        expect(sortedKeysEverywhere(unsortedValue)).toBe(false);
        expect(whitespaceOutsideStrings(indented)).not.toEqual([]);
        expect(canonicalJson(indentedValue)).not.toBe(indented);
        expect(canonicalJson(unsortedValue)).not.toBe(unsorted);
    });
    it('refuses a lineage marker whose payload is valid JSON but not the canonical byte form', () => {
        const payload = lineagePayloadOf(renderFindingLineage(repairedLineage));
        const parsed: unknown = JSON.parse(payload);
        // The marker grammar reads one line, so the pretty bytes ride it with their breaks folded to spaces.
        const indented = `${LINEAGE_MARKER} ${JSON.stringify(parsed, null, 2).replaceAll('\n', ' ')}`;
        const unsorted = `${LINEAGE_MARKER} {"format":"lineage-v1","oldPr":2244,"replacementPr":2246,"entries":[{"findingId":"1001","disposition":"repaired","replacementPr":2246,"replacementFindingId":"2001","reason":""}]}`;
        expect(JSON.parse(indented.slice(LINEAGE_MARKER.length))).toEqual(repairedLineage);
        expect(JSON.parse(unsorted.slice(LINEAGE_MARKER.length))).toEqual(repairedLineage);
        expect(() => parseFindingLineage(indented)).toThrow(
            /finding lineage marker line is not the canonical key-sorted, whitespace-free JSON record/i
        );
        expect(() => parseFindingLineage(unsorted)).toThrow(
            /finding lineage marker line is not the canonical key-sorted, whitespace-free JSON record/i
        );
    });

    it.each([
        [
            'old number',
            { ...repairedLineage, oldPr: 9999 },
            /finding lineage oldPr 9999 does not match old pull request 2244/i,
        ],
        [
            'replacement number',
            { ...repairedLineage, replacementPr: 9999 },
            /finding lineage replacementPr 9999 does not match replacement pull request 2246/i,
        ],
    ])('refuses a lineage rebound to a different %s before any mutation', (_name, lineage, message) => {
        const { port, calls } = fakePort();
        expect(() =>
            supersedePullRequest(oldNumber, head, replacementNumber, lineage, AUTHOR_BOT_NODE_ID, port)
        ).toThrow(message);
        expect(calls.filter((call) => call.startsWith('comment:') || call.startsWith('close:'))).toEqual([]);
    });
    it('refuses a lineage with no entry for a live finding before any mutation', () => {
        const { port, calls } = fakePort();
        const incomplete: FindingLineage = { ...repairedLineage, entries: [] };
        expect(() =>
            supersedePullRequest(oldNumber, head, replacementNumber, incomplete, AUTHOR_BOT_NODE_ID, port)
        ).toThrow(/has no entry for finding 1001 on pull request 2244/i);
        expect(calls.filter((call) => call.startsWith('comment:') || call.startsWith('close:'))).toEqual([]);
    });
    it('refuses a lineage that repeats a finding id before any mutation', () => {
        const { port, calls } = fakePort();
        const repeated: FindingLineage = { ...repairedLineage, entries: [repairedEntry, repairedEntry] };
        expect(() =>
            supersedePullRequest(oldNumber, head, replacementNumber, repeated, AUTHOR_BOT_NODE_ID, port)
        ).toThrow(/repeats finding id: 1001/i);
        expect(calls.filter((call) => call.startsWith('comment:') || call.startsWith('close:'))).toEqual([]);
    });
    it('refuses a lineage entry that is not a finding on the old pull request', () => {
        const { port, calls } = fakePort();
        const foreign: FindingLineage = {
            ...repairedLineage,
            entries: [{ ...repairedEntry, findingId: findingB }],
        };
        expect(() =>
            supersedePullRequest(oldNumber, head, replacementNumber, foreign, AUTHOR_BOT_NODE_ID, port)
        ).toThrow(/finding lineage entry 1002 is not a finding on pull request 2244/i);
        expect(calls.filter((call) => call.startsWith('comment:') || call.startsWith('close:'))).toEqual([]);
    });
    it('refuses a disposition bound to a different replacement pull request', () => {
        const { port, calls } = fakePort();
        const mismatched: FindingLineage = {
            ...repairedLineage,
            entries: [{ ...repairedEntry, replacementPr: 9999 }],
        };
        expect(() =>
            supersedePullRequest(oldNumber, head, replacementNumber, mismatched, AUTHOR_BOT_NODE_ID, port)
        ).toThrow(/entries\[0\]\.replacementPr must be 2246, found 9999/i);
        expect(calls.filter((call) => call.startsWith('comment:') || call.startsWith('close:'))).toEqual([]);
    });
    it('refuses a discarded entry with no reason', () => {
        const { port, calls } = fakePort();
        const discarded: FindingLineage = {
            ...repairedLineage,
            entries: [
                {
                    findingId: findingA,
                    disposition: 'discarded',
                    replacementPr: null,
                    replacementFindingId: null,
                    reason: '',
                },
            ],
        };
        expect(() =>
            supersedePullRequest(oldNumber, head, replacementNumber, discarded, AUTHOR_BOT_NODE_ID, port)
        ).toThrow(/entries\[0\]\.reason value at index 0 is blank/i);
        expect(calls.filter((call) => call.startsWith('comment:') || call.startsWith('close:'))).toEqual([]);
    });
    it('accepts a transferred entry with a null replacement finding id', () => {
        const { port, calls, authorNodeId } = fakePort();
        const transferred: FindingLineage = {
            ...repairedLineage,
            entries: [
                {
                    findingId: findingA,
                    disposition: 'transferred',
                    replacementPr: replacementNumber,
                    replacementFindingId: null,
                    reason: '',
                },
            ],
        };
        expect(run(port, transferred, authorNodeId)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it('accepts a transferred entry carrying a replacement finding id', () => {
        const { port, calls, authorNodeId } = fakePort();
        const transferred: FindingLineage = {
            ...repairedLineage,
            entries: [{ ...repairedEntry, disposition: 'transferred' }],
        };
        expect(run(port, transferred, authorNodeId)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it('refuses a transferred entry bound to a different replacement pull request', () => {
        const { port, calls } = fakePort();
        const transferred: FindingLineage = {
            ...repairedLineage,
            entries: [{ ...repairedEntry, disposition: 'transferred', replacementPr: 9999 }],
        };
        expect(() =>
            supersedePullRequest(oldNumber, head, replacementNumber, transferred, AUTHOR_BOT_NODE_ID, port)
        ).toThrow(/entries\[0\]\.replacementPr must be 2246, found 9999/i);
        expect(calls.filter((call) => call.startsWith('comment:') || call.startsWith('close:'))).toEqual([]);
    });
    it('refuses a repaired entry with a null replacement finding id', () => {
        const { port, calls } = fakePort();
        const repaired: FindingLineage = {
            ...repairedLineage,
            entries: [{ ...repairedEntry, replacementFindingId: null }],
        };
        expect(() =>
            supersedePullRequest(oldNumber, head, replacementNumber, repaired, AUTHOR_BOT_NODE_ID, port)
        ).toThrow(/entries\[0\] is repaired, so replacementFindingId must name the finding on pull request 2246/i);
        expect(calls.filter((call) => call.startsWith('comment:') || call.startsWith('close:'))).toEqual([]);
    });
    it('refuses a discarded entry naming a replacement pull request', () => {
        const { port, calls } = fakePort();
        const discarded: FindingLineage = {
            ...repairedLineage,
            entries: [
                {
                    findingId: findingA,
                    disposition: 'discarded',
                    replacementPr: replacementNumber,
                    replacementFindingId: null,
                    reason: 'carried on the replacement',
                },
            ],
        };
        expect(() =>
            supersedePullRequest(oldNumber, head, replacementNumber, discarded, AUTHOR_BOT_NODE_ID, port)
        ).toThrow(/entries\[0\] is discarded, so replacementPr must be null, found 2246/i);
        expect(calls.filter((call) => call.startsWith('comment:') || call.startsWith('close:'))).toEqual([]);
    });
    it('refuses a discarded entry naming a replacement finding id', () => {
        const { port, calls } = fakePort();
        const discarded: FindingLineage = {
            ...repairedLineage,
            entries: [
                {
                    findingId: findingA,
                    disposition: 'discarded',
                    replacementPr: null,
                    replacementFindingId: '2001',
                    reason: 'carried on the replacement',
                },
            ],
        };
        expect(() =>
            supersedePullRequest(oldNumber, head, replacementNumber, discarded, AUTHOR_BOT_NODE_ID, port)
        ).toThrow(/entries\[0\] is discarded, so replacementFindingId must be null, found "2001"/i);
        expect(calls.filter((call) => call.startsWith('comment:') || call.startsWith('close:'))).toEqual([]);
    });

    it('refuses a finding added during the transaction before the close', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            threadsBeforeClose: [...defaultThreads, { threadId: 'PRRT_2', rootCommentId: findingB }],
        });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(
            /finding set changed after finding lineage: added 1002, removed none/i
        );
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_post_1', 'delete:IC_post_2']);
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
        expect(state().comments.map((comment) => comment.id)).toEqual([oldComment.id]);
    });
    it('refuses a finding removed during the transaction before the close', () => {
        const { port, calls, authorNodeId, state } = fakePort({ threadsBeforeClose: [] });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(
            /finding set changed after finding lineage: added none, removed 1001/i
        );
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_post_1', 'delete:IC_post_2']);
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
        expect(state().comments.map((comment) => comment.id)).toEqual([oldComment.id]);
    });
    it('recovers with a complete updated lineage after a finding arrives before close', async () => {
        await withLockRoot(async (root) => {
            const { port, calls, state } = fakePort({
                threadsBeforeClose: [...defaultThreads, { threadId: 'PRRT_2', rootCommentId: findingB }],
            });
            await expect(runSerialized(root, port)).rejects.toThrow(
                /finding set changed after finding lineage: added 1002/i
            );
            expect(state().state).toBe('OPEN');
            expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
            const updatedLineage: FindingLineage = {
                ...repairedLineage,
                entries: [repairedEntry, { ...repairedEntry, findingId: findingB }],
            };

            expect(
                readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
            ).toBeUndefined();
            await expect(runSerialized(root, port, updatedLineage)).resolves.toBe('pull-request-superseded:2244:2246');
            expect(state().state).toBe('CLOSED');
            expect(state().comments.map((comment) => comment.body)).toEqual([
                oldComment.body,
                receiptBody,
                renderFindingLineage(updatedLineage),
            ]);
        });
    });

    it('refuses a wrong-body comment receipt before checking stability or closing', () => {
        const { port, calls, authorNodeId, state, posted } = fakePort({ returnedCommentBody: 'Superseded by #9999.' });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(
            /add supersession comment returned an invalid result/i
        );
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state()).toMatchObject({ state: 'OPEN' });
        expect(state().comments.map((comment) => comment.id)).toEqual([oldComment.id, ...posted()]);
    });
    it('refuses a mismatched comment client receipt before close', () => {
        const { port, calls, authorNodeId } = fakePort({ returnedCommentClientMutationId: 'wrong' });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(
            /add supersession comment returned an invalid result/i
        );
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
    });
    it('rejects a User-typed comment receipt before close or success', () => {
        const { port, calls, authorNodeId } = fakePort({ returnedCommentAuthorType: 'User' });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/invalid result/i);
        expect(calls.filter((call) => call.startsWith('close:') || call.startsWith('log:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
    });
    it('refuses a retargeted old PR before close', () => {
        const { port, calls, authorNodeId } = fakePort({ bases: ['main', 'release'] });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/changed after supersession comment/i);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
    });
    it('fails without success when the exact receipt comment disappears before final inspection', () => {
        const { port, calls, authorNodeId } = fakePort({ deleteCommentAfterClose: true });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/comment receipt/i);
        expect(calls.filter((call) => call.startsWith('reopen:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
    });
    it('does not reopen a pull request whose close marker changed concurrently', () => {
        const { port, calls, authorNodeId, state, posted } = fakePort({ changedClosedAtAfterClose: true });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/closed by another actor/i);
        expect(calls.filter((call) => call.startsWith('reopen:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.find((comment) => comment.id === posted()[0])?.body).toBe(receiptBody);
        expect(state().state).toBe('CLOSED');
    });
    it('does not reopen a same-marker close when its final head check fails', () => {
        const { port, calls, authorNodeId, state, posted } = fakePort({ heads: [head, head, head, movedHead] });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/head moved/i);
        expect(calls.filter((call) => call.startsWith('reopen:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.map((comment) => comment.id)).toEqual([oldComment.id, ...posted()]);
        expect(state().state).toBe('CLOSED');
    });
    it('rejects a late retarget after close without reopening or deleting the markers', () => {
        const { port, calls, authorNodeId, state, posted } = fakePort({ bases: ['main', 'main', 'main', 'release'] });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/base changed after mutation/i);
        expect(calls.filter((call) => call.startsWith('reopen:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.map((comment) => comment.id)).toEqual([oldComment.id, ...posted()]);
        expect(state().state).toBe('CLOSED');
    });
    it('does not delete any created marker before an unreceipted close', () => {
        const { port, calls, authorNodeId, state, posted } = fakePort({
            heads: [head, movedHead],
            editCommentAfterComment: true,
        });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/head moved/i);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.find((comment) => comment.id === posted()[0])?.body).toBe('Edited');
    });
    it('fails closed when a thrown comment mutation collides with an identical concurrent comment', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            throwAfterComment: true,
            concurrentCommentOnThrow: true,
        });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(
            /comment transport lost[\s\S]*ambiguous supersession comment mutation/i
        );
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.map((comment) => comment.id)).toEqual([oldComment.id, 'IC_post_1', 'IC_concurrent']);
    });
    it('does not reopen a concurrent state after close throws without a receipt', () => {
        const { port, authorNodeId, state, calls } = fakePort({ throwCloseWithConcurrentState: true });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/close transport lost[\s\S]*durable evidence/i);
        expect(calls.filter((call) => call.startsWith('reopen:'))).toEqual([]);
        expect(state().state).toBe('CLOSED');
    });
    it('preserves both markers after an open close throw, then reuses them on retry', () => {
        const { port, authorNodeId, state, calls } = fakePort({ throwCloseOnceWithoutState: true });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(
            /close transport lost[\s\S]*attempted[\s\S]*durable evidence/i
        );
        expect(state()).toMatchObject({ state: 'OPEN' });
        expect(state().comments.map((comment) => comment.id)).toEqual([oldComment.id, 'IC_post_1', 'IC_post_2']);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(run(port, repairedLineage, authorNodeId)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('comment:'))).toEqual([
            `comment:2244:${receiptBody}`,
            `comment:2244:${lineageBody}`,
        ]);
    });
    it('rolls back verified pre-close markers and reruns idempotently', () => {
        const { port, authorNodeId, state, calls } = fakePort({ heads: [head, movedHead] });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/head moved/i);
        expect(state().state).toBe('OPEN');
        expect(state().comments.map((comment) => comment.id)).toEqual([oldComment.id]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_post_1', 'delete:IC_post_2']);
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);

        expect(run(port)).toBe('pull-request-superseded:2244:2246');
        expect(state().state).toBe('CLOSED');
        expect(state().comments.map((comment) => comment.body)).toEqual([oldComment.body, receiptBody, lineageBody]);
        const completedCalls = [...calls];
        expect(run(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.slice(completedCalls.length)).toEqual([
            'threads:2244',
            'inspect:2244',
            'inspect:2246',
            'log:pull-request-superseded:2244:2246',
        ]);
        expect(calls.filter((call) => call.startsWith('comment:'))).toEqual([
            `comment:2244:${receiptBody}`,
            `comment:2244:${lineageBody}`,
            `comment:2244:${receiptBody}`,
            `comment:2244:${lineageBody}`,
        ]);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it('removes only owned noncanonical duplicates on an OPEN refusal', () => {
        const { port, calls, state } = fakePort({
            heads: [head, movedHead],
            foreignLowerCommentBeforeConvergence: true,
        });
        expect(() => run(port)).toThrow(/head moved/i);
        expect(state().state).toBe('OPEN');
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_post_1', 'delete:IC_post_2']);
        expect(state().comments.map((comment) => comment.id)).toEqual([
            oldComment.id,
            'IC_foreign',
            'IC_foreign_lineage',
        ]);
        expect(calls.filter((call) => call.startsWith('close:') || call.startsWith('log:'))).toEqual([]);
    });
    it('posts only the missing lineage marker when a crash left the receipt behind', () => {
        const { port, calls, authorNodeId } = fakePort({ existingCommentCount: 1 });
        expect(run(port, repairedLineage, authorNodeId)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('comment:'))).toEqual([`comment:2244:${lineageBody}`]);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it('converges multiple existing supersession comments to the smallest fullDatabaseId before closing', () => {
        const { port, calls, authorNodeId } = fakePort({ existingCommentCount: 2 });
        expect(run(port, repairedLineage, authorNodeId)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_seed_receipt_1']);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it('converges duplicate lineage markers to the smallest fullDatabaseId before closing', () => {
        const { port, calls, authorNodeId } = fakePort({ existingCommentCount: 1, existingLineageCount: 2 });
        expect(run(port, repairedLineage, authorNodeId)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_seed_lineage_1']);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it('converges an interleaved concurrent supersession comment before closing', () => {
        const { port, calls, authorNodeId, state } = fakePort({ concurrentCommentBeforeConvergence: true });
        expect(run(port, repairedLineage, authorNodeId)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_concurrent']);
        expect(state().comments.filter((comment) => comment.body === receiptBody)).toEqual([
            expect.objectContaining({ id: 'IC_post_1' }),
        ]);
    });
    it.each(['fresh', 'completed replay'])(
        'holds the serialized owner through every parent and child proof on %s supersession',
        async (mode) => {
            await withLockRoot(async (root) => {
                const input: Input = {
                    bases: [parentBranch],
                    observeOperation: (operation) => {
                        const owner = readPullRequestMutationLockOid(
                            root,
                            pullRequestMutationLockRef(oldNumber),
                            oldNumber
                        );
                        if (operation.startsWith('log:')) {
                            expect(owner).toBeUndefined();
                        } else {
                            expect(owner).toBeDefined();
                        }
                    },
                };
                if (mode === 'completed replay') {
                    input.initialState = 'CLOSED';
                    input.existingCommentCount = 1;
                    input.existingLineageCount = 1;
                }
                const { port, calls, state } = fakePort(input);
                const originalInspect = port.inspect;
                let competingCheck: Promise<void> | undefined;
                port.inspect = (number) => {
                    if (number === parentNumber && competingCheck === undefined) {
                        const beforeCompeting = [...calls];
                        competingCheck = expect(
                            runSerialized(root, port, repairedLineage, serializeFixture, parentNumber)
                        ).rejects.toThrow(/already being delivered/i);
                        expect(calls).toEqual(beforeCompeting);
                    }
                    return originalInspect(number);
                };

                await expect(runSerialized(root, port, repairedLineage, serializeFixture, parentNumber)).resolves.toBe(
                    'pull-request-superseded:2244:2246'
                );
                expect(competingCheck).toBeDefined();
                await competingCheck;
                expect(calls.filter((call) => call === `inspect:${parentNumber}`)).toHaveLength(
                    mode === 'fresh' ? 4 : 1
                );
                expect(calls.filter((call) => call === `threads:${parentNumber}`)).toHaveLength(
                    mode === 'fresh' ? 4 : 1
                );
                expect(state().state).toBe('CLOSED');
                expect(calls.filter((call) => /^(?:comment|close):/.test(call))).toHaveLength(mode === 'fresh' ? 3 : 0);
                expect(calls.at(-1)).toBe('log:pull-request-superseded:2244:2246');
                expect(
                    readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
                ).toBeUndefined();
            });
        }
    );
    it.each(['before close', 'after close'])(
        'keeps parent-proof refusal compensation under the serialized owner %s',
        async (stage) => {
            await withLockRoot(async (root) => {
                const input: Input = {
                    bases: [parentBranch],
                    observeOperation: () => {
                        expect(
                            readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
                        ).toBeDefined();
                    },
                };
                if (stage === 'before close') {
                    input.parentCommentsByInspection = [validParentComments, validParentComments, []];
                } else {
                    input.removeParentReceiptDuringClose = true;
                }
                const { port, calls, state } = fakePort(input);

                const failure = runSerialized(root, port, repairedLineage, serializeFixture, parentNumber);
                await expect(failure).rejects.toThrow(/parent.*exactly one supersession receipt/i);
                expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
                if (stage === 'before close') {
                    expect(state()).toMatchObject({ state: 'OPEN', comments: [oldComment] });
                    expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([
                        'delete:IC_post_1',
                        'delete:IC_post_2',
                    ]);
                    expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
                    expect(
                        readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
                    ).toBeUndefined();
                } else {
                    expect(state().state).toBe('CLOSED');
                    expect(state().comments.map((comment) => comment.body)).toEqual([
                        oldComment.body,
                        receiptBody,
                        lineageBody,
                    ]);
                    expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
                    const owner = retainedOwner(root);
                    await expect(failure).rejects.toThrow(`pnpm deliver --recover-lock ${oldNumber} --owner ${owner}`);
                }
            });
        }
    );
    it('blocks a concurrent native closer during compensation, then lets its later invocation keep both proofs', async () => {
        await withLockRoot(async (root) => {
            const { port, calls, state } = fakePort({ heads: [head, movedHead] });
            const events: string[] = [];
            const serializeObserved: PullRequestMutationSerialization = (directory, number, operation) =>
                serializeFixture(directory, number, (boundary) =>
                    operation({
                        ...boundary,
                        get ownerOid() {
                            return boundary.ownerOid;
                        },
                        markRemoteMutationAttempt: () => {
                            events.push('boundary');
                            boundary.markRemoteMutationAttempt();
                        },
                    })
                );
            const originalComment = port.comment;
            port.comment = (number, body) => {
                events.push('comment');
                return originalComment(number, body);
            };
            const originalDelete = port.deleteComment;
            port.deleteComment = (id) => {
                events.push('delete');
                originalDelete(id);
            };
            const originalClose = port.close;
            port.close = (number) => {
                events.push('close');
                return originalClose(number);
            };
            const originalInspect = port.inspect;
            let oldInspections = 0;
            let competingCheck: Promise<void> | undefined;
            port.inspect = (number) => {
                const snapshot = originalInspect(number);
                if (number === oldNumber && oldInspections++ === 2) {
                    expect(snapshot.state).toBe('OPEN');
                    const beforeCompeting = [...calls];
                    competingCheck = expect(
                        runSerialized(root, port, repairedLineage, serializeObserved)
                    ).rejects.toThrow(/already being delivered/i);
                    expect(calls).toEqual(beforeCompeting);
                }
                return snapshot;
            };

            await expect(runSerialized(root, port, repairedLineage, serializeObserved)).rejects.toThrow(/head moved/i);
            expect(competingCheck).toBeDefined();
            if (competingCheck === undefined) {
                throw new Error('the competitor never attempted the compensation window');
            }
            await competingCheck;
            expect(state()).toMatchObject({ state: 'OPEN', comments: [oldComment] });
            expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
            expect(
                readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
            ).toBeUndefined();

            await expect(runSerialized(root, port, repairedLineage, serializeObserved)).resolves.toBe(
                'pull-request-superseded:2244:2246'
            );
            expect(state().state).toBe('CLOSED');
            expect(state().comments.map((comment) => comment.body)).toEqual([
                oldComment.body,
                receiptBody,
                lineageBody,
            ]);
            expect(state().comments.map((comment) => comment.id)).toEqual([oldComment.id, 'IC_post_3', 'IC_post_4']);
            expect(calls.filter((call) => call.startsWith('log:'))).toEqual(['log:pull-request-superseded:2244:2246']);
            expect(events).toEqual([
                'boundary',
                'comment',
                'boundary',
                'comment',
                'boundary',
                'delete',
                'boundary',
                'delete',
                'boundary',
                'comment',
                'boundary',
                'comment',
                'boundary',
                'close',
            ]);
        });
    });
    it("deletes only this invocation's noncanonical markers when another invocation closes first", () => {
        const { port, calls, authorNodeId, state } = fakePort({
            foreignLowerCommentBeforeConvergence: true,
            closeBeforeConvergence: true,
        });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/changed after supersession/i);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_post_1', 'delete:IC_post_2']);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
        expect(state().comments.map((comment) => comment.id)).toEqual([
            oldComment.id,
            'IC_foreign',
            'IC_foreign_lineage',
        ]);
    });
    it('returns completed supersession success without mutation only for one marker of each kind', () => {
        const { port, calls, authorNodeId } = fakePort({
            initialState: 'CLOSED',
            existingCommentCount: 1,
            existingLineageCount: 1,
        });
        expect(run(port, repairedLineage, authorNodeId)).toBe('pull-request-superseded:2244:2246');
        expect(calls).toEqual([
            'threads:2244',
            'inspect:2244',
            'inspect:2246',
            'log:pull-request-superseded:2244:2246',
        ]);
    });
    it('fails closed for a completed supersession with multiple markers', () => {
        const { port, calls, authorNodeId } = fakePort({
            initialState: 'CLOSED',
            existingCommentCount: 2,
            existingLineageCount: 1,
        });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/exactly one/i);
        expect(calls.filter((call) => !call.startsWith('inspect') && !call.startsWith('threads:'))).toEqual([]);
    });
    it('rejects a User-typed existing supersession comment before any mutation', () => {
        const { port, calls, authorNodeId } = fakePort({
            existingCommentCount: 1,
            existingCommentAuthorType: 'User',
        });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/exact author-bot/i);
        expect(calls.filter((call) => !call.startsWith('inspect') && !call.startsWith('threads:'))).toEqual([]);
    });
    it('surfaces failure to delete an owned noncanonical marker', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            heads: [head, movedHead],
            foreignLowerCommentBeforeConvergence: true,
            failDelete: true,
        });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(
            /head moved[\s\S]*compensation failed[\s\S]*delete denied/i
        );
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_post_1', 'delete:IC_post_2']);
        expect(state().comments.map((comment) => comment.id)).toEqual([
            oldComment.id,
            'IC_post_1',
            'IC_post_2',
            'IC_foreign',
            'IC_foreign_lineage',
        ]);
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
    });
    it('releases a read-only refusal without claiming a completed supersession', async () => {
        await withLockRoot(async (root) => {
            const refused = fakePort({ replacementState: 'OPEN' });
            await expect(runSerialized(root, refused.port)).rejects.toThrow(/replacement.*merged/i);
            expect(refused.calls.filter((call) => /^(comment|delete|close|log):/.test(call))).toEqual([]);
            expect(
                readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
            ).toBeUndefined();
            await expect(runSerialized(root, fakePort().port)).resolves.toBe('pull-request-superseded:2244:2246');
        });
    });
    it('retains the owner when acknowledged created markers are omitted from rollback observations', async () => {
        await withLockRoot(async (root) => {
            const { port, calls, state } = fakePort();
            const inspect = port.inspect;
            port.inspect = (number) => {
                const snapshot = inspect(number);
                return number === oldNumber ? { ...snapshot, comments: [oldComment] } : snapshot;
            };
            const failure = runSerialized(root, port);

            await expect(failure).rejects.toThrow(/preserved lock owner/u);
            expect(state()).toMatchObject({ state: 'OPEN' });
            expect(state().comments).toHaveLength(3);
            expect(calls.filter((call) => call.startsWith('delete:') || call.startsWith('close:'))).toEqual([]);
            const oid = retainedOwner(root);
            expect(readPullRequestMutationLockOwner(root, oid, oldNumber)).toMatchObject({
                version: 4,
                operation: 'delivery',
                mutation: { phase: 'remote-mutation-attempted' },
            });
            await expect(failure).rejects.toThrow(`pnpm deliver --recover-lock ${oldNumber} --owner ${oid}`);
        });
    });
    it('does not log success when the actual lock release loses ownership', async () => {
        await withLockRoot(async (root) => {
            const { port, calls, state } = fakePort();
            const originalClose = port.close;
            port.close = (number) => {
                const result = originalClose(number);
                execFileSync('git', ['update-ref', '-d', pullRequestMutationLockRef(oldNumber), retainedOwner(root)], {
                    cwd: root,
                });
                return result;
            };
            await expect(runSerialized(root, port)).rejects.toThrow(/ownership changed before release/i);
            expect(state().state).toBe('CLOSED');
            expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
        });
    });
    it('keeps the shared lock scoped to one pull request', async () => {
        await withLockRoot(async (root) => {
            await serializeFixture(root, oldNumber, async () => {
                const second = fakePort();
                const secondNumber = oldNumber + 1;
                const originalInspect = second.port.inspect;
                second.port.inspect = (number) => {
                    if (number === secondNumber) {
                        return { ...originalInspect(oldNumber), number };
                    }
                    return originalInspect(number);
                };
                const originalThreads = second.port.inspectReviewThreads;
                second.port.inspectReviewThreads = (number) =>
                    originalThreads(number === secondNumber ? oldNumber : number);
                await expect(
                    runSerialized(root, second.port, { ...repairedLineage, oldPr: secondNumber })
                ).resolves.toBe('pull-request-superseded:2245:2246');
                expect(second.state().state).toBe('CLOSED');
                expect(
                    readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
                ).toBeDefined();
            });
            expect(
                readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
            ).toBeUndefined();
        });
    });
    it.each([
        { label: 'an ambiguous comment', input: { throwAfterComment: true }, message: /comment transport lost/i },
        { label: 'an attempted close', input: { throwCloseOnceWithoutState: true }, message: /close transport lost/i },
        { label: 'failed rollback', input: { heads: [head, movedHead], failDelete: true }, message: /delete denied/i },
        {
            label: 'an altered marker',
            input: { heads: [head, movedHead], editCommentAfterComment: true },
            message: /no longer exact/i,
        },
    ])('retains the journal and recovery instructions after $label', async ({ input, message }) => {
        await withLockRoot(async (root) => {
            const { port, calls } = fakePort(input);
            const failure = runSerialized(root, port);
            await expect(failure).rejects.toThrow(message);
            const ownerOid = retainedOwner(root);
            expect(readPullRequestMutationLockOwner(root, ownerOid, oldNumber)).toMatchObject({
                version: 4,
                operation: 'delivery',
                mutation: { phase: 'remote-mutation-attempted' },
            });
            await expect(failure).rejects.toThrow(`pnpm deliver --recover-lock ${oldNumber} --owner ${ownerOid}`);
            expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
            const beforeRetry = [...calls];
            await expect(runSerialized(root, port)).rejects.toThrow(/already being delivered/i);
            expect(calls).toEqual(beforeRetry);
            expect(retainedOwner(root)).toBe(ownerOid);
        });
    });
    it('retains the journal when rollback cannot be verified', async () => {
        await withLockRoot(async (root) => {
            const { port, calls, state } = fakePort({ heads: [head, movedHead] });
            const originalInspect = port.inspect;
            let oldInspections = 0;
            port.inspect = (number) => {
                if (number === oldNumber && oldInspections++ === 3) {
                    throw new Error('compensation verification unavailable');
                }
                return originalInspect(number);
            };
            await expect(runSerialized(root, port)).rejects.toThrow(/compensation verification unavailable/i);
            expect(state()).toMatchObject({ state: 'OPEN', comments: [oldComment] });
            expect(retainedOwner(root)).toBeDefined();
            expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
        });
    });
    it.each([
        { label: 'OPEN', input: { throwCloseOnceWithoutState: true } },
        { label: 'CLOSED', input: { changedClosedAtAfterClose: true } },
    ])('reuses native deliver recovery for a stable $label unmerged pull request', async ({ label, input }) => {
        await withLockRoot(async (root) => {
            const { port, calls, state } = fakePort(input);
            await expect(runSerialized(root, port)).rejects.toThrow(/preserved lock owner/i);
            expect(state().state).toBe(label);
            const ownerOid = retainedOwner(root);
            let reads = 0;
            await expect(
                runDeliverCli(['--recover-lock', String(oldNumber), '--owner', ownerOid], {
                    recovery: {
                        trustedLauncher: { primaryRoot: root, gitPath: 'git', ghPath: 'gh' },
                        authenticateAuthor: async () => ({
                            minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                            session: { configDir: root, env: {}, dispose: () => undefined },
                        }),
                        repositoryName: () => 'jcosta33/sourdaw',
                        ownerFenceIsLive: () => false,
                        currentOwnerFence: () => ({
                            kind: 'pid',
                            pid: process.pid,
                            startedAt: 'recovery-fixture-process',
                        }),
                        readJournaledRemoteState: () => {
                            reads += 1;
                            return { state: state().state.toLowerCase(), head, merged: false, receipts: [] };
                        },
                    },
                })
            ).resolves.toBe(0);
            expect(reads).toBe(2);
            expect(
                readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
            ).toBeUndefined();
            expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
            await expect(runSerialized(root, port)).resolves.toBe('pull-request-superseded:2244:2246');
            expect(state().state).toBe('CLOSED');
            expect(calls.filter((call) => call.startsWith('comment:'))).toHaveLength(2);
            expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        });
    });
});
