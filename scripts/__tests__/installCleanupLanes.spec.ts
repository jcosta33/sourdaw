import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { githubAuthorizationGitEnv } from '../githubAppIdentity.ts';
import {
    CLEANUP_LABEL,
    cleanupRuntimeProgram,
    installCleanupLanes,
    type CleanupInstallationPort,
    type CleanupRuntimeBinding,
} from '../installCleanupLanes.ts';

function fixture() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-cleanup-install-')));
    const env = githubAuthorizationGitEnv();
    const gitPath = realpathSync(execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim());
    const git = (args: string[]) => execFileSync(gitPath, ['-C', root, ...args], { env, encoding: 'utf8' });
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.com']);
    git(['remote', 'add', 'origin', 'https://github.com/jcosta33/sourdaw.git']);
    writeFileSync(join(root, '.git/info/exclude'), '# preserve existing bytes\nlocal-only\n');
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, '.gitignore'), 'Library/\n');
    writeFileSync(join(root, 'scripts/trustedGithubWriteBootstrap.ts'), 'old approved launcher\n');
    writeFileSync(
        join(root, 'scripts/cleanupLanes.ts'),
        "import { writeFileSync } from 'node:fs';\nexport async function runCleanup(root: string) { writeFileSync(root + '/observed', 'ran'); }\n"
    );
    writeFileSync(join(root, 'unrelated'), 'keep');
    git(['add', '.']);
    git(['commit', '-m', 'old primary']);
    // The approved source lives in Git while the primary working tree remains on its older commit.
    const old = git(['rev-parse', 'HEAD']).trim();
    const blob = execFileSync(gitPath, ['-C', root, 'hash-object', '-w', '--stdin'], {
        input: 'new approved launcher\n',
        env,
        encoding: 'utf8',
    }).trim();
    const index = join(root, '.git/install-index');
    const indexEnv = { ...env, GIT_INDEX_FILE: index };
    const indexed = (args: string[]) =>
        execFileSync(gitPath, ['-C', root, ...args], { env: indexEnv, encoding: 'utf8' }).trim();
    indexed(['read-tree', old]);
    indexed(['update-index', '--cacheinfo', '100644', blob, 'scripts/trustedGithubWriteBootstrap.ts']);
    const tree = indexed(['write-tree']);
    const commit = execFileSync(gitPath, ['-C', root, 'commit-tree', tree, '-p', old, '-m', 'approved runtime'], {
        env,
        encoding: 'utf8',
    }).trim();
    git(['update-ref', 'refs/remotes/origin/main', commit]);
    const events: string[][] = [];
    let loaded = false;
    const port: CleanupInstallationPort = {
        primaryRoot: root,
        home: root,
        platform: 'darwin',
        uid: 501,
        node: process.execPath,
        git: gitPath,
        gh: gitPath,
        capture: (command, args) => {
            if (command === '/bin/launchctl') {
                events.push(args);
                if (!loaded) {
                    throw new Error('Could not find service in domain');
                }
                return 'state = waiting';
            }
            return git(args);
        },
        run: (command, args) => {
            expect(command).toBe('/bin/launchctl');
            events.push(args);
            loaded = args[0] === 'bootstrap';
        },
    };
    return {
        root,
        git,
        port,
        events,
        commit,
        dispose: () => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
    };
}

function runtimeBinding(runtime: string): CleanupRuntimeBinding {
    return JSON.parse(readFileSync(join(runtime, 'manifest.json'), 'utf8')) as CleanupRuntimeBinding;
}
function runRuntime(runtime: string, binding = runtimeBinding(runtime)) {
    return spawnSync(process.execPath, ['-e', cleanupRuntimeProgram(binding, runtime)], {
        encoding: 'utf8',
        env: { ...githubAuthorizationGitEnv(), NODE_OPTIONS: '', NODE_PATH: '' },
    });
}

describe('cleanup installation', () => {
    it('installs and reinstalls a launchd job with absolute verified runtime and preserves unrelated primary dirt', () => {
        const f = fixture();
        try {
            writeFileSync(join(f.root, 'unrelated'), 'local changes');
            const installed = installCleanupLanes(f.port);
            expect(readFileSync(join(f.root, 'unrelated'), 'utf8')).toBe('local changes');
            expect(readFileSync(join(f.root, 'scripts/trustedGithubWriteBootstrap.ts'), 'utf8')).toBe(
                'new approved launcher\n'
            );
            const plist = readFileSync(installed.plist, 'utf8');
            expect(plist).toContain('<key>StartInterval</key><integer>300</integer>');
            expect(plist).toContain('<key>RunAtLoad</key><true/>');
            expect(plist).toContain(process.execPath);
            expect(plist).not.toContain('GH_TOKEN');
            expect(plist).toContain('<key>NODE_OPTIONS</key><string></string>');
            expect(plist).toContain('<key>NODE_PATH</key><string></string>');
            expect(f.events).toContainEqual(['bootstrap', 'gui/501', installed.plist]);
            expect(f.git(['check-ignore', '.agents/lane-cleanup/worker.log']).trim()).toBe(
                '.agents/lane-cleanup/worker.log'
            );
            installCleanupLanes(f.port);
            expect(f.events).toContainEqual(['bootout', `gui/501/${CLEANUP_LABEL}`]);
            expect(readFileSync(join(f.root, '.git/info/exclude'), 'utf8')).toBe(
                '# preserve existing bytes\nlocal-only\n/.agents/lane-cleanup/\n'
            );
            expect(f.git(['diff', '--name-only']).trim().split('\n').sort()).toEqual([
                'scripts/trustedGithubWriteBootstrap.ts',
                'unrelated',
            ]);
        } finally {
            f.dispose();
        }
    });

    it('refuses locally modified or staged launcher bytes without overwriting them', () => {
        const f = fixture();
        try {
            writeFileSync(join(f.root, 'scripts/trustedGithubWriteBootstrap.ts'), 'local edit');
            expect(() => installCleanupLanes(f.port)).toThrow('local changes');
            expect(readFileSync(join(f.root, 'scripts/trustedGithubWriteBootstrap.ts'), 'utf8')).toBe('local edit');
            expect(f.events).toHaveLength(0);
        } finally {
            f.dispose();
        }
    });

    it('remains runnable when a disposable author directory is removed and fails closed on tampering', () => {
        const f = fixture();
        try {
            const installed = installCleanupLanes(f.port);
            // Runtime is sourced from approved Git objects, never the primary files or author directory.
            writeFileSync(join(f.root, 'scripts/cleanupLanes.ts'), "throw new Error('unapproved primary source');\n");
            const disposable = join(f.root, '.agents/worktrees/author');
            mkdirSync(disposable, { recursive: true });
            rmSync(disposable, { recursive: true });
            expect(runRuntime(installed.runtime).status).toBe(0);
            expect(readFileSync(join(f.root, 'observed'), 'utf8')).toBe('ran');
            writeFileSync(join(installed.runtime, 'scripts/cleanupLanes.ts'), "throw Error('tampered executed');\n");
            const result = runRuntime(installed.runtime);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain('source changed');
            expect(result.stderr).not.toContain('tampered executed');
        } finally {
            f.dispose();
        }
    });

    it('refuses tampered manifests, unsafe source paths and foreign primary registries before execution', () => {
        const f = fixture();
        try {
            const installed = installCleanupLanes(f.port);
            const binding = runtimeBinding(installed.runtime);
            writeFileSync(join(installed.runtime, 'manifest.json'), '{}\n');
            expect(runRuntime(installed.runtime, binding).stderr).toContain('manifest changed');
            expect(() =>
                cleanupRuntimeProgram(
                    { ...binding, sources: [{ path: '../outside.ts', hash: 'x' }] },
                    installed.runtime
                )
            ).toThrow('unsafe source path');
            const foreign = {
                ...f.port,
                capture: (command: string, args: string[]) =>
                    args.includes('list') ? 'worktree /foreign\0' : f.port.capture(command, args),
            };
            expect(() => installCleanupLanes(foreign)).toThrow('protected primary repository');
        } finally {
            f.dispose();
        }
    });

    it('refuses a symlinked runtime destination before writing outside the primary operational root', () => {
        const f = fixture();
        const foreign = mkdtempSync(join(tmpdir(), 'sourdaw-foreign-runtime-'));
        try {
            mkdirSync(join(f.root, '.agents/lane-cleanup'), { recursive: true });
            symlinkSync(foreign, join(f.root, '.agents/lane-cleanup/runtimes'), 'dir');
            expect(() => installCleanupLanes(f.port)).toThrow('runtime directory is not inside');
            expect(f.events).toHaveLength(0);
            expect(readFileSync(join(f.root, 'scripts/trustedGithubWriteBootstrap.ts'), 'utf8')).toBe(
                'old approved launcher\n'
            );
        } finally {
            f.dispose();
            rmSync(foreign, { recursive: true });
        }
    });

    it('states its platform limitation and does not hide launchctl inspection failures', () => {
        const f = fixture();
        try {
            expect(() => installCleanupLanes({ ...f.port, platform: 'linux' })).toThrow('requires macOS');
            expect(() =>
                installCleanupLanes({
                    ...f.port,
                    capture: (command, args) => {
                        if (command === '/bin/launchctl') {
                            throw new Error('permission denied');
                        }
                        return f.port.capture(command, args);
                    },
                })
            ).toThrow('permission denied');
        } finally {
            f.dispose();
        }
    });
});
