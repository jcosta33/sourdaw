/**
 * Author-recorded repair for one blocking review finding (#3000).
 *
 * A blocking finding keeps its thread unresolved until a head addresses it, and only such a head may
 * resolve it. The author therefore records the repair without resolving: a reply whose first lines
 * are prose carries one machine-readable `sourdaw-repair-v1` marker line binding the finding, the
 * commit that addresses it, and the evidence a reviewer needs to confirm it. The reviewer later
 * parses the author's replies, keeps the eligible records, and confirms them in one transaction under
 * a mutation id derived from the pr, thread and head, so a replay after a partial failure repeats the
 * identical request rather than inventing a new one.
 *
 * Parsing never launders a corrupt record into an absent one: no marker line is `undefined`, while a
 * present but malformed marker throws. Validation delegates summary and evidence text to the dossier
 * publication-safety contract instead of restating its rules.
 */

import { fail } from './prContract.ts';
import { REVIEW_EVIDENCE_FIELD_MAX_BYTES, assertPublicationSafeEvidence } from './reviewDossier.ts';

export const REVIEW_REPAIR_FORMAT = 'repair-v1';
export const REVIEW_REPAIR_SUMMARY_MAX_BYTES = 512;

/** The marker token; the payload follows it on the same, final record line of the reply. */
const REPAIR_MARKER = 'sourdaw-repair-v1';
const REPAIR_HEADER_PREFIX = 'Repair for ';
const FORTY_LOWER_HEX = /^[0-9a-f]{40}$/u;
const MAX_EVIDENCE_ENTRIES = 8;
const SIDES: ReadonlySet<string> = new Set(['LEFT', 'RIGHT']);
const EVIDENCE_FIELDS = ['observable', 'verification', 'observed'] as const;
const BLANK_CHECKED_FIELDS = ['thread', 'commit', 'head', 'summary'] as const;
const HASH_FIELDS = ['commit', 'head'] as const;
const RECORD_KEYS = ['format', 'pr', 'thread', 'finding', 'commit', 'summary', 'evidence', 'head'] as const;
const FINDING_KEYS = ['commentId', 'path', 'line', 'side'] as const;

/**
 * A repair summary is published like a dossier evidence value, so this contract's own tighter budget
 * can never exceed the shared field ceiling even if that tighter number were ever raised.
 */
const SUMMARY_BYTE_LIMIT = Math.min(REVIEW_REPAIR_SUMMARY_MAX_BYTES, REVIEW_EVIDENCE_FIELD_MAX_BYTES);

/** A thread already accepted one record; a second, different one would accept bytes no reviewer read. */
const DIFFERENT_RECORD_CONFIRMATION_REFUSAL = 'thread already carries a confirmation for a different record';

/**
 * The comment fields both thread readers select. `pageInfo` belongs to the comment connection, so it
 * sits beside `nodes` rather than inside it; one shared fragment keeps the two readers from drifting.
 * A record binds the numeric `databaseId`; the node `id` is GitHub's opaque string and only names the
 * comment in diagnostics. The comment type carries no side: the side a finding sits on belongs to the
 * thread as `diffSide`, selected by each thread reader beside `isResolved`. GitHub nulls `line` once a
 * diff moves under a comment while `originalLine` keeps the position it was written against, so both
 * positions are read and `readFindingLine` decides which one a finding binds.
 */
export const REVIEW_THREAD_COMMENT_FIELDS =
    'nodes{id databaseId body path line originalLine author{__typename login ... on Bot{id}}} pageInfo{hasNextPage endCursor}';

export type ReviewRepairFinding = { commentId: number; path: string; line: number; side: 'LEFT' | 'RIGHT' };

export type ReviewRepairEvidence = { observable: string; verification: string; observed: string };

export type ReviewRepairRecord = {
    format: 'repair-v1';
    pr: number;
    thread: string;
    finding: ReviewRepairFinding;
    commit: string;
    summary: string;
    evidence: ReviewRepairEvidence[];
    head: string;
};

export type ReviewRepairThreadState = {
    thread: string;
    resolved: boolean;
    rootCommentId: number;
    rootPath: string;
    rootLine: number;
    rootSide: 'LEFT' | 'RIGHT';
    replies: { id: number; body: string; authorNodeId: string | null }[];
};

export type ReviewRepairSelection = {
    eligible: { thread: string; record: ReviewRepairRecord; replyId: number }[];
    refused: { thread: string; reason: string }[];
    ignored: { thread: string; reason: string }[];
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type RepairCandidate = { record: ReviewRepairRecord; replyId: number };

type AuthorRepairRecords =
    { kind: 'none' } | { kind: 'one'; candidate: RepairCandidate } | { kind: 'many'; count: number };

type RepairConfirmation = {
    pr: number;
    head: string;
    base: string;
    isAncestor: (commit: string, head: string) => boolean;
};

/** Key-sorted, whitespace-free JSON, so identical records have identical bytes. */
function canonicalJson(value: JsonValue): string {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
        const members = Object.entries(value)
            .sort(([left], [right]) => (left < right ? -1 : 1))
            .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
        return `{${members.join(',')}}`;
    }
    return JSON.stringify(value);
}

function serializeReviewRepairRecord(record: ReviewRepairRecord): string {
    return canonicalJson(record);
}

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readLiteral<Value extends string>(
    label: string,
    value: unknown,
    matches: (candidate: string) => candidate is Value,
    expected: string
): Value {
    if (typeof value !== 'string' || !matches(value)) {
        fail(`review repair ${label} must be ${expected}, found ${describeValue(value)}`);
    }
    return value;
}

function isRepairFormat(value: string): value is 'repair-v1' {
    return value === REVIEW_REPAIR_FORMAT;
}

function isSide(value: string): value is 'LEFT' | 'RIGHT' {
    return SIDES.has(value);
}

function readString(label: string, value: unknown): string {
    if (typeof value !== 'string') {
        fail(`review repair ${label} must be a string, found ${describeValue(value)}`);
    }
    return value;
}

function readNumber(label: string, value: unknown): number {
    if (typeof value !== 'number') {
        fail(`review repair ${label} must be a number, found ${describeValue(value)}`);
    }
    return value;
}

function readArray(label: string, value: unknown): readonly unknown[] {
    if (!Array.isArray(value)) {
        fail(`review repair ${label} must be an array, found ${describeValue(value)}`);
    }
    return value;
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
    const actual = Object.keys(record).sort().join(',');
    const expected = [...allowed].sort().join(',');
    if (actual !== expected) {
        fail(`review repair ${label} fields must be ${expected}, found ${actual}`);
    }
}

function readFinding(value: unknown): ReviewRepairFinding {
    if (!isRecord(value)) {
        fail(`review repair finding must be a JSON object, found ${describeValue(value)}`);
    }
    assertExactKeys(value, FINDING_KEYS, 'finding');
    return {
        commentId: readNumber('finding.commentId', value.commentId),
        path: readString('finding.path', value.path),
        line: readNumber('finding.line', value.line),
        side: readLiteral('finding.side', value.side, isSide, 'LEFT or RIGHT'),
    };
}

function readEvidenceEntry(value: unknown): ReviewRepairEvidence {
    if (!isRecord(value)) {
        fail(`review repair evidence entry must be a JSON object, found ${describeValue(value)}`);
    }
    assertExactKeys(value, EVIDENCE_FIELDS, 'evidence entry');
    return {
        observable: readString('evidence.observable', value.observable),
        verification: readString('evidence.verification', value.verification),
        observed: readString('evidence.observed', value.observed),
    };
}

function readRecord(value: unknown): ReviewRepairRecord {
    if (!isRecord(value)) {
        fail(`review repair marker payload must be a JSON object, found ${describeValue(value)}`);
    }
    assertExactKeys(value, RECORD_KEYS, 'record');
    return {
        format: readLiteral('format', value.format, isRepairFormat, REVIEW_REPAIR_FORMAT),
        pr: readNumber('pr', value.pr),
        thread: readString('thread', value.thread),
        finding: readFinding(value.finding),
        commit: readString('commit', value.commit),
        summary: readString('summary', value.summary),
        evidence: readArray('evidence', value.evidence).map((entry) => readEvidenceEntry(entry)),
        head: readString('head', value.head),
    };
}

function parseMarkerPayload(payload: string): unknown {
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch {
        return fail('review repair marker line is not valid JSON');
    }
    return parsed;
}

/**
 * A marker line starts with the marker token at the start of a trimmed line; a line that merely
 * mentions the token inside prose is not a marker, so such prose is ignored like any other.
 */
function isMarkerLine(line: string): boolean {
    if (!line.startsWith(REPAIR_MARKER)) {
        return false;
    }
    const rest = line.slice(REPAIR_MARKER.length);
    return rest === '' || /^\s/u.test(rest);
}

function lastMarkerLine(body: string): string | undefined {
    let marker: string | undefined;
    for (const line of body.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (isMarkerLine(trimmed)) {
            marker = trimmed;
        }
    }
    return marker;
}

export function renderReviewRepairReply(record: ReviewRepairRecord): string {
    const header = `${REPAIR_HEADER_PREFIX}${record.finding.path}:${record.finding.line} ${record.finding.side}`;
    return [header, record.summary, '', `${REPAIR_MARKER} ${serializeReviewRepairRecord(record)}`].join('\n');
}

export function parseReviewRepairReply(body: string): ReviewRepairRecord | undefined {
    const marker = lastMarkerLine(body);
    if (marker === undefined) {
        return undefined;
    }
    const payload = marker.slice(REPAIR_MARKER.length).trim();
    if (payload === '') {
        fail('review repair marker line carries no record');
    }
    return readRecord(parseMarkerPayload(payload));
}

function assertPositiveInteger(label: string, value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail(`review repair ${label} must be a positive safe integer, found ${describeValue(value)}`);
    }
}

/**
 * A comment's numeric database id, shared by both thread readers. The type check stands as its own
 * guard rather than folding into the range check: `Number.isSafeInteger` already refuses every
 * non-number, so one disjunction would carry a type clause no fixture can distinguish. Kept apart,
 * a wrong type and a wrong value are separate failures with separate diagnostics.
 */
export function readCommentDatabaseId(value: unknown, label: string): number {
    if (typeof value !== 'number') {
        fail(`${label} must be a numeric database id, found ${describeValue(value)}`);
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail(`${label} must be a numeric database id that is a positive safe integer, found ${describeValue(value)}`);
    }
    return value;
}

/** A position GitHub reports as a positive safe integer; null and every malformed value carry none. */
function isPositiveLine(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * The line a finding binds, shared by both thread readers. GitHub nulls a review comment's `line` once
 * the diff moves under it while `originalLine` keeps the position it was written against, so a finding
 * binds the live line when GitHub still reports one and the original line otherwise. Only a comment
 * that carries neither is unreadable; refusing an outdated root would strand its blocking thread.
 */
export function readFindingLine(line: unknown, originalLine: unknown, label: string): number {
    if (isPositiveLine(line)) {
        return line;
    }
    if (isPositiveLine(originalLine)) {
        return originalLine;
    }
    return fail(
        `${label} must carry a positive line number, found ${describeValue(line)} and original line ${describeValue(originalLine)}`
    );
}

export function assertReviewRepairRecord(record: ReviewRepairRecord): void {
    if (record.format !== REVIEW_REPAIR_FORMAT) {
        fail(`review repair format must be ${REVIEW_REPAIR_FORMAT}, found ${describeValue(record.format)}`);
    }
    assertPositiveInteger('pr', record.pr);
    assertPositiveInteger('commentId', record.finding.commentId);
    for (const field of BLANK_CHECKED_FIELDS) {
        if (record[field].trim() === '') {
            fail(`review repair ${field} must not be blank`);
        }
    }
    if (record.finding.path.trim() === '') {
        fail('review repair path must not be blank');
    }
    for (const field of HASH_FIELDS) {
        if (!FORTY_LOWER_HEX.test(record[field])) {
            fail(
                `review repair ${field} must be forty lowercase hex characters, found ${describeValue(record[field])}`
            );
        }
    }
    if (!isSide(record.finding.side)) {
        fail(`review repair side must be LEFT or RIGHT, found ${describeValue(record.finding.side)}`);
    }
    assertPositiveInteger('line', record.finding.line);
    if (record.evidence.length > MAX_EVIDENCE_ENTRIES) {
        fail(
            `review repair evidence must hold at most ${MAX_EVIDENCE_ENTRIES} entries, found ${record.evidence.length}`
        );
    }
    const summaryBytes = Buffer.byteLength(record.summary, 'utf8');
    if (summaryBytes > SUMMARY_BYTE_LIMIT) {
        fail(`review repair summary exceeds ${SUMMARY_BYTE_LIMIT} bytes, found ${summaryBytes}`);
    }
    assertPublicationSafeEvidence('summary', [record.summary]);
    for (const [index, entry] of record.evidence.entries()) {
        for (const field of EVIDENCE_FIELDS) {
            assertPublicationSafeEvidence(`evidence[${index}].${field}`, [entry[field]]);
        }
    }
}

/**
 * Both review mutations carry an id derived from what the caller asked for, never from a clock or a
 * random source, so a rerun after a partial failure replays the identical request and the receipt
 * GitHub returns can be matched against the id that was sent.
 */
export function confirmClientMutationId(pr: number, thread: string, head: string): string {
    return `review-repair-confirm:${pr}:${thread}:${head}`;
}

function authorRepairRecords(thread: ReviewRepairThreadState, authorNodeId: string): AuthorRepairRecords {
    const seen = new Set<string>();
    let candidate: RepairCandidate | undefined;
    let count = 0;
    for (const reply of thread.replies) {
        if (reply.authorNodeId !== authorNodeId) {
            continue;
        }
        const record = parseReviewRepairReply(reply.body);
        if (record === undefined) {
            continue;
        }
        const key = serializeReviewRepairRecord(record);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        count += 1;
        if (candidate === undefined) {
            candidate = { record, replyId: reply.id };
        }
    }
    if (candidate === undefined) {
        return { kind: 'none' };
    }
    if (count > 1) {
        return { kind: 'many', count };
    }
    return { kind: 'one', candidate };
}

function findingRefusal(thread: ReviewRepairThreadState, finding: ReviewRepairFinding): string | undefined {
    if (finding.commentId !== thread.rootCommentId) {
        return `finding commentId ${finding.commentId} does not match the thread root ${thread.rootCommentId}`;
    }
    if (finding.path !== thread.rootPath) {
        return `finding path ${finding.path} does not match the thread root ${thread.rootPath}`;
    }
    if (finding.line !== thread.rootLine) {
        return `finding line ${finding.line} does not match the thread root ${thread.rootLine}`;
    }
    if (finding.side !== thread.rootSide) {
        return `finding side ${finding.side} does not match the thread root ${thread.rootSide}`;
    }
    return undefined;
}

function confirmationRefusal(
    confirmation: RepairConfirmation,
    thread: ReviewRepairThreadState,
    record: ReviewRepairRecord
): string | undefined {
    if (record.pr !== confirmation.pr) {
        return `pr ${record.pr} does not match the confirmed pr ${confirmation.pr}`;
    }
    if (record.thread !== thread.thread) {
        return `thread ${record.thread} does not match the confirmed thread ${thread.thread}`;
    }
    if (record.head !== confirmation.head) {
        return `head ${record.head} does not match the confirmed head ${confirmation.head}`;
    }
    const finding = findingRefusal(thread, record.finding);
    if (finding !== undefined) {
        return finding;
    }
    if (record.commit === record.head) {
        return `commit ${record.commit} is not a distinct commit from head ${record.head}`;
    }
    if (!confirmation.isAncestor(record.commit, confirmation.head)) {
        return `commit ${record.commit} is not an ancestor of head ${confirmation.head}`;
    }
    if (confirmation.isAncestor(record.commit, confirmation.base)) {
        return `commit ${record.commit} is an ancestor of the pull request base ${confirmation.base}`;
    }
    return undefined;
}

/**
 * A confirmation names exactly the record it accepted. A reviewer reply that parses to any other
 * record means the author rewrote the repair after the confirmation landed, so resolving would accept
 * a record no reviewer read; refusing keeps the thread open for a fresh confirmation. Two byte-identical
 * confirmations are refused too: a rerun may skip a single already-posted reply, but resolving a
 * duplicated one would settle a thread that carries two confirmations for the same record.
 */
function reviewerConfirmationRefusal(
    thread: ReviewRepairThreadState,
    record: ReviewRepairRecord,
    reviewerNodeId: string
): string | undefined {
    const accepted = renderReviewRepairReply(record);
    let confirmations = 0;
    for (const reply of thread.replies) {
        if (reply.authorNodeId !== reviewerNodeId) {
            continue;
        }
        const posted = parseReviewRepairReply(reply.body);
        if (posted === undefined) {
            continue;
        }
        if (renderReviewRepairReply(posted) !== accepted) {
            return DIFFERENT_RECORD_CONFIRMATION_REFUSAL;
        }
        confirmations += 1;
    }
    if (confirmations > 1) {
        return `thread already carries ${confirmations} identical confirmations`;
    }
    return undefined;
}

export function selectEligibleRepairs(input: {
    threads: readonly ReviewRepairThreadState[];
    pr: number;
    head: string;
    base: string;
    authorNodeId: string;
    reviewerNodeId: string;
    isAncestor: (commit: string, head: string) => boolean;
}): ReviewRepairSelection {
    const eligible: ReviewRepairSelection['eligible'] = [];
    const refused: ReviewRepairSelection['refused'] = [];
    const ignored: ReviewRepairSelection['ignored'] = [];

    for (const thread of input.threads) {
        if (thread.resolved) {
            ignored.push({ thread: thread.thread, reason: 'already resolved' });
            continue;
        }
        const found = authorRepairRecords(thread, input.authorNodeId);
        if (found.kind === 'none') {
            ignored.push({ thread: thread.thread, reason: 'no repair recorded' });
            continue;
        }
        if (found.kind === 'many') {
            refused.push({ thread: thread.thread, reason: `author recorded ${found.count} distinct repair records` });
            continue;
        }
        assertReviewRepairRecord(found.candidate.record);
        const reason =
            confirmationRefusal(input, thread, found.candidate.record) ??
            reviewerConfirmationRefusal(thread, found.candidate.record, input.reviewerNodeId);
        if (reason !== undefined) {
            refused.push({ thread: thread.thread, reason });
            continue;
        }
        eligible.push({ thread: thread.thread, record: found.candidate.record, replyId: found.candidate.replyId });
    }

    return { eligible, refused, ignored };
}
