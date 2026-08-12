import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { acquireHeavyweightLock, buildVerificationPlan } from '../verifyChange';

const e2eSpecs = ['tests/e2e/projectLifecycleTestId.spec.ts', 'tests/e2e/transportSmoke.spec.ts'];

function plan(paths: string[], allowFullE2e = false) {
    return buildVerificationPlan(paths, { allowFullE2e, e2eSpecs });
}

describe('verify change planning', () => {
    it('keeps a module change targeted and bounds every selected test runner', () => {
        const checks = plan(['src/modules/Project/useCases/saveProject.ts']);

        expect(checks.map((check) => check.id)).toContain('vitest-related');
        expect(checks.map((check) => check.id)).toContain('e2e-targeted');
        expect(checks.map((check) => check.id)).not.toContain('e2e-full');
        expect(checks.find((check) => check.id === 'vitest-related')?.args).toEqual(
            expect.arrayContaining(['--maxWorkers=2', '--bail=1'])
        );
        expect(checks.find((check) => check.id === 'e2e-targeted')?.args).toEqual(
            expect.arrayContaining(['tests/e2e/projectLifecycleTestId.spec.ts', '--workers=1', '--max-failures=1'])
        );
    });

    it('uses the bounded full unit suite only for shared web state', () => {
        const checks = plan(['src/infra/storage/projectRepository.ts']);
        const unit = checks.find((check) => check.id === 'vitest-full-src');

        expect(unit).toMatchObject({ heavyweight: true });
        expect(unit?.args).toEqual(expect.arrayContaining(['--dir', 'src', '--maxWorkers=2', '--bail=1']));
        expect(checks.map((check) => check.id)).not.toContain('e2e-full');
    });

    it('runs only the changed E2E spec by default', () => {
        const checks = plan(['tests/e2e/transportSmoke.spec.ts']);
        const e2e = checks.find((check) => check.id === 'e2e-targeted');

        expect(e2e?.args).toEqual(
            expect.arrayContaining(['tests/e2e/transportSmoke.spec.ts', '--workers=1', '--max-failures=1'])
        );
        expect(e2e?.args).not.toContain('tests/e2e/projectLifecycleTestId.spec.ts');
    });

    it('allows the full E2E suite only for harness risk or explicit authority', () => {
        expect(plan(['playwright.config.ts']).map((check) => check.id)).toContain('e2e-full');
        expect(plan(['docs/06-testing.md'], true).map((check) => check.id)).toContain('e2e-full');
        expect(plan(['docs/06-testing.md']).map((check) => check.id)).not.toContain('e2e-full');
    });

    it('does not invent checks for documentation-only changes', () => {
        expect(plan(['docs/06-testing.md'])).toEqual([]);
    });
});

describe('heavyweight admission', () => {
    it('rejects a second owner until the first releases the shared lock', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-lock-collision-'));
        const commonGitDirectory = join(root, 'repo.git');
        try {
            const first = acquireHeavyweightLock({ commonGitDirectory, root });

            expect(() => acquireHeavyweightLock({ commonGitDirectory, root })).toThrow(/locked by pid/);
            first.release();

            const second = acquireHeavyweightLock({ commonGitDirectory, root });
            second.release();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('reclaims a lock whose recorded process is gone', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-lock-stale-'));
        const commonGitDirectory = join(root, 'repo.git');
        try {
            const first = acquireHeavyweightLock({ commonGitDirectory, root });
            writeFileSync(
                join(first.path, 'owner.json'),
                JSON.stringify({ token: 'stale', pid: 2_147_483_647, cwd: '/gone', startedAt: '2020-01-01' })
            );

            const replacement = acquireHeavyweightLock({ commonGitDirectory, root });
            replacement.release();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
