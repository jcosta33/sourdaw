import { execFileSync, spawn } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTHOR_LOCK_REASON } from '../githubAppIdentity.ts';
import {
    assertTrustedClosure,
    isStale,
    laneLockRefusal,
    parsePruneArgs,
    pruneFleet,
    pruneTarget,
    capture,
    shellPort,
    type LanePrunePort,
} from '../pruneLane';
import { parseWorktrees, type Worktree } from '../removeLane';

// A global `trace2.eventtarget` can feed a background daemon (git-ai) that writes `.git/ai` into a
// repository after each git command returns, racing the fixtures' deletion with ENOTEMPTY. Every git
// child here inherits this environment, so disable the trace2 event stream for this worker.
process.env.GIT_TRACE2_EVENT = '0';

const root = '/repo';
const target = '/repo/.agents/worktrees/feature';

function worktree(overrides: Partial<Worktree> = {}): Worktree {
    return {
        path: target,
        head: 'head',
        branch: 'feat/work',
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
        ...overrides,
    };
}

type FakePruneInput = {
    lanes?: Worktree[];
    currentDirectory?: string;
    active?: string[];
    alive?: boolean;
    dirty?: string[];
    headDate?: string | undefined;
    ignored?: string[];
};

function fakePort(input: FakePruneInput = {}) {
    const deleted: Array<{ lane: string; entry: string }> = [];
    const logs: string[] = [];
    const port: LanePrunePort = {
        worktrees: () => [worktree({ path: root, head: 'root', branch: 'main' }), ...(input.lanes ?? [worktree()])],
        currentDirectory: () => input.currentDirectory ?? root,
        active: (path) => (input.active ?? []).includes(path),
        processAlive: () => input.alive ?? true,
        dirty: (path) => (input.dirty ?? []).includes(path),
        headCommitDate: () => input.headDate,
        ignored: () => input.ignored ?? ['node_modules/', 'target/'],
        deleteEntry: (lane, entry) => {
            deleted.push({ lane, entry });
        },
        log: (message) => {
            logs.push(message);
        },
    };
    return { port, deleted, logs };
}

describe('prune argument parsing', () => {
    it('parses help, fleet, staleness, and single-lane forms', () => {
        expect(parsePruneArgs(['--help'])).toEqual({ mode: 'help' });
        expect(parsePruneArgs(['--all'])).toEqual({ mode: 'fleet' });
        expect(parsePruneArgs(['--stale-days', '7'])).toEqual({ mode: 'fleet', staleDays: 7 });
        expect(parsePruneArgs(['/repo/.agents/worktrees/feature'])).toEqual({
            mode: 'lane',
            target: '/repo/.agents/worktrees/feature',
        });
    });

    it.each([
        ['no arguments', []],
        ['stale-days without a count', ['--stale-days']],
        ['all plus a target', ['--all', '/lane']],
        ['unknown option', ['--everything']],
        ['two positional targets', ['/lane', '/other']],
    ])('refuses %s', (_case, args) => {
        expect(() => parsePruneArgs(args)).toThrow(/usage: pnpm lane:prune/);
    });

    it.each([
        ['zero days', ['--stale-days', '0']],
        ['fractional days', ['--stale-days', '1.5']],
        ['non-numeric days', ['--stale-days', 'week']],
    ])('refuses %s', (_case, args) => {
        expect(() => parsePruneArgs(args)).toThrow(/positive whole number/);
    });
});

describe('lane pruning', () => {
    it('keeps a tracked sentinel when the first ignored pathname starts with a line feed', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-prune-leading-'));
        const lane = join(repository, '.agents/worktrees/feature');
        const protectedDirectory = join(lane, '\ndist');
        const protectedFile = join(protectedDirectory, 'receipt.json');
        const sentinel = join(lane, 'dist/receipt.json');
        const git = (args: string[]) => execFileSync('git', args, { cwd: lane, encoding: 'utf8' }).trim();
        try {
            mkdirSync(protectedDirectory, { recursive: true });
            mkdirSync(join(lane, 'dist'), { recursive: true });
            mkdirSync(join(lane, 'node_modules'), { recursive: true });
            git(['init', '-b', 'main']);
            git(['config', 'user.name', 'Fixture']);
            git(['config', 'user.email', 'fixture@example.com']);
            writeFileSync(join(lane, '.gitignore'), 'receipt.json\nnode_modules/\n');
            writeFileSync(join(protectedDirectory, 'keep.txt'), 'tracked sibling\n');
            writeFileSync(protectedFile, 'must survive\n');
            writeFileSync(sentinel, 'tracked sentinel\n');
            writeFileSync(join(lane, 'node_modules/output.js'), 'disposable\n');
            git(['add', '-f', '.gitignore', '\ndist/keep.txt', 'dist/receipt.json']);
            git(['commit', '-m', 'fixture']);

            const ignored = shellPort().ignored(lane);
            const deleted: string[] = [];
            const { port } = fakePort();
            const safePort: LanePrunePort = {
                ...port,
                worktrees: () => [
                    worktree({ path: repository, branch: 'main' }),
                    worktree({ path: lane, locked: true, lockReason: AUTHOR_LOCK_REASON }),
                ],
                currentDirectory: () => repository,
                ignored: () => ignored,
                deleteEntry: (owner, entry) => {
                    expect(owner).toBe(lane);
                    deleted.push(entry);
                    rmSync(resolve(owner, entry), { recursive: true, force: true });
                },
            };

            pruneTarget(lane, safePort);

            expect(existsSync(sentinel)).toBe(true);
            expect(existsSync(protectedFile)).toBe(true);
            expect(deleted).toEqual(['node_modules/']);
            expect(existsSync(join(lane, 'node_modules'))).toBe(false);
            expect(ignored).toContain('\ndist/receipt.json');
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('deletes exactly the disposable ignored artifacts and nothing else', () => {
        const { port, deleted } = fakePort({
            ignored: [
                'node_modules/',
                'target/',
                'dist/assets.js',
                'coverage/lcov.info',
                'playwright-report/index.html',
                'test-results/run.json',
                '.DS_Store',
                '.agents/ui-scripts/shot.png',
                '.env',
                'electron/out/main.js',
                'release/desktop/Sourdaw.zip',
                '.vscode/settings.json',
                'release/open-source-inventory.json',
                'release/desktop-runtime-material.json',
            ],
        });

        pruneTarget(target, port);

        expect(deleted).toEqual([
            { lane: target, entry: 'node_modules/' },
            { lane: target, entry: 'target/' },
            { lane: target, entry: 'dist/assets.js' },
            { lane: target, entry: 'coverage/lcov.info' },
            { lane: target, entry: 'playwright-report/index.html' },
            { lane: target, entry: 'test-results/run.json' },
            { lane: target, entry: '.DS_Store' },
            { lane: target, entry: '.agents/ui-scripts/shot.png' },
            { lane: target, entry: 'electron/out/main.js' },
            { lane: target, entry: 'release/desktop/Sourdaw.zip' },
        ]);
    });

    it.each([
        ['primary checkout', root, {}, /refusing to prune the primary/],
        [
            'agent root',
            `${root}/.agents/worktrees`,
            { lanes: [worktree({ path: `${root}/.agents/worktrees` })] },
            /not an agent/,
        ],
        ['unregistered path', '/tmp/feature', { lanes: [worktree({ path: '/tmp/feature' })] }, /not an agent worktree/],
        ['active worktree', target, { currentDirectory: `${target}/scripts` }, /active worktree/],
        ['busy in another process', target, { active: [target] }, /active in another process/],
        ['dirty', target, { dirty: [target] }, /dirty/],
        ['bare', target, { lanes: [worktree({ bare: true })] }, /bare/],
        ['prunable', target, { lanes: [worktree({ prunable: true })] }, /prunable/],
        [
            'removal in flight',
            target,
            { lanes: [worktree({ locked: true, lockReason: 'lane-remove:2147483647' })] },
            /removal is in flight/,
        ],
        ['foreign lock', target, { lanes: [worktree({ locked: true, lockReason: 'shared' })] }, /locked or shared/],
    ])('refuses to prune a %s', (_case, path, input, message) => {
        const { port, deleted } = fakePort(input);

        expect(() => pruneTarget(path, port)).toThrow(message);
        expect(deleted, 'a refused lane lost artifacts anyway').toEqual([]);
    });

    it('prunes author-locked lanes and lanes with only a stale removal lock', () => {
        const authorLocked = fakePort({ lanes: [worktree({ locked: true, lockReason: AUTHOR_LOCK_REASON })] });
        pruneTarget(target, authorLocked.port);
        expect(authorLocked.deleted.length).toBe(2);

        const staleRemovalLock = fakePort({
            lanes: [worktree({ locked: true, lockReason: 'lane-remove:2147483647' })],
            alive: false,
        });
        pruneTarget(target, staleRemovalLock.port);
        expect(staleRemovalLock.deleted.length).toBe(2);
    });

    it('applies --stale-days against the lane HEAD commit date', () => {
        const fresh = fakePort({ headDate: new Date().toISOString() });
        expect(() => pruneTarget(target, fresh.port, 7)).toThrow(/newer than 7 days/);
        expect(fresh.deleted).toEqual([]);

        const idle = fakePort({ headDate: new Date(Date.now() - 30 * 86_400_000).toISOString() });
        pruneTarget(target, idle.port, 7);
        expect(idle.deleted.length).toBe(2);
    });

    it('treats an unreadable or missing commit date as not stale', () => {
        expect(isStale(undefined, 7)).toBe(false);
        expect(isStale('', 7)).toBe(false);
        expect(isStale('not-a-date', 7)).toBe(false);
    });

    it('reports lock refusals for direct inspection', () => {
        expect(laneLockRefusal(worktree(), () => true)).toBeUndefined();
        expect(laneLockRefusal(worktree({ locked: true, lockReason: AUTHOR_LOCK_REASON }), () => true)).toBeUndefined();
        expect(laneLockRefusal(worktree({ locked: true, lockReason: 'lane-remove:5' }), () => false)).toBeUndefined();
        expect(laneLockRefusal(worktree({ locked: true, lockReason: 'lane-remove:5' }), () => true)).toMatch(
            /removal is in flight/
        );
        expect(laneLockRefusal(worktree({ locked: true, lockReason: 'shared' }), () => false)).toMatch(
            /locked or shared/
        );
    });
});

describe('fleet pruning', () => {
    const idle = '/repo/.agents/worktrees/idle';
    const busy = '/repo/.agents/worktrees/busy';
    const elsewhere = '/elsewhere';

    function fleetPort() {
        return fakePort({
            lanes: [
                worktree({ path: idle }),
                worktree({ path: busy }),
                worktree({ path: elsewhere, branch: 'other/work' }),
            ],
            dirty: [busy],
        });
    }

    it('prunes every clean lane and reports refusals without stopping the sweep', () => {
        const { port, deleted, logs } = fleetPort();

        const outcome = pruneFleet(port);

        expect(outcome.pruned).toEqual([idle]);
        expect(outcome.refused).toEqual([{ lane: busy, reason: 'worktree is dirty' }]);
        expect(deleted.map((entry) => entry.lane)).toEqual([idle, idle]);
        expect(logs).toContainEqual(expect.stringMatching(/refused .*busy.*dirty/));
    });

    it('never visits the primary checkout or worktrees outside the agent root', () => {
        const { port, deleted } = fleetPort();

        const outcome = pruneFleet(port);

        expect(deleted.some((entry) => entry.lane === root || entry.lane === elsewhere)).toBe(false);
        expect(outcome.refused.some((refusal) => refusal.lane === root || refusal.lane === elsewhere)).toBe(false);
    });
});

describe('prune shell boundary', () => {
    it('lists ignored artifacts byte-faithfully and reads the HEAD commit date', () => {
        const captures: Array<{ command: string; args: string[] }> = [];
        const shell = {
            capture: (command: string, args: string[]) => {
                captures.push({ command, args });
                if (command === 'ps') {
                    return `${process.pid} ${process.getuid?.()}`;
                }
                if (command === 'lsof') {
                    return `p${process.pid}\0\nfcwd\0tDIR\0n${target}\0\n`;
                }
                if (args[0] === 'worktree') {
                    return '';
                }
                if (args.includes('--format=%cI')) {
                    return '2026-08-01T00:00:00+00:00';
                }
                if (args.includes('ls-files')) {
                    return 'node_modules/\0target/\0';
                }
                throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
            },
        };
        const port = shellPort(shell);

        expect(port.headCommitDate(target)).toBe('2026-08-01T00:00:00+00:00');
        expect(port.ignored(target)).toEqual(['node_modules/', 'target/']);
        expect(port.active(target)).toBe(true);
        expect(
            captures.some(
                (entry) => entry.command === 'git' && entry.args.includes('-z') && entry.args.includes('ls-files')
            )
        ).toBe(true);
    });
});

describe('prune capture', () => {
    it('returns output larger than the default spawnSync buffer', () => {
        const output = capture(process.execPath, ['-e', 'process.stdout.write("x".repeat(3 * 1024 * 1024))']);

        expect(output).toHaveLength(3 * 1024 * 1024);
    });
});

describe('prune lane-in-use detection', () => {
    const uid = process.getuid?.();
    // The census lane removal trusts: a same-user process list and a NUL-framed per-user lsof catalog.
    const portWithCensus = (lsof: string, ps = `${process.pid} ${uid}\n999 ${uid}`) => {
        const lsofCalls: string[][] = [];
        const port = shellPort({
            capture: (command: string, args: string[]) => {
                if (command === 'ps') {
                    return ps;
                }
                if (command === 'lsof') {
                    lsofCalls.push(args);
                    return lsof;
                }
                throw new Error(`unexpected capture: ${command}`);
            },
        });
        return { port, lsofCalls };
    };

    it('treats a lane as in use when another process holds a file open under it from elsewhere', () => {
        const { port, lsofCalls } = portWithCensus(
            `p999\0\nfcwd\0tDIR\0n/elsewhere/build\0\nf12\0tREG\0n${target}/target/debug/deps/lib.rlib\0\n`
        );

        expect(port.active(target)).toBe(true);
        expect(lsofCalls[0]).toEqual(['-nP', '-a', '-u', String(uid), '-F0pftn']);
    });

    it('proves a lane idle only from a complete same-user census', () => {
        const { port } = portWithCensus(
            `p${process.pid}\0\nfcwd\0tDIR\0n/elsewhere/build\0\np999\0\nf3\0tREG\0n${target}-sibling/file\0\n`
        );

        expect(port.active(target)).toBe(false);
    });

    it('refuses to call a lane idle when the open-file census is incomplete', () => {
        const { port } = portWithCensus(`p999\nfcwd\nn/elsewhere/build`);

        expect(() => port.active(target)).toThrow('open-file inspection was incomplete');
    });

    it('refuses to call a lane idle when the census omits a live same-user process', () => {
        const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)']);
        try {
            const { port } = portWithCensus(
                `p${process.pid}\0\nfcwd\0tDIR\0n/elsewhere\0\n`,
                `${process.pid} ${uid}\n${live.pid} ${uid}`
            );

            expect(() => port.active(target)).toThrow('open-file inspection omitted a live process');
        } finally {
            live.kill('SIGKILL');
        }
    });
});

describe('prune fleet path identity', () => {
    it('canonicalizes symlinked worktree paths so a busy lane reached through an alias is refused', () => {
        const repository = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-lane-prune-alias-')));
        const aliasParent = mkdtempSync(join(tmpdir(), 'sourdaw-lane-prune-alias-link-'));
        const alias = join(aliasParent, 'repository');
        const lane = join(repository, '.agents/worktrees/feature');
        const uid = process.getuid?.();
        try {
            mkdirSync(join(lane, 'node_modules'), { recursive: true });
            symlinkSync(repository, alias, 'dir');
            const aliasedLane = join(alias, '.agents/worktrees/feature');
            const visited: string[] = [];
            const port = shellPort({
                capture: (command: string, args: string[]) => {
                    if (command === 'ps') {
                        return `${process.pid} ${uid}\n999 ${uid}`;
                    }
                    if (command === 'lsof') {
                        // lsof reports the real path of the build's open file, never git's alias.
                        return `p${process.pid}\0\nfcwd\0tDIR\0n/elsewhere\0\np999\0\nf12\0tREG\0n${lane}/node_modules/x\0\n`;
                    }
                    if (args[0] === 'worktree') {
                        return (
                            `worktree ${alias}\0HEAD root\0branch refs/heads/main\0\0` +
                            `worktree ${aliasedLane}\0HEAD head\0branch refs/heads/feat/work\0\0`
                        );
                    }
                    if (args.includes('status')) {
                        visited.push(args[1] ?? '');
                        return '';
                    }
                    if (args.includes('ls-files')) {
                        return 'node_modules/\0';
                    }
                    throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
                },
            });

            expect(port.worktrees().map((worktree) => worktree.path)).toEqual([repository, lane]);
            const outcome = pruneFleet({ ...port, log: () => undefined });

            expect(outcome).toEqual({
                pruned: [],
                refused: [{ lane, reason: 'worktree is active in another process' }],
            });
            expect(existsSync(join(lane, 'node_modules'))).toBe(true);
            expect(visited).toEqual([]);
        } finally {
            rmSync(aliasParent, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });
});

describe('prunes a real worktree without touching credentials', () => {
    it('keeps a wholly ignored dist/ that holds a credential under this repository ignore rules', () => {
        const repository = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-lane-prune-ignored-dist-')));
        const lane = join(repository, '.agents/worktrees/feature');
        const git = (args: string[], cwd = repository) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
        try {
            git(['init', '-b', 'main']);
            git(['config', 'user.name', 'Fixture']);
            git(['config', 'user.email', 'fixture@example.com']);
            writeFileSync(join(repository, '.gitignore'), 'dist/\n.env\n.env.*\nnode_modules\n');
            writeFileSync(join(repository, 'tracked.txt'), 'fixture\n');
            git(['add', '.']);
            git(['commit', '-m', 'fixture']);
            mkdirSync(join(repository, '.agents/worktrees'), { recursive: true });
            git(['worktree', 'add', lane, '-b', 'feat/work']);
            mkdirSync(join(lane, 'dist'));
            writeFileSync(join(lane, 'dist/.env'), 'SECRET=keep\n');
            writeFileSync(join(lane, 'dist/bundle.js'), 'generated\n');
            mkdirSync(join(lane, 'node_modules/pkg'), { recursive: true });
            writeFileSync(join(lane, 'node_modules/pkg/index.js'), 'generated\n');
            const port: LanePrunePort = {
                ...shellPort(),
                worktrees: () => parseWorktrees(git(['worktree', 'list', '--porcelain', '-z'])),
                currentDirectory: () => repository,
                active: () => false,
                log: () => undefined,
            };

            expect(pruneTarget(lane, port)).toEqual(['node_modules/']);

            expect(readFileSync(join(lane, 'dist/.env'), 'utf8')).toBe('SECRET=keep\n');
            expect(existsSync(join(lane, 'dist/bundle.js'))).toBe(true);
            expect(existsSync(join(lane, 'node_modules'))).toBe(false);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('deletes build output beside an ignored credential inside a build-product directory but keeps the credential', () => {
        const repository = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-lane-prune-credential-')));
        const lane = join(repository, '.agents/worktrees/feature');
        const git = (args: string[], cwd = repository) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
        try {
            git(['init', '-b', 'main']);
            git(['config', 'user.name', 'Fixture']);
            git(['config', 'user.email', 'fixture@example.com']);
            writeFileSync(join(repository, '.gitignore'), '.env\ndist/*.js\n');
            mkdirSync(join(repository, 'dist'));
            writeFileSync(join(repository, 'dist/README.md'), 'tracked\n');
            git(['add', '.']);
            git(['commit', '-m', 'fixture']);
            mkdirSync(join(repository, '.agents/worktrees'), { recursive: true });
            git(['worktree', 'add', lane, '-b', 'feat/work']);
            writeFileSync(join(lane, 'dist/.env'), 'SECRET=keep\n');
            writeFileSync(join(lane, 'dist/bundle.js'), 'generated\n');
            const port: LanePrunePort = {
                ...shellPort(),
                worktrees: () => parseWorktrees(git(['worktree', 'list', '--porcelain', '-z'])),
                currentDirectory: () => repository,
                active: () => false,
                log: () => undefined,
            };
            expect(port.ignored(lane).sort()).toEqual(['dist/.env', 'dist/bundle.js']);

            expect(pruneTarget(lane, port)).toEqual(['dist/bundle.js']);

            expect(readFileSync(join(lane, 'dist/.env'), 'utf8')).toBe('SECRET=keep\n');
            expect(existsSync(join(lane, 'dist/bundle.js'))).toBe(false);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });
});

describe('prunes a real worktree without touching git state', () => {
    it('removes only ignored artifacts and leaves the worktree registered and locked', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-prune-'));
        const lane = join(repository, '.agents/worktrees/feature');
        const git = (args: string[], cwd = repository) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
        try {
            git(['init', '-b', 'main']);
            git(['config', 'user.name', 'Fixture']);
            git(['config', 'user.email', 'fixture@example.com']);
            writeFileSync(
                join(repository, '.gitignore'),
                '*.json\nnode_modules/\ntarget/\ndist/\n.env\nelectron/out/\nrelease/desktop/\n'
            );
            writeFileSync(join(repository, 'tracked.txt'), 'fixture\n');
            mkdirSync(join(repository, 'release'), { recursive: true });
            writeFileSync(join(repository, 'release/desktop-runtime-material.json'), '{}\n');
            git(['add', '-f', '.']);
            git(['commit', '-m', 'fixture']);
            mkdirSync(join(repository, '.agents/worktrees'), { recursive: true });
            git(['worktree', 'add', lane, '-b', 'feat/work']);
            git(['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, lane]);
            const resolvedLane = realpathSync(lane);
            const port: LanePrunePort = {
                worktrees: () => parseWorktrees(git(['worktree', 'list', '--porcelain', '-z'])),
                currentDirectory: () => repository,
                active: () => false,
                processAlive: () => true,
                dirty: (path) => git(['status', '--porcelain=v1', '--untracked-files=all'], path) !== '',
                headCommitDate: (path) => git(['log', '-1', '--format=%cI'], path),
                ignored: (path) =>
                    git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], path)
                        .split('\0')
                        .filter((entry) => entry !== ''),
                deleteEntry: (owner, entry) => {
                    rmSync(resolve(owner, entry), { recursive: true, force: true });
                },
                log: () => undefined,
            };
            mkdirSync(join(lane, 'node_modules/pkg'), { recursive: true });
            writeFileSync(join(lane, 'node_modules/pkg/data'), 'generated\n');
            mkdirSync(join(lane, 'target/debug'), { recursive: true });
            writeFileSync(join(lane, 'target/debug/lib.rlib'), 'generated\n');
            mkdirSync(join(lane, 'dist'), { recursive: true });
            writeFileSync(join(lane, 'dist/app.js'), 'generated\n');
            mkdirSync(join(lane, 'electron/out'), { recursive: true });
            writeFileSync(join(lane, 'electron/out/main.js'), 'generated\n');
            mkdirSync(join(lane, 'release/desktop'), { recursive: true });
            writeFileSync(join(lane, 'release/desktop/Sourdaw.zip'), 'generated\n');
            writeFileSync(join(lane, '.env'), 'SECRET=keep\n');
            writeFileSync(join(lane, 'node_modules\\receipt.json'), 'user data\n');

            const deleted = pruneTarget(resolvedLane, port);

            expect(existsSync(join(lane, 'node_modules\\receipt.json'))).toBe(true);
            expect(deleted).toEqual(['dist/', 'electron/out/', 'node_modules/', 'release/desktop/', 'target/']);
            expect(existsSync(join(lane, 'node_modules'))).toBe(false);
            expect(existsSync(join(lane, 'target'))).toBe(false);
            expect(existsSync(join(lane, 'dist'))).toBe(false);
            expect(existsSync(join(lane, 'electron/out'))).toBe(false);
            expect(existsSync(join(lane, 'release/desktop'))).toBe(false);
            expect(existsSync(join(lane, '.env'))).toBe(true);
            expect(existsSync(join(lane, 'tracked.txt'))).toBe(true);
            expect(existsSync(join(lane, 'release/desktop-runtime-material.json'))).toBe(true);
            // Pruning never touches git state: the lane stays registered, author-locked, and clean.
            const state = git(['worktree', 'list', '--porcelain']);
            expect(state).toContain(resolvedLane);
            expect(state).toContain(`locked ${AUTHOR_LOCK_REASON}`);
            expect(git(['status', '--porcelain=v1', '--untracked-files=all'], resolvedLane)).toBe('');
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });
});

describe('prune source trust', () => {
    const sourceRoot = resolve(import.meta.dirname, '../..');
    const approved = (path: string) => readFileSync(join(sourceRoot, path), 'utf8');

    it('reads every file in the prune import closure, the removal contract included', () => {
        const read: string[] = [];
        assertTrustedClosure(
            'scripts/pruneLane.ts',
            (path) => {
                read.push(path);
                return approved(path);
            },
            approved
        );

        expect(read).toEqual(
            expect.arrayContaining(['scripts/pruneLane.ts', 'scripts/removeLane.ts', 'scripts/laneActivity.ts'])
        );
    });

    it('refuses a mutated removal script inside the prune closure', () => {
        expect(() =>
            assertTrustedClosure(
                'scripts/pruneLane.ts',
                (path) => (path === 'scripts/removeLane.ts' ? `${approved(path)}\n// mutated\n` : approved(path)),
                approved
            )
        ).toThrow('scripts/removeLane.ts does not match origin/main; refusing to run a mutated copy');
    });
});
