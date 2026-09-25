/**
 * The review dossier's canonical byte form and hash chain (#2999, spec #2995 AC-009/AC-010; #3375,
 * spec #3367 AC-004): per-event field ordering, the sequence/predecessor digest chain, `headDigest`
 * and `dossierDigest`, assembly of a chained record from a validated payload, the coarse size
 * ceiling, and serialization. `reviewDossier.ts` owns the record's types, readers and validation;
 * this module owns turning a validated payload into canonical bytes and back-stop digests. Every
 * import from the record module is type-only, so the dependency runs one way.
 */

import { createHash } from 'node:crypto';

import { canonicalJson, type JsonValue } from './canonicalRecord.ts';
import { fail } from './prContract.ts';

import type { DossierPayload, ReviewDossier, ReviewDossierEvent, ReviewDossierEventRecord } from './reviewDossier.ts';

export const REVIEW_DOSSIER_FORMAT = 'dossier-v1';
export const REVIEW_DOSSIER_MAX_BYTES = 32_768;

export const GENESIS_DIGEST: string = '0'.repeat(64);

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

export function buildDossier(payload: DossierPayload): ReviewDossier {
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
    return buildDossier({
        pr: dossier.pr,
        headSha: dossier.headSha,
        baseSha: dossier.baseSha,
        riskClasses: dossier.riskClasses,
        requiredStances: dossier.requiredStances,
        events,
        evidence: dossier.evidence,
        limitations: dossier.limitations,
        recommendation: dossier.recommendation,
    }).dossierDigest;
}
