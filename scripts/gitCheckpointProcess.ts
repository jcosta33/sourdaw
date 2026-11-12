import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { checkpointDaemonLog } from './gitCheckpointDaemon.ts';
import { checkpointSocketRows } from './gitCheckpointSocket.ts';

const unavailable = 'unavailable';
export const diagnosticEnv = {
    ...process.env,
    GIT_TRACE2: '0',
    GIT_TRACE2_EVENT: '0',
    GIT_TRACE2_PERF: '0',
    GIT_OPTIONAL_LOCKS: '0',
};
export function command(
    executable: string,
    args: string[],
    env = diagnosticEnv,
    timeout = 750,
    raw = false
): string | null {
    const result = spawnSync(executable, args, { encoding: 'utf8', env, timeout, maxBuffer: 256 * 1024 });
    if (result.status !== 0) {
        return null;
    }
    return raw ? result.stdout : result.stdout.trim();
}
export function processIdentity(pid: number): string | null {
    return command('ps', ['-p', String(pid), '-o', 'pid=,ppid=,pgid=,state=,lstart=,comm='])?.slice(0, 1024) ?? null;
}
function sameProcess(first: string | null, second: string | null): boolean {
    if (!first || !second) {
        return false;
    }
    const stable = (value: string) =>
        value
            .trim()
            .split(/\s+/)
            .filter((_, index) => index !== 3)
            .join(' ');
    return stable(first) === stable(second);
}
function sample(pid: number, identity: string | null): string | null {
    if (process.platform !== 'darwin' || !sameProcess(identity, processIdentity(pid))) {
        return null;
    }
    return command('/usr/bin/sample', [String(pid), '1'], diagnosticEnv, 2500);
}
function queueSnapshot(socket: string | undefined, pid: number) {
    const monotonicNs = process.hrtime.bigint().toString();
    if (!socket || process.platform !== 'darwin') {
        return { monotonicNs, rows: unavailable };
    }
    const result = spawnSync('/usr/sbin/netstat', ['-anv', '-f', 'unix'], {
        encoding: 'utf8',
        timeout: 1000,
        maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status !== 0) {
        return { monotonicNs, rows: unavailable };
    }
    const rows = checkpointSocketRows(result.stdout, socket, pid);
    if (rows?.some((row) => Buffer.byteLength(row) > 2048)) {
        return { monotonicNs, rows: unavailable, reason: 'queue row exceeds 2048 bytes' };
    }
    return { monotonicNs, rows: rows ?? unavailable };
}
function writeObservation(path: string | undefined, observation: Record<string, unknown>) {
    if (!path) {
        return;
    }
    try {
        writeFileSync(path, JSON.stringify(observation), { mode: 0o600 });
    } catch {
        // Partial evidence is optional and cannot control the Git writer.
    }
}
export function checkpointSamplePayload(stack: string | null) {
    const bytes = stack === null ? null : Buffer.from(stack);
    return {
        sample: bytes === null ? null : bytes.subarray(0, 65536).toString('base64'),
        sampleEncoding: 'base64',
        sampleOmittedBytes: bytes === null ? null : Math.max(0, bytes.length - 65536),
    };
}
export function runCheckpointSample(
    pid: number,
    initial: string | null,
    trace: string,
    partialPath: string | undefined
): Record<string, unknown> {
    const current = processIdentity(pid);
    const matchedSocket = trace.match(/af_unix:(?:stream:|dgram:)?(\/[^\s]+)/)?.[1];
    const socket = matchedSocket && matchedSocket.length <= 4096 ? matchedSocket : undefined;
    const first = queueSnapshot(socket, pid);
    const observation: Record<string, unknown> = {
        capturedAtNs: process.hrtime.bigint().toString(),
        identity: current,
        identityMatches: sameProcess(initial, current),
        socket,
        queueSnapshots: [first],
        sample: 'observation pending',
        daemonLog: { status: 'unavailable', reason: 'observation pending' },
        socketHolderIdentities: unavailable,
    };
    writeObservation(partialPath, observation);
    const stack = sample(pid, initial);
    Object.assign(observation, checkpointSamplePayload(stack));
    writeObservation(partialPath, observation);
    const second = queueSnapshot(socket, pid);
    observation.queueSnapshots = [first, second];
    observation.queue = second.rows;
    writeObservation(partialPath, observation);
    let peer: string | undefined;
    if (Array.isArray(first.rows)) {
        peer = first.rows[1];
    } else if (Array.isArray(second.rows)) {
        peer = second.rows[1];
    }
    const daemonRoot = join(homedir(), '.git-ai', 'internal', 'daemon');
    let holders: string | null = null;
    if (socket) {
        holders = command('/usr/sbin/lsof', ['-t', '-n', '-a', '-U', socket], diagnosticEnv, 1000);
    }
    const holderPids =
        holders
            ?.split(/\s+/)
            .filter((value) => /^\d+$/.test(value))
            .slice(0, 8) ?? [];
    observation.socketHolderIdentities = holderPids.map(
        (value) => command('ps', ['-p', value, '-o', 'pid=,ppid=,pgid=,state=,lstart='])?.slice(0, 1024) ?? null
    );
    writeObservation(partialPath, observation);
    const daemonLog = checkpointDaemonLog({
        socket,
        expectedSocket: join(daemonRoot, 'trace2.sock'),
        peerRow: peer,
        pidFile: join(daemonRoot, 'daemon.pid.json'),
        logDirectory: join(daemonRoot, 'logs'),
        uid: process.getuid?.(),
        identity: (daemonPid) => command('ps', ['-p', String(daemonPid), '-o', 'uid=,lstart='])?.slice(0, 1024) ?? null,
    });
    observation.daemonLog = daemonLog;
    if (daemonLog.status === 'available') {
        observation.receiver = { status: 'matched', pid: daemonLog.pid, identity: daemonLog.identity };
    } else if (daemonLog.pid !== undefined && daemonLog.identity !== undefined) {
        observation.receiver = { status: 'matched', pid: daemonLog.pid, identity: daemonLog.identity };
    } else {
        observation.receiver = { status: 'unavailable', reason: daemonLog.reason };
    }
    writeObservation(partialPath, observation);
    return observation;
}
