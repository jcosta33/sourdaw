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
          startedAt?: string;
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
      }
    | {
          version: 3;
          pid: number;
          token: string;
          operation: 'review-publication';
          number: number;
          expectedHead: string;
          payloadDigest: string;
          reviewerActorNodeId: string;
          ownerFence: PullRequestMutationLockOwnerFence;
          mutation: { phase: 'prepared' | 'remote-mutation-attempted'; epoch: number };
          recovery?: { legacyOwnerOid: string; definitiveNoMutationHttpStatus: 422 };
      };
export type PullRequestMutationLockOptions = {
    reviewResolution?: {
        threadId: string;
        head: string;
        ownerFence: PullRequestMutationLockOwnerFence | (() => PullRequestMutationLockOwnerFence);
    };
    reviewPublication?: {
        expectedHead: string;
        payloadDigest: string;
        reviewerActorNodeId: string;
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
    ownerOid: string;
    registerSuccessfulCompletion: (cleanup: () => void) => void;
};

export type PullRequestReviewPublicationMutationBoundary = PullRequestRemoteMutationBoundary & {
    journalReviewPublication: (publication: {
        expectedHead: string;
        payloadDigest: string;
        reviewerActorNodeId: string;
    }) => void;
};

export type PullRequestReviewPublicationMutationSerialization = <Value>(
    primaryRoot: string,
    number: number,
    operation: (boundary: PullRequestReviewPublicationMutationBoundary) => Promise<Value>,
    options: PullRequestMutationLockOptions & {
        reviewPublication: NonNullable<PullRequestMutationLockOptions['reviewPublication']>;
    }
) => Promise<Value>;

const LOCK_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// Keep the established ref namespace so a delivery crash from an older command remains a fence.
export function pullRequestMutationLockRef(number: number): string {
    if (!Number.isSafeInteger(number) || number <= 0) {
        fail('delivery lock requires a positive pull-request number');
    }
    return `refs/sourdaw/delivery/pr-${number}`;
}

export function reviewPublicationRecoveryReceiptRef(number: number, ownerOid: string): string {
    const oid = mutationLockObjectId(ownerOid, number);
    return `refs/sourdaw/delivery/review-publication-recovered/pr-${number}/${oid}`;
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
            Object.keys(candidate).length === (candidate.startedAt === undefined ? 2 : 3) &&
            typeof candidate.pid === 'number' &&
            Number.isSafeInteger(candidate.pid) &&
            candidate.pid > 0 &&
            (candidate.startedAt === undefined ||
                (typeof candidate.startedAt === 'string' && candidate.startedAt.trim() !== ''))
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

function isPublicationOwnerFence(ownerFence: PullRequestMutationLockOwnerFence): boolean {
    if (ownerFence.kind === 'pid') {
        return typeof ownerFence.startedAt === 'string' && ownerFence.startedAt.trim() !== '';
    }
    if (ownerFence.kind === 'pgid') {
        return typeof ownerFence.leaderStartedAt === 'string' && ownerFence.leaderStartedAt.trim() !== '';
    }
    return true;
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

function hasExactTopLevelKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

const reviewPublicationOwnerKeys = [
    'version',
    'pid',
    'token',
    'operation',
    'number',
    'expectedHead',
    'payloadDigest',
    'reviewerActorNodeId',
    'ownerFence',
    'mutation',
] as const;
const recoveredReviewPublicationOwnerKeys = [...reviewPublicationOwnerKeys, 'recovery'] as const;

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
    const isNormalReviewPublicationOwner = hasExactTopLevelKeys(owner, reviewPublicationOwnerKeys);
    const isRecoveredReviewPublicationOwner = hasExactTopLevelKeys(owner, recoveredReviewPublicationOwnerKeys);
    if (
        owner.version === 3 &&
        (isNormalReviewPublicationOwner || isRecoveredReviewPublicationOwner) &&
        hasOwnerIdentity(owner) &&
        owner.operation === 'review-publication' &&
        owner.number === number &&
        typeof owner.expectedHead === 'string' &&
        /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(owner.expectedHead) &&
        typeof owner.payloadDigest === 'string' &&
        /^[0-9a-f]{64}$/iu.test(owner.payloadDigest) &&
        typeof owner.reviewerActorNodeId === 'string' &&
        owner.reviewerActorNodeId !== '' &&
        isExecutionFence(owner.ownerFence) &&
        isExecutionFenceBoundToOwnerPid(owner.ownerFence, owner.pid) &&
        isPublicationOwnerFence(owner.ownerFence) &&
        typeof owner.mutation === 'object' &&
        owner.mutation !== null &&
        Object.keys(owner.mutation).length === 2 &&
        ((owner.mutation as { phase?: unknown }).phase === 'prepared' ||
            (owner.mutation as { phase?: unknown }).phase === 'remote-mutation-attempted') &&
        typeof (owner.mutation as { epoch?: unknown }).epoch === 'number' &&
        Number.isSafeInteger((owner.mutation as { epoch: number }).epoch) &&
        (owner.mutation as { epoch: number }).epoch >= 0 &&
        (isNormalReviewPublicationOwner ||
            (typeof owner.recovery === 'object' &&
                owner.recovery !== null &&
                Object.keys(owner.recovery).length === 2 &&
                typeof (owner.recovery as { legacyOwnerOid?: unknown }).legacyOwnerOid === 'string' &&
                /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(
                    (owner.recovery as { legacyOwnerOid: string }).legacyOwnerOid
                ) &&
                (owner.recovery as { definitiveNoMutationHttpStatus?: unknown }).definitiveNoMutationHttpStatus ===
                    422))
    ) {
        return {
            version: 3,
            pid: owner.pid,
            token: owner.token,
            operation: 'review-publication',
            number: owner.number,
            expectedHead: owner.expectedHead.toLowerCase(),
            payloadDigest: owner.payloadDigest.toLowerCase(),
            reviewerActorNodeId: owner.reviewerActorNodeId,
            ownerFence: owner.ownerFence,
            mutation: {
                phase: (owner.mutation as { phase: 'prepared' | 'remote-mutation-attempted' }).phase,
                epoch: (owner.mutation as { epoch: number }).epoch,
            },
            ...(owner.recovery === undefined
                ? {}
                : {
                      recovery: {
                          legacyOwnerOid: (owner.recovery as { legacyOwnerOid: string }).legacyOwnerOid.toLowerCase(),
                          definitiveNoMutationHttpStatus: 422 as const,
                      },
                  }),
        };
    }
    return fail(`PR #${number} delivery lock ownership is malformed`);
}

export function isReviewResolutionPullRequestMutationLockOwner(
    owner: PullRequestMutationLockOwner
): owner is Extract<PullRequestMutationLockOwner, { version: 2 }> {
    return owner.version === 2 && owner.operation === 'review-resolution';
}

export function isReviewPublicationPullRequestMutationLockOwner(
    owner: PullRequestMutationLockOwner
): owner is Extract<PullRequestMutationLockOwner, { version: 3 }> {
    return owner.version === 3 && owner.operation === 'review-publication';
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

export function replacePullRequestMutationLockOwner(
    primaryRoot: string,
    number: number,
    expectedOwnerOid: string,
    owner: PullRequestMutationLockOwner
): string {
    const ref = pullRequestMutationLockRef(number);
    const nextOwnerOid = writePullRequestMutationLockOwner(primaryRoot, owner, number);
    if (!updateMutationLockRef(primaryRoot, [ref, nextOwnerOid, expectedOwnerOid])) {
        fail(`PR #${number} delivery lock ownership changed before recovery`);
    }
    return nextOwnerOid;
}

export function releasePullRequestMutationLockOwner(
    primaryRoot: string,
    number: number,
    expectedOwnerOid: string
): void {
    releaseMutationLock(primaryRoot, pullRequestMutationLockRef(number), expectedOwnerOid, number);
}

export function writePullRequestMutationLockReceipt(primaryRoot: string, receipt: unknown, number: number): string {
    const result = mutationLockGit(primaryRoot, ['hash-object', '-w', '--stdin'], JSON.stringify(receipt));
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`PR #${number} review-publication recovery receipt could not be stored`);
    }
    return mutationLockObjectId(result.stdout, number);
}

export function readPullRequestMutationLockReceipt(primaryRoot: string, number: number, ownerOid: string): unknown {
    const receiptOid = readPullRequestMutationLockOid(
        primaryRoot,
        reviewPublicationRecoveryReceiptRef(number, ownerOid),
        number
    );
    if (receiptOid === undefined) {
        return undefined;
    }
    const result = mutationLockGit(primaryRoot, ['cat-file', 'blob', receiptOid]);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`PR #${number} review-publication recovery receipt cannot be verified`);
    }
    try {
        return JSON.parse(result.stdout) as unknown;
    } catch {
        return fail(`PR #${number} review-publication recovery receipt is malformed`);
    }
}

export function recordReviewPublicationRecoveryReceipt(
    primaryRoot: string,
    number: number,
    ownerOid: string,
    receipt: unknown
): void {
    const ref = reviewPublicationRecoveryReceiptRef(number, ownerOid);
    const receiptOid = writePullRequestMutationLockReceipt(primaryRoot, receipt, number);
    if (!updateMutationLockRef(primaryRoot, [ref, receiptOid, '0'.repeat(receiptOid.length)])) {
        const existing = readPullRequestMutationLockReceipt(primaryRoot, number, ownerOid);
        if (JSON.stringify(existing) !== JSON.stringify(receipt)) {
            fail(`PR #${number} review-publication recovery receipt ownership changed`);
        }
    }
}

export function reviewPublicationOwnerFenceIsLive(
    owner: Extract<PullRequestMutationLockOwner, { version: 3 }>,
    platform: NodeJS.Platform = process.platform
): boolean {
    const fence = owner.ownerFence;
    if (fence.kind === 'pid') {
        const observed = processStartedAt(owner.pid);
        return observed !== undefined && observed === fence.startedAt;
    }
    if (fence.kind === 'pgid') {
        return processGroupIsLive(fence.pgid, fence.leaderStartedAt);
    }
    if (platform !== 'win32') {
        fail('review-publication lock Windows process-tree fence is unreadable on this platform');
    }
    return windowsProcessTreeIsLive(fence);
}

export function currentReviewPublicationOwnerFence(): PullRequestMutationLockOwnerFence {
    if (process.platform === 'win32') {
        const startedAt = windowsProcessStartedAt(process.pid);
        if (startedAt === undefined) {
            fail('review-publication lock could not determine the current Windows process identity');
        }
        return { kind: 'win32-process-tree', version: 1, rootPid: process.pid, rootStartedAt: startedAt };
    }
    const pgid = currentProcessGroupId(process.pid);
    const startedAt = processStartedAt(pgid);
    if (startedAt === undefined) {
        fail('review-publication lock could not determine the current process identity');
    }
    return { kind: 'pgid', pgid, leaderStartedAt: startedAt };
}

function currentProcessGroupId(pid: number): number {
    const executable = process.env.SOURDAW_TRUSTED_PS_PATH;
    if (typeof executable !== 'string' || executable === '') {
        fail('review-publication lock requires the trusted ps executable');
    }
    const result = spawnSync(executable, ['-o', 'pgid=', '-p', String(pid)], {
        encoding: 'utf8',
        shell: false,
        env: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
    });
    const value = result.stdout.trim();
    if (result.error !== undefined || result.status !== 0 || !/^[1-9][0-9]*$/u.test(value)) {
        fail('review-publication lock process group is unreadable');
    }
    return Number(value);
}

function processStartedAt(pid: number): string | undefined {
    const executable = process.env.SOURDAW_TRUSTED_PS_PATH;
    if (typeof executable !== 'string' || executable === '') {
        fail('review-publication lock requires the trusted ps executable');
    }
    const result = spawnSync(executable, ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        shell: false,
        env: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
    });
    if (result.error !== undefined || (result.status !== 0 && result.status !== 1)) {
        fail('review-publication lock process liveness is unreadable');
    }
    const startedAt = result.stdout.trim();
    return startedAt === '' ? undefined : startedAt;
}

function processGroupIsLive(pgid: number, leaderStartedAt: string | undefined): boolean {
    if (leaderStartedAt === undefined) {
        fail('review-publication lock process-group identity is unreadable');
    }
    const executable = process.env.SOURDAW_TRUSTED_PS_PATH;
    if (typeof executable !== 'string' || executable === '') {
        fail('review-publication lock requires the trusted ps executable');
    }
    const result = spawnSync(executable, ['-e', '-o', 'pid=,pgid=,lstart='], {
        encoding: 'utf8',
        shell: false,
        env: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
    });
    if (result.error !== undefined || (result.status !== 0 && result.status !== 1)) {
        fail('review-publication lock process-group liveness is unreadable');
    }
    const rows = parsePosixProcessGroupRows(result.stdout);
    if (rows.length === 0) {
        fail('review-publication lock process-group liveness is unreadable');
    }
    const members = rows.filter((row) => row.pgid === pgid);
    if (members.length === 0) {
        return false;
    }
    const leader = members.find((row) => row.pid === pgid);
    if (leader === undefined) {
        return true;
    }
    return leader.startedAt === leaderStartedAt;
}

type PosixProcessGroupRow = { pid: number; pgid: number; startedAt: string };

function parsePosixProcessGroupRows(output: string): PosixProcessGroupRow[] {
    const lines = output.split('\n').filter((line) => line.trim() !== '');
    const rows: PosixProcessGroupRow[] = [];
    const seen = new Set<number>();
    for (const line of lines) {
        const match = /^\s*([1-9][0-9]*)\s+([1-9][0-9]*)\s+(.+?)\s*$/u.exec(line);
        if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
            fail('review-publication lock process-group liveness is unreadable');
        }
        const pid = Number(match[1]);
        const pgid = Number(match[2]);
        const startedAt = match[3].trim();
        if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(pgid) || startedAt === '' || seen.has(pid)) {
            fail('review-publication lock process-group liveness is unreadable');
        }
        seen.add(pid);
        rows.push({ pid, pgid, startedAt });
    }
    return rows;
}

type WindowsProcessRow = { pid: number; parentPid: number; startedAt: string };

const windowsProcessCreationIdentityProperty =
    "@{Name='CreationDate';Expression={$_.CreationDate.ToUniversalTime().ToString('O',[System.Globalization.CultureInfo]::InvariantCulture)}}";

function readTrustedWindowsProcessRows(): WindowsProcessRow[] {
    const executable = process.env.SOURDAW_TRUSTED_POWERSHELL_PATH;
    if (typeof executable !== 'string' || executable === '') {
        fail('review-publication lock requires the trusted PowerShell executable');
    }
    const result = spawnSync(
        executable,
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,${windowsProcessCreationIdentityProperty}) | ConvertTo-Json -Compress`,
        ],
        { encoding: 'utf8', shell: false, env: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC' }, maxBuffer: 8 * 1024 * 1024 }
    );
    if (result.error !== undefined || result.status !== 0 || result.stdout.trim() === '') {
        fail('review-publication lock Windows process liveness is unreadable');
    }
    return parseWindowsProcessRows(result.stdout);
}

function windowsProcessStartedAt(pid: number): string | undefined {
    return readTrustedWindowsProcessRows().find((row) => row.pid === pid)?.startedAt;
}

function parseWindowsProcessRows(output: string): WindowsProcessRow[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(output) as unknown;
    } catch {
        fail('review-publication lock Windows process liveness is unreadable');
    }
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const normalized: WindowsProcessRow[] = [];
    const seen = new Set<number>();
    for (const row of rows) {
        const candidate = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : undefined;
        if (candidate?.ProcessId === 0) {
            continue;
        }
        if (
            candidate === undefined ||
            !isPositiveSafeInteger(candidate.ProcessId) ||
            !isNonNegativeSafeInteger(candidate.ParentProcessId) ||
            typeof candidate.CreationDate !== 'string' ||
            parseWindowsProcessStartedAt(candidate.CreationDate) === undefined ||
            seen.has(candidate.ProcessId)
        ) {
            fail('review-publication lock Windows process liveness is unreadable');
        }
        seen.add(candidate.ProcessId);
        normalized.push({
            pid: candidate.ProcessId,
            parentPid: candidate.ParentProcessId,
            startedAt: candidate.CreationDate,
        });
    }
    return normalized;
}

function isPositiveSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseWindowsProcessStartedAt(value: string): bigint | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6,7})(Z|[+-]\d{2}:\d{2}|[+-]\d{3})$/.exec(
        value
    );
    if (match === null) {
        return undefined;
    }
    const [, year, month, day, hour, minute, second, microseconds, offsetIdentity] = match;
    if (
        year === undefined ||
        month === undefined ||
        day === undefined ||
        hour === undefined ||
        minute === undefined ||
        second === undefined ||
        microseconds === undefined ||
        offsetIdentity === undefined
    ) {
        return undefined;
    }
    const milliseconds = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        0
    );
    if (!Number.isSafeInteger(milliseconds)) {
        return undefined;
    }
    const normalized = new Date(milliseconds);
    if (
        normalized.getUTCFullYear() !== Number(year) ||
        normalized.getUTCMonth() !== Number(month) - 1 ||
        normalized.getUTCDate() !== Number(day) ||
        normalized.getUTCHours() !== Number(hour) ||
        normalized.getUTCMinutes() !== Number(minute) ||
        normalized.getUTCSeconds() !== Number(second)
    ) {
        return undefined;
    }
    const ticks = BigInt(milliseconds) * 10_000n + BigInt(microseconds.padEnd(7, '0'));
    if (offsetIdentity === 'Z') {
        return ticks;
    }
    const offset = /^([+-])(\d{2}):(\d{2})$/.exec(offsetIdentity);
    const compactOffset = /^([+-])(\d{3})$/.exec(offsetIdentity);
    const selectedOffset = offset ?? compactOffset;
    if (selectedOffset === null) {
        return undefined;
    }
    const offsetSign = selectedOffset[1];
    const offsetMinutes =
        offset === null ? Number(selectedOffset[2]) : Number(selectedOffset[2]) * 60 + Number(selectedOffset[3]);
    if (offsetMinutes > 23 * 60 + 59) {
        return undefined;
    }
    const offsetTicks = BigInt(offsetMinutes) * 60_000n * 10_000n;
    return offsetSign === '+' ? ticks - offsetTicks : ticks + offsetTicks;
}

function windowsProcessTreeIsLive(
    ownerFence: Extract<PullRequestMutationLockOwnerFence, { kind: 'win32-process-tree' }>
): boolean {
    const ownerStartedAt = parseWindowsProcessStartedAt(ownerFence.rootStartedAt);
    if (ownerStartedAt === undefined) {
        fail('review-publication lock Windows process liveness is unreadable');
    }
    const rows = readTrustedWindowsProcessRows();
    const root = rows.find((row) => row.pid === ownerFence.rootPid);
    if (root !== undefined) {
        const rootStartedAt = parseWindowsProcessStartedAt(root.startedAt);
        if (rootStartedAt === undefined) {
            fail('review-publication lock Windows process liveness is unreadable');
        }
        if (rootStartedAt === ownerStartedAt) {
            return true;
        }
        return hasPreReuseWindowsDescendant(rows, ownerFence.rootPid, ownerStartedAt, rootStartedAt);
    }
    return false;
}

function hasPreReuseWindowsDescendant(
    rows: WindowsProcessRow[],
    rootPid: number,
    ownerStartedAt: bigint,
    replacementRootStartedAt: bigint
): boolean {
    if (replacementRootStartedAt <= ownerStartedAt) {
        fail('review-publication lock Windows process liveness is unreadable');
    }
    for (const row of rows) {
        if (row.parentPid !== rootPid) {
            continue;
        }
        const startedAt = parseWindowsProcessStartedAt(row.startedAt);
        if (startedAt === undefined) {
            fail('review-publication lock Windows process liveness is unreadable');
        }
        if (startedAt > ownerStartedAt && startedAt < replacementRootStartedAt) {
            return true;
        }
        if (startedAt <= ownerStartedAt) {
            fail('review-publication lock Windows process liveness is unreadable');
        }
    }
    return false;
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
    const reviewPublication = options?.reviewPublication;
    if (reviewResolution !== undefined && reviewPublication !== undefined) {
        fail(`PR #${number} delivery lock cannot acquire two operation owners`);
    }
    let owner: PullRequestMutationLockOwner = { version: 1, pid: process.pid, token: randomUUID() };
    if (reviewResolution !== undefined) {
        owner = {
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
    }
    if (reviewPublication !== undefined) {
        owner = reviewPublicationLockOwner(number, reviewPublication);
    }
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

function reviewPublicationLockOwner(
    number: number,
    publication: NonNullable<PullRequestMutationLockOptions['reviewPublication']>
): Extract<PullRequestMutationLockOwner, { version: 3 }> {
    if (
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(publication.expectedHead) ||
        !/^[0-9a-f]{64}$/iu.test(publication.payloadDigest) ||
        publication.reviewerActorNodeId.trim() === ''
    ) {
        fail(`PR #${number} review-publication lock intent is malformed`);
    }
    const ownerFence = typeof publication.ownerFence === 'function' ? publication.ownerFence() : publication.ownerFence;
    if (
        !isExecutionFence(ownerFence) ||
        !isExecutionFenceBoundToOwnerPid(ownerFence, process.pid) ||
        !isPublicationOwnerFence(ownerFence)
    ) {
        fail(`PR #${number} review-publication lock fence is malformed`);
    }
    return {
        version: 3,
        pid: process.pid,
        token: randomUUID(),
        operation: 'review-publication',
        number,
        expectedHead: publication.expectedHead.toLowerCase(),
        payloadDigest: publication.payloadDigest.toLowerCase(),
        reviewerActorNodeId: publication.reviewerActorNodeId,
        ownerFence,
        mutation: { phase: 'prepared', epoch: 0 },
    };
}

function releaseMutationLock(primaryRoot: string, ref: string, oid: string, number: number): void {
    if (!updateMutationLockRef(primaryRoot, ['-d', ref, oid])) {
        fail(`PR #${number} delivery lock ownership changed before release`);
    }
}

async function withPullRequestMutationLockImplementation<Value>(
    primaryRoot: string,
    number: number,
    operation: (boundary: PullRequestReviewPublicationMutationBoundary) => Promise<Value>,
    options?: PullRequestMutationLockOptions
): Promise<Value> {
    const lock = acquireMutationLock(primaryRoot, number, options);
    let ownerOid = lock.oid;
    let remoteMutationAttempted = false;
    let succeeded = false;
    let successfulCompletion: (() => void) | undefined;
    try {
        const result = await operation({
            get ownerOid() {
                return ownerOid;
            },
            markRemoteMutationAttempt: () => {
                const currentOwner = readPullRequestMutationLockOwner(primaryRoot, ownerOid, number);
                if (isReviewPublicationPullRequestMutationLockOwner(currentOwner)) {
                    if (currentOwner.mutation.phase !== 'prepared') {
                        fail(`PR #${number} review-publication lock already records a remote mutation attempt`);
                    }
                    ownerOid = replacePullRequestMutationLockOwner(primaryRoot, number, ownerOid, {
                        ...currentOwner,
                        mutation: { phase: 'remote-mutation-attempted', epoch: currentOwner.mutation.epoch + 1 },
                    });
                }
                remoteMutationAttempted = true;
            },
            journalReviewPublication: ({ expectedHead, payloadDigest, reviewerActorNodeId }) => {
                if (readPullRequestMutationLockOid(primaryRoot, lock.ref, number) !== ownerOid) {
                    fail(`PR #${number} review-publication lock ownership changed before payload validation`);
                }
                const currentOwner = readPullRequestMutationLockOwner(primaryRoot, ownerOid, number);
                if (
                    !isReviewPublicationPullRequestMutationLockOwner(currentOwner) ||
                    currentOwner.mutation.phase !== 'prepared' ||
                    currentOwner.expectedHead !== expectedHead.toLowerCase() ||
                    currentOwner.payloadDigest !== payloadDigest.toLowerCase() ||
                    currentOwner.reviewerActorNodeId !== reviewerActorNodeId
                ) {
                    fail(`PR #${number} review-publication lock does not match the prepared payload`);
                }
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
        } else if (succeeded || (!remoteMutationAttempted && successfulCompletion === undefined)) {
            releaseMutationLock(primaryRoot, lock.ref, ownerOid, number);
        }
    }
}

export function withPullRequestMutationLock<Value>(
    primaryRoot: string,
    number: number,
    operation: (boundary: PullRequestRemoteMutationBoundary) => Promise<Value>,
    options?: PullRequestMutationLockOptions
): Promise<Value> {
    return withPullRequestMutationLockImplementation(primaryRoot, number, operation, options);
}

export function withPullRequestReviewPublicationMutationLock<Value>(
    primaryRoot: string,
    number: number,
    operation: (boundary: PullRequestReviewPublicationMutationBoundary) => Promise<Value>,
    options: PullRequestMutationLockOptions & {
        reviewPublication: NonNullable<PullRequestMutationLockOptions['reviewPublication']>;
    }
): Promise<Value> {
    return withPullRequestMutationLockImplementation(primaryRoot, number, operation, options);
}
