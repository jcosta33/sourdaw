/**
 * The dossier's acknowledgement of the delivered advisory semantic assessment.
 *
 * `review:prepare` writes the assessment's coverage projection as `semantic-ci.json` beside the
 * bundle's `risk-plan.json`. This module reads that projection back at publication and refuses a
 * fresh reviewer publication whose dossier neither cites the assessment nor declares it ignored when
 * the delivered assessment withheld or left anything unresolved. The gate gives the assessment no
 * merge authority: it can only force the round's record to acknowledge what it delivered, never
 * approve, request changes, resolve a thread, or merge (ADR 0047 still governs).
 *
 * "Citing" the assessment is `assessmentImpact` other than `none` — `finding-led` (an accepted
 * finding the assessment surfaced), `limitation-only` (a disclosed limitation it produced), or
 * `stance-changed` (it changed the dispatched stance enumeration) — each already validated against
 * the record. "Declaring it ignored" is `assessmentImpact: none` with an `assessmentIgnoredReason`.
 * A `none` with no reason, on a delivered assessment with anything withheld or unresolved, is the
 * silent ignore this module makes impossible.
 */

import { fail } from './prContract.ts';
import { SEMANTIC_CI_FORMAT } from './semanticReviewContext.ts';

import type { ReviewDossier } from './reviewDossier.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function readNonBlankString(label: string, value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`${label} must be a non-blank string, found ${describeValue(value)}`);
    }
    return value;
}

function readNonNegativeInteger(label: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        fail(`${label} must be a non-negative safe integer, found ${describeValue(value)}`);
    }
    return value;
}

function readPositiveInteger(label: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        fail(`${label} must be a positive safe integer, found ${describeValue(value)}`);
    }
    return value;
}

function readArray(label: string, value: unknown): readonly unknown[] {
    if (!Array.isArray(value)) {
        fail(`${label} must be an array, found ${describeValue(value)}`);
    }
    return value;
}

/** The count of excluded, unassessed and truncated scope entries — the entries the assessment withheld. */
function readScopeWithheld(value: unknown): number {
    if (!isRecord(value)) {
        fail(`semantic-ci record scope must be an object, found ${describeValue(value)}`);
    }
    const count = (field: string): number => {
        const entries = readArray(`semantic-ci record scope.${field}`, value[field]);
        for (const [index, entry] of entries.entries()) {
            if (!isRecord(entry)) {
                fail(`semantic-ci record scope.${field}[${index}] must be an object, found ${describeValue(entry)}`);
            }
            readNonBlankString(`semantic-ci record scope.${field}[${index}].path`, entry.path);
            readNonBlankString(`semantic-ci record scope.${field}[${index}].reason`, entry.reason);
        }
        return entries.length;
    };
    return count('excluded') + count('unassessed') + count('truncated');
}

/** The projection the acknowledgement gate consumes: delivered and how much it withheld, or not delivered. */
export type SemanticAssessmentCoverage =
    | { readonly state: 'assessed'; readonly withheld: number; readonly unresolved: number }
    | { readonly state: 'no-assessment' };

/**
 * Reads the `semantic-ci.json` record `review:prepare` wrote, failing closed on any malformed shape.
 * The gate consumes only `state` and the withheld/unresolved counts, but the identity and scope
 * fields are validated so a partial or tampered file is refused here rather than being misread as an
 * assessment that withheld nothing.
 */
export function parseSemanticAssessmentCoverage(value: unknown): SemanticAssessmentCoverage {
    if (!isRecord(value)) {
        fail(`semantic-ci record must be an object, found ${describeValue(value)}`);
    }
    if (value.format !== SEMANTIC_CI_FORMAT) {
        fail(`semantic-ci record format must be ${SEMANTIC_CI_FORMAT}, found ${describeValue(value.format)}`);
    }
    readPositiveInteger('semantic-ci record pr', value.pr);
    readNonBlankString('semantic-ci record headSha', value.headSha);
    if (value.state === 'no-assessment') {
        readNonBlankString('semantic-ci record reason', value.reason);
        return { state: 'no-assessment' };
    }
    if (value.state !== 'assessed') {
        fail(`semantic-ci record state must be assessed or no-assessment, found ${describeValue(value.state)}`);
    }
    const withheld = readScopeWithheld(value.scope);
    const unresolved = readNonNegativeInteger('semantic-ci record unresolvedQuestions', value.unresolvedQuestions);
    return { state: 'assessed', withheld, unresolved };
}

/**
 * The publication gate: a delivered assessment with anything withheld or unresolved must be cited
 * (a non-`none` impact) or declared ignored (`none` plus `assessmentIgnoredReason`). A `none` with
 * no reason refuses, naming the field and the figure it contradicts. A bundle with no
 * `semantic-ci.json`, or a record that records no assessment at all, passes with no requirement.
 */
export function assertSemanticAssessmentAcknowledged(
    dossier: ReviewDossier,
    coverage: SemanticAssessmentCoverage | undefined
): void {
    if (coverage === undefined || coverage.state !== 'assessed') {
        return;
    }
    if (coverage.withheld === 0 && coverage.unresolved === 0) {
        return;
    }
    if (dossier.assessmentImpact !== undefined && dossier.assessmentImpact !== 'none') {
        return;
    }
    if (dossier.assessmentImpact === 'none' && dossier.assessmentIgnoredReason !== undefined) {
        return;
    }
    fail(
        `review dossier assessmentImpact none with no assessmentIgnoredReason ignores the delivered semantic assessment, which withheld ${coverage.withheld} scope entries and left ${coverage.unresolved} questions unresolved`
    );
}
