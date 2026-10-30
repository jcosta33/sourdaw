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
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { guardFailureReceiptPath, readGuardFailureReceipt } from './prContract.ts';
import { inside, type LaneIdentity } from './removeLane.ts';
import { clearGuardFailureReceiptIfUnchanged } from './resourceGuard.ts';

import type { CleanupPort, CleanupRecord } from './cleanupLanes.ts';

export type GuardReceiptFingerprint = { hash: string; dev: number; ino: number; birthtimeMs: number };

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

function guardReceiptFingerprint(path: string): GuardReceiptFingerprint | null {
    try {
        const parent = dirname(path);
        if (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent) {
            throw new Error('guard receipt parent is not canonical');
        }
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new Error('guard receipt is not a regular file');
        }
        const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
        const after = lstatSync(path);
        if (stat.dev !== after.dev || stat.ino !== after.ino || stat.birthtimeMs !== after.birthtimeMs) {
            throw new Error('guard receipt changed during inspection');
        }
        return { hash, dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs };
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

export function ownedGuardReceipt(primaryRoot: string, identity: LaneIdentity): GuardReceiptFingerprint | null {
    const laneName = basename(identity.path);
    const fingerprint = guardReceiptFingerprint(guardFailureReceiptPath(primaryRoot, laneName));
    if (fingerprint === null) {
        return null;
    }
    const receipt = readGuardFailureReceipt(primaryRoot, laneName);
    if (
        receipt?.headSha !== identity.head ||
        (identity.branch !== undefined && receipt.branch !== identity.branch) ||
        (receipt.cwd !== undefined && receipt.cwd !== identity.path)
    ) {
        return null;
    }
    return fingerprint;
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
    const current = guardReceiptFingerprint(path);
    if (current === null) {
        return completed;
    }
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
        return 'worktree absent from filesystem and registry; newer guard bookkeeping preserved';
    }
    const receipt = readGuardFailureReceipt(record.primaryRoot, laneName);
    if (receipt === undefined) {
        return completed;
    }
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
