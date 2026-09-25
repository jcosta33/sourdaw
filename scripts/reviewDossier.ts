/**
 * Durable, head-bound review-dossier record (#2999, spec #2995 AC-009/AC-010).
 *
 * A dossier binds one reviewed head to the stances its review dispatched, the findings the
 * orchestrator accepted or discarded, and the bounded evidence and limitations it publishes. After
 * the review POST lands, the resulting public ids append to the same record (#3375, spec #3367
 * AC-004): one `review-published` binding the review, and one `finding-published` per accepted
 * finding binding its public comment id. Events form a hash chain: every record's digest covers
 * its predecessor, and `headDigest` plus the `dossierDigest` over the header, evidence and
 * limitations bind the record's contents. The chain detects partial edits and inconsistent
 * re-links; it is not an external anchor, so a wholesale re-link that recomputes every digest is
 * not detectable here.
 */

import { assertPublicationSafeEvidence } from './evidenceSafety.ts';
import { fail } from './prContract.ts';
import {
    GENESIS_DIGEST,
    REVIEW_DOSSIER_FORMAT,
    assertAssessmentImpactConsistent,
    assertDossierSize,
    buildDossier,
    computeDossierDigest,
    dossierPayload,
    headDigestOf,
    readAssessmentImpact,
    reviewDossierEventDigest,
    type AssessmentImpact,
} from './reviewDossierChain.ts';
import {
    REVIEW_REASSESSED_EVENT_KEYS,
    readReviewReassessedEvent,
    type ReviewReassessedDossierEvent,
} from './reviewDossierReassessed.ts';

import type { ReviewRiskClass, ReviewRiskPlan } from './reviewRiskPolicy.ts';

export {
    GENESIS_DIGEST,
    REVIEW_DOSSIER_FORMAT,
    REVIEW_DOSSIER_MAX_BYTES,
    authorizedEvidenceDigest,
    reviewDossierEventDigest,
    serializeReviewDossier,
    type AssessmentImpact,
} from './reviewDossierChain.ts';

export type ReviewModelTier = 'economy' | 'standard' | 'strongest';

/**
 * A dispatched review stance name: the reviewer's task-derived judgement, not a plan menu id. The
 * value is caller-authored published evidence, so it carries the same safe single-line rules as the
 * record's other literal fields, and historical records holding plan menu ids read unchanged.
 */
export type ReviewDossierStance = string;

/** One completed entry per draw: one stance performed by one reviewer model. */
export type CompletedReviewStance = {
    stance: ReviewDossierStance;
    reviewerModel: string;
    modelTier: ReviewModelTier;
    outcome: 'blocker-found' | 'clean';
    /** Present only when this draw reused an authoring model; absent keeps historical digests. */
    exhaustion?: string;
};

export type ReviewDossierEvent =
    | ({ kind: 'stance-completed' } & CompletedReviewStance)
    | { kind: 'finding-accepted'; findingId: string; path: string; line: number; side: 'LEFT' | 'RIGHT' }
    | { kind: 'finding-discarded'; findingId: string; stance: ReviewDossierStance; reason: string }
    // The post-publish bindings (#3375, spec #3367 AC-004): once the review POST lands, its public
    // ids append to the chain so the record binds not just the dispositions but the exact public
    // records they produced. Records persisted before these kinds existed carry neither.
    | { kind: 'review-published'; reviewId: number }
    | { kind: 'finding-published'; findingId: string; reviewId: number; commentId: number }
    // The orchestrator's delivery authorization (#3376, spec #3367 AC-005): once the acceptance
    // POST lands, the record binds the acceptance review id to the exact approval review,
    // evidence-manifest digest, unresolved-thread count, and delivery intent it authorizes.
    // Records persisted before this kind existed carry none.
    | {
          kind: 'delivery-authorized';
          reviewId: number;
          approvalReviewId: number;
          evidenceManifestDigest: string;
          unresolvedThreads: number;
          intent: 'deliver';
      }
    // The escalation reassessment the reviewer publication consumed (#4584): the orchestrator's
    // `reassessment.json` recorded the observed reviewer request-changes rounds before the next
    // fresh publication was allowed past the threshold. Records persisted before this kind
    // existed carry none.
    | ReviewReassessedDossierEvent;

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
    requiredStances: ReviewDossierStance[];
    events: ReviewDossierEventRecord[];
    evidence: { observable: string; verification: string; observed: string }[];
    limitations: string[];
    recommendation: 'approve' | 'request-changes';
    /**
     * Required of the caller input and of a canonical record supplied for a fresh publication,
     * enforced at that boundary; the read path tolerates its absence so a record persisted before the
     * field existed keeps verifying rather than being refused for a field it never carried (the same
     * historical tolerance `exhaustion` gets). Present, its value must be one of the four tokens.
     */
    assessmentImpact?: AssessmentImpact;
    headDigest: string;
    dossierDigest: string;
};

type ReviewEvidence = ReviewDossier['evidence'][number];
type ReadEventRecord = { event: ReviewDossierEvent; sequence: unknown; previousDigest: unknown; digest: unknown };
export type DossierPayload = Omit<ReviewDossier, 'format' | 'events' | 'headDigest' | 'dossierDigest'> & {
    events: ReviewDossierEvent[];
};

/**
 * The known risk classes, held as a total map so a widened union fails to compile here rather than
 * silently refusing a valid dossier at run time. Stance names are free-form safe strings, so they
 * need no membership map.
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
    'review-published': ['kind', 'reviewId'],
    'finding-published': ['kind', 'findingId', 'reviewId', 'commentId'],
    'delivery-authorized': [
        'kind',
        'reviewId',
        'approvalReviewId',
        'evidenceManifestDigest',
        'unresolvedThreads',
        'intent',
    ],
    'review-reassessed': REVIEW_REASSESSED_EVENT_KEYS,
};
const EVIDENCE_KEYS = ['observable', 'verification', 'observed'] as const;
const DISCARDED_KEYS = ['finding', 'stance', 'reason'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function isReviewRiskClass(value: string): value is ReviewRiskClass {
    return Object.hasOwn(RISK_CLASS_MEMBERSHIP, value);
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

function readNonNegativeInteger(label: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        fail(`review dossier ${label} must be a non-negative safe integer, found ${describeValue(value)}`);
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

function readRequiredStances(value: unknown): ReviewDossierStance[] {
    const requiredStances: ReviewDossierStance[] = [];
    for (const [index, entry] of readArray('requiredStances', value).entries()) {
        requiredStances.push(readPublicationSafeString(`requiredStances[${index}]`, entry));
    }
    assertSortedUnique('requiredStances', requiredStances);
    return requiredStances;
}

function readEventKind(record: Record<string, unknown>, label: string): ReviewDossierEvent['kind'] {
    const kind = record.kind;
    if (
        kind !== 'stance-completed' &&
        kind !== 'finding-accepted' &&
        kind !== 'finding-discarded' &&
        kind !== 'review-published' &&
        kind !== 'finding-published' &&
        kind !== 'delivery-authorized' &&
        kind !== 'review-reassessed'
    ) {
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
        const completed: ReviewDossierEvent = {
            kind,
            stance: readPublicationSafeString(`${label} stance`, record.stance),
            reviewerModel: readPublicationSafeString(`${label} reviewerModel`, record.reviewerModel),
            modelTier: readLiteral(
                `${label} modelTier`,
                record.modelTier,
                isModelTier,
                'economy, standard or strongest'
            ),
            outcome: readLiteral(`${label} outcome`, record.outcome, isOutcome, 'blocker-found or clean'),
        };
        if (record.exhaustion !== undefined) {
            completed.exhaustion = readPublicationSafeString(`${label} exhaustion`, record.exhaustion);
        }
        return completed;
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
    if (kind === 'review-published') {
        return { kind, reviewId: readPositiveInteger(`${label} reviewId`, record.reviewId) };
    }
    if (kind === 'finding-published') {
        return {
            kind,
            findingId: readPublicationSafeString(`${label} findingId`, record.findingId),
            reviewId: readPositiveInteger(`${label} reviewId`, record.reviewId),
            commentId: readPositiveInteger(`${label} commentId`, record.commentId),
        };
    }
    if (kind === 'delivery-authorized') {
        const digest = readNonBlankString(`${label} evidenceManifestDigest`, record.evidenceManifestDigest);
        if (!/^[0-9a-f]{64}$/u.test(digest)) {
            fail(`review dossier ${label} evidenceManifestDigest must be a sha256 hex digest, found ${digest}`);
        }
        return {
            kind,
            reviewId: readPositiveInteger(`${label} reviewId`, record.reviewId),
            approvalReviewId: readPositiveInteger(`${label} approvalReviewId`, record.approvalReviewId),
            evidenceManifestDigest: digest,
            unresolvedThreads: readNonNegativeInteger(`${label} unresolvedThreads`, record.unresolvedThreads),
            intent: readLiteral(
                `${label} intent`,
                record.intent,
                (value): value is 'deliver' => value === 'deliver',
                'deliver'
            ),
        };
    }
    if (kind === 'review-reassessed') {
        return readReviewReassessedEvent(record, label);
    }
    return {
        kind,
        findingId: readPublicationSafeString(`${label} findingId`, record.findingId),
        stance: readPublicationSafeString(`${label} stance`, record.stance),
        reason: readPublicationSafeString(`${label} reason`, record.reason),
    };
}

function readEventRecord(value: unknown, label: string, withChain: boolean): ReadEventRecord {
    if (!isRecord(value)) {
        fail(`review dossier ${label} must be an object, found ${describeValue(value)}`);
    }
    const kind = readEventKind(value, label);
    // A stance-completed event carries `exhaustion` only when that draw fell back, so its key set
    // has two shapes; every other kind's key set is fixed.
    let kindKeys: readonly string[] = EVENT_KIND_KEYS[kind];
    if (kind === 'stance-completed' && 'exhaustion' in value) {
        kindKeys = [...kindKeys, 'exhaustion'];
    }
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
        stance: readPublicationSafeString(`${label} stance`, value.stance),
        reason: readPublicationSafeString(`${label} reason`, value.reason),
    };
}

type PublicationBindings = {
    reviewId: number | undefined;
    findings: Map<string, Extract<ReviewDossierEvent, { kind: 'finding-published' }>>;
    authorization: Extract<ReviewDossierEvent, { kind: 'delivery-authorized' }> | undefined;
    reassessment: Extract<ReviewDossierEvent, { kind: 'review-reassessed' }> | undefined;
};

/**
 * Collects the publication-binding events, refusing the structural violations on sight: at most
 * one recorded publication, and any finding bound at most once. Binding-to-disposition rules run
 * in `assertPublicationBindings` after the disposition sets are complete, so the record's own
 * event order — bindings always append after the dispositions — is not part of the rule.
 */
function collectPublicationBindings(events: readonly ReviewDossierEvent[]): PublicationBindings {
    const bindings: PublicationBindings = {
        reviewId: undefined,
        findings: new Map(),
        authorization: undefined,
        reassessment: undefined,
    };
    for (const event of events) {
        if (event.kind === 'review-published') {
            if (bindings.reviewId !== undefined) {
                fail(`review dossier records more than one publication: ${bindings.reviewId} and ${event.reviewId}`);
            }
            bindings.reviewId = event.reviewId;
        }
        if (event.kind === 'finding-published') {
            if (bindings.findings.has(event.findingId)) {
                fail(`review dossier publishes finding ${event.findingId} more than once`);
            }
            bindings.findings.set(event.findingId, event);
        }
        if (event.kind === 'delivery-authorized') {
            if (bindings.authorization !== undefined) {
                fail(
                    `review dossier records more than one delivery authorization: ${bindings.authorization.reviewId} and ${event.reviewId}`
                );
            }
            if (bindings.reviewId === undefined) {
                fail(`review dossier records delivery authorization ${event.reviewId} without a recorded publication`);
            }
            if (event.approvalReviewId !== bindings.reviewId) {
                fail(
                    `review dossier delivery authorization ${event.reviewId} binds approval ${event.approvalReviewId}, not the recorded publication ${bindings.reviewId}`
                );
            }
            bindings.authorization = event;
        }
        if (event.kind === 'review-reassessed') {
            if (bindings.reassessment !== undefined) {
                fail(`review dossier records more than one round reassessment`);
            }
            bindings.reassessment = event;
        }
    }
    return bindings;
}

/** Every published finding binds an accepted one, and names the one recorded publication. */
function assertPublicationBindings(bindings: PublicationBindings, accepted: ReadonlySet<string>): void {
    for (const event of bindings.findings.values()) {
        if (!accepted.has(event.findingId)) {
            fail(`review dossier publishes finding ${event.findingId}, which no accepted finding carries`);
        }
        if (bindings.reviewId === undefined) {
            fail(`review dossier publishes finding ${event.findingId} without recording the publication's review id`);
        }
        if (event.reviewId !== bindings.reviewId) {
            fail(
                `review dossier finding ${event.findingId} binds review ${event.reviewId}, not the recorded publication ${bindings.reviewId}`
            );
        }
    }
}

function assertTotalMaps(payload: DossierPayload): void {
    const completedDraws = new Set<string>();
    const completed = new Set<ReviewDossierStance>();
    const accepted = new Set<string>();
    const discarded = new Set<string>();
    const bindings = collectPublicationBindings(payload.events);
    for (const event of payload.events) {
        if (
            event.kind === 'review-published' ||
            event.kind === 'finding-published' ||
            event.kind === 'delivery-authorized' ||
            event.kind === 'review-reassessed'
        ) {
            continue;
        }
        if (event.kind === 'stance-completed') {
            // One stance may carry several draws with distinct reviewer models; only an exact
            // (stance, reviewerModel) repeat records the same draw twice. JSON framing cannot
            // collide: the pair separator is structural, never string content.
            const drawKey = JSON.stringify([event.stance, event.reviewerModel]);
            if (completedDraws.has(drawKey)) {
                fail(`review dossier completes stance ${event.stance} more than once on ${event.reviewerModel}`);
            }
            if (!payload.requiredStances.includes(event.stance)) {
                fail(`review dossier completes a stance its required stances do not carry: ${event.stance}`);
            }
            completedDraws.add(drawKey);
            completed.add(event.stance);
            continue;
        }
        if (event.kind === 'finding-discarded' && !payload.requiredStances.includes(event.stance)) {
            fail(`review dossier discards a finding under a stance its required stances do not carry: ${event.stance}`);
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
    assertPublicationBindings(bindings, accepted);
    // Wherever the impact is present, the record's own contents must not contradict it. Absence is
    // the publication boundary's concern, not this shared payload assertion's.
    assertAssessmentImpactConsistent(payload);
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

export function parseReviewDossier(value: unknown): ReviewDossier {
    if (!isRecord(value)) {
        fail(`review dossier must be an object, found ${describeValue(value)}`);
    }
    // `assessmentImpact` is required of the input and of newly assembled records, but a record
    // persisted before the field existed carries none: carry it out of the key-set check it would
    // otherwise fail, and read it only when present so a historical digest keeps verifying.
    const assessmentImpact = 'assessmentImpact' in value ? readAssessmentImpact(value.assessmentImpact) : undefined;
    const { assessmentImpact: _optional, ...requiredKeys } = value;
    assertExactKeys(requiredKeys, DOSSIER_KEYS, 'dossier');
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
        assessmentImpact,
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

/**
 * The record's stance list is the dispatch, not the risk plan's menu: the stance-completed events
 * are what the review actually dispatched, and `requiredStances` carries them so the record's own
 * header and event chain cannot disagree. The plan's mechanically derived list is never read here.
 */
function dispatchedStances(events: readonly ReviewDossierEvent[]): ReviewDossierStance[] {
    const completed = events.filter(
        (event): event is Extract<ReviewDossierEvent, { kind: 'stance-completed' }> => event.kind === 'stance-completed'
    );
    return [...new Set(completed.map((event) => event.stance))].sort();
}

export function assembleReviewDossier(input: {
    plan: ReviewRiskPlan;
    events: readonly ReviewDossierEvent[];
    discarded: unknown;
    evidence: readonly { observable: string; verification: string; observed: string }[];
    limitations: readonly string[];
    recommendation: 'approve' | 'request-changes';
    assessmentImpact: AssessmentImpact;
}): ReviewDossier {
    const callerEvents = input.events.map((event, index) => readEventRecord(event, `event ${index}`, false).event);
    const payload: DossierPayload = {
        pr: readPositiveInteger('pr', input.plan.pr),
        headSha: readNonBlankString('headSha', input.plan.headSha),
        baseSha: readNonBlankString('baseSha', input.plan.baseSha),
        riskClasses: readRiskClasses(input.plan.riskClasses),
        requiredStances: dispatchedStances(callerEvents),
        events: [...callerEvents, ...readArray('discarded', input.discarded).map(readDiscardedEntry)],
        evidence: readEvidence(input.evidence),
        limitations: readLimitations(input.limitations),
        recommendation: readLiteral(
            'recommendation',
            input.recommendation,
            isRecommendation,
            'approve or request-changes'
        ),
        assessmentImpact: readAssessmentImpact(input.assessmentImpact),
    };
    assertTotalMaps(payload);
    assertEvidenceSafe(payload.evidence, payload.limitations);
    const dossier = buildDossier(payload);
    assertDossierSize(dossier);
    return dossier;
}

/**
 * Appends post-publication binding events to a persisted dossier (#3375, spec #3367 AC-004). The
 * chain is append-only: unchanged events keep their exact digests because each digest covers only
 * its own payload, sequence, and predecessor, so re-chaining the prefix reproduces it byte for
 * byte. The result is re-validated end to end, so an appended event that contradicts the
 * dispositions — an unknown or repeated finding, a second review, a mismatched review id — fails
 * here rather than persisting.
 */
export function appendReviewDossierEvents(
    dossier: ReviewDossier,
    appended: readonly ReviewDossierEvent[]
): ReviewDossier {
    const appendedEvents = appended.map(
        (event, index) => readEventRecord(event, `appended event ${index}`, false).event
    );
    const payload = dossierPayload(dossier, [...dossier.events, ...appendedEvents]);
    assertTotalMaps(payload);
    assertEvidenceSafe(payload.evidence, payload.limitations);
    const result = buildDossier(payload);
    assertDossierSize(result);
    return result;
}
