/**
 * How a run accounts for the units it did not assess, and the scope entries that carry that accounting.
 *
 * A single "unassessed" bucket blurred four different things: a path that owed nothing, a unit no
 * request could answer, a unit a spent budget or deadline never reached, and a unit the provider
 * refused. The totals below keep them apart so a reader can tell a coverage gap the plan chose from a
 * provider that failed, and the scope's own arithmetic is checked against them, so no unit can be
 * counted in a state it was not recorded in.
 *
 * The scope reader lives here with them because `report.ts` is at its size ceiling — the same reason
 * `reporting.ts` exists — and because the reason vocabulary and the totals that read it must not drift.
 */

import { assertNonEmptyString, isUnitPriorityClass, refuse, type SemanticScopeExclusion } from './contracts.ts';

/** A unit was planned with evidence, and no pass of it carries the evidence its questions require. */
export const MISSING_REQUIRED_EVIDENCE_REASON = 'missing-required-evidence';
/** A unit the run's submitted-byte or attempt budget stopped before it was attempted. */
export const BUDGET_STOPPED_REASON = 'budget-exhausted-before-admission';
/** A unit the run's overall deadline stopped before it was attempted. */
export const DEADLINE_STOPPED_REASON = 'deadline-elapsed-before-admission';
/** Every eligible unit of a dry run, which makes no request at all. */
export const DRY_RUN_REASON = 'dry-run-made-no-request';

/**
 * The exclusion reasons that mean nothing was owed for this path: no rule applies to it, or the
 * collector decided it needs no reading at all — generated, a lockfile, binary, or unchanged text.
 *
 * The complement is what turns an empty scope into "an assessment was never produced". A lockfile-only
 * change is the same class as a documentation-only one and must stay a skip; reading every
 * non-`no-applicable-rule` reason as a missed assessment turned it into a red check claiming a
 * coverage gap that does not exist.
 */
const NOTHING_OWED_EXCLUSION_REASONS: ReadonlySet<string> = new Set([
    'no-applicable-rule',
    'generated',
    'dependency-lockfile',
    'binary',
    'no-text-change',
]);

/** Whether an exclusion means an assessment was owed for that path and not produced. */
export function isMissedAssessmentExclusion(reason: string): boolean {
    return !NOTHING_OWED_EXCLUSION_REASONS.has(reason);
}

/**
 * The run's unit totals by state. `notApplicable` and `excludedWithAssessmentOwed` partition the
 * excluded entries; the other four partition the unassessed ones, which `assertScopeStatesMatch` holds
 * the report to.
 */
export type SemanticScopeStates = {
    /** Excluded with nothing owed: no rule applies, or the collector read nothing for the path. */
    readonly notApplicable: number;
    /** Excluded for a reason that means an assessment was owed and not produced: withheld or unfit evidence. */
    readonly excludedWithAssessmentOwed: number;
    /** Planned, and skipped because no pass carries the evidence its questions require. */
    readonly missingRequiredEvidence: number;
    /** Planned and admissible, and never attempted because the run's budget or deadline stopped admission. */
    readonly omittedForBudgetOrDeadline: number;
    /** Attempted, and the provider or the request failed, including a cancellation. */
    readonly providerFailure: number;
    /** Planned, and never attempted because the run was a dry run. */
    readonly dryRun: number;
};

/** The state one reason names. A run-level stop is never read as a provider failure, nor the reverse. */
function unassessedState(
    reason: string
): keyof Omit<SemanticScopeStates, 'notApplicable' | 'excludedWithAssessmentOwed'> {
    if (reason === DRY_RUN_REASON || reason === 'dry-run') {
        return 'dryRun';
    }
    if (reason === MISSING_REQUIRED_EVIDENCE_REASON) {
        return 'missingRequiredEvidence';
    }
    if (
        reason === BUDGET_STOPPED_REASON ||
        reason === DEADLINE_STOPPED_REASON ||
        // The unit the run-level stop landed on carries the stop's own code, while the units behind it
        // carry the admission reason, and both are the same omission.
        reason === 'budget_exhausted' ||
        reason === 'deadline_elapsed'
    ) {
        return 'omittedForBudgetOrDeadline';
    }
    return 'providerFailure';
}

/** The totals the run's own scope lists add up to. */
export function buildScopeStates(input: {
    readonly excluded: readonly SemanticScopeExclusion[];
    readonly unassessed: readonly SemanticScopeExclusion[];
}): SemanticScopeStates {
    const states = {
        notApplicable: 0,
        excludedWithAssessmentOwed: 0,
        missingRequiredEvidence: 0,
        omittedForBudgetOrDeadline: 0,
        providerFailure: 0,
        dryRun: 0,
    };
    for (const entry of input.excluded) {
        if (isMissedAssessmentExclusion(entry.reason)) {
            states.excludedWithAssessmentOwed += 1;
        } else {
            states.notApplicable += 1;
        }
    }
    for (const entry of input.unassessed) {
        states[unassessedState(entry.reason)] += 1;
    }
    return states;
}

/**
 * Holds the published totals to the states the run's own lists add up to, field by field. Sums alone
 * were not enough: buckets could be swapped while their total still balanced, so a report could publish
 * a cause no entry recorded — a unit read as a provider failure while the entry behind it named a spent
 * budget — and still validate. Every field is compared, so the published totals name exactly the states
 * `buildScopeStates` derives from the same `excluded` and `unassessed` lists.
 */
export function assertScopeStatesMatch(input: {
    readonly states?: SemanticScopeStates;
    readonly excluded: readonly SemanticScopeExclusion[];
    readonly unassessed: readonly SemanticScopeExclusion[];
    readonly label: string;
}): void {
    const published = input.states;
    if (published === undefined) {
        return;
    }
    const recorded = buildScopeStates({ excluded: input.excluded, unassessed: input.unassessed });
    for (const state of SCOPE_STATE_NAMES) {
        if (published[state] !== recorded[state]) {
            refuse(
                'invalid_response',
                `${input.label} publishes ${String(published[state])} ${state} state(s), but its own entries record ${String(recorded[state])}`
            );
        }
    }
}

/** Every state field, so the comparison above names each one and a new field cannot be left unchecked. */
const SCOPE_STATE_NAMES = [
    'notApplicable',
    'excludedWithAssessmentOwed',
    'missingRequiredEvidence',
    'omittedForBudgetOrDeadline',
    'providerFailure',
    'dryRun',
] as const satisfies readonly (keyof SemanticScopeStates)[];

/** Reads the totals back. Absent is a report written before the field existed, which stays valid. */
export function readScopeStates(value: unknown, label: string): SemanticScopeStates | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    return {
        notApplicable: readCount(record.notApplicable, `${label}.notApplicable`),
        excludedWithAssessmentOwed: readCount(record.excludedWithAssessmentOwed, `${label}.excludedWithAssessmentOwed`),
        missingRequiredEvidence: readCount(record.missingRequiredEvidence, `${label}.missingRequiredEvidence`),
        omittedForBudgetOrDeadline: readCount(record.omittedForBudgetOrDeadline, `${label}.omittedForBudgetOrDeadline`),
        providerFailure: readCount(record.providerFailure, `${label}.providerFailure`),
        dryRun: readCount(record.dryRun, `${label}.dryRun`),
    };
}

function readCount(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        refuse('invalid_response', `${label} must be a non-negative safe integer`);
    }
    return value as number;
}

/**
 * Reads the scope's exclusion lists. An omitted unit's priority class is what explains its omission, so
 * a present one must be a class this application publishes; absent stays valid because the excluded and
 * truncated lists never carry one.
 */
export function readScopeExclusions(value: unknown, label: string): SemanticScopeExclusion[] {
    if (!Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an array`);
    }
    return value.map((entry, index) => {
        const at = `${label}[${String(index)}]`;
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            refuse('invalid_response', `${at} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        const exclusion: SemanticScopeExclusion = {
            path: assertNonEmptyString(record.path, `${at}.path`),
            reason: assertNonEmptyString(record.reason, `${at}.reason`),
        };
        const priorityClass = record.priorityClass;
        if (priorityClass === undefined) {
            return exclusion;
        }
        if (!isUnitPriorityClass(priorityClass)) {
            return refuse('invalid_response', `${at}.priorityClass is not a known priority class`);
        }
        return { ...exclusion, priorityClass };
    });
}
