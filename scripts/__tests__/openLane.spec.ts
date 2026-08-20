import { describe, expect, it, vi } from 'vitest';

import { laneDirectoryName, openLane, parseOpenLaneArgs, type OpenLanePort } from '../openLane.ts';
import { laneBranchName } from '../prContract.ts';

const { spawned } = vi.hoisted(() => ({ spawned: [] as string[] }));

/**
 * `lane:open` is the one delivery script that must never touch GitHub: it runs before the issue
 * exists and before any credential is minted. Every process this repository launches goes through
 * `node:child_process`, so recording that module is the only assertion that can see the script
 * reaching outward — a claim about the shape of the injected port cannot.
 */
vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    const record = (api: string) => (command: string) => {
        spawned.push(`${api}:${command}`);
        throw new Error(`lane:open reached ${api}(${command})`);
    };
    return {
        ...actual,
        exec: record('exec'),
        execFile: record('execFile'),
        execFileSync: record('execFileSync'),
        execSync: record('execSync'),
        fork: record('fork'),
        spawn: record('spawn'),
        spawnSync: record('spawnSync'),
    };
});

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

    it('stays offline: opening a lane reaches no child process', () => {
        const { port, calls } = fakePort();
        spawned.length = 0;

        openLane(undefined, 'cleanup', port);

        expect(spawned).toEqual([]);
        expect(calls).toEqual([
            'mkdir:/repo/.agents/worktrees/agent--cleanup',
            'fetch',
            'add:/repo/.agents/worktrees/agent--cleanup:agent/cleanup',
            'lock:/repo/.agents/worktrees/agent--cleanup',
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
