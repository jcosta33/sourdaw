import { describe, expect, it } from 'vitest';

import { openLane, parseOpenLaneArgs, type OpenLanePort } from '../openLane.ts';

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

    it('does not modify a primary checkout path', () => {
        const { port, calls } = fakePort();

        openLane(1, 'work', port);

        expect(calls.some((call) => call.includes('/repo/.git') || call === 'add:/repo:')).toBe(false);
        expect(calls.every((call) => !call.startsWith('add:/repo:') || call.includes('.agents/worktrees'))).toBe(true);
    });

    it.each([
        [['0'], /usage/],
        [[], /usage/],
        [['12', 'Work'], /slug/],
        [['agent'], /usage/],
    ])('rejects argv %j before creating a worktree', (args, message) => {
        expect(() => parseOpenLaneArgs(args)).toThrow(message);
        const { port, calls } = fakePort();
        expect(calls).toEqual([]);
        void port;
    });
});
