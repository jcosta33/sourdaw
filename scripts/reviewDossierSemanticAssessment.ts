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
 * "Citing" the assessment is mechanical and specific: the round's own text — one of its
 * `limitations` — names the assessment's artifact identity or one of the paths the assessment
 * withheld. A non-`none` impact alone does not cite it, because the token claims influence the text
 * never proves. "Declaring it ignored" is `assessmentImpact: none` with an `assessmentIgnoredReason`.
 * Anything else, on a delivered assessment with anything withheld or unresolved, is the silent
 * ignore this module makes impossible.
 *
 * A record whose `state` is `no-assessment` means CI ran and delivered nothing for the head — a red
 * or skipped check, not an absent bundle file. That gap cannot be "ignored" the way a delivered
 * assessment's withheld scope can: there is nothing to cite, so `assessmentImpact: none` (with or
 * without a reason) would record the round as if nothing were missing. The gate instead refuses
 * `none` outright and requires at least one limitation disclosing the gap, whatever the impact. A
 * bundle carrying no `semantic-ci.json` file at all is unaffected and keeps no requirement.
 */

import { fail } from './prContract.ts';

import type { ReviewDossier } from './reviewDossier.ts';

/**
 * The `semantic-ci.json` format string, inlined rather than imported from `semanticReviewContext.ts`
 * so the resolver — which transitively pulls in the `fflate` and GitHub-identity modules — stays out
 * of the trusted GitHub-write closure this gate runs inside. It must stay equal to
 * `SEMANTIC_CI_FORMAT` there; a mismatch fails closed here, refusing a record the writer produced.
 */
const SEMANTIC_CI_FORMAT = 'semantic-ci-v1';

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

/** The scope's withheld paths (excluded, unassessed, truncated) and their count. */
function readScopeWithheld(value: unknown): { withheld: number; paths: string[] } {
    if (!isRecord(value)) {
        fail(`semantic-ci record scope must be an object, found ${describeValue(value)}`);
    }
    const paths: string[] = [];
    const count = (field: string): number => {
        const entries = readArray(`semantic-ci record scope.${field}`, value[field]);
        for (const [index, entry] of entries.entries()) {
            if (!isRecord(entry)) {
                fail(`semantic-ci record scope.${field}[${index}] must be an object, found ${describeValue(entry)}`);
            }
            paths.push(readNonBlankString(`semantic-ci record scope.${field}[${index}].path`, entry.path));
            readNonBlankString(`semantic-ci record scope.${field}[${index}].reason`, entry.reason);
        }
        return entries.length;
    };
    return { withheld: count('excluded') + count('unassessed') + count('truncated'), paths };
}

/** The artifact identity a citation may name: the archive's own name, e.g. `semantic-review-42-1`. */
function readArtifactName(value: unknown): string {
    if (!isRecord(value)) {
        fail(`semantic-ci record artifact must be an object, found ${describeValue(value)}`);
    }
    return readNonBlankString('semantic-ci record artifact.name', value.name);
}

/** The projection the acknowledgement gate consumes: delivered and how much it withheld, or not delivered. */
export type SemanticAssessmentCoverage =
    | {
          readonly state: 'assessed';
          readonly pr: number;
          readonly headSha: string;
          readonly withheld: number;
          readonly unresolved: number;
          readonly artifactName: string;
          readonly withheldPaths: readonly string[];
      }
    | { readonly state: 'no-assessment'; readonly pr: number; readonly headSha: string };

/**
 * Reads the `semantic-ci.json` record `review:prepare` wrote, failing closed on any malformed shape.
 * The gate consumes only `state`, the withheld/unresolved counts, the artifact identity, the
 * withheld paths and the binding identity, but the scope entries are validated so a partial or
 * tampered file is refused here rather than being misread as an assessment that withheld nothing.
 */
export function parseSemanticAssessmentCoverage(value: unknown): SemanticAssessmentCoverage {
    if (!isRecord(value)) {
        fail(`semantic-ci record must be an object, found ${describeValue(value)}`);
    }
    if (value.format !== SEMANTIC_CI_FORMAT) {
        fail(`semantic-ci record format must be ${SEMANTIC_CI_FORMAT}, found ${describeValue(value.format)}`);
    }
    const pr = readPositiveInteger('semantic-ci record pr', value.pr);
    const headSha = readNonBlankString('semantic-ci record headSha', value.headSha);
    if (value.state === 'no-assessment') {
        readNonBlankString('semantic-ci record reason', value.reason);
        return { state: 'no-assessment', pr, headSha };
    }
    if (value.state !== 'assessed') {
        fail(`semantic-ci record state must be assessed or no-assessment, found ${describeValue(value.state)}`);
    }
    const scope = readScopeWithheld(value.scope);
    return {
        state: 'assessed',
        pr,
        headSha,
        withheld: scope.withheld,
        unresolved: readNonNegativeInteger('semantic-ci record unresolvedQuestions', value.unresolvedQuestions),
        artifactName: readArtifactName(value.artifact),
        withheldPaths: scope.paths,
    };
}

/** A limitation names the assessment when it names the artifact identity or one of the withheld paths. */
function citesAssessment(
    dossier: ReviewDossier,
    coverage: Extract<SemanticAssessmentCoverage, { state: 'assessed' }>
): boolean {
    const tokens = [coverage.artifactName, ...coverage.withheldPaths];
    return dossier.limitations.some((limitation) => tokens.some((token) => limitation.includes(token)));
}

/**
 * The publication gate: a delivered assessment with anything withheld or unresolved must be cited
 * (a limitation naming the assessment's artifact identity or a withheld path) or declared ignored
 * (`none` plus `assessmentIgnoredReason`). A `none` with no reason refuses, naming the field and the
 * figure it contradicts; a non-`none` impact that never cites refuses the same way. A `no-assessment`
 * record — CI ran and delivered nothing for the head — refuses `assessmentImpact: none` outright
 * (a reason does not rescue it, since there is no assessment to have had no effect on) and refuses
 * any dossier with no limitations, whatever its impact: the round must disclose the gap. A bundle
 * with no `semantic-ci.json` passes with no requirement; a record naming another publication is
 * refused before either rule runs.
 */
export function assertSemanticAssessmentAcknowledged(
    dossier: ReviewDossier,
    coverage: SemanticAssessmentCoverage | undefined,
    expected: { pr: number; headSha: string }
): void {
    if (coverage === undefined) {
        return;
    }
    if (coverage.pr !== expected.pr || coverage.headSha !== expected.headSha) {
        fail(
            `semantic-ci record pr ${coverage.pr} headSha ${coverage.headSha} does not match the publication pr ${expected.pr} headSha ${expected.headSha}`
        );
    }
    if (coverage.state === 'no-assessment') {
        if (dossier.assessmentImpact === 'none') {
            fail(
                `review dossier assessmentImpact none ignores that no semantic assessment was delivered for this head: disclose the gap in a limitation`
            );
        }
        if (dossier.limitations.length === 0) {
            fail(
                `review dossier records no limitations though no semantic assessment was delivered for this head: disclose the gap in a limitation`
            );
        }
        return;
    }
    if (coverage.withheld === 0 && coverage.unresolved === 0) {
        return;
    }
    if (citesAssessment(dossier, coverage)) {
        return;
    }
    if (dossier.assessmentImpact === 'none' && dossier.assessmentIgnoredReason !== undefined) {
        return;
    }
    if (dossier.assessmentImpact === 'none') {
        fail(
            `review dossier assessmentImpact none with no assessmentIgnoredReason ignores the delivered semantic assessment, which withheld ${coverage.withheld} scope entries and left ${coverage.unresolved} questions unresolved`
        );
    }
    fail(
        `review dossier assessmentImpact ${dossier.assessmentImpact} does not cite the delivered semantic assessment, which withheld ${coverage.withheld} scope entries and left ${coverage.unresolved} questions unresolved: name its artifact or a withheld path in a limitation`
    );
}
