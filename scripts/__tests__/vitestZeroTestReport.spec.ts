import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { runZeroTestGuard } from '../runVitestZeroTestGuard.ts';
import {
    executedAssertionCount,
    formatSilentZeroCollectionFailure,
    formatZeroExecutedAssertionsFailure,
    readVitestJsonReport,
    silentZeroCollectedFiles,
    silentZeroExecutedAssertions,
    type VitestJsonReport,
} from '../vitestZeroTestReport.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function report(partial: Partial<VitestJsonReport> & Pick<VitestJsonReport, 'testResults'>): VitestJsonReport {
    return {
        success: true,
        numTotalTests: 0,
        ...partial,
    };
}

describe('silentZeroCollectedFiles', () => {
    it('flags a collected spec that passed with zero assertions', () => {
        const paths = silentZeroCollectedFiles(
            report({
                testResults: [
                    {
                        name: 'src/modules/Command/presentations/views/__tests__/ClipContextMenu.spec.tsx',
                        status: 'passed',
                        assertionResults: [],
                    },
                ],
            })
        );

        expect(paths).toEqual(['src/modules/Command/presentations/views/__tests__/ClipContextMenu.spec.tsx']);
        expect(formatSilentZeroCollectionFailure(paths)).toContain('ClipContextMenu.spec.tsx');
    });

    it('does not flag a failed empty suite that Vitest already redded', () => {
        const paths = silentZeroCollectedFiles(
            report({
                success: false,
                testResults: [
                    {
                        name: 'scripts/__tests__/zeroCollectProbe.spec.ts',
                        status: 'failed',
                        assertionResults: [],
                    },
                ],
            })
        );

        expect(paths).toEqual([]);
    });

    it('does not flag a spec that actually ran tests', () => {
        const paths = silentZeroCollectedFiles(
            report({
                numTotalTests: 1,
                testResults: [
                    {
                        name: 'scripts/__tests__/prContract.spec.ts',
                        status: 'passed',
                        assertionResults: [{ status: 'passed' }],
                    },
                ],
            })
        );

        expect(paths).toEqual([]);
    });
});

describe('silentZeroExecutedAssertions', () => {
    it('flags a run where every assertion across all collected files is skipped', () => {
        const zeroExecuted = report({
            numTotalTests: 13,
            testResults: [
                {
                    name: 'scripts/__tests__/prContract.spec.ts',
                    status: 'passed',
                    assertionResults: Array.from({ length: 13 }, () => ({ status: 'skipped' })),
                },
            ],
        });

        expect(silentZeroExecutedAssertions(zeroExecuted)).toBe(true);
        expect(executedAssertionCount(zeroExecuted)).toBe(0);
        expect(formatZeroExecutedAssertionsFailure(zeroExecuted)).toContain('prContract.spec.ts');
    });

    it('does not flag a run where one spec is deliberately skipped among passing specs', () => {
        const mixedRun = report({
            numTotalTests: 2,
            testResults: [
                {
                    name: 'scripts/__tests__/deliberatelySkipped.spec.ts',
                    status: 'skipped',
                    assertionResults: [{ status: 'skipped' }],
                },
                {
                    name: 'scripts/__tests__/prContract.spec.ts',
                    status: 'passed',
                    assertionResults: [{ status: 'passed' }],
                },
            ],
        });

        expect(silentZeroExecutedAssertions(mixedRun)).toBe(false);
        expect(executedAssertionCount(mixedRun)).toBe(1);
    });

    it('does not flag a run that collected no files at all', () => {
        expect(silentZeroExecutedAssertions(report({ testResults: [] }))).toBe(false);
    });
});

describe('readVitestJsonReport', () => {
    it('reads the Vitest JSON reporter shape', () => {
        const parsed = readVitestJsonReport(
            JSON.stringify({
                success: true,
                numTotalTests: 0,
                testResults: [
                    {
                        name: '/tmp/empty.spec.ts',
                        status: 'passed',
                        assertionResults: [],
                    },
                ],
            })
        );

        expect(silentZeroCollectedFiles(parsed)).toEqual(['/tmp/empty.spec.ts']);
    });
});

describe('pnpm test:run', () => {
    it('routes through the zero-test JSON guard', () => {
        const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };

        expect(packageJson.scripts['test:run']).toBe('node scripts/runVitestZeroTestGuard.ts');
    });
});

describe('runZeroTestGuard', () => {
    const silentZeroJson = JSON.stringify({
        success: true,
        numTotalTests: 0,
        testResults: [
            {
                name: 'scripts/__tests__/zeroCollectProbe.spec.ts',
                status: 'passed',
                assertionResults: [],
            },
        ],
    });
    const passingJson = JSON.stringify({
        success: true,
        numTotalTests: 1,
        testResults: [
            {
                name: 'scripts/__tests__/prContract.spec.ts',
                status: 'passed',
                assertionResults: [{ status: 'passed', title: 'keeps Closes' }],
            },
        ],
    });
    const failedSuiteJson = JSON.stringify({
        success: false,
        numTotalTests: 0,
        testResults: [
            {
                name: 'scripts/__tests__/zeroCollectProbe.spec.ts',
                status: 'failed',
                assertionResults: [],
            },
        ],
    });
    const nameFilterMatchedNothingJson = JSON.stringify({
        success: true,
        numTotalTests: 13,
        testResults: [
            {
                name: 'scripts/__tests__/prContract.spec.ts',
                status: 'passed',
                assertionResults: Array.from({ length: 13 }, (_unused, index) => ({
                    status: 'skipped',
                    title: `assertion ${index}`,
                })),
            },
        ],
    });

    function fakeVitest(label: string): { bin: string; argvPath: string; root: string } {
        const root = mkdtempSync(join(tmpdir(), `sourdaw-fake-vitest-${label}-`));
        const bin = join(root, 'vitest');
        const argvPath = join(root, 'argv.json');
        writeFileSync(
            bin,
            [
                '#!/usr/bin/env node',
                "import { writeFileSync } from 'node:fs';",
                `writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));`,
                "const output = process.argv.find((argument) => argument.startsWith('--outputFile='));",
                'if (output === undefined) { process.exit(2); }',
                "const jsonPath = output.slice('--outputFile='.length);",
                'const body = process.env.FAKE_VITEST_JSON;',
                "if (body !== undefined && body !== '') { writeFileSync(jsonPath, body); }",
                "process.exit(Number(process.env.FAKE_VITEST_EXIT ?? '0'));",
                '',
            ].join('\n'),
            { encoding: 'utf8', mode: 0o755 }
        );
        return { bin, argvPath, root };
    }

    it('exits 1 when Vitest reports a passed file with zero assertions', () => {
        const fake = fakeVitest('silent');
        try {
            const status = runZeroTestGuard({
                vitestBin: fake.bin,
                args: ['scripts/__tests__/zeroCollectProbe.spec.ts'],
                cwd: repoRoot,
                stdio: 'pipe',
                env: { FAKE_VITEST_JSON: silentZeroJson, FAKE_VITEST_EXIT: '0' },
            });
            const argv = JSON.parse(readFileSync(fake.argvPath, 'utf8')) as string[];

            expect(status).toBe(1);
            expect(argv[0]).toBe('run');
            expect(argv).toContain('scripts/__tests__/zeroCollectProbe.spec.ts');
            expect(argv).toContain('--reporter=default');
            expect(argv).toContain('--reporter=json');
            expect(argv.some((argument) => argument.startsWith('--outputFile='))).toBe(true);
        } finally {
            rmSync(fake.root, { recursive: true, force: true });
        }
    });

    it('propagates a nonzero Vitest exit when the JSON suite already failed', () => {
        const fake = fakeVitest('fail');
        try {
            const status = runZeroTestGuard({
                vitestBin: fake.bin,
                args: ['scripts/__tests__/zeroCollectProbe.spec.ts'],
                cwd: repoRoot,
                stdio: 'pipe',
                env: { FAKE_VITEST_JSON: failedSuiteJson, FAKE_VITEST_EXIT: '1' },
            });

            expect(status).toBe(1);
        } finally {
            rmSync(fake.root, { recursive: true, force: true });
        }
    });

    it('exits 0 when Vitest passed and every collected file has assertions', () => {
        const fake = fakeVitest('ok');
        try {
            const status = runZeroTestGuard({
                vitestBin: fake.bin,
                args: ['scripts/__tests__/prContract.spec.ts'],
                cwd: repoRoot,
                stdio: 'pipe',
                env: { FAKE_VITEST_JSON: passingJson, FAKE_VITEST_EXIT: '0' },
            });

            expect(status).toBe(0);
        } finally {
            rmSync(fake.root, { recursive: true, force: true });
        }
    });

    it('exits 1 when a -t filter matches nothing and every assertion is skipped', () => {
        const fake = fakeVitest('name-filter');
        try {
            const status = runZeroTestGuard({
                vitestBin: fake.bin,
                args: ['scripts/__tests__/prContract.spec.ts', '-t', 'no-such-test-name-xyz'],
                cwd: repoRoot,
                stdio: 'pipe',
                env: { FAKE_VITEST_JSON: nameFilterMatchedNothingJson, FAKE_VITEST_EXIT: '0' },
            });

            expect(status).toBe(1);
        } finally {
            rmSync(fake.root, { recursive: true, force: true });
        }
    });

    it('exits 1 and prints the reason when the JSON report is missing or unparseable', () => {
        const fake = fakeVitest('unreadable');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const status = runZeroTestGuard({
                vitestBin: fake.bin,
                args: ['scripts/__tests__/prContract.spec.ts'],
                cwd: repoRoot,
                stdio: 'pipe',
                env: { FAKE_VITEST_JSON: '', FAKE_VITEST_EXIT: '0' },
            });

            expect(status).toBe(1);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            const [message] = errorSpy.mock.calls[0] as [string];
            expect(message).toContain('report.json');
            expect(message).toContain("could not read Vitest's JSON report");
        } finally {
            errorSpy.mockRestore();
            rmSync(fake.root, { recursive: true, force: true });
        }
    });

    it('exits 1 and prints the reason when a report entry parses as JSON but an assertion result is missing status', () => {
        const missingStatusJson = JSON.stringify({
            success: true,
            numTotalTests: 1,
            testResults: [
                {
                    name: 'scripts/__tests__/prContract.spec.ts',
                    status: 'passed',
                    assertionResults: [{ title: 'no status field on this entry' }],
                },
            ],
        });
        const fake = fakeVitest('missing-status');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const status = runZeroTestGuard({
                vitestBin: fake.bin,
                args: ['scripts/__tests__/prContract.spec.ts'],
                cwd: repoRoot,
                stdio: 'pipe',
                env: { FAKE_VITEST_JSON: missingStatusJson, FAKE_VITEST_EXIT: '0' },
            });

            expect(status).toBe(1);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            const [message] = errorSpy.mock.calls[0] as [string];
            expect(message).toContain("could not read Vitest's JSON report");
            expect(message).toContain('assertionResults[0]');
        } finally {
            errorSpy.mockRestore();
            rmSync(fake.root, { recursive: true, force: true });
        }
    });

    it('exits 1 and prints the reason when an assertion result has a non-string status', () => {
        const nonStringStatusJson = JSON.stringify({
            success: true,
            numTotalTests: 1,
            testResults: [
                {
                    name: 'scripts/__tests__/prContract.spec.ts',
                    status: 'passed',
                    assertionResults: [{ status: null }],
                },
            ],
        });
        const fake = fakeVitest('non-string-status');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const status = runZeroTestGuard({
                vitestBin: fake.bin,
                args: ['scripts/__tests__/prContract.spec.ts'],
                cwd: repoRoot,
                stdio: 'pipe',
                env: { FAKE_VITEST_JSON: nonStringStatusJson, FAKE_VITEST_EXIT: '0' },
            });

            expect(status).toBe(1);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            const [message] = errorSpy.mock.calls[0] as [string];
            expect(message).toContain("could not read Vitest's JSON report");
            expect(message).toContain('assertionResults[0]');
        } finally {
            errorSpy.mockRestore();
            rmSync(fake.root, { recursive: true, force: true });
        }
    });
});
