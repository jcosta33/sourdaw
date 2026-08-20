import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    formatSilentZeroCollectionFailure,
    readVitestJsonReport,
    silentZeroCollectedFiles,
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
                        assertionResults: [{ title: 'keeps Closes' }],
                    },
                ],
            })
        );

        expect(paths).toEqual([]);
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
