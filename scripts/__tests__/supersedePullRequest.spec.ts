import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseFindingLineage, renderFindingLineage, type FindingLineage } from '../findingLineage.ts';
import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import { supersessionCommentBody } from '../prContract.ts';
import {
    parseSupersedePullRequestArgs,
    readFindingLineageFile,
    supersedePullRequest,
} from '../supersedePullRequest.ts';
import {
    commentClientMutationId,
    deleteComment,
    inspectIssueComments,
    inspectPullRequest,
    inspectReviewThreads,
    inspectCommitAncestry,
    type IssueComment,
    type SupersedePullRequestPort,
    type SupersededReviewThread,
    type SupersededPullRequest,
} from '../supersedePullRequestGh.ts';

const oldNumber = 2244;
const parentNumber = 2245;
const parentReplacementNumber = 2247;
const replacementNumber = 2246;
const head = 'a'.repeat(40);
const movedHead = 'b'.repeat(40);
const parentHead = 'd'.repeat(40);
const replacementHead = 'c'.repeat(40);
const parentMerge = 'e'.repeat(40);
const childMerge = 'f'.repeat(40);
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
    heads?: string[];
    authorNodeId?: string;
    replacementState?: string;
    replacementStates?: string[];
    replacementBases?: string[];
    replacementHeadRepository?: string | null;
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
};

function fakePort(input: Input = {}) {
    const calls: string[] = [];
    let index = 0;
    let state = input.initialState ?? 'OPEN';
    let closeCalled = false;
    let closeFailures = 0;
    let commentCalled = false;
    let concurrentCommentAdded = false;
    let closedAt: string | null = null;
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
            return {
                number,
                state,
                head: input.heads?.[inspection] ?? head,
                headRefName: 'fix/old-pull-request',
                headRepository: 'jcosta33/sourdaw',
                repository: 'jcosta33/sourdaw',
                base: input.bases?.[inspection] ?? 'main',
                merged: false,
                closedAt,
                comments,
            };
        }
        if (number === parentNumber) {
            const inspection = parentInspections++;
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
        inspect: (number) => {
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
            calls.push(`delete:${id}`);
            if (input.failDelete) {
                throw new Error('delete denied');
            }
            comments = comments.filter((comment) => comment.id !== id);
        },
        log: (message) => calls.push(`log:${message}`),
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

const distinctParentLineage: FindingLineage = { ...parentLineage, replacementPr: parentReplacementNumber };
const distinctParentComments = [
    markerComment('IC_parent_receipt', String(databaseBase + 20n), supersessionCommentBody(parentReplacementNumber)),
    markerComment('IC_parent_lineage', String(databaseBase + 21n), renderFindingLineage(distinctParentLineage)),
];

function distinctPort(
    input: Input = {},
    changes: {
        snapshots?: Partial<Record<number, Partial<SupersededPullRequest>[]>>;
        ancestry?: (boolean | Error)[];
    } = {}
) {
    const fixture = fakePort({
        bases: Array.from({ length: 8 }, () => parentBranch),
        parentComments: distinctParentComments,
        ...input,
    });
    const reads = new Map<number, number>();
    let ancestryReads = 0;
    const port: SupersedePullRequestPort = {
        ...fixture.port,
        inspect: (number) => {
            const read = reads.get(number) ?? 0;
            reads.set(number, read + 1);
            let value: SupersededPullRequest;
            if (number === parentReplacementNumber) {
                fixture.calls.push(`inspect:${number}`);
                value = {
                    number,
                    repository: 'jcosta33/sourdaw',
                    state: 'MERGED',
                    merged: true,
                    head: '1'.repeat(40),
                    headRefName: 'fix/parent-replacement',
                    headRepository: null,
                    base: 'main',
                    mergeCommit: parentMerge,
                    closedAt: '2026-08-19T11:00:00Z',
                    comments: [],
                };
            } else {
                value = {
                    ...fixture.port.inspect(number),
                    mergeCommit: number === replacementNumber ? childMerge : null,
                };
            }
            return { ...value, ...changes.snapshots?.[number]?.[read] };
        },
        isAncestor: (repository, ancestor, descendant) => {
            fixture.calls.push(`ancestor:${repository}:${ancestor}:${descendant}`);
            const result = changes.ancestry?.[ancestryReads++] ?? true;
            if (result instanceof Error) {
                throw result;
            }
            return result;
        },
    };
    return { ...fixture, port };
}

const runWithDistinctParent = (port: SupersedePullRequestPort) =>
    supersedePullRequest(
        oldNumber,
        head,
        replacementNumber,
        repairedLineage,
        AUTHOR_BOT_NODE_ID,
        port,
        parentNumber,
        parentReplacementNumber
    );

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
    it.each([null, undefined, { oid: childMerge }])(
        'reads optional merge commit %j without a replacement branch liveness check',
        (mergeCommit) => {
            const calls: string[][] = [];
            const value = inspectPullRequest(
                replacementNumber,
                (args) => {
                    calls.push(args);
                    if (args.includes(`number=${replacementNumber}`)) {
                        return JSON.stringify({
                            data: {
                                repository: {
                                    nameWithOwner: 'jcosta33/sourdaw',
                                    pullRequest: {
                                        id: 'PR_replacement',
                                        number: replacementNumber,
                                        state: 'MERGED',
                                        merged: true,
                                        headRefOid: replacementHead,
                                        headRefName: 'fix/deleted',
                                        headRepository: null,
                                        baseRefName: 'main',
                                        closedAt: '2026-08-20T12:00:00Z',
                                        mergeCommit,
                                    },
                                },
                            },
                        });
                    }
                    return JSON.stringify({
                        data: {
                            node: {
                                id: 'PR_replacement',
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
            expect(value.mergeCommit).toBe(mergeCommit?.oid ?? null);
            expect(value.headRepository).toBeNull();
            expect(calls).toHaveLength(2);
        }
    );
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

    it('accepts an explicitly named distinct parent replacement', () => {
        expect(
            parseSupersedePullRequestArgs([
                '2244',
                '--head',
                head,
                '--replacement',
                '2246',
                '--superseded-parent',
                '2245',
                '--parent-replacement',
                '2247',
                '--lineage',
                '/tmp/lineage.json',
            ])
        ).toMatchObject({
            oldNumber: 2244,
            replacementNumber: 2246,
            supersededParentNumber: 2245,
            parentReplacementNumber: 2247,
        });
    });

    it.each(['2244', '2245', '2246', '0', 'NaN', '9007199254740992'])(
        'refuses an invalid distinct parent replacement identity %s',
        (identity) => {
            expect(() =>
                parseSupersedePullRequestArgs([
                    '2244',
                    '--head',
                    head,
                    '--replacement',
                    '2246',
                    '--superseded-parent',
                    '2245',
                    '--parent-replacement',
                    identity,
                    '--lineage',
                    '/tmp/lineage.json',
                ])
            ).toThrow(/usage/i);
        }
    );
    it('does not admit a parent replacement without an explicit parent', () => {
        expect(() =>
            parseSupersedePullRequestArgs([
                '2244',
                '--head',
                head,
                '--replacement',
                '2246',
                '--parent-replacement',
                '2247',
                '--lineage',
                '/tmp/lineage.json',
            ])
        ).toThrow(/usage/i);
        const { port, calls } = fakePort();
        expect(() => runWithDistinctParent(port)).toThrow(/requires a cross-base/i);
        expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
    });

    it('binds remote ancestry to repository, ordered full commit objects and merge base', () => {
        const calls: string[][] = [];
        expect(
            inspectCommitAncestry('jcosta33/sourdaw', parentMerge, replacementHead, (args) => {
                calls.push(args);
                return JSON.stringify({
                    url: `https://api.github.com/repos/jcosta33/sourdaw/compare/${parentMerge}...${replacementHead}`,
                    base_commit: { sha: parentMerge },
                    merge_base_commit: { sha: parentMerge },
                    status: 'ahead',
                    ahead_by: 3,
                    behind_by: 0,
                });
            })
        ).toBe(true);
        expect(calls).toEqual([['api', `repos/jcosta33/sourdaw/compare/${parentMerge}...${replacementHead}`]]);
    });
    it.each([
        ['reversed', 'behind', replacementHead, 0, 3],
        ['unrelated', 'diverged', movedHead, 3, 2],
    ])('does not treat %s ancestry as containment', (_case, status, mergeBase, aheadBy, behindBy) => {
        expect(
            inspectCommitAncestry('jcosta33/sourdaw', parentMerge, replacementHead, () =>
                JSON.stringify({
                    url: `https://api.github.com/repos/jcosta33/sourdaw/compare/${parentMerge}...${replacementHead}`,
                    base_commit: { sha: parentMerge },
                    merge_base_commit: { sha: mergeBase },
                    status,
                    ahead_by: aheadBy,
                    behind_by: behindBy,
                })
            )
        ).toBe(false);
    });
    it.each([
        ['status-only', { status: 'ahead' }],
        [
            'wrong repository',
            { url: `https://api.github.com/repos/fork/sourdaw/compare/${parentMerge}...${replacementHead}` },
        ],
        [
            'wrong descendant',
            { url: `https://api.github.com/repos/jcosta33/sourdaw/compare/${parentMerge}...${movedHead}` },
        ],
        ['wrong base object', { base_commit: { sha: movedHead } }],
        ['missing merge base', { merge_base_commit: null }],
        ['malformed merge base', { merge_base_commit: { sha: 'main' } }],
        ['ahead but unrelated', { merge_base_commit: { sha: movedHead } }],
        ['unknown status', { status: 'unknown' }],
        ['missing counts', { ahead_by: null }],
        ['contradictory counts', { behind_by: 1 }],
    ])('fails closed on %s ancestry evidence', (label, patch) => {
        let response: unknown = patch;
        if (label !== 'status-only') {
            response = {
                url: `https://api.github.com/repos/jcosta33/sourdaw/compare/${parentMerge}...${replacementHead}`,
                base_commit: { sha: parentMerge },
                merge_base_commit: { sha: parentMerge },
                status: 'ahead',
                ahead_by: 3,
                behind_by: 0,
                ...patch,
            };
        }
        expect(() =>
            inspectCommitAncestry('jcosta33/sourdaw', parentMerge, replacementHead, () => JSON.stringify(response))
        ).toThrow(/ancestry/i);
    });
    it.each([
        ['fork/sourdaw', parentMerge, replacementHead],
        ['jcosta33/sourdaw', 'main', replacementHead],
        ['jcosta33/sourdaw', parentMerge, 'main'],
    ])('rejects nonimmutable ancestry inputs without querying %s %s %s', (repository, ancestor, descendant) => {
        const calls: string[][] = [];
        expect(() =>
            inspectCommitAncestry(repository, ancestor, descendant, (args) => {
                calls.push(args);
                return '';
            })
        ).toThrow(/full commit SHAs/i);
        expect(calls).toEqual([]);
    });
    it('refuses unavailable and malformed remote ancestry instead of substituting branch status', () => {
        expect(() =>
            inspectCommitAncestry('jcosta33/sourdaw', parentMerge, replacementHead, () => {
                throw new Error('HTTP 404');
            })
        ).toThrow('HTTP 404');
        expect(() =>
            inspectCommitAncestry('jcosta33/sourdaw', parentMerge, replacementHead, () => 'not json')
        ).toThrow();
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
    it('closes a distinct dependency chain only after proving the parent merge in the child source head', () => {
        const { port, calls, state } = distinctPort();
        expect(runWithDistinctParent(port)).toBe('pull-request-superseded:2244:2246');
        const ancestry = `ancestor:jcosta33/sourdaw:${parentMerge}:${replacementHead}`;
        expect(calls.filter((call) => call.startsWith('ancestor:'))).toEqual(Array(4).fill(ancestry));
        expect(calls.indexOf(ancestry)).toBeLessThan(calls.findIndex((call) => call.startsWith('comment:')));
        expect(state().comments.map((comment) => comment.body)).toEqual([oldComment.body, receiptBody, lineageBody]);
        expect(state().state).toBe('CLOSED');
        const writes = calls.filter((call) => /^(?:comment|close|delete):/.test(call));
        expect(runWithDistinctParent(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual(writes);
    });

    it('never infers the distinct replacement from the parent receipt', () => {
        const { port, calls } = distinctPort();
        expect(() => runWithParent(port)).toThrow(/does not name replacement PR #2246/i);
        expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
    });

    it('reports ambiguity when the closed child head moves, retaining both markers', () => {
        const { port, calls, state } = distinctPort(
            {},
            {
                snapshots: { [oldNumber]: [{}, {}, {}, {}, {}, { head: movedHead }] },
            }
        );
        expect(() => runWithDistinctParent(port)).toThrow(/ambiguous/i);
        expect(state().state).toBe('CLOSED');
        expect(state().comments.map((comment) => comment.body)).toEqual([oldComment.body, receiptBody, lineageBody]);
        expect(calls.filter((call) => /^(?:delete|log):/.test(call))).toEqual([]);
    });

    it.each([
        ['parent has another identity', parentNumber, { number: 9999 }, /required repository/i],
        ['parent owns another branch', parentNumber, { headRefName: 'fix/unrelated' }, /does not own old base/i],
        ['parent is forked', parentNumber, { headRepository: 'fork/sourdaw' }, /head repository/i],
        ['parent is open', parentNumber, { state: 'OPEN' }, /not closed without merge/i],
        ['parent was merged', parentNumber, { merged: true }, /not closed without merge/i],
        ['parent targets another base', parentNumber, { base: 'release' }, /does not target replacement base/i],
        ['parent replacement is another PR', parentReplacementNumber, { number: 9999 }, /required repository/i],
        [
            'parent replacement is foreign',
            parentReplacementNumber,
            { repository: 'fork/sourdaw' },
            /required repository/i,
        ],
        ['parent replacement is not merged', parentReplacementNumber, { state: 'OPEN' }, /not merged/i],
        ['parent replacement denies merge', parentReplacementNumber, { merged: false }, /both be merged into main/i],
        [
            'parent replacement has another base',
            parentReplacementNumber,
            { base: 'release' },
            /both be merged into main/i,
        ],
        ['parent replacement merge is absent', parentReplacementNumber, { mergeCommit: null }, /full commit SHA/i],
        ['parent replacement merge is malformed', parentReplacementNumber, { mergeCommit: 'main' }, /full commit SHA/i],
        ['child replacement merge is absent', replacementNumber, { mergeCommit: null }, /full commit SHA/i],
        ['child source head is malformed', replacementNumber, { head: 'main' }, /full commit SHA/i],
        [
            'parent receipt names the child replacement',
            parentNumber,
            { comments: validParentComments },
            /does not name replacement PR #2247/i,
        ],
        [
            'parent receipt is foreign',
            parentNumber,
            {
                comments: [
                    { ...distinctParentComments[0]!, authorNodeId: REVIEWER_BOT_NODE_ID },
                    distinctParentComments[1]!,
                ],
            },
            /exact author-bot marker/i,
        ],
        [
            'parent receipt is duplicated',
            parentNumber,
            { comments: [...distinctParentComments, { ...distinctParentComments[0]!, id: 'duplicate' }] },
            /exactly one supersession receipt/i,
        ],
        [
            'parent lineage names another parent',
            parentNumber,
            {
                comments: [
                    distinctParentComments[0]!,
                    {
                        ...distinctParentComments[1]!,
                        body: renderFindingLineage({ ...distinctParentLineage, oldPr: 9999 }),
                    },
                ],
            },
            /does not match old pull request/i,
        ],
        [
            'parent lineage names another replacement',
            parentNumber,
            { comments: [distinctParentComments[0]!, { ...distinctParentComments[1]!, body: parentLineageBody }] },
            /does not match replacement pull request/i,
        ],
    ] satisfies [string, number, Partial<SupersededPullRequest>, RegExp][])(
        'refuses distinct proof when %s before any child write',
        (_case, number, patch, error) => {
            const { port, calls } = distinctPort({}, { snapshots: { [number]: [patch] } });
            expect(() => runWithDistinctParent(port)).toThrow(error);
            expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
        }
    );

    it('requires total live parent finding coverage for the distinct parent replacement', () => {
        const { port, calls } = distinctPort({ parentThreads: [{ threadId: 'PRRT_parent', rootCommentId: '3001' }] });
        expect(() => runWithDistinctParent(port)).toThrow(/has no entry for finding 3001/i);
        expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
    });
    it.each(['old child', 'old parent'])(
        'revalidates the %s finding set before writing, before close and after close',
        (subject) => {
            const number = subject === 'old child' ? oldNumber : parentNumber;
            for (const boundary of [1, 2, 3]) {
                const { port, calls, state } = distinctPort();
                const baseRead = port.inspectReviewThreads;
                let reads = 0;
                port.inspectReviewThreads = (pr) => {
                    const findings = baseRead(pr);
                    if (pr === number && reads++ === boundary) {
                        return [...findings, { threadId: 'PRRT_added', rootCommentId: '9001' }];
                    }
                    return findings;
                };
                expect(() => runWithDistinctParent(port)).toThrow(boundary === 3 ? /ambiguous/i : /finding/i);
                expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
                if (boundary === 1) {
                    expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
                } else if (boundary === 2) {
                    expect(state().comments).toEqual([oldComment]);
                    expect(state().state).toBe('OPEN');
                } else {
                    expect(state().state).toBe('CLOSED');
                    expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
                }
            }
        }
    );

    it.each([false, new Error('comparison unavailable')])(
        'refuses absent or unrelated ancestry %s before writes',
        (result) => {
            const { port, calls } = distinctPort({}, { ancestry: [result] });
            expect(() => runWithDistinctParent(port)).toThrow(
                result instanceof Error ? /comparison unavailable/ : /not proven/
            );
            expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
        }
    );

    it('fails closed without an ancestry reader', () => {
        const { port, calls } = distinctPort();
        const { isAncestor: _isAncestor, ...withoutAncestry } = port;
        expect(() => runWithDistinctParent(withoutAncestry)).toThrow(/not proven/i);
        expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
    });

    it.each([
        ['old child identity', oldNumber, { headRefName: 'fix/moved' }],
        ['child replacement source', replacementNumber, { head: movedHead }],
        ['child replacement merge', replacementNumber, { mergeCommit: movedHead }],
        ['old parent identity', parentNumber, { head: movedHead }],
        ['parent replacement source', parentReplacementNumber, { head: movedHead }],
        ['parent replacement merge', parentReplacementNumber, { mergeCommit: movedHead }],
        ['parent replacement merge state', parentReplacementNumber, { state: 'OPEN' }],
        [
            'parent receipt identity',
            parentNumber,
            { comments: [{ ...distinctParentComments[0]!, id: 'IC_changed' }, distinctParentComments[1]!] },
        ],
        ['parent marker loss', parentNumber, { comments: [] }],
    ] satisfies [string, number, Partial<SupersededPullRequest>][])(
        'revalidates %s at every mutation boundary',
        (_case, number, patch) => {
            for (const boundary of ['before-write', 'before-close', 'after-close'] as const) {
                // Child reads include the two marker convergence inspections between write and close.
                let inspection = { 'before-write': 1, 'before-close': 2, 'after-close': 3 }[boundary];
                if (number === oldNumber) {
                    inspection = { 'before-write': 1, 'before-close': 4, 'after-close': 5 }[boundary];
                }
                const snapshots = Array.from({ length: inspection + 1 }, (_, index) =>
                    index === inspection ? patch : {}
                );
                const { port, calls, state } = distinctPort({}, { snapshots: { [number]: snapshots } });
                expect(() => runWithDistinctParent(port), `${_case}: ${boundary}`).toThrow();
                expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
                if (boundary === 'before-write') {
                    expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
                } else if (boundary === 'before-close') {
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

    it.each([1, 2, 3])('revalidates ancestry at boundary %i', (inspection) => {
        const ancestry = Array.from({ length: inspection + 1 }, (_, index) => index !== inspection);
        const { port, calls, state } = distinctPort({}, { ancestry });
        expect(() => runWithDistinctParent(port)).toThrow(inspection === 3 ? /ambiguous/i : /not proven/i);
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
        if (inspection === 1) {
            expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
        } else if (inspection === 2) {
            expect(state().comments).toEqual([oldComment]);
            expect(state().state).toBe('OPEN');
        } else {
            expect(state().state).toBe('CLOSED');
            expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        }
    });
    it.each([null, 'fork-owner/sourdaw'])('does not require a %s replacement head repository', (headRepository) => {
        const { port, calls } = fakePort({ replacementHeadRepository: headRepository });
        expect(run(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it('keeps a historical same-replacement parent path without merge-commit or replacement-head liveness proof', () => {
        const { port, calls } = fakePort({
            bases: [parentBranch, parentBranch, parentBranch, parentBranch],
            replacementHeadRepository: null,
        });
        port.isAncestor = () => {
            throw new Error('legacy path must not request ancestry');
        };
        expect(runWithParent(port)).toBe('pull-request-superseded:2244:2246');
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
        expect(() => runWithParent(port)).toThrow(/proof changed during supersession/i);
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
        expect(state().comments.map((comment) => comment.id)).toEqual([oldComment.id]);
    });
    it('refuses a finding removed during the transaction before the close', () => {
        const { port, calls, authorNodeId, state } = fakePort({ threadsBeforeClose: [] });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(
            /finding set changed after finding lineage: added none, removed 1001/i
        );
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_post_1', 'delete:IC_post_2']);
        expect(state().comments.map((comment) => comment.id)).toEqual([oldComment.id]);
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
    it('rolls back both markers after a post-comment head move', () => {
        const { port, authorNodeId, state, calls } = fakePort({ heads: [head, movedHead] });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(/head moved/i);
        expect(state()).toMatchObject({ state: 'OPEN', comments: [oldComment] });
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_post_1', 'delete:IC_post_2']);
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
    it('surfaces compensation failure', () => {
        const { port, authorNodeId, state, calls } = fakePort({ heads: [head, movedHead], failDelete: true });
        expect(() => run(port, repairedLineage, authorNodeId)).toThrow(
            /head moved[\s\S]*compensation failed[\s\S]*delete denied/i
        );
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_post_1', 'delete:IC_post_2']);
        expect(state().comments.map((comment) => comment.id)).toEqual([oldComment.id, 'IC_post_1', 'IC_post_2']);
    });
});
