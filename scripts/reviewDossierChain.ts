/**
 * The review dossier's canonical byte form and hash chain (#2999, spec #2995 AC-009/AC-010; #3375,
 * spec #3367 AC-004): per-event field ordering, the sequence/predecessor digest chain, `headDigest`
 * and `dossierDigest`, assembly of a chained record from a validated payload, the coarse size
 * ceiling, and serialization. `reviewDossier.ts` owns the record's types, readers and validation;
 * this module owns turning a validated payload into canonical bytes and back-stop digests. It also
 * owns the `assessmentImpact` field's four-token vocabulary and reader, the one definition the
 * record reader and the caller-input parser share. Every import from the record module is type-only,
 * so the dependency runs one way.
 */

import { createHash } from 'node:crypto';

import { canonicalJson, type JsonValue } from './canonicalRecord.ts';
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
 * union does not carry.
 */
const ASSESSMENT_IMPACT_MEMBERSHIP: Record<AssessmentImpact, true> = {
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
 * What the record's own contents say about the impact it claims. A fresh record — one carrying no
 * recorded reviewer publication — must declare an impact on every shape, canonical record included;
 * only a genuine replay of an already-published head may lack the field, which is what lets a record
 * persisted before it existed replay unchanged. Two tokens are decided by the record: `limitation-only`
 * claims a disclosed limitation and `finding-led` an accepted finding. `none` and `stance-changed`
 * are not decidable from the record and stay the orchestrator's attestation.
 */
export function assertAssessmentImpactConsistent(payload: DossierPayload, publicationRecorded: boolean): void {
    const impact = payload.assessmentImpact;
    if (impact === undefined) {
        if (!publicationRecorded) {
            fail(`review dossier assessmentImpact must be ${ASSESSMENT_IMPACT_TOKENS}, found missing`);
        }
        return;
    }
    if (impact === 'limitation-only' && payload.limitations.length === 0) {
        fail('review dossier assessmentImpact limitation-only contradicts limitations: the round discloses none');
    }
    if (impact === 'finding-led' && !payload.events.some((event) => event.kind === 'finding-accepted')) {
        fail('review dossier assessmentImpact finding-led contradicts accepted findings: the round carries none');
    }
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
    record.headDigest = dossier.headDigest;
    record.dossierDigest = dossier.dossierDigest;
    return `${JSON.stringify(record, null, 4)}\n`;
}
