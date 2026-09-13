import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
    laneDirectoryName,
    openLane,
    parseOpenLaneArgs,
    runCli,
    shellCli,
    shellPort,
    type OpenLaneCli,
    type OpenLanePort,
} from '../openLane.ts';
import { laneBranchName } from '../prContract.ts';
import { readLaneStack, writeLaneStack } from '../stackedLanes.ts';

/**
 * `lane:open` is the one delivery script that must never touch GitHub: it runs before the issue
 * exists and before any credential is minted. Two separate claims back that, and each needs its
 * own proof.
 *
 * The first claim is narrow: `openLane`'s own body only ever calls the methods on its injected
 * `OpenLanePort` — it holds no other route out. Driving it through `runCli` with a port built
 * entirely of fakes (`fakeCli`/`fakePort`) proves exactly that, and nothing broader: a fake port
 * cannot demonstrate that the *real* port stays offline, because the fake never reaches
 * `child_process` in the first place, guard or no guard.
 *
 * The second claim is the one that actually matters for the shipped binary: the real default
 * `shellCli` — `verifyTrustedBlob` and `createPort`, both wired to the real `spawnCapture`/
 * `spawnRun` — never reaches `gh`. That can only be shown by driving `runCli` with the unmodified
 * `shellCli`, which is what `'runCli reaches only git, never gh, when driven with the real default
 * shellCli'` below does. `vi.mock('node:child_process')` is not how that test gets its
 * interception: it does not intercept a module under `scripts/`, and the sibling spec that trusted
 * it to fake `gh` ran the real `gh issue create` and filed a live issue on the public tracker.
 *
 * The interception that does work is this recorder. The transformed imports snapshot each spawn
 * entry off the builtin module object when the module is first imported, so an interceptor
 * installed later is read by nobody — it has to be in place before the imports, which is what
 * `vi.hoisted` is for. What it installs is a permanent dispatcher that passes straight through, and
 * `record` switches it to recording — and throwing on every call — only for the body of one test.
 * That throw is what keeps the real-`shellCli` test safe to run anywhere: it fires before the real
 * `spawnSync` ever executes, so nothing is actually spawned, no worktree is actually created, and
 * the assertion holds regardless of the local repo's relationship to `origin/main`. `afterAll` puts
 * the untouched builtin back, because it is shared with every other spec in this worker.
 */
const { spawnRecorder } = vi.hoisted(() => {
    const apis = ['exec', 'execFile', 'execFileSync', 'execSync', 'fork', 'spawn', 'spawnSync'] as const;
    const childProcess = process.getBuiltinModule('node:child_process') as unknown as Record<string, unknown>;
    const originals = apis.map((api) => [api, childProcess[api] as (...args: unknown[]) => unknown] as const);
    let recording: string[] | undefined;
    for (const [api, original] of originals) {
        childProcess[api] = (...args: unknown[]) => {
            if (recording === undefined) {
                return original(...args);
            }
            recording.push(`${api}:${String(args[0])}`);
            throw new Error(`lane:open reached ${api}(${String(args[0])})`);
        };
    }
    return {
        spawnRecorder: {
            record<Result>(body: (spawned: string[]) => Result): Result {
                const spawned: string[] = [];
                recording = spawned;
                try {
                    return body(spawned);
                } finally {
                    recording = undefined;
                }
            },
            restore() {
                for (const [api, original] of originals) {
                    childProcess[api] = original;
                }
            },
        },
    };
});

afterAll(() => {
    spawnRecorder.restore();
});

function fakeCli(port: OpenLanePort): OpenLaneCli {
    return { verifyTrustedBlob: () => undefined, createPort: () => port };
}

function fakePort(exists = false, nodeModulesLinkTarget?: (lanePath: string) => string | undefined) {
    const calls: string[] = [];
    const logs: string[] = [];
    const port: OpenLanePort = {
        primaryRoot: () => '/repo',
        pathExists: () => exists,
        assertUnusedStackNamespace: () => undefined,
        ensureWorktreeParent: (path) => calls.push(`mkdir:${path}`),
        fetchMain: () => calls.push('fetch'),
        worktreeAdd: (path, branch) => calls.push(`add:${path}:${branch}`),
        reserveStackBranch: (branch, head) => {
            calls.push(`reserve:${branch}:${head}`);
        },
        nodeModulesLinkTarget: nodeModulesLinkTarget ?? (() => undefined),
        lock: (path) => calls.push(`lock:${path}`),
        log: (message) => logs.push(message),
    };
    return { port, calls, logs };
}

const scratchRoots: string[] = [];
afterEach(() => {
    for (const root of scratchRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function creationFixture(beforeRun: (args: string[], git: (...args: string[]) => string) => void = () => undefined) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-stack-open-')));
    scratchRoots.push(root);
    const gitAt = (cwd: string, args: string[]) =>
        execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            env: {
                ...process.env,
                GIT_CONFIG_GLOBAL: '/dev/null',
                GIT_CONFIG_NOSYSTEM: '1',
                GIT_AUTHOR_NAME: 'Fixture',
                GIT_AUTHOR_EMAIL: 'fixture@example.test',
                GIT_COMMITTER_NAME: 'Fixture',
                GIT_COMMITTER_EMAIL: 'fixture@example.test',
            },
        }).trim();
    const git = (...args: string[]) => gitAt(root, args);
    git('init', '-b', 'main');
    writeFileSync(join(root, '.gitignore'), '.agents/\n');
    git('add', '.');
    git('commit', '-m', 'chore: base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const parentPath = join(root, '.agents', 'worktrees', 'parent');
    git('worktree', 'add', '-b', 'agent/parent', parentPath);
    writeFileSync(join(parentPath, 'parent'), 'parent\n');
    gitAt(parentPath, ['add', '.']);
    gitAt(parentPath, ['commit', '-m', 'feat: parent']);
    git('worktree', 'lock', '--reason', 'active:sourdaw-author', parentPath);
    const head = gitAt(parentPath, ['rev-parse', 'HEAD']);
    const writes: string[][] = [];
    const port = shellPort(
        (_command, args, options) => gitAt(options?.cwd ?? root, args),
        (_command, args, options) => {
            writes.push(args);
            beforeRun(args, git);
            if (args[0] !== 'fetch') {
                gitAt(options?.cwd ?? root, args);
            }
        },
        root
    );
    port.log = () => undefined;
    return { root, git, parentPath, head, port, writes };
}

describe('real Git stack creation reservation', () => {
    it('leaves an existing foreign branch and its metadata untouched', () => {
        const f = creationFixture();
        const foreign = join(f.root, '.agents', 'worktrees', 'foreign');
        f.git('worktree', 'add', '-b', 'agent/collision', foreign, 'main');
        f.git('worktree', 'lock', '--reason', 'active:sourdaw-author', foreign);
        const config = readFileSync(join(f.root, '.git', 'config'));
        const oldHead = f.git('rev-parse', 'agent/collision');
        expect(() => openLane(undefined, 'collision', f.port, f.parentPath)).toThrow();
        expect(readLaneStack(f.root, 'agent/collision')).toBeUndefined();
        expect(readFileSync(join(f.root, '.git', 'config'))).toEqual(config);
        expect(f.git('rev-parse', 'agent/collision')).toBe(oldHead);
    });

    it.each(['descriptor', 'marker'])('refuses retained %s evidence for ordinary and stacked opens', (kind) => {
        for (const stacked of [false, true]) {
            const f = creationFixture();
            if (kind === 'descriptor') {
                writeLaneStack(f.root, {
                    version: 1,
                    childBranch: 'agent/retired',
                    parentBranch: 'agent/parent',
                    forkHead: f.head,
                    parentHead: f.head,
                });
            } else {
                f.git('config', 'branch.agent/retired.sourdaw-stack-fork', f.head);
            }
            const config = readFileSync(join(f.root, '.git', 'config'));
            const previous = readLaneStack(f.root, 'agent/retired');
            const directory = join(f.root, '.agents', 'lane-stacks');
            const readEvidence = () => {
                if (!existsSync(directory)) {
                    return [];
                }
                return readdirSync(directory).map((file) => readFileSync(join(directory, file)));
            };
            const bytes = readEvidence();
            expect(() => openLane(undefined, 'retired', f.port, stacked ? f.parentPath : undefined)).toThrow(
                /choose a new slug/
            );
            expect(f.writes).toEqual([]);
            expect(readFileSync(join(f.root, '.git', 'config'))).toEqual(config);
            expect(readLaneStack(f.root, 'agent/retired')).toEqual(previous);
            expect(readEvidence()).toEqual(bytes);
            expect(
                spawnSync('git', ['rev-parse', '--verify', 'refs/heads/agent/retired'], { cwd: f.root }).status
            ).not.toBe(0);
        }
    });

    it('refuses a branch that appears at reservation without registering it', () => {
        const f = creationFixture((args, git) => {
            if (args[0] === 'branch' && args[1] === 'agent/race') {
                git('branch', 'agent/race', 'main');
            }
        });
        expect(() => openLane(undefined, 'race', f.port, f.parentPath)).toThrow();
        expect(readLaneStack(f.root, 'agent/race')).toBeUndefined();
        expect(f.git('config', '--get', '--default', '', 'branch.agent/race.sourdaw-stack-fork')).toBe('');
        expect(f.git('rev-parse', 'agent/race')).toBe(f.git('rev-parse', 'main'));
    });

    it('reserves then registers then creates the exact locked stack head', () => {
        const f = creationFixture();
        const lane = openLane(undefined, 'child', f.port, f.parentPath);
        const reserve = f.writes.findIndex((args) => args[0] === 'branch');
        const marker = f.writes.findIndex((args) => args[0] === 'config');
        const add = f.writes.findIndex((args) => args[0] === 'worktree' && args[1] === 'add');
        expect(reserve).toBeGreaterThanOrEqual(0);
        expect(reserve).toBeLessThan(marker);
        expect(marker).toBeLessThan(add);
        expect(f.writes[add]).toEqual(['worktree', 'add', lane, 'agent/child']);
        expect(f.git('rev-parse', 'agent/child')).toBe(f.head);
        expect(readLaneStack(f.root, 'agent/child')?.forkHead).toBe(f.head);
        const created = f
            .git('worktree', 'list', '--porcelain', '-z')
            .split('\0\0')
            .find((record) => record.startsWith(`worktree ${lane}\0`));
        expect(created).toContain('branch refs/heads/agent/child');
        expect(created).toContain('locked active:sourdaw-author');
    });

    it.each(['save', 'worktree'])('retains an explicit reserved branch after %s failure', (stage) => {
        const f = creationFixture((args) => {
            if (stage === 'worktree' && args[0] === 'worktree' && args[1] === 'add') {
                throw new Error('fixture worktree failure');
            }
        });
        if (stage === 'save') {
            f.port.saveStack = () => {
                throw new Error('fixture save failure');
            };
        }
        expect(() => openLane(undefined, 'partial', f.port, f.parentPath)).toThrow(/reserved branch agent\/partial/);
        expect(f.git('rev-parse', 'agent/partial')).toBe(f.head);
        expect(existsSync(join(f.root, '.agents', 'worktrees', 'agent--partial'))).toBe(false);
        if (stage === 'worktree') {
            expect(readLaneStack(f.root, 'agent/partial')?.forkHead).toBe(f.head);
        }
    });
});

describe('lane open', () => {
    it('accepts an explicit absolute parent selector without treating it as a slug', () => {
        expect(parseOpenLaneArgs(['child', '--stack-on', '/repo/.agents/worktrees/agent--parent'])).toEqual({
            slug: 'child',
            help: false,
            stackOn: '/repo/.agents/worktrees/agent--parent',
        });
        expect(() => parseOpenLaneArgs(['child', '--stack-on', '../parent'])).toThrow(/absolute/);
    });

    it('records stack intent before creating the child at the exact parent head', () => {
        const { port, calls } = fakePort();
        const head = 'a'.repeat(40);
        port.stackParent = (path, branch) => {
            expect(path).toBe('/repo/parent');
            return { version: 1, childBranch: branch, parentBranch: 'agent/parent', forkHead: head, parentHead: head };
        };
        port.saveStack = () => {
            calls.push('descriptor');
        };
        port.worktreeAdd = (_path, _branch, reservedBranch) => {
            calls.push(`reserved:${reservedBranch}`);
        };
        openLane(undefined, 'child', port, '/repo/parent');
        expect(calls).toContain(`reserve:agent/child:${head}`);
        expect(calls.indexOf('descriptor')).toBeLessThan(calls.indexOf('reserved:true'));
        expect(calls.at(-1)).toBe('lock:/repo/.agents/worktrees/agent--child');
    });

    it('refuses parent validation or descriptor persistence failures before creating a child', () => {
        const { port, calls } = fakePort();
        port.stackParent = () => {
            throw new Error('dirty parent');
        };
        expect(() => openLane(undefined, 'child', port, '/repo/parent')).toThrow(/dirty parent/);
        expect(calls.some((call) => call.startsWith('add:'))).toBe(false);
        port.stackParent = (_path, childBranch) => ({
            version: 1,
            childBranch,
            parentBranch: 'agent/parent',
            forkHead: 'a'.repeat(40),
            parentHead: 'a'.repeat(40),
        });
        port.saveStack = () => {
            throw new Error('descriptor write failed');
        };
        expect(() => openLane(undefined, 'child', port, '/repo/parent')).toThrow(/descriptor write failed/);
        expect(calls.some((call) => call.startsWith('add:'))).toBe(false);
    });

    it('creates a locked worktree from origin/main after fetch', () => {
        const { port, calls, logs } = fakePort();

        const path = openLane(12, 'work', port);

        expect(path).toBe('/repo/.agents/worktrees/agent-12-work');
        expect(calls.indexOf('fetch')).toBeLessThan(calls.findIndex((call) => call.startsWith('add:')));
        expect(calls).toContain('add:/repo/.agents/worktrees/agent-12-work:agent/12/work');
        expect(calls).toContain('lock:/repo/.agents/worktrees/agent-12-work');
        expect(logs.at(-1)).toBe(path);
        expect(calls.some((call) => call.includes('gh'))).toBe(false);
    });

    it('uses the provided slug instead of work', () => {
        const { port, calls } = fakePort();

        openLane(12, 'beat', port);

        expect(calls).toContain('add:/repo/.agents/worktrees/agent-12-beat:agent/12/beat');
    });

    it('creates an issueless lane without an issue segment', () => {
        const { port, calls, logs } = fakePort();

        const path = openLane(undefined, 'cleanup', port);

        expect(path).toBe('/repo/.agents/worktrees/agent--cleanup');
        expect(calls).toContain('add:/repo/.agents/worktrees/agent--cleanup:agent/cleanup');
        expect(calls).toContain('lock:/repo/.agents/worktrees/agent--cleanup');
        expect(logs.at(-1)).toBe(path);
    });

    it('gives an issue lane and an issueless lane different directories', () => {
        expect(laneBranchName(12, 'beat')).toBe('agent/12/beat');
        expect(laneBranchName(undefined, '12-beat')).toBe('agent/12-beat');
        expect(laneDirectoryName(12, 'beat')).toBe('agent-12-beat');
        expect(laneDirectoryName(undefined, '12-beat')).toBe('agent--12-beat');
        expect(laneDirectoryName(undefined, '12-beat')).not.toBe(laneDirectoryName(12, 'beat'));
    });

    /**
     * The recorder is worth nothing unless it intercepts, and a guard that quietly stopped
     * intercepting is the exact defect this one replaces. So it proves itself against a deliberate
     * benign spawn before the offline claim below is allowed to rest on it.
     */
    it('records a spawn, so the offline claim is able to fail', () => {
        const spawned = spawnRecorder.record((recorded) => {
            expect(() => spawnSync('echo', ['probe'])).toThrow(/lane:open reached spawnSync\(echo\)/);
            return recorded;
        });

        expect(spawned).toEqual(['spawnSync:echo']);
    });

    /**
     * This proves only that `openLane`'s own body reaches no child process independently of its
     * port: `fakeCli` replaces both `verifyTrustedBlob` and `createPort`, so nothing here exercises
     * the real `shellCli` — see the real-wiring test below for that claim.
     */
    it("openLane's own body reaches no child process, independent of what its port does", () => {
        const { port, calls, logs } = fakePort();

        // `runCli` reports a spawn that threw as exit 1, so the recording is asserted first: it
        // names the command that got out, where the exit code only says something went wrong.
        let code = -1;
        const spawned = spawnRecorder.record((recorded) => {
            code = runCli(['cleanup'], fakeCli(port), '/repo');
            return recorded;
        });

        expect(spawned).toEqual([]);
        expect(code).toBe(0);
        expect(calls).toEqual([
            'mkdir:/repo/.agents/worktrees/agent--cleanup',
            'fetch',
            'add:/repo/.agents/worktrees/agent--cleanup:agent/cleanup',
            'lock:/repo/.agents/worktrees/agent--cleanup',
        ]);
        expect(logs.at(-1)).toBe('/repo/.agents/worktrees/agent--cleanup');
    });

    /**
     * This is the claim that actually matters for the shipped binary: driven with the unmodified
     * default `shellCli` (real `verifyTrustedBlob`, real `createPort`, both wired to the real
     * `spawnCapture`/`spawnRun`), `runCli` never asks for `gh`. The recorder throws on the first
     * real `spawnSync` call — the `git cat-file` probe inside `verifyTrustedBlob` — before it can
     * actually execute, so nothing is truly spawned and no worktree is created; `originMainBlob`'s
     * own catch treats that throw the same as "file missing from origin/main" and returns
     * `undefined`, so `verifyTrustedBlob` completes and `runCli` moves on to `createPort`, whose
     * `resolvePrimaryRoot` immediately makes a second real `git rev-parse` call that the recorder
     * also intercepts — this time uncaught, so `runCli` reports exit 1. Every command attempted is
     * named `git`; the assertion holds independent of the local working tree's relationship to
     * `origin/main`, because the interceptor stops both calls before either one truly runs.
     */
    it('runCli reaches only git, never gh, when driven with the real default shellCli', () => {
        let code = -1;
        const spawned = spawnRecorder.record((recorded) => {
            code = runCli(['cleanup'], shellCli, process.cwd());
            return recorded;
        });

        expect(spawned).not.toEqual([]);
        expect(spawned.every((call) => call.startsWith('spawnSync:git'))).toBe(true);
        expect(spawned.some((call) => call.includes('gh'))).toBe(false);
        expect(code).toBe(1);
    });

    /**
     * `openLane` only ever sees the port's method names, so no assertion on it can tell a `git`
     * from a `gh`. The commands themselves are built in `shellPort`, and driving that with fake
     * process runners is what puts the argv that would actually leave the process under assertion.
     */
    it('builds git commands only, never gh', () => {
        const commands: string[][] = [];
        const record = (command: string, args: string[]) => {
            commands.push([command, ...args]);
        };
        const capture = (command: string, args: string[]) => {
            record(command, args);
            return `${process.cwd()}/.git`;
        };
        const run = (command: string, args: string[]) => {
            record(command, args);
        };

        const spawned = spawnRecorder.record((recorded) => {
            const port = shellPort(capture, run, process.cwd());
            port.fetchMain();
            port.worktreeAdd('/repo/.agents/worktrees/agent--cleanup', 'agent/cleanup');
            port.lock('/repo/.agents/worktrees/agent--cleanup');
            return recorded;
        });

        expect(spawned).toEqual([]);
        expect(commands.every(([command]) => command === 'git')).toBe(true);
        expect(commands).toContainEqual(['git', 'fetch', 'origin', 'main']);
        expect(commands).toContainEqual([
            'git',
            'worktree',
            'add',
            '-b',
            'agent/cleanup',
            '/repo/.agents/worktrees/agent--cleanup',
            'origin/main',
        ]);
        expect(commands).toContainEqual([
            'git',
            'worktree',
            'lock',
            '--reason',
            'active:sourdaw-author',
            '/repo/.agents/worktrees/agent--cleanup',
        ]);
    });

    it('does not modify a primary checkout path', () => {
        const { port, calls } = fakePort();

        openLane(1, 'work', port);

        expect(calls.some((call) => call.includes('/repo/.git') || call === 'add:/repo:')).toBe(false);
        expect(calls.every((call) => !call.startsWith('add:/repo:') || call.includes('.agents/worktrees'))).toBe(true);
    });

    it.each([
        [[], { slug: 'work', help: false }],
        [['12'], { issue: 12, slug: 'work', help: false }],
        [['12', 'beat'], { issue: 12, slug: 'beat', help: false }],
        [['beat'], { slug: 'beat', help: false }],
        [['lane-issue-optional'], { slug: 'lane-issue-optional', help: false }],
        [['--help'], { slug: 'work', help: true }],
    ])('parses argv %j', (args, expected) => {
        expect(parseOpenLaneArgs(args)).toEqual(expected);
    });

    it.each([
        [['0'], /purely numeric/],
        [['2206', '12'], /purely numeric/],
        [['12', 'Work'], /slug/],
        [['beat', 'extra'], /unknown option/],
        [['12', 'beat', 'extra'], /unknown option/],
        [['--help', 'beat'], /--help/],
    ])('rejects argv %j before creating a worktree', (args, message) => {
        const { port, calls } = fakePort();

        expect(() => {
            const parsed = parseOpenLaneArgs(args);
            openLane(parsed.issue, parsed.slug, port);
        }).toThrow(message);

        expect(calls).toEqual([]);
    });
});

/**
 * Issue #4118: a lane whose node_modules symlinks into another checkout makes every pnpm run
 * through the link rewrite that checkout's install metadata, and the next pnpm run there aborts
 * every trusted delivery script with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY. lane:open
 * refuses the configuration before locking the lane.
 */
describe('lane open refuses a node_modules symlinked outside the lane', () => {
    it('refuses with the symlink, the target, and the sanctioned route, before the lock', () => {
        const { port, calls } = fakePort(false, () => '/other-checkout/node_modules');

        expect(() => openLane(12, 'work', port)).toThrow(
            /node_modules is a symlink to \/other-checkout\/node_modules, outside the lane[\s\S]*`pnpm install` in \/repo\/\.agents\/worktrees\/agent-12-work/
        );
        expect(calls).toContain('add:/repo/.agents/worktrees/agent-12-work:agent/12/work');
        expect(calls).not.toContain('lock:/repo/.agents/worktrees/agent-12-work');
    });

    it('locks the lane when node_modules is a real directory or absent', () => {
        const { port, calls } = fakePort(false, () => undefined);

        openLane(12, 'work', port);

        expect(calls).toContain('lock:/repo/.agents/worktrees/agent-12-work');
    });

    it('locks the lane when the link resolves inside the lane root', () => {
        const { port, calls } = fakePort(false, () => '/repo/.agents/worktrees/agent-12-work/vendor/store');

        openLane(12, 'work', port);

        expect(calls).toContain('lock:/repo/.agents/worktrees/agent-12-work');
    });
});
