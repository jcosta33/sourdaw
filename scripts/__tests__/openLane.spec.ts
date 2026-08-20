import { spawnSync } from 'node:child_process';

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
    laneDirectoryName,
    openLane,
    parseOpenLaneArgs,
    runCli,
    shellPort,
    type OpenLaneCli,
    type OpenLanePort,
} from '../openLane.ts';
import { laneBranchName } from '../prContract.ts';

/**
 * `lane:open` is the one delivery script that must never touch GitHub: it runs before the issue
 * exists and before any credential is minted. Two separate things enforce that here.
 *
 * The first is the shape of the code. `runCli` takes its git access as a parameter, so a test
 * drives the whole entry point while holding no route outward at all.
 * `vi.mock('node:child_process')` is not an alternative to that: it does not intercept a module
 * under `scripts/`, and the sibling spec that trusted it to fake `gh` ran the real
 * `gh issue create` and filed a live issue on the public tracker.
 *
 * The second is this recorder. The transformed imports snapshot each spawn entry off the builtin
 * module object when the module is first imported, so an interceptor installed later is read by
 * nobody — it has to be in place before the imports, which is what `vi.hoisted` is for. What it
 * installs is a permanent dispatcher that passes straight through, and `record` switches it to
 * recording only for the body of one test. `afterAll` puts the untouched builtin back, because it
 * is shared with every other spec in this worker.
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

function fakePort(exists = false) {
    const calls: string[] = [];
    const logs: string[] = [];
    const port: OpenLanePort = {
        primaryRoot: () => '/repo',
        pathExists: () => exists,
        ensureWorktreeParent: (path) => calls.push(`mkdir:${path}`),
        fetchMain: () => calls.push('fetch'),
        worktreeAdd: (path, branch) => calls.push(`add:${path}:${branch}`),
        lock: (path) => calls.push(`lock:${path}`),
        log: (message) => logs.push(message),
    };
    return { port, calls, logs };
}

describe('lane open', () => {
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

    it('stays offline: the whole cli reaches no child process', () => {
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
