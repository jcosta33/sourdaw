import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { acquireHeavyweightLock, affectedCargoPackages, buildVerificationPlan, parseNameStatus } from '../verifyChange';

function plan(
    paths: string[],
    options: { allowFullE2e?: boolean; requestedE2e?: string[]; cargoPackages?: string[] } = {}
) {
    return buildVerificationPlan(
        paths.map((path) => ({ path, present: true })),
        {
            allowFullE2e: options.allowFullE2e ?? false,
            requestedE2e: options.requestedE2e ?? [],
            cargoPackages: options.cargoPackages ?? [],
        }
    );
}

describe('verify change planning', () => {
    it('keeps a module change targeted and bounds every selected test runner', () => {
        const checks = plan(['src/modules/Project/useCases/saveProject.ts']);

        expect(checks.map((check) => check.id)).toContain('vitest-related-src');
        expect(checks.map((check) => check.id)).not.toContain('e2e-targeted');
        expect(checks.map((check) => check.id)).not.toContain('e2e-full');
        expect(checks.find((check) => check.id === 'vitest-related-src')?.args).toEqual(
            expect.arrayContaining(['--maxWorkers=2', '--bail=1'])
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
        expect(plan(['docs/06-testing.md'], { allowFullE2e: true }).map((check) => check.id)).toContain('e2e-full');
        expect(plan(['docs/06-testing.md']).map((check) => check.id)).not.toContain('e2e-full');
    });

    it('keeps script tests when shared web code changes in the same diff', () => {
        const checks = plan(['src/infra/storage/projectRepository.ts', 'scripts/verifyProject.ts']);

        expect(checks.map((check) => check.id)).toEqual(
            expect.arrayContaining(['vitest-full-src', 'vitest-related-scripts'])
        );
    });

    it('never passes a deleted source file to a file-taking check', () => {
        const checks = buildVerificationPlan([{ path: 'src/modules/Project/deleted.ts', present: false }], {
            allowFullE2e: false,
            requestedE2e: [],
            cargoPackages: [],
        });

        expect(checks.find((check) => check.id === 'oxlint')).toBeUndefined();
        expect(checks.map((check) => check.id)).toContain('vitest-full-src');
    });

    it('checks the reverse Cargo dependency closure supplied by live metadata', () => {
        const packages = affectedCargoPackages([{ path: 'crates/daw-core/src/lib.rs', present: true }]);
        const checks = plan(['crates/daw-core/src/lib.rs'], { cargoPackages: packages });

        expect(packages).toEqual(expect.arrayContaining(['daw-core', 'daw-collab', 'daw-engine', 'sourdaw']));
        expect(checks.map((check) => check.id)).toEqual(
            expect.arrayContaining([
                'cargo-test-daw-core',
                'cargo-test-daw-collab',
                'cargo-test-daw-engine',
                'cargo-test-sourdaw',
            ])
        );
    });

    it('maps root Cargo controls to every workspace package', () => {
        const packages = affectedCargoPackages([{ path: 'Cargo.lock', present: true }]);

        expect(packages).toEqual(
            expect.arrayContaining(['daw-core', 'daw-dsp', 'proof-chamber', 'scoring', 'sourdaw'])
        );
    });

    it('does not invent checks for documentation-only changes', () => {
        expect(plan(['docs/06-testing.md'])).toEqual([]);
    });
});

describe('git change parsing', () => {
    it('keeps both rename paths and marks deletions absent', () => {
        expect(parseNameStatus('R100\0src/infra/old.ts\0src/modules/New/new.ts\0D\0scripts/gone.ts\0')).toEqual([
            { path: 'src/infra/old.ts', present: false },
            { path: 'src/modules/New/new.ts', present: true },
            { path: 'scripts/gone.ts', present: false },
        ]);
    });

    it('derives renamed and untracked paths from an isolated repository', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-verify-cli-'));
        const script = join(import.meta.dirname, '../verifyChange.ts');
        try {
            execFileSync('git', ['init', '-b', 'main'], { cwd: root });
            execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
            execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: root });
            mkdirSync(join(root, 'src/infra'), { recursive: true });
            writeFileSync(join(root, 'src/infra/old.ts'), 'export const old = true;\n');
            execFileSync('git', ['add', '.'], { cwd: root });
            execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });
            execFileSync('git', ['switch', '-c', 'feature'], { cwd: root });
            mkdirSync(join(root, 'src/modules/New'), { recursive: true });
            renameSync(join(root, 'src/infra/old.ts'), join(root, 'src/modules/New/new.ts'));
            mkdirSync(join(root, 'scripts'));
            writeFileSync(join(root, 'scripts/untracked.ts'), 'export const untracked = true;\n');

            const output = execFileSync(
                process.execPath,
                ['--experimental-strip-types', script, '--plan', '--base', 'main'],
                { cwd: root, encoding: 'utf8' }
            );

            expect(output).toContain('deleted: src/infra/old.ts');
            expect(output).toContain('present: src/modules/New/new.ts');
            expect(output).toContain('present: scripts/untracked.ts');
            expect(output).toContain('vitest-full-src');
            expect(output).toContain('vitest-related-scripts');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
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
                JSON.stringify({
                    token: 'stale',
                    pid: 2_147_483_647,
                    cwd: '/gone',
                    startedAt: '2020-01-01',
                    processStartedAt: 'gone',
                })
            );

            const replacement = acquireHeavyweightLock({ commonGitDirectory, root });
            replacement.release();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('reclaims a reused PID whose process-start identity changed', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-lock-reused-pid-'));
        const commonGitDirectory = join(root, 'repo.git');
        try {
            const first = acquireHeavyweightLock({ commonGitDirectory, root });
            writeFileSync(
                join(first.path, 'owner.json'),
                JSON.stringify({
                    token: 'stale',
                    pid: process.pid,
                    cwd: '/gone',
                    startedAt: '2020-01-01',
                    processStartedAt: 'different process',
                })
            );

            const replacement = acquireHeavyweightLock({ commonGitDirectory, root });
            replacement.release();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
