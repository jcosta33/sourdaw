import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function collectSuite(root: string, rootDir: string, suite: unknown, collected: Set<string>): number {
    let cases = 0;
    const visit = (value: unknown): void => {
        if (!isRecord(value)) {
            throw new Error('Playwright collection returned a malformed suite');
        }
        const row = value;
        if (!Array.isArray(row.specs) || (row.suites !== undefined && !Array.isArray(row.suites))) {
            throw new Error('Playwright collection returned a malformed suite');
        }
        for (const spec of row.specs) {
            if (!isRecord(spec)) {
                throw new Error('Playwright collection returned a malformed case');
            }
            const item = spec;
            if (
                typeof item.file !== 'string' ||
                item.file === '' ||
                !Array.isArray(item.tests) ||
                item.tests.length === 0 ||
                item.tests.some((test) => !isRecord(test))
            ) {
                throw new Error('Playwright collection returned a malformed case');
            }
            const path = relative(root, resolve(rootDir, item.file)).replaceAll('\\', '/');
            if (path === '..' || path.startsWith('../') || isAbsolute(path)) {
                throw new Error(`Playwright collected a file outside the checkout: ${item.file}`);
            }
            collected.add(path);
            cases += item.tests.length;
        }
        for (const child of (row.suites ?? []) as unknown[]) {
            visit(child);
        }
    };
    visit(suite);
    return cases;
}

function collectedFiles(root: string, report: unknown): Set<string> {
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
        throw new Error('Playwright collection returned a malformed report');
    }
    const { config, suites, errors } = report as Record<string, unknown>;
    const rootDir =
        config && typeof config === 'object' && !Array.isArray(config)
            ? (config as Record<string, unknown>).rootDir
            : undefined;
    if (typeof rootDir !== 'string' || !isAbsolute(rootDir) || !Array.isArray(suites) || !Array.isArray(errors)) {
        throw new Error('Playwright collection returned a malformed report');
    }
    if (errors.length > 0) {
        throw new Error('Playwright collection reported errors');
    }
    const collected = new Set<string>();
    let cases = 0;
    for (const suite of suites) {
        cases += collectSuite(root, rootDir, suite, collected);
    }
    if (cases === 0) {
        throw new Error('Playwright collected zero browser cases');
    }
    return collected;
}

export function assertCollectedBrowserInventory(
    root: string,
    catalog: readonly string[],
    required: readonly string[]
): void {
    const executable = resolve(root, 'node_modules/.bin/playwright');
    const result = spawnSync(executable, ['test', '--list', '--reporter=json'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 45_000,
        maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
        throw new Error(
            `Playwright collection failed: ${result.error?.message || result.stderr?.trim().slice(0, 1000) || `exit ${result.status}`}`
        );
    }
    let report: unknown;
    try {
        report = JSON.parse(result.stdout);
    } catch {
        throw new Error('Playwright collection returned malformed JSON');
    }
    const collected = collectedFiles(root, report);
    const expected = new Set(catalog);
    const absent = Array.from(expected)
        .filter((path) => !collected.has(path))
        .sort();
    const extra = Array.from(collected)
        .filter((path) => !expected.has(path))
        .sort();
    if (absent.length > 0 || extra.length > 0) {
        throw new Error(
            `Playwright collection differs from planner inventory: absent=${JSON.stringify(absent)} extra=${JSON.stringify(extra)}`
        );
    }
    const missing = required.filter((path) => !collected.has(path));
    if (missing.length > 0) {
        throw new Error(`Selected browser specs have no collected cases: ${JSON.stringify(missing)}`);
    }
}
