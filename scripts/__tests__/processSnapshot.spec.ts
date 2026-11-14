import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { expect, it } from 'vitest';

import { captureProcessGroupOfPid, captureProcessGroupSnapshot, parseProcessGroupSnapshot } from '../processSnapshot';

it.skipIf(process.platform === 'win32')('captures a detached process group without command arguments', async () => {
    const child = spawn(
        process.execPath,
        ['-e', "process.stdout.write('ready'); setInterval(() => {}, 1000)", 'private-snapshot-argument'],
        {
            detached: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        }
    );
    const closed = once(child, 'close');
    try {
        await once(child.stdout, 'data');
        if (child.pid === undefined) {
            throw new Error('Child did not start');
        }
        const snapshot = captureProcessGroupSnapshot(child.pid);
        expect(snapshot).toMatchObject({
            status: 'available',
            truncated: false,
            rows: [
                expect.objectContaining({
                    pid: child.pid,
                    processGroupId: child.pid,
                    parentPid: process.pid,
                    uid: expect.any(Number),
                    state: expect.any(String),
                    start: expect.any(String),
                }),
            ],
        });
        expect(JSON.stringify(snapshot)).not.toContain('private-snapshot-argument');
    } finally {
        child.kill('SIGKILL');
        await closed;
    }
});

it('reports invalid group identity unavailable', () => {
    expect(captureProcessGroupSnapshot(0)).toEqual({ status: 'unavailable' });
});

it('fails closed on malformed census and reports a bounded group explicitly', () => {
    expect(parseProcessGroupSnapshot('123 1 123 501 malformed', 123)).toEqual({ status: 'unavailable' });
    expect(parseProcessGroupSnapshot('', 123)).toEqual({ status: 'unavailable' });
    const rows = Array.from({ length: 33 }, (_, index) => `${index + 123} 1 123 501 S Thu Nov 12 13:54:37 2026`).join(
        '\n'
    );
    const snapshot = parseProcessGroupSnapshot(rows, 123);
    expect(snapshot.status).toBe('available');
    if (snapshot.status !== 'available') {
        throw new Error('Expected snapshot');
    }
    expect(snapshot.rows).toHaveLength(32);
    expect(snapshot.truncated).toBe(true);
});

it.skipIf(process.platform === 'win32')('finds the caller in its own group without command arguments', () => {
    const snapshot = captureProcessGroupOfPid(process.pid);
    expect(snapshot.status).toBe('available');
    if (snapshot.status !== 'available') {
        throw new Error('Expected snapshot');
    }
    expect(snapshot.rows[0]).toMatchObject({ pid: process.pid, parentPid: process.ppid });
});

it('reports an absent process unavailable', () => {
    expect(captureProcessGroupOfPid(2147483647)).toEqual({ status: 'unavailable' });
});
