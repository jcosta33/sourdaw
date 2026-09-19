import { describe, expect, it } from 'vitest';

import { renderConfirmationReply, threadPage } from '../confirmReviewRepairs.ts';
import { threadQuery } from '../repairReviewFinding.ts';
import {
    REVIEW_REPAIR_FORMAT,
    REVIEW_REPAIR_SUMMARY_MAX_BYTES,
    assertReviewRepairRecord,
    confirmClientMutationId,
    parseReviewRepairReply,
    renderReviewRepairReply,
    selectEligibleRepairs,
} from '../reviewRepair.ts';

import type { ReviewRepairRecord, ReviewRepairSelection, ReviewRepairThreadState } from '../reviewRepair.ts';

/** The wire token, asserted literally so a rename of the format name cannot pass unnoticed. */
const REPAIR_MARKER = 'sourdaw-repair-v1';
const AUTHOR_NODE_ID = 'BOT_author';
const FOREIGN_NODE_ID = 'BOT_reviewer';
const PR = 3_000;
const HEAD = 'a'.repeat(40);
const BASE = 'f'.repeat(40);
const MERGE_BASE = '1'.repeat(40);
const COMMIT = 'b'.repeat(40);
const STALE_HEAD = 'c'.repeat(40);
const THREAD = 'PRRT_kwDOrepair';
const OTHER_THREAD = 'PRRT_kwDOother';
const ROOT_COMMENT_ID = 5_001;
const FINDING_PATH = 'scripts/reviewRepair.ts';
const FINDING_LINE = 12;

const EVIDENCE_ENTRY = {
    observable: 'the confirm mutation id repeats for one pr, thread and head',
    verification: 'pnpm test:run scripts/__tests__/reviewRepair.spec.ts',
    observed: 'one identical id across two calls',
};

/**
 * Composed at runtime from fragments: the pull-request diff secret scan is a required gate and
 * matches a contiguous credential literal in source.
 */
const CREDENTIAL_SHAPED = ['gh', 'p', '_', 'A'.repeat(24)].join('');

const VALID_RECORD: ReviewRepairRecord = {
    format: REVIEW_REPAIR_FORMAT,
    pr: PR,
    thread: THREAD,
    finding: { commentId: ROOT_COMMENT_ID, path: FINDING_PATH, line: FINDING_LINE, side: 'RIGHT' },
    commit: COMMIT,
    summary: 'Bind the finding to the addressing commit.',
    evidence: [EVIDENCE_ENTRY],
    head: HEAD,
};

/**
 * A fresh valid record whose runtime fields may carry values the static type forbids; the validator
 * must refuse them even though the type system cannot express the damage.
 */
function repairRecord(overrides: Record<string, unknown> = {}): ReviewRepairRecord {
    const record = structuredClone(VALID_RECORD);
    Object.assign(record, overrides);
    return record;
}

function repairReply(id: number, record: ReviewRepairRecord, authorNodeId: string = AUTHOR_NODE_ID) {
    return { id, body: renderReviewRepairReply(record), authorNodeId };
}

function proseReply(id: number, body = 'Confirmed; the fix is in the next push.', authorNodeId = AUTHOR_NODE_ID) {
    return { id, body, authorNodeId };
}

function threadState(overrides: Partial<ReviewRepairThreadState> = {}): ReviewRepairThreadState {
    return {
        thread: THREAD,
        resolved: false,
        rootCommentId: ROOT_COMMENT_ID,
        rootPath: FINDING_PATH,
        rootLine: FINDING_LINE,
        rootSide: 'RIGHT',
        replies: [repairReply(11, repairRecord())],
        ...overrides,
    };
}

/**
 * The spec's ancestry oracle: `COMMIT` is inside the reviewed range, `BASE` is the pull request base
 * itself, so a commit that reaches the head through the base is exactly the case the range refuses.
 */
function inReviewedRange(commit: string, target: string): boolean {
    return commit === BASE || commit === MERGE_BASE || (target === HEAD && commit === COMMIT);
}

function selectRepairs(
    threads: readonly ReviewRepairThreadState[],
    isAncestor: (commit: string, head: string) => boolean = inReviewedRange,
    base: string = BASE
): ReviewRepairSelection {
    return selectEligibleRepairs({
        threads,
        pr: PR,
        head: HEAD,
        base,
        authorNodeId: AUTHOR_NODE_ID,
        reviewerNodeId: FOREIGN_NODE_ID,
        isAncestor,
    });
}

function markerLineOf(body: string): string {
    const marker = body.split('\n').find((line) => line.startsWith(REPAIR_MARKER));
    if (marker === undefined) {
        throw new Error(`no marker line in ${JSON.stringify(body)}`);
    }
    return marker;
}

function markerPayloadOf(body: string): string {
    return markerLineOf(body).slice(REPAIR_MARKER.length).trim();
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
    throw new Error(`the marker payload carries a value this spec cannot canonicalize: ${typeof value}`);
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

describe('review repair reply round trip', () => {
    it('should round-trip a valid record byte for byte', () => {
        const reply = renderReviewRepairReply(VALID_RECORD);
        const parsed = parseReviewRepairReply(reply);

        expect(parsed).toEqual(VALID_RECORD);
        if (parsed === undefined) {
            throw new Error('a rendered repair reply must parse back');
        }
        expect(renderReviewRepairReply(parsed)).toBe(reply);
    });

    it('should serialize the marker payload as key-sorted, whitespace-free JSON', () => {
        const payload = markerPayloadOf(renderReviewRepairReply(VALID_RECORD));
        const parsed: unknown = JSON.parse(payload);

        expect(canonicalJson(parsed)).toBe(payload);
        expect(sortedKeysEverywhere(parsed)).toBe(true);
        expect(whitespaceOutsideStrings(payload)).toEqual([]);
    });
});

describe('parseReviewRepairReply discipline', () => {
    it('should return undefined for prose that carries no marker line', () => {
        expect(parseReviewRepairReply('Thanks. The fix is already on the branch.')).toBeUndefined();
        expect(parseReviewRepairReply('See the sourdaw-repair-v1 documentation for the format.')).toBeUndefined();
    });

    it('should throw when a marker line carries malformed JSON', () => {
        expect(() => parseReviewRepairReply(`${REPAIR_MARKER} {not json}`)).toThrow(
            'review repair marker line is not valid JSON'
        );
    });

    it('should throw when the marker line is truncated to the bare token', () => {
        expect(() => parseReviewRepairReply(`A reply.\n\n${REPAIR_MARKER}`)).toThrow(
            'review repair marker line carries no record'
        );
    });

    it('should let the last marker line win when a body carries two', () => {
        const first = repairRecord({ commit: 'd'.repeat(40) });
        const second = repairRecord({ commit: 'e'.repeat(40) });
        const body = `${renderReviewRepairReply(first)}\n\n${renderReviewRepairReply(second)}`;

        expect(parseReviewRepairReply(body)).toEqual(second);
    });

    it('should parse a marker line surrounded by prose', () => {
        const body = ['Lead-in prose.', '', renderReviewRepairReply(VALID_RECORD), '', 'Trailing prose.'].join('\n');

        expect(parseReviewRepairReply(body)).toEqual(VALID_RECORD);
    });
});

const REFUSALS: readonly { label: string; record: ReviewRepairRecord; fragment: string }[] = [
    {
        label: 'a wrong format',
        record: repairRecord({ format: 'repair-v2' }),
        fragment: `must be ${REVIEW_REPAIR_FORMAT}`,
    },
    {
        label: 'a zero pr',
        record: repairRecord({ pr: 0 }),
        fragment: 'review repair pr must be a positive safe integer',
    },
    {
        label: 'a negative commentId',
        record: repairRecord({ finding: { ...VALID_RECORD.finding, commentId: -1 } }),
        fragment: 'review repair commentId must be a positive safe integer',
    },
    {
        label: 'a blank thread',
        record: repairRecord({ thread: '   ' }),
        fragment: 'review repair thread must not be blank',
    },
    {
        label: 'a blank commit',
        record: repairRecord({ commit: ' ' }),
        fragment: 'review repair commit must not be blank',
    },
    {
        label: 'a blank head',
        record: repairRecord({ head: '\t' }),
        fragment: 'review repair head must not be blank',
    },
    {
        label: 'a blank summary',
        record: repairRecord({ summary: '' }),
        fragment: 'review repair summary must not be blank',
    },
    {
        label: 'a blank finding path',
        record: repairRecord({ finding: { ...VALID_RECORD.finding, path: '  ' } }),
        fragment: 'review repair path must not be blank',
    },
    {
        label: 'a side that is neither LEFT nor RIGHT',
        record: repairRecord({ finding: { ...VALID_RECORD.finding, side: 'UP' } }),
        fragment: 'review repair side must be LEFT or RIGHT',
    },
    {
        label: 'a short commit',
        record: repairRecord({ commit: 'abc123' }),
        fragment: 'review repair commit must be forty lowercase hex characters',
    },
    {
        label: 'an uppercase commit',
        record: repairRecord({ commit: 'A'.repeat(40) }),
        fragment: 'review repair commit must be forty lowercase hex characters',
    },
    {
        label: 'a short head',
        record: repairRecord({ head: 'abc123' }),
        fragment: 'review repair head must be forty lowercase hex characters',
    },
    {
        label: 'an uppercase head',
        record: repairRecord({ head: 'B'.repeat(40) }),
        fragment: 'review repair head must be forty lowercase hex characters',
    },
    {
        label: 'a zero line',
        record: repairRecord({ finding: { ...VALID_RECORD.finding, line: 0 } }),
        fragment: 'review repair line must be a positive safe integer',
    },
    {
        label: 'a negative line',
        record: repairRecord({ finding: { ...VALID_RECORD.finding, line: -3 } }),
        fragment: 'review repair line must be a positive safe integer',
    },
    {
        label: 'nine evidence entries',
        record: repairRecord({ evidence: Array.from({ length: 9 }, () => EVIDENCE_ENTRY) }),
        fragment: 'review repair evidence must hold at most 8 entries',
    },
    {
        label: 'an edge-padded summary',
        record: repairRecord({ summary: ` ${VALID_RECORD.summary} ` }),
        fragment: 'summary value at index 0 is not edge-trimmed',
    },
    {
        label: 'a multi-line summary',
        record: repairRecord({ summary: 'first line\nsecond line' }),
        fragment: 'summary value at index 0 contains a line separator',
    },
    {
        label: 'a credential-shaped summary',
        record: repairRecord({ summary: `the token ${CREDENTIAL_SHAPED} leaked` }),
        fragment: 'summary value at index 0 contains a GitHub token',
    },
];

describe('assertReviewRepairRecord refusals', () => {
    it.each(REFUSALS)('should refuse $label', ({ record, fragment }) => {
        expect(() => assertReviewRepairRecord(record)).toThrow(fragment);
    });

    it('should accept a summary at the byte bound and refuse one byte over', () => {
        const atBound = 'a'.repeat(REVIEW_REPAIR_SUMMARY_MAX_BYTES);

        expect(() => assertReviewRepairRecord(repairRecord({ summary: atBound }))).not.toThrow();
        expect(() => assertReviewRepairRecord(repairRecord({ summary: `${atBound}a` }))).toThrow(
            `review repair summary exceeds ${REVIEW_REPAIR_SUMMARY_MAX_BYTES} bytes, found ${
                REVIEW_REPAIR_SUMMARY_MAX_BYTES + 1
            }`
        );
    });

    it('should route every evidence field through the publication-safety rules', () => {
        const blank = repairRecord({ evidence: [{ ...EVIDENCE_ENTRY, observable: '   ' }] });
        expect(() => assertReviewRepairRecord(blank)).toThrow('evidence[0].observable value at index 0 is blank');

        const padded = repairRecord({ evidence: [{ ...EVIDENCE_ENTRY, verification: ' padded ' }] });
        expect(() => assertReviewRepairRecord(padded)).toThrow(
            'evidence[0].verification value at index 0 is not edge-trimmed'
        );

        const multiLine = repairRecord({ evidence: [{ ...EVIDENCE_ENTRY, observed: 'one\ntwo' }] });
        expect(() => assertReviewRepairRecord(multiLine)).toThrow(
            'evidence[0].observed value at index 0 contains a line separator'
        );
    });
});

describe('selectEligibleRepairs', () => {
    it('should keep a valid repair eligible and leave the other buckets empty', () => {
        const record = repairRecord();
        const selection = selectRepairs([threadState({ replies: [repairReply(11, record)] })]);

        expect(selection).toEqual({
            eligible: [{ thread: THREAD, record, replyId: 11 }],
            refused: [],
            ignored: [],
        });
    });

    it('should refuse a finding that does not match the thread root', () => {
        const record = repairRecord({ finding: { ...VALID_RECORD.finding, commentId: 9_999 } });
        const selection = selectRepairs([threadState({ replies: [repairReply(11, record)] })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [
                {
                    thread: THREAD,
                    reason: `finding commentId 9999 does not match the thread root ${ROOT_COMMENT_ID}`,
                },
            ],
            ignored: [],
        });
    });

    it('should refuse a record bound to another pull request', () => {
        const record = repairRecord({ pr: PR + 1 });
        const selection = selectRepairs([threadState({ replies: [repairReply(11, record)] })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [{ thread: THREAD, reason: `pr ${PR + 1} does not match the confirmed pr ${PR}` }],
            ignored: [],
        });
    });

    it('should refuse a record bound to another thread', () => {
        const record = repairRecord({ thread: OTHER_THREAD });
        const selection = selectRepairs([threadState({ replies: [repairReply(11, record)] })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [
                {
                    thread: THREAD,
                    reason: `thread ${OTHER_THREAD} does not match the confirmed thread ${THREAD}`,
                },
            ],
            ignored: [],
        });
    });

    it('should refuse a finding whose path is not the thread root', () => {
        const record = repairRecord({ finding: { ...VALID_RECORD.finding, path: 'scripts/other.ts' } });
        const selection = selectRepairs([threadState({ replies: [repairReply(11, record)] })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [
                {
                    thread: THREAD,
                    reason: `finding path scripts/other.ts does not match the thread root ${FINDING_PATH}`,
                },
            ],
            ignored: [],
        });
    });

    it('should refuse a finding whose side is not the thread root', () => {
        const record = repairRecord({ finding: { ...VALID_RECORD.finding, side: 'LEFT' } });
        const selection = selectRepairs([threadState({ replies: [repairReply(11, record)] })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [{ thread: THREAD, reason: 'finding side LEFT does not match the thread root RIGHT' }],
            ignored: [],
        });
    });

    it('should refuse a record whose commit is the confirmed head', () => {
        const record = repairRecord({ commit: HEAD });
        const selection = selectRepairs([threadState({ replies: [repairReply(11, record)] })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [{ thread: THREAD, reason: `commit ${HEAD} is not a distinct commit from head ${HEAD}` }],
            ignored: [],
        });
    });

    it('should refuse a record bound to a stale head', () => {
        const record = repairRecord({ head: STALE_HEAD });
        const selection = selectRepairs([threadState({ replies: [repairReply(11, record)] })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [{ thread: THREAD, reason: `head ${STALE_HEAD} does not match the confirmed head ${HEAD}` }],
            ignored: [],
        });
    });

    it('should refuse a commit that is not an ancestor of the confirmed head', () => {
        const record = repairRecord();
        const ancestorCalls: (readonly [string, string])[] = [];
        const selection = selectRepairs([threadState({ replies: [repairReply(11, record)] })], (commit, head) => {
            ancestorCalls.push([commit, head]);
            return false;
        });

        expect(selection).toEqual({
            eligible: [],
            refused: [{ thread: THREAD, reason: `commit ${COMMIT} is not an ancestor of head ${HEAD}` }],
            ignored: [],
        });
        expect(ancestorCalls).toEqual([[COMMIT, HEAD]]);
    });

    it('should refuse the merge base as a repairing commit, naming it and the base', () => {
        const record = repairRecord({ commit: MERGE_BASE });
        const selection = selectRepairs([threadState({ replies: [repairReply(11, record)] })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [
                {
                    thread: THREAD,
                    reason: `commit ${MERGE_BASE} is an ancestor of the pull request base ${BASE}`,
                },
            ],
            ignored: [],
        });
    });

    it('should refuse a record whose commit is the pull request base itself', () => {
        const record = repairRecord({ commit: BASE });
        const selection = selectRepairs([threadState({ replies: [repairReply(11, record)] })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [{ thread: THREAD, reason: `commit ${BASE} is an ancestor of the pull request base ${BASE}` }],
            ignored: [],
        });
    });

    it('should refuse a thread whose reviewer confirmed a different record', () => {
        const record = repairRecord();
        const confirmed = repairRecord({ commit: 'd'.repeat(40), summary: 'The record the reviewer accepted.' });
        const selection = selectRepairs([
            threadState({
                replies: [
                    repairReply(11, record),
                    { id: 12, body: renderConfirmationReply(confirmed), authorNodeId: FOREIGN_NODE_ID },
                ],
            }),
        ]);

        expect(selection).toEqual({
            eligible: [],
            refused: [{ thread: THREAD, reason: 'thread already carries a confirmation for a different record' }],
            ignored: [],
        });
    });

    it('should keep a record whose reviewer confirmed the identical record eligible', () => {
        const record = repairRecord();
        const selection = selectRepairs([
            threadState({
                replies: [
                    repairReply(11, record),
                    { id: 12, body: renderConfirmationReply(record), authorNodeId: FOREIGN_NODE_ID },
                ],
            }),
        ]);

        expect(selection.eligible.map((entry) => entry.replyId)).toEqual([11]);
        expect(selection.refused).toEqual([]);
    });

    it('should refuse a thread whose author recorded two distinct records', () => {
        const first = repairRecord();
        const second = repairRecord({ commit: 'd'.repeat(40) });
        const selection = selectRepairs([threadState({ replies: [repairReply(11, first), repairReply(12, second)] })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [{ thread: THREAD, reason: 'author recorded 2 distinct repair records' }],
            ignored: [],
        });
    });

    it('should count two byte-identical records once and keep the first reply eligible', () => {
        const first = repairRecord();
        const second = repairRecord();
        expect(second).not.toBe(first);

        const selection = selectRepairs([threadState({ replies: [repairReply(11, first), repairReply(12, second)] })]);

        expect(selection).toEqual({
            eligible: [{ thread: THREAD, record: first, replyId: 11 }],
            refused: [],
            ignored: [],
        });
    });

    it('should ignore a repair recorded by another node id', () => {
        const selection = selectRepairs([threadState({ replies: [repairReply(11, repairRecord(), FOREIGN_NODE_ID)] })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [],
            ignored: [{ thread: THREAD, reason: 'no repair recorded' }],
        });
    });

    it('should ignore an already-resolved thread even when it carries a valid record', () => {
        const selection = selectRepairs([threadState({ resolved: true })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [],
            ignored: [{ thread: THREAD, reason: 'already resolved' }],
        });
    });

    it('should ignore a thread with no repair reply', () => {
        const selection = selectRepairs([threadState({ replies: [proseReply(11)] })]);

        expect(selection).toEqual({
            eligible: [],
            refused: [],
            ignored: [{ thread: THREAD, reason: 'no repair recorded' }],
        });
    });

    it('should split a partially completed batch into exact arrays that keep input order', () => {
        const eligibleThread = 'PRRT_batch_eligible';
        const resolvedThread = 'PRRT_batch_resolved';
        const staleThread = 'PRRT_batch_stale';
        const silentThread = 'PRRT_batch_silent';
        const invalidThread = 'PRRT_batch_invalid';
        const eligibleRecord = repairRecord({ thread: eligibleThread });
        const staleRecord = repairRecord({ thread: staleThread, head: STALE_HEAD });
        const invalidRecord = repairRecord({
            thread: invalidThread,
            finding: { ...VALID_RECORD.finding, line: FINDING_LINE + 1 },
        });

        const selection = selectRepairs([
            threadState({ thread: eligibleThread, replies: [repairReply(21, eligibleRecord)] }),
            threadState({ thread: resolvedThread, resolved: true }),
            threadState({ thread: staleThread, replies: [repairReply(23, staleRecord)] }),
            threadState({ thread: silentThread, replies: [proseReply(24)] }),
            threadState({ thread: invalidThread, replies: [repairReply(25, invalidRecord)] }),
        ]);

        expect(selection).toEqual({
            eligible: [{ thread: eligibleThread, record: eligibleRecord, replyId: 21 }],
            refused: [
                { thread: staleThread, reason: `head ${STALE_HEAD} does not match the confirmed head ${HEAD}` },
                {
                    thread: invalidThread,
                    reason: `finding line ${FINDING_LINE + 1} does not match the thread root ${FINDING_LINE}`,
                },
            ],
            ignored: [
                { thread: resolvedThread, reason: 'already resolved' },
                { thread: silentThread, reason: 'no repair recorded' },
            ],
        });
        expect(selection.eligible.map((entry) => entry.thread)).toEqual([eligibleThread]);
        expect(selection.eligible.map((entry) => entry.thread)).not.toContain(staleThread);
        expect(selection.eligible.map((entry) => entry.thread)).not.toContain(invalidThread);
    });
});

describe('confirmClientMutationId', () => {
    it('should stay stable for the same pull request, thread and head', () => {
        expect(confirmClientMutationId(PR, THREAD, HEAD)).toBe(`review-repair-confirm:${PR}:${THREAD}:${HEAD}`);
        expect(confirmClientMutationId(PR, THREAD, HEAD)).toBe(confirmClientMutationId(PR, THREAD, HEAD));
    });

    it('should differ when the pull request, thread or head changes', () => {
        const baseline = confirmClientMutationId(PR, THREAD, HEAD);

        expect(confirmClientMutationId(PR + 1, THREAD, HEAD)).not.toBe(baseline);
        expect(confirmClientMutationId(PR, `${THREAD}x`, HEAD)).not.toBe(baseline);
        expect(confirmClientMutationId(PR, THREAD, STALE_HEAD)).not.toBe(baseline);
    });
});

/**
 * The exact text both thread readers send, written out literally rather than assembled from the shared
 * fragment. The repair reader nests the comment fragment under its comment connection; the confirm
 * reader must select the thread's own `isResolved` and nest that same fragment under `comments`, with
 * each connection carrying its own `pageInfo`. Re-nesting the fragment directly under `reviewThreads`
 * or moving `pageInfo` inside `nodes` changes these bytes and reddens this pin.
 */
describe('review thread queries', () => {
    it('should ask for the repair thread and its comment page with pageInfo beside nodes', () => {
        expect(threadQuery(false)).toBe(
            'query($threadId:ID!){node(id:$threadId){... on PullRequestReviewThread{id isResolved pullRequest{number headRefOid baseRefOid} comments(first:100){nodes{id body path line side author{__typename login ... on Bot{id}}} pageInfo{hasNextPage endCursor}}}}}'
        );
        expect(threadQuery(true)).toBe(
            'query($threadId:ID!,$cursor:String!){node(id:$threadId){... on PullRequestReviewThread{id isResolved pullRequest{number headRefOid baseRefOid} comments(first:100,after:$cursor){nodes{id body path line side author{__typename login ... on Bot{id}}} pageInfo{hasNextPage endCursor}}}}}'
        );
    });

    it('should ask for the review threads with pageInfo beside nodes in both page forms', () => {
        expect(threadPage(undefined)).toBe(
            'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved comments(first:100){nodes{id body path line side author{__typename login ... on Bot{id}}} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}}}'
        );
        expect(threadPage('CURSOR')).toBe(
            'query($owner:String!,$name:String!,$number:Int!,$cursor:String!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id isResolved comments(first:100){nodes{id body path line side author{__typename login ... on Bot{id}}} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}}}'
        );
    });
});
