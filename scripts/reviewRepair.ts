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
 * A record survives later pushes (#4589): it stays confirmable against a live head that descends the
 * recorded head while the recorded repair commit stays contained in that head, and a re-record on a
 * descending head supersedes the earlier record for its thread. Conflicting records no descending
 * re-record supersedes — two distinct claims on one head, or one on a head that does not descend the
 * earlier record's — keep the thread refused.
 *
 * Parsing never launders a corrupt record into an absent one: no marker line is `undefined`, while a
 * present but malformed marker throws. Validation delegates summary and evidence text to the dossier
 * publication-safety contract instead of restating its rules.
 */

import { createHash } from 'node:crypto';

import { canonicalJson, isMarkerLine, lastMarkerLine, parseMarkerPayload } from './canonicalRecord.ts';
import { REVIEW_EVIDENCE_FIELD_MAX_BYTES, assertPublicationSafeEvidence } from './evidenceSafety.ts';
import { fail } from './prContract.ts';

export const REVIEW_REPAIR_FORMAT = 'repair-v1';
export const REVIEW_REPAIR_SUMMARY_MAX_BYTES = 512;

/** The marker token; the payload follows it on the same, final record line of the reply. */
const REPAIR_MARKER = 'sourdaw-repair-v1';
const CONFIRMATION_MARKER = 'sourdaw-repair-confirmation-v1';
const REVIEW_REPAIR_CONFIRMATION_FORMAT = 'repair-confirmation-v1';
const REPAIR_HEADER_PREFIX = 'Repair for ';
const FORTY_LOWER_HEX = /^[0-9a-f]{40}$/u;
const SIXTY_FOUR_LOWER_HEX = /^[0-9a-f]{64}$/u;
const MAX_EVIDENCE_ENTRIES = 8;
const SIDES: ReadonlySet<string> = new Set(['LEFT', 'RIGHT']);
const EVIDENCE_FIELDS = ['observable', 'verification', 'observed'] as const;
const BLANK_CHECKED_FIELDS = ['thread', 'commit', 'head', 'summary'] as const;
const HASH_FIELDS = ['commit', 'head'] as const;
const RECORD_KEYS = ['format', 'pr', 'thread', 'finding', 'commit', 'summary', 'evidence', 'head'] as const;
const FINDING_KEYS = ['commentId', 'path', 'line', 'side'] as const;
const CONFIRMATION_KEYS = ['format', 'pr', 'thread', 'confirmationHead', 'recordDigest'] as const;

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
 * positions are read and `readFindingLine` decides which one a finding binds. The root comment's
 * associated review commit is the revision that received the finding; a comment's live commit may
 * move with the diff, and a later reply belongs to a different review.
 */
export const REVIEW_THREAD_COMMENT_FIELDS =
    'nodes{id databaseId body path line originalLine author{__typename login ... on Bot{id}} pullRequestReview{commit{oid}}} pageInfo{hasNextPage endCursor}';

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

export type ReviewRepairConfirmation = {
    format: 'repair-confirmation-v1';
    pr: number;
    thread: string;
    confirmationHead: string;
    recordDigest: string;
};

export type ParsedReviewRepairReply =
    | { kind: 'repair'; record: ReviewRepairRecord }
    | { kind: 'legacy-confirmation'; record: ReviewRepairRecord }
    | { kind: 'confirmation'; confirmation: ReviewRepairConfirmation };

export type ReviewRepairThreadState = {
    thread: string;
    resolved: boolean;
    rootCommentId: number;
    rootPath: string;
    rootLine: number;
    rootSide: 'LEFT' | 'RIGHT';
    rootReviewedHead: string;
    replies: { id: number; body: string; authorNodeId: string | null }[];
};

export type ReviewRepairSelection = {
    eligible: { thread: string; record: ReviewRepairRecord; replyId: number }[];
    refused: { thread: string; reason: string }[];
    ignored: { thread: string; reason: string }[];
};

type RepairCandidate = { record: ReviewRepairRecord; replyId: number };

type AuthorRepairRecords =
    { kind: 'none' } | { kind: 'one'; candidate: RepairCandidate } | { kind: 'many'; count: number };

type RepairConfirmation = {
    pr: number;
    head: string;
    base: string;
    isAncestor: (commit: string, head: string) => boolean;
};

function serializeReviewRepairRecord(record: ReviewRepairRecord): string {
    return canonicalJson(record);
}

/** SHA-256 over the one canonical byte representation of every V1 record field. */
export function reviewRepairRecordDigest(record: ReviewRepairRecord): string {
    return createHash('sha256').update(serializeReviewRepairRecord(record)).digest('hex');
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

function readReviewRepairConfirmation(value: unknown): ReviewRepairConfirmation {
    if (!isRecord(value)) {
        fail(`review repair confirmation marker payload must be a JSON object, found ${describeValue(value)}`);
    }
    assertExactKeys(value, CONFIRMATION_KEYS, 'confirmation');
    const format = readLiteral(
        'confirmation format',
        value.format,
        (candidate): candidate is typeof REVIEW_REPAIR_CONFIRMATION_FORMAT =>
            candidate === REVIEW_REPAIR_CONFIRMATION_FORMAT,
        REVIEW_REPAIR_CONFIRMATION_FORMAT
    );
    const pr = readNumber('confirmation pr', value.pr);
    assertPositiveInteger('confirmation pr', pr);
    const thread = readString('confirmation thread', value.thread);
    if (thread.trim() === '') {
        fail('review repair confirmation thread must not be blank');
    }
    const confirmationHead = readString('confirmation head', value.confirmationHead);
    if (!FORTY_LOWER_HEX.test(confirmationHead)) {
        fail(
            `review repair confirmation head must be a full lowercase commit SHA, found ${describeValue(confirmationHead)}`
        );
    }
    const recordDigest = readString('confirmation recordDigest', value.recordDigest);
    if (!SIXTY_FOUR_LOWER_HEX.test(recordDigest)) {
        fail(
            `review repair confirmation recordDigest must be a lowercase SHA-256 digest, found ${describeValue(recordDigest)}`
        );
    }
    return { format, pr, thread, confirmationHead, recordDigest };
}

function markerLines(body: string, marker: string): string[] {
    return body
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => isMarkerLine(line, marker));
}

function parseReviewRepairConfirmationLine(line: string): ReviewRepairConfirmation {
    const payload = line.slice(CONFIRMATION_MARKER.length).trim();
    if (payload === '') {
        fail('review repair confirmation marker line carries no record');
    }
    return readReviewRepairConfirmation(parseMarkerPayload(payload, 'review repair confirmation'));
}

export function renderReviewRepairReply(record: ReviewRepairRecord): string {
    const header = `${REPAIR_HEADER_PREFIX}${record.finding.path}:${record.finding.line} ${record.finding.side}`;
    return [header, record.summary, '', `${REPAIR_MARKER} ${serializeReviewRepairRecord(record)}`].join('\n');
}

export function parseReviewRepairReply(body: string): ReviewRepairRecord | undefined {
    const marker = lastMarkerLine(body, REPAIR_MARKER);
    if (marker === undefined) {
        return undefined;
    }
    const payload = marker.slice(REPAIR_MARKER.length).trim();
    if (payload === '') {
        fail('review repair marker line carries no record');
    }
    return readRecord(parseMarkerPayload(payload, 'review repair'));
}

/**
 * Builds the compact reviewer marker. The record itself is never copied into reviewer content; its
 * digest binds the confirmation to the exact canonical author record, including evidence and summary.
 */
export function renderReviewRepairConfirmationMarker(record: ReviewRepairRecord, confirmationHead: string): string {
    const confirmation: ReviewRepairConfirmation = {
        format: REVIEW_REPAIR_CONFIRMATION_FORMAT,
        pr: record.pr,
        thread: record.thread,
        confirmationHead,
        recordDigest: reviewRepairRecordDigest(record),
    };
    return `${CONFIRMATION_MARKER} ${canonicalJson(confirmation)}`;
}

/**
 * Parse only after the caller has admitted the immutable actor for the supplied role. Author replies
 * admit only V1 repairs. Reviewer replies admit the historical full V1 confirmation or the compact
 * confirmation marker, and refuse multiple admitted marker lines rather than selecting one by order.
 */
export function parseReviewRepairReplyForRole(
    body: string,
    role: 'author' | 'reviewer'
): ParsedReviewRepairReply | undefined {
    if (role === 'author') {
        const record = parseReviewRepairReply(body);
        return record === undefined ? undefined : { kind: 'repair', record };
    }
    const repairs = markerLines(body, REPAIR_MARKER);
    const confirmations = markerLines(body, CONFIRMATION_MARKER);
    if (repairs.length + confirmations.length > 1) {
        fail('review repair reviewer reply carries ambiguous or duplicate confirmation markers');
    }
    if (repairs.length === 1) {
        const record = parseReviewRepairReply(body);
        if (record === undefined) {
            fail('review repair reviewer marker could not be read');
        }
        return { kind: 'legacy-confirmation', record };
    }
    const confirmationLine = confirmations[0];
    if (confirmationLine === undefined) {
        return undefined;
    }
    return { kind: 'confirmation', confirmation: parseReviewRepairConfirmationLine(confirmationLine) };
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

/** Read provenance from the root's live review association, never from a repair reply. */
export function readFindingReviewedHead(review: unknown, label: string): string {
    const commit = isRecord(review) ? review.commit : undefined;
    const oid = isRecord(commit) ? commit.oid : undefined;
    if (typeof oid !== 'string' || !FORTY_LOWER_HEX.test(oid)) {
        fail(`${label} reviewed head must be forty lowercase hex characters, found ${describeValue(oid)}`);
    }
    return oid;
}

/** Both identities require a post-finding commit in base..head; the repair may be the tip itself. */
export function reviewRepairCommitRefusal(input: {
    commit: string;
    head: string;
    base: string;
    reviewedHead: string;
    isAncestor: (commit: string, head: string) => boolean;
}): string | undefined {
    const { commit, head, base, reviewedHead, isAncestor } = input;
    if (typeof reviewedHead !== 'string' || !FORTY_LOWER_HEX.test(reviewedHead)) {
        return 'finding reviewed head must be forty lowercase hex characters';
    }
    if (!isAncestor(commit, head)) {
        return `commit ${commit} is not an ancestor of head ${head}`;
    }
    if (isAncestor(commit, base)) {
        return `commit ${commit} is an ancestor of the pull request base ${base}`;
    }
    if (commit === reviewedHead || !isAncestor(reviewedHead, commit)) {
        return `commit ${commit} must strictly descend the finding reviewed head ${reviewedHead}`;
    }
    return undefined;
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

/**
 * Whether a re-recorded repair supersedes the running candidate: only when it was recorded on a head
 * that strictly descends the candidate's recorded head — the author pushed again and re-recorded on
 * the new head (#4589). Two distinct records on one head, or a later record on a head that does not
 * descend the earlier record's, are conflicting claims the reply order cannot settle.
 */
function supersedesRepairRecord(
    earlier: ReviewRepairRecord,
    later: ReviewRepairRecord,
    isAncestor: (commit: string, head: string) => boolean
): boolean {
    return earlier.head !== later.head && isAncestor(earlier.head, later.head);
}

/**
 * The author's distinct records fold in reply order, the thread's chronological comment order — no
 * timestamp is read, so the newest record is the last distinct one. Each newer record either
 * supersedes the running candidate or conflicts with it, and a single conflict refuses the thread no
 * matter what later records supersede.
 */
function authorRepairRecords(
    thread: ReviewRepairThreadState,
    authorNodeId: string,
    isAncestor: (commit: string, head: string) => boolean
): AuthorRepairRecords {
    const seen = new Set<string>();
    let candidate: RepairCandidate | undefined;
    let count = 0;
    let conflicting = false;
    for (const reply of thread.replies) {
        if (reply.authorNodeId !== authorNodeId) {
            continue;
        }
        const parsed = parseReviewRepairReplyForRole(reply.body, 'author');
        if (parsed === undefined || parsed.kind !== 'repair') {
            continue;
        }
        const record = parsed.record;
        const key = serializeReviewRepairRecord(record);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        count += 1;
        if (candidate === undefined || supersedesRepairRecord(candidate.record, record, isAncestor)) {
            candidate = { record, replyId: reply.id };
        } else {
            conflicting = true;
        }
    }
    if (candidate === undefined) {
        return { kind: 'none' };
    }
    if (conflicting) {
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
    // The live head moves when the author pushes again after recording (#4589). A recorded head that
    // is an ancestor of the live head keeps the record confirmable: the commit-range checks below
    // still require the recorded commit inside that live head, and a force-push that dropped the
    // commit would have left the recorded head outside the live history too. Any other mismatch —
    // a rewritten, diverged, or regressed head — keeps the exact-match refusal.
    if (record.head !== confirmation.head && !confirmation.isAncestor(record.head, confirmation.head)) {
        return `head ${record.head} does not match the confirmed head ${confirmation.head}`;
    }
    const finding = findingRefusal(thread, record.finding);
    if (finding !== undefined) {
        return finding;
    }
    return reviewRepairCommitRefusal({
        commit: record.commit,
        head: confirmation.head,
        base: confirmation.base,
        reviewedHead: thread.rootReviewedHead,
        isAncestor: confirmation.isAncestor,
    });
}

/**
 * A reviewer confirmation must name the exact selected V1 record. A digest mismatch, incompatible
 * pull request or thread, or invalid confirmation-head ancestry means the author changed the record or
 * the confirmation does not belong to this live finding. Two admitted confirmations are refused too:
 * a rerun may skip one already-posted reply, but resolving duplicates would settle twice-confirmed state.
 */
export type ReviewerConfirmationState = { alreadyPosted: boolean; refusal?: string };
type ReviewerConfirmationContext = Pick<RepairConfirmation, 'pr' | 'head' | 'isAncestor'> & {
    authorReplyId: number;
};

/**
 * Shared selection/replay inspection for admitted reviewer confirmation markers. A single matching
 * legacy or compact marker permits replay; every other admitted marker must bind this exact source
 * record and an ancestry chain from its recorded head through the confirmation head to the live head.
 */
export function reviewerConfirmationState(
    thread: ReviewRepairThreadState,
    record: ReviewRepairRecord,
    reviewerNodeId: string,
    confirmation: ReviewerConfirmationContext
): ReviewerConfirmationState {
    const accepted = serializeReviewRepairRecord(record);
    const acceptedDigest = reviewRepairRecordDigest(record);
    let confirmations = 0;
    for (const reply of thread.replies) {
        if (reply.authorNodeId !== reviewerNodeId) {
            continue;
        }
        const parsed = parseReviewRepairReplyForRole(reply.body, 'reviewer');
        if (parsed === undefined) {
            continue;
        }
        if (parsed.kind === 'legacy-confirmation') {
            if (serializeReviewRepairRecord(parsed.record) !== accepted) {
                return { alreadyPosted: false, refusal: DIFFERENT_RECORD_CONFIRMATION_REFUSAL };
            }
        } else if (parsed.kind === 'confirmation') {
            const posted = parsed.confirmation;
            if (
                posted.pr !== confirmation.pr ||
                posted.thread !== thread.thread ||
                posted.recordDigest !== acceptedDigest ||
                !confirmation.isAncestor(record.head, posted.confirmationHead) ||
                !confirmation.isAncestor(posted.confirmationHead, confirmation.head)
            ) {
                return { alreadyPosted: false, refusal: DIFFERENT_RECORD_CONFIRMATION_REFUSAL };
            }
        }
        if (reply.id <= confirmation.authorReplyId) {
            return {
                alreadyPosted: false,
                refusal: 'reviewer confirmation does not follow the selected author repair',
            };
        }
        confirmations += 1;
    }
    if (confirmations > 1) {
        return { alreadyPosted: false, refusal: `thread already carries ${confirmations} identical confirmations` };
    }
    return { alreadyPosted: confirmations === 1 };
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
        const found = authorRepairRecords(thread, input.authorNodeId, input.isAncestor);
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
            reviewerConfirmationState(thread, found.candidate.record, input.reviewerNodeId, {
                ...input,
                authorReplyId: found.candidate.replyId,
            }).refusal;
        if (reason !== undefined) {
            refused.push({ thread: thread.thread, reason });
            continue;
        }
        eligible.push({ thread: thread.thread, record: found.candidate.record, replyId: found.candidate.replyId });
    }

    return { eligible, refused, ignored };
}
