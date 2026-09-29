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
 * assessment's withheld scope can, so `assessmentImpact: none` (with or without a reason) always
 * refuses. The gate instead requires a limitation citing the record's own reason as the token
 * `semantic-ci <reason>` (for example `semantic-ci red-check`), whatever the impact. A bundle
 * carrying no `semantic-ci.json` file at all is unaffected and keeps no requirement.
 *
 * A delivered record may also carry `firedSignals`: the signals its scan flagged
 * `recommend_investigation`, projected bounded and screened by `semanticReviewContext.ts`. Each
 * carries its own disposal duty, independent of the impact and of the withheld/unresolved citation
 * rule: a fresh publication is refused while any fired signal's citation token
 * `semantic-signal <ruleId> <path>` appears in none of the four caller-authored surfaces — a
 * stances.json stance's `admittedBy`, a discarded.json entry's `finding`, a dossier `limitations`
 * line, or a dossier `signalDispositions` entry naming that signal. The refusal names the undisposed
 * signal's rule and path. Declaring the whole assessment ignored is not a disposal: a fired signal is
 * a specific thing the assessment asked the round to look at, and only naming it disposes of it
 * (ADR 0050). A record written before the field existed parses as zero fired signals and keeps every
 * legacy bundle working.
 *
 * The typed `signalDispositions` list is the round's own record of what became of each fired signal.
 * It is caller-authored and structural — one entry per fired signal, naming its rule and path, with
 * one of the five dispositions — and its disposal power is unconditional: every disposition,
 * including `false-positive`, `insufficient-evidence` and `not-investigated`, disposes of the signal
 * it names, so a round is never pushed to agree with the model or to write prose to dismiss a false
 * alarm. Two checks are coverage-relative, because only the delivered record knows what fired: an
 * entry naming a signal the assessment did not fire is refused, and a record that delivered nothing
 * (`no-assessment`) refuses any entry at all — the round cannot record outcomes for signals that were
 * never delivered.
 */

import { fail } from './prContract.ts';
import { discardedDispositions } from './reviewDossierViews.ts';

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

function readProbability(label: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        fail(`${label} must be a finite probability in [0, 1], found ${describeValue(value)}`);
    }
    return value;
}

/**
 * The record's fired signals, failing closed on any malformed entry. A record written before the
 * field was projected carries none, so a missing field parses as zero rather than refusing — the
 * same tolerance the dossier record's own late fields get.
 */
function readFiredSignals(value: unknown): readonly SemanticAssessmentFiredSignal[] {
    if (value === undefined) {
        return [];
    }
    return readArray('semantic-ci record firedSignals', value).map((entry, index) => {
        const label = `semantic-ci record firedSignals[${index}]`;
        if (!isRecord(entry)) {
            fail(`${label} must be an object, found ${describeValue(entry)}`);
        }
        return {
            ruleId: readNonBlankString(`${label}.ruleId`, entry.ruleId),
            path: readNonBlankString(`${label}.path`, entry.path),
            probability: readProbability(`${label}.probability`, entry.probability),
        };
    });
}

/** One fired signal the delivered scan flagged for investigation, as the record projects it. */
export type SemanticAssessmentFiredSignal = {
    readonly ruleId: string;
    readonly path: string;
    readonly probability: number;
};

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
          readonly firedSignals: readonly SemanticAssessmentFiredSignal[];
      }
    | { readonly state: 'no-assessment'; readonly pr: number; readonly headSha: string; readonly reason: string };

/**
 * Reads the `semantic-ci.json` record `review:prepare` wrote, failing closed on any malformed shape.
 * The gate consumes only `state`, the withheld/unresolved counts, the artifact identity, the
 * withheld paths, the fired signals and the binding identity, but the scope entries are validated
 * so a partial or tampered file is refused here rather than being misread as an assessment that
 * withheld nothing.
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
        const reason = readNonBlankString('semantic-ci record reason', value.reason);
        return { state: 'no-assessment', pr, headSha, reason };
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
        firedSignals: readFiredSignals(value.firedSignals),
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

/** The citation token a no-assessment round must name: `semantic-ci <reason>`. */
function noAssessmentCitationToken(coverage: Extract<SemanticAssessmentCoverage, { state: 'no-assessment' }>): string {
    return `semantic-ci ${coverage.reason}`;
}

/** A limitation cites a no-assessment record when it contains the token `semantic-ci <reason>`. */
function citesNoAssessment(
    dossier: ReviewDossier,
    coverage: Extract<SemanticAssessmentCoverage, { state: 'no-assessment' }>
): boolean {
    const token = noAssessmentCitationToken(coverage);
    return dossier.limitations.some((limitation) => limitation.includes(token));
}

/** The citation token a fired signal carries wherever one of the documents disposes of it. */
export function firedSignalCitationToken(signal: { readonly ruleId: string; readonly path: string }): string {
    return `semantic-signal ${signal.ruleId} ${signal.path}`;
}

/**
 * Every caller-authored text a fired signal's disposal token may appear in: the dispatched stances'
 * `admittedBy` lines (travelled in from the bundle's stances.json), the discarded findings' text,
 * the dossier's limitations, and the typed outcome entries — each entry names its signal exactly, so
 * its own token disposes of it whatever disposition it records.
 */
function firedSignalDisposals(dossier: ReviewDossier, stanceAdmissions: readonly string[]): readonly string[] {
    return [
        ...stanceAdmissions,
        ...discardedDispositions(dossier).map((entry) => entry.findingId),
        ...dossier.limitations,
        ...(dossier.signalDispositions ?? []).map((entry) => firedSignalCitationToken(entry)),
    ];
}

/**
 * An entry names a signal the delivered assessment actually fired: the pair is the signal's identity
 * in the record, so the comparison is exact and never fuzzy. A round cannot record an outcome for
 * something the assessment never asked it to look at, and the refusal lists every such entry by its
 * token so the repair is writable from the message alone.
 */
function assertSignalDispositionsFired(
    dossier: ReviewDossier,
    coverage: Extract<SemanticAssessmentCoverage, { state: 'assessed' }>
): void {
    const entries = dossier.signalDispositions ?? [];
    if (entries.length === 0) {
        return;
    }
    const fired = new Set(coverage.firedSignals.map((signal) => firedSignalCitationToken(signal)));
    const unfired = entries.filter((entry) => !fired.has(firedSignalCitationToken(entry)));
    if (unfired.length === 0) {
        return;
    }
    const listed = unfired.map((entry) => firedSignalCitationToken(entry)).join('; ');
    fail(
        `review dossier signalDispositions names ${String(unfired.length)} signal(s) the delivered assessment did not fire (${listed}): record an outcome only for a signal the delivered record carries`
    );
}

/**
 * A record that delivered nothing cannot have fired anything, so it refuses any typed outcome: the
 * list must be empty or absent. The refusal names the field, the entry count, and the record's own
 * reason, so the repair is to remove the entries rather than to invent a signal to attach them to.
 */
function assertNoSignalDispositions(
    dossier: ReviewDossier,
    coverage: Extract<SemanticAssessmentCoverage, { state: 'no-assessment' }>
): void {
    const entries = dossier.signalDispositions ?? [];
    if (entries.length === 0) {
        return;
    }
    fail(
        `review dossier signalDispositions records ${String(entries.length)} outcome(s) but no semantic assessment was delivered for this head (semantic-ci ${coverage.reason}): the field must be empty or absent`
    );
}

/**
 * A fired signal is disposed of only when its token appears in one of the caller-authored surfaces,
 * or when a typed outcome entry names it. The duty is independent of the impact and of the
 * withheld/unresolved citation rule: `none` plus an `assessmentIgnoredReason` acknowledges the
 * assessment as a whole, and never names the specific thing it fired at. The refusal names every
 * undisposed signal's rule and path so the repair is writable from the message alone.
 */
function assertFiredSignalsDisposed(
    dossier: ReviewDossier,
    coverage: Extract<SemanticAssessmentCoverage, { state: 'assessed' }>,
    stanceAdmissions: readonly string[]
): void {
    if (coverage.firedSignals.length === 0) {
        return;
    }
    const disposals = firedSignalDisposals(dossier, stanceAdmissions);
    const undisposed = coverage.firedSignals.filter(
        (signal) => !disposals.some((text) => text.includes(firedSignalCitationToken(signal)))
    );
    if (undisposed.length === 0) {
        return;
    }
    const listed = undisposed.map((signal) => `${signal.ruleId} at ${signal.path}`).join('; ');
    fail(
        `review dossier does not dispose of ${String(undisposed.length)} of the delivered assessment's ${String(coverage.firedSignals.length)} fired signal(s) (${listed}): name each as semantic-signal <ruleId> <path> in a stance admittedBy, a discarded finding, or a limitation, or record a signalDispositions entry for it`
    );
}

/**
 * The publication gate: a delivered assessment with anything withheld or unresolved must be cited
 * (a limitation naming the assessment's artifact identity or a withheld path) or declared ignored
 * (`none` plus `assessmentIgnoredReason`). Independently of that rule, every fired signal the
 * record carries must be disposed of by name in a stance admission, a discarded finding, a
 * limitation, or a typed `signalDispositions` entry — see `assertFiredSignalsDisposed` — and every
 * typed entry must name a signal the record actually fired. A `none` with no reason refuses, naming
 * the field and the figure it contradicts; a non-`none` impact that never cites refuses the same
 * way. A `no-assessment` record — CI ran and delivered nothing for the head — refuses
 * `assessmentImpact: none` outright (a reason does not rescue it, since there is no assessment to
 * have had no effect on), refuses any typed outcome entry (nothing fired, so nothing can have an
 * outcome), and refuses any dossier whose limitations never cite the record's reason as the token
 * `semantic-ci <reason>`, whatever its impact. A bundle with no `semantic-ci.json` passes with no
 * requirement; a record naming another publication is refused before either rule runs.
 *
 * The stance admissions are the bundle's stances.json `admittedBy` lines; callers whose bundle
 * carries no stances.json pass nothing, and the discarded findings and limitations remain
 * available as disposal surfaces.
 */
export function assertSemanticAssessmentAcknowledged(
    dossier: ReviewDossier,
    coverage: SemanticAssessmentCoverage | undefined,
    expected: { pr: number; headSha: string },
    stanceAdmissions: readonly string[] = []
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
        assertNoSignalDispositions(dossier, coverage);
        const token = noAssessmentCitationToken(coverage);
        if (dossier.assessmentImpact === 'none') {
            fail(
                `review dossier assessmentImpact none ignores that no semantic assessment was delivered for this head: disclose it in a limitation naming ${token}`
            );
        }
        if (!citesNoAssessment(dossier, coverage)) {
            fail(
                `review dossier does not cite that no semantic assessment was delivered for this head: name ${token} in a limitation`
            );
        }
        return;
    }
    assertSignalDispositionsFired(dossier, coverage);
    assertFiredSignalsDisposed(dossier, coverage, stanceAdmissions);
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
