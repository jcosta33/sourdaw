import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID, type GhSession } from '../githubAppIdentity.ts';
import {
    REPAIR_USAGE,
    coordinateRepairReviewFinding,
    defaultRepairReviewFindingCoordinatorDependencies,
    isAncestorExitStatus,
    parseRepairEvidence,
    parseRepairReviewFindingArgs,
    postRepairReply,
    readRepairReviewThread,
    recordClientMutationId,
    repairReviewFinding,
    runRepairReviewFindingCli,
    shellIsAncestor,
    shellPort,
    type RepairReviewFindingCoordinatorDependencies,
    type RepairReviewFindingInput,
    type RepairReviewFindingPort,
    type RepairReviewFindingThread,
} from '../repairReviewFinding.ts';
import { parseReviewRepairReply, renderReviewRepairReply } from '../reviewRepair.ts';

import type { ReviewRepairRecord } from '../reviewRepair.ts';

const PR = 3_000;
const THREAD = 'PRRT_kwDOrepair';
const OTHER_THREAD = 'PRRT_kwDOother';
const HEAD = 'a'.repeat(40);
const BASE = 'f'.repeat(40);
const MOVED_HEAD = 'c'.repeat(40);
const COMMIT = 'b'.repeat(40);
const OTHER_COMMIT = 'd'.repeat(40);
const ROOT_COMMENT_ID = 5_001;
const ROOT_COMMENT_NODE_ID = 'PRRC_kwDOrepairRoot';
const FINDING_PATH = 'scripts/repairReviewFinding.ts';
const FINDING_LINE = 42;
const SUMMARY = 'Bind the repair to the commit that addresses it.';

const EVIDENCE_ENTRY = {
    observable: 'the repair reply carries one marker line',
    verification: 'pnpm test:run scripts/__tests__/repairReviewFinding.spec.ts',
    observed: 'one marker line on the posted body',
};

/**
 * Composed at runtime from fragments: the pull-request diff secret scan is a required gate and
 * matches a contiguous credential literal in source.
 */
const CREDENTIAL_SHAPED = ['gh', 'p', '_', 'A'.repeat(24)].join('');

function repairReply(id: number, body: string, authorNodeId: string = AUTHOR_BOT_NODE_ID) {
    return { id, body, authorNodeId };
}

function threadState(overrides: Partial<RepairReviewFindingThread> = {}): RepairReviewFindingThread {
    return {
        threadId: THREAD,
        isResolved: false,
        pullRequestNumber: PR,
        head: HEAD,
        base: BASE,
        rootComment: { id: ROOT_COMMENT_ID, path: FINDING_PATH, line: FINDING_LINE, side: 'RIGHT' },
        replies: [repairReply(ROOT_COMMENT_ID, 'Defect. Consequence. Fix.')],
        ...overrides,
    };
}

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

function repairInput(overrides: Partial<RepairReviewFindingInput> = {}): RepairReviewFindingInput {
    return { threadId: THREAD, head: HEAD, commit: COMMIT, summary: SUMMARY, ...overrides };
}

type PostedReply = { threadId: string; body: string; clientMutationId: string };

/**
 * The port records every call and applies each posted reply to the thread it reads back, so a test
 * asserting the rerun posts nothing is observing the first post and not a scripted second state.
 */
function fakePort(
    initial: RepairReviewFindingThread = threadState(),
    readEvidenceFile: (path: string) => string = () => '[]'
) {
    const calls: string[] = [];
    const logs: string[] = [];
    const posted: PostedReply[] = [];
    let current = initial;
    const port: RepairReviewFindingPort = {
        readThread: (threadId) => {
            calls.push(`read:${threadId}`);
            return { ...current, replies: [...current.replies] };
        },
        postReply: (threadId, body, clientMutationId) => {
            calls.push(`postReply:${threadId}:${clientMutationId}`);
            posted.push({ threadId, body, clientMutationId });
            current = { ...current, replies: [...current.replies, repairReply(9_000 + posted.length, body)] };
        },
        readEvidenceFile: (path) => {
            calls.push(`readEvidenceFile:${path}`);
            return readEvidenceFile(path);
        },
        isAncestor: (commit, head) => {
            calls.push(`isAncestor:${commit}:${head}`);
            // The reviewed range: the head reaches the base through its own commits, and the base is
            // not inside its own review range.
            return head === current.head;
        },
        log: (message) => {
            logs.push(message);
        },
    };
    return { port, calls, logs, posted };
}

function postedRecords(posted: PostedReply[]): ReviewRepairRecord[] {
    return posted.map((entry) => {
        const record = parseReviewRepairReply(entry.body);
        if (record === undefined) {
            throw new Error('the posted body carries no repair record');
        }
        return record;
    });
}

describe('parseRepairReviewFindingArgs', () => {
    it('should read the pull request, thread, head, commit and summary', () => {
        expect(
            parseRepairReviewFindingArgs([
                String(PR),
                '--thread',
                THREAD,
                '--head',
                HEAD,
                '--commit',
                COMMIT,
                '--summary',
                SUMMARY,
            ])
        ).toEqual({ number: PR, threadId: THREAD, head: HEAD, commit: COMMIT, summary: SUMMARY, help: false });
    });

    it('should read the flags in any order and the optional evidence path', () => {
        expect(
            parseRepairReviewFindingArgs([
                String(PR),
                '--summary',
                SUMMARY,
                '--evidence',
                '/tmp/evidence.json',
                '--commit',
                COMMIT,
                '--head',
                HEAD,
                '--thread',
                THREAD,
            ])
        ).toEqual({
            number: PR,
            threadId: THREAD,
            head: HEAD,
            commit: COMMIT,
            summary: SUMMARY,
            evidencePath: '/tmp/evidence.json',
            help: false,
        });
    });

    it('should refuse a missing commit flag', () => {
        expect(() =>
            parseRepairReviewFindingArgs([String(PR), '--thread', THREAD, '--head', HEAD, '--summary', SUMMARY])
        ).toThrow(REPAIR_USAGE);
    });

    it('should refuse a missing summary flag', () => {
        expect(() =>
            parseRepairReviewFindingArgs([String(PR), '--thread', THREAD, '--head', HEAD, '--commit', COMMIT])
        ).toThrow(REPAIR_USAGE);
    });

    it('should read a summary that looks like a flag or a number', () => {
        for (const summary of ['--head is a placeholder in this prose', String(PR), '--evidence']) {
            expect(
                parseRepairReviewFindingArgs([
                    String(PR),
                    '--thread',
                    THREAD,
                    '--head',
                    HEAD,
                    '--commit',
                    COMMIT,
                    '--summary',
                    summary,
                ]),
                summary
            ).toEqual({ number: PR, threadId: THREAD, head: HEAD, commit: COMMIT, summary, help: false });
        }
    });

    it('should refuse an abbreviated commit', () => {
        expect(() =>
            parseRepairReviewFindingArgs([
                String(PR),
                '--thread',
                THREAD,
                '--head',
                HEAD,
                '--commit',
                COMMIT.slice(0, 7),
                '--summary',
                SUMMARY,
            ])
        ).toThrow(REPAIR_USAGE);
    });

    it('should refuse a blank summary', () => {
        expect(() =>
            parseRepairReviewFindingArgs([
                String(PR),
                '--thread',
                THREAD,
                '--head',
                HEAD,
                '--commit',
                COMMIT,
                '--summary',
                '   ',
            ])
        ).toThrow(REPAIR_USAGE);
    });

    it('should refuse an unknown flag', () => {
        expect(() =>
            parseRepairReviewFindingArgs([
                String(PR),
                '--thread',
                THREAD,
                '--head',
                HEAD,
                '--commit',
                COMMIT,
                '--sumary',
                SUMMARY,
            ])
        ).toThrow(REPAIR_USAGE);
    });

    it('should refuse a repeated flag', () => {
        expect(() =>
            parseRepairReviewFindingArgs([
                String(PR),
                '--thread',
                THREAD,
                '--thread',
                OTHER_THREAD,
                '--head',
                HEAD,
                '--commit',
                COMMIT,
                '--summary',
                SUMMARY,
            ])
        ).toThrow(REPAIR_USAGE);
    });

    it('should refuse a non-numeric pull request', () => {
        for (const number of ['abc', '0', '-3', '3.5', '']) {
            expect(
                () =>
                    parseRepairReviewFindingArgs([
                        number,
                        '--thread',
                        THREAD,
                        '--head',
                        HEAD,
                        '--commit',
                        COMMIT,
                        '--summary',
                        SUMMARY,
                    ]),
                number
            ).toThrow(REPAIR_USAGE);
        }
    });

    it('should accept --help alone and refuse it beside other arguments', () => {
        expect(parseRepairReviewFindingArgs(['--help'])).toEqual({ help: true });
        expect(() => parseRepairReviewFindingArgs(['--help', String(PR)])).toThrow('--help takes no other arguments');
    });
});

describe('recordClientMutationId', () => {
    it('should derive the id from the pull request, thread, head and commit', () => {
        expect(recordClientMutationId(PR, THREAD, HEAD, COMMIT)).toBe(
            `review-repair-record:${PR}:${THREAD}:${HEAD}:${COMMIT}`
        );
    });

    it('should change with the commit and the head, so a new repair is a new request', () => {
        expect(recordClientMutationId(PR, THREAD, HEAD, COMMIT)).not.toBe(
            recordClientMutationId(PR, THREAD, HEAD, OTHER_COMMIT)
        );
        expect(recordClientMutationId(PR, THREAD, HEAD, COMMIT)).not.toBe(
            recordClientMutationId(PR, THREAD, MOVED_HEAD, COMMIT)
        );
    });
});

describe('repairReviewFinding', () => {
    it('should post the rendered record and report the short commit', () => {
        const { port, calls, logs, posted } = fakePort();
        expect(repairReviewFinding(PR, repairInput(), port)).toBe(
            `repair-recorded:${PR}:${THREAD}:${COMMIT.slice(0, 12)}`
        );
        expect(logs).toEqual([`repair-recorded:${PR}:${THREAD}:${COMMIT.slice(0, 12)}`]);
        expect(calls).toEqual([
            `read:${THREAD}`,
            `isAncestor:${COMMIT}:${HEAD}`,
            `isAncestor:${COMMIT}:${BASE}`,
            `postReply:${THREAD}:${recordClientMutationId(PR, THREAD, HEAD, COMMIT)}`,
        ]);
        expect(postedRecords(posted)).toEqual([recordFor()]);
    });

    it('should parse the posted body back to exactly the intended record', () => {
        const { port } = fakePort();
        repairReviewFinding(PR, repairInput(), port);
        const record = parseReviewRepairReply(port.readThread(THREAD).replies[1]?.body ?? '');
        expect(record).toEqual(recordFor());
        expect(record).toBeDefined();
    });

    it('should trim the summary it binds', () => {
        const { port, posted } = fakePort();
        repairReviewFinding(PR, repairInput({ summary: `  ${SUMMARY}  ` }), port);
        expect(postedRecords(posted)[0]?.summary).toBe(SUMMARY);
    });

    it('should carry the thread root as the finding', () => {
        const { port, posted } = fakePort();
        repairReviewFinding(PR, repairInput(), port);
        expect(postedRecords(posted)[0]?.finding).toEqual({
            commentId: ROOT_COMMENT_ID,
            path: FINDING_PATH,
            line: FINDING_LINE,
            side: 'RIGHT',
        });
    });

    it('should record no evidence when no evidence path is given', () => {
        const { port, calls, posted } = fakePort();
        repairReviewFinding(PR, repairInput(), port);
        expect(postedRecords(posted)[0]?.evidence).toEqual([]);
        expect(calls.some((call) => call.startsWith('readEvidenceFile:'))).toBe(false);
    });

    it('should record the evidence the optional file holds', () => {
        const { port, calls, posted } = fakePort(threadState(), () => JSON.stringify([EVIDENCE_ENTRY]));
        repairReviewFinding(PR, repairInput({ evidencePath: '/tmp/evidence.json' }), port);
        expect(postedRecords(posted)[0]?.evidence).toEqual([EVIDENCE_ENTRY]);
        expect(calls).toContain('readEvidenceFile:/tmp/evidence.json');
    });

    it('should post nothing and report the record on an identical rerun', () => {
        const { port, logs, posted } = fakePort();
        expect(repairReviewFinding(PR, repairInput(), port)).toBe(
            `repair-recorded:${PR}:${THREAD}:${COMMIT.slice(0, 12)}`
        );
        expect(repairReviewFinding(PR, repairInput(), port)).toBe(`repair-already-recorded:${PR}:${THREAD}`);
        expect(posted).toHaveLength(1);
        expect(logs).toEqual([
            `repair-recorded:${PR}:${THREAD}:${COMMIT.slice(0, 12)}`,
            `repair-already-recorded:${PR}:${THREAD}`,
        ]);
    });

    it('should post the new record when the author already recorded a different one', () => {
        const other = recordFor({ commit: OTHER_COMMIT, summary: 'A different repair of the same finding.' });
        const { port, posted } = fakePort(
            threadState({ replies: [repairReply(9_101, renderReviewRepairReply(other))] })
        );
        expect(repairReviewFinding(PR, repairInput(), port)).toBe(
            `repair-recorded:${PR}:${THREAD}:${COMMIT.slice(0, 12)}`
        );
        expect(postedRecords(posted)).toEqual([recordFor()]);
    });

    it('should not read a foreign actor marker as the author record', () => {
        const { port, posted } = fakePort(
            threadState({
                replies: [repairReply(9_102, renderReviewRepairReply(recordFor()), REVIEWER_BOT_NODE_ID)],
            })
        );
        expect(repairReviewFinding(PR, repairInput(), port)).toBe(
            `repair-recorded:${PR}:${THREAD}:${COMMIT.slice(0, 12)}`
        );
        expect(posted).toHaveLength(1);
    });

    it('should refuse an already resolved thread', () => {
        const { port, calls } = fakePort(threadState({ isResolved: true }));
        expect(() => repairReviewFinding(PR, repairInput(), port)).toThrow(`thread ${THREAD} is already resolved`);
        expect(calls).toEqual([`read:${THREAD}`]);
    });

    it('should refuse a thread GitHub answered with another thread id', () => {
        const { port } = fakePort(threadState({ threadId: OTHER_THREAD }));
        expect(() => repairReviewFinding(PR, repairInput(), port)).toThrow(
            `GitHub returned thread ${OTHER_THREAD} for requested thread ${THREAD}`
        );
    });

    it('should refuse a thread that hangs off another pull request', () => {
        const { port } = fakePort(threadState({ pullRequestNumber: 99 }));
        expect(() => repairReviewFinding(PR, repairInput(), port)).toThrow(`thread ${THREAD} belongs to PR #99`);
    });

    it('should refuse a moved head before checking ancestry or posting', () => {
        const { port, calls } = fakePort(threadState({ head: MOVED_HEAD }));
        expect(() => repairReviewFinding(PR, repairInput(), port)).toThrow(`head moved: ${MOVED_HEAD} is not ${HEAD}`);
        expect(calls).toEqual([`read:${THREAD}`]);
    });

    it('should refuse a commit that is not an ancestor of the head', () => {
        const { port, calls } = fakePort();
        const notAncestor = { ...port, isAncestor: () => false };
        expect(() => repairReviewFinding(PR, repairInput(), notAncestor)).toThrow(
            `commit ${COMMIT} is not an ancestor of head ${HEAD}`
        );
        expect(calls).toEqual([`read:${THREAD}`]);
    });

    it('should refuse a commit that is the pull request base', () => {
        // The base is an ancestor of the head, so before the reviewed range it recorded and confirmed.
        const { port, calls, posted } = fakePort();
        const atBase = {
            ...port,
            isAncestor: (commit: string, target: string) => port.isAncestor(commit, target) || commit === BASE,
        };
        expect(() => repairReviewFinding(PR, repairInput({ commit: BASE }), atBase)).toThrow(
            `commit ${BASE} is an ancestor of the pull request base ${BASE}`
        );
        expect(calls).toEqual([`read:${THREAD}`, `isAncestor:${BASE}:${HEAD}`, `isAncestor:${BASE}:${BASE}`]);
        expect(posted).toEqual([]);
    });

    it('should refuse a pre-pull-request commit below the base', () => {
        const mergeBase = '2'.repeat(40);
        const { port, calls, posted } = fakePort();
        const onBase = {
            ...port,
            isAncestor: (commit: string, target: string) => port.isAncestor(commit, target) || commit === mergeBase,
        };
        expect(() => repairReviewFinding(PR, repairInput({ commit: mergeBase }), onBase)).toThrow(
            `commit ${mergeBase} is an ancestor of the pull request base ${BASE}`
        );
        expect(calls).toEqual([`read:${THREAD}`, `isAncestor:${mergeBase}:${HEAD}`, `isAncestor:${mergeBase}:${BASE}`]);
        expect(posted).toEqual([]);
    });

    it('should refuse a commit that is the head itself', () => {
        const { port, calls, posted } = fakePort();
        expect(() => repairReviewFinding(PR, repairInput({ commit: HEAD }), port)).toThrow(
            `commit ${HEAD} is not a distinct commit from head ${HEAD}`
        );
        expect(calls).toEqual([`read:${THREAD}`]);
        expect(posted).toEqual([]);
    });

    it('should refuse a blank summary', () => {
        const { port, posted } = fakePort();
        expect(() => repairReviewFinding(PR, repairInput({ summary: '   ' }), port)).toThrow(
            'review repair summary must not be blank'
        );
        expect(posted).toEqual([]);
    });

    it('should refuse a summary past the contract bound', () => {
        const { port, posted } = fakePort();
        expect(() => repairReviewFinding(PR, repairInput({ summary: 's'.repeat(513) }), port)).toThrow(
            'review repair summary exceeds 512 bytes'
        );
        expect(posted).toEqual([]);
    });

    it('should refuse evidence that names a credential-shaped value', () => {
        const unsafe = () => JSON.stringify([{ ...EVIDENCE_ENTRY, observed: `token ${CREDENTIAL_SHAPED}` }]);
        const { port, posted } = fakePort(threadState(), unsafe);
        expect(() => repairReviewFinding(PR, repairInput({ evidencePath: '/tmp/evidence.json' }), port)).toThrow(
            'contains a GitHub token'
        );
        expect(posted).toEqual([]);
    });
});

describe('parseRepairEvidence', () => {
    it('should accept an array of evidence entries', () => {
        expect(parseRepairEvidence(JSON.stringify([EVIDENCE_ENTRY]))).toEqual([EVIDENCE_ENTRY]);
    });

    it('should refuse JSON that is not an array', () => {
        expect(() => parseRepairEvidence(JSON.stringify(EVIDENCE_ENTRY))).toThrow(
            'must hold an array of evidence entries'
        );
    });

    it('should refuse an entry that is not an object', () => {
        expect(() => parseRepairEvidence(JSON.stringify(['observable']))).toThrow(
            'evidence entry 0 must be a JSON object'
        );
    });

    it('should refuse an entry whose field is not a string', () => {
        expect(() => parseRepairEvidence(JSON.stringify([{ ...EVIDENCE_ENTRY, observed: 7 }]))).toThrow(
            'evidence entry 0 field observed must be a string'
        );
    });
});

describe('repairReviewFinding evidence files', () => {
    let directory = '';

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'repair-evidence-'));
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    /**
     * The production evidence reader, bound the way `shellPort` binds it, so the file cases exercise
     * the real read rather than a stub that returns whatever the fixture wants.
     */
    function evidencePort(contents: string) {
        const path = join(directory, 'evidence.json');
        writeFileSync(path, contents);
        const { port, posted } = fakePort();
        return { port: { ...port, readEvidenceFile: readFileSyncUtf8 }, posted, path };
    }

    it('should refuse a missing evidence file', () => {
        const { port } = fakePort();
        expect(() =>
            repairReviewFinding(PR, repairInput({ evidencePath: join(directory, 'absent.json') }), {
                ...port,
                readEvidenceFile: readFileSyncUtf8,
            })
        ).toThrow(/absent\.json/);
    });

    it('should refuse a malformed evidence file', () => {
        const { port, path } = evidencePort('{not json');
        expect(() => repairReviewFinding(PR, repairInput({ evidencePath: path }), port)).toThrow(
            'review repair evidence file is not valid JSON'
        );
    });

    it('should refuse an evidence file whose shape is wrong', () => {
        const { port, path } = evidencePort(JSON.stringify({ observable: 'not an array' }));
        expect(() => repairReviewFinding(PR, repairInput({ evidencePath: path }), port)).toThrow(
            'must hold an array of evidence entries'
        );
    });

    it('should read a well-formed evidence file from disk', () => {
        const { port, path, posted } = evidencePort(JSON.stringify([EVIDENCE_ENTRY]));
        repairReviewFinding(PR, repairInput({ evidencePath: path }), port);
        expect(postedRecords(posted)[0]?.evidence).toEqual([EVIDENCE_ENTRY]);
    });
});

type ThreadNodeFixture = {
    data: {
        node: {
            id: string;
            isResolved: boolean;
            diffSide: 'LEFT' | 'RIGHT';
            pullRequest: { number: number; headRefOid: string; baseRefOid: string };
            comments: { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
        };
    };
};

function threadNode(overrides: Record<string, unknown> = {}): ThreadNodeFixture {
    return {
        data: {
            node: {
                id: THREAD,
                isResolved: false,
                // The side GitHub returns for a thread; a review comment carries no side of its own.
                diffSide: 'RIGHT',
                pullRequest: { number: PR, headRefOid: HEAD, baseRefOid: BASE },
                comments: {
                    nodes: [
                        {
                            id: ROOT_COMMENT_NODE_ID,
                            databaseId: ROOT_COMMENT_ID,
                            body: 'Defect.',
                            path: FINDING_PATH,
                            line: FINDING_LINE,
                            author: { __typename: 'Bot', login: 'r', id: REVIEWER_BOT_NODE_ID },
                        },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                },
                ...overrides,
            },
        },
    };
}

/** The production evidence read, so the file cases exercise that wiring rather than a stub. */
function readFileSyncUtf8(path: string): string {
    return readFileSync(path, 'utf8');
}

describe('readRepairReviewThread', () => {
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

    it('should read the thread, its root comment position and its replies in one query', () => {
        const { gh, calls } = recordingGh(() => threadNode());
        expect(readRepairReviewThread(THREAD, gh)).toEqual({
            threadId: THREAD,
            isResolved: false,
            pullRequestNumber: PR,
            head: HEAD,
            base: BASE,
            rootComment: { id: ROOT_COMMENT_ID, path: FINDING_PATH, line: FINDING_LINE, side: 'RIGHT' },
            replies: [
                {
                    id: ROOT_COMMENT_ID,
                    body: 'Defect.',
                    authorNodeId: REVIEWER_BOT_NODE_ID,
                },
            ],
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.query).toContain('PullRequestReviewThread');
        // The thread carries the side; the comment type has no side field to ask for.
        expect(calls[0]?.query).toContain('id isResolved diffSide');
        expect(calls[0]?.query).toContain('path line author');
        expect(calls[0]?.query).not.toContain('line side');
        // The record binds the numeric database id, so the fragment must select it beside the node id.
        expect(calls[0]?.query).toContain('nodes{id databaseId body');
    });

    it('should follow comment pagination and keep the root from the first page', () => {
        function firstPage(): ThreadNodeFixture {
            return threadNode({
                diffSide: 'LEFT',
                comments: {
                    nodes: [
                        {
                            id: ROOT_COMMENT_NODE_ID,
                            databaseId: ROOT_COMMENT_ID,
                            body: 'Defect.',
                            path: FINDING_PATH,
                            line: FINDING_LINE,
                            author: null,
                        },
                    ],
                    pageInfo: { hasNextPage: true, endCursor: 'CURSOR' },
                },
            });
        }
        function secondPage(): ThreadNodeFixture {
            return threadNode({
                comments: {
                    nodes: [
                        {
                            id: 'PRRC_kwDOrepairReply',
                            databaseId: 5_002,
                            body: 'reply',
                            path: FINDING_PATH,
                            line: FINDING_LINE,
                            author: null,
                        },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                },
            });
        }
        function firstPageOrSecond(call: { fields: Record<string, string> }): ThreadNodeFixture {
            if (call.fields.cursor === undefined) {
                return firstPage();
            }
            return secondPage();
        }
        const { gh, calls } = recordingGh(firstPageOrSecond);
        const thread = readRepairReviewThread(THREAD, gh);
        expect(thread.replies.map((reply) => reply.id)).toEqual([ROOT_COMMENT_ID, 5_002]);
        expect(thread.rootComment).toEqual({
            id: ROOT_COMMENT_ID,
            path: FINDING_PATH,
            line: FINDING_LINE,
            side: 'LEFT',
        });
        expect(calls[1]?.fields.cursor).toBe('CURSOR');
    });

    it('should refuse a node that is not a review thread', () => {
        const { gh } = recordingGh(() => ({ data: { node: null } }));
        expect(() => readRepairReviewThread(THREAD, gh)).toThrow(
            `review thread ${THREAD} is not a readable pull-request review thread`
        );
    });

    it('should refuse a thread whose diff side is neither LEFT nor RIGHT', () => {
        const { gh } = recordingGh(() => threadNode({ diffSide: 'UP' }));
        expect(() => readRepairReviewThread(THREAD, gh)).toThrow(
            `review thread ${THREAD} diff side must be LEFT or RIGHT, found "UP"`
        );
    });

    it('should refuse a thread whose pull request carries no base commit', () => {
        const { gh } = recordingGh(() => threadNode({ pullRequest: { number: PR, headRefOid: HEAD } }));
        expect(() => readRepairReviewThread(THREAD, gh)).toThrow(
            `review thread ${THREAD} is not a readable pull-request review thread`
        );
    });

    it('should refuse a thread that carries no root comment', () => {
        const { gh } = recordingGh(() =>
            threadNode({ comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } })
        );
        expect(() => readRepairReviewThread(THREAD, gh)).toThrow(`review thread ${THREAD} carries no root comment`);
    });

    it('should refuse a root comment that carries no database id', () => {
        const { gh } = recordingGh(() =>
            threadNode({
                comments: {
                    nodes: [
                        {
                            id: ROOT_COMMENT_NODE_ID,
                            body: 'Defect.',
                            path: FINDING_PATH,
                            line: FINDING_LINE,
                            author: null,
                        },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                },
            })
        );
        expect(() => readRepairReviewThread(THREAD, gh)).toThrow(
            'comment PRRC_kwDOrepairRoot id must be a numeric database id'
        );
    });

    it('should refuse a database id that is zero, negative, fractional or unsafe', () => {
        for (const databaseId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
            const { gh } = recordingGh(() =>
                threadNode({
                    comments: {
                        nodes: [
                            {
                                id: ROOT_COMMENT_NODE_ID,
                                databaseId,
                                body: 'Defect.',
                                path: FINDING_PATH,
                                line: FINDING_LINE,
                                author: null,
                            },
                        ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                    },
                })
            );
            expect(
                () => readRepairReviewThread(THREAD, gh),
                `databaseId ${String(databaseId)} must be refused`
            ).toThrow('must be a numeric database id');
        }
    });

    it('should refuse a reply comment that carries no database id', () => {
        const { gh } = recordingGh(() =>
            threadNode({
                comments: {
                    nodes: [
                        {
                            id: ROOT_COMMENT_NODE_ID,
                            databaseId: ROOT_COMMENT_ID,
                            body: 'Defect.',
                            path: FINDING_PATH,
                            line: FINDING_LINE,
                            author: null,
                        },
                        { id: 'PRRC_kwDOrepairReply', body: 'reply', author: null },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                },
            })
        );
        expect(() => readRepairReviewThread(THREAD, gh)).toThrow(
            `comment PRRC_kwDOrepairReply id must be a numeric database id`
        );
    });

    it('should refuse an empty comment page that claims another instead of draining forever', () => {
        let emptyPages = 0;
        const { gh } = recordingGh((call) => {
            if (call.fields.cursor === undefined) {
                return threadNode({
                    comments: {
                        nodes: [
                            {
                                id: ROOT_COMMENT_NODE_ID,
                                databaseId: ROOT_COMMENT_ID,
                                body: 'Defect.',
                                path: FINDING_PATH,
                                line: FINDING_LINE,
                                author: null,
                            },
                        ],
                        pageInfo: { hasNextPage: true, endCursor: 'COMMENT_CURSOR' },
                    },
                });
            }
            emptyPages += 1;
            return threadNode({
                comments: {
                    nodes: [],
                    pageInfo: { hasNextPage: emptyPages < 2, endCursor: `EMPTY_CURSOR_${emptyPages}` },
                },
            });
        });

        expect(() => readRepairReviewThread(THREAD, gh)).toThrow(
            `review thread ${THREAD} returned an empty comment page while claiming another`
        );
    });

    it('should refuse a repeated pagination cursor', () => {
        // A non-empty page keeps this on the cursor-repetition path; an empty one refuses earlier.
        const { gh } = recordingGh(() =>
            threadNode({
                comments: {
                    nodes: [
                        {
                            id: ROOT_COMMENT_NODE_ID,
                            databaseId: ROOT_COMMENT_ID,
                            body: 'Defect.',
                            path: FINDING_PATH,
                            line: FINDING_LINE,
                            author: null,
                        },
                    ],
                    pageInfo: { hasNextPage: true, endCursor: 'CURSOR' },
                },
            })
        );
        expect(() => readRepairReviewThread(THREAD, gh)).toThrow(
            `review thread ${THREAD} returned invalid comment pagination`
        );
    });
});

describe('postRepairReply', () => {
    function receiptGh(body: string, clientMutationId: string) {
        const calls: string[] = [];
        const gh = (args: string[]) => {
            calls.push(args.join(' '));
            return JSON.stringify({
                data: { addPullRequestReviewThreadReply: { clientMutationId, comment: { body } } },
            });
        };
        return { gh, calls };
    }

    it('should reply through addPullRequestReviewThreadReply with the rendered body', () => {
        const { gh, calls } = receiptGh('body', 'mutation-id');
        postRepairReply(THREAD, 'body', 'mutation-id', gh);
        expect(calls[0]).toContain('addPullRequestReviewThreadReply');
        expect(calls[0]).toContain('pullRequestReviewThreadId:$threadId');
    });

    it('should refuse a receipt for another clientMutationId', () => {
        const { gh } = receiptGh('body', 'someone-else');
        expect(() => postRepairReply(THREAD, 'body', 'mutation-id', gh)).toThrow(
            `addPullRequestReviewThreadReply returned an invalid result for ${THREAD}`
        );
    });

    it('should refuse a receipt whose comment body is not the rendered record', () => {
        const { gh } = receiptGh('other body', 'mutation-id');
        expect(() => postRepairReply(THREAD, 'body', 'mutation-id', gh)).toThrow('returned an invalid result');
    });
});

describe('shellPort', () => {
    let root = '';

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'repair-shell-'));
        // `resolvePrimaryRoot` realpaths what the capture returns, so both must exist and agree.
        mkdirSync(join(root, '.git'));
        root = realpathSync(root);
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    /** A spawn that never runs a process: the exit status is the whole answer this reads. */
    function fakeSpawn(exitCode: number) {
        const calls: string[][] = [];
        const spawn = (command: string, args: string[]) => {
            calls.push([command, ...args]);
            return { status: exitCode, stderr: exitCode === 0 ? '' : 'git: failure' };
        };
        return { spawn, calls };
    }

    it('should run gh from the primary root with the session environment', () => {
        const commands: { command: string; args: string[]; cwd?: string }[] = [];
        const session: GhSession = { configDir: '/config', env: { GH_TOKEN: 'token' }, dispose: () => undefined };
        const port = shellPort(session, root, (command, args, options) => {
            commands.push({ command, args, cwd: options?.cwd });
            if (command === 'git' && args[0] === 'rev-parse') {
                return `${join(root, '.git')}\n`;
            }
            if (command === 'git') {
                return '';
            }
            return JSON.stringify(threadNode());
        });
        expect(port.readThread(THREAD).rootComment.path).toBe(FINDING_PATH);
        const ghCall = commands.find((entry) => entry.command === 'gh');
        expect(ghCall?.cwd).toBe(root);
        expect(ghCall?.args.slice(0, 3)).toEqual(['api', 'graphql', '-f']);
    });

    it('should reply with the body it is given through the thread reply mutation', () => {
        const calls: string[][] = [];
        const session: GhSession = { configDir: '/config', env: {}, dispose: () => undefined };
        const port = shellPort(session, root, (command, args) => {
            if (command === 'git' && args[0] === 'rev-parse') {
                return `${join(root, '.git')}\n`;
            }
            calls.push(args);
            return JSON.stringify({
                data: { addPullRequestReviewThreadReply: { clientMutationId: 'id', comment: { body: 'record' } } },
            });
        });
        port.postReply(THREAD, 'record', 'id');
        expect(calls[0]?.join(' ')).toContain('addPullRequestReviewThreadReply');
    });

    it('should read the evidence file through the production file read', () => {
        const path = join(root, 'evidence.json');
        writeFileSync(path, JSON.stringify([EVIDENCE_ENTRY]));
        const session: GhSession = { configDir: '/config', env: {}, dispose: () => undefined };
        const port = shellPort(session, root, (command, args) => {
            if (command === 'git' && args[0] === 'rev-parse') {
                return `${join(root, '.git')}\n`;
            }
            throw new Error(`unexpected ${command}`);
        });
        expect(port.readEvidenceFile(path)).toBe(JSON.stringify([EVIDENCE_ENTRY]));
    });

    it('should read exit zero from git merge-base --is-ancestor as the true answer', () => {
        const { spawn, calls } = fakeSpawn(0);
        expect(shellIsAncestor(root, undefined, spawn)(COMMIT, HEAD)).toBe(true);
        expect(calls[0]).toEqual(['git', 'merge-base', '--is-ancestor', COMMIT, HEAD]);
    });

    it('should read exit one from git merge-base --is-ancestor as the false answer', () => {
        expect(shellIsAncestor(root, undefined, fakeSpawn(1).spawn)(COMMIT, HEAD)).toBe(false);
    });

    it('should refuse a git merge-base --is-ancestor failure that is neither answer', () => {
        expect(() => isAncestorExitStatus(128, 'git: bad revision')).toThrow('git: bad revision');
    });
});

function fakeDependencies(overrides: Partial<RepairReviewFindingCoordinatorDependencies> = {}) {
    const events: string[] = [];
    const dependencies: RepairReviewFindingCoordinatorDependencies = {
        primaryRoot: () => '/repo',
        authenticateAuthor: async (primaryRoot) => {
            events.push(`auth:${primaryRoot}`);
            return {
                minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
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
        repair: (number, input) => {
            events.push(`repair:${number}:${input.threadId}:${input.commit}`);
            return `repair-recorded:${number}:${input.threadId}:${input.commit.slice(0, 12)}`;
        },
        ...overrides,
    };
    return { dependencies, events };
}

describe('coordinateRepairReviewFinding', () => {
    it('should authenticate the author App and record the repair', async () => {
        const { dependencies, events } = fakeDependencies();
        await coordinateRepairReviewFinding(PR, repairInput(), dependencies);
        expect(events).toEqual(['auth:/repo', `repair:${PR}:${THREAD}:${COMMIT}`, 'dispose']);
    });

    it('should refuse an actor that is not the author bot, and still dispose the session', async () => {
        const { dependencies, events } = fakeDependencies({
            authenticateAuthor: async () => ({
                minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                session: { configDir: '/config', env: {}, dispose: () => events.push('dispose') },
            }),
        });
        await expect(coordinateRepairReviewFinding(PR, repairInput(), dependencies)).rejects.toThrow(
            `minted actor ${REVIEWER_BOT_NODE_ID} is not ${AUTHOR_BOT_NODE_ID}`
        );
        expect(events).toEqual(['dispose']);
    });

    it('should refuse a foreign repository', async () => {
        const { dependencies } = fakeDependencies({ repositoryName: () => 'someone/else' });
        await expect(coordinateRepairReviewFinding(PR, repairInput(), dependencies)).rejects.toThrow(
            'refusing to operate on someone/else'
        );
    });
});

describe('runRepairReviewFindingCli', () => {
    it('should record the repair the arguments name', async () => {
        const { dependencies, events } = fakeDependencies();
        await expect(
            runRepairReviewFindingCli(
                [String(PR), '--thread', THREAD, '--head', HEAD, '--commit', COMMIT, '--summary', SUMMARY],
                dependencies
            )
        ).resolves.toBe(0);
        expect(events).toContain(`repair:${PR}:${THREAD}:${COMMIT}`);
    });

    it('should print usage for --help without authenticating', async () => {
        const { dependencies, events } = fakeDependencies();
        const printed = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            await expect(runRepairReviewFindingCli(['--help'], dependencies)).resolves.toBe(0);
            expect(printed).toHaveBeenCalledWith(`Usage: ${REPAIR_USAGE.slice('usage: '.length)}`);
        } finally {
            printed.mockRestore();
        }
        expect(events).toEqual([]);
    });

    it('should refuse arguments that are not the usage', async () => {
        const { dependencies } = fakeDependencies();
        await expect(runRepairReviewFindingCli([String(PR)], dependencies)).rejects.toThrow(REPAIR_USAGE);
    });
});

describe('defaultRepairReviewFindingCoordinatorDependencies', () => {
    it('should bind the author role and the module record function', () => {
        const dependencies = defaultRepairReviewFindingCoordinatorDependencies();
        expect(dependencies.repair).toBe(repairReviewFinding);
    });
});
