import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { fail } from './prContract.ts';

type PullRequestMutationLockOwner = {
    version: 1;
    pid: number;
    token: string;
};

export type PullRequestMutationSerialization = <Value>(
    primaryRoot: string,
    number: number,
    operation: (boundary: PullRequestRemoteMutationBoundary) => Promise<Value>
) => Promise<Value>;

export type PullRequestRemoteMutationBoundary = {
    markRemoteMutationAttempt: () => void;
};

const LOCK_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// Keep the established ref namespace so a delivery crash from an older command remains a fence.
function mutationLockRef(number: number): string {
    if (!Number.isSafeInteger(number) || number <= 0) {
        fail('delivery lock requires a positive pull-request number');
    }
    return `refs/sourdaw/delivery/pr-${number}`;
}

function mutationLockGit(primaryRoot: string, args: string[], input?: string) {
    return spawnSync('git', args, {
        cwd: primaryRoot,
        encoding: 'utf8',
        shell: false,
        ...(input === undefined ? {} : { input }),
    });
}

function parseMutationLockOwner(contents: string, number: number): PullRequestMutationLockOwner {
    let value: unknown;
    try {
        value = JSON.parse(contents) as unknown;
    } catch {
        fail(`PR #${number} delivery lock ownership is malformed`);
    }
    if (
        typeof value !== 'object' ||
        value === null ||
        Object.keys(value).length !== 3 ||
        !('version' in value) ||
        value.version !== 1 ||
        !('pid' in value) ||
        typeof value.pid !== 'number' ||
        !Number.isSafeInteger(value.pid) ||
        value.pid <= 0 ||
        !('token' in value) ||
        typeof value.token !== 'string' ||
        !LOCK_TOKEN_PATTERN.test(value.token)
    ) {
        fail(`PR #${number} delivery lock ownership is malformed`);
    }
    return { version: 1, pid: value.pid, token: value.token };
}

function mutationLockObjectId(value: string, number: number): string {
    const oid = value.trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid)) {
        fail(`PR #${number} delivery lock object identity is malformed`);
    }
    return oid;
}

function writeMutationLockOwner(primaryRoot: string, owner: PullRequestMutationLockOwner, number: number): string {
    const result = mutationLockGit(primaryRoot, ['hash-object', '-w', '--stdin'], JSON.stringify(owner));
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`PR #${number} delivery lock owner could not be stored`);
    }
    return mutationLockObjectId(result.stdout, number);
}

function readMutationLockOid(primaryRoot: string, ref: string, number: number): string | undefined {
    const result = mutationLockGit(primaryRoot, ['show-ref', '--verify', '--hash', ref]);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status === 1) {
        return undefined;
    }
    if (result.status !== 0) {
        fail(`PR #${number} delivery lock ownership cannot be verified`);
    }
    return mutationLockObjectId(result.stdout, number);
}

function readMutationLockOwner(primaryRoot: string, oid: string, number: number): PullRequestMutationLockOwner {
    const result = mutationLockGit(primaryRoot, ['cat-file', 'blob', oid]);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`PR #${number} delivery lock ownership cannot be verified`);
    }
    return parseMutationLockOwner(result.stdout, number);
}

function updateMutationLockRef(primaryRoot: string, args: string[]): boolean {
    const result = mutationLockGit(primaryRoot, ['update-ref', ...args]);
    if (result.error !== undefined) {
        throw result.error;
    }
    return result.status === 0;
}

function acquireMutationLock(primaryRoot: string, number: number): { ref: string; oid: string } {
    const ref = mutationLockRef(number);
    const owner: PullRequestMutationLockOwner = { version: 1, pid: process.pid, token: randomUUID() };
    const oid = writeMutationLockOwner(primaryRoot, owner, number);
    if (updateMutationLockRef(primaryRoot, [ref, oid, '0'.repeat(oid.length)])) {
        return { ref, oid };
    }

    const previousOid = readMutationLockOid(primaryRoot, ref, number);
    if (previousOid === undefined) {
        fail(`PR #${number} delivery lock could not be acquired`);
    }
    const previousOwner = readMutationLockOwner(primaryRoot, previousOid, number);
    return fail(`PR #${number} is already being delivered by process ${previousOwner.pid}`);
}

function releaseMutationLock(primaryRoot: string, ref: string, oid: string, number: number): void {
    if (!updateMutationLockRef(primaryRoot, ['-d', ref, oid])) {
        fail(`PR #${number} delivery lock ownership changed before release`);
    }
}

export async function withPullRequestMutationLock<Value>(
    primaryRoot: string,
    number: number,
    operation: (boundary: PullRequestRemoteMutationBoundary) => Promise<Value>
): Promise<Value> {
    const lock = acquireMutationLock(primaryRoot, number);
    let remoteMutationAttempted = false;
    let succeeded = false;
    try {
        const result = await operation({
            markRemoteMutationAttempt: () => {
                remoteMutationAttempted = true;
            },
        });
        succeeded = true;
        return result;
    } finally {
        if (succeeded || !remoteMutationAttempted) {
            releaseMutationLock(primaryRoot, lock.ref, lock.oid, number);
        }
    }
}
