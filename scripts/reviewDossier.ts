/**
 * Durable, head-bound review-dossier record (#2999, spec #2995 AC-009/AC-010).
 *
 * A dossier binds one reviewed head to the stances its risk plan required, the findings the
 * orchestrator accepted or discarded, and the bounded evidence and limitations it publishes. Events
 * form a hash chain: every record's digest covers its predecessor, and `headDigest` plus the
 * `dossierDigest` over the header, evidence and limitations bind the record's contents. The chain
 * detects partial edits and inconsistent re-links; it is not an external anchor, so a wholesale
 * re-link that recomputes every digest is not detectable here.
 */

import { createHash } from 'node:crypto';

import { fail } from './prContract.ts';

import type { ReviewRiskClass, ReviewRiskPlan, ReviewStanceId } from './reviewRiskPolicy.ts';

export const REVIEW_DOSSIER_FORMAT = 'dossier-v1';
export const REVIEW_DOSSIER_MAX_BYTES = 32_768;
export const REVIEW_EVIDENCE_FIELD_MAX_BYTES = 2_048;

export const GENESIS_DIGEST: string = '0'.repeat(64);

export type ReviewModelTier = 'economy' | 'standard' | 'strongest';

export type ReviewDossierEvent =
    | {
          kind: 'stance-completed';
          stance: ReviewStanceId;
          reviewerModel: string;
          modelTier: ReviewModelTier;
          outcome: 'blocker-found' | 'clean';
      }
    | { kind: 'finding-accepted'; findingId: string; path: string; line: number; side: 'LEFT' | 'RIGHT' }
    | { kind: 'finding-discarded'; findingId: string; stance: ReviewStanceId; reason: string };

export type ReviewDossierEventRecord = ReviewDossierEvent & {
    sequence: number;
    previousDigest: string;
    digest: string;
};

export type ReviewDossier = {
    format: 'dossier-v1';
    pr: number;
    headSha: string;
    baseSha: string;
    riskClasses: ReviewRiskClass[];
    requiredStances: ReviewStanceId[];
    events: ReviewDossierEventRecord[];
    evidence: { observable: string; verification: string; observed: string }[];
    limitations: string[];
    recommendation: 'approve' | 'request-changes';
    headDigest: string;
    dossierDigest: string;
};

type ReviewEvidence = ReviewDossier['evidence'][number];
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type FieldEntry = readonly [string, JsonValue];
type ReadEventRecord = { event: ReviewDossierEvent; sequence: unknown; previousDigest: unknown; digest: unknown };
type DossierPayload = Omit<ReviewDossier, 'format' | 'events' | 'headDigest' | 'dossierDigest'> & {
    events: ReviewDossierEvent[];
};

/**
 * The literals the risk policy can earn, held as total maps so a widened policy union fails to
 * compile here rather than silently refusing a valid dossier at run time.
 */
const RISK_CLASS_MEMBERSHIP: Record<ReviewRiskClass, true> = {
    small: true,
    ordinary: true,
    'test-only': true,
    'cross-domain': true,
    'realtime-audio': true,
    'native-security': true,
    undo: true,
};

const STANCE_MEMBERSHIP: Record<ReviewStanceId, true> = {
    correctness: true,
    'module-boundaries': true,
    'realtime-audio': true,
    'project-integrity-undo': true,
    'security-platform': true,
    'code-craft': true,
    'test-validity': true,
};

const MODEL_TIERS: ReadonlySet<string> = new Set(['economy', 'standard', 'strongest']);
const OUTCOMES: ReadonlySet<string> = new Set(['blocker-found', 'clean']);
const SIDES: ReadonlySet<string> = new Set(['LEFT', 'RIGHT']);
const RECOMMENDATIONS: ReadonlySet<string> = new Set(['approve', 'request-changes']);

const DOSSIER_KEYS = [
    'format',
    'pr',
    'headSha',
    'baseSha',
    'riskClasses',
    'requiredStances',
    'events',
    'evidence',
    'limitations',
    'recommendation',
    'headDigest',
    'dossierDigest',
] as const;
const EVENT_KIND_KEYS: Record<ReviewDossierEvent['kind'], readonly string[]> = {
    'stance-completed': ['kind', 'stance', 'reviewerModel', 'modelTier', 'outcome'],
    'finding-accepted': ['kind', 'findingId', 'path', 'line', 'side'],
    'finding-discarded': ['kind', 'findingId', 'stance', 'reason'],
};
const EVIDENCE_KEYS = ['observable', 'verification', 'observed'] as const;
const DISCARDED_KEYS = ['finding', 'stance', 'reason'] as const;

/** A bearer credential is a token carrying a digit or non-dot symbol with a successor, or twenty-four. */
const BEARER_CREDENTIAL_PATTERN = /\bbearer\s+(?=[\w.~+/=-]*(?:[0-9_~+/=-][\w.~+/=-]|[\w.~+/=-]{24}))/iu;
/** The conventional serialized chat roles, matched case-insensitively so a capitalised one is refused. */
const CHAT_ROLE_PATTERN = /"role"\s*:\s*"(?:assistant|user|system|tool|function|developer)"/iu;

/** Every shape publication refuses, whatever field carries it, with the reason it is refused. */
const UNSAFE_VALUE_SHAPES: readonly { readonly reason: string; readonly pattern: RegExp }[] = [
    { reason: 'a GitHub token', pattern: /gh[pousr]_/u },
    { reason: 'a fine-grained GitHub token', pattern: /github_pat_/u },
    { reason: 'an AWS access key id', pattern: /A[KS]IA[0-9A-Z]{16}/u },
    { reason: 'a private key header', pattern: /-{4,5} ?BEGIN [A-Z0-9 ]*(?:PRIVATE|SECRET) KEY(?: BLOCK)? ?-{4,5}/u },
    { reason: 'a JSON web token', pattern: /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u },
    // RFC 6750/7235 auth schemes are case-insensitive, so `bearer` is refused like `Bearer`. The
    // token shape separates a credential from the word in `bearer token`: a digit or one of `_~+/=-`
    // anywhere with a token character after it, or twenty-four token characters. A dot never qualifies
    // on its own and a trailing period is punctuation, so prose stands; an eight-letter word is
    // indistinguishable from a token.
    { reason: 'a bearer credential', pattern: BEARER_CREDENTIAL_PATTERN },
    // A serialized chat role is a transcript turn whichever role it names; the named set is the
    // conventional serialized roles, so prose that merely mentions a role never matches.
    { reason: 'a serialized chat turn', pattern: CHAT_ROLE_PATTERN },
    { reason: 'a transcript role prefix', pattern: /^(?:Human|Assistant|System):/mu },
    { reason: 'a session transcript marker', pattern: /⏺|<session/u },
];

function sha256Hex(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Key-sorted, whitespace-free JSON. Digest inputs are this text, never a pretty print. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function isReviewRiskClass(value: string): value is ReviewRiskClass {
    return Object.hasOwn(RISK_CLASS_MEMBERSHIP, value);
}

function isReviewStanceId(value: string): value is ReviewStanceId {
    return Object.hasOwn(STANCE_MEMBERSHIP, value);
}

function readLiteral<Value extends string>(
    label: string,
    value: unknown,
    matches: (candidate: string) => candidate is Value,
    expected: string
): Value {
    if (typeof value !== 'string' || !matches(value)) {
        fail(`review dossier ${label} must be ${expected}, found ${describeValue(value)}`);
    }
    return value;
}

function isModelTier(value: string): value is ReviewModelTier {
    return MODEL_TIERS.has(value);
}

function isOutcome(value: string): value is 'blocker-found' | 'clean' {
    return OUTCOMES.has(value);
}

function isSide(value: string): value is 'LEFT' | 'RIGHT' {
    return SIDES.has(value);
}

function isRecommendation(value: string): value is 'approve' | 'request-changes' {
    return RECOMMENDATIONS.has(value);
}

function readArray(label: string, value: unknown): readonly unknown[] {
    if (!Array.isArray(value)) {
        fail(`review dossier ${label} must be an array, found ${describeValue(value)}`);
    }
    return value;
}

function readNonBlankString(label: string, value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`review dossier ${label} must be a non-blank string, found ${describeValue(value)}`);
    }
    return value;
}

/**
 * Every caller-written string the record persists is published evidence like any other recorded
 * value, so it carries the same single-line, trimmed, bounded and credential-refusing rules. The
 * non-blank read runs first so a blank value still names itself rather than the safety rule that
 * also catches it.
 */
function readPublicationSafeString(label: string, value: unknown): string {
    const text = readNonBlankString(label, value);
    assertPublicationSafeEvidence(label, [text]);
    return text;
}

function readPositiveInteger(label: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        fail(`review dossier ${label} must be a positive safe integer, found ${describeValue(value)}`);
    }
    return value;
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
    const actual = Object.keys(record).sort().join(',');
    const expected = [...allowed].sort().join(',');
    if (actual !== expected) {
        fail(`review dossier ${label} fields must be ${expected}, found ${actual}`);
    }
}

function assertSortedUnique(label: string, values: readonly string[]): void {
    let previous: string | undefined;
    for (const value of values) {
        if (value === previous) {
            fail(`review dossier ${label} must not contain duplicates, found ${value}`);
        }
        if (previous !== undefined && value < previous) {
            fail(`review dossier ${label} must be sorted, found ${value} after ${previous}`);
        }
        previous = value;
    }
}

function readRiskClasses(value: unknown): ReviewRiskClass[] {
    const riskClasses: ReviewRiskClass[] = [];
    for (const entry of readArray('riskClasses', value)) {
        riskClasses.push(readLiteral('riskClasses entry', entry, isReviewRiskClass, 'a known risk class'));
    }
    assertSortedUnique('riskClasses', riskClasses);
    return riskClasses;
}

function readRequiredStances(value: unknown): ReviewStanceId[] {
    const requiredStances: ReviewStanceId[] = [];
    for (const entry of readArray('requiredStances', value)) {
        requiredStances.push(readLiteral('requiredStances entry', entry, isReviewStanceId, 'a known review stance'));
    }
    assertSortedUnique('requiredStances', requiredStances);
    return requiredStances;
}

function readEventKind(record: Record<string, unknown>, label: string): ReviewDossierEvent['kind'] {
    const kind = record.kind;
    if (kind !== 'stance-completed' && kind !== 'finding-accepted' && kind !== 'finding-discarded') {
        fail(`review dossier ${label} kind must be a known event kind, found ${describeValue(kind)}`);
    }
    return kind;
}

function readEvent(
    record: Record<string, unknown>,
    kind: ReviewDossierEvent['kind'],
    label: string
): ReviewDossierEvent {
    if (kind === 'stance-completed') {
        return {
            kind,
            stance: readLiteral(`${label} stance`, record.stance, isReviewStanceId, 'a known review stance'),
            reviewerModel: readPublicationSafeString(`${label} reviewerModel`, record.reviewerModel),
            modelTier: readLiteral(
                `${label} modelTier`,
                record.modelTier,
                isModelTier,
                'economy, standard or strongest'
            ),
            outcome: readLiteral(`${label} outcome`, record.outcome, isOutcome, 'blocker-found or clean'),
        };
    }
    if (kind === 'finding-accepted') {
        return {
            kind,
            findingId: readPublicationSafeString(`${label} findingId`, record.findingId),
            path: readPublicationSafeString(`${label} path`, record.path),
            line: readPositiveInteger(`${label} line`, record.line),
            side: readLiteral(`${label} side`, record.side, isSide, 'LEFT or RIGHT'),
        };
    }
    return {
        kind,
        findingId: readPublicationSafeString(`${label} findingId`, record.findingId),
        stance: readLiteral(`${label} stance`, record.stance, isReviewStanceId, 'a known review stance'),
        reason: readPublicationSafeString(`${label} reason`, record.reason),
    };
}

function readEventRecord(value: unknown, label: string, withChain: boolean): ReadEventRecord {
    if (!isRecord(value)) {
        fail(`review dossier ${label} must be an object, found ${describeValue(value)}`);
    }
    const kind = readEventKind(value, label);
    const kindKeys = EVENT_KIND_KEYS[kind];
    assertExactKeys(value, withChain ? [...kindKeys, 'sequence', 'previousDigest', 'digest'] : kindKeys, label);
    return {
        event: readEvent(value, kind, label),
        sequence: value.sequence,
        previousDigest: value.previousDigest,
        digest: value.digest,
    };
}

function readEvidenceEntry(value: unknown, index: number): ReviewEvidence {
    const label = `evidence[${index}]`;
    if (!isRecord(value)) {
        fail(`review dossier ${label} must be an object, found ${describeValue(value)}`);
    }
    assertExactKeys(value, EVIDENCE_KEYS, label);
    return {
        observable: readNonBlankString(`${label}.observable`, value.observable),
        verification: readNonBlankString(`${label}.verification`, value.verification),
        observed: readNonBlankString(`${label}.observed`, value.observed),
    };
}

function readEvidence(value: unknown): ReviewEvidence[] {
    return readArray('evidence', value).map(readEvidenceEntry);
}

function readLimitations(value: unknown): string[] {
    return readArray('limitations', value).map((entry, index) => readNonBlankString(`limitations[${index}]`, entry));
}

function readDiscardedEntry(value: unknown, index: number): ReviewDossierEvent {
    const label = `discarded[${index}]`;
    if (!isRecord(value)) {
        fail(`review dossier ${label} must be an object, found ${describeValue(value)}`);
    }
    assertExactKeys(value, DISCARDED_KEYS, label);
    return {
        kind: 'finding-discarded',
        findingId: readPublicationSafeString(`${label} finding`, value.finding),
        stance: readLiteral(`${label} stance`, value.stance, isReviewStanceId, 'a known review stance'),
        reason: readPublicationSafeString(`${label} reason`, value.reason),
    };
}

function assertTotalMaps(payload: DossierPayload): void {
    const completed = new Set<ReviewStanceId>();
    const accepted = new Set<string>();
    const discarded = new Set<string>();
    for (const event of payload.events) {
        if (event.kind === 'stance-completed') {
            if (completed.has(event.stance)) {
                fail(`review dossier completes stance more than once: ${event.stance}`);
            }
            if (!payload.requiredStances.includes(event.stance)) {
                fail(`review dossier completes a stance the plan did not require: ${event.stance}`);
            }
            completed.add(event.stance);
            continue;
        }
        if (event.kind === 'finding-discarded' && !payload.requiredStances.includes(event.stance)) {
            fail(`review dossier discards a finding under a stance the plan did not require: ${event.stance}`);
        }
        const own = event.kind === 'finding-accepted' ? accepted : discarded;
        const other = event.kind === 'finding-accepted' ? discarded : accepted;
        if (own.has(event.findingId)) {
            fail(`review dossier repeats a ${event.kind} finding id: ${event.findingId}`);
        }
        if (other.has(event.findingId)) {
            fail(`review dossier both accepts and discards finding: ${event.findingId}`);
        }
        own.add(event.findingId);
    }
    for (const stance of payload.requiredStances) {
        if (!completed.has(stance)) {
            fail(`review dossier has no completed record for required stance: ${stance}`);
        }
    }
}

function assertEvidenceSafe(evidence: readonly ReviewEvidence[], limitations: readonly string[]): void {
    for (const [index, entry] of evidence.entries()) {
        for (const field of EVIDENCE_KEYS) {
            assertPublicationSafeEvidence(`evidence[${index}].${field}`, [entry[field]]);
        }
    }
    assertPublicationSafeEvidence('limitations', limitations);
}

/** The event's own fields, in canonical order. Key order is fixed here, not by object insertion. */
function eventFieldEntries(event: ReviewDossierEvent): FieldEntry[] {
    if (event.kind === 'stance-completed') {
        return [
            ['kind', event.kind],
            ['stance', event.stance],
            ['reviewerModel', event.reviewerModel],
            ['modelTier', event.modelTier],
            ['outcome', event.outcome],
        ];
    }
    if (event.kind === 'finding-accepted') {
        return [
            ['kind', event.kind],
            ['findingId', event.findingId],
            ['path', event.path],
            ['line', event.line],
            ['side', event.side],
        ];
    }
    return [
        ['kind', event.kind],
        ['findingId', event.findingId],
        ['stance', event.stance],
        ['reason', event.reason],
    ];
}

function chainEntries(sequence: number, previousDigest: string): FieldEntry[] {
    return [
        ['sequence', sequence],
        ['previousDigest', previousDigest],
    ];
}

export function reviewDossierEventDigest(
    record: { sequence: number; previousDigest: string } & ReviewDossierEvent
): string {
    const entries = [...chainEntries(record.sequence, record.previousDigest), ...eventFieldEntries(record)];
    return sha256Hex(canonicalJson(Object.fromEntries(entries)));
}

function chainEvents(events: readonly ReviewDossierEvent[]): ReviewDossierEventRecord[] {
    let previousDigest = GENESIS_DIGEST;
    return events.map((event, sequence) => {
        const digest = reviewDossierEventDigest({ ...event, sequence, previousDigest });
        const record = { ...event, sequence, previousDigest, digest };
        previousDigest = digest;
        return record;
    });
}

function headDigestOf(events: readonly ReviewDossierEventRecord[]): string {
    return events.at(-1)?.digest ?? GENESIS_DIGEST;
}

function computeDossierDigest(payload: DossierPayload, headDigest: string): string {
    return sha256Hex(
        canonicalJson({
            format: REVIEW_DOSSIER_FORMAT,
            pr: payload.pr,
            headSha: payload.headSha,
            baseSha: payload.baseSha,
            riskClasses: payload.riskClasses,
            requiredStances: payload.requiredStances,
            evidence: payload.evidence,
            limitations: payload.limitations,
            recommendation: payload.recommendation,
            headDigest,
        })
    );
}

function buildDossier(payload: DossierPayload): ReviewDossier {
    const events = chainEvents(payload.events);
    const headDigest = headDigestOf(events);
    return {
        format: REVIEW_DOSSIER_FORMAT,
        pr: payload.pr,
        headSha: payload.headSha,
        baseSha: payload.baseSha,
        riskClasses: payload.riskClasses,
        requiredStances: payload.requiredStances,
        events,
        evidence: payload.evidence,
        limitations: payload.limitations,
        recommendation: payload.recommendation,
        headDigest,
        dossierDigest: computeDossierDigest(payload, headDigest),
    };
}

function verifyEventChain(records: readonly ReadEventRecord[]): ReviewDossierEventRecord[] {
    const chained: ReviewDossierEventRecord[] = [];
    let previousDigest = GENESIS_DIGEST;
    for (const [index, record] of records.entries()) {
        if (record.sequence !== index) {
            fail(`review dossier event ${index} sequence must be ${index}, found ${describeValue(record.sequence)}`);
        }
        if (record.previousDigest !== previousDigest) {
            fail(
                `review dossier event ${index} previousDigest does not chain: ${describeValue(record.previousDigest)}`
            );
        }
        const digest = readNonBlankString(`event ${index} digest`, record.digest);
        const recomputed = reviewDossierEventDigest({ ...record.event, sequence: index, previousDigest });
        if (digest !== recomputed) {
            fail(`review dossier event ${index} digest does not match its payload: ${digest}`);
        }
        chained.push({ ...record.event, sequence: index, previousDigest, digest });
        previousDigest = digest;
    }
    return chained;
}

function assertDossierSize(dossier: ReviewDossier): void {
    const bytes = Buffer.byteLength(serializeReviewDossier(dossier), 'utf8');
    if (bytes > REVIEW_DOSSIER_MAX_BYTES) {
        fail(`review dossier exceeds ${REVIEW_DOSSIER_MAX_BYTES} bytes: ${bytes}`);
    }
}

export function assertPublicationSafeEvidence(label: string, values: readonly string[]): void {
    for (const [index, value] of values.entries()) {
        assertSafeEvidenceValue(label, index, value);
    }
}

function assertSafeEvidenceValue(label: string, index: number, value: string): void {
    if (value.trim() === '') {
        fail(`${label} value at index ${index} is blank`);
    }
    if (value !== value.trim()) {
        fail(`${label} value at index ${index} is not edge-trimmed`);
    }
    if (/[\r\n\u2028\u2029]/u.test(value)) {
        fail(`${label} value at index ${index} contains a line separator`);
    }
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > REVIEW_EVIDENCE_FIELD_MAX_BYTES) {
        fail(`${label} value at index ${index} exceeds ${REVIEW_EVIDENCE_FIELD_MAX_BYTES} bytes: ${bytes}`);
    }
    for (const { reason, pattern } of UNSAFE_VALUE_SHAPES) {
        if (pattern.test(value)) {
            fail(`${label} value at index ${index} contains ${reason}`);
        }
    }
}

function serializeEventRecord(record: ReviewDossierEventRecord): Record<string, unknown> {
    const chain: FieldEntry[] = [...chainEntries(record.sequence, record.previousDigest), ['digest', record.digest]];
    return Object.fromEntries([...chain, ...eventFieldEntries(record)]);
}

export function serializeReviewDossier(dossier: ReviewDossier): string {
    const record = {
        format: dossier.format,
        pr: dossier.pr,
        headSha: dossier.headSha,
        baseSha: dossier.baseSha,
        riskClasses: dossier.riskClasses,
        requiredStances: dossier.requiredStances,
        events: dossier.events.map(serializeEventRecord),
        evidence: dossier.evidence.map((entry) => ({
            observable: entry.observable,
            verification: entry.verification,
            observed: entry.observed,
        })),
        limitations: dossier.limitations,
        recommendation: dossier.recommendation,
        headDigest: dossier.headDigest,
        dossierDigest: dossier.dossierDigest,
    };
    return `${JSON.stringify(record, null, 4)}\n`;
}

export function parseReviewDossier(value: unknown): ReviewDossier {
    if (!isRecord(value)) {
        fail(`review dossier must be an object, found ${describeValue(value)}`);
    }
    assertExactKeys(value, DOSSIER_KEYS, 'dossier');
    if (value.format !== REVIEW_DOSSIER_FORMAT) {
        fail(`review dossier format must be ${REVIEW_DOSSIER_FORMAT}, found ${describeValue(value.format)}`);
    }
    const records = readArray('events', value.events).map((entry, index) =>
        readEventRecord(entry, `event ${index}`, true)
    );
    const payload: DossierPayload = {
        pr: readPositiveInteger('pr', value.pr),
        headSha: readNonBlankString('headSha', value.headSha),
        baseSha: readNonBlankString('baseSha', value.baseSha),
        riskClasses: readRiskClasses(value.riskClasses),
        requiredStances: readRequiredStances(value.requiredStances),
        events: records.map((record) => record.event),
        evidence: readEvidence(value.evidence),
        limitations: readLimitations(value.limitations),
        recommendation: readLiteral(
            'recommendation',
            value.recommendation,
            isRecommendation,
            'approve or request-changes'
        ),
    };
    assertTotalMaps(payload);
    assertEvidenceSafe(payload.evidence, payload.limitations);
    const events = verifyEventChain(records);
    const headDigest = readNonBlankString('headDigest', value.headDigest);
    const expectedHeadDigest = headDigestOf(events);
    if (headDigest !== expectedHeadDigest) {
        fail(`review dossier headDigest must be ${expectedHeadDigest}, found ${headDigest}`);
    }
    const dossierDigest = readNonBlankString('dossierDigest', value.dossierDigest);
    const dossier: ReviewDossier = { format: REVIEW_DOSSIER_FORMAT, ...payload, events, headDigest, dossierDigest };
    // The coarse byte ceiling runs before the content digest so an externally crafted over-size
    // record is still refused by the bound rather than only by its content mismatch.
    assertDossierSize(dossier);
    const expectedDossierDigest = computeDossierDigest(payload, headDigest);
    if (dossierDigest !== expectedDossierDigest) {
        fail(`review dossier dossierDigest does not match its payload: ${dossierDigest}`);
    }
    return dossier;
}

export function assembleReviewDossier(input: {
    plan: ReviewRiskPlan;
    events: readonly ReviewDossierEvent[];
    discarded: unknown;
    evidence: readonly { observable: string; verification: string; observed: string }[];
    limitations: readonly string[];
    recommendation: 'approve' | 'request-changes';
}): ReviewDossier {
    const callerEvents = input.events.map((event, index) => readEventRecord(event, `event ${index}`, false).event);
    const payload: DossierPayload = {
        pr: readPositiveInteger('pr', input.plan.pr),
        headSha: readNonBlankString('headSha', input.plan.headSha),
        baseSha: readNonBlankString('baseSha', input.plan.baseSha),
        riskClasses: readRiskClasses(input.plan.riskClasses),
        requiredStances: readRequiredStances(input.plan.requiredStances),
        events: [...callerEvents, ...readArray('discarded', input.discarded).map(readDiscardedEntry)],
        evidence: readEvidence(input.evidence),
        limitations: readLimitations(input.limitations),
        recommendation: readLiteral(
            'recommendation',
            input.recommendation,
            isRecommendation,
            'approve or request-changes'
        ),
    };
    assertTotalMaps(payload);
    assertEvidenceSafe(payload.evidence, payload.limitations);
    const dossier = buildDossier(payload);
    assertDossierSize(dossier);
    return dossier;
}

export function completedStances(
    dossier: ReviewDossier
): { stance: ReviewStanceId; reviewerModel: string; modelTier: ReviewModelTier; outcome: 'blocker-found' | 'clean' }[] {
    return dossier.events
        .filter((event) => event.kind === 'stance-completed')
        .map((event) => ({
            stance: event.stance,
            reviewerModel: event.reviewerModel,
            modelTier: event.modelTier,
            outcome: event.outcome,
        }));
}

export function acceptedFindings(
    dossier: ReviewDossier
): { findingId: string; path: string; line: number; side: 'LEFT' | 'RIGHT' }[] {
    return dossier.events
        .filter((event) => event.kind === 'finding-accepted')
        .map((event) => ({ findingId: event.findingId, path: event.path, line: event.line, side: event.side }));
}

export function discardedDispositions(
    dossier: ReviewDossier
): { findingId: string; stance: ReviewStanceId; reason: string }[] {
    return dossier.events
        .filter((event) => event.kind === 'finding-discarded')
        .map((event) => ({ findingId: event.findingId, stance: event.stance, reason: event.reason }));
}
