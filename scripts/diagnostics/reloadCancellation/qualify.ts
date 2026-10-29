import { readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { selectedSpecArguments } from '../../prValidationScope.ts';

import { assertCollectedHistory, assertProjectSemantics, historicalCases } from './history.ts';
import { ORIGINAL_SELECTORS, ORIGINAL_SPEC, WRAPPER } from './identity.ts';
import { recordOf, writeReceipt } from './journal.ts';
import { runPhase } from './processPhase.ts';

export function diagnosticEnvironment(root: string, output: string): NodeJS.ProcessEnv {
    return {
        ...process.env,
        CI: 'true',
        E2E_SPECS: JSON.stringify(ORIGINAL_SELECTORS),
        SOURDAW_E2E_PORT: '5173',
        RELOAD_DIAGNOSTIC_ROOT: root,
        RELOAD_DIAGNOSTIC_OUTPUT: output,
        RELOAD_DIAGNOSTIC_RUNNER_PID: String(process.pid),
        DEBUG: 'pw:browser',
    };
}

export function diagnosticArguments(
    root: string,
    config: string,
    reporter: string | undefined,
    wrapped: boolean
): string[] {
    const paths = ORIGINAL_SELECTORS.map((path) => (wrapped && path === ORIGINAL_SPEC ? WRAPPER : path));
    return [
        'exec',
        'playwright',
        'test',
        ...selectedSpecArguments(paths, root),
        '--config',
        config,
        '--workers=1',
        '--retries=0',
        ...(reporter ? ['--reporter', reporter] : []),
    ];
}

function list(path: string): Record<string, unknown> {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return recordOf(value, 'collected list');
}

export function assertOnlyWrapperOwnsOriginalCase(original: unknown, candidate: unknown, root: string): void {
    if (!Array.isArray(original) || !Array.isArray(candidate)) {
        throw new Error('Collected source-file identity is missing');
    }
    const maintained = basename(ORIGINAL_SPEC);
    const wrapper = relative(resolve(root, 'tests/e2e'), resolve(root, WRAPPER));
    const expectedFiles = original.map((file: unknown) => (file === maintained ? wrapper : file));
    if (!isDeepStrictEqual(candidate, expectedFiles) || candidate.filter((file) => file === wrapper).length !== 1) {
        throw new Error('Collected owning files changed beyond the single original-case wrapper');
    }
}

export async function qualifyOriginalHistory(
    root: string,
    output: string,
    prepared: { reporter: string; config: string }
): Promise<void> {
    const env = diagnosticEnvironment(root, output);
    const baselineArgs = [
        ...diagnosticArguments(root, resolve(root, 'playwright.config.ts'), prepared.reporter, false),
        '--list',
    ];
    const candidateArgs = [...diagnosticArguments(root, prepared.config, prepared.reporter, true), '--list'];
    const baselineCode = await runPhase(
        root,
        baselineArgs,
        { ...env, RELOAD_DIAGNOSTIC_PHASE: 'baseline' },
        resolve(output, 'baseline'),
        60_000
    );
    if (baselineCode !== 0) {
        throw new Error('Original baseline collection failed');
    }
    const candidateCode = await runPhase(
        root,
        candidateArgs,
        { ...env, RELOAD_DIAGNOSTIC_PHASE: 'candidate' },
        resolve(output, 'candidate'),
        60_000
    );
    if (candidateCode !== 0) {
        throw new Error('Diagnostic wrapper collection failed');
    }
    const original = list(resolve(output, 'baseline/list.json'));
    const candidate = list(resolve(output, 'candidate/list.json'));
    const saved: unknown = JSON.parse(readFileSync(new URL('./original-history.json', import.meta.url), 'utf8'));
    const expected = historicalCases(saved);
    assertCollectedHistory(expected, original.tests);
    assertCollectedHistory(expected, candidate.tests);
    assertProjectSemantics(original.projects, candidate.projects, resolve(root, WRAPPER), resolve(root, ORIGINAL_SPEC));
    if (original.workers !== 1 || candidate.workers !== 1 || !isDeepStrictEqual(original.tests, candidate.tests)) {
        throw new Error('Collected case options or worker count changed');
    }
    if (!isDeepStrictEqual(original.sourceFiles, candidate.sourceFiles)) {
        throw new Error('Collected maintained source locations changed');
    }
    assertOnlyWrapperOwnsOriginalCase(original.ownerFiles, candidate.ownerFiles, root);
    writeReceipt(resolve(output, 'collection-admission.json'), {
        admitted: true,
        cases: expected.length,
        selectors: ORIGINAL_SELECTORS.length,
        workers: 1,
        retries: 0,
        limits: [
            'Collection cannot execute the maintained480s body timeout or observe actual worker history. The maintained source hash binds those obligations.',
        ],
    });
}
