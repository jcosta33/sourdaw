import { createHash } from 'node:crypto';
import {
    closeSync,
    constants,
    fstatSync,
    fsyncSync,
    lstatSync,
    openSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
    type Stats,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { guardFailureReceiptPath, parseGuardFailureReceipt } from './prContract.ts';
import { inside, type LaneIdentity } from './removeLane.ts';
import { clearGuardFailureReceiptIfUnchanged } from './resourceGuard.ts';

import type { CleanupPort, CleanupRecord } from './cleanupLanes.ts';

export type GuardReceiptFingerprint = { hash: string; dev: number; ino: number; birthtimeMs: number };

type CleanupFile = { bytes: Buffer; stat: Stats };

function canonicalCleanupParent(path: string): boolean {
    const parent = dirname(path);
    let stat: Stats;
    try {
        stat = lstatSync(parent);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(parent) !== parent) {
        throw new Error('cleanup file parent is not canonical');
    }
    return true;
}

function checkedCleanupFile(fd: number, path: string): Stats {
    const stat = fstatSync(fd);
    const current = lstatSync(path);
    if (
        !stat.isFile() ||
        !current.isFile() ||
        current.isSymbolicLink() ||
        stat.dev !== current.dev ||
        stat.ino !== current.ino ||
        stat.birthtimeMs !== current.birthtimeMs ||
        realpathSync(dirname(path)) !== dirname(path)
    ) {
        throw new Error('cleanup file is not regular at its canonical path or changed during inspection');
    }
    return stat;
}

export function readCleanupFile(path: string): CleanupFile | undefined {
    if (!(constants.O_NOFOLLOW > 0) || !(constants.O_NONBLOCK > 0)) {
        throw new Error('cleanup file no-follow nonblocking inspection is unavailable');
    }
    if (!canonicalCleanupParent(path)) {
        return undefined;
    }
    let fd: number;
    try {
        fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
    try {
        const stat = checkedCleanupFile(fd, path);
        const bytes = readFileSync(fd);
        const after = checkedCleanupFile(fd, path);
        if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) {
            throw new Error('cleanup file changed during inspection');
        }
        return { bytes, stat };
    } finally {
        closeSync(fd);
    }
}

function exclusiveExclusionFile(fd: number, path: string): void {
    const descriptor = fstatSync(fd);
    const current = lstatSync(path);
    if (
        !descriptor.isFile() ||
        descriptor.nlink !== 1 ||
        !current.isFile() ||
        current.isSymbolicLink() ||
        current.nlink !== 1 ||
        current.dev !== descriptor.dev ||
        current.ino !== descriptor.ino ||
        realpathSync(dirname(path)) !== dirname(path)
    ) {
        throw new Error('cleanup Git exclusion file is not exclusively owned at its registered path');
    }
}

export function ensureCleanupExclusionFile(path: string): void {
    if (!(constants.O_NOFOLLOW > 0)) {
        throw new Error('cleanup Git exclusion no-follow inspection is unavailable');
    }
    const fd = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
        exclusiveExclusionFile(fd, path);
        const previous = readFileSync(fd, 'utf8');
        const entry = '/.agents/lane-cleanup/';
        if (previous.split(/\r?\n/).includes(entry)) {
            return;
        }
        // Append only to this still-private descriptor; never replace the file or follow a new path.
        exclusiveExclusionFile(fd, path);
        writeFileSync(fd, `${previous === '' || previous.endsWith('\n') ? '' : '\n'}${entry}\n`);
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }
}

function fingerprint(file: CleanupFile): GuardReceiptFingerprint {
    const hash = createHash('sha256').update(file.bytes).digest('hex');
    return { hash, dev: file.stat.dev, ino: file.stat.ino, birthtimeMs: file.stat.birthtimeMs };
}

function guardReceiptFingerprint(path: string): GuardReceiptFingerprint | null {
    const file = readCleanupFile(path);
    return file === undefined ? null : fingerprint(file);
}

export function ownedGuardReceipt(primaryRoot: string, identity: LaneIdentity): GuardReceiptFingerprint | null {
    const laneName = basename(identity.path);
    const path = guardFailureReceiptPath(primaryRoot, laneName);
    const file = readCleanupFile(path);
    if (file === undefined) {
        return null;
    }
    const receipt = parseGuardFailureReceipt(file.bytes.toString('utf8'), path);
    if (
        receipt.headSha !== identity.head ||
        (identity.branch !== undefined && receipt.branch !== identity.branch) ||
        (receipt.cwd !== undefined && receipt.cwd !== identity.path)
    ) {
        return null;
    }
    return fingerprint(file);
}

function removedWorktreeAbsent(record: CleanupRecord, port: CleanupPort): boolean {
    const path = record.identity.path;
    const roots = ['worktrees', 'review-worktrees'].map((name) => join(record.primaryRoot, '.agents', name));
    if (!roots.some((root) => path !== root && inside(root, path)) || realpathSync(dirname(path)) !== dirname(path)) {
        throw new Error('queued worktree removal path is not canonical within managed roots');
    }
    if (port.removal.worktrees().some((lane) => lane.path === path)) {
        return false;
    }
    try {
        lstatSync(path);
        return false;
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return true;
        }
        throw error;
    }
}

export function finishRemovedWorktree(record: CleanupRecord, port: CleanupPort): string {
    if (!removedWorktreeAbsent(record, port)) {
        delete record.removal;
        throw new Error('queued worktree removal path was reused; preserving its bookkeeping');
    }
    const completed = 'worktree absent from filesystem and registry; removal bookkeeping completed';
    const expected = record.removal?.guardFailure;
    const laneName = basename(record.identity.path);
    const path = guardFailureReceiptPath(record.primaryRoot, laneName);
    if (expected === undefined || expected === null) {
        return 'worktree absent from filesystem and registry; unbound guard bookkeeping preserved';
    }
    const file = readCleanupFile(path);
    if (file === undefined) {
        return completed;
    }
    if (JSON.stringify(fingerprint(file)) !== JSON.stringify(expected)) {
        return 'worktree absent from filesystem and registry; newer guard bookkeeping preserved';
    }
    const receipt = parseGuardFailureReceipt(file.bytes.toString('utf8'), path);
    const result = clearGuardFailureReceiptIfUnchanged(record.primaryRoot, laneName, receipt, {
        rmSync: (claimed, options) => {
            // The native receipt helper claims atomically; recheck file identity and bytes on that
            // claim too, so a concurrent replacement never spends this old cleanup authority.
            if (
                typeof claimed !== 'string' ||
                !removedWorktreeAbsent(record, port) ||
                JSON.stringify(guardReceiptFingerprint(claimed)) !== JSON.stringify(expected)
            ) {
                throw new Error('guard bookkeeping changed during removal cleanup');
            }
            rmSync(claimed, options);
        },
    });
    if (result.status === 'error') {
        throw new Error(result.message);
    }
    return result.status === 'mismatch' ? 'worktree absent; changed guard bookkeeping preserved' : completed;
}
