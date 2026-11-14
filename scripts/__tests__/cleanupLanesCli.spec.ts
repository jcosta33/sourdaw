import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { githubAuthorizationGitEnv } from '../githubAppIdentity.ts';

import { relativeImportClosure } from './fixtures/relativeImportClosure.ts';

const repositoryRoot = join(import.meta.dirname, '..', '..');
const cli = join(repositoryRoot, 'scripts', 'cleanupLanesCli.ts');

/**
 * A temporary primary whose `origin/main` pins a byte copy of the CLI's relative-import closure.
 * Its `origin` names another repository and it holds no role credentials, so a run that passes
 * verification refuses at the cleanup's local origin-URL check before any authentication or network
 * call.
 */
function closureFixture() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-cleanup-closure-')));
    const env = githubAuthorizationGitEnv();
    const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env }).trim();
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.com']);
    git(['remote', 'add', 'origin', 'https://example.invalid/not-sourdaw.git']);
    const closure = relativeImportClosure(repositoryRoot, 'scripts/cleanupLanesCli.ts');
    for (const path of closure) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), readFileSync(join(repositoryRoot, path)));
    }
    git(['add', 'scripts']);
    git(['commit', '-m', 'test: pin cleanup sources']);
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    const run = () =>
        spawnSync(process.execPath, [cli], {
            cwd: root,
            encoding: 'utf8',
            env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
        });
    return { closure, git, root, run, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

describe('lane:cleanup import-closure verification', () => {
    it('refuses to run when a transitive worker import differs from origin/main', () => {
        const f = closureFixture();
        try {
            expect(f.closure).toEqual(
                expect.arrayContaining([
                    'scripts/cleanupLanes.ts',
                    'scripts/removeLane.ts',
                    'scripts/trustedGithubWriteBootstrap.ts',
                ])
            );
            const path = 'scripts/removeLane.ts';
            writeFileSync(join(f.root, path), 'export {};\n');
            f.git(['add', path]);
            f.git(['commit', '-m', 'test: change pinned removal']);
            f.git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);

            const result = f.run();

            expect(result.status).toBe(1);
            expect(result.stderr).toContain(
                'scripts/removeLane.ts does not match origin/main; refusing to run a mutated copy'
            );
        } finally {
            f.dispose();
        }
    }, 60_000);

    it('passes verification when the whole closure matches origin/main', () => {
        const f = closureFixture();
        try {
            const result = f.run();

            expect(result.status).toBe(1);
            expect(result.stderr).toContain('cleanup origin is not the required repository');
            expect(result.stderr).not.toContain('origin/main; refusing');
        } finally {
            f.dispose();
        }
    }, 60_000);
});
