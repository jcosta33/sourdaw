/**
 * Verdict for a Vitest JSON report: a collected spec that passed with zero
 * assertions is the silent-death shape (#1893, #2077, #2352). Vitest 4 already
 * reds an empty file as a failed suite; this still has to catch
 * `passWithNoTests` and any reporter that records `status: "passed"` with an
 * empty `assertionResults` array.
 */

export type VitestJsonTestResult = {
    name: string;
    status: string;
    assertionResults: readonly unknown[];
};

export type VitestJsonReport = {
    success: boolean;
    numTotalTests: number;
    testResults: readonly VitestJsonTestResult[];
};

export function silentZeroCollectedFiles(report: VitestJsonReport): string[] {
    return report.testResults
        .filter((file) => file.status === 'passed' && file.assertionResults.length === 0)
        .map((file) => file.name)
        .sort((left, right) => left.localeCompare(right));
}

export function formatSilentZeroCollectionFailure(paths: readonly string[]): string {
    return `silent zero-test collection: ${paths.join('; ')}`;
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
        return {
            name: file.name,
            status: file.status,
            assertionResults: file.assertionResults,
        };
    });
    return {
        success: record.success,
        numTotalTests: record.numTotalTests,
        testResults,
    };
}
