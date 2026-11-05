import { isPlaywrightCollected, isVitestCollected } from './vitestCollectionPatterns.ts';

import type { ChangedRecord } from './prValidationScopeCheckout.ts';

const TEST_SIDE_SCRIPT = /\.(?:ts|tsx|js|mjs)$/;

/** How one changed test-side module routes browser selection; empty `specs` means unit-only. */
export type TestSideRoute =
    { path: string; kind: 'specs'; specs: string[] } | { path: string; kind: 'full'; reason: string };

export const TEST_FIXTURE_REASON =
    'test fixture no product code or browser spec imports; broad non-browser validation without browser execution';

/**
 * A script that only test runners should load: a non-spec module under tests/e2e, or a non-spec
 * file under a src `__tests__` directory. The import graph still has to prove no product code loads it.
 */
export function testSideModuleKind(path: string): 'e2e' | 'src' | undefined {
    const segments = path.split('/');
    if (!TEST_SIDE_SCRIPT.test(path) || path.endsWith('.d.ts') || segments.includes('..')) {
        return undefined;
    }
    if (segments.includes('node_modules')) {
        return undefined;
    }
    if (path.startsWith('tests/e2e/') && !isPlaywrightCollected(path)) {
        return 'e2e';
    }
    return path.startsWith('src/') && segments.includes('__tests__') && !isVitestCollected(path) ? 'src' : undefined;
}

/** The plan row for a routed test-side module with browser work; an uncollected spec widens it. */
export function testSidePathSelection(
    route: TestSideRoute,
    available: ReadonlySet<string>,
    fullReason: string
): { specs: readonly string[]; browserAi: boolean; broad: boolean; reason: string } {
    if (route.kind === 'full' || route.specs.some((spec) => !available.has(spec))) {
        const reason = route.kind === 'full' ? route.reason : 'reaching spec is not collected';
        return { specs: [], browserAi: true, broad: true, reason: `${fullReason}; test-side module ${reason}` };
    }
    return {
        specs: route.specs,
        browserAi: route.specs.some((spec) => spec.startsWith('tests/e2e/browserAi')),
        broad: false,
        reason: `test-side module imported by ${route.specs.length} browser specs`,
    };
}

/**
 * Routes for the changed test-side modules among `productPaths`. A deleted, renamed, or retyped
 * one, and every module when the graph helper cannot load, stays on the product route.
 */
export async function testSideRoutes(
    root: string,
    productPaths: readonly string[],
    records: readonly ChangedRecord[],
    specs: readonly string[]
): Promise<TestSideRoute[]> {
    const historical = new Set(records.filter((record) => !/^[AM]$/.test(record.status)).map((record) => record.path));
    const candidates = productPaths.filter((path) => !historical.has(path) && testSideModuleKind(path) !== undefined);
    if (candidates.length === 0) {
        return [];
    }
    try {
        const { loadTestSideGraph, selectTestSideSpecs } = await import('./e2eTestSideGraph.ts');
        return selectTestSideSpecs(candidates, specs, await loadTestSideGraph(root));
    } catch {
        return [];
    }
}
