import { execFileSync, spawnSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import { assertIndependentUnitObjects, copyUnitCheckout, unitAccessBootstrap } from '../unitExecutionCopy';

describe('independent unit execution checkout', () => {
    it('preserves detached actual HEAD, full refs and history without mutating or sharing source objects', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'unit-copy-'));
        const source = path.join(root, 'source');
        const target = path.join(root, 'target');
        const env = {
            ...process.env,
            GIT_TRACE2_EVENT: '0',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_SYSTEM: '/dev/null',
        };
        const git = (args: string[]) => execFileSync('git', args, { env, encoding: 'utf8' }).trim();
        try {
            mkdirSync(source);
            mkdirSync(target);
            git(['init', '--quiet', source]);
            writeFileSync(path.join(source, 'fixture'), 'first');
            git(['-C', source, 'add', 'fixture']);
            git([
                '-C',
                source,
                '-c',
                'user.name=fixture',
                '-c',
                'user.email=fixture@example.invalid',
                'commit',
                '--quiet',
                '-m',
                'first',
            ]);
            const first = git(['-C', source, 'rev-parse', 'HEAD']);
            git(['-C', source, 'update-ref', 'refs/remotes/origin/main', first]);
            writeFileSync(path.join(source, 'fixture'), 'second');
            git([
                '-C',
                source,
                '-c',
                'user.name=fixture',
                '-c',
                'user.email=fixture@example.invalid',
                'commit',
                '--quiet',
                '-am',
                'second',
            ]);
            git(['-C', source, 'checkout', '--quiet', '--detach']);
            const head = git(['-C', source, 'rev-parse', 'HEAD']);
            const config = readFileSync(path.join(source, '.git/config'), 'utf8');
            const sourceFile = statSync(path.join(source, 'fixture'));
            const refs = git(['-C', source, 'show-ref']);
            expect(
                copyUnitCheckout(source, target, {
                    run: (args) => {
                        const result = spawnSync('git', args, { env, encoding: 'utf8' });
                        return { status: result.status, stdout: result.stdout, stderr: result.stderr };
                    },
                    independentObjects: assertIndependentUnitObjects,
                })
            ).toBe(head);
            expect(git(['-C', target, 'show-ref'])).toBe(refs);
            expect(git(['-C', target, 'show', `${first}:fixture`])).toBe('first');
            expect(readFileSync(path.join(target, 'fixture'), 'utf8')).toBe('second');
            expect(readFileSync(path.join(source, '.git/config'), 'utf8')).toBe(config);
            expect(git(['-C', source, 'show-ref'])).toBe(refs);
            expect(git(['-C', source, 'rev-parse', 'HEAD'])).toBe(head);
            const after = statSync(path.join(source, 'fixture'));
            expect([after.uid, after.gid, after.mode, after.ino, after.nlink]).toEqual([
                sourceFile.uid,
                sourceFile.gid,
                sourceFile.mode,
                sourceFile.ino,
                sourceFile.nlink,
            ]);
            assertIndependentUnitObjects(path.join(source, '.git/objects'));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(['shallow', 'HEAD mismatch', 'ref loss'])('refuses %s before granting a copied checkout', (failure) => {
        const independent = vi.fn();
        expect(() =>
            copyUnitCheckout('/source', '/target', {
                run: (args) => {
                    let stdout = '';
                    if (args.includes('HEAD')) {
                        stdout =
                            failure === 'HEAD mismatch' && args.includes('/target') ? 'b'.repeat(40) : 'a'.repeat(40);
                    }
                    if (args.includes('--is-shallow-repository')) {
                        stdout = failure === 'shallow' ? 'true' : 'false';
                    }
                    if (args.includes('show-ref')) {
                        stdout =
                            failure === 'ref loss' && args.includes('/target')
                                ? 'a refs/heads/main'
                                : 'a refs/remotes/origin/main';
                    }
                    return { status: 0, stdout, stderr: '' };
                },
                independentObjects: independent,
            })
        ).toThrow();
        expect(independent).not.toHaveBeenCalled();
    });

    it.each(['shared inode', 'alternates'])('rejects %s instead of granting object independence', (failure) => {
        const root = mkdtempSync(path.join(tmpdir(), 'unit-copy-object-'));
        try {
            mkdirSync(path.join(root, 'info'));
            writeFileSync(path.join(root, 'object'), 'owned fixture');
            if (failure === 'shared inode') {
                linkSync(path.join(root, 'object'), path.join(root, 'shared'));
            } else {
                writeFileSync(path.join(root, 'info/alternates'), '/outside');
            }
            expect(() => assertIndependentUnitObjects(root)).toThrow('independent');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('stdlib access admission before copied source import', () => {
    it.each([
        'admitted',
        'UID',
        'GID',
        'groups',
        'NoNewPrivs',
        'duplicate',
        'truncated',
        'capability',
        'ancestor',
        'tool escape',
    ])('observes actual bootstrap %s and never grants a failed admission', async (failure) => {
        const context = {
            uid: 20000,
            gid: 20000,
            workspace: '/var/tmp/copy/checkout',
            toolRoot: '/var/tmp/tools',
            node: '/tools/node',
            pnpm: '/var/tmp/tools/pnpm',
        };
        const status = [
            'Uid: 20000 20000 20000 20000',
            'Gid: 20000 20000 20000 20000',
            'Groups:',
            'CapInh: 0',
            'CapPrm: 0',
            'CapEff: 0',
            'CapBnd: 0',
            'CapAmb: 0',
            'NoNewPrivs: 1',
            '',
        ].join('\n');
        const info = vi.fn();
        const error = vi.fn();
        const exit = vi.fn(() => {
            throw new Error('admission stopped');
        });
        const samples: Record<string, string> = {
            UID: status.replace('Uid: 20000', 'Uid: 0'),
            GID: status.replace('Gid: 20000', 'Gid: 1001'),
            groups: status.replace('Groups:', 'Groups: 1001'),
            NoNewPrivs: status.replace('NoNewPrivs: 1', 'NoNewPrivs: 0'),
            duplicate: `${status}Uid: 20000 20000 20000 20000\n`,
            truncated: status.trimEnd(),
            capability: status.replace('CapEff: 0', 'CapEff: 1'),
        };
        const read = vi.fn(() => samples[failure] ?? status);
        const access = vi.fn((current: string) => {
            if (failure === 'ancestor' && current === '/var/tmp') {
                throw Object.assign(new Error('denied'), { code: 'EACCES' });
            }
        });
        const fs = {
            constants: { R_OK: 4, X_OK: 1 },
            readFileSync: read,
            accessSync: access,
            realpathSync: (current: string) => (failure === 'tool escape' ? '/outside/tool' : current),
            statSync: () => ({ isDirectory: () => false, isFile: () => true, mode: 0o755 }),
        };
        const run = () =>
            runInNewContext(unitAccessBootstrap, {
                require: (name: string) => {
                    if (name === 'node:fs') {
                        return fs;
                    }
                    if (name === 'node:path') {
                        return path;
                    }
                    return { pathToFileURL: (current: string) => ({ href: current }) };
                },
                process: { argv: ['node', JSON.stringify(context), 'verify'], exit },
                console: { info, error },
            });
        if (failure === 'admitted') {
            await run();
            expect(info).toHaveBeenCalledWith(expect.stringContaining('checkout=readable pnpm-closure=readable'));
            expect(access).toHaveBeenCalledWith('/var/tmp/copy/checkout/scripts/runIsolatedUnitShard.ts', 4);
            expect(exit).not.toHaveBeenCalled();
        } else {
            expect(run).toThrow('admission stopped');
            expect(exit).toHaveBeenCalledWith(1);
            expect(info).not.toHaveBeenCalled();
            expect(error).toHaveBeenCalledWith(expect.stringContaining('unit isolation access failed: role='));
        }
    });
});
