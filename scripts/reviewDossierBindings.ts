/**
 * The review dossier's finding bindings: source draw identity and publication identity. Source
 * bindings validate the completed draws that produced a finding. Publication bindings require at
 * most one recorded publication, any finding bound at most once, and every published finding
 * naming an accepted one and the one recorded publication (#3375, spec #3367 AC-004).
 */

import { fail } from './prContract.ts';

import type { AcceptedReviewFinding, ReviewDossierEvent, ReviewFindingSource } from './reviewDossier.ts';

export type PublicationBindings = {
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
export function collectPublicationBindings(events: readonly ReviewDossierEvent[]): PublicationBindings {
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
export function assertPublicationBindings(bindings: PublicationBindings, accepted: ReadonlySet<string>): void {
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

/** Parse source pairs using the dossier reader's authoritative publication-safe scalar rule. */
export function readFindingSourceBindings(
    value: unknown,
    label: string,
    readSafeString: (label: string, value: unknown) => string
): ReviewFindingSource[] {
    if (!Array.isArray(value) || value.length === 0) {
        fail(`${label} must be a non-empty array of { stance, reviewerModel } source pairs`);
    }
    const seen = new Set<string>();
    return value.map((entry: unknown, index) => {
        const sourceLabel = `${label}[${index}]`;
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            fail(`${sourceLabel} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        const actual = Object.keys(record).sort().join(',');
        if (actual !== 'reviewerModel,stance') {
            fail(`review dossier ${sourceLabel} fields must be reviewerModel,stance, found ${actual}`);
        }
        const source = {
            stance: readSafeString(`${sourceLabel}.stance`, record.stance),
            reviewerModel: readSafeString(`${sourceLabel}.reviewerModel`, record.reviewerModel),
        };
        const key = JSON.stringify([source.stance, source.reviewerModel]);
        if (seen.has(key)) {
            fail(`${sourceLabel} repeats source ${source.stance} on ${source.reviewerModel}`);
        }
        seen.add(key);
        return source;
    });
}

/** Every named source binds one completed findings-producing draw, regardless of event order. */
export function assertFindingSourceBindings(
    finding: AcceptedReviewFinding,
    events: readonly ReviewDossierEvent[]
): void {
    if (finding.sources === undefined) {
        return;
    }
    for (const source of finding.sources) {
        const draw = events.find(
            (candidate) =>
                candidate.kind === 'stance-completed' &&
                candidate.stance === source.stance &&
                candidate.reviewerModel === source.reviewerModel
        );
        if (draw?.kind !== 'stance-completed' || draw.outcome !== 'blocker-found') {
            fail(
                `review dossier finding ${finding.findingId} source ${source.stance} on ${source.reviewerModel} does not name a completed findings draw`
            );
        }
    }
}
