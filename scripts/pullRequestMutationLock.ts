import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { fail } from './prContract.ts';

export type PullRequestMutationLockOwnerFence =
    | {
          kind: 'pgid';
          pgid: number;
          leaderStartedAt?: string;
      }
    | {
          kind: 'pid';
          pid: number;
      }
    | {
          kind: 'win32-process-tree';
          version: 1;
          rootPid: number;
          rootStartedAt: string;
      };
export type PullRequestMutationLockOwner =
    | {
          version: 1;
          pid: number;
          token: string;
      }
    | {
          version: 2;
          pid: number;
          token: string;
          operation: 'review-resolution';
          number: number;
          threadId: string;
          head: string;
          ownerFence: PullRequestMutationLockOwnerFence;
      };
export type PullRequestMutationLockOptions = {
    reviewResolution?: {
        threadId: string;
        head: string;
        ownerFence: PullRequestMutationLockOwnerFence | (() => PullRequestMutationLockOwnerFence);
    };
};

export type PullRequestMutationSerialization = <Value>(
    primaryRoot: string,
    number: number,
    operation: (boundary: PullRequestRemoteMutationBoundary) => Promise<Value>,
    options?: PullRequestMutationLockOptions
) => Promise<Value>;

export type PullRequestRemoteMutationBoundary = {
    markRemoteMutationAttempt: () => void;
    /** Records that a synchronous, definitive refusal proves this mutation did not land. */
    markRemoteMutationKnownAbsent?: () => void;
    ownerOid: string;
    registerSuccessfulCompletion: (cleanup: () => void) => void;
};

const LOCK_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// Keep the established ref namespace so a delivery crash from an older command remains a fence.
export function pullRequestMutationLockRef(number: number): string {
    if (!Number.isSafeInteger(number) || number <= 0) {
        fail('delivery lock requires a positive pull-request number');
    }
    return `refs/sourdaw/delivery/pr-${number}`;
}

function mutationLockGit(primaryRoot: string, args: string[], input?: string, gitPath: string = 'git') {
    return spawnSync(gitPath, args, {
        cwd: primaryRoot,
        encoding: 'utf8',
        shell: false,
        ...(input === undefined ? {} : { input }),
    });
}

function isExecutionFence(value: unknown): value is PullRequestMutationLockOwnerFence {
    if (typeof value !== 'object' || value === null || !('kind' in value)) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (candidate.kind === 'pgid') {
        return (
            Object.keys(candidate).length === (candidate.leaderStartedAt === undefined ? 2 : 3) &&
            typeof candidate.pgid === 'number' &&
            Number.isSafeInteger(candidate.pgid) &&
            candidate.pgid > 0 &&
            (candidate.leaderStartedAt === undefined ||
                (typeof candidate.leaderStartedAt === 'string' && candidate.leaderStartedAt.trim() !== ''))
        );
    }
    if (candidate.kind === 'pid') {
        return (
            Object.keys(candidate).length === 2 &&
            typeof candidate.pid === 'number' &&
            Number.isSafeInteger(candidate.pid) &&
            candidate.pid > 0
        );
    }
    return (
        candidate.kind === 'win32-process-tree' &&
        Object.keys(candidate).length === 4 &&
        candidate.version === 1 &&
        typeof candidate.rootPid === 'number' &&
        Number.isSafeInteger(candidate.rootPid) &&
        candidate.rootPid > 0 &&
        typeof candidate.rootStartedAt === 'string' &&
        candidate.rootStartedAt.trim() !== ''
    );
}

function isExecutionFenceBoundToOwnerPid(ownerFence: PullRequestMutationLockOwnerFence, pid: number): boolean {
    if (ownerFence.kind === 'pid') {
        return ownerFence.pid === pid;
    }
    if (ownerFence.kind === 'pgid') {
        return ownerFence.pgid === pid;
    }
    return ownerFence.rootPid === pid;
}

function hasOwnerIdentity(
    value: Record<string, unknown>
): value is Record<string, unknown> & { pid: number; token: string } {
    return (
        typeof value.pid === 'number' &&
        Number.isSafeInteger(value.pid) &&
        value.pid > 0 &&
        typeof value.token === 'string' &&
        LOCK_TOKEN_PATTERN.test(value.token)
    );
}

function parseMutationLockOwner(contents: string, number: number): PullRequestMutationLockOwner {
    let value: unknown;
    try {
        value = JSON.parse(contents) as unknown;
    } catch {
        fail(`PR #${number} delivery lock ownership is malformed`);
    }
    if (typeof value !== 'object' || value === null) {
        fail(`PR #${number} delivery lock ownership is malformed`);
    }
    const owner = value as Record<string, unknown>;
    if (owner.version === 1 && Object.keys(owner).length === 3 && hasOwnerIdentity(owner)) {
        return { version: 1, pid: owner.pid, token: owner.token };
    }
    if (
        owner.version === 2 &&
        Object.keys(owner).length === 8 &&
        hasOwnerIdentity(owner) &&
        owner.operation === 'review-resolution' &&
        owner.number === number &&
        typeof owner.threadId === 'string' &&
        owner.threadId !== '' &&
        typeof owner.head === 'string' &&
        /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(owner.head) &&
        isExecutionFence(owner.ownerFence) &&
        isExecutionFenceBoundToOwnerPid(owner.ownerFence, owner.pid)
    ) {
        return {
            version: 2,
            pid: owner.pid,
            token: owner.token,
            operation: 'review-resolution',
            number: owner.number,
            threadId: owner.threadId,
            head: owner.head.toLowerCase(),
            ownerFence: owner.ownerFence,
        };
    }
    return fail(`PR #${number} delivery lock ownership is malformed`);
}

export function isReviewResolutionPullRequestMutationLockOwner(
    owner: PullRequestMutationLockOwner
): owner is Extract<PullRequestMutationLockOwner, { version: 2 }> {
    return owner.version === 2 && owner.operation === 'review-resolution';
}

function mutationLockObjectId(value: string, number: number): string {
    const oid = value.trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid)) {
        fail(`PR #${number} delivery lock object identity is malformed`);
    }
    return oid;
}

export function writePullRequestMutationLockOwner(
    primaryRoot: string,
    owner: PullRequestMutationLockOwner,
    number: number,
    gitPath: string = 'git'
): string {
    const result = mutationLockGit(primaryRoot, ['hash-object', '-w', '--stdin'], JSON.stringify(owner), gitPath);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`PR #${number} delivery lock owner could not be stored`);
    }
    return mutationLockObjectId(result.stdout, number);
}

export function readPullRequestMutationLockOid(
    primaryRoot: string,
    ref: string,
    number: number,
    gitPath: string = 'git'
): string | undefined {
    const result = mutationLockGit(primaryRoot, ['rev-parse', '--verify', '--quiet', ref], undefined, gitPath);
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

export function readPullRequestMutationLockOwner(
    primaryRoot: string,
    oid: string,
    number: number,
    gitPath: string = 'git'
): PullRequestMutationLockOwner {
    const result = mutationLockGit(primaryRoot, ['cat-file', 'blob', oid], undefined, gitPath);
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

function acquireMutationLock(
    primaryRoot: string,
    number: number,
    options: PullRequestMutationLockOptions | undefined
): { ref: string; oid: string } {
    const ref = pullRequestMutationLockRef(number);
    const existingOid = readPullRequestMutationLockOid(primaryRoot, ref, number);
    if (existingOid !== undefined) {
        const existingOwner = readPullRequestMutationLockOwner(primaryRoot, existingOid, number);
        return fail(`PR #${number} is already being delivered by process ${existingOwner.pid}`);
    }
    const reviewResolution = options?.reviewResolution;
    const owner: PullRequestMutationLockOwner =
        reviewResolution === undefined
            ? { version: 1, pid: process.pid, token: randomUUID() }
            : {
                  version: 2,
                  pid: process.pid,
                  token: randomUUID(),
                  operation: 'review-resolution',
                  number,
                  threadId: reviewResolution.threadId,
                  head: reviewResolution.head,
                  ownerFence:
                      typeof reviewResolution.ownerFence === 'function'
                          ? reviewResolution.ownerFence()
                          : reviewResolution.ownerFence,
              };
    const oid = writePullRequestMutationLockOwner(primaryRoot, owner, number);
    if (updateMutationLockRef(primaryRoot, [ref, oid, '0'.repeat(oid.length)])) {
        return { ref, oid };
    }

    const previousOid = readPullRequestMutationLockOid(primaryRoot, ref, number);
    if (previousOid === undefined) {
        fail(`PR #${number} delivery lock could not be acquired`);
    }
    const previousOwner = readPullRequestMutationLockOwner(primaryRoot, previousOid, number);
    return fail(`PR #${number} is already being delivered by process ${previousOwner.pid}`);
}

function releaseMutationLock(primaryRoot: string, ref: string, oid: string, number: number): void {
    if (!updateMutationLockRef(primaryRoot, ['-d', ref, oid])) {
        fail(`PR #${number} delivery lock ownership changed before release`);
    }
}

/**
 * Deletes only a lock whose current object identity is exactly the caller's retained owner.
 * Recovery commands use this instead of an unconstrained ref deletion.
 */
export function releasePullRequestMutationLockExact(
    primaryRoot: string,
    number: number,
    ownerOid: string,
    gitPath: string = 'git'
): void {
    const ref = pullRequestMutationLockRef(number);
    const oid = mutationLockObjectId(ownerOid, number);
    const result = mutationLockGit(primaryRoot, ['update-ref', '-d', ref, oid], undefined, gitPath);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`PR #${number} delivery lock ownership changed before release`);
    }
}

export async function withPullRequestMutationLock<Value>(
    primaryRoot: string,
    number: number,
    operation: (boundary: PullRequestRemoteMutationBoundary) => Promise<Value>,
    options?: PullRequestMutationLockOptions
): Promise<Value> {
    const lock = acquireMutationLock(primaryRoot, number, options);
    let remoteMutationAttempted = false;
    let remoteMutationKnownAbsent = false;
    let succeeded = false;
    let successfulCompletion: (() => void) | undefined;
    try {
        const result = await operation({
            ownerOid: lock.oid,
            markRemoteMutationAttempt: () => {
                remoteMutationAttempted = true;
            },
            markRemoteMutationKnownAbsent: () => {
                if (!remoteMutationAttempted) {
                    fail(`PR #${number} delivery lock cannot record an absent mutation before an attempt`);
                }
                remoteMutationKnownAbsent = true;
            },
            registerSuccessfulCompletion: (cleanup) => {
                if (successfulCompletion !== undefined) {
                    fail(`PR #${number} delivery lock already has a successful-completion cleanup`);
                }
                successfulCompletion = cleanup;
            },
        });
        succeeded = true;
        return result;
    } finally {
        if (succeeded && successfulCompletion !== undefined) {
            successfulCompletion();
        } else if (
            succeeded ||
            remoteMutationKnownAbsent ||
            (!remoteMutationAttempted && successfulCompletion === undefined)
        ) {
            releaseMutationLock(primaryRoot, lock.ref, lock.oid, number);
        }
    }
}
