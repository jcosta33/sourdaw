/**
 * One browser test's coverage record and the rule that derives it from
 * Chromium's JS coverage. The app loads nearly every module at boot, so a file
 * counts only when a function other than its top-level module body ran.
 */

export const COVERAGE_DIRECTORY_ENV = 'SOURDAW_E2E_COVERAGE_DIR';

const SOURCE_PREFIX = '/src/';

export type CoverageStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';

export const COVERAGE_STATUSES: readonly CoverageStatus[] = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];

export type CoverageRecord = {
    spec: string;
    testId: string;
    title: string;
    status: CoverageStatus;
    complete: boolean;
    executedFiles: string[];
};

type CoverageRange = { count: number; startOffset: number; endOffset: number };

export type CoverageEntry = {
    url: string;
    source?: string;
    functions: ReadonlyArray<{ ranges: readonly CoverageRange[] }>;
};

/** The repository path of an app source module served by the dev server, or null for anything else. */
function sourcePathOf(url: string, appOrigin: string): string | null {
    const parsed = URL.parse(url);
    if (parsed === null || parsed.origin !== appOrigin || !parsed.pathname.startsWith(SOURCE_PREFIX)) {
        return null;
    }
    return decodeURIComponent(parsed.pathname).slice(1);
}

// V8 reports a script's top-level body as a function whose first range spans
// the whole source.
function isTopLevelBody(ranges: readonly CoverageRange[], sourceLength: number): boolean {
    return ranges[0]?.startOffset === 0 && ranges[0].endOffset === sourceLength;
}

function ranAFunction(entry: CoverageEntry, sourceLength: number): boolean {
    return entry.functions.some(({ ranges }) => (ranges[0]?.count ?? 0) > 0 && !isTopLevelBody(ranges, sourceLength));
}

export type ExecutedSources = {
    /** Distinct app source files the page loaded; none means the app did not run from the dev server's sources. */
    loadedSources: number;
    executedFiles: string[];
    /** App source entries Chromium returned without their source, so the top-level body cannot be told apart. */
    unmeasured: string[];
};

/** The app source files in which a function other than the module's top-level body executed. */
export function executedSourceFiles(entries: readonly CoverageEntry[], appOrigin: string): ExecutedSources {
    const loaded = new Set<string>();
    const executed = new Set<string>();
    const unmeasured = new Set<string>();
    for (const entry of entries) {
        const path = sourcePathOf(entry.url, appOrigin);
        if (path === null) {
            continue;
        }
        loaded.add(path);
        if (entry.source === undefined) {
            unmeasured.add(path);
            continue;
        }
        if (ranAFunction(entry, entry.source.length)) {
            executed.add(path);
        }
    }
    return { loadedSources: loaded.size, executedFiles: [...executed].sort(), unmeasured: [...unmeasured].sort() };
}
