import { execFileSync, spawnSync } from 'node:child_process';
import {
    existsSync,
    linkSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { githubAuthorizationGitEnv } from '../githubAppIdentity.ts';
import {
    CLEANUP_LABEL,
    cleanupRuntimeProgram,
    installCleanupLanes,
    refreshCleanupLauncher,
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
    it('never reopens a checked installation receipt after a foreign-payload swap', () => {
        const f = fixture();
        const foreign = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-install-read-swap-')));
        try {
            installCleanupLanes(f.port);
            const directory = join(f.root, '.agents/lane-cleanup');
            const path = join(directory, 'launcher-installation.json');
            const target = join(foreign, 'payload');
            writeFileSync(target, JSON.stringify({ commit: f.commit, hash: 'foreign payload' }));
            const program = `
                import fs from 'node:fs';import cp from 'node:child_process';
                import {syncBuiltinESMExports} from 'node:module';
                const path=${JSON.stringify(path)},target=${JSON.stringify(target)},root=${JSON.stringify(f.root)};
                const read=fs.readFileSync,open=fs.openSync,close=fs.closeSync;
                let owned,swapped=false,foreignRead=false;const opened=[],closed=new Set();
                fs.openSync=(file,...args)=>{const fd=open(file,...args);if(file===path){owned=fd;opened.push(fd);}return fd;};
                fs.closeSync=(fd)=>{closed.add(fd);return close(fd);};
                fs.readFileSync=(file,...args)=>{
                    if((file===path||file===owned)&&!swapped){fs.renameSync(path,path+'.original');fs.symlinkSync(target,path);swapped=true;}
                    if(file===path&&swapped)foreignRead=true;
                    return read(file,...args);
                };
                syncBuiltinESMExports();
                const {refreshCleanupLauncher}=await import(${JSON.stringify(join(import.meta.dirname, '../installCleanupLanes.ts'))});
                let error;try{refreshCleanupLauncher({primaryRoot:root,git:${JSON.stringify(f.port.git)},capture:(command,args)=>cp.execFileSync(command,['-C',root,...args],{encoding:'utf8'})},${JSON.stringify(f.commit)},${JSON.stringify(directory)});}catch(caught){error=caught.message;}
                console.log(JSON.stringify({swapped,foreignRead,error,opened:opened.length,closed:opened.every(fd=>closed.has(fd))}));
            `;
            const result = JSON.parse(
                execFileSync(process.execPath, ['--input-type=module', '-e', program], {
                    cwd: f.root,
                    encoding: 'utf8',
                    env: githubAuthorizationGitEnv(),
                })
            );
            expect(result.swapped).toBe(true);
            expect(result.foreignRead).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.opened).toBeGreaterThan(0);
            expect(result.closed).toBe(true);
            expect(readFileSync(target, 'utf8')).toBe(JSON.stringify({ commit: f.commit, hash: 'foreign payload' }));
        } finally {
            f.dispose();
            rmSync(foreign, { recursive: true });
        }
    });

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

    it.each(['worker.log', 'worker-error.log'])(
        'refuses a preexisting hardlinked %s before scheduler activation',
        (name) => {
            const f = fixture();
            const foreign = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-cleanup-log-alias-')));
            try {
                const directory = join(f.root, '.agents/lane-cleanup');
                mkdirSync(directory, { recursive: true });
                const target = join(foreign, 'unrelated-data');
                const bytes = 'unrelated private fixture bytes\n';
                writeFileSync(target, bytes);
                linkSync(target, join(directory, name));
                expect(() => installCleanupLanes(f.port)).toThrow('exclusive regular file');
                expect(f.events).toHaveLength(0);
                expect(readFileSync(target, 'utf8')).toBe(bytes);
                expect(readFileSync(join(directory, name), 'utf8')).toBe(bytes);
                expect(readFileSync(join(f.root, 'scripts/trustedGithubWriteBootstrap.ts'), 'utf8')).toBe(
                    'old approved launcher\n'
                );
            } finally {
                f.dispose();
                rmSync(foreign, { recursive: true });
            }
        }
    );

    it('preserves ordinary existing one-link logs through installation and reinstallation', () => {
        const f = fixture();
        try {
            const directory = join(f.root, '.agents/lane-cleanup');
            mkdirSync(directory, { recursive: true });
            for (const name of ['worker.log', 'worker-error.log']) {
                writeFileSync(join(directory, name), `existing ${name} bytes\n`);
            }
            const installed = installCleanupLanes(f.port);
            installCleanupLanes(f.port);
            expect(f.events).toContainEqual(['bootstrap', 'gui/501', installed.plist]);
            for (const name of ['worker.log', 'worker-error.log']) {
                expect(readFileSync(join(directory, name), 'utf8')).toBe(`existing ${name} bytes\n`);
            }
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

    it.each(['hardlink', 'symlink', 'dangling symlink'])(
        'refuses an exclusion %s without modifying or creating its external target',
        (alias) => {
            const f = fixture();
            const foreign = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-exclude-alias-')));
            try {
                const target = join(foreign, 'exclude');
                const bytes = '# foreign exclusion bytes\nforeign-only';
                if (alias !== 'dangling symlink') {
                    writeFileSync(target, bytes);
                }
                const exclude = join(f.root, '.git/info/exclude');
                rmSync(exclude);
                if (alias === 'hardlink') {
                    linkSync(target, exclude);
                } else {
                    symlinkSync(target, exclude);
                }
                expect(() => installCleanupLanes(f.port)).toThrow();
                if (alias === 'dangling symlink') {
                    expect(existsSync(target)).toBe(false);
                } else {
                    expect(readFileSync(target, 'utf8')).toBe(bytes);
                }
                expect(readFileSync(join(f.root, 'scripts/trustedGithubWriteBootstrap.ts'), 'utf8')).toBe(
                    'old approved launcher\n'
                );
                expect(f.events).toHaveLength(0);
            } finally {
                f.dispose();
                rmSync(foreign, { recursive: true });
            }
        }
    );

    it('creates a missing exclusion file once and preserves existing regular-file bytes', () => {
        const f = fixture();
        try {
            const path = join(f.root, '.git/info/exclude');
            rmSync(path);
            installCleanupLanes(f.port);
            installCleanupLanes(f.port);
            expect(readFileSync(path, 'utf8')).toBe('/.agents/lane-cleanup/\n');
            writeFileSync(path, '# keep CRLF bytes\r\nother-only');
            installCleanupLanes(f.port);
            installCleanupLanes(f.port);
            expect(readFileSync(path, 'utf8')).toBe('# keep CRLF bytes\r\nother-only\n/.agents/lane-cleanup/\n');
        } finally {
            f.dispose();
        }
    });

    it.each(['new hardlink', 'replacement symlink'])(
        'refuses a %s introduced after the exclusion descriptor was opened',
        (race) => {
            const f = fixture();
            const foreign = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-exclude-race-')));
            try {
                const program = `
                    import fs from 'node:fs';
                    import {syncBuiltinESMExports} from 'node:module';
                    const root=${JSON.stringify(f.root)},foreign=${JSON.stringify(foreign)},race=${JSON.stringify(race)};
                    const path=root+'/.git/info/exclude',alias=foreign+'/exclude';
                    const read=fs.readFileSync,open=fs.openSync;
                    let owned,swapped=false;
                    fs.openSync=(file,...args)=>{const fd=open(file,...args);if(file===path)owned=fd;return fd;};
                    fs.readFileSync=(file,...args)=>{
                        const bytes=read(file,...args);
                        if(file===owned&&!swapped){
                            swapped=true;
                            if(race==='new hardlink')fs.linkSync(path,alias);
                            else{fs.renameSync(path,alias);fs.symlinkSync(foreign+'/missing',path);}
                        }
                        return bytes;
                    };
                    syncBuiltinESMExports();
                    const {ensureCleanupExcluded}=await import(${JSON.stringify(join(import.meta.dirname, '../cleanupLanes.ts'))});
                    let error;
                    try{ensureCleanupExcluded(root);}catch(caught){error=caught.message;}
                    console.log(JSON.stringify({swapped,error,bytes:read(alias,'utf8'),created:fs.existsSync(foreign+'/missing')}));
                `;
                const result = JSON.parse(
                    execFileSync(process.execPath, ['--input-type=module', '-e', program], {
                        cwd: f.root,
                        encoding: 'utf8',
                        env: githubAuthorizationGitEnv(),
                    })
                );
                expect(result.swapped).toBe(true);
                expect(result.error).toContain('exclusively owned');
                expect(result.bytes).toBe('# preserve existing bytes\nlocal-only\n');
                expect(result.created).toBe(false);
            } finally {
                f.dispose();
                rmSync(foreign, { recursive: true });
            }
        }
    );

    it('refuses a launcher reached through a symlinked scripts parent before any refresh writes', () => {
        const f = fixture();
        const foreign = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-foreign-launcher-')));
        try {
            const scripts = join(f.root, 'scripts');
            renameSync(scripts, join(foreign, 'scripts'));
            symlinkSync(join(foreign, 'scripts'), scripts, 'dir');
            writeFileSync(join(foreign, 'unrelated'), 'foreign data');
            const directory = join(f.root, '.agents/lane-cleanup');
            mkdirSync(directory, { recursive: true });
            expect(() => refreshCleanupLauncher(f.port, f.commit, directory)).toThrow('canonical');
            expect(readFileSync(join(foreign, 'scripts/trustedGithubWriteBootstrap.ts'), 'utf8')).toBe(
                'old approved launcher\n'
            );
            expect(readFileSync(join(foreign, 'unrelated'), 'utf8')).toBe('foreign data');
            expect(existsSync(join(directory, 'launcher-installation.json'))).toBe(false);
            expect(f.events).toHaveLength(0);
        } finally {
            f.dispose();
            rmSync(foreign, { recursive: true });
        }
    });

    it.each(['primary alias', 'launcher symlink'])('refuses a %s before launcher refresh writes', (escape) => {
        const f = fixture();
        const foreign = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-launcher-alias-')));
        try {
            mkdirSync(join(f.root, '.agents/lane-cleanup'), { recursive: true });
            let root = f.root;
            const launcher = join(f.root, 'scripts/trustedGithubWriteBootstrap.ts');
            const target = join(foreign, 'launcher');
            if (escape === 'primary alias') {
                root = join(foreign, 'primary');
                symlinkSync(f.root, root, 'dir');
                writeFileSync(target, 'unrelated foreign data');
            } else {
                renameSync(launcher, target);
                symlinkSync(target, launcher);
            }
            expect(() =>
                refreshCleanupLauncher({ ...f.port, primaryRoot: root }, f.commit, join(root, '.agents/lane-cleanup'))
            ).toThrow('canonical');
            expect(readFileSync(target, 'utf8')).toBe(
                escape === 'primary alias' ? 'unrelated foreign data' : 'old approved launcher\n'
            );
            expect(existsSync(join(f.root, '.agents/lane-cleanup/launcher-installation.json'))).toBe(false);
        } finally {
            f.dispose();
            rmSync(foreign, { recursive: true });
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
