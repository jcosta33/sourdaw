import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, type Stats } from 'node:fs';
import { join } from 'node:path';

type DaemonLogRequest = {
    socket: string | undefined;
    expectedSocket: string;
    peerRow: string | undefined;
    pidFile: string;
    logDirectory: string;
    uid: number | undefined;
    identity: (pid: number) => string | null;
};
type FileSnapshot = { size: number; inode: number; device: number; modifiedMs: number };
type DaemonLogResult =
    | { status: 'unavailable'; reason: string; pid?: number; identity?: string }
    | {
          status: 'available';
          pid: number;
          identity: string;
          before: FileSnapshot;
          after: FileSnapshot;
          omittedBytes: number;
          base64: string;
      };
function metadata(stat: Stats): FileSnapshot {
    return { size: stat.size, inode: stat.ino, device: stat.dev, modifiedMs: stat.mtimeMs };
}
function readBounded(
    path: string,
    limit: number,
    tail: boolean
): { bytes: Buffer; before: FileSnapshot; after: FileSnapshot } | null {
    let fd: number | undefined;
    try {
        fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const before = fstatSync(fd);
        if (!before.isFile() || (!tail && before.size > limit)) {
            return null;
        }
        const length = Math.min(before.size, limit);
        const buffer = Buffer.alloc(length);
        const start = tail ? before.size - length : 0;
        let offset = 0;
        while (offset < length) {
            const count = readSync(fd, buffer, offset, length - offset, start + offset);
            if (!count) {
                return null;
            }
            offset += count;
        }
        const after = fstatSync(fd);
        const current = lstatSync(path);
        if (current.dev !== after.dev || current.ino !== after.ino) {
            return null;
        }
        return { bytes: buffer, before: metadata(before), after: metadata(after) };
    } catch {
        return null;
    } finally {
        if (fd !== undefined) {
            closeSync(fd);
        }
    }
}
function pidRecord(text: string): { pid: number; startedAtMs: number } | null {
    try {
        const value: unknown = JSON.parse(text);
        if (typeof value !== 'object' || value === null || !('pid' in value) || !('started_at_ns' in value)) {
            return null;
        }
        if (
            typeof value.pid !== 'number' ||
            !Number.isSafeInteger(value.pid) ||
            value.pid <= 0 ||
            typeof value.started_at_ns !== 'number' ||
            !Number.isFinite(value.started_at_ns)
        ) {
            return null;
        }
        return { pid: value.pid, startedAtMs: value.started_at_ns / 1_000_000 };
    } catch {
        return null;
    }
}
export function checkpointDaemonLog(request: DaemonLogRequest): DaemonLogResult {
    if (!request.socket || request.socket !== request.expectedSocket || !request.peerRow || request.uid === undefined) {
        return { status: 'unavailable', reason: 'socket or peer identity unavailable' };
    }
    const fields = request.peerRow.trim().split(/\s+/);
    const peer = fields[12]?.match(/^git-ai:(\d+)$/);
    if (!peer || !request.peerRow.endsWith(` ${request.socket}`)) {
        return { status: 'unavailable', reason: 'peer is not the expected daemon' };
    }
    const pidFile = readBounded(request.pidFile, 4096, false);
    if (
        !pidFile ||
        pidFile.before.size !== pidFile.after.size ||
        pidFile.before.modifiedMs !== pidFile.after.modifiedMs
    ) {
        return { status: 'unavailable', reason: 'daemon identity file unavailable or changed' };
    }
    const record = pidRecord(pidFile.bytes.toString('utf8'));
    if (!record || String(record.pid) !== peer[1]) {
        return { status: 'unavailable', reason: 'daemon pid does not match peer' };
    }
    const identity = request.identity(record.pid);
    const match = identity?.trim().match(/^(\d+)\s+(.+)$/);
    if (!identity || !match || match[1] === undefined || match[2] === undefined) {
        return { status: 'unavailable', reason: 'daemon process uid or start identity does not match' };
    }
    const start = Date.parse(match[2]);
    if (Number(match[1]) !== request.uid || !Number.isFinite(start) || Math.abs(start - record.startedAtMs) >= 2000) {
        return { status: 'unavailable', reason: 'daemon process uid or start identity does not match' };
    }
    const log = readBounded(join(request.logDirectory, `${record.pid}.log`), 64 * 1024, true);
    if (!log) {
        const pidAfter = readBounded(request.pidFile, 4096, false);
        if (pidAfter && pidAfter.bytes.equals(pidFile.bytes) && request.identity(record.pid) === identity) {
            return { status: 'unavailable', reason: 'daemon log unavailable', pid: record.pid, identity };
        }
        return { status: 'unavailable', reason: 'daemon identity changed while checking log' };
    }
    const pidAfter = readBounded(request.pidFile, 4096, false);
    if (!pidAfter || !pidAfter.bytes.equals(pidFile.bytes) || request.identity(record.pid) !== identity) {
        return { status: 'unavailable', reason: 'daemon identity changed while reading log' };
    }
    return {
        status: 'available',
        pid: record.pid,
        identity,
        before: log.before,
        after: log.after,
        omittedBytes: Math.max(0, log.before.size - log.bytes.length),
        base64: log.bytes.toString('base64'),
    };
}
