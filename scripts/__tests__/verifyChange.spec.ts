import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { affectedCargoPackages, buildVerificationPlan, capture, parseNameStatus } from '../verifyChange';

function plan(paths: string[], options: { requestedE2e?: string[]; cargoPackages?: string[] } = {}) {
    return buildVerificationPlan(
        paths.map((path) => ({ path, present: true })),
        {
            requestedE2e: options.requestedE2e ?? [],
            cargoPackages: options.cargoPackages ?? [],
        }
    );
}

describe('verify change planning', () => {
    it('bounds synchronous preflight commands', () => {
        const previous = process.env.SOURDAW_SYNC_TIMEOUT_MS;
        process.env.SOURDAW_SYNC_TIMEOUT_MS = '50';
        try {
            expect(() => capture(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])).toThrow(
                /timed out after 50ms/
            );
        } finally {
            if (previous === undefined) {
                delete process.env.SOURDAW_SYNC_TIMEOUT_MS;
            } else {
                process.env.SOURDAW_SYNC_TIMEOUT_MS = previous;
            }
        }
    });

    it('keeps a module change targeted and bounds every selected test runner', () => {
        const checks = plan(['src/modules/Project/useCases/saveProject.ts']);

        expect(checks.map((check) => check.id)).toContain('vitest-related-src');
        expect(checks.map((check) => check.id)).not.toContain('e2e-targeted');
        expect(checks.find((check) => check.id === 'vitest-related-src')?.args).toEqual([
            'test:related',
            'src/modules/Project/useCases/saveProject.ts',
            '--run',
            '--passWithNoTests',
        ]);
    });

    it('keeps shared web state on related tests', () => {
        const checks = plan(['src/infra/storage/projectRepository.ts']);
        const unit = checks.find((check) => check.id === 'vitest-related-src');

        expect(unit).toMatchObject({ heavyweight: false });
        expect(unit?.args).toContain('src/infra/storage/projectRepository.ts');
    });

    it('gives the web build its broad timeout profile', () => {
        const build = plan(['package.json']).find((check) => check.id === 'web-build');

        expect(build?.profile).toBe('broad');
    });

    it('runs only the changed E2E spec by default', () => {
        const checks = plan(['tests/e2e/transportSmoke.spec.ts']);
        const e2e = checks.find((check) => check.id === 'e2e-targeted');

        expect(e2e?.args).toEqual(['test:e2e', 'tests/e2e/transportSmoke.spec.ts']);
        expect(e2e?.args).not.toContain('tests/e2e/projectLifecycleTestId.spec.ts');
    });

    it('never infers E2E scope from harness changes', () => {
        expect(plan(['playwright.config.ts']).map((check) => check.id)).not.toContain('e2e-targeted');
        expect(
            plan(['playwright.config.ts'], { requestedE2e: ['tests/e2e/smoke.spec.ts'] }).map((check) => check.id)
        ).toContain('e2e-targeted');
    });

    it('keeps script tests when shared web code changes in the same diff', () => {
        const checks = plan(['src/infra/storage/projectRepository.ts', 'scripts/verifyProject.ts']);

        expect(checks.map((check) => check.id)).toEqual(
            expect.arrayContaining(['vitest-related-src', 'vitest-related-scripts'])
        );
    });

    it('never passes a deleted source file to a file-taking check', () => {
        const checks = buildVerificationPlan([{ path: 'src/modules/Project/deleted.ts', present: false }], {
            requestedE2e: [],
            cargoPackages: [],
        });

        expect(checks.find((check) => check.id === 'lint-changed')).toBeUndefined();
        expect(checks.map((check) => check.id)).not.toContain('vitest-related-src');
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
            expect(output).toContain('vitest-related-src');
            expect(output).toContain('vitest-related-scripts');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
