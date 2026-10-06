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

/**
 * The scope's ledger partition, stated once over every list a scan publishes.
 *
 * A path is planned once, excluded once, and omitted once, and the ledgers say which of those happened:
 *
 * - `excluded` and `unassessed` each hold one record per path, and no path is in both. A repeat inside a
 *   list is malformed on its own and hides a contradiction from a reader that takes one record per path;
 *   a path in both lists says nothing was owed and that an assessment was owed and missed.
 * - `signals` is the ledger of a unit that produced answers. A path with signals is therefore neither
 *   excluded — no unit was planned for it — nor an omission, with exactly one exception: the unit no pass
 *   could ask makes zero provider calls and is still reported as `missing-required-evidence` *and* carries
 *   every rule of its set as signals, which is the coverage ledger. That reason is the one omission
 *   signals are legitimate for, and it is required there: an omission claiming a unit reported its rules
 *   without any signal is a coverage record that is not there.
 * - `assessed` counts the units the mode's own assessment ledger holds, so a scan's is the number of
 *   distinct signalled paths that are not recorded unassessed, and a verify report's is the number of
 *   distinct finding ids its assessments name. A scan's assessed unit carries one signal per rule, and
 *   the one signalled omission — the zero-call unit — is not an assessment; a verify report's assessed
 *   finding is never one it also records as omitted. These are the rows that keep a report from claiming
 *   an assessed unit with nothing behind it: a clean bill with no ledger at all, in either mode.
 * - Every other omission reason — a dry run, a spent budget or elapsed deadline, a provider or request
 *   failure — means no request was made for that unit, so a signal for the same path contradicts it.
 * - `excluded` is a scan's list: a verify report publishes none, because a verifier walks findings and
 *   records a finding it could not assess as an omission. An excluded path is checked against the scan's
 *   signals and omissions; a verify report's list must be empty, which closes every pairing between it
 *   and that mode's assessments and omissions at once.
 * - `truncated` records regions rather than units and is deliberately outside the partition: a path
 *   repeats there once per withheld region, and it may name a path no other list holds (a withheld
 *   context document), or a path that is excluded, omitted, or signalled.
 *
 * None of this is visible to the scope arithmetic: an omitted duplicate moves `assessed` and `eligible`
 * together, an excluded one is balanced by raising `discovered`, a cross-list entry by raising `eligible`,
 * and a stray signal by raising `assessed` with it. The partition is refused before the totals are
 * compared and without reading the planned order, because the order checks return when a stored report
 * carries no order — the shape written before that field existed — and the ledgers have to partition paths
 * for that report too. An order that is present adds only the ties it can hold, checked where it is read:
 * every signalled unit and every omission must be listed, and no entry may name an excluded path. Paths
 * are compared as exact strings: the collector publishes git-canonical paths, so two spellings of one path
 * are not a shape a report can produce, and canonicalisation is out of scope.
 */
export function assertLedgersPartition(
    scope: {
        readonly assessed: number;
        readonly excluded: readonly SemanticScopeExclusion[];
        readonly unassessed: readonly SemanticScopeExclusion[];
    },
    ledger: {
        /** A scan's answered-question ledger: one entry per signal, each naming the unit it answered. */
        readonly signals?: readonly { readonly path: string }[];
        /** A verify report's assessment ledger: the finding id each assessment names. */
        readonly findingIds?: readonly string[];
    },
    label: string
): void {
    assertDistinctPaths(scope.excluded, 'excluded', label);
    assertDistinctPaths(scope.unassessed, 'unassessed', label);
    const excludedPaths = new Set(scope.excluded.map((entry) => entry.path));
    const omissionPaths = new Set(scope.unassessed.map((entry) => entry.path));
    for (const entry of scope.unassessed) {
        if (excludedPaths.has(entry.path)) {
            refuse(
                'invalid_response',
                `${label} records ${entry.path} as excluded and as unassessed; a path is either owed nothing or planned and omitted, never both`
            );
        }
    }
    if (ledger.signals !== undefined) {
        assertScanLedger(scope, ledger.signals, excludedPaths, omissionPaths, label);
    }
    if (ledger.findingIds !== undefined) {
        assertVerifyLedger(scope, ledger.findingIds, omissionPaths, label);
    }
}

/** The scan's rows: signals are the ledger of an asked unit, and `assessed` counts those units. */
function assertScanLedger(
    scope: { readonly assessed: number; readonly unassessed: readonly SemanticScopeExclusion[] },
    signals: readonly { readonly path: string }[],
    excludedPaths: ReadonlySet<string>,
    omissionPaths: ReadonlySet<string>,
    label: string
): void {
    const signalledPaths = new Set(signals.map((signal) => signal.path));
    for (const entry of scope.unassessed) {
        const carriesLedger = entry.reason === MISSING_REQUIRED_EVIDENCE_REASON;
        if (signalledPaths.has(entry.path) && !carriesLedger) {
            refuse(
                'invalid_response',
                `${label} records ${entry.path} as unassessed (${entry.reason}) while its signals report the unit; that reason means no request was made`
            );
        }
        if (carriesLedger && !signalledPaths.has(entry.path)) {
            refuse(
                'invalid_response',
                `${label} records ${entry.path} as missing required evidence without a signal for it; the unit that made no request still reports its rules`
            );
        }
    }
    for (const path of signalledPaths) {
        if (excludedPaths.has(path)) {
            refuse(
                'invalid_response',
                `${label} carries a signal for ${path}, which it records as excluded; no unit was planned for it`
            );
        }
    }
    const assessedFromLedger = new Set(
        signals.filter((signal) => !omissionPaths.has(signal.path)).map((signal) => signal.path)
    ).size;
    if (assessedFromLedger !== scope.assessed) {
        refuse(
            'invalid_response',
            `${label} reports ${String(scope.assessed)} assessed unit(s) but its ledger holds ${String(assessedFromLedger)}: a signalled unit that is not recorded unassessed is one assessed unit`
        );
    }
}

/**
 * The verify report's rows: a verifier publishes no exclusions at all, its assessments name finding ids,
 * and `assessed` counts those findings.
 *
 * The exclusion row is the whole list rather than an overlap: `runVerify` builds its scope with no
 * exclusions — a finding whose evidence is withheld or unusable is recorded as an omission, with the
 * withheld region in `truncated` — and the scope arithmetic already forces that for any report that ever
 * validated (`eligible + excluded.length === discovered` with `eligible === discovered`), so no stored
 * verify report is refused by it. Refusing the list once closes every excluded-against-ledger pairing
 * instead of one overlap at a time.
 *
 * What stays unrefutable here is the finding list itself. A verify report publishes no list of the
 * candidates it was handed, so an assessment or an omission naming a finding id that never existed
 * cannot be refuted from the record: the ids are the whole ledger, and nothing beside them says which
 * findings the change carried. These rows hold the ledger to itself — distinct ids, no id both assessed
 * and omitted, and `assessed` equal to the ids the assessments name — and a doctored report that invents
 * a finding id consistently across the assessments, the omissions, and the totals is beyond them.
 */
function assertVerifyLedger(
    scope: { readonly assessed: number; readonly excluded: readonly SemanticScopeExclusion[] },
    findingIds: readonly string[],
    omissionPaths: ReadonlySet<string>,
    label: string
): void {
    if (scope.excluded.length > 0) {
        refuse(
            'invalid_response',
            `${label} publishes ${String(scope.excluded.length)} excluded path(s), which no verify report produces; a verifier records what it could not assess as an omission`
        );
    }
    const assessedIds = new Set(findingIds);
    if (assessedIds.size !== findingIds.length) {
        refuse('invalid_response', `${label} records an assessed finding id more than once`);
    }
    for (const findingId of assessedIds) {
        if (omissionPaths.has(findingId)) {
            refuse(
                'invalid_response',
                `${label} records ${findingId} as assessed and as unassessed; a finding is one or the other, never both`
            );
        }
    }
    if (assessedIds.size !== scope.assessed) {
        refuse(
            'invalid_response',
            `${label} reports ${String(scope.assessed)} assessed finding(s) but its assessments name ${String(assessedIds.size)}: every assessed finding is one assessment`
        );
    }
}

function assertDistinctPaths(entries: readonly SemanticScopeExclusion[], list: string, label: string): void {
    const seen = new Set<string>();
    for (const entry of entries) {
        if (seen.has(entry.path)) {
            refuse('invalid_response', `${label} records ${entry.path} as ${list} more than once`);
        }
        seen.add(entry.path);
    }
}

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
