/**
 * The review dossier's canonical byte form and hash chain (#2999, spec #2995 AC-009/AC-010; #3375,
 * spec #3367 AC-004): per-event field ordering, the sequence/predecessor digest chain, `headDigest`
 * and `dossierDigest`, assembly of a chained record from a validated payload, the coarse size
 * ceiling, and serialization. `reviewDossier.ts` owns the record's types, readers and validation;
 * this module owns turning a validated payload into canonical bytes and back-stop digests. It also
 * owns the `assessmentImpact` field's four-token vocabulary and reader, the one definition the
 * record reader and the caller-input parser share, the `assessmentIgnoredReason` acknowledgement's
 * reader and `none`-only consistency rule, and the caller-authored `signalDispositions` list's
 * five-token vocabulary and structural reader. Every import from the record module is type-only,
 * so the dependency runs one way.
 */

import { createHash } from 'node:crypto';

import { canonicalJson, type JsonValue } from './canonicalRecord.ts';
import { assertPublicationSafeEvidence } from './evidenceSafety.ts';
import { fail } from './prContract.ts';

import type { DossierPayload, ReviewDossier, ReviewDossierEvent, ReviewDossierEventRecord } from './reviewDossier.ts';

export const REVIEW_DOSSIER_FORMAT = 'dossier-v1';
export const REVIEW_DOSSIER_MAX_BYTES = 32_768;

export const GENESIS_DIGEST: string = '0'.repeat(64);

/**
 * The four outcomes, in their canonical order. This array is the vocabulary's definition: the type
 * is derived from it and a spec pins its exact contents, so widening it reddens a test rather than
 * passing silently.
 */
export const ASSESSMENT_IMPACTS = ['none', 'limitation-only', 'stance-changed', 'finding-led'] as const;
export type AssessmentImpact = (typeof ASSESSMENT_IMPACTS)[number];

/**
 * The admission gate, as a total map keyed by the union rather than a set built from the array: a
 * token added to either the array (widening the union) or this map (an excess key) fails to compile,
 * so a widened token cannot reach `readAssessmentImpact` with the guard still returning a value its
 * union does not carry. Exported so the pin spec asserts its live key set, which catches a run-time
 * widening the type cannot see (an `Object.assign` onto the map).
 */
export const ASSESSMENT_IMPACT_MEMBERSHIP: Record<AssessmentImpact, true> = {
    none: true,
    'limitation-only': true,
    'stance-changed': true,
    'finding-led': true,
};
const ASSESSMENT_IMPACT_TOKENS = 'none, limitation-only, stance-changed or finding-led';

function isAssessmentImpact(value: string): value is AssessmentImpact {
    return Object.hasOwn(ASSESSMENT_IMPACT_MEMBERSHIP, value);
}

/**
 * Reads the impact token a record or a caller input carries, refusing any other value, a missing
 * value, or a non-string with a message naming the field and the four admissible tokens. The label
 * defaults to the record's own field name; the caller-input parser passes its qualified label.
 */
export function readAssessmentImpact(value: unknown, label = 'assessmentImpact'): AssessmentImpact {
    if (typeof value !== 'string' || !isAssessmentImpact(value)) {
        fail(`${label} must be ${ASSESSMENT_IMPACT_TOKENS}, found ${JSON.stringify(value) ?? typeof value}`);
    }
    return value;
}

/**
 * What the record's own contents say about the impact it claims, wherever the field is present: two
 * tokens are decided by the record — `limitation-only` claims a disclosed limitation and
 * `finding-led` an accepted finding — while `none` and `stance-changed` are not decidable from the
 * record and stay the orchestrator's attestation. An absent field is tolerated here unconditionally,
 * because this runs on the read path too and a record persisted before the field existed must keep
 * verifying rather than be refused for a field it never carried; requiring it is the publication
 * boundary's job, not this shared payload assertion's.
 */
export function assertAssessmentImpactConsistent(payload: DossierPayload): void {
    const impact = payload.assessmentImpact;
    if (impact === undefined) {
        return;
    }
    if (impact === 'limitation-only' && payload.limitations.length === 0) {
        fail('review dossier assessmentImpact limitation-only contradicts limitations: the round discloses none');
    }
    if (impact === 'finding-led' && !payload.events.some((event) => event.kind === 'finding-accepted')) {
        fail('review dossier assessmentImpact finding-led contradicts accepted findings: the round carries none');
    }
}

/**
 * Reads the acknowledgement string a dossier or caller input carries, refusing any other shape. The
 * value is a single trimmed, bounded, evidence-safe line: it is persisted into the record, so it
 * carries the same publication-safety rules as every other recorded literal. The label defaults to
 * the record's own field name; the caller-input parser passes its qualified label.
 */
export function readAssessmentIgnoredReason(value: unknown, label = 'assessmentIgnoredReason'): string {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`${label} must be a non-blank string, found ${JSON.stringify(value) ?? typeof value}`);
    }
    assertPublicationSafeEvidence(label, [value]);
    return value;
}

/**
 * What the record's own fields say about an acknowledgement it claims: a reason declares the
 * assessment ignored, which only `none` can stand beside. A non-`none` impact already names the
 * assessment's influence on the round, so a reason beside it contradicts the record; an absent
 * impact is the historical shape, and a reason beside it is refused the same way. Runs on the read
 * path too, so a persisted record cannot carry the contradiction; historical records predate the
 * field and are untouched.
 */
export function assertAssessmentIgnoredReasonConsistent(payload: DossierPayload): void {
    if (payload.assessmentIgnoredReason !== undefined && payload.assessmentImpact !== 'none') {
        fail(
            `review dossier assessmentIgnoredReason requires assessmentImpact none, found ${
                payload.assessmentImpact ?? 'absent'
            }`
        );
    }
}

/**
 * The five outcomes a round may record for a fired semantic signal, in their canonical order. This
 * array is the vocabulary's definition: the type is derived from it and a spec pins its exact
 * contents, so widening it reddens a test rather than passing silently. Three of the five record a
 * dismissal as readily as a confirmation, and none is a verdict: the token records what the round
 * found, never that it agrees with the assessment, and confers no approval or merge authority.
 */
export const SIGNAL_DISPOSITIONS = [
    'confirmed-and-fixed',
    'confirmed-existing',
    'false-positive',
    'insufficient-evidence',
    'not-investigated',
] as const;
export type SignalDisposition = (typeof SIGNAL_DISPOSITIONS)[number];

/**
 * The admission gate, as a total map keyed by the union rather than a set built from the array, for
 * the same reason `ASSESSMENT_IMPACT_MEMBERSHIP` is one: a token added to either the array
 * (widening the union) or this map (an excess key) fails to compile, and the exported key set lets a
 * spec catch a run-time widening the type cannot see.
 */
export const SIGNAL_DISPOSITION_MEMBERSHIP: Record<SignalDisposition, true> = {
    'confirmed-and-fixed': true,
    'confirmed-existing': true,
    'false-positive': true,
    'insufficient-evidence': true,
    'not-investigated': true,
};
const SIGNAL_DISPOSITION_TOKENS =
    'confirmed-and-fixed, confirmed-existing, false-positive, insufficient-evidence or not-investigated';

function isSignalDisposition(value: string): value is SignalDisposition {
    return Object.hasOwn(SIGNAL_DISPOSITION_MEMBERSHIP, value);
}

/** Reads one disposition token, refusing any other value, a missing value, or a non-string. */
export function readSignalDisposition(value: unknown, label: string): SignalDisposition {
    if (typeof value !== 'string' || !isSignalDisposition(value)) {
        fail(`${label} must be ${SIGNAL_DISPOSITION_TOKENS}, found ${describeValue(value)}`);
    }
    return value;
}

/**
 * One caller-authored outcome for one fired signal. `ruleId` and `path` name the signal exactly as
 * the assessment record's `firedSignals` projects it, so an entry matches a fired signal by that
 * pair and nothing else. `artifact` is the optional bounded single-line reference supporting the
 * outcome — an issue number or URL, a reviewer finding, a repair commit, or a regression test path.
 */
export type ReviewDossierSignalDisposition = {
    ruleId: string;
    path: string;
    disposition: SignalDisposition;
    artifact?: string;
};

const SIGNAL_DISPOSITION_KEYS = ['ruleId', 'path', 'disposition'] as const;
const SIGNAL_DISPOSITION_ARTIFACT_KEYS = [...SIGNAL_DISPOSITION_KEYS, 'artifact'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function assertEntryKeys(entry: Record<string, unknown>, allowed: readonly string[], label: string): void {
    const actual = Object.keys(entry).sort().join(',');
    const expected = [...allowed].sort().join(',');
    if (actual !== expected) {
        fail(`${label} fields must be ${expected}, found ${actual}`);
    }
}

/** A persisted caller-authored string: non-blank first, then the shared single-line safety rules. */
function readSafeEntryString(label: string, value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`${label} must be a non-blank string, found ${describeValue(value)}`);
    }
    assertPublicationSafeEvidence(label, [value]);
    return value;
}

/**
 * Reads the caller-authored dispositions, failing closed on any malformed entry: the entry shape is
 * exact, every value is a bounded single-line publication-safe string, the disposition is one of the
 * five tokens, and one signal is disposed of at most once. The read is structural only — whether an
 * entry names a signal the delivered assessment actually fired is the publication gate's check, the
 * one place the delivered record is in hand.
 */
export function readSignalDispositions(value: unknown, label: string): ReviewDossierSignalDisposition[] {
    if (!Array.isArray(value)) {
        fail(`${label} must be an array, found ${describeValue(value)}`);
    }
    const dispositions: ReviewDossierSignalDisposition[] = [];
    const seen = new Map<string, number>();
    for (const [index, entry] of value.entries()) {
        const entryLabel = `${label}[${index}]`;
        if (!isRecord(entry)) {
            fail(`${entryLabel} must be an object, found ${describeValue(entry)}`);
        }
        assertEntryKeys(
            entry,
            'artifact' in entry ? SIGNAL_DISPOSITION_ARTIFACT_KEYS : SIGNAL_DISPOSITION_KEYS,
            entryLabel
        );
        const ruleId = readSafeEntryString(`${entryLabel}.ruleId`, entry.ruleId);
        const path = readSafeEntryString(`${entryLabel}.path`, entry.path);
        // One signal carries one outcome: the pair is the signal's identity, so an exact repeat in
        // either value records the same signal twice. JSON framing cannot collide: the pair
        // separator is structural, never string content.
        const signalKey = JSON.stringify([ruleId, path]);
        const firstIndex = seen.get(signalKey);
        if (firstIndex !== undefined) {
            fail(
                `${entryLabel} repeats the signal already recorded at index ${String(firstIndex)}: ${ruleId} at ${path}`
            );
        }
        seen.set(signalKey, index);
        const disposition: ReviewDossierSignalDisposition = {
            ruleId,
            path,
            disposition: readSignalDisposition(entry.disposition, `${entryLabel}.disposition`),
        };
        if ('artifact' in entry) {
            disposition.artifact = readSafeEntryString(`${entryLabel}.artifact`, entry.artifact);
        }
        dispositions.push(disposition);
    }
    return dispositions;
}

/** The entry's canonical fields: `artifact` rides along only when the caller recorded one. */
function signalDispositionFields(entry: ReviewDossierSignalDisposition): Record<string, JsonValue> {
    const fields: Record<string, JsonValue> = {
        ruleId: entry.ruleId,
        path: entry.path,
        disposition: entry.disposition,
    };
    if (entry.artifact !== undefined) {
        fields.artifact = entry.artifact;
    }
    return fields;
}

type FieldEntry = readonly [string, JsonValue];

function sha256Hex(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
/** The event's own fields, in canonical order. Key order is fixed here, not by object insertion. */
function eventFieldEntries(event: ReviewDossierEvent): FieldEntry[] {
    if (event.kind === 'stance-completed') {
        const entries: FieldEntry[] = [
            ['kind', event.kind],
            ['stance', event.stance],
            ['reviewerModel', event.reviewerModel],
            ['modelTier', event.modelTier],
            ['outcome', event.outcome],
        ];
        // Absent, never null: a record persisted before exhaustion existed keeps its exact digest.
        if (event.exhaustion !== undefined) {
            entries.push(['exhaustion', event.exhaustion]);
        }
        return entries;
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
    if (event.kind === 'review-published') {
        return [
            ['kind', event.kind],
            ['reviewId', event.reviewId],
        ];
    }
    if (event.kind === 'finding-published') {
        return [
            ['kind', event.kind],
            ['findingId', event.findingId],
            ['reviewId', event.reviewId],
            ['commentId', event.commentId],
        ];
    }
    if (event.kind === 'delivery-authorized') {
        return [
            ['kind', event.kind],
            ['reviewId', event.reviewId],
            ['approvalReviewId', event.approvalReviewId],
            ['evidenceManifestDigest', event.evidenceManifestDigest],
            ['unresolvedThreads', event.unresolvedThreads],
            ['intent', event.intent],
        ];
    }
    if (event.kind === 'review-reassessed') {
        return [
            ['kind', event.kind],
            ['roundsObserved', event.roundsObserved],
            ['threshold', event.threshold],
            ['action', event.action],
            ['reason', event.reason],
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

export function headDigestOf(events: readonly ReviewDossierEventRecord[]): string {
    return events.at(-1)?.digest ?? GENESIS_DIGEST;
}

export function computeDossierDigest(payload: DossierPayload, headDigest: string): string {
    const record: Record<string, JsonValue> = {
        format: REVIEW_DOSSIER_FORMAT,
        pr: payload.pr,
        headSha: payload.headSha,
        baseSha: payload.baseSha,
        riskClasses: payload.riskClasses,
        requiredStances: payload.requiredStances,
        evidence: payload.evidence,
        limitations: payload.limitations,
        recommendation: payload.recommendation,
    };
    // Absent, never undefined-valued: a record persisted before the field existed keeps its exact
    // digest, and two records differing only in this field still differ.
    if (payload.assessmentImpact !== undefined) {
        record.assessmentImpact = payload.assessmentImpact;
    }
    // Same historical tolerance as `assessmentImpact`: the acknowledgement rides the digest only
    // when present, so records persisted before it existed keep their exact bytes.
    if (payload.assessmentIgnoredReason !== undefined) {
        record.assessmentIgnoredReason = payload.assessmentIgnoredReason;
    }
    // And the same for the typed signal dispositions: absent on every record persisted before the
    // field existed, present — even as an empty list — on one that carries it, so two records
    // differing only in the list still differ. The mapped fields are the ones serialization writes,
    // so the digest preimage and the persisted bytes cannot disagree.
    if (payload.signalDispositions !== undefined) {
        record.signalDispositions = payload.signalDispositions.map(signalDispositionFields);
    }
    record.headDigest = headDigest;
    return sha256Hex(canonicalJson(record));
}

export function buildDossier(payload: DossierPayload): ReviewDossier {
    const events = chainEvents(payload.events);
    const headDigest = headDigestOf(events);
    const dossier: ReviewDossier = {
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
    if (payload.assessmentImpact !== undefined) {
        dossier.assessmentImpact = payload.assessmentImpact;
    }
    if (payload.assessmentIgnoredReason !== undefined) {
        dossier.assessmentIgnoredReason = payload.assessmentIgnoredReason;
    }
    if (payload.signalDispositions !== undefined) {
        dossier.signalDispositions = payload.signalDispositions;
    }
    return dossier;
}

export function assertDossierSize(dossier: ReviewDossier): void {
    const bytes = Buffer.byteLength(serializeReviewDossier(dossier), 'utf8');
    if (bytes > REVIEW_DOSSIER_MAX_BYTES) {
        fail(`review dossier exceeds ${REVIEW_DOSSIER_MAX_BYTES} bytes: ${bytes}`);
    }
}

function serializeEventRecord(record: ReviewDossierEventRecord): Record<string, unknown> {
    const chain: FieldEntry[] = [...chainEntries(record.sequence, record.previousDigest), ['digest', record.digest]];
    return Object.fromEntries([...chain, ...eventFieldEntries(record)]);
}

export function serializeReviewDossier(dossier: ReviewDossier): string {
    const record: Record<string, unknown> = {
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
    };
    // Absent, never null: a record persisted before the field existed reserializes byte-identically.
    if (dossier.assessmentImpact !== undefined) {
        record.assessmentImpact = dossier.assessmentImpact;
    }
    if (dossier.assessmentIgnoredReason !== undefined) {
        record.assessmentIgnoredReason = dossier.assessmentIgnoredReason;
    }
    if (dossier.signalDispositions !== undefined) {
        record.signalDispositions = dossier.signalDispositions.map(signalDispositionFields);
    }
    record.headDigest = dossier.headDigest;
    record.dossierDigest = dossier.dossierDigest;
    return `${JSON.stringify(record, null, 4)}\n`;
}

/**
 * The payload a persisted dossier's own fields rebuild against a given event list. Both the append
 * path (in the record module) and the authorization digest below project a dossier this way, so the
 * projection lives in one place; `assessmentImpact`, `assessmentIgnoredReason` and the typed signal
 * dispositions ride along so a rebuilt digest still covers them.
 */
export function dossierPayload(dossier: ReviewDossier, events: ReviewDossierEvent[]): DossierPayload {
    return {
        pr: dossier.pr,
        headSha: dossier.headSha,
        baseSha: dossier.baseSha,
        riskClasses: dossier.riskClasses,
        requiredStances: dossier.requiredStances,
        events,
        evidence: dossier.evidence,
        limitations: dossier.limitations,
        recommendation: dossier.recommendation,
        assessmentImpact: dossier.assessmentImpact,
        assessmentIgnoredReason: dossier.assessmentIgnoredReason,
        signalDispositions: dossier.signalDispositions,
    };
}

/**
 * The digest the reviewer publication authorized (#3376, spec #3367 AC-005; #4584): the dossier
 * exactly as it stood when delivery was authorized, before the post-publication
 * `delivery-authorized` and `review-reassessed` events were appended in the same write. Rebuilding
 * without those events reproduces the authorization-time digest byte for byte because the chain is
 * deterministic, which is what lets delivery prove the authorized evidence is the evidence this
 * head still carries.
 */
export function authorizedEvidenceDigest(dossier: ReviewDossier): string {
    const events = dossier.events.filter(
        (event) => event.kind !== 'delivery-authorized' && event.kind !== 'review-reassessed'
    );
    if (events.length === dossier.events.length) {
        return dossier.dossierDigest;
    }
    return buildDossier(dossierPayload(dossier, events)).dossierDigest;
}
