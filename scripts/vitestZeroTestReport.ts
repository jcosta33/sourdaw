/**
 * Verdict for a Vitest JSON report. Two distinct silent-death shapes:
 *
 * 1. A collected spec that passed with zero assertions at all (#1893, #2077,
 *    #2352) — Vitest 4 already reds an empty file as a failed suite, but this
 *    still has to catch `passWithNoTests` and any reporter that records
 *    `status: "passed"` with an empty `assertionResults` array.
 * 2. A `-t` name filter that matches nothing (#2435). Vitest still records the
 *    file as `status: "passed"` with a non-empty `assertionResults` array —
 *    every entry is present but `status: "skipped"`. An empty-array check
 *    cannot see this; it has to count assertions whose status is neither
 *    `skipped` nor `todo` and fail when that count is zero across the whole
 *    run. A single deliberately-skipped spec among many passing ones must NOT
 *    fail the run — only a run that executed nothing at all does — so the
 *    count is taken across every collected file, not per file.
 *
 *    That whole-run boundary is a deliberate tradeoff, not an oversight: a
 *    stale or mistyped `-t` filter that zeroes out one target file while
 *    still matching a test in some other file leaves the run green, and the
 *    file that produced no evidence goes unreported. This is not fixable at
 *    file granularity — the JSON report gives no way to distinguish a
 *    deliberate `describe.skip` from a filter that missed an entire file,
 *    since both produce an identical shape — so the boundary stays at the
 *    whole run.
 */

export type VitestJsonAssertionResult = {
    status: string;
};

export type VitestJsonTestResult = {
    name: string;
    status: string;
    assertionResults: readonly VitestJsonAssertionResult[];
};

export type VitestJsonReport = {
    success: boolean;
    numTotalTests: number;
    testResults: readonly VitestJsonTestResult[];
};

const NON_EXECUTED_ASSERTION_STATUSES = new Set(['skipped', 'todo']);

function isExecutedAssertion(assertion: VitestJsonAssertionResult): boolean {
    return !NON_EXECUTED_ASSERTION_STATUSES.has(assertion.status);
}

export function executedAssertionCount(report: VitestJsonReport): number {
    return report.testResults.reduce(
        (total, file) => total + file.assertionResults.filter(isExecutedAssertion).length,
        0
    );
}

export function silentZeroCollectedFiles(report: VitestJsonReport): string[] {
    return report.testResults
        .filter((file) => file.status === 'passed' && file.assertionResults.length === 0)
        .map((file) => file.name)
        .sort((left, right) => left.localeCompare(right));
}

export function formatSilentZeroCollectionFailure(paths: readonly string[]): string {
    return `silent zero-test collection: ${paths.join('; ')}`;
}

/**
 * True when the run collected at least one file but executed zero assertions
 * across all of them — the shape a `-t` filter matching nothing produces.
 * Distinct from `silentZeroCollectedFiles`: that catches a file reported with
 * an empty `assertionResults` array; this catches a run whose assertions are
 * all present but `skipped`/`todo`. The two are different reporter shapes and
 * are kept as separate predicates so the failure message names which one hit.
 */
export function silentZeroExecutedAssertions(report: VitestJsonReport): boolean {
    return report.testResults.length > 0 && executedAssertionCount(report) === 0;
}

export function formatZeroExecutedAssertionsFailure(report: VitestJsonReport): string {
    const fileNames = report.testResults.map((file) => file.name).sort((left, right) => left.localeCompare(right));
    return `zero executed assertions across the run, collected but none ran (every assertion was skipped or todo — check a -t/--testNamePattern filter, or an all-todo file): ${fileNames.join('; ')}`;
}

export function readVitestJsonReport(source: string): VitestJsonReport {
    const parsed: unknown = JSON.parse(source);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new TypeError('vitest JSON report must be an object');
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.success !== 'boolean' || typeof record.numTotalTests !== 'number') {
        throw new TypeError('vitest JSON report is missing success or numTotalTests');
    }
    if (!Array.isArray(record.testResults)) {
        throw new TypeError('vitest JSON report is missing testResults');
    }
    const testResults = record.testResults.map((entry, index) => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new TypeError(`vitest JSON testResults[${index}] must be an object`);
        }
        const file = entry as Record<string, unknown>;
        if (typeof file.name !== 'string' || typeof file.status !== 'string') {
            throw new TypeError(`vitest JSON testResults[${index}] is missing name or status`);
        }
        if (!Array.isArray(file.assertionResults)) {
            throw new TypeError(`vitest JSON testResults[${index}] is missing assertionResults`);
        }
        const assertionResults = file.assertionResults.map((assertion, assertionIndex) => {
            if (assertion === null || typeof assertion !== 'object' || Array.isArray(assertion)) {
                throw new TypeError(
                    `vitest JSON testResults[${index}].assertionResults[${assertionIndex}] must be an object`
                );
            }
            const assertionRecord = assertion as Record<string, unknown>;
            if (typeof assertionRecord.status !== 'string') {
                throw new TypeError(
                    `vitest JSON testResults[${index}].assertionResults[${assertionIndex}] is missing status`
                );
            }
            return { status: assertionRecord.status };
        });
        return {
            name: file.name,
            status: file.status,
            assertionResults,
        };
    });
    return {
        success: record.success,
        numTotalTests: record.numTotalTests,
        testResults,
    };
}
