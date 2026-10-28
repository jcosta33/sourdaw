import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runDeliverCli } from '../deliverPullRequest.ts';
import { parseFindingLineage, renderFindingLineage, type FindingLineage } from '../findingLineage.ts';
import * as githubIdentity from '../githubAppIdentity.ts';
import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import { supersessionCommentBody } from '../prContract.ts';
import * as mutationOwnership from '../pullRequestMutationLock.ts';
import {
    isDeliveryPullRequestMutationLockOwner,
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockOwner,
    withPullRequestMutationLock,
    type PullRequestMutationSerialization,
} from '../pullRequestMutationLock.ts';
import { readRegisteredLaneStack, writeLaneStack, type LaneStack } from '../stackedLanes.ts';
import {
    parseSupersessionParentBinding,
    inspectNativeParentCompletion,
    parseSupersedePullRequestArgs,
    readFindingLineageFile,
    runSupersedePullRequestCli,
    serializedSupersedePullRequest,
    supersedePullRequest,
    type SupersessionParentBinding,
} from '../supersedePullRequest.ts';
import * as githubPort from '../supersedePullRequestGh.ts';
import {
    commentClientMutationId,
    deleteComment,
    inspectIssueComments,
    inspectPullRequest,
    inspectReviewThreads,
    inspectCommitAncestry,
    shellPort,
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

/** Real content history with the same replacement reused across a completed stack. */
function nestedNativeFixture(root: string, missingInnerDependency = false) {
    const dag = dependencyDag(root, false);
    const repository = 'jcosta33/sourdaw';
    const records = new Map<number, SupersededPullRequest>();
    const findings = new Map<number, SupersededReviewThread[]>();
    const events: string[] = [];
    let onEvent: (event: string) => void = () => undefined;
    let nextComment = 10_000;
    const content = {
        'base.txt': 'base',
        'original-dependency.txt': 'parent',
        'child.txt': 'library',
        'decode.txt': 'decode',
    };
    const oldHead = dag.commit('old decoder', [dag.oldChild], content);
    const source = dag.commit(
        'delivered decoder and library',
        [missingInnerDependency ? dag.base : dag.parentReplacementMerge],
        content
    );
    const merge = dag.commit('delivered decoder squash', [dag.parentReplacementMerge], content);
    const oldNumbers = [4000, 4001, 4002];
    let target = 4002;
    let replacement = 5001;
    let explicitParentReplacement: number | undefined;
    const add = (
        number: number,
        head: string,
        branch: string,
        base: string,
        baseHead: string,
        merged = false,
        mergeCommit: string | null = null
    ) => {
        const row: SupersededPullRequest = {
            number,
            head,
            headRefName: branch,
            headRepository: repository,
            repository,
            base,
            baseRefOid: baseHead,
            baseRef: { name: base, repository, target: baseHead },
            state: merged ? 'MERGED' : 'CLOSED',
            merged,
            mergeCommit,
            closedAt: '2026-10-24T00:00:00Z',
            comments: [],
        };
        records.set(number, row);
        return row;
    };
    const grand = add(4000, dag.originalParent, 'fix/nested-grand', 'main', dag.base);
    const parent = add(4001, dag.oldChild, 'fix/nested-parent', grand.headRefName, grand.head);
    const old = add(4002, oldHead, 'fix/nested-child', parent.headRefName, parent.head);
    old.state = 'OPEN';
    old.closedAt = null;
    const grandReplacement = add(
        5000,
        dag.parentReplacementHead,
        'fix/nested-grand-replacement',
        'main',
        dag.base,
        true,
        dag.parentReplacementMerge
    );
    const final = add(5001, source, 'fix/nested-replacement', 'main', dag.parentReplacementMerge, true, merge);
    const lineage = (oldPr: number, replacementPr: number): FindingLineage => ({
        format: 'lineage-v1',
        oldPr,
        replacementPr,
        entries: [],
    });
    const complete = (row: SupersededPullRequest, successor: number) => {
        row.comments = [
            markerComment(`IC_receipt_${row.number}`, String(row.number * 10), supersessionCommentBody(successor)),
            markerComment(
                `IC_lineage_${row.number}`,
                String(row.number * 10 + 1),
                renderFindingLineage(lineage(row.number, successor))
            ),
        ];
    };
    complete(grand, grandReplacement.number);
    complete(parent, final.number);
    const identity = (row: SupersededPullRequest) => ({
        number: row.number,
        head: row.head,
        branch: row.headRefName,
        base: row.base,
    });
    const replacementIdentity = (row: SupersededPullRequest) => {
        if (typeof row.mergeCommit !== 'string') {
            throw new TypeError('fixture replacement has no merge');
        }
        return { ...identity(row), mergeCommit: row.mergeCommit };
    };
    const initialBinding: SupersessionParentBinding = {
        format: 'supersession-parent-v1',
        repository,
        child: { ...identity(parent), cachedBase: grand.head, sourceRepository: repository },
        parent: identity(grand),
        replacement: replacementIdentity(final),
        parentReplacement: replacementIdentity(grandReplacement),
        provenance: { kind: 'final-parent-head', forkHead: grand.head, admittedParentHead: null },
    };
    parent.comments.push(markerComment('IC_binding_4001', '40012', bindingBody(initialBinding)));
    const row = (number: number) => {
        const value = records.get(number);
        if (value === undefined) {
            throw new Error(`missing fixture PR ${number}`);
        }
        return value;
    };
    const event = (value: string) => {
        events.push(value);
        onEvent(value);
    };
    const commentAt = (number: number, index: number): IssueComment => {
        const comment = row(number).comments[index];
        if (comment === undefined) {
            throw new Error(`missing fixture comment ${index} on PR ${number}`);
        }
        return comment;
    };
    const numberField = (args: string[], name: string) =>
        Number(args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1));
    const stringField = (args: string[], name: string) => {
        const field = args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
        if (field === undefined) {
            throw new Error(`missing fixture field ${name}`);
        }
        return field;
    };
    const comparisonCache = new Map<string, boolean>();
    const capture = (command: string, args: string[]) => {
        if (command === 'git') {
            return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
        }
        const endpoint = args[1] ?? '';
        const comparison = endpoint.match(/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/);
        if (comparison !== null) {
            const ancestor = comparison[1];
            const descendant = comparison[2];
            if (ancestor === undefined || descendant === undefined) {
                throw new TypeError('fixture comparison requires both commit identities');
            }
            const key = `${ancestor}:${descendant}`;
            let contained = comparisonCache.get(key);
            if (contained === undefined) {
                contained = dag.ancestor(ancestor, descendant);
                comparisonCache.set(key, contained);
            }
            const identical = ancestor === descendant;
            let status = 'diverged';
            if (identical) {
                status = 'identical';
            } else if (contained) {
                status = 'ahead';
            }
            const mergeBase = execFileSync('git', ['merge-base', ancestor, descendant], {
                cwd: root,
                encoding: 'utf8',
            }).trim();
            const output = JSON.stringify({
                url: `https://api.github.com/${endpoint}`,
                status,
                ahead_by: identical ? 0 : 1,
                behind_by: contained ? 0 : 1,
                total_commits: identical ? 0 : 1,
                base_commit: { sha: ancestor },
                merge_base_commit: { sha: mergeBase },
                commits: identical ? [] : [{ sha: descendant }],
            });
            event(`ancestor:${key}`);
            return output;
        }
        const query = stringField(args, 'query');
        if (query.includes('headRefOid')) {
            const value = row(numberField(args, 'number'));
            const ref = value.baseRef;
            let nativeRef:
                | {
                      name: string;
                      repository: { nameWithOwner: string };
                      target: { oid: string };
                  }
                | null
                | undefined;
            if (ref === null || ref === undefined) {
                nativeRef = ref;
            } else {
                nativeRef = {
                    name: ref.name,
                    repository: { nameWithOwner: ref.repository },
                    target: { oid: ref.target },
                };
            }
            const pullRequest = {
                id: `PR_${value.number}`,
                number: value.number,
                state: value.state,
                headRefOid: value.head,
                headRefName: value.headRefName,
                headRepository: value.headRepository === null ? null : { nameWithOwner: value.headRepository },
                baseRefName: value.base,
                baseRefOid: value.baseRefOid,
                merged: value.merged,
                closedAt: value.closedAt,
                mergeCommit: value.mergeCommit === null ? null : { oid: value.mergeCommit },
                baseRef: nativeRef,
            };
            const output = JSON.stringify({ data: { repository: { nameWithOwner: value.repository, pullRequest } } });
            event(`core:${value.number}`);
            return output;
        }
        if (query.includes('reviewThreads(first:100')) {
            const number = numberField(args, 'number');
            const output = JSON.stringify({
                data: {
                    repository: {
                        pullRequest: {
                            reviewThreads: {
                                nodes: (findings.get(number) ?? []).map((thread) => ({
                                    id: thread.threadId,
                                    comments: { nodes: [{ databaseId: Number(thread.rootCommentId) }] },
                                })),
                                pageInfo: { hasNextPage: false, endCursor: null },
                            },
                        },
                    },
                },
            });
            event(`threads:${number}`);
            return output;
        }
        if (query.includes('node(id:$subjectId)')) {
            const id = stringField(args, 'subjectId');
            const number = Number(id.slice(3));
            const output = JSON.stringify({
                data: {
                    node: {
                        id,
                        comments: {
                            nodes: row(number).comments.map((comment) => ({
                                ...comment,
                                author: {
                                    id: comment.authorNodeId,
                                    login: comment.authorLogin,
                                    __typename: comment.authorType,
                                },
                            })),
                            pageInfo: { hasNextPage: false, endCursor: null },
                        },
                    },
                },
            });
            event(`comments:${number}`);
            return output;
        }
        const clientMutationId = stringField(args, 'clientMutationId');
        if (query.includes('addComment(input:')) {
            const number = Number(stringField(args, 'subjectId').slice(3));
            nextComment += 1;
            const comment = markerComment(`IC_created_${nextComment}`, String(nextComment), stringField(args, 'body'));
            row(number).comments.push(comment);
            const output = JSON.stringify({
                data: {
                    addComment: {
                        clientMutationId,
                        commentEdge: {
                            node: {
                                ...comment,
                                author: { id: AUTHOR_BOT_NODE_ID, __typename: 'Bot', login: 'author[bot]' },
                            },
                        },
                    },
                },
            });
            event(`comment:${number}`);
            return output;
        }
        if (query.includes('closePullRequest(input:')) {
            const id = stringField(args, 'pullRequestId');
            const value = row(Number(id.slice(3)));
            value.state = 'CLOSED';
            value.closedAt = '2026-10-28T00:00:00Z';
            event(`close:${value.number}`);
            return JSON.stringify({
                data: {
                    closePullRequest: {
                        clientMutationId,
                        pullRequest: { id, state: value.state, closedAt: value.closedAt },
                    },
                },
            });
        }
        if (query.includes('deleteIssueComment(input:')) {
            const id = stringField(args, 'id');
            for (const value of records.values()) {
                value.comments = value.comments.filter((comment) => comment.id !== id);
            }
            event(`delete:${id}`);
            return JSON.stringify({ data: { deleteIssueComment: { clientMutationId } } });
        }
        throw new Error('unexpected nested native query');
    };
    const port: SupersedePullRequestPort = {
        ...shellPort({ configDir: root, env: {}, dispose: () => undefined }, root, capture),
        log: (message) => event(message),
    };
    const input = () => ({
        oldNumber: target,
        expectedHead: row(target).head,
        replacementNumber: replacement,
        supersededParentNumber: oldNumbers[oldNumbers.length - 2],
        parentReplacementNumber: explicitParentReplacement,
        lineage: lineage(target, replacement),
        authorNodeId: AUTHOR_BOT_NODE_ID,
        port,
    });
    return {
        port,
        row,
        commentAt,
        findings,
        events,
        initialBinding,
        dag,
        onEvent: (hook: (event: string) => void) => {
            onEvent = hook;
        },
        run: () => {
            const value = input();
            return supersedePullRequest(
                value.oldNumber,
                value.expectedHead,
                value.replacementNumber,
                value.lineage,
                value.authorNodeId,
                port,
                value.supersededParentNumber,
                value.parentReplacementNumber
            );
        },
        serialized: () => serializedSupersedePullRequest(root, input(), serializeFixture),
        writes: () => events.filter((value) => /^(?:comment|delete|close):/.test(value)),
        advance: (unrelated = false) => {
            const parent = row(target);
            target += 1;
            oldNumbers.push(target);
            const child = add(
                target,
                dag.commit('old resident aliases', [parent.head], { ...content, 'resident.txt': 'resident' }),
                'fix/nested-resident',
                parent.headRefName,
                parent.head
            );
            child.state = 'OPEN';
            child.closedAt = null;
            const source = dag.commit('delivered resident aliases', [unrelated ? dag.base : merge], {
                ...content,
                'resident.txt': 'resident',
            });
            const landed = dag.commit('resident squash', [merge], { ...content, 'resident.txt': 'resident' });
            add(5002, source, 'fix/nested-resident-replacement', 'main', merge, true, landed);
            explicitParentReplacement = replacement;
            replacement = 5002;
        },
    };
}

describe('nested canonical native supersession', () => {
    it('accepts exactly 32 binding levels and refuses the next level and contradictory repeated replacements', () => {
        let record: ReturnType<typeof parseSupersessionParentBinding> = distinctBinding;
        const wrap = (previous: ReturnType<typeof parseSupersessionParentBinding>, index: number) => ({
            ...previous,
            format: 'supersession-parent-v2' as const,
            child: {
                ...previous.child,
                number: 6000 + index,
                branch: `fix/bounded-${index}`,
                base: previous.child.branch,
            },
            parent: {
                number: previous.child.number,
                head: previous.child.head,
                branch: previous.child.branch,
                base: previous.child.base,
            },
            parentReplacement: previous.replacement,
            provenance: { kind: 'final-parent-head' as const, forkHead: previous.child.head, admittedParentHead: null },
            parentCompletion: { id: `IC_bounded_${index}`, fullDatabaseId: String(6000 + index), binding: previous },
        });
        for (let index = 1; index < 32; index += 1) {
            record = wrap(record, index);
        }
        expect(parseSupersessionParentBinding(`sourdaw-supersession-parent-v2 ${canonicalJson(record)}`)).toEqual(
            record
        );
        expect(() =>
            parseSupersessionParentBinding(`sourdaw-supersession-parent-v2 ${canonicalJson(wrap(record, 32))}`)
        ).toThrow(/maximum depth/i);
        expect(() =>
            parseSupersessionParentBinding(
                `sourdaw-supersession-parent-v2 ${canonicalJson({
                    ...record,
                    parentReplacement: { ...record.parentReplacement, head: movedHead },
                })}`
            )
        ).toThrow(/contradictory/i);
    });

    it('refuses a completed-parent cycle before reading or mutating the original child as an ancestor', async () => {
        await withLockRoot(async (root) => {
            const fixture = nestedNativeFixture(root);
            const child = fixture.row(4002);
            const parent = fixture.row(4001);
            parent.base = child.headRefName;
            parent.baseRef = { name: child.headRefName, repository: child.repository, target: child.head };
            fixture.commentAt(4001, 2).body = bindingBody({
                ...fixture.initialBinding,
                child: { ...fixture.initialBinding.child, base: child.headRefName },
                parent: { number: child.number, head: child.head, branch: child.headRefName, base: 'main' },
                provenance: { kind: 'final-parent-head', forkHead: child.head, admittedParentHead: null },
            });
            expect(() => fixture.run()).toThrow(/cycle/i);
            expect(fixture.writes()).toEqual([]);
        });
    });

    it('closes a real two-level stack and then a distinct replacement whose parent completion is v2', async () => {
        await withLockRoot(async (root) => {
            const fixture = nestedNativeFixture(root);
            expect(await fixture.serialized()).toBe('pull-request-superseded:4002:5001');
            const marker = fixture.commentAt(4002, 2);
            const binding = parseSupersessionParentBinding(marker.body);
            expect(binding.format).toBe('supersession-parent-v2');
            expect(binding).toMatchObject({
                parentCompletion: {
                    id: 'IC_binding_4001',
                    fullDatabaseId: '40012',
                    binding: fixture.initialBinding,
                },
            });
            expect(fixture.row(4002).state).toBe('CLOSED');
            expect(fixture.writes()).toEqual(['comment:4002', 'comment:4002', 'comment:4002', 'close:4002']);
            const writes = [...fixture.writes()];
            fixture.row(4002).baseRef = null;
            fixture.row(4001).baseRef = null;
            expect(await fixture.serialized()).toBe('pull-request-superseded:4002:5001');
            expect(fixture.writes()).toEqual(writes);
            expect(fixture.commentAt(4002, 2).body).toBe(marker.body);
            fixture.advance();
            expect(await fixture.serialized()).toBe('pull-request-superseded:4003:5002');
            expect(parseSupersessionParentBinding(fixture.commentAt(4003, 2).body)).toMatchObject({
                format: 'supersession-parent-v2',
                parentReplacement: { number: 5001 },
                parentCompletion: { binding: { format: 'supersession-parent-v2', replacement: { number: 5001 } } },
            });
            expect(fixture.events).toContain(`ancestor:${fixture.row(5001).mergeCommit}:${fixture.row(5002).head}`);
            const lastDependent = fixture.events.findLastIndex(
                (value) => value.startsWith('threads:') || value.startsWith('comments:')
            );
            const finalCores = fixture.events.slice(lastDependent + 1);
            for (const number of [4000, 4001, 4002, 5000, 5001, 5002, 4003]) {
                expect(finalCores).toContain(`core:${number}`);
            }
            const writesAfter = [...fixture.writes()];
            fixture.row(4003).baseRef = null;
            expect(await fixture.serialized()).toBe('pull-request-superseded:4003:5002');
            expect(fixture.writes()).toEqual(writesAfter);
        });
    }, 30_000);

    it.each([false, true])('refuses missing immutable dependency containment with v2 parent=%s', async (v2Parent) => {
        await withLockRoot(async (root) => {
            const fixture = nestedNativeFixture(root, !v2Parent);
            if (v2Parent) {
                fixture.run();
                fixture.advance(true);
            }
            const writes = [...fixture.writes()];
            expect(() => fixture.run()).toThrow(/merge commit is not proven/i);
            expect(fixture.writes()).toEqual(writes);
        });
    });

    it.each([
        'missing',
        'duplicate',
        'foreign',
        'wrong identity',
        'wrong successor',
        'missing ref',
        'missing native ref',
        'unrelated old child',
    ] as const)('refuses %s completion evidence before writing', async (failure) => {
        await withLockRoot(async (root) => {
            const fixture = nestedNativeFixture(root);
            const parent = fixture.row(4001);
            const marker = fixture.commentAt(4001, 2);
            if (failure === 'missing') {
                parent.comments.pop();
            }
            if (failure === 'duplicate') {
                parent.comments.push({ ...marker, id: 'IC_duplicate' });
            }
            if (failure === 'foreign') {
                marker.authorNodeId = REVIEWER_BOT_NODE_ID;
            }
            if (failure === 'wrong identity') {
                marker.body = bindingBody({
                    ...fixture.initialBinding,
                    child: { ...fixture.initialBinding.child, head: fixture.dag.base },
                });
            }
            if (failure === 'wrong successor') {
                marker.body = bindingBody({
                    ...fixture.initialBinding,
                    replacement: { ...fixture.initialBinding.replacement, head: fixture.dag.base },
                });
            }
            if (failure === 'missing ref') {
                fixture.row(4002).baseRef = null;
            }
            if (failure === 'missing native ref') {
                fixture.row(4002).baseRef = undefined;
            }
            if (failure === 'unrelated old child') {
                fixture.row(4002).head = fixture.dag.reusedParent;
            }
            expect(() => fixture.run()).toThrow();
            expect(fixture.writes()).toEqual([]);
        });
    });

    it.each([4000, 4001])('requires total current finding roots on ancestor %s', async (number) => {
        await withLockRoot(async (root) => {
            const fixture = nestedNativeFixture(root);
            fixture.findings.set(number, [{ threadId: 'PRRT_late', rootCommentId: '7001' }]);
            expect(() => fixture.run()).toThrow(/no entry for finding 7001/i);
            expect(fixture.writes()).toEqual([]);
        });
    });

    it.each(['pre-write', 'pre-close', 'post-close', 'replay'] as const)(
        'binds final ancestor cores at %s',
        async (boundary) => {
            await withLockRoot(async (root) => {
                const fixture = nestedNativeFixture(root);
                if (boundary === 'replay') {
                    fixture.run();
                }
                const start = fixture.events.length;
                let armed = boundary === 'pre-write' || boundary === 'replay';
                let moved = false;
                fixture.onEvent((event) => {
                    if (boundary === 'pre-close' && event === 'comment:4002') {
                        armed = true;
                    }
                    if (boundary === 'post-close' && event === 'close:4002') {
                        armed = true;
                    }
                    if (armed && !moved && event === 'threads:4000') {
                        fixture.row(5000).head = fixture.dag.base;
                        moved = true;
                    }
                });
                await expect(fixture.serialized()).rejects.toThrow();
                expect(moved).toBe(true);
                expect(fixture.events.slice(start)).not.toContain('pull-request-superseded:4002:5001');
                if (boundary === 'post-close' || boundary === 'replay') {
                    expect(fixture.row(4002).state).toBe('CLOSED');
                    expect(fixture.row(4002).comments).toHaveLength(3);
                    expect(fixture.events.slice(start).filter((event) => event.startsWith('delete:'))).toEqual([]);
                } else {
                    expect(fixture.row(4002).state).toBe('OPEN');
                    expect(fixture.row(4002).comments).toEqual([]);
                }
                const owner = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(4002), 4002);
                if (boundary === 'post-close') {
                    expect(owner).toBeDefined();
                } else {
                    expect(owner).toBeUndefined();
                }
            });
        }
    );

    it.each(['id', 'body', 'actor', 'roots'] as const)(
        'compensates when ancestor %s changes during marker writes',
        async (field) => {
            await withLockRoot(async (root) => {
                const fixture = nestedNativeFixture(root);
                let moved = false;
                fixture.onEvent((event) => {
                    if (moved || event !== 'comment:4002') {
                        return;
                    }
                    moved = true;
                    const marker = fixture.commentAt(4001, 2);
                    if (field === 'id') {
                        marker.id = 'IC_replaced_binding';
                    }
                    if (field === 'body') {
                        marker.body += ' ';
                    }
                    if (field === 'actor') {
                        marker.authorType = 'User';
                    }
                    if (field === 'roots') {
                        fixture.findings.set(4000, [{ threadId: 'PRRT_new', rootCommentId: '7001' }]);
                    }
                });
                await expect(fixture.serialized()).rejects.toThrow();
                expect(fixture.row(4002).comments).toEqual([]);
                expect(fixture.row(4002).state).toBe('OPEN');
                expect(fixture.writes().filter((event) => event.startsWith('delete:'))).toHaveLength(3);
                expect(readPullRequestMutationLockOid(root, pullRequestMutationLockRef(4002), 4002)).toBeUndefined();
            });
        }
    );

    it('refuses a new root arriving during the final ancestor marker read after close', async () => {
        await withLockRoot(async (root) => {
            const fixture = nestedNativeFixture(root);
            let closed = false;
            let markerReads = 0;
            fixture.onEvent((event) => {
                if (event === 'close:4002') {
                    closed = true;
                }
                if (closed && event === 'comments:4000') {
                    markerReads += 1;
                    if (markerReads === 2) {
                        fixture.findings.set(4000, [{ threadId: 'PRRT_final', rootCommentId: '7001' }]);
                    }
                }
            });
            await expect(fixture.serialized()).rejects.toThrow(/no entry for finding 7001/i);
            expect(markerReads).toBe(2);
            expect(fixture.row(4002).state).toBe('CLOSED');
            expect(fixture.row(4002).comments).toHaveLength(3);
            expect(fixture.events).not.toContain('pull-request-superseded:4002:5001');
            expect(readPullRequestMutationLockOid(root, pullRequestMutationLockRef(4002), 4002)).toBeDefined();
        });
    });

    it('refuses contradictory present refs and a substituted completion marker on CLOSED replay', async () => {
        await withLockRoot(async (root) => {
            const fixture = nestedNativeFixture(root);
            fixture.run();
            const writes = [...fixture.writes()];
            fixture.commentAt(4001, 2).id = 'IC_substituted';
            expect(() => fixture.run()).toThrow();
            expect(fixture.writes()).toEqual(writes);
        });
    });

    it('rejects noncanonical and oversized v2 records without weakening v1', async () => {
        await withLockRoot(async (root) => {
            const fixture = nestedNativeFixture(root);
            fixture.run();
            const body = fixture.commentAt(4002, 2).body;
            const binding = parseSupersessionParentBinding(body);
            expect(() => parseSupersessionParentBinding(body.replace(' {', '  {'))).toThrow();
            expect(() =>
                parseSupersessionParentBinding(body.replace('"format":', '"format":"supersession-parent-v2","format":'))
            ).toThrow();
            expect(() =>
                parseSupersessionParentBinding(
                    `sourdaw-supersession-parent-v2 ${canonicalJson({ ...binding, extra: 1 })}`
                )
            ).toThrow(/unexpected keys/i);
            expect(() => parseSupersessionParentBinding(body + ' '.repeat(60_000))).toThrow(/byte size/i);
            expect(() =>
                parseSupersessionParentBinding(`sourdaw-supersession-parent-v1 ${canonicalJson(binding)}`)
            ).toThrow(/canonical/i);
            const collision = {
                ...binding,
                replacement: { ...binding.replacement, number: 5000 },
            };
            expect(() =>
                parseSupersessionParentBinding(`sourdaw-supersession-parent-v2 ${canonicalJson(collision)}`)
            ).toThrow(/contradictory repeated/i);
            const reusedOriginal = {
                ...binding,
                replacement: { ...binding.replacement, number: 4000 },
            };
            expect(() =>
                parseSupersessionParentBinding(`sourdaw-supersession-parent-v2 ${canonicalJson(reusedOriginal)}`)
            ).toThrow(/reuses an original/i);
            expect(bindingBody(fixture.initialBinding)).toBe(fixture.commentAt(4001, 2).body);
        });
    });
});

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
const parentBinding: SupersessionParentBinding = {
    format: 'supersession-parent-v1',
    repository: 'jcosta33/sourdaw',
    child: {
        number: oldNumber,
        head,
        branch: 'fix/old-pull-request',
        base: parentBranch,
        cachedBase: parentMerge,
        sourceRepository: 'jcosta33/sourdaw',
    },
    parent: { number: parentNumber, head: parentHead, branch: parentBranch, base: 'main' },
    replacement: {
        number: replacementNumber,
        head: replacementHead,
        branch: 'fix/replacement-pull-request',
        base: 'main',
        mergeCommit: childMerge,
    },
    parentReplacement: {
        number: replacementNumber,
        head: replacementHead,
        branch: 'fix/replacement-pull-request',
        base: 'main',
        mergeCommit: childMerge,
    },
    provenance: { kind: 'final-parent-head', forkHead: parentHead, admittedParentHead: null },
};
const bindingBody = (record: SupersessionParentBinding) => `sourdaw-supersession-parent-v1 ${canonicalJson(record)}`;
const parentBindingBody = bindingBody(parentBinding);
const distinctBinding: SupersessionParentBinding = {
    ...parentBinding,
    parentReplacement: {
        number: parentReplacementNumber,
        head: '1'.repeat(40),
        branch: 'fix/parent-replacement',
        base: 'main',
        mergeCommit: parentMerge,
    },
};
const distinctBindingBody = bindingBody(distinctBinding);

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
    parentBindingComments?: IssueComment[];
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
    if (input.parentBindingComments !== undefined) {
        comments.push(...input.parentBindingComments);
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
            if (inspection === 3 && input.precloseParentProofChildComments !== undefined) {
                comments = input.precloseParentProofChildComments(comments);
            }
            if (inspection === 5 && input.finalParentProofChildComments !== undefined) {
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
            mergeCommit: childMerge,
            closedAt: '2026-08-20T12:00:00Z',
            comments: [],
        };
    };
    const port: SupersedePullRequestPort = {
        assertCurrentPullRequest: () => undefined,
        isCommitAncestor: () => true,
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
        atBoundary?: {
            phase: 'before-write' | 'before-close' | 'after-close';
            number: number;
            patch: Partial<SupersededPullRequest>;
        };
    } = {}
) {
    const fixture = fakePort({
        bases: Array.from({ length: 8 }, () => parentBranch),
        parentComments: distinctParentComments,
        ...input,
    });
    const reads = new Map<number, number>();
    let ancestryReads = 0;
    let dependencyCompared = false;
    let initialParentProofRead = false;
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
            let phase: 'before-write' | 'before-close' | 'after-close' | undefined;
            if (fixture.state().state === 'CLOSED') {
                phase = 'after-close';
            } else if (fixture.posted().length > 0) {
                phase = 'before-close';
            } else if (initialParentProofRead) {
                phase = 'before-write';
            }
            // Initial admission ends with the child-ref read after its dependency comparison.
            if (number === oldNumber && dependencyCompared) {
                initialParentProofRead = true;
            }
            const snapshot = { ...value, ...changes.snapshots?.[number]?.[read] };
            if (changes.atBoundary?.phase === phase && changes.atBoundary?.number === number) {
                return { ...snapshot, ...changes.atBoundary.patch };
            }
            return snapshot;
        },
        isCommitAncestor: (repository, ancestor, descendant) => {
            fixture.calls.push(`ancestor:${repository}:${ancestor}:${descendant}`);
            let result: boolean | Error = true;
            if (ancestor === parentMerge && descendant === replacementHead) {
                result = changes.ancestry?.[ancestryReads++] ?? true;
            }
            if (result instanceof Error) {
                throw result;
            }
            dependencyCompared = true;
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
    supersededParentNumber?: number,
    parentReplacementNumber?: number
) {
    return serializedSupersedePullRequest(
        root,
        {
            oldNumber: lineage.oldPr,
            expectedHead: head,
            replacementNumber,
            supersededParentNumber,
            parentReplacementNumber,
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

function dependencyDag(root: string, unrelatedReplacement: boolean) {
    const env = {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    };
    const git = (args: string[], input?: string) =>
        execFileSync('git', args, { cwd: root, env, input, encoding: 'utf8' }).trim();
    const commit = (label: string, parents: string[], files: Record<string, string>) => {
        const entries = Object.entries(files)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, content]) => {
                const blob = git(['hash-object', '-w', '--stdin'], content);
                return `100644 blob ${blob}\t${name}\n`;
            })
            .join('');
        const tree = git(['mktree'], entries);
        return git(['commit-tree', tree, ...parents.flatMap((parent) => ['-p', parent]), '-m', label]);
    };
    const baseFiles = { 'base.txt': 'base\n' };
    const parentFiles = { ...baseFiles, 'original-dependency.txt': 'required parent work\n' };
    const wrongFiles = { ...baseFiles, 'reused-parent.txt': 'unrelated parent work\n' };
    const base = commit('base', [], baseFiles);
    const originalParent = commit('original parent', [base], parentFiles);
    const oldChild = commit('old child', [originalParent], { ...parentFiles, 'child.txt': 'child work\n' });
    const finalParent = commit('later parent', [originalParent], { ...parentFiles, 'later.txt': 'late parent work\n' });
    const reusedParent = commit('reused branch parent', [base], wrongFiles);
    const deliveredFiles = unrelatedReplacement ? wrongFiles : parentFiles;
    const parentReplacementHead = commit('parent replacement', [base], deliveredFiles);
    const parentReplacementMerge = commit('parent replacement merge', [base, parentReplacementHead], deliveredFiles);
    const replacementHead = commit('child replacement', [parentReplacementMerge], {
        ...deliveredFiles,
        'child.txt': 'child work\n',
    });
    const replacementMerge = commit('child replacement merge', [parentReplacementMerge, replacementHead], {
        ...deliveredFiles,
        'child.txt': 'child work\n',
    });
    const ancestor = (earlier: string, later: string) => {
        const result = spawnSync('git', ['merge-base', '--is-ancestor', earlier, later], {
            cwd: root,
            env,
            encoding: 'utf8',
        });
        if (result.status !== 0 && result.status !== 1) {
            throw new Error(`Git ancestry failed: ${result.stderr}`);
        }
        return result.status === 0;
    };
    return {
        base,
        commit,
        originalParent,
        oldChild,
        finalParent,
        reusedParent,
        parentReplacementHead,
        parentReplacementMerge,
        replacementHead,
        replacementMerge,
        ancestor,
    };
}

function realDependencyFixture(root: string, kind: 'direct' | 'late' | 'unrelated', distinct: boolean) {
    const dag = dependencyDag(root, kind === 'unrelated');
    let namedParent = dag.originalParent;
    if (kind === 'late') {
        namedParent = dag.finalParent;
    } else if (kind === 'unrelated') {
        namedParent = dag.reusedParent;
    }
    const fixture = distinct ? distinctPort() : fakePort({ bases: [parentBranch] });
    const inspect = fixture.port.inspect;
    const comparisons: [string, string][] = [];
    fixture.port.inspect = (number) => {
        const value = inspect(number);
        if (number === oldNumber) {
            return {
                ...value,
                head: dag.oldChild,
                baseRefOid: dag.base,
                baseRef: { name: parentBranch, repository: 'jcosta33/sourdaw', target: namedParent },
            };
        }
        if (number === parentNumber) {
            return { ...value, head: namedParent };
        }
        if (number === parentReplacementNumber) {
            return { ...value, head: dag.parentReplacementHead, mergeCommit: dag.parentReplacementMerge };
        }
        return { ...value, head: dag.replacementHead, mergeCommit: dag.replacementMerge };
    };
    fixture.port.isCommitAncestor = (_repository, ancestor, descendant) => {
        comparisons.push([ancestor, descendant]);
        return dag.ancestor(ancestor, descendant);
    };
    fixture.port.readRegisteredLaneStack = (branch) => {
        return readRegisteredLaneStack(root, branch, (args) =>
            execFileSync('git', args, { cwd: root, encoding: 'utf8' })
        );
    };
    const register = (patch: Partial<LaneStack> = {}) => {
        const descriptor: LaneStack = {
            version: 1,
            childBranch: 'fix/old-pull-request',
            parentBranch,
            forkHead: dag.originalParent,
            parentHead: dag.originalParent,
            parentPullRequest: parentNumber,
            ...patch,
        };
        writeLaneStack(root, descriptor);
        execFileSync('git', ['config', 'branch.fix/old-pull-request.sourdaw-stack-fork', descriptor.forkHead], {
            cwd: root,
        });
    };
    const run = () =>
        supersedePullRequest(
            oldNumber,
            dag.oldChild,
            replacementNumber,
            repairedLineage,
            AUTHOR_BOT_NODE_ID,
            fixture.port,
            parentNumber,
            distinct ? parentReplacementNumber : undefined
        );
    return { ...fixture, dag, comparisons, register, run };
}

type ChildBaseRef = NonNullable<SupersededPullRequest['baseRef']> | null;

function comparisonCommits(count: number, terminal: string): { sha: string }[] {
    if (count === 0) {
        return [];
    }
    return [
        ...Array.from({ length: count - 1 }, (_, index) => ({ sha: (index + 1).toString(16).padStart(40, '0') })),
        { sha: terminal },
    ];
}

function nativeSupersessionFixture(
    root: string,
    moveAtRead?: number,
    distinctParent = false,
    afterCloseIdentity: Partial<Pick<SupersededPullRequest, 'head' | 'headRefName'>> = {},
    options: {
        comparison?: Record<string, unknown>;
        initialMarkers?: boolean;
        lateParent?: boolean;
        cachedBaseOid?: string;
    } = {}
) {
    let currentHead = head;
    let currentHeadRefName = 'fix/old';
    let state = 'OPEN';
    let closedAt: string | null = null;
    let commentReads = 0;
    let parentThreadReads = 0;
    let parentCommentReads = 0;
    let currentChildBaseRef: ChildBaseRef = {
        name: parentBranch,
        repository: 'jcosta33/sourdaw',
        target: parentHead,
    };
    let currentChildSource: string | null = 'jcosta33/sourdaw';
    let omitChildBaseRef = false;
    let omitChildCachedBaseOid = false;
    let nextComment = 2002;
    type AuthorityChange = Partial<Pick<SupersededPullRequest, 'state' | 'head' | 'headRefName' | 'closedAt'>>;
    const authorityChanges = new Map<number, AuthorityChange>();
    const closureEvidence = new Map<number, Record<string, unknown>>();
    let pendingChange: { number: number; atParentThreadRead: number; patch: AuthorityChange } | undefined;
    let liveParentComments = [...distinctParentComments];
    let pendingParentCommentsChange:
        { atParentThreadRead: number; change: (comments: IssueComment[]) => IssueComment[] } | undefined;
    let pendingChildBaseChange: { atParentCommentRead: number; baseRef: ChildBaseRef } | undefined;
    let moveAt = moveAtRead;
    let historicalBase = options.cachedBaseOid ?? parentHead;
    let provenance = parentBinding.provenance;
    if (options.lateParent) {
        historicalBase = parentMerge;
        provenance = { kind: 'registered-lane-stack', forkHead: parentMerge, admittedParentHead: parentMerge };
    }
    const nativeBindingBody = bindingBody({
        ...parentBinding,
        child: { ...parentBinding.child, branch: 'fix/old', cachedBase: historicalBase },
        replacement: { ...parentBinding.replacement, branch: 'fix/replacement' },
        parentReplacement: {
            ...parentBinding.replacement,
            number: parentReplacementNumber,
            branch: 'fix/replacement',
            mergeCommit: parentMerge,
        },
        provenance,
    });
    const comments = [oldComment];
    if (options.initialMarkers !== false) {
        comments.push(
            markerComment('IC_receipt', '2001', receiptBody),
            markerComment('IC_lineage', '2002', lineageBody)
        );
        if (distinctParent) {
            comments.push(markerComment('IC_parent_binding', '2000', nativeBindingBody));
        }
    }
    const events: string[] = [];
    const cachedBasePresence: boolean[] = [];
    const capture = (command: string, args: string[]): string => {
        if (command === 'git') {
            if (args[0] === 'config') {
                return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
            }
            return join(root, '.git');
        }
        const query = args.find((arg) => arg.startsWith('query=')) ?? '';
        if (query.includes('headRefOid')) {
            const number = Number(args.find((arg) => arg.startsWith('number='))?.slice(7));
            events.push(`core:${number}`);
            const old = number === oldNumber;
            const parent = number === parentNumber;
            const parentReplacement = number === parentReplacementNumber;
            let pullRequestState = state;
            let pullRequestHead = currentHead;
            let pullRequestBranch = currentHeadRefName;
            if (!old) {
                pullRequestState = 'MERGED';
                pullRequestHead = replacementHead;
                pullRequestBranch = 'fix/replacement';
                if (parent) {
                    pullRequestState = 'CLOSED';
                    pullRequestHead = parentHead;
                    pullRequestBranch = parentBranch;
                }
            }
            let baseRef: {
                name: string;
                repository: { nameWithOwner: string };
                target: { oid: string };
            } | null = null;
            if (!old) {
                baseRef = {
                    name: 'main',
                    repository: { nameWithOwner: 'jcosta33/sourdaw' },
                    target: { oid: childMerge },
                };
            }
            if (old && distinctParent && currentChildBaseRef !== null) {
                baseRef = {
                    name: currentChildBaseRef.name,
                    repository: { nameWithOwner: currentChildBaseRef.repository },
                    target: { oid: currentChildBaseRef.target },
                };
            }
            if (old) {
                events.push(`old-base-ref:${JSON.stringify(baseRef)}`);
                events.push('old-core');
            }
            let mergeCommit: { oid: string } | null = null;
            if (!old && !parent) {
                let mergeCommitOid = childMerge;
                if (parentReplacement) {
                    mergeCommitOid = parentMerge;
                }
                mergeCommit = { oid: mergeCommitOid };
            }
            const change = authorityChanges.get(number);
            let observedClosedAt: string | null = '2026-10-24T00:00:00Z';
            if (old) {
                observedClosedAt = closedAt;
            }
            if (change?.closedAt !== undefined) {
                observedClosedAt = change.closedAt;
            }
            let headRepository: { nameWithOwner: string } | null = { nameWithOwner: 'jcosta33/sourdaw' };
            if (old) {
                headRepository = null;
                if (currentChildSource !== null) {
                    headRepository = { nameWithOwner: currentChildSource };
                }
            }
            const pullRequest = {
                id: old ? 'PR_old' : `PR_${number}`,
                number,
                state: change?.state ?? pullRequestState,
                headRefOid: change?.head ?? pullRequestHead,
                headRefName: change?.headRefName ?? pullRequestBranch,
                headRepository,
                baseRefName: old && distinctParent ? parentBranch : 'main',
                baseRefOid: old && distinctParent ? historicalBase : childMerge,
                baseRef,
                merged: !old && !parent,
                mergeCommit,
                closedAt: observedClosedAt,
                ...closureEvidence.get(number),
            };
            if (old && omitChildBaseRef) {
                Reflect.deleteProperty(pullRequest, 'baseRef');
                events.push(`old-core-wire-has-base-ref:${Object.hasOwn(pullRequest, 'baseRef')}`);
            }
            if (old) {
                if (omitChildCachedBaseOid) {
                    Reflect.deleteProperty(pullRequest, 'baseRefOid');
                }
                cachedBasePresence.push(Object.hasOwn(pullRequest, 'baseRefOid'));
            }
            return JSON.stringify({
                data: {
                    repository: {
                        nameWithOwner: 'jcosta33/sourdaw',
                        pullRequest,
                    },
                },
            });
        }
        if (query.includes('reviewThreads(first:100')) {
            const number = Number(args.find((arg) => arg.startsWith('number='))?.slice(7));
            events.push(`threads:${number}`);
            const threads = number === parentNumber ? [] : defaultThreads;
            const output = JSON.stringify({
                data: {
                    repository: {
                        pullRequest: {
                            reviewThreads: {
                                nodes: threads.map((thread) => ({
                                    id: thread.threadId,
                                    comments: { nodes: [{ databaseId: Number(thread.rootCommentId) }] },
                                })),
                                pageInfo: { hasNextPage: false, endCursor: null },
                            },
                        },
                    },
                },
            });
            if (number === parentNumber) {
                parentThreadReads += 1;
                if (pendingChange?.atParentThreadRead === parentThreadReads) {
                    authorityChanges.set(pendingChange.number, pendingChange.patch);
                    events.push(`authority-changed:${pendingChange.number}`);
                    pendingChange = undefined;
                }
                if (pendingParentCommentsChange?.atParentThreadRead === parentThreadReads) {
                    liveParentComments = pendingParentCommentsChange.change(liveParentComments);
                    events.push(`parent-markers-changed:${parentThreadReads}`);
                    pendingParentCommentsChange = undefined;
                }
            }
            return output;
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
            let commentsToSerialize: IssueComment[] = [];
            if (id === 'PR_old') {
                commentsToSerialize = comments;
            } else if (id === `PR_${parentNumber}`) {
                events.push('parent-comments');
                parentCommentReads += 1;
                if (pendingChildBaseChange?.atParentCommentRead === parentCommentReads) {
                    currentChildBaseRef = pendingChildBaseChange.baseRef;
                    events.push(`child-base-ref-changed:${parentCommentReads}`);
                    pendingChildBaseChange = undefined;
                }
                commentsToSerialize = liveParentComments;
            }
            return JSON.stringify({
                data: {
                    node: {
                        id,
                        comments: {
                            nodes: commentsToSerialize.map((entry) => ({
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
            currentHead = afterCloseIdentity.head ?? currentHead;
            currentHeadRefName = afterCloseIdentity.headRefName ?? currentHeadRefName;
            const clientMutationId = args.find((arg) => arg.startsWith('clientMutationId='))?.slice(17);
            return JSON.stringify({
                data: { closePullRequest: { clientMutationId, pullRequest: { id: 'PR_old', state, closedAt } } },
            });
        }
        if (query.includes('addComment(input:')) {
            events.push('comment');
            const body = args.find((arg) => arg.startsWith('body='))?.slice(5);
            if (body === undefined) {
                throw new Error('missing fixture comment body');
            }
            nextComment += 1;
            const created = markerComment(`IC_created_${nextComment}`, String(nextComment), body);
            comments.push(created);
            const clientMutationId = args.find((arg) => arg.startsWith('clientMutationId='))?.slice(17);
            return JSON.stringify({
                data: {
                    addComment: {
                        clientMutationId,
                        commentEdge: {
                            node: {
                                id: created.id,
                                fullDatabaseId: created.fullDatabaseId,
                                body,
                                author: { id: AUTHOR_BOT_NODE_ID, __typename: 'Bot', login: 'author[bot]' },
                            },
                        },
                    },
                },
            });
        }
        if (query.includes('deleteIssueComment(input:')) {
            events.push('delete');
            const id = args.find((arg) => arg.startsWith('id='))?.slice(3);
            const index = comments.findIndex((comment) => comment.id === id);
            if (index < 0) {
                throw new Error('unexpected native supersession marker deletion');
            }
            comments.splice(index, 1);
            const clientMutationId = args.find((arg) => arg.startsWith('clientMutationId='))?.slice(17);
            return JSON.stringify({ data: { deleteIssueComment: { clientMutationId } } });
        }
        const endpoint = args[1];
        const comparison = endpoint?.match(/^repos\/jcosta33\/sourdaw\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/);
        if (args[0] === 'api' && comparison !== null && comparison !== undefined) {
            const [, ancestor, descendant] = comparison;
            const dependency = ancestor === parentMerge && descendant === replacementHead;
            events.push(dependency ? 'parent-merge-ancestry' : 'historical-parent-ancestry');
            const identical = ancestor === descendant;
            const response = {
                url: `https://api.github.com/${endpoint}`,
                status: identical ? 'identical' : 'ahead',
                ahead_by: identical ? 0 : 1,
                behind_by: 0,
                total_commits: identical ? 0 : 1,
                base_commit: { sha: ancestor },
                merge_base_commit: { sha: ancestor },
                commits: identical ? [] : [{ sha: descendant }],
            };
            if (dependency && options.comparison !== undefined) {
                Object.assign(response, options.comparison);
            }
            if (options.cachedBaseOid === movedHead && ancestor === movedHead && descendant === parentHead) {
                response.status = 'diverged';
                response.behind_by = 1;
                response.merge_base_commit = { sha: parentMerge };
                events.push(`cached-base-comparison:${ancestor}:${descendant}:${response.status}`);
            }
            if (options.lateParent && ancestor === parentHead && descendant === head) {
                response.status = 'diverged';
                response.behind_by = 1;
                response.merge_base_commit = { sha: parentMerge };
            }
            return JSON.stringify(response);
        }
        throw new Error(`unexpected native supersession query: ${query}`);
    };
    const port: SupersedePullRequestPort = {
        ...shellPort({ configDir: root, env: {}, dispose: () => undefined }, root, capture),
        log: (message) => events.push(message),
    };
    return {
        port,
        events,
        cachedBaseWirePresence: () => [...cachedBasePresence],
        state: () => state,
        comments: () => comments,
        bindingBody: nativeBindingBody,
        setClosureEvidence: (number: number, evidence: Record<string, unknown>) => {
            closureEvidence.set(number, evidence);
        },
        moveOnReplay: () => {
            moveAt = commentReads + 1;
        },
        changeAuthorityDuringParentThreads: (number: number, read: number, patch: AuthorityChange) => {
            pendingChange = { number, atParentThreadRead: parentThreadReads + read, patch };
        },
        changeParentCommentsDuringParentThreads: (
            read: number,
            change: (comments: IssueComment[]) => IssueComment[]
        ) => {
            pendingParentCommentsChange = { atParentThreadRead: parentThreadReads + read, change };
        },
        changeChildBaseDuringParentComments: (read: number, baseRef: ChildBaseRef) => {
            pendingChildBaseChange = { atParentCommentRead: parentCommentReads + read, baseRef };
        },
        setChildBaseRef: (baseRef: ChildBaseRef) => {
            currentChildBaseRef = baseRef;
        },
        setChildSource: (repository: string | null) => {
            currentChildSource = repository;
        },
        omitChildBaseRefFromNativeResponse: () => {
            omitChildBaseRef = true;
        },
        omitChildCachedBaseOidFromNativeResponse: () => {
            omitChildCachedBaseOid = true;
        },
    };
}

function registerNativeParent(root: string, parentPullRequest = parentNumber): void {
    writeLaneStack(root, {
        version: 1,
        childBranch: 'fix/old',
        parentBranch,
        forkHead: parentMerge,
        parentHead: parentMerge,
        parentPullRequest,
    });
    execFileSync('git', ['config', 'branch.fix/old.sourdaw-stack-fork', parentMerge], { cwd: root });
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
    it.each([
        { label: 'one commit', ahead: 1, total: 1, commits: comparisonCommits(1, replacementHead), admitted: true },
        { label: 'three commits', ahead: 3, total: 3, commits: comparisonCommits(3, replacementHead), admitted: true },
        {
            label: '250 of 300 commits',
            ahead: 300,
            total: 300,
            commits: comparisonCommits(250, replacementHead),
            admitted: true,
        },
        {
            label: 'three-count terminal only',
            ahead: 3,
            total: 3,
            commits: comparisonCommits(1, replacementHead),
            admitted: false,
        },
        {
            label: 'three entries padded with missing SHAs',
            ahead: 3,
            total: 3,
            commits: [{}, {}, { sha: replacementHead }],
            admitted: false,
        },
        {
            label: 'three entries padded with malformed SHA',
            ahead: 3,
            total: 3,
            commits: [{ sha: 'main' }, { sha: movedHead }, { sha: replacementHead }],
            admitted: false,
        },
        {
            label: 'three entries padded with duplicate SHA',
            ahead: 3,
            total: 3,
            commits: [{ sha: movedHead }, { sha: movedHead }, { sha: replacementHead }],
            admitted: false,
        },
        {
            label: 'contradictory commit-set totals',
            ahead: 1,
            total: 3,
            commits: comparisonCommits(1, replacementHead),
            admitted: false,
        },
    ])('requires complete unpaged commit evidence for native distinct-parent closure: $label', async (scenario) => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(
                root,
                undefined,
                true,
                {},
                {
                    initialMarkers: false,
                    comparison: { ahead_by: scenario.ahead, total_commits: scenario.total, commits: scenario.commits },
                }
            );
            const result = runSerialized(
                root,
                current.port,
                repairedLineage,
                serializeFixture,
                parentNumber,
                parentReplacementNumber
            );
            if (scenario.admitted) {
                await expect(result).resolves.toBe('pull-request-superseded:2244:2246');
                expect(current.state()).toBe('CLOSED');
                expect(current.comments().map((comment) => comment.body)).toEqual([
                    oldComment.body,
                    receiptBody,
                    lineageBody,
                    current.bindingBody,
                ]);
                expect(current.events.filter((event) => event === 'parent-merge-ancestry')).toHaveLength(4);
                expect(current.events.filter((event) => event === 'comment')).toHaveLength(3);
                expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
                expect(current.events.filter((event) => event === 'delete')).toEqual([]);
                expect(current.events.filter((event) => event === 'pull-request-superseded:2244:2246')).toHaveLength(1);
            } else {
                await expect(result).rejects.toThrow(/ancestry/i);
                expect(current.state()).toBe('OPEN');
                expect(current.comments()).toEqual([oldComment]);
                expect(current.events.filter((event) => event === 'parent-merge-ancestry')).toHaveLength(1);
                expect(
                    current.events.filter((event) => /^(?:comment|close|delete|pull-request-superseded:)/.test(event))
                ).toEqual([]);
            }
            expect(
                readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
            ).toBeUndefined();
        });
    });
    it.each([
        { label: 'correct', comparison: {}, admitted: true },
        { label: 'wrong terminal', comparison: { commits: [{ sha: movedHead }] }, admitted: false },
        { label: 'missing', comparison: { commits: undefined }, admitted: false },
        {
            label: 'contradictory terminal',
            comparison: { commits: [{ sha: replacementHead }, { sha: parentMerge }] },
            admitted: false,
        },
    ])('binds the native eleven-argument CLI to its $label comparison head', async ({ comparison, admitted }) => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true, {}, { comparison });
            const lineagePath = join(root, 'lineage.json');
            writeFileSync(lineagePath, JSON.stringify(repairedLineage));
            const nativeSerialize = withPullRequestMutationLock;
            const dispose = vi.fn();
            vi.spyOn(githubIdentity, 'originMainBlob').mockReturnValue(undefined);
            vi.spyOn(githubIdentity, 'resolvePrimaryRoot').mockReturnValue(root);
            vi.spyOn(githubIdentity, 'authenticateRole').mockResolvedValue({
                credentials: { appId: 'fixture', installationId: 'fixture', privateKey: '', sourcePath: root },
                minted: { token: '', login: 'author[bot]', actorNodeId: AUTHOR_BOT_NODE_ID, permissions: {} },
                session: { configDir: root, env: {}, dispose },
            });
            vi.spyOn(githubIdentity, 'spawnCapture').mockImplementation((command, args) => {
                if (command === 'gh' && args[0] === 'repo') {
                    return 'jcosta33/sourdaw';
                }
                throw new Error(`unexpected CLI command: ${command}`);
            });
            vi.spyOn(githubPort, 'shellPort').mockReturnValue(current.port);
            vi.spyOn(mutationOwnership, 'withPullRequestMutationLock').mockImplementation(
                (directory, number, operation) =>
                    nativeSerialize(directory, number, operation, {
                        ownerFence: { kind: 'pid', pid: process.pid, startedAt: 'supersession-cli-fixture' },
                    })
            );
            try {
                const result = runSupersedePullRequestCli([
                    String(oldNumber),
                    '--head',
                    head,
                    '--replacement',
                    String(replacementNumber),
                    '--superseded-parent',
                    String(parentNumber),
                    '--parent-replacement',
                    String(parentReplacementNumber),
                    '--lineage',
                    lineagePath,
                ]);
                if (admitted) {
                    await expect(result).resolves.toBe(0);
                    expect(current.state()).toBe('CLOSED');
                    expect(current.events.filter((event) => event === 'parent-merge-ancestry')).toHaveLength(4);
                    expect(current.events[current.events.indexOf('close') - 1]).toBe('old-core');
                } else {
                    await expect(result).rejects.toThrow(/ancestry/i);
                    expect(current.state()).toBe('OPEN');
                    expect(current.events.filter((event) => /^(?:close|delete)$/.test(event))).toEqual([]);
                }
                expect(
                    readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
                ).toBeUndefined();
                expect(dispose).toHaveBeenCalledOnce();
            } finally {
                vi.restoreAllMocks();
            }
        });
    });
    it('keeps the real supersession inspection and close adapters valid on an unchanged head', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root);
            await expect(runSerialized(root, current.port)).resolves.toBe('pull-request-superseded:2244:2246');
            await expect(runSerialized(root, current.port)).resolves.toBe('pull-request-superseded:2244:2246');
            expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
            expect(current.events[current.events.indexOf('close') - 1]).toBe('old-core');
        });
    });

    it('refuses a native closed unmerged parent with a merge commit before any closure mutation', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true, {}, { initialMarkers: false });
            current.setClosureEvidence(parentNumber, { mergeCommit: { oid: parentMerge } });
            await expect(
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                )
            ).rejects.toThrow(/cannot inspect PR #2245.*closure evidence/i);
            expect(current.state()).toBe('OPEN');
            expect(current.comments()).toEqual([oldComment]);
            expect(
                current.events.filter((event) => /^(?:comment|close|delete|pull-request-superseded:)/.test(event))
            ).toEqual([]);
            expect(
                readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
            ).toBeUndefined();
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
    it.each([
        ['head', { head: movedHead }],
        ['head branch', { headRefName: 'fix/moved' }],
    ] satisfies [string, Partial<Pick<SupersededPullRequest, 'head' | 'headRefName'>>][])(
        'rejects native child %s movement after close and retains all stacked markers',
        async (_case, patch) => {
            await withLockRoot(async (root) => {
                const current = nativeSupersessionFixture(root, undefined, true, patch);
                await expect(
                    runSerialized(
                        root,
                        current.port,
                        repairedLineage,
                        serializeFixture,
                        parentNumber,
                        parentReplacementNumber
                    )
                ).rejects.toThrow(/ambiguous/i);
                expect(current.state()).toBe('CLOSED');
                expect(current.comments().map((comment) => comment.body)).toEqual([
                    oldComment.body,
                    receiptBody,
                    lineageBody,
                    current.bindingBody,
                ]);
                expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
                const sideEffects = current.events.filter((event) =>
                    /^(?:delete|pull-request-superseded:)/.test(event)
                );
                expect(sideEffects).toEqual([]);
                expect(retainedOwner(root)).toBeDefined();
            });
        }
    );
    it.each(
        [
            { authority: 'parent', number: parentNumber, patch: { state: 'OPEN', closedAt: null } },
            { authority: 'child replacement', number: replacementNumber, patch: { head: movedHead } },
            { authority: 'parent replacement', number: parentReplacementNumber, patch: { head: movedHead } },
        ].flatMap((authority) =>
            [
                { phase: 'before write', read: 2, closed: false, created: 0 },
                { phase: 'during pre-close proof', read: 3, closed: false, created: 3 },
                { phase: 'after close', read: 4, closed: true, created: 3 },
            ].map((phase) => ({ ...authority, ...phase }))
        )
    )('rechecks native $authority core after its final dependent read $phase', async (testCase) => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true, {}, { initialMarkers: false });
            current.changeAuthorityDuringParentThreads(testCase.number, testCase.read, testCase.patch);
            await expect(
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                )
            ).rejects.toThrow(testCase.closed ? /ambiguous/i : /core identity changed/i);
            const changedAt = current.events.indexOf(`authority-changed:${testCase.number}`);
            expect(changedAt).toBeGreaterThan(-1);
            expect(current.events.slice(changedAt + 1)).toContain(`core:${testCase.number}`);
            expect(current.events.filter((event) => event === 'comment')).toHaveLength(testCase.created);
            expect(current.events.filter((event) => event === 'close')).toHaveLength(testCase.closed ? 1 : 0);
            expect(current.state()).toBe(testCase.closed ? 'CLOSED' : 'OPEN');
            expect(current.comments().map((comment) => comment.body)).toEqual(
                testCase.closed ? [oldComment.body, receiptBody, lineageBody, current.bindingBody] : [oldComment.body]
            );
            expect(current.events.filter((event) => event.startsWith('pull-request-superseded:'))).toEqual([]);
            if (testCase.closed) {
                expect(current.events.filter((event) => event === 'delete')).toEqual([]);
                expect(retainedOwner(root)).toBeDefined();
            } else {
                expect(current.events.filter((event) => event === 'delete')).toHaveLength(testCase.created);
                expect(
                    readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
                ).toBeUndefined();
            }
        });
    });
    it.each([
        { authority: 'parent', number: parentNumber, patch: { state: 'OPEN', closedAt: null } },
        { authority: 'child replacement', number: replacementNumber, patch: { head: movedHead } },
        { authority: 'parent replacement', number: parentReplacementNumber, patch: { head: movedHead } },
    ])('refuses CLOSED replay when native $authority moves during its dependent thread read', async (testCase) => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true);
            await runSerialized(
                root,
                current.port,
                repairedLineage,
                serializeFixture,
                parentNumber,
                parentReplacementNumber
            );
            const replayStart = current.events.length;
            current.changeAuthorityDuringParentThreads(testCase.number, 1, testCase.patch);
            await expect(
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                )
            ).rejects.toThrow(/core identity changed/i);
            const replay = current.events.slice(replayStart);
            expect(replay).toContain(`authority-changed:${testCase.number}`);
            expect(replay.slice(replay.indexOf(`authority-changed:${testCase.number}`) + 1)).toContain(
                `core:${testCase.number}`
            );
            expect(replay.filter((event) => /^(?:comment|close|delete|pull-request-superseded:)/.test(event))).toEqual(
                []
            );
            expect(current.comments().map((comment) => comment.body)).toEqual([
                oldComment.body,
                receiptBody,
                lineageBody,
                current.bindingBody,
            ]);
        });
    });
    describe.each([
        ['receipt', supersessionCommentBody(parentReplacementNumber)],
        ['lineage', renderFindingLineage(distinctParentLineage)],
    ])('native parent %s binding', (_marker, body) => {
        it.each([
            ['removal', (comments: IssueComment[]) => comments.filter((comment) => comment.body !== body)],
            [
                'body change',
                (comments: IssueComment[]) =>
                    changeMarker(comments, body, (comment) => ({ ...comment, body: `${body}\nEdited` })),
            ],
            [
                'node identity change',
                (comments: IssueComment[]) =>
                    changeMarker(comments, body, (comment) => ({ ...comment, id: 'IC_changed_parent_marker' })),
            ],
            [
                'database identity change',
                (comments: IssueComment[]) =>
                    changeMarker(comments, body, (comment) => ({
                        ...comment,
                        fullDatabaseId: String(databaseBase + 50n),
                    })),
            ],
            [
                'actor change',
                (comments: IssueComment[]) =>
                    changeMarker(comments, body, (comment) => ({ ...comment, authorNodeId: REVIEWER_BOT_NODE_ID })),
            ],
            [
                'actor type change',
                (comments: IssueComment[]) =>
                    changeMarker(comments, body, (comment) => ({ ...comment, authorType: 'User' })),
            ],
            [
                'duplicate',
                (comments: IssueComment[]) => [
                    ...comments,
                    markerComment('IC_duplicate_parent_marker', String(databaseBase + 51n), body),
                ],
            ],
        ] satisfies [string, (comments: IssueComment[]) => IssueComment[]][])(
            'refuses %s during the final pre-close thread response before closing',
            async (_case, change) => {
                await withLockRoot(async (root) => {
                    const current = nativeSupersessionFixture(root, undefined, true, {}, { initialMarkers: false });
                    current.changeParentCommentsDuringParentThreads(3, change);
                    await expect(
                        runSerialized(
                            root,
                            current.port,
                            repairedLineage,
                            serializeFixture,
                            parentNumber,
                            parentReplacementNumber
                        )
                    ).rejects.toThrow(/parent.*(?:receipt|lineage|proof)/i);
                    const changedAt = current.events.indexOf('parent-markers-changed:3');
                    expect(changedAt).toBeGreaterThan(-1);
                    expect(current.events.slice(changedAt + 1)).toContain('parent-comments');
                    expect(current.state()).toBe('OPEN');
                    expect(current.events.filter((event) => event === 'comment')).toHaveLength(3);
                    expect(current.events.filter((event) => event === 'delete')).toHaveLength(3);
                    expect(current.comments()).toEqual([oldComment]);
                    expect(current.events.filter((event) => /^(?:close|pull-request-superseded:)/.test(event))).toEqual(
                        []
                    );
                    expect(
                        readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
                    ).toBeUndefined();
                });
            }
        );
        it('refuses CLOSED replay when the marker is revoked during its final thread response', async () => {
            await withLockRoot(async (root) => {
                const current = nativeSupersessionFixture(root, undefined, true);
                await runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                );
                const replayStart = current.events.length;
                current.changeParentCommentsDuringParentThreads(1, (comments) =>
                    comments.filter((comment) => comment.body !== body)
                );
                await expect(
                    runSerialized(
                        root,
                        current.port,
                        repairedLineage,
                        serializeFixture,
                        parentNumber,
                        parentReplacementNumber
                    )
                ).rejects.toThrow(/parent.*exactly one/i);
                const replay = current.events.slice(replayStart);
                const changedAt = replay.findIndex((event) => event.startsWith('parent-markers-changed:'));
                expect(changedAt).toBeGreaterThan(-1);
                expect(replay.slice(changedAt + 1)).toContain('parent-comments');
                expect(
                    replay.filter((event) => /^(?:comment|close|delete|pull-request-superseded:)/.test(event))
                ).toEqual([]);
                expect(current.state()).toBe('CLOSED');
                expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
                expect(current.comments().map((comment) => comment.body)).toEqual([
                    oldComment.body,
                    receiptBody,
                    lineageBody,
                    current.bindingBody,
                ]);
                expect(
                    readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
                ).toBeUndefined();
            });
        });
    });
    it.each([
        { phase: 'before write', read: 2, closed: false, created: 0 },
        { phase: 'after close', read: 4, closed: true, created: 3 },
    ])('refreshes the native parent receipt after its dependent thread response $phase', async (testCase) => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true, {}, { initialMarkers: false });
            current.changeParentCommentsDuringParentThreads(testCase.read, (comments) =>
                comments.filter((comment) => comment.body !== supersessionCommentBody(parentReplacementNumber))
            );
            await expect(
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                )
            ).rejects.toThrow(testCase.closed ? /ambiguous/i : /parent.*exactly one supersession receipt/i);
            expect(current.events).toContain(`parent-markers-changed:${testCase.read}`);
            expect(current.state()).toBe(testCase.closed ? 'CLOSED' : 'OPEN');
            expect(current.events.filter((event) => event === 'comment')).toHaveLength(testCase.created);
            expect(current.events.filter((event) => event === 'close')).toHaveLength(testCase.closed ? 1 : 0);
            expect(current.events.filter((event) => /^(?:delete|pull-request-superseded:)/.test(event))).toEqual([]);
            if (testCase.closed) {
                expect(current.comments().map((comment) => comment.body)).toEqual([
                    oldComment.body,
                    receiptBody,
                    lineageBody,
                    current.bindingBody,
                ]);
                expect(retainedOwner(root)).toBeDefined();
            } else {
                expect(current.comments()).toEqual([oldComment]);
                expect(
                    readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
                ).toBeUndefined();
            }
        });
    });
    it('keeps stable native parent markers valid through close and CLOSED replay without replay writes', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true);
            await expect(
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                )
            ).resolves.toBe('pull-request-superseded:2244:2246');
            const closeEvents = current.events.slice(0, current.events.indexOf('close'));
            expect(closeEvents.lastIndexOf('parent-comments')).toBeGreaterThan(
                closeEvents.lastIndexOf(`threads:${parentNumber}`)
            );
            expect(closeEvents.slice(closeEvents.lastIndexOf('parent-comments') + 1)).toContain(`core:${parentNumber}`);
            const replayStart = current.events.length;
            await expect(
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                )
            ).resolves.toBe('pull-request-superseded:2244:2246');
            const replay = current.events.slice(replayStart);
            expect(replay.lastIndexOf('parent-comments')).toBeGreaterThan(
                replay.lastIndexOf(`threads:${parentNumber}`)
            );
            expect(replay.slice(replay.lastIndexOf('parent-comments') + 1)).toContain(`core:${parentNumber}`);
            expect(replay.filter((event) => /^(?:comment|close|delete)$/.test(event))).toEqual([]);
            expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
            expect(current.comments().map((comment) => comment.body)).toEqual([
                oldComment.body,
                receiptBody,
                lineageBody,
                current.bindingBody,
            ]);
            expect(
                readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
            ).toBeUndefined();
        });
    });
    describe.each([
        ['target', { name: parentBranch, repository: 'jcosta33/sourdaw', target: movedHead }],
        ['name', { name: 'fix/rebound-parent', repository: 'jcosta33/sourdaw', target: parentHead }],
        ['repository', { name: parentBranch, repository: 'fork/sourdaw', target: parentHead }],
        ['disappearance', null],
    ] satisfies [string, ChildBaseRef][])('native final child live base ref %s', (_field, baseRef) => {
        it.each([false, true])(
            'refuses movement during the final parent marker read with CLOSED replay=%s',
            async (replay) => {
                await withLockRoot(async (root) => {
                    const current = nativeSupersessionFixture(root, undefined, true);
                    const run = () =>
                        runSerialized(
                            root,
                            current.port,
                            repairedLineage,
                            serializeFixture,
                            parentNumber,
                            parentReplacementNumber
                        );
                    if (replay) {
                        await run();
                    }
                    const start = current.events.length;
                    current.changeChildBaseDuringParentComments(replay ? 2 : 5, baseRef);
                    await expect(run()).rejects.toThrow(/core identity changed/i);
                    const observed = current.events.slice(start);
                    const changedAt = observed.findIndex((event) => event.startsWith('child-base-ref-changed:'));
                    expect(changedAt).toBeGreaterThan(-1);
                    let expectedObservation = 'old-base-ref:null';
                    if (baseRef !== null) {
                        expectedObservation = `old-base-ref:${JSON.stringify({
                            name: baseRef.name,
                            repository: { nameWithOwner: baseRef.repository },
                            target: { oid: baseRef.target },
                        })}`;
                    }
                    expect(observed.slice(changedAt + 1)).toContain(expectedObservation);
                    expect(observed.slice(changedAt + 1)).toContain('old-core');
                    expect(
                        observed.filter((event) => /^(?:comment|close|delete|pull-request-superseded:)/.test(event))
                    ).toEqual([]);
                    expect(current.state()).toBe(replay ? 'CLOSED' : 'OPEN');
                    expect(current.events.filter((event) => event === 'close')).toHaveLength(replay ? 1 : 0);
                    expect(current.comments().map((comment) => comment.body)).toEqual([
                        oldComment.body,
                        receiptBody,
                        lineageBody,
                        current.bindingBody,
                    ]);
                    const inspected = current.port.inspect(oldNumber);
                    expect(Object.hasOwn(inspected, 'baseRef')).toBe(true);
                    expect(inspected.baseRef).toEqual(baseRef);
                    expect(inspected.baseRefOid).toBe(parentHead);
                    expect(
                        readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
                    ).toBeUndefined();
                });
            }
        );
    });
    it('refuses a ref reappearing during CLOSED replay after initially admitted branch cleanup', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true);
            const run = () =>
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                );
            await run();
            current.setChildBaseRef(null);
            const cleaned = current.port.inspect(oldNumber);
            expect(Object.hasOwn(cleaned, 'baseRef')).toBe(true);
            expect(cleaned.baseRef).toBeNull();
            const replayStart = current.events.length;
            current.changeChildBaseDuringParentComments(2, {
                name: parentBranch,
                repository: 'jcosta33/sourdaw',
                target: parentHead,
            });
            await expect(run()).rejects.toThrow(/core identity changed/i);
            const replay = current.events.slice(replayStart);
            const changedAt = replay.findIndex((event) => event.startsWith('child-base-ref-changed:'));
            expect(changedAt).toBeGreaterThan(-1);
            expect(replay.slice(changedAt + 1)).toContain(
                `old-base-ref:${JSON.stringify({
                    name: parentBranch,
                    repository: { nameWithOwner: 'jcosta33/sourdaw' },
                    target: { oid: parentHead },
                })}`
            );
            expect(replay.slice(changedAt + 1)).toContain('old-core');
            expect(replay.filter((event) => /^(?:comment|close|delete|pull-request-superseded:)/.test(event))).toEqual(
                []
            );
            expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
            expect(current.comments().map((comment) => comment.body)).toEqual([
                oldComment.body,
                receiptBody,
                lineageBody,
                current.bindingBody,
            ]);
            expect(
                readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
            ).toBeUndefined();
        });
    });
    it('keeps stable native CLOSED replay valid after branch cleanup with projected authority refs present', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true);
            const run = () =>
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                );
            await run();
            current.setChildBaseRef(null);
            const replayStart = current.events.length;
            await expect(run()).resolves.toBe('pull-request-superseded:2244:2246');
            const replay = current.events.slice(replayStart);
            expect(replay).toContain('old-base-ref:null');
            expect(replay.filter((event) => /^(?:comment|close|delete)$/.test(event))).toEqual([]);
            expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
            const inspected = current.port.inspect(oldNumber);
            expect(Object.hasOwn(inspected, 'baseRef')).toBe(true);
            expect(inspected.baseRef).toBeNull();
            expect(inspected.baseRefOid).toBe(parentHead);
            expect(
                readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
            ).toBeUndefined();
        });
    });
    it.each([
        { label: 'stable SHA', cachedBaseOid: parentHead, omit: false, error: null, divergentReads: 0 },
        {
            label: 'divergent SHA present',
            cachedBaseOid: movedHead,
            omit: false,
            error: /cached child base to final parent ancestry is not proven/i,
            divergentReads: 1,
        },
        {
            label: 'same divergent SHA omitted',
            cachedBaseOid: movedHead,
            omit: true,
            error: /cached base commit/i,
            divergentReads: 0,
        },
    ])('requires selected cached-base evidence through native serialized closure: $label', async (scenario) => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(
                root,
                undefined,
                true,
                {},
                {
                    initialMarkers: false,
                    cachedBaseOid: scenario.cachedBaseOid,
                }
            );
            if (scenario.omit) {
                current.omitChildCachedBaseOidFromNativeResponse();
            }
            const run = () =>
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                );
            if (scenario.error !== null) {
                await expect(run()).rejects.toThrow(scenario.error);
                expect(current.state()).toBe('OPEN');
                expect(current.comments()).toEqual([oldComment]);
                expect(
                    current.events.filter((event) => /^(?:comment|close|delete|pull-request-superseded:)/.test(event))
                ).toEqual([]);
            } else {
                await expect(run()).resolves.toBe('pull-request-superseded:2244:2246');
                expect(current.state()).toBe('CLOSED');
                expect(current.events.filter((event) => event === 'comment')).toHaveLength(3);
                expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
                expect(current.events.filter((event) => event === 'delete')).toEqual([]);
                expect(current.events.filter((event) => event === 'pull-request-superseded:2244:2246')).toHaveLength(1);
                const binding = current.comments().find((comment) => comment.body === current.bindingBody);
                expect(binding).toBeDefined();
                if (binding === undefined) {
                    throw new Error('expected native cached-base binding');
                }
                expect(parseSupersessionParentBinding(binding.body).child.cachedBase).toBe(parentHead);
                current.setChildBaseRef(null);
                const replayStart = current.events.length;
                await expect(run()).resolves.toBe('pull-request-superseded:2244:2246');
                const replay = current.events.slice(replayStart);
                expect(replay).toContain('old-base-ref:null');
                expect(replay.filter((event) => /^(?:comment|close|delete)$/.test(event))).toEqual([]);
                const cleaned = current.port.inspect(oldNumber);
                expect(cleaned.baseRef).toBeNull();
                expect(cleaned.baseRefOid).toBe(parentHead);
                expect(parseSupersessionParentBinding(binding.body).child.cachedBase).toBe(parentHead);
                expect(current.comments()).toHaveLength(4);
            }
            const cachedReads = current.cachedBaseWirePresence();
            expect(cachedReads.length).toBeGreaterThan(0);
            for (const present of cachedReads) {
                expect(present).toBe(!scenario.omit);
            }
            expect(
                current.events.filter((event) => event === `cached-base-comparison:${movedHead}:${parentHead}:diverged`)
            ).toHaveLength(scenario.divergentReads);
            expect(
                readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
            ).toBeUndefined();
        });
    });
    it('refuses a missing selected cached SHA during CLOSED replay after live-ref cleanup', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true, {}, { initialMarkers: false });
            const run = () =>
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                );
            await run();
            const completedComments = [...current.comments()];
            current.setChildBaseRef(null);
            current.omitChildCachedBaseOidFromNativeResponse();
            const start = current.events.length;
            const cachedReadStart = current.cachedBaseWirePresence().length;
            await expect(run()).rejects.toThrow(/cached base commit/i);
            const observed = current.events.slice(start);
            expect(observed).toContain('old-base-ref:null');
            expect(current.cachedBaseWirePresence().slice(cachedReadStart)).toEqual([false]);
            expect(observed).not.toContain('old-comments');
            expect(
                observed.filter((event) => /^(?:comment|close|delete|pull-request-superseded:)/.test(event))
            ).toEqual([]);
            expect(current.state()).toBe('CLOSED');
            expect(current.comments()).toEqual(completedComments);
            expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
            expect(
                readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
            ).toBeUndefined();
        });
    });
    it.each(['jcosta33/sourdaw', 'fork/sourdaw', null])(
        'binds native registered late-parent provenance to child source %s',
        async (sourceRepository) => {
            await withLockRoot(async (root) => {
                const current = nativeSupersessionFixture(
                    root,
                    undefined,
                    true,
                    {},
                    {
                        initialMarkers: false,
                        lateParent: true,
                    }
                );
                registerNativeParent(root);
                current.setChildSource(sourceRepository);
                expect(current.port.inspect(oldNumber).headRepository).toBe(sourceRepository);
                expect(current.port.isCommitAncestor?.('jcosta33/sourdaw', parentHead, head)).toBe(false);
                const run = () =>
                    runSerialized(
                        root,
                        current.port,
                        repairedLineage,
                        serializeFixture,
                        parentNumber,
                        parentReplacementNumber
                    );
                if (sourceRepository === 'jcosta33/sourdaw') {
                    await expect(run()).resolves.toBe('pull-request-superseded:2244:2246');
                    const stored = current.comments().find((comment) => comment.body === current.bindingBody);
                    expect(stored).toBeDefined();
                    if (stored === undefined) {
                        throw new Error('expected native registered parent binding');
                    }
                    expect(parseSupersessionParentBinding(stored.body)).toMatchObject({
                        child: { sourceRepository },
                        provenance: { kind: 'registered-lane-stack' },
                    });
                    expect(current.state()).toBe('CLOSED');
                    expect(current.events.filter((event) => event === 'comment')).toHaveLength(3);
                    expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
                } else {
                    await expect(run()).rejects.toThrow(/head repository.*native registered parent provenance/i);
                    expect(current.state()).toBe('OPEN');
                    expect(current.comments()).toEqual([oldComment]);
                    expect(
                        current.events.filter((event) =>
                            /^(?:comment|close|delete|pull-request-superseded:)/.test(event)
                        )
                    ).toEqual([]);
                }
                expect(
                    readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
                ).toBeUndefined();
            });
        }
    );
    it('keeps native fork containment and cleanup replay independent of an unrelated local branch ledger', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true, {}, { initialMarkers: false });
            registerNativeParent(root, 9999);
            current.setChildSource('fork/sourdaw');
            const run = () =>
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                );
            await expect(run()).resolves.toBe('pull-request-superseded:2244:2246');
            const stored = current
                .comments()
                .find((comment) => comment.body.startsWith('sourdaw-supersession-parent-v1 '));
            expect(stored).toBeDefined();
            if (stored === undefined) {
                throw new Error('expected native fork parent binding');
            }
            expect(parseSupersessionParentBinding(stored.body)).toMatchObject({
                child: { sourceRepository: 'fork/sourdaw' },
                provenance: { kind: 'final-parent-head' },
            });
            current.setChildBaseRef(null);
            const start = current.events.length;
            await expect(run()).resolves.toBe('pull-request-superseded:2244:2246');
            expect(current.events.slice(start).filter((event) => /^(?:comment|close|delete)$/.test(event))).toEqual([]);
            expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
        });
    });
    it('rejects a native core response missing its selected live base ref before comment inspection', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true);
            current.omitChildBaseRefFromNativeResponse();
            expect(() => current.port.inspect(oldNumber)).toThrow(/selected live base ref/i);
            expect(current.events).toContain('old-core-wire-has-base-ref:false');
            expect(current.events).not.toContain('old-comments');
            expect(
                current.events.filter((event) => /^(?:comment|close|delete|pull-request-superseded:)/.test(event))
            ).toEqual([]);
        });
    });
    it.each([false, true])(
        'refuses an omitted selected live-ref witness before writes with CLOSED replay=%s',
        async (replay) => {
            await withLockRoot(async (root) => {
                const current = nativeSupersessionFixture(root, undefined, true);
                const run = () =>
                    runSerialized(
                        root,
                        current.port,
                        repairedLineage,
                        serializeFixture,
                        parentNumber,
                        parentReplacementNumber
                    );
                if (replay) {
                    await run();
                }
                current.setChildBaseRef({ name: parentBranch, repository: 'jcosta33/sourdaw', target: movedHead });
                current.omitChildBaseRefFromNativeResponse();
                const start = current.events.length;
                await expect(run()).rejects.toThrow(/selected live base ref/i);
                const observed = current.events.slice(start);
                expect(observed).toContain('old-core-wire-has-base-ref:false');
                expect(observed).toContain(
                    `old-base-ref:${JSON.stringify({
                        name: parentBranch,
                        repository: { nameWithOwner: 'jcosta33/sourdaw' },
                        target: { oid: movedHead },
                    })}`
                );
                expect(
                    observed.filter((event) => /^(?:comment|close|delete|pull-request-superseded:)/.test(event))
                ).toEqual([]);
                expect(current.state()).toBe(replay ? 'CLOSED' : 'OPEN');
                expect(current.comments().map((comment) => comment.body)).toEqual([
                    oldComment.body,
                    receiptBody,
                    lineageBody,
                    current.bindingBody,
                ]);
                expect(
                    readPullRequestMutationLockOid(root, pullRequestMutationLockRef(oldNumber), oldNumber)
                ).toBeUndefined();
            });
        }
    );
    it('distinguishes a missing projected ref from an explicitly owned undefined native expectation', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true);
            const parent = current.port.inspect(parentNumber);
            expect(parent.baseRef).toEqual({ name: 'main', repository: 'jcosta33/sourdaw', target: childMerge });
            const { baseRef: _unobservedRef, ...coreOnly } = parent;
            expect(Object.hasOwn(coreOnly, 'baseRef')).toBe(false);
            expect(() => current.port.assertCurrentPullRequest(parentNumber, coreOnly)).not.toThrow();
            const child = current.port.inspect(oldNumber);
            expect(Object.hasOwn(child, 'baseRef')).toBe(true);
            expect(() => current.port.assertCurrentPullRequest(oldNumber, { ...child, baseRef: undefined })).toThrow(
                /core identity changed/i
            );
            expect(() =>
                current.port.assertCurrentPullRequest(oldNumber, {
                    ...child,
                    baseRef: { target: parentHead, repository: 'jcosta33/sourdaw', name: parentBranch },
                })
            ).not.toThrow();
            current.setChildBaseRef(null);
            const cleaned = current.port.inspect(oldNumber);
            expect(() => current.port.assertCurrentPullRequest(oldNumber, { ...cleaned, baseRef: undefined })).toThrow(
                /core identity changed/i
            );
            expect(
                current.events.filter((event) => /^(?:comment|close|delete|pull-request-superseded:)/.test(event))
            ).toEqual([]);
        });
    });
    it('retains the native owner and markers when the live ref changes after close during the last parent marker read', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true);
            current.changeChildBaseDuringParentComments(7, {
                name: parentBranch,
                repository: 'jcosta33/sourdaw',
                target: movedHead,
            });
            await expect(
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                )
            ).rejects.toThrow(/core identity changed/i);
            const changedAt = current.events.indexOf('child-base-ref-changed:7');
            expect(changedAt).toBeGreaterThan(current.events.indexOf('close'));
            expect(current.events.slice(changedAt + 1)).toContain(
                `old-base-ref:${JSON.stringify({
                    name: parentBranch,
                    repository: { nameWithOwner: 'jcosta33/sourdaw' },
                    target: { oid: movedHead },
                })}`
            );
            expect(current.events.slice(changedAt + 1)).toContain('old-core');
            expect(current.state()).toBe('CLOSED');
            expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
            expect(
                current.events.filter((event) => /^(?:comment|delete|pull-request-superseded:)/.test(event))
            ).toEqual([]);
            expect(current.comments().map((comment) => comment.body)).toEqual([
                oldComment.body,
                receiptBody,
                lineageBody,
                current.bindingBody,
            ]);
            expect(retainedOwner(root)).toBeDefined();
        });
    });
    it('retains the native owner and every marker after an ambiguous third-marker write', async () => {
        await withLockRoot(async (root) => {
            const current = nativeSupersessionFixture(root, undefined, true, {}, { initialMarkers: false });
            const comment = current.port.comment;
            current.port.comment = (number, body) => {
                const result = comment(number, body);
                if (body === current.bindingBody) {
                    throw new Error('third marker response lost');
                }
                return result;
            };
            await expect(
                runSerialized(
                    root,
                    current.port,
                    repairedLineage,
                    serializeFixture,
                    parentNumber,
                    parentReplacementNumber
                )
            ).rejects.toThrow(/third marker response lost/i);
            expect(current.comments().map((entry) => entry.body)).toEqual([
                oldComment.body,
                receiptBody,
                lineageBody,
                current.bindingBody,
            ]);
            expect(current.events.filter((event) => /^(?:close|delete|pull-request-superseded:)/.test(event))).toEqual(
                []
            );
            const owner = retainedOwner(root);
            const retained = readPullRequestMutationLockOwner(root, owner, oldNumber);
            if (!isDeliveryPullRequestMutationLockOwner(retained)) {
                throw new Error('expected a journaled native delivery owner');
            }
            expect(retained.mutation.phase).toBe('remote-mutation-attempted');
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
        expect(source).toContain(
            'headRefOid headRefName headRepository{nameWithOwner} baseRefName baseRefOid merged closedAt'
        );
        expect(source).not.toMatch(/\bauthor\s*\{\s*id\b/);
        expect(source.match(/author\{login __typename \.\.\. on Bot\{id\}\}/g)).toHaveLength(2);
    });
    it.each<{ label: string; evidence: Record<string, unknown>; valid: boolean }>([
        {
            label: 'open with explicit nulls',
            evidence: { state: 'OPEN', merged: false, closedAt: null, mergeCommit: null },
            valid: true,
        },
        {
            label: 'closed without merge',
            evidence: { state: 'CLOSED', merged: false, closedAt: '2026-08-20T12:00:00Z', mergeCommit: null },
            valid: true,
        },
        {
            label: 'merged with full commit',
            evidence: {
                state: 'MERGED',
                merged: true,
                closedAt: '2026-08-20T12:00:00Z',
                mergeCommit: { oid: childMerge },
            },
            valid: true,
        },
        { label: 'missing selected merge commit', evidence: { mergeCommit: undefined }, valid: false },
        { label: 'missing selected merge oid', evidence: { mergeCommit: {} }, valid: false },
        { label: 'primitive selected merge commit', evidence: { mergeCommit: childMerge }, valid: false },
        { label: 'null selected merge oid', evidence: { mergeCommit: { oid: null } }, valid: false },
        { label: 'malformed selected merge oid', evidence: { mergeCommit: { oid: 'main' } }, valid: false },
        { label: 'short selected merge oid', evidence: { mergeCommit: { oid: 'a'.repeat(39) } }, valid: false },
        { label: 'uppercase selected merge oid', evidence: { mergeCommit: { oid: 'A'.repeat(40) } }, valid: false },
        { label: 'merged with null commit', evidence: { mergeCommit: null }, valid: false },
        { label: 'merged flag false', evidence: { merged: false }, valid: false },
        { label: 'merged without close time', evidence: { closedAt: null }, valid: false },
        { label: 'merged with empty close time', evidence: { closedAt: '' }, valid: false },
        { label: 'merged with malformed close time', evidence: { closedAt: 'unavailable' }, valid: false },
        { label: 'missing selected close time', evidence: { closedAt: undefined }, valid: false },
        { label: 'missing selected merged flag', evidence: { merged: undefined }, valid: false },
        { label: 'malformed selected merged flag', evidence: { merged: 'true' }, valid: false },
        { label: 'unknown state', evidence: { state: 'UNKNOWN' }, valid: false },
        { label: 'closed with merged flag', evidence: { state: 'CLOSED' }, valid: false },
        { label: 'closed without merge with commit', evidence: { state: 'CLOSED', merged: false }, valid: false },
        {
            label: 'closed without close time',
            evidence: { state: 'CLOSED', merged: false, closedAt: null, mergeCommit: null },
            valid: false,
        },
        { label: 'open with close time', evidence: { state: 'OPEN', merged: false, mergeCommit: null }, valid: false },
        {
            label: 'open with merged flag',
            evidence: { state: 'OPEN', closedAt: null, mergeCommit: null },
            valid: false,
        },
        { label: 'open with commit', evidence: { state: 'OPEN', merged: false, closedAt: null }, valid: false },
    ])('validates native selected closure evidence: $label', ({ evidence, valid }) => {
        const calls: string[][] = [];
        const inspect = () =>
            inspectPullRequest(
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
                                        baseRefOid: childMerge,
                                        baseRef: null,
                                        closedAt: '2026-08-20T12:00:00Z',
                                        mergeCommit: { oid: childMerge },
                                        ...evidence,
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
        if (valid) {
            const value = inspect();
            expect(value.mergeCommit).toBe(evidence.mergeCommit === null ? null : childMerge);
            expect(value.headRepository).toBeNull();
            expect(value.baseRef).toBeNull();
            expect(calls).toHaveLength(2);
        } else {
            expect(inspect).toThrow(/cannot inspect PR #2246/i);
            expect(calls).toHaveLength(1);
        }
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
                                    mergeCommit: null,
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
    it.each([undefined, null, '', 'bad', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), 42, { oid: head }])(
        'rejects unavailable or malformed selected cached base %j before reading comments',
        (baseRefOid) => {
            const calls: string[][] = [];
            expect(() =>
                inspectPullRequest(
                    oldNumber,
                    (args) => {
                        calls.push(args);
                        return JSON.stringify({
                            data: {
                                repository: {
                                    nameWithOwner: 'jcosta33/sourdaw',
                                    pullRequest: {
                                        id: 'PR_old',
                                        number: oldNumber,
                                        state: 'OPEN',
                                        headRefOid: head,
                                        headRefName: 'fix/old',
                                        headRepository: { nameWithOwner: 'jcosta33/sourdaw' },
                                        baseRefName: parentBranch,
                                        baseRefOid,
                                        baseRef: null,
                                        merged: false,
                                        closedAt: null,
                                    },
                                },
                            },
                        });
                    },
                    new Map()
                )
            ).toThrow(/cached base commit/i);
            expect(calls).toHaveLength(1);
            expect(calls[0]?.join(' ')).toContain('baseRefName baseRefOid');
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
                    total_commits: 3,
                    commits: comparisonCommits(3, replacementHead),
                });
            })
        ).toBe(true);
        expect(calls).toEqual([['api', `repos/jcosta33/sourdaw/compare/${parentMerge}...${replacementHead}`]]);
    });
    it('binds the terminal head of a capped unpaginated comparison without requiring all commits', () => {
        expect(
            inspectCommitAncestry('jcosta33/sourdaw', parentMerge, replacementHead, () =>
                JSON.stringify({
                    url: `https://api.github.com/repos/jcosta33/sourdaw/compare/${parentMerge}...${replacementHead}`,
                    base_commit: { sha: parentMerge },
                    merge_base_commit: { sha: parentMerge },
                    status: 'ahead',
                    ahead_by: 300,
                    behind_by: 0,
                    total_commits: 300,
                    commits: comparisonCommits(250, replacementHead),
                })
            )
        ).toBe(true);
    });
    it('accepts identical immutable objects without a terminal commit', () => {
        expect(
            inspectCommitAncestry('jcosta33/sourdaw', parentMerge, parentMerge, () =>
                JSON.stringify({
                    url: `https://api.github.com/repos/jcosta33/sourdaw/compare/${parentMerge}...${parentMerge}`,
                    base_commit: { sha: parentMerge },
                    merge_base_commit: { sha: parentMerge },
                    status: 'identical',
                    ahead_by: 0,
                    behind_by: 0,
                    total_commits: 0,
                    commits: [],
                })
            )
        ).toBe(true);
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
                    total_commits: aheadBy,
                    commits: comparisonCommits(aheadBy, replacementHead),
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
        ['missing commit-set total', { total_commits: undefined }],
        ['contradictory commit-set total', { total_commits: 1 }],
        ['contradictory counts', { behind_by: 1 }],
        ['wrong terminal object', { commits: comparisonCommits(3, movedHead) }],
        ['missing terminal object', { commits: undefined }],
        ['empty terminal object', { commits: [] }],
        ['malformed terminal object', { commits: comparisonCommits(3, 'main') }],
        ['contradictory terminal object', { commits: [{ sha: head }, { sha: replacementHead }, { sha: parentMerge }] }],
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
                total_commits: 3,
                commits: comparisonCommits(3, replacementHead),
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
        expect(calls.filter((call) => call === ancestry)).toEqual(Array(4).fill(ancestry));
        expect(calls).toContain(`ancestor:jcosta33/sourdaw:${parentHead}:${head}`);
        expect(calls.indexOf(ancestry)).toBeLessThan(calls.findIndex((call) => call.startsWith('comment:')));
        expect(state().comments.map((comment) => comment.body)).toEqual([
            oldComment.body,
            receiptBody,
            lineageBody,
            distinctBindingBody,
        ]);
        expect(state().state).toBe('CLOSED');
        const writes = calls.filter((call) => /^(?:comment|close|delete):/.test(call));
        expect(runWithDistinctParent(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual(writes);
    });

    it.each([false, true])(
        'binds a real Git parent head to its old child with distinct replacements=%s',
        async (distinct) => {
            await withLockRoot(async (root) => {
                const current = realDependencyFixture(root, 'direct', distinct);
                expect(current.dag.ancestor(current.dag.originalParent, current.dag.oldChild)).toBe(true);
                expect(current.run()).toBe('pull-request-superseded:2244:2246');
                const marker = current
                    .state()
                    .comments.find((comment) => comment.body.startsWith('sourdaw-supersession-parent-v1 '));
                expect(marker).toBeDefined();
                expect(parseSupersessionParentBinding(marker!.body)).toMatchObject({
                    child: { head: current.dag.oldChild },
                    parent: { number: parentNumber, head: current.dag.originalParent },
                    provenance: { kind: 'final-parent-head', forkHead: current.dag.originalParent },
                });
                expect(current.calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
            });
        }
    );

    it.each([false, true])(
        'refuses a real unrelated reused parent despite coherent refs and replacement ancestry, distinct=%s',
        async (distinct) => {
            await withLockRoot(async (root) => {
                const current = realDependencyFixture(root, 'unrelated', distinct);
                expect(current.dag.ancestor(current.dag.reusedParent, current.dag.oldChild)).toBe(false);
                expect(current.dag.ancestor(current.dag.parentReplacementMerge, current.dag.replacementHead)).toBe(
                    true
                );
                expect(current.dag.ancestor(current.dag.originalParent, current.dag.replacementHead)).toBe(false);
                expect(
                    spawnSync('git', ['cat-file', '-e', `${current.dag.oldChild}:original-dependency.txt`], {
                        cwd: root,
                    }).status
                ).toBe(0);
                expect(
                    spawnSync('git', ['cat-file', '-e', `${current.dag.replacementHead}:original-dependency.txt`], {
                        cwd: root,
                    }).status
                ).not.toBe(0);
                expect(() => current.run()).toThrow(/native registered parent provenance/i);
                expect(current.state().state).toBe('OPEN');
                expect(current.calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
            });
        }
    );

    it.each([false, true])(
        'admits a real registered late parent and replays its binding after local cleanup, distinct=%s',
        async (distinct) => {
            await withLockRoot(async (root) => {
                const current = realDependencyFixture(root, 'late', distinct);
                expect(current.dag.ancestor(current.dag.finalParent, current.dag.oldChild)).toBe(false);
                current.register();
                expect(current.run()).toBe('pull-request-superseded:2244:2246');
                const stored = current
                    .state()
                    .comments.find((comment) => comment.body.startsWith('sourdaw-supersession-parent-v1 '));
                expect(stored).toBeDefined();
                expect(parseSupersessionParentBinding(stored!.body)).toMatchObject({
                    child: { cachedBase: current.dag.base, sourceRepository: 'jcosta33/sourdaw' },
                    provenance: {
                        kind: 'registered-lane-stack',
                        forkHead: current.dag.originalParent,
                        admittedParentHead: current.dag.originalParent,
                    },
                });
                const writes = current.calls.filter((call) => /^(?:comment|close|delete):/.test(call));
                rmSync(join(root, '.agents/lane-stacks'), { recursive: true });
                execFileSync('git', ['config', '--unset', 'branch.fix/old-pull-request.sourdaw-stack-fork'], {
                    cwd: root,
                });
                const inspect = current.port.inspect;
                current.port.inspect = (number) => {
                    const value = inspect(number);
                    if (number === oldNumber) {
                        return { ...value, baseRef: null, baseRefOid: current.dag.finalParent };
                    }
                    return value;
                };
                expect(current.run()).toBe('pull-request-superseded:2244:2246');
                expect(current.calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual(writes);
                expect(current.state().comments).toContainEqual(stored);
            });
        }
    );

    it.each(['fork/sourdaw', null])(
        'refuses real registered provenance borrowed by child source %s',
        async (sourceRepository) => {
            await withLockRoot(async (root) => {
                const current = realDependencyFixture(root, 'late', true);
                current.register();
                const inspect = current.port.inspect;
                current.port.inspect = (number) => {
                    const value = inspect(number);
                    if (number === oldNumber) {
                        return { ...value, headRepository: sourceRepository };
                    }
                    return value;
                };
                expect(current.dag.ancestor(current.dag.originalParent, current.dag.oldChild)).toBe(true);
                expect(current.dag.ancestor(current.dag.finalParent, current.dag.oldChild)).toBe(false);
                expect(() => current.run()).toThrow(/head repository.*native registered parent provenance/i);
                expect(current.state().state).toBe('OPEN');
                expect(current.calls.filter((call) => /^(?:comment|close|delete|log):/.test(call))).toEqual([]);
            });
        }
    );
    it.each(['fork/sourdaw', null])(
        'preserves real final-parent containment for child source %s despite another local ledger',
        async (initialSource) => {
            await withLockRoot(async (root) => {
                const current = realDependencyFixture(root, 'direct', true);
                current.register({ parentPullRequest: 9999 });
                let sourceRepository: string | null = initialSource;
                let deletedRef = false;
                const inspect = current.port.inspect;
                current.port.inspect = (number) => {
                    const value = inspect(number);
                    if (number !== oldNumber) {
                        return value;
                    }
                    let baseRef = value.baseRef;
                    if (deletedRef) {
                        baseRef = null;
                    }
                    return { ...value, baseRef, headRepository: sourceRepository };
                };
                expect(current.dag.ancestor(current.dag.originalParent, current.dag.oldChild)).toBe(true);
                expect(current.run()).toBe('pull-request-superseded:2244:2246');
                const stored = current
                    .state()
                    .comments.find((comment) => comment.body.startsWith('sourdaw-supersession-parent-v1 '));
                expect(stored).toBeDefined();
                if (stored === undefined) {
                    throw new Error('expected source-bound pure ancestry marker');
                }
                expect(parseSupersessionParentBinding(stored.body)).toMatchObject({
                    child: { sourceRepository: initialSource },
                    provenance: { kind: 'final-parent-head' },
                });
                const writes = current.calls.filter((call) => /^(?:comment|close|delete):/.test(call));
                deletedRef = true;
                expect(current.run()).toBe('pull-request-superseded:2244:2246');
                sourceRepository = 'another/sourdaw';
                expect(() => current.run()).toThrow(/child source repository changed/i);
                expect(current.calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual(writes);
                expect(current.state().comments).toContainEqual(stored);
            });
        }
    );
    it.each(['fork/sourdaw', null])(
        'refuses registered replay source %s after local ledger and base-ref cleanup',
        async (sourceRepository) => {
            await withLockRoot(async (root) => {
                const current = realDependencyFixture(root, 'late', true);
                current.register();
                expect(current.run()).toBe('pull-request-superseded:2244:2246');
                const writes = current.calls.filter((call) => /^(?:comment|close|delete):/.test(call));
                rmSync(join(root, '.agents/lane-stacks'), { recursive: true });
                execFileSync('git', ['config', '--unset', 'branch.fix/old-pull-request.sourdaw-stack-fork'], {
                    cwd: root,
                });
                const inspect = current.port.inspect;
                current.port.inspect = (number) => {
                    const value = inspect(number);
                    if (number === oldNumber) {
                        return { ...value, baseRef: null, headRepository: sourceRepository };
                    }
                    return value;
                };
                expect(() => current.run()).toThrow(/child source repository changed/i);
                expect(current.calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual(writes);
                expect(current.calls.filter((call) => call.startsWith('log:'))).toHaveLength(1);
            });
        }
    );
    it.each([
        'missing',
        'wrong parent PR',
        'wrong parent branch',
        'fork not in parent',
        'fork marker mismatch',
    ] as const)('refuses a real late-parent dependency with %s native provenance', async (scenario) => {
        await withLockRoot(async (root) => {
            const current = realDependencyFixture(root, 'late', true);
            if (scenario === 'wrong parent PR') {
                current.register({ parentPullRequest: 9999 });
            } else if (scenario === 'wrong parent branch') {
                current.register({ parentBranch: 'fix/unrelated' });
            } else if (scenario === 'fork not in parent') {
                current.register({ forkHead: current.dag.oldChild });
            } else if (scenario === 'fork marker mismatch') {
                current.register();
                execFileSync(
                    'git',
                    ['config', 'branch.fix/old-pull-request.sourdaw-stack-fork', current.dag.reusedParent],
                    { cwd: root }
                );
            }
            expect(() => current.run()).toThrow(/provenance|fork|descriptor|ancestry/i);
            expect(current.calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
            expect(current.state().state).toBe('OPEN');
        });
    });

    it('strictly parses the preserved canonical parent binding', () => {
        expect(parseSupersessionParentBinding(parentBindingBody)).toEqual(parentBinding);
        const extra = { ...parentBinding, unexpected: true };
        expect(() => parseSupersessionParentBinding(`sourdaw-supersession-parent-v1 ${canonicalJson(extra)}`)).toThrow(
            /keys/i
        );
        expect(() =>
            parseSupersessionParentBinding(`sourdaw-supersession-parent-v1 ${JSON.stringify(parentBinding)}`)
        ).toThrow(/canonical/i);
        expect(() =>
            parseSupersessionParentBinding(
                parentBindingBody.replace('"format":', '"format":"supersession-parent-v1","format":')
            )
        ).toThrow(/canonical/i);
        const { cachedBase, ...childWithoutBase } = parentBinding.child;
        const unbound = { ...parentBinding, child: { ...childWithoutBase, unboundBase: cachedBase } };
        expect(() =>
            parseSupersessionParentBinding(`sourdaw-supersession-parent-v1 ${canonicalJson(unbound)}`)
        ).toThrow(/keys/i);
        expect(() =>
            parseSupersessionParentBinding(
                parentBindingBody.replace('"admittedParentHead":null', `"admittedParentHead":"${parentHead}"`)
            )
        ).toThrow(/contradictory/i);
        const { sourceRepository: _source, ...legacyChild } = parentBinding.child;
        expect(() =>
            parseSupersessionParentBinding(
                `sourdaw-supersession-parent-v1 ${canonicalJson({ ...parentBinding, child: legacyChild })}`
            )
        ).toThrow(/keys/i);
        expect(() =>
            parseSupersessionParentBinding(
                `sourdaw-supersession-parent-v1 ${canonicalJson({
                    ...parentBinding,
                    child: { ...parentBinding.child, sourceRepository: 42 },
                })}`
            )
        ).toThrow(/child source repository.*string/i);
    });

    it.each(['fork/sourdaw', null])(
        'rejects a canonical registered binding attesting source %s',
        (sourceRepository) => {
            const record = {
                ...parentBinding,
                child: { ...parentBinding.child, sourceRepository },
                provenance: { kind: 'registered-lane-stack', forkHead: parentHead, admittedParentHead: parentHead },
            };
            expect(() =>
                parseSupersessionParentBinding(`sourdaw-supersession-parent-v1 ${canonicalJson(record)}`)
            ).toThrow(/registered child source repository is invalid/i);
        }
    );

    it.each([
        'missing',
        'foreign',
        'duplicate',
        'malformed',
        'different parent',
        'contradictory descriptor',
        'missing child source',
    ] as const)('refuses CLOSED dependency replay with %s preserved binding', async (scenario) => {
        await withLockRoot(async (root) => {
            const current = realDependencyFixture(root, 'late', true);
            current.register();
            expect(current.run()).toBe('pull-request-superseded:2244:2246');
            const writes = current.calls.filter((call) => /^(?:comment|close|delete):/.test(call));
            const inspect = current.port.inspect;
            current.port.inspect = (number) => {
                const value = inspect(number);
                if (number !== oldNumber) {
                    return value;
                }
                const comments = value.comments.flatMap((comment) => {
                    if (!comment.body.startsWith('sourdaw-supersession-parent-v1 ')) {
                        return [comment];
                    }
                    if (scenario === 'missing') {
                        return [];
                    }
                    if (scenario === 'foreign') {
                        return [{ ...comment, authorNodeId: REVIEWER_BOT_NODE_ID }];
                    }
                    if (scenario === 'duplicate') {
                        return [comment, { ...comment, id: 'IC_duplicate_binding' }];
                    }
                    if (scenario === 'malformed') {
                        return [{ ...comment, body: `${comment.body}\nextra` }];
                    }
                    if (scenario === 'missing child source') {
                        const record = parseSupersessionParentBinding(comment.body);
                        const { sourceRepository: _source, ...child } = record.child;
                        return [
                            {
                                ...comment,
                                body: `sourdaw-supersession-parent-v1 ${canonicalJson({ ...record, child })}`,
                            },
                        ];
                    }
                    if (scenario === 'different parent') {
                        const record = parseSupersessionParentBinding(comment.body);
                        if (record.format !== 'supersession-parent-v1') {
                            throw new Error('expected the original v1 replay fixture');
                        }
                        return [
                            {
                                ...comment,
                                body: bindingBody({ ...record, parent: { ...record.parent, number: 9999 } }),
                            },
                        ];
                    }
                    return [comment];
                });
                return { ...value, baseRef: null, comments };
            };
            if (scenario === 'contradictory descriptor') {
                const read = current.port.readRegisteredLaneStack;
                current.port.readRegisteredLaneStack = (branch) => {
                    const stack = read?.(branch);
                    if (stack === undefined) {
                        throw new Error('expected registered fixture');
                    }
                    return { ...stack, parentPullRequest: 9999 };
                };
            }
            expect(() => current.run()).toThrow(/binding|provenance|JSON|canonical/i);
            expect(current.calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual(writes);
            expect(current.calls.filter((call) => call.startsWith('log:'))).toHaveLength(1);
        });
    });

    it('never infers the distinct replacement from the parent receipt', () => {
        const { port, calls } = distinctPort();
        expect(() => runWithParent(port)).toThrow(/does not name replacement PR #2246/i);
        expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
    });

    it('keeps missing-ref replay separate from a distinct parent replacement during fresh admission', () => {
        const { port, calls } = distinctPort({ baseRefs: [null] });
        expect(() => runWithDistinctParent(port)).toThrow(/live base ref is missing/i);
        expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
    });

    it('retains the distinct parent replacement when replaying after later base-ref deletion', () => {
        const { port, calls } = distinctPort();
        expect(runWithDistinctParent(port)).toBe('pull-request-superseded:2244:2246');
        const writes = calls.filter((call) => /^(?:comment|close|delete):/.test(call));
        const inspect = port.inspect;
        port.inspect = (number) => {
            const value = inspect(number);
            if (number === oldNumber) {
                return { ...value, baseRef: null };
            }
            return value;
        };
        expect(runWithDistinctParent(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual(writes);
    });

    it('reports ambiguity when the closed child head moves, retaining all stacked markers', () => {
        const { port, calls, state } = distinctPort(
            {},
            {
                atBoundary: { phase: 'after-close', number: oldNumber, patch: { head: movedHead } },
            }
        );
        expect(() => runWithDistinctParent(port)).toThrow(/ambiguous/i);
        expect(state().state).toBe('CLOSED');
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([`close:${oldNumber}`]);
        expect(state().comments.map((comment) => comment.body)).toEqual([
            oldComment.body,
            receiptBody,
            lineageBody,
            distinctBindingBody,
        ]);
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
                const baseInspect = port.inspect;
                let parentReads = 0;
                let changed = false;
                port.inspect = (pr) => {
                    const value = baseInspect(pr);
                    if (pr === parentNumber && ++parentReads === boundary * 2) {
                        changed = true;
                    }
                    return value;
                };
                port.inspectReviewThreads = (pr) => {
                    const findings = baseRead(pr);
                    if (pr === number && changed) {
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
        const { isCommitAncestor: _isCommitAncestor, ...withoutAncestry } = port;
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
                const { port, calls, state } = distinctPort({}, { atBoundary: { phase: boundary, number, patch } });
                const execute = () => runWithDistinctParent(port);
                if (boundary === 'after-close') {
                    expect(execute, `${_case}: ${boundary}`).toThrow(/ambiguous/i);
                } else {
                    expect(execute, `${_case}: ${boundary}`).toThrow();
                }
                expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
                if (boundary === 'before-write') {
                    expect(calls.filter((call) => /^(?:comment|close|delete):/.test(call))).toEqual([]);
                    expect(state().state).toBe('OPEN');
                } else if (boundary === 'before-close') {
                    expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
                    expect(state().comments).toEqual([oldComment]);
                    expect(state().state).toBe('OPEN');
                } else {
                    expect(state().state).toBe('CLOSED');
                    expect(state().comments.map((comment) => comment.body)).toEqual([
                        oldComment.body,
                        receiptBody,
                        lineageBody,
                        distinctBindingBody,
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
            parentBindingComments: [markerComment('IC_parent_binding', '2100', parentBindingBody)],
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
            parentBindingComments: [markerComment('IC_parent_binding', '2100', parentBindingBody)],
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
            parentBindingComments: [markerComment('IC_parent_binding', '2100', parentBindingBody)],
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
            parentBindingComments: [markerComment('IC_parent_binding', '2100', parentBindingBody)],
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
                const parentRead = { 'before-write': 2, 'before-close': 4, 'after-close': 6 }[phase];
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
                        parentBindingBody,
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
                if (number === parentNumber && ++parentReads === 6) {
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
                parentBindingBody,
            ]);
            expect(calls.filter((call) => /^(?:delete|log):/.test(call))).toEqual([]);
        }
    );
    it.each([null, 'fork-owner/sourdaw'])('does not require a %s replacement head repository', (headRepository) => {
        const { port, calls } = fakePort({ replacementHeadRepository: headRepository });
        expect(run(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it('keeps a same-replacement parent path with historical parent containment and no live replacement ref', () => {
        const { port, calls } = fakePort({
            bases: [parentBranch, parentBranch, parentBranch, parentBranch],
            replacementHeadRepository: null,
        });
        const comparisons: [string, string][] = [];
        port.isCommitAncestor = (_repository, ancestor, descendant) => {
            comparisons.push([ancestor, descendant]);
            return true;
        };
        expect(runWithParent(port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
        expect(comparisons).toContainEqual([parentHead, head]);
        expect(comparisons).not.toContainEqual([parentMerge, replacementHead]);
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
        expect(state().comments.map((comment) => comment.body)).toEqual([
            oldComment.body,
            receiptBody,
            lineageBody,
            parentBindingBody,
        ]);
        expect(calls.filter((call) => call.startsWith('delete:') || call.startsWith('log:'))).toEqual([]);
    });
    describe.each([
        ['receipt', receiptBody],
        ['lineage', lineageBody],
        ['parent binding', parentBindingBody],
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
            'parent binding removal',
            (comments: IssueComment[]) => comments.filter((comment) => comment.body !== parentBindingBody),
        ],
        [
            'parent binding identity replacement',
            (comments: IssueComment[]) =>
                changeMarker(comments, parentBindingBody, () =>
                    markerComment('IC_replacement_binding', String(databaseBase + 502n), parentBindingBody)
                ),
        ],
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
            parentCommentsByInspection: [
                validParentComments,
                validParentComments,
                validParentComments,
                changedParentComments,
            ],
        });
        expect(() => runWithParent(port)).toThrow(/proof changed during supersession/i);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([
            'delete:IC_post_1',
            'delete:IC_post_2',
            'delete:IC_post_3',
        ]);
        expect(state().comments).toEqual([oldComment]);
    });
    it.each([false, true])(
        'reuses existing child markers with preserved binding=%s while revalidating the parent',
        (bound) => {
            const { port, calls } = fakePort({
                bases: [parentBranch, parentBranch, parentBranch, parentBranch],
                existingCommentCount: 1,
                existingLineageCount: 1,
                parentBindingComments: bound ? [markerComment('IC_parent_binding', '2100', parentBindingBody)] : [],
            });
            expect(runWithParent(port)).toBe('pull-request-superseded:2244:2246');
            expect(calls.filter((call) => call.startsWith('comment:'))).toEqual(
                bound ? [] : [`comment:2244:${parentBindingBody}`]
            );
            expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
            expect(calls.filter((call) => call === `inspect:${parentNumber}`)).toHaveLength(7);
        }
    );
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
                    input.parentBindingComments = [markerComment('IC_parent_binding', '2100', parentBindingBody)];
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
                    mode === 'fresh' ? 7 : 2
                );
                expect(calls.filter((call) => call === `threads:${parentNumber}`)).toHaveLength(
                    mode === 'fresh' ? 4 : 1
                );
                expect(state().state).toBe('CLOSED');
                expect(calls.filter((call) => /^(?:comment|close):/.test(call))).toHaveLength(mode === 'fresh' ? 4 : 0);
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
                    input.parentCommentsByInspection = [
                        validParentComments,
                        validParentComments,
                        validParentComments,
                        [],
                    ];
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
                        'delete:IC_post_3',
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
                        parentBindingBody,
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

describe('native read-only main parent completion inspection', () => {
    const selection = { parentNumber, head: parentHead, replacementNumber, sourceCommit: '9'.repeat(40) };
    it('uses the canonical receipt and total lineage with final core witnesses and no mutation or lock', () => {
        const { port, calls } = fakePort();
        const witnesses: number[] = [];
        const noMutation = () => {
            throw new Error('mutation forbidden');
        };
        const lock = vi.spyOn(mutationOwnership, 'withPullRequestMutationLock').mockImplementation(noMutation);
        try {
            const raw = inspectNativeParentCompletion(selection, {
                inspect: port.inspect,
                inspectReviewThreads: port.inspectReviewThreads,
                assertCurrentPullRequest: (number) => {
                    witnesses.push(number);
                },
            });
            const proof = JSON.parse(raw);
            expect(raw).toBe(canonicalJson(proof));
            expect(proof).toMatchObject({
                version: 1,
                sourceCommit: selection.sourceCommit,
                parent: { number: parentNumber, head: parentHead, state: 'CLOSED' },
                replacement: { number: replacementNumber, mergeCommit: childMerge },
                receipt: { body: receiptBody, authorNodeId: AUTHOR_BOT_NODE_ID },
                lineage: { body: parentLineageBody },
                findingIds: [],
            });
            expect(witnesses).toEqual([parentNumber, replacementNumber]);
            expect(calls.filter((call) => /^(comment|close|delete):/.test(call))).toEqual([]);
            expect(lock).not.toHaveBeenCalled();
        } finally {
            lock.mockRestore();
        }
    });
    it.each([
        { parentStates: ['OPEN'] },
        { parentMerged: true },
        { parentHeadRepositories: ['other/repo'] },
        { parentBases: ['release'] },
        { replacementState: 'CLOSED' },
        { replacementBases: ['release'] },
        { parentComments: [validParentComments[0]] },
        { parentComments: [...validParentComments, validParentComments[0]] },
        {
            parentComments: [
                markerComment('foreign', '123', receiptBody, 'Bot', REVIEWER_BOT_NODE_ID),
                validParentComments[1],
            ],
        },
        { parentThreads: [{ threadId: 'new-root', rootCommentId: '3001' }] },
        { parentHeads: [parentHead, movedHead] },
        { parentThreadsByRead: [[], [{ threadId: 'new-root', rootCommentId: '3001' }]] },
    ] satisfies Input[])('refuses invalid or moving completion evidence %j', (input) => {
        const { port, calls } = fakePort(input);
        expect(() => inspectNativeParentCompletion(selection, port)).toThrow();
        expect(calls.filter((call) => /^(comment|close|delete):/.test(call))).toEqual([]);
    });
    it('fails when either final independent core witness moves', () => {
        for (const moved of [parentNumber, replacementNumber]) {
            const { port } = fakePort();
            expect(() =>
                inspectNativeParentCompletion(selection, {
                    ...port,
                    assertCurrentPullRequest: (number) => {
                        if (number === moved) throw new Error('final core moved');
                    },
                })
            ).toThrow('final core moved');
        }
    });
    it('bounds the wire and never treats unknown inspection argv as closure', () => {
        const { port } = fakePort({
            parentComments: [markerComment('x'.repeat(32768), '123', receiptBody), validParentComments[1]],
        });
        expect(() => inspectNativeParentCompletion(selection, port)).toThrow('inspection bound');
        const args = [
            '--inspect-parent-completion',
            '--parent-pr',
            String(parentNumber),
            '--expected-head',
            parentHead,
            '--replacement',
            String(replacementNumber),
        ];
        expect(parseSupersedePullRequestArgs(args).inspection).toEqual({
            parentNumber,
            head: parentHead,
            replacementNumber,
        });
        for (const wrong of [
            [...args, '--lineage', '/private'],
            [...args, '--help'],
            args.slice(0, -1),
            args.map((arg) => (arg === '--expected-head' ? '--head' : arg)),
        ]) {
            expect(() => parseSupersedePullRequestArgs(wrong)).toThrow('inspection arguments');
        }
    });
});
