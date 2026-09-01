#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_NODE_ID,
    REQUIRED_REPOSITORY,
    REVIEWER_BOT_NODE_ID,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isAuthorBotNodeId,
    isReviewerBotNodeId,
    originMainBlob,
    parseGraphqlResponse,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import {
    isReviewResolutionPullRequestMutationLockOwner,
    type PullRequestMutationSerialization,
    type PullRequestMutationLockOwnerFence,
    type PullRequestRemoteMutationBoundary,
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockOwner,
    withPullRequestMutationLock,
    writePullRequestMutationLockOwner,
} from './pullRequestMutationLock.ts';

export type ReviewComment = {
    id: string;
    fullDatabaseId: string;
    body: string;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
    reviewId: string | null;
    reviewFullDatabaseId?: string | null;
    reviewState: string | null;
    reviewBody: string | null;
    reviewCommitOid: string | null;
    reviewAuthorNodeId: string | null;
    reviewAuthorLogin: string | null;
    reviewAuthorType: string | null;
};
export type PullRequestReview = {
    id: string;
    fullDatabaseId?: string | null;
    state: string;
    body: string;
    commitOid: string | null;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
};
export type ReviewThread = {
    id: string;
    isResolved: boolean;
    resolvedByNodeId: string | null;
    resolvedByLogin: string | null;
    resolvedByType: string | null;
    rootCommentId: string | null;
    rootCommentFullDatabaseId: string | null;
    rootAuthorNodeId: string | null;
    rootAuthorLogin: string | null;
    rootAuthorType: string | null;
    comments: ReviewComment[];
};
export type ReviewThreadInspection = {
    pullRequestId: string;
    head: string;
    thread: ReviewThread | null;
    pendingReviews: PullRequestReview[];
};
export type ReviewReply = {
    id: string;
    fullDatabaseId: string;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
    reviewId: string | null;
    reviewFullDatabaseId?: string | null;
    reviewState: string | null;
    reviewBody: string | null;
    reviewCommitOid: string | null;
    reviewAuthorNodeId: string | null;
    reviewAuthorLogin: string | null;
    reviewAuthorType: string | null;
    clientMutationId: string;
};
export type ReviewEnvelopeReceipt = PullRequestReview & { clientMutationId: string };
export type ReviewResolutionReceipt = {
    resolvedByNodeId: string;
    resolvedByLogin: string;
    resolvedByType: string;
    clientMutationId: string;
};
type ReviewResolutionMarkerSnapshot = {
    markerId: string;
    markerFullDatabaseId: string;
    reviewId: string;
    reviewFullDatabaseId: string;
    reviewState: string;
    reviewBody: string;
    reviewCommitOid: string;
    reviewAuthorNodeId: string | null;
    reviewAuthorLogin: string | null;
    reviewAuthorType: string | null;
};
type ReviewResolutionSettledReply = {
    replyId: string;
    reviewId: string;
    reviewState: 'PENDING' | 'COMMENTED';
};
export type ReviewResolutionLockMutation =
    | { phase: 'idle'; epoch: number }
    | { phase: 'createPendingReview'; epoch: number; pullRequestId: string; body: string; reviewCommitOid: string }
    | {
          phase: 'createPendingReviewSettlement';
          epoch: number;
          pullRequestId: string;
          body: string;
          reviewCommitOid: string;
          pendingReviewIds: string[];
          settleAtMs: number;
          replayed: boolean;
      }
    | {
          phase: 'replyDone';
          epoch: number;
          reviewId: string;
          reviewState: 'PENDING';
          body: string;
          reviewCommitOid: string;
      }
    | {
          phase: 'replyDoneSettlement';
          epoch: number;
          reviewId: string;
          body: string;
          reviewCommitOid: string;
          replies: ReviewResolutionSettledReply[];
          settleAtMs: number;
          replayed: boolean;
      }
    | { phase: 'submitReview'; epoch: number; reviewId: string; body: string; reviewCommitOid: string }
    | {
          phase: 'updateReviewBody';
          epoch: number;
          reviewId: string;
          reviewDatabaseId?: string;
          body: string;
          reviewCommitOid: string;
          marker?: ReviewResolutionMarkerSnapshot;
      }
    | { phase: 'resolveThread'; epoch: number }
    | {
          phase: 'deleteReply';
          epoch: number;
          replyId: string;
          immutableEnvelope?: ReviewResolutionMarkerSnapshot;
          target?: ReviewResolutionMarkerSnapshot;
      }
    | {
          phase: 'deletePendingReview';
          epoch: number;
          reviewId: string;
          allowedAttachedThreadIds: string[];
          snapshotHead: string;
      };
type LegacyReviewResolutionLockMutation =
    | { phase: 'idle'; epoch: number }
    | { phase: 'createPendingReview'; epoch: number }
    | { phase: 'createPendingReviewSettlement'; epoch: number; pendingReviewIds: string[]; settleAtMs: number }
    | { phase: 'replyDone'; epoch: number; reviewId: string }
    | {
          phase: 'replyDoneSettlement';
          epoch: number;
          reviewId: string;
          replies: ReviewResolutionSettledReply[];
          settleAtMs: number;
      }
    | { phase: 'submitReview'; epoch: number; reviewId: string; body: string }
    | { phase: 'updateReviewBody'; epoch: number; reviewId: string; body: string }
    | { phase: 'resolveThread'; epoch: number }
    | { phase: 'deleteReply'; epoch: number; replyId: string }
    | {
          phase: 'deletePendingReview';
          epoch: number;
          reviewId: string;
          allowedAttachedThreadIds: string[];
          snapshotHead: string;
      };
type ReviewResolutionLockMutationUpdate = ReviewResolutionLockMutation extends infer Mutation
    ? Mutation extends { epoch: number }
        ? Omit<Mutation, 'epoch'>
        : never
    : never;
export type DeletePendingReviewOptions = {
    allowedAttachedThreadIds?: string[];
    snapshotHead?: string;
};
export type ReviewResolutionLockOwnerFence = PullRequestMutationLockOwnerFence;
type ReviewResolutionLockOwnerBase = {
    pid: number;
    ownerFence: ReviewResolutionLockOwnerFence;
    threadId: string;
    head: string;
    token: string;
    mutation: ReviewResolutionLockMutation;
};
type SingleRefReviewResolutionLockOwner = ReviewResolutionLockOwnerBase & {
    version: 5;
};
type DualRefReviewResolutionLockOwner = ReviewResolutionLockOwnerBase & {
    version: 6;
    sharedMutationOwnerOid: string;
};
type CurrentReviewResolutionLockOwner = SingleRefReviewResolutionLockOwner | DualRefReviewResolutionLockOwner;
type LegacyReviewResolutionLockOwner = {
    version: 2 | 3 | 4;
    pid: number;
    ownerFence: ReviewResolutionLockOwnerFence;
    threadId: string;
    head: string;
    token: string;
    mutation: LegacyReviewResolutionLockMutation;
    legacyMutation: true;
    legacyUnjournaled?: true;
};
export type ReviewResolutionLockOwner = CurrentReviewResolutionLockOwner | LegacyReviewResolutionLockOwner;
export type ReviewResolutionTrustedLauncher = {
    primaryRoot: string;
    gitPath: string;
    ghPath: string;
    psPath?: string;
    powershellPath?: string;
};
export type ReviewResolutionRecoveryClock = {
    now: () => number;
};
export type ReviewResolutionRetirementClock = {
    monotonicNow: () => bigint;
    wait: (milliseconds: number) => void;
};
export type ReviewResolutionRecoveryResult = { kind: 'reconciled'; inspection: ReviewThreadInspection };
export type ResolveReviewThreadPort = {
    inspect: (number: number, threadId: string) => ReviewThreadInspection;
    inspectPullRequestReview: (
        number: number,
        reviewId: string,
        expectedPullRequestId: string,
        expectedHead: string
    ) => PullRequestReview | null;
    inspectAttachedReviewThreadIds: (
        number: number,
        reviewId: string,
        expectedPullRequestId: string,
        expectedHead: string
    ) => string[];
    createPendingReview: (pullRequestId: string, commitOid: string, body: string) => ReviewEnvelopeReceipt;
    replyDone: (threadId: string, reviewId: string, review: PullRequestReview) => ReviewReply;
    submitReview: (reviewId: string, body: string, reviewCommitOid: string) => ReviewEnvelopeReceipt;
    updateReviewBody: (
        reviewId: string,
        body: string,
        reviewCommitOid: string,
        expectedReview?: PullRequestReview,
        expectedMarker?: ReviewComment
    ) => ReviewEnvelopeReceipt;
    resolve: (threadId: string) => ReviewResolutionReceipt;
    deleteReply: (replyId: string, immutableEnvelope?: ManagedReplyMarker, target?: ManagedReplyMarker) => void;
    deletePendingReview: (reviewId: string, options?: DeletePendingReviewOptions) => void;
    serializeReviewThreadMutation: <Value>(
        number: number,
        threadId: string,
        expectedHead: string,
        operation: () => Value
    ) => Value;
    log: (message: string) => void;
};
export type ResolveReviewThreadAuthentication = {
    minted: { actorNodeId: string };
    session: GhSession;
};
export type ResolveReviewThreadCoordinatorDependencies = {
    primaryRoot: () => string;
    serializeMutation: PullRequestMutationSerialization;
    authenticateAuthor: (primaryRoot: string) => Promise<ResolveReviewThreadAuthentication>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    threadPort: (
        session: GhSession,
        primaryRoot: string,
        markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt'],
        sharedMutationOwnerOid: string,
        registerSuccessfulCompletion: PullRequestRemoteMutationBoundary['registerSuccessfulCompletion']
    ) => ResolveReviewThreadPort;
    resolve: (
        number: number,
        threadId: string,
        expectedHead: string,
        authorNodeId: string,
        port: ResolveReviewThreadPort
    ) => string;
};
export type ResolveReviewThreadArgs = { number?: number; threadId?: string; head?: string; help: boolean };
export type ResolveReviewThreadCliDependencies = {
    trustedLauncher: ReviewResolutionTrustedLauncher;
    serializeMutation?: PullRequestMutationSerialization;
    authenticateAuthor?: (primaryRoot: string) => Promise<{
        minted: { actorNodeId: string };
        session: GhSession;
    }>;
    repositoryName?: (session: GhSession, primaryRoot: string) => string;
    createPort?: (
        session: GhSession,
        primaryRoot: string,
        markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt'],
        sharedMutationOwnerOid: string,
        registerSuccessfulCompletion: PullRequestRemoteMutationBoundary['registerSuccessfulCompletion']
    ) => ResolveReviewThreadPort;
};
const usage = 'usage: pnpm review:resolve <pr-number> --thread <graphql-thread-node-id> --head <40-hex-sha>';
const RESOLUTION_REVIEW_SUMMARY = 'Resolved this review thread after applying the requested changes.';
const REVIEW_RESOLUTION_LOCK_TOKEN_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FORTY_HEX_PATTERN = /^[0-9a-f]{40}$/iu;
const SIXTY_FOUR_HEX_PATTERN = /^[0-9a-f]{64}$/iu;
type ResolutionReviewContext = {
    pullRequestId: string;
    threadId: string;
    expectedHead: string;
};
type ManagedReplyMarker = {
    marker: ReviewComment;
    review: PullRequestReview;
    currentHead: boolean;
};
type ReviewResolutionExecutionFence = {
    pid: number;
    ownerFence: ReviewResolutionLockOwnerFence;
};
type ActiveReviewResolutionLock = {
    primaryRoot: string;
    number: number;
    ref: string;
    oid: string;
    owner: CurrentReviewResolutionLockOwner;
};
type ReviewResolutionLockInspectionPort = {
    readOid?: (primaryRoot: string, ref: string, number: number) => string | undefined;
    acquireRef?: (primaryRoot: string, args: string[]) => boolean;
    release?: (primaryRoot: string, ref: string, oid: string, number: number) => void;
    executionFence?: ReviewResolutionExecutionFence;
    platform?: NodeJS.Platform;
    sharedMutationOwnerOid?: string;
    registerSuccessfulCompletion?: PullRequestRemoteMutationBoundary['registerSuccessfulCompletion'];
};
type ReviewResolutionLockRecoveryPort = {
    updateRef?: (primaryRoot: string, args: string[]) => boolean;
    updateRefsTransaction?: (primaryRoot: string, commands: string[]) => boolean;
    releaseRefsTransaction?: (primaryRoot: string, commands: string[]) => boolean;
    executionFence?: ReviewResolutionExecutionFence;
    platform?: NodeJS.Platform;
};
export const REVIEW_RESOLUTION_CHILD_ENV = 'SOURDAW_REVIEW_RESOLUTION_CHILD';
const REVIEW_RESOLUTION_CHILD_MARKER_VERSION = 1;
const TRUSTED_GIT_PATH_ENV = 'SOURDAW_TRUSTED_GIT_PATH';
const TRUSTED_PS_PATH_ENV = 'SOURDAW_TRUSTED_PS_PATH';
const TRUSTED_POWERSHELL_PATH_ENV = 'SOURDAW_TRUSTED_POWERSHELL_PATH';
const TRUSTED_ORIGIN_COMMIT_ENV = 'SOURDAW_TRUSTED_ORIGIN_COMMIT';
const activeReviewResolutionLocks: ActiveReviewResolutionLock[] = [];
const systemReviewResolutionRecoveryClock: ReviewResolutionRecoveryClock = { now: () => Date.now() };
const REVIEW_RESOLUTION_SETTLEMENT_WINDOW_MS = 30_000;
const REVIEW_RESOLUTION_SETTLEMENT_WINDOW_NS = BigInt(REVIEW_RESOLUTION_SETTLEMENT_WINDOW_MS) * 1_000_000n;
const systemReviewResolutionRetirementClock: ReviewResolutionRetirementClock = {
    monotonicNow: () => process.hrtime.bigint(),
    wait: (milliseconds) => {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, milliseconds);
    },
};

type ReviewResolutionChildLaunchMarker = {
    path: string;
    token: string;
};

export type PersistedReviewResolutionChildLaunchMarker = {
    version: 1;
    token: string;
    pid: number | null;
    capabilityPath: string;
};
type PersistedReviewResolutionBootstrapCapability = {
    version: 1;
    token: string;
    trustedLauncher: ReviewResolutionTrustedLauncher;
};

type ReviewResolutionChildMarkerPublicationPort = {
    randomUuid?: () => string;
    writeFileSync?: typeof writeFileSync;
    renameSync?: typeof renameSync;
    rmSync?: typeof rmSync;
};
type ReviewResolutionChildValidationPort = {
    executionFence?: ReviewResolutionExecutionFence;
    platform?: NodeJS.Platform;
    sleep?: (ms: number) => Promise<void>;
};
type ReviewResolutionLivenessProbe = (target: number) => void;
type WindowsProcessQueryRunner = typeof spawnSync;
type WindowsProcessRow = {
    pid: number;
    parentPid: number;
    startedAt: string;
};
type ReviewResolutionOwnerFenceLivenessPort = {
    platform?: NodeJS.Platform;
    probe?: ReviewResolutionLivenessProbe;
    inspectPosixGroupLeader?: (pgid: number) => string | undefined | null;
    inspectWindowsProcessRows?: () => WindowsProcessRow[] | undefined;
    runWindowsProcessQuery?: WindowsProcessQueryRunner;
    windowsProcessQueryEnv?: NodeJS.ProcessEnv;
};

function canonicalGitObjectId(value: string, label: string, lengths: number[] = [40]): string {
    const trimmed = value.trim();
    const valid =
        (lengths.includes(40) && FORTY_HEX_PATTERN.test(trimmed)) ||
        (lengths.includes(64) && SIXTY_FOUR_HEX_PATTERN.test(trimmed));
    if (!valid) {
        fail(label);
    }
    return trimmed.toLowerCase();
}

function invalidReviewResolutionChildMarker(): never {
    fail('review:resolve detached launcher marker is invalid');
}

function invalidReviewResolutionBootstrapCapability(): never {
    fail('review:resolve must run through the protected primary checkout launcher');
}

function isPositiveSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function assertTrustedReviewResolutionLauncher(
    value: unknown,
    label: string = 'review:resolve must run through the protected primary checkout launcher',
    platform: NodeJS.Platform = process.platform
): ReviewResolutionTrustedLauncher {
    const psPath =
        typeof value === 'object' && value !== null && 'psPath' in value && typeof value.psPath === 'string'
            ? value.psPath
            : undefined;
    const powershellPath =
        typeof value === 'object' &&
        value !== null &&
        'powershellPath' in value &&
        typeof value.powershellPath === 'string'
            ? value.powershellPath
            : undefined;
    if (
        typeof value !== 'object' ||
        value === null ||
        !('primaryRoot' in value) ||
        typeof value.primaryRoot !== 'string' ||
        value.primaryRoot.trim() === '' ||
        !isAbsolute(value.primaryRoot) ||
        normalize(value.primaryRoot) !== value.primaryRoot ||
        !('gitPath' in value) ||
        typeof value.gitPath !== 'string' ||
        value.gitPath.trim() === '' ||
        !isAbsolute(value.gitPath) ||
        normalize(value.gitPath) !== value.gitPath ||
        !('ghPath' in value) ||
        typeof value.ghPath !== 'string' ||
        value.ghPath.trim() === '' ||
        !isAbsolute(value.ghPath) ||
        normalize(value.ghPath) !== value.ghPath ||
        (platform !== 'win32' && psPath === undefined) ||
        (platform === 'win32' && powershellPath === undefined) ||
        (psPath !== undefined && (psPath.trim() === '' || !isAbsolute(psPath) || normalize(psPath) !== psPath)) ||
        (powershellPath !== undefined &&
            (powershellPath.trim() === '' ||
                !isAbsolute(powershellPath) ||
                normalize(powershellPath) !== powershellPath))
    ) {
        fail(label);
    }
    return {
        primaryRoot: value.primaryRoot,
        gitPath: value.gitPath,
        ghPath: value.ghPath,
        ...(psPath === undefined ? {} : { psPath }),
        ...(powershellPath === undefined ? {} : { powershellPath }),
    };
}

export function requiredTrustedReviewResolutionOriginCommit(
    label: string = 'review:resolve must run through the protected primary checkout launcher'
): string {
    const value = process.env[TRUSTED_ORIGIN_COMMIT_ENV];
    if (typeof value !== 'string' || value.trim() === '') {
        fail(label);
    }
    return canonicalGitObjectId(value, label);
}

function parseReviewResolutionChildLaunchMarker(value: string): ReviewResolutionChildLaunchMarker {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value) as unknown;
    } catch {
        invalidReviewResolutionChildMarker();
    }
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('path' in parsed) ||
        typeof parsed.path !== 'string' ||
        parsed.path.trim() === '' ||
        !isAbsolute(parsed.path) ||
        normalize(parsed.path) !== parsed.path ||
        !('token' in parsed) ||
        typeof parsed.token !== 'string' ||
        !REVIEW_RESOLUTION_LOCK_TOKEN_PATTERN.test(parsed.token)
    ) {
        invalidReviewResolutionChildMarker();
    }
    return { path: parsed.path, token: parsed.token };
}

export function readPersistedReviewResolutionChildLaunchMarker(
    marker: ReviewResolutionChildLaunchMarker
): PersistedReviewResolutionChildLaunchMarker {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(marker.path, 'utf8')) as unknown;
    } catch {
        invalidReviewResolutionChildMarker();
    }
    const pid = typeof parsed === 'object' && parsed !== null && 'pid' in parsed ? parsed.pid : undefined;
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Object.keys(parsed).length !== 4 ||
        !('version' in parsed) ||
        parsed.version !== REVIEW_RESOLUTION_CHILD_MARKER_VERSION ||
        !('token' in parsed) ||
        parsed.token !== marker.token ||
        !('capabilityPath' in parsed) ||
        typeof parsed.capabilityPath !== 'string' ||
        parsed.capabilityPath.trim() === '' ||
        !isAbsolute(parsed.capabilityPath) ||
        normalize(parsed.capabilityPath) !== parsed.capabilityPath ||
        pid === undefined ||
        (pid !== null && !isPositiveSafeInteger(pid))
    ) {
        invalidReviewResolutionChildMarker();
    }
    return {
        version: REVIEW_RESOLUTION_CHILD_MARKER_VERSION,
        token: marker.token,
        pid,
        capabilityPath: parsed.capabilityPath,
    };
}

function readPersistedReviewResolutionBootstrapCapability(
    path: string,
    token: string,
    platform: NodeJS.Platform = process.platform
): PersistedReviewResolutionBootstrapCapability {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
        invalidReviewResolutionBootstrapCapability();
    }
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Object.keys(parsed).length !== 3 ||
        !('version' in parsed) ||
        parsed.version !== 1 ||
        !('token' in parsed) ||
        parsed.token !== token ||
        !('trustedLauncher' in parsed)
    ) {
        invalidReviewResolutionBootstrapCapability();
    }
    return {
        version: 1,
        token,
        trustedLauncher: assertTrustedReviewResolutionLauncher(
            parsed.trustedLauncher,
            'review:resolve must run through the protected primary checkout launcher',
            platform
        ),
    };
}

export function publishReviewResolutionChildLaunchMarker(
    path: string,
    token: string,
    pid: number | null,
    capabilityPath: string,
    port: ReviewResolutionChildMarkerPublicationPort = {}
): void {
    const persisted: PersistedReviewResolutionChildLaunchMarker = {
        version: REVIEW_RESOLUTION_CHILD_MARKER_VERSION,
        token,
        pid,
        capabilityPath,
    };
    const temporaryPath = `${path}.${(port.randomUuid ?? randomUUID)()}.tmp`;
    const write = port.writeFileSync ?? writeFileSync;
    const move = port.renameSync ?? renameSync;
    const remove = port.rmSync ?? rmSync;
    try {
        write(temporaryPath, JSON.stringify(persisted), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        move(temporaryPath, path);
    } catch (error) {
        remove(temporaryPath, { force: true });
        throw error;
    }
}

function createReviewResolutionChildLaunchMarker(trustedLauncher: ReviewResolutionTrustedLauncher): {
    envValue: string;
    bindChildPid: (pid: number) => void;
    cleanup: () => void;
} {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-'));
    const path = join(root, 'child-marker.json');
    const capabilityPath = join(root, 'bootstrap-capability.json');
    const token = randomUUID();
    const capability: PersistedReviewResolutionBootstrapCapability = {
        version: 1,
        token,
        trustedLauncher,
    };
    writeFileSync(capabilityPath, JSON.stringify(capability), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    publishReviewResolutionChildLaunchMarker(path, token, null, capabilityPath);
    return {
        envValue: JSON.stringify({ path, token }),
        bindChildPid: (pid) => {
            if (!Number.isSafeInteger(pid) || pid <= 0) {
                invalidReviewResolutionChildMarker();
            }
            publishReviewResolutionChildLaunchMarker(path, token, pid, capabilityPath);
        },
        cleanup: () => {
            rmSync(root, { recursive: true, force: true });
        },
    };
}

function resolveReviewThreadCliDependencies(
    dependencies: ResolveReviewThreadCliDependencies | undefined,
    trustedLauncherOverride?: ReviewResolutionTrustedLauncher
): Required<ResolveReviewThreadCliDependencies> {
    const trustedLauncher = trustedLauncherOverride ?? dependencies?.trustedLauncher;
    if (trustedLauncher === undefined) {
        fail('review:resolve must run through the protected primary checkout launcher');
    }
    const resolvedLauncher = assertTrustedReviewResolutionLauncher(trustedLauncher);
    return {
        trustedLauncher: resolvedLauncher,
        serializeMutation: dependencies?.serializeMutation ?? withPullRequestMutationLock,
        authenticateAuthor:
            dependencies?.authenticateAuthor ?? ((primaryRoot) => authenticateRole({ primaryRoot, role: 'author' })),
        repositoryName:
            dependencies?.repositoryName ??
            ((session, primaryRoot) =>
                spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                    env: session.env,
                    cwd: primaryRoot,
                })),
        createPort:
            dependencies?.createPort ??
            ((session, primaryRoot, markRemoteMutationAttempt, sharedMutationOwnerOid, registerSuccessfulCompletion) =>
                shellPort(
                    session,
                    primaryRoot,
                    markRemoteMutationAttempt,
                    spawnCapture,
                    sharedMutationOwnerOid,
                    registerSuccessfulCompletion
                )),
    };
}

export function parseResolveReviewThreadArgs(args: string[]): ResolveReviewThreadArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    if (
        args.length !== 5 ||
        args[1] !== '--thread' ||
        args[3] !== '--head' ||
        args[0] === undefined ||
        args[2] === undefined ||
        args[4] === undefined ||
        !/^[1-9][0-9]*$/.test(args[0]) ||
        !/^\S+$/.test(args[2]) ||
        !FORTY_HEX_PATTERN.test(args[4])
    ) {
        fail(usage);
    }
    const number = Number(args[0]);
    if (!Number.isSafeInteger(number)) {
        fail(usage);
    }
    return { number, threadId: args[2], head: canonicalGitObjectId(args[4], usage), help: false };
}

export function resolveReviewThread(
    number: number,
    threadId: string,
    expectedHead: string,
    authorNodeId: string,
    port: ResolveReviewThreadPort
): string {
    if (!isAuthorBotNodeId(authorNodeId)) {
        fail(`authenticated author actor ${authorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
    }
    const canonicalHead = canonicalGitObjectId(expectedHead, usage);
    return port.serializeReviewThreadMutation(number, threadId, canonicalHead, () =>
        resolveReviewThreadWithinMutation(number, threadId, canonicalHead, port)
    );
}

function resolveReviewThreadWithinMutation(
    number: number,
    threadId: string,
    expectedHead: string,
    port: ResolveReviewThreadPort
): string {
    const before = port.inspect(number, threadId);
    assertExpectedHead(before.head, expectedHead);
    const context = resolutionReviewContext(before.pullRequestId, threadId, expectedHead);
    if (before.thread?.isResolved) {
        const immutableEmptySubmittedReview = repairCompletedResolution(number, before, context, port);
        if (immutableEmptySubmittedReview) {
            return logImmutableEmptySubmittedReviewReconciliation(number, threadId, port);
        }
        return logResolutionSuccess(number, threadId, port);
    }
    assertResolvableThread(before.thread, threadId);
    assertManagedReplyMarkersReadable(before.thread!, context, ['PENDING', 'COMMENTED'], true);
    let pendingReviewCreateAttempted = false;
    let pendingReviewCreated = false;
    let pendingReviewDeleteAttempted = false;
    let replyAttempted = false;
    let replyCreated = false;
    let reviewUpdateAttempted = false;
    let reviewSubmitAttempted = false;
    let replyId: string | undefined;
    let resolveAttempted = false;
    let resolutionReceipt: ReviewResolutionReceipt | undefined;
    try {
        let working = before;
        const existingReply = findReusableReply(before.thread, context);
        if (existingReply === undefined) {
            let pendingReview = convergePendingReviews(number, working.pendingReviews, context, port);
            if (pendingReview === undefined) {
                const stalePendingReply = findStaleManagedPendingReply(working.thread, context);
                if (stalePendingReply !== undefined) {
                    let stalePendingReplyReview = stalePendingReply.review;
                    const stalePendingReplyCommitOid = requireReviewCommitOid(
                        stalePendingReplyReview,
                        `Done reply ${stalePendingReply.marker.id}`
                    );
                    if (stalePendingReplyReview.body.trim() === '') {
                        reviewUpdateAttempted = true;
                        assertExclusiveBackfillReviewAttachment(number, stalePendingReplyReview.id, context, port);
                        const updatedReview = port.updateReviewBody(
                            stalePendingReplyReview.id,
                            resolutionReviewBody(context, stalePendingReplyCommitOid),
                            stalePendingReplyCommitOid,
                            stalePendingReplyReview,
                            stalePendingReply.marker
                        );
                        assertProvenReviewBodyReceipt(
                            updatedReview,
                            stalePendingReplyReview,
                            resolutionReviewBody(context, stalePendingReplyCommitOid)
                        );
                        working = port.inspect(number, threadId);
                        assertExpectedHeadAfterMutation(working.head, expectedHead);
                        assertResolvableThread(working.thread, threadId);
                        const refreshedPendingReply = findManagedReplyMarkerByReviewId(
                            working.thread,
                            context,
                            stalePendingReplyReview.id,
                            ['PENDING', 'COMMENTED'],
                            true
                        );
                        if (refreshedPendingReply === undefined) {
                            fail(
                                `Done reply ${stalePendingReply.marker.id} is no longer attached to a valid author review`
                            );
                        }
                        stalePendingReplyReview = refreshedPendingReply.review;
                    }
                    if (stalePendingReplyReview.state === 'PENDING') {
                        assertReusablePendingReviewAttachment(number, stalePendingReplyReview.id, context, port);
                        reviewSubmitAttempted = true;
                        const submittedStalePendingReplyReview = port.submitReview(
                            stalePendingReplyReview.id,
                            resolutionReviewBody(context, stalePendingReplyCommitOid),
                            stalePendingReplyCommitOid
                        );
                        assertReviewEnvelopeReceipt(
                            submittedStalePendingReplyReview,
                            submitReviewClientMutationId(stalePendingReplyReview.id),
                            'COMMENTED',
                            resolutionReviewBody(context, stalePendingReplyCommitOid),
                            stalePendingReplyCommitOid,
                            'submit review'
                        );
                        working = port.inspect(number, threadId);
                        assertExpectedHeadAfterMutation(working.head, expectedHead);
                        assertResolvableThread(working.thread, threadId);
                    }
                    pendingReview = convergePendingReviews(number, working.pendingReviews, context, port);
                }
            }
            if (pendingReview === undefined) {
                if (findRetirableStaleUnattachedPendingReview(working.pendingReviews, working.thread!, context)) {
                    pendingReviewDeleteAttempted = true;
                    const retired = retireRetirableStaleUnattachedPendingReview(
                        number,
                        threadId,
                        working,
                        context,
                        port
                    );
                    working = retired.working;
                    assertResolvableThread(working.thread, threadId);
                    assertManagedReplyMarkersReadable(working.thread!, context, ['PENDING', 'COMMENTED'], true);
                    pendingReview = convergePendingReviews(number, working.pendingReviews, context, port);
                }
            }
            if (
                pendingReview === undefined &&
                hasBlockingAuthorPendingReview(working.pendingReviews, working.thread!, context)
            ) {
                fail(`review thread ${threadId} has a non-reusable pending author review`);
            }
            if (pendingReview === undefined) {
                pendingReviewCreateAttempted = true;
                const created = port.createPendingReview(
                    working.pullRequestId,
                    expectedHead,
                    resolutionReviewBody(context, expectedHead)
                );
                assertReviewEnvelopeReceipt(
                    created,
                    createReviewClientMutationId(threadId),
                    'PENDING',
                    resolutionReviewBody(context, expectedHead),
                    expectedHead,
                    'create pending review'
                );
                pendingReviewCreated = true;
                working = port.inspect(number, threadId);
                assertExpectedHeadAfterMutation(working.head, expectedHead);
                assertResolvableThread(working.thread, threadId);
                pendingReview = convergePendingReviews(number, working.pendingReviews, context, port);
            }
            if (pendingReview === undefined) {
                fail(`review thread ${threadId} has no reusable pending author review`);
            }
            assertReusablePendingReviewAttachment(number, pendingReview.id, context, port);
            replyAttempted = true;
            const reply = port.replyDone(threadId, pendingReview.id, pendingReview);
            assertReply(reply, replyClientMutationId(threadId), pendingReview.id, context);
            replyId = reply.id;
            replyCreated = true;
        } else {
            replyId = existingReply.id;
        }
        const afterReply = port.inspect(number, threadId);
        assertExpectedHeadAfterMutation(afterReply.head, expectedHead);
        assertResolvableThread(afterReply.thread, threadId);
        reviewUpdateAttempted =
            repairManagedCommentedReviewEnvelopes(
                number,
                threadId,
                afterReply.thread,
                port,
                context,
                ['COMMENTED'],
                () => {
                    reviewUpdateAttempted = true;
                }
            ) || reviewUpdateAttempted;
        let replyInspection = reviewUpdateAttempted ? port.inspect(number, threadId) : afterReply;
        if (reviewUpdateAttempted) {
            assertExpectedHeadAfterMutation(replyInspection.head, expectedHead);
            assertResolvableThread(replyInspection.thread, threadId);
        }
        let canonical = requireCanonicalManagedReplyMarker(
            replyInspection.thread!,
            threadId,
            context,
            ['PENDING', 'COMMENTED'],
            true
        );
        let canonicalReply = canonical.marker;
        let canonicalReview = canonical.review;
        if (canonicalReview.body.trim() === '') {
            reviewUpdateAttempted = true;
            const canonicalReviewCommitOid = requireReviewCommitOid(canonicalReview, `Done reply ${canonicalReply.id}`);
            assertExclusiveBackfillReviewAttachment(number, canonicalReview.id, context, port);
            const updatedReview = port.updateReviewBody(
                canonicalReview.id,
                resolutionReviewBody(context, canonicalReviewCommitOid),
                canonicalReviewCommitOid,
                canonicalReview,
                canonicalReply
            );
            assertProvenReviewBodyReceipt(
                updatedReview,
                canonicalReview,
                resolutionReviewBody(context, canonicalReviewCommitOid)
            );
            replyInspection = port.inspect(number, threadId);
            assertExpectedHeadAfterMutation(replyInspection.head, expectedHead);
            assertResolvableThread(replyInspection.thread, threadId);
            canonical = requireCanonicalManagedReplyMarker(
                replyInspection.thread!,
                threadId,
                context,
                ['PENDING', 'COMMENTED'],
                true
            );
            canonicalReply = canonical.marker;
            canonicalReview = canonical.review;
        } else if (
            canonicalReview.body !==
            resolutionReviewBody(context, requireReviewCommitOid(canonicalReview, `Done reply ${canonicalReply.id}`))
        ) {
            fail(`Done reply ${canonicalReply.id} is attached to a noncanonical author review`);
        }
        if (canonicalReview.state === 'PENDING') {
            replyInspection = convergePendingReplyStateBeforeSubmit(
                number,
                replyInspection,
                context,
                canonicalReview.id,
                port
            );
            canonical = requireCanonicalManagedReplyMarker(
                replyInspection.thread!,
                threadId,
                context,
                ['PENDING', 'COMMENTED'],
                true
            );
            canonicalReply = canonical.marker;
            canonicalReview = canonical.review;
            assertReusablePendingReviewAttachment(number, canonicalReview.id, context, port);
            reviewSubmitAttempted = true;
            const canonicalReviewCommitOid = requireReviewCommitOid(canonicalReview, `Done reply ${canonicalReply.id}`);
            const submittedReview = port.submitReview(
                canonicalReview.id,
                resolutionReviewBody(context, canonicalReviewCommitOid),
                canonicalReviewCommitOid
            );
            canonicalReview = submittedReview;
            assertReviewEnvelopeReceipt(
                submittedReview,
                submitReviewClientMutationId(canonicalReview.id),
                'COMMENTED',
                resolutionReviewBody(context, canonicalReviewCommitOid),
                canonicalReviewCommitOid,
                'submit review'
            );
            replyInspection = port.inspect(number, threadId);
            assertExpectedHeadAfterMutation(replyInspection.head, expectedHead);
            assertResolvableThread(replyInspection.thread, threadId);
        }
        const pendingReviewDeleted = reconcilePendingReviewsForReply(
            number,
            replyInspection.pendingReviews,
            replyInspection.thread,
            context,
            port
        );
        reviewUpdateAttempted = pendingReviewDeleted || reviewUpdateAttempted;
        if (pendingReviewDeleted) {
            replyInspection = port.inspect(number, threadId);
            assertExpectedHeadAfterMutation(replyInspection.head, expectedHead);
            assertResolvableThread(replyInspection.thread, threadId);
        }
        replyId = convergeReplyMarkers(number, threadId, replyInspection.thread, port, context, ['COMMENTED']);
        const afterReview = port.inspect(number, threadId);
        assertExpectedHeadAfterMutation(afterReview.head, expectedHead);
        assertResolvableThread(afterReview.thread, threadId);
        assertCommentedResolutionReply(requireOneReplyMarker(afterReview.thread, threadId), context);
        resolveAttempted = true;
        const resolveReceipt = port.resolve(threadId);
        assertResolutionReceipt(resolveReceipt, resolveClientMutationId(threadId));
        resolutionReceipt = resolveReceipt;
        const verified = port.inspect(number, threadId);
        assertExpectedHeadAfterMutation(verified.head, expectedHead);
        assertFinalResolution(
            verified.thread,
            threadId,
            replyId,
            context,
            threadResolutionSnapshot(
                threadId,
                true,
                resolutionReceipt.resolvedByNodeId,
                resolutionReceipt.resolvedByLogin,
                resolutionReceipt.resolvedByType
            )
        );
    } catch (error) {
        compensateResolution(
            number,
            threadId,
            before,
            context,
            pendingReviewCreateAttempted,
            pendingReviewCreated,
            pendingReviewDeleteAttempted,
            replyAttempted,
            replyCreated,
            reviewUpdateAttempted,
            reviewSubmitAttempted,
            resolveAttempted,
            resolutionReceipt,
            port,
            error
        );
    }
    return logResolutionSuccess(number, threadId, port);
}

function logResolutionSuccess(number: number, threadId: string, port: ResolveReviewThreadPort): string {
    const success = `review-thread-resolved:${number}:${threadId}`;
    port.log(success);
    return success;
}

function logImmutableEmptySubmittedReviewReconciliation(
    number: number,
    threadId: string,
    port: ResolveReviewThreadPort
): string {
    const outcome = `review-thread-resolution-reconciled-immutable-empty-submitted-review:${number}:${threadId}`;
    port.log(outcome);
    return outcome;
}

function compensateResolution(
    number: number,
    threadId: string,
    before: ReviewThreadInspection,
    context: ResolutionReviewContext,
    pendingReviewCreateAttempted: boolean,
    pendingReviewCreated: boolean,
    pendingReviewDeleteAttempted: boolean,
    replyAttempted: boolean,
    replyCreated: boolean,
    reviewUpdateAttempted: boolean,
    reviewSubmitAttempted: boolean,
    resolveAttempted: boolean,
    resolutionReceipt: ReviewResolutionReceipt | undefined,
    port: ResolveReviewThreadPort,
    original: unknown
): never {
    const failures: string[] = [];
    let preservedAmbiguousPendingEvidence = false;
    let current: ReviewThreadInspection | undefined;
    attempt(failures, 'inspect ambiguous review transaction', () => {
        current = port.inspect(number, threadId);
    });
    if (current === undefined || current.thread === null || before.thread === null) {
        failures.push('cannot determine ambiguous review transaction state');
    } else {
        const canonicalCommentedReviewVisible = current.thread.comments.some((comment) =>
            hasCanonicalCommentedReview(comment, context)
        );
        const visibleReviewEvidence = reviewUpdateAttempted && canonicalCommentedReviewVisible;
        const submittedReviewEvidence = reviewSubmitAttempted && canonicalCommentedReviewVisible;
        const resolutionEvidence = resolutionReceipt !== undefined || resolveAttempted || current.thread.isResolved;
        if (resolutionEvidence) {
            failures.push('review-thread resolution was attempted; preserving Done reply as durable evidence');
        }
        if (submittedReviewEvidence) {
            failures.push('review submission was attempted; preserving submitted review evidence');
        } else if (reviewSubmitAttempted) {
            failures.push('review submission was attempted; preserving pending review evidence');
        } else if (visibleReviewEvidence) {
            failures.push('review body update was attempted; preserving submitted review evidence');
        } else if (canonicalCommentedReviewVisible) {
            failures.push('canonical commented review is already visible; preserving Done reply as durable evidence');
        }
        if (
            pendingReviewCreateAttempted &&
            !pendingReviewCreated &&
            !replyAttempted &&
            current.head !== context.expectedHead
        ) {
            preservedAmbiguousPendingEvidence =
                deleteAmbiguousCreatedPendingReview(
                    before.pendingReviews,
                    current.pendingReviews,
                    current.thread,
                    context,
                    port,
                    failures
                ) || preservedAmbiguousPendingEvidence;
        } else if (pendingReviewCreated && !replyAttempted) {
            failures.push(
                'created pending review is shareable after an ambiguous failure; preserving pending review evidence'
            );
        } else if (replyAttempted && !replyCreated) {
            failures.push('ambiguous review reply mutation; refusing to delete an unverified comment');
        } else if (replyCreated) {
            failures.push('ambiguous review reply mutation; preserving Done reply evidence');
        } else if (pendingReviewDeleteAttempted) {
            failures.push('pending review deletion was attempted; preserving current pending review evidence');
        } else if (
            !pendingReviewCreated &&
            current.pendingReviews.some((review) => isExactPendingReview(review, context))
        ) {
            failures.push('ambiguous pending review mutation; preserving exact pending review evidence');
        }
    }
    if (
        current !== undefined &&
        before.thread !== null &&
        !current.thread?.isResolved &&
        resolutionReceipt === undefined &&
        !pendingReviewCreated &&
        !pendingReviewDeleteAttempted &&
        !replyAttempted &&
        !reviewUpdateAttempted &&
        !reviewSubmitAttempted &&
        !preservedAmbiguousPendingEvidence
    ) {
        const beforeThread = before.thread;
        attempt(failures, 'verify review-thread compensation', () => {
            const verified = port.inspect(number, threadId);
            if (
                verified.thread === null ||
                verified.thread.isResolved !== beforeThread.isResolved ||
                !sameComments(verified.thread.comments, beforeThread.comments) ||
                !sameReviews(verified.pendingReviews, before.pendingReviews)
            ) {
                fail(`review thread ${threadId} compensation was not verified`);
            }
        });
    }
    throwWithCompensation(original, failures);
}

function sameComments(left: ReviewComment[], right: ReviewComment[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const commentsById = new Map(left.map((comment) => [comment.id, comment]));
    return (
        commentsById.size === right.length &&
        right.every((comment) => sameComment(commentsById.get(comment.id), comment))
    );
}
function sameComment(left: ReviewComment | undefined, right: ReviewComment): boolean {
    return (
        left?.fullDatabaseId === right.fullDatabaseId &&
        left.body === right.body &&
        left.authorNodeId === right.authorNodeId &&
        left.authorLogin === right.authorLogin &&
        left.authorType === right.authorType &&
        left.reviewId === right.reviewId &&
        left.reviewState === right.reviewState &&
        left.reviewBody === right.reviewBody &&
        left.reviewCommitOid === right.reviewCommitOid &&
        left.reviewAuthorNodeId === right.reviewAuthorNodeId &&
        left.reviewAuthorLogin === right.reviewAuthorLogin &&
        left.reviewAuthorType === right.reviewAuthorType
    );
}
function sameReviews(left: PullRequestReview[], right: PullRequestReview[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const reviewsById = new Map(left.map((review) => [review.id, review]));
    return reviewsById.size === right.length && right.every((review) => sameReview(reviewsById.get(review.id), review));
}
function sameReview(left: PullRequestReview | undefined, right: PullRequestReview): boolean {
    return (
        left?.state === right.state &&
        left.body === right.body &&
        left.commitOid === right.commitOid &&
        left.authorNodeId === right.authorNodeId &&
        left.authorLogin === right.authorLogin &&
        left.authorType === right.authorType
    );
}
function throwWithCompensation(original: unknown, failures: string[]): never {
    const message = errorMessage(original);
    if (failures.length > 0) {
        throw new Error(`${message}; compensation failed: ${failures.join('; ')}`, { cause: original });
    }
    if (original instanceof Error) {
        throw original;
    }
    throw new Error(message);
}
function attempt(failures: string[], label: string, operation: () => void): void {
    try {
        operation();
    } catch (error) {
        failures.push(`${label}: ${errorMessage(error)}`);
    }
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function originalErrorOptions(error: unknown): { cause: unknown } | undefined {
    return error instanceof Error ? { cause: error } : undefined;
}

function assertExpectedHead(currentHead: string, expectedHead: string): void {
    if (
        canonicalGitObjectId(currentHead, 'supplied head does not match the current pull-request head') !== expectedHead
    ) {
        fail('supplied head does not match the current pull-request head');
    }
}
function assertExpectedHeadAfterMutation(currentHead: string, expectedHead: string): void {
    if (canonicalGitObjectId(currentHead, 'pull-request head moved after mutation; compensating') !== expectedHead) {
        fail('pull-request head moved after mutation; compensating');
    }
}

function assertRecoveryHeadMatchesOwner(currentHead: string, expectedHead: string): void {
    if (
        canonicalGitObjectId(currentHead, 'pull-request head changed while reconciling review resolution') !==
        expectedHead
    ) {
        fail('pull-request head changed while reconciling review resolution');
    }
}

function sortedUniqueStrings(values: readonly string[], label: string): string[] {
    const unique = new Set<string>();
    for (const value of values) {
        if (typeof value !== 'string' || value.trim() === '') {
            fail(label);
        }
        unique.add(value);
    }
    return [...unique].sort();
}

function isDecimalId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
}
function authorBotNodeId(value: unknown): string {
    if (typeof value !== 'string' || !isAuthorBotNodeId(value)) {
        fail('expected author bot actor ID');
    }
    return value;
}
function isAuthorBotActor(nodeId: unknown, type: unknown): boolean {
    return type === 'Bot' && typeof nodeId === 'string' && isAuthorBotNodeId(nodeId);
}
function isAuthorResolutionActor(nodeId: unknown, type: unknown): boolean {
    return type === 'User' && typeof nodeId === 'string' && isAuthorBotNodeId(nodeId);
}
function isReviewerBotActor(nodeId: unknown, type: unknown): boolean {
    return type === 'Bot' && typeof nodeId === 'string' && isReviewerBotNodeId(nodeId);
}
function resolutionReviewContext(
    pullRequestId: string,
    threadId: string,
    expectedHead: string
): ResolutionReviewContext {
    if (typeof pullRequestId !== 'string' || pullRequestId === '') {
        fail('cannot read current pull-request node ID');
    }
    return {
        pullRequestId,
        threadId,
        expectedHead: canonicalGitObjectId(expectedHead, 'cannot read current pull-request head'),
    };
}
function resolutionReviewBody(context: ResolutionReviewContext, reviewHead: string): string {
    const canonicalReviewHead = canonicalGitObjectId(reviewHead, 'resolution review body requires a valid review head');
    return [
        RESOLUTION_REVIEW_SUMMARY,
        `<!-- sourdaw-review-resolve pull-request:${context.pullRequestId} thread:${context.threadId} head:${canonicalReviewHead} -->`,
    ].join('\n\n');
}
function extractThreadIdFromBody(body: string): string {
    const match = /thread:([^\s]+)\s+head:/.exec(body);
    if (match?.[1] === undefined) {
        fail('resolution review body is missing its thread marker');
    }
    return match[1];
}
function createReviewClientMutationId(threadId: string): string {
    return `review-create:${threadId}`;
}
function replyClientMutationId(threadId: string): string {
    return `review-reply:${threadId}`;
}
function submitReviewClientMutationId(reviewId: string): string {
    return `review-submit:${reviewId}`;
}
function updateReviewClientMutationId(reviewId: string): string {
    return `review-update:${reviewId}`;
}
function resolveClientMutationId(threadId: string): string {
    return `review-resolve:${threadId}`;
}
function assertReviewEnvelopeReceipt(
    receipt: ReviewEnvelopeReceipt,
    expectedClientMutationId: string,
    expectedState: string,
    expectedBody: string,
    expectedHead: string,
    label: string
): void {
    if (
        typeof receipt.id !== 'string' ||
        receipt.id === '' ||
        receipt.state !== expectedState ||
        receipt.body !== expectedBody ||
        receipt.commitOid !== expectedHead ||
        !isAuthorBotActor(receipt.authorNodeId, receipt.authorType) ||
        receipt.clientMutationId !== expectedClientMutationId
    ) {
        fail(`${label} returned an invalid result`);
    }
}
function assertReply(
    reply: ReviewReply,
    expectedClientMutationId: string,
    expectedReviewId: string,
    context: ResolutionReviewContext
): void {
    if (
        typeof reply.id !== 'string' ||
        reply.id === '' ||
        !isDecimalId(reply.fullDatabaseId) ||
        !isAuthorBotActor(reply.authorNodeId, reply.authorType) ||
        reply.clientMutationId !== expectedClientMutationId
    ) {
        fail('add review-thread reply returned an invalid result');
    }
    const review = requireReplyReview(reply, context, ['PENDING'], false, context.expectedHead);
    if (review.id !== expectedReviewId) {
        fail('add review-thread reply was not attached to the staged author review');
    }
}
function assertResolutionReceipt(receipt: ReviewResolutionReceipt, expectedClientMutationId: string): void {
    if (
        !isAuthorResolutionActor(receipt.resolvedByNodeId, receipt.resolvedByType) ||
        receipt.clientMutationId !== expectedClientMutationId
    ) {
        fail('resolve review thread returned an invalid result');
    }
}
function toRequiredReview(
    value: {
        reviewId?: string | null;
        reviewFullDatabaseId?: string | null;
        reviewState?: string | null;
        reviewBody?: string | null;
        reviewCommitOid?: string | null;
        reviewAuthorNodeId?: string | null;
        reviewAuthorLogin?: string | null;
        reviewAuthorType?: string | null;
    },
    label: string
): PullRequestReview {
    if (
        typeof value.reviewId !== 'string' ||
        value.reviewId === '' ||
        typeof value.reviewState !== 'string' ||
        typeof value.reviewBody !== 'string' ||
        typeof value.reviewCommitOid !== 'string'
    ) {
        fail(`${label} is not attached to a readable pull-request review`);
    }
    return {
        id: value.reviewId,
        ...(typeof value.reviewFullDatabaseId === 'string' ? { fullDatabaseId: value.reviewFullDatabaseId } : {}),
        state: value.reviewState,
        body: value.reviewBody,
        commitOid: canonicalGitObjectId(value.reviewCommitOid, `${label} has no commit OID`),
        authorNodeId: value.reviewAuthorNodeId ?? null,
        authorLogin: value.reviewAuthorLogin ?? null,
        authorType: value.reviewAuthorType ?? null,
    };
}
function toReplyReviewOrNull(value: {
    reviewId?: string | null;
    reviewFullDatabaseId?: string | null;
    reviewState?: string | null;
    reviewBody?: string | null;
    reviewCommitOid?: string | null;
    reviewAuthorNodeId?: string | null;
    reviewAuthorLogin?: string | null;
    reviewAuthorType?: string | null;
}): PullRequestReview | null {
    if (
        typeof value.reviewId !== 'string' ||
        value.reviewId === '' ||
        typeof value.reviewState !== 'string' ||
        typeof value.reviewBody !== 'string' ||
        typeof value.reviewCommitOid !== 'string'
    ) {
        return null;
    }
    return {
        id: value.reviewId,
        ...(typeof value.reviewFullDatabaseId === 'string' ? { fullDatabaseId: value.reviewFullDatabaseId } : {}),
        state: value.reviewState,
        body: value.reviewBody,
        commitOid: canonicalGitObjectId(value.reviewCommitOid, 'managed Done reply has no commit OID'),
        authorNodeId: value.reviewAuthorNodeId ?? null,
        authorLogin: value.reviewAuthorLogin ?? null,
        authorType: value.reviewAuthorType ?? null,
    };
}
function requireReviewCommitOid(review: PullRequestReview, label: string): string {
    if (typeof review.commitOid !== 'string' || review.commitOid === '') {
        fail(`${label} has no commit OID`);
    }
    return review.commitOid;
}
function requireReplyReview(
    value: {
        id?: string;
        reviewId?: string | null;
        reviewState?: string | null;
        reviewBody?: string | null;
        reviewCommitOid?: string | null;
        reviewAuthorNodeId?: string | null;
        reviewAuthorLogin?: string | null;
        reviewAuthorType?: string | null;
    },
    context: ResolutionReviewContext,
    allowedStates: string[],
    allowEmptyBody: boolean,
    expectedCommitOid: string | null
): PullRequestReview {
    const review = toRequiredReview(value, `Done reply ${value.id ?? 'unknown'}`);
    if (!isAuthorBotActor(review.authorNodeId, review.authorType)) {
        fail(`Done reply ${value.id ?? 'unknown'} is attached to a non-author review`);
    }
    if (!allowedStates.includes(review.state)) {
        fail(`Done reply ${value.id ?? 'unknown'} is attached to an unsupported review state`);
    }
    if (expectedCommitOid !== null && review.commitOid !== expectedCommitOid) {
        fail(`Done reply ${value.id ?? 'unknown'} is attached to a stale review head`);
    }
    const reviewCommitOid = requireReviewCommitOid(review, `Done reply ${value.id ?? 'unknown'}`);
    const expectedBody = resolutionReviewBody(context, reviewCommitOid);
    if (!allowEmptyBody && review.body !== expectedBody) {
        fail(`Done reply ${value.id ?? 'unknown'} is attached to a noncanonical author review`);
    }
    if (!allowEmptyBody && review.body.trim() === '') {
        fail(`Done reply ${value.id ?? 'unknown'} is attached to an empty author review`);
    }
    if (allowEmptyBody && review.body !== expectedBody && review.body.trim() !== '') {
        fail(`Done reply ${value.id ?? 'unknown'} is attached to a noncanonical author review`);
    }
    return review;
}
function managedReplyReviewOrNull(
    value: {
        reviewId?: string | null;
        reviewState?: string | null;
        reviewBody?: string | null;
        reviewCommitOid?: string | null;
        reviewAuthorNodeId?: string | null;
        reviewAuthorLogin?: string | null;
        reviewAuthorType?: string | null;
    },
    context: ResolutionReviewContext,
    allowedStates: string[],
    allowEmptyBody: boolean
): PullRequestReview | null {
    const review = toReplyReviewOrNull(value);
    if (review === null) {
        return null;
    }
    if (review.authorNodeId === null || review.authorType === null) {
        fail('Done reply marker has no review author');
    }
    if (!isAuthorBotActor(review.authorNodeId, review.authorType)) {
        return null;
    }
    if (!allowedStates.includes(review.state)) {
        return null;
    }
    if (typeof review.commitOid !== 'string' || review.commitOid === '') {
        return null;
    }
    const expectedBody = resolutionReviewBody(context, review.commitOid);
    if (review.body !== expectedBody && (!allowEmptyBody || review.body.trim() !== '')) {
        return null;
    }
    return review;
}
function managedReplyMarkers(
    thread: ReviewThread,
    context: ResolutionReviewContext,
    allowedStates: string[],
    allowEmptyBody: boolean
): ManagedReplyMarker[] {
    const managed: ManagedReplyMarker[] = [];
    for (const marker of validatedReplyMarkers(thread)) {
        const review = managedReplyReviewOrNull(marker, context, allowedStates, allowEmptyBody);
        if (review === null) {
            continue;
        }
        managed.push({
            marker,
            review,
            currentHead: review.commitOid === context.expectedHead,
        });
    }
    return managed.sort(compareManagedReplyMarkers);
}
function assertManagedReplyMarkersReadable(
    thread: ReviewThread,
    context: ResolutionReviewContext,
    allowedStates: string[],
    allowEmptyBody: boolean
): void {
    for (const marker of validatedReplyMarkers(thread)) {
        requireReplyReview(marker, context, allowedStates, allowEmptyBody, null);
    }
}
function compareManagedReplyMarkers(left: ManagedReplyMarker, right: ManagedReplyMarker): number {
    const leftPriority = managedReplyPriority(left);
    const rightPriority = managedReplyPriority(right);
    if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
    }
    return compareMarkers(left.marker, right.marker);
}
function managedReplyPriority(candidate: ManagedReplyMarker): number {
    if (candidate.currentHead && candidate.review.state === 'COMMENTED') {
        return 0;
    }
    if (candidate.currentHead) {
        return 1;
    }
    if (candidate.review.state === 'COMMENTED') {
        return 2;
    }
    return 3;
}
function requireCanonicalManagedReplyMarker(
    thread: ReviewThread,
    threadId: string,
    context: ResolutionReviewContext,
    allowedStates: string[],
    allowEmptyBody: boolean
): ManagedReplyMarker {
    const managed = managedReplyMarkers(thread, context, allowedStates, allowEmptyBody);
    const canonical = managed[0];
    if (canonical === undefined) {
        const markers = validatedReplyMarkers(thread);
        const marker = markers[0];
        if (marker !== undefined && markers.length === 1) {
            requireReplyReview(marker, context, allowedStates, allowEmptyBody, null);
        }
        fail(`review thread ${threadId} has no valid Done reply marker`);
    }
    return canonical;
}
function findManagedReplyMarkerByReviewId(
    thread: ReviewThread | null,
    context: ResolutionReviewContext,
    reviewId: string,
    allowedStates: string[],
    allowEmptyBody: boolean
): ManagedReplyMarker | undefined {
    if (thread === null) {
        return undefined;
    }
    return managedReplyMarkers(thread, context, allowedStates, allowEmptyBody).find(
        (candidate) => candidate.review.id === reviewId
    );
}
function findStaleManagedPendingReply(
    thread: ReviewThread | null,
    context: ResolutionReviewContext
): ManagedReplyMarker | undefined {
    if (thread === null) {
        return undefined;
    }
    for (const marker of validatedReplyMarkers(thread)) {
        const review = toReplyReviewOrNull(marker);
        if (
            review === null ||
            review.state !== 'PENDING' ||
            typeof review.commitOid !== 'string' ||
            review.commitOid === '' ||
            review.commitOid === context.expectedHead
        ) {
            continue;
        }
        return {
            marker,
            review: requireReplyReview(marker, context, ['PENDING'], true, null),
            currentHead: false,
        };
    }
    return undefined;
}
function hasExpectedReply(thread: ReviewThread, replyId: string): boolean {
    return thread.comments.some(
        (comment) =>
            comment.id === replyId &&
            comment.body === 'Done' &&
            isAuthorBotActor(comment.authorNodeId, comment.authorType)
    );
}
function hasCanonicalCommentedReview(comment: ReviewComment, context: ResolutionReviewContext): boolean {
    return (
        comment.reviewState === 'COMMENTED' &&
        typeof comment.reviewCommitOid === 'string' &&
        comment.reviewBody === resolutionReviewBody(context, comment.reviewCommitOid) &&
        isAuthorBotActor(comment.reviewAuthorNodeId, comment.reviewAuthorType)
    );
}

function hasCanonicalCommentedReplyAfterExcluding(
    thread: ReviewThread,
    context: ResolutionReviewContext,
    excludedReplyId: string
): boolean {
    return (
        managedReplyMarkers(thread, context, ['COMMENTED'], false).filter(
            (candidate) => candidate.marker.id !== excludedReplyId
        ).length > 0
    );
}

function hasExactImmutableDeleteReplySurvivor(
    thread: ReviewThread,
    context: ResolutionReviewContext,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'deleteReply' }>
): boolean {
    if (mutation.immutableEnvelope === undefined) {
        return false;
    }
    if (!thread.isResolved) {
        return false;
    }
    assertCompletedResolution(thread, context.threadId);
    const managed = managedReplyMarkers(thread, context, ['COMMENTED'], true);
    return managed.some(
        (candidate) =>
            matchesReviewResolutionMarkerSnapshot(candidate, mutation.immutableEnvelope!) &&
            isImmutableEmptySubmittedReview(candidate.review)
    );
}

function exactImmutableDeleteReplyTarget(
    thread: ReviewThread,
    context: ResolutionReviewContext,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'deleteReply' }>
): ManagedReplyMarker | undefined {
    if (mutation.target === undefined) {
        return undefined;
    }
    return managedReplyMarkers(thread, context, ['COMMENTED'], true).find((candidate) =>
        matchesReviewResolutionMarkerSnapshot(candidate, mutation.target!)
    );
}

function immutableDeleteReplyTargetIsAbsent(
    thread: ReviewThread,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'deleteReply' }>
): boolean {
    if (mutation.immutableEnvelope === undefined) {
        return thread.comments.every((comment) => comment.id !== mutation.replyId);
    }
    return thread.comments.every((comment) => comment.id !== (mutation.target?.markerId ?? mutation.replyId));
}

function hasExactImmutableDeleteReplyTerminal(
    thread: ReviewThread,
    context: ResolutionReviewContext,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'deleteReply' }>
): boolean {
    if (!hasExactImmutableDeleteReplySurvivor(thread, context, mutation)) {
        return false;
    }
    const markers = validatedReplyMarkers(thread);
    if (markers.length !== 1) {
        return false;
    }
    const [marker] = markers;
    if (marker === undefined) {
        return false;
    }
    const review = requireReplyReview(marker, context, ['COMMENTED'], true, null);
    return (
        matchesReviewResolutionMarkerSnapshot(
            { marker, review, currentHead: review.commitOid === context.expectedHead },
            mutation.immutableEnvelope!
        ) && isImmutableEmptySubmittedReview(review)
    );
}

function assertExactImmutableDeleteReplyTerminal(
    number: number,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'deleteReply' }>,
    port: ResolveReviewThreadPort
): void {
    if (inspection.thread === null || !hasExactImmutableDeleteReplyTerminal(inspection.thread, context, mutation)) {
        fail(unreconciledReviewResolutionMutationMessage(number, mutation));
    }
    if (hasBlockingAuthorPendingReview(inspection.pendingReviews, inspection.thread, context)) {
        fail(`review thread ${context.threadId} has a non-reusable pending author review`);
    }
    const marker = requireOneReplyMarker(inspection.thread, context.threadId);
    const review = requireReplyReview(marker, context, ['COMMENTED'], true, null);
    const attachedThreadIds = [
        ...new Set(port.inspectAttachedReviewThreadIds(number, review.id, inspection.pullRequestId, inspection.head)),
    ].sort();
    if (attachedThreadIds.length !== 1 || attachedThreadIds[0] !== context.threadId) {
        fail(`review thread ${context.threadId} immutable delete survivor is not attached exclusively to this thread`);
    }
}

function validatedReplyMarkers(thread: ReviewThread): ReviewComment[] {
    const owned = thread.comments.filter((comment) => isAuthorBotNodeId(comment.authorNodeId));
    for (const comment of owned) {
        if (
            !isDecimalId(comment.fullDatabaseId) ||
            comment.body !== 'Done' ||
            !isAuthorBotActor(comment.authorNodeId, comment.authorType)
        ) {
            fail('owned Done reply marker is not an exact author-bot receipt');
        }
    }
    return owned.sort(compareMarkers);
}
function compareMarkers(left: ReviewComment, right: ReviewComment): number {
    // The smallest decimal fullDatabaseId, then node ID, is the canonical concurrent marker.
    const difference = BigInt(left.fullDatabaseId) - BigInt(right.fullDatabaseId);
    if (difference === 0n) {
        return left.id.localeCompare(right.id);
    }
    return difference < 0n ? -1 : 1;
}
function requireOneReplyMarker(thread: ReviewThread | null, threadId: string): ReviewComment {
    if (thread === null) {
        fail(`review thread ${threadId} was not found on this pull request`);
    }
    const markers = validatedReplyMarkers(thread);
    const [marker] = markers;
    if (marker === undefined || markers.length !== 1) {
        fail(`review thread ${threadId} does not have exactly one valid Done reply marker`);
    }
    return marker;
}
function convergeReplyMarkers(
    number: number,
    threadId: string,
    thread: ReviewThread | null,
    port: ResolveReviewThreadPort,
    context: ResolutionReviewContext,
    allowedStates: string[],
    preferredReplyId?: string,
    fenceHead: string = context.expectedHead
): string {
    if (thread === null) {
        fail(`review thread ${threadId} was not found on this pull request`);
    }
    const managed = managedReplyMarkers(thread, context, allowedStates, true);
    const canonical =
        managed.find((candidate) => candidate.marker.id === preferredReplyId) ??
        requireCanonicalManagedReplyMarker(thread, threadId, context, allowedStates, true);
    for (const candidate of managed) {
        if (candidate.marker.id !== canonical.marker.id) {
            assertDuplicateReplyDeletionStillSafe(
                number,
                threadId,
                context,
                port,
                canonical,
                candidate,
                preferredReplyId,
                fenceHead
            );
            port.deleteReply(
                candidate.marker.id,
                preferredReplyId === canonical.marker.id && isImmutableEmptySubmittedReview(canonical.review)
                    ? canonical
                    : undefined,
                preferredReplyId === canonical.marker.id && isImmutableEmptySubmittedReview(canonical.review)
                    ? candidate
                    : undefined
            );
        }
    }
    return canonical.marker.id;
}

function assertDuplicateReplyDeletionStillSafe(
    number: number,
    threadId: string,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort,
    canonical: ManagedReplyMarker,
    candidate: ManagedReplyMarker,
    preferredReplyId: string | undefined,
    fenceHead: string
): void {
    const latest = port.inspect(number, threadId);
    assertExpectedHeadAfterMutation(latest.head, fenceHead);
    if (latest.thread === null) {
        fail(`review thread ${threadId} was not found on this pull request`);
    }
    assertManagedReplyMarkersReadable(latest.thread, context, ['PENDING', 'COMMENTED'], true);
    const managed = managedReplyMarkers(latest.thread, context, ['PENDING', 'COMMENTED'], true);
    const canonicalRemains = hasUnchangedManagedReplyMarker(managed, canonical);
    const candidateRemains = hasUnchangedManagedReplyMarker(managed, candidate);
    if (
        preferredReplyId !== undefined &&
        (canonical.marker.id !== preferredReplyId ||
            !isImmutableEmptySubmittedReview(canonical.review) ||
            !canonicalRemains)
    ) {
        fail(`review thread ${threadId} no longer has its immutable empty submitted-review envelope`);
    }
    if (!canonicalRemains || !candidateRemains) {
        fail(`review thread ${threadId} duplicate reply markers changed before deletion`);
    }
}

function hasUnchangedManagedReplyMarker(managed: ManagedReplyMarker[], expected: ManagedReplyMarker): boolean {
    return managed.some((candidate) =>
        matchesReviewResolutionMarkerSnapshot(candidate, reviewResolutionMarkerSnapshot(expected))
    );
}

function reviewResolutionMarkerSnapshot(candidate: ManagedReplyMarker): ReviewResolutionMarkerSnapshot {
    if (!isDecimalId(candidate.marker.fullDatabaseId) || !isDecimalId(candidate.review.fullDatabaseId)) {
        fail(`Done reply ${candidate.marker.id} has no immutable decimal identity`);
    }
    const reviewCommitOid = requireReviewCommitOid(candidate.review, `Done reply ${candidate.marker.id}`);
    return {
        markerId: candidate.marker.id,
        markerFullDatabaseId: candidate.marker.fullDatabaseId,
        reviewId: candidate.review.id,
        reviewFullDatabaseId: candidate.review.fullDatabaseId,
        reviewState: candidate.review.state,
        reviewBody: candidate.review.body,
        reviewCommitOid,
        reviewAuthorNodeId: candidate.review.authorNodeId,
        reviewAuthorLogin: candidate.review.authorLogin,
        reviewAuthorType: candidate.review.authorType,
    };
}

function matchesReviewResolutionMarkerSnapshot(
    candidate: ManagedReplyMarker,
    expected: ReviewResolutionMarkerSnapshot
): boolean {
    return (
        candidate.marker.id === expected.markerId &&
        candidate.marker.fullDatabaseId === expected.markerFullDatabaseId &&
        candidate.review.id === expected.reviewId &&
        candidate.review.fullDatabaseId === expected.reviewFullDatabaseId &&
        candidate.review.state === expected.reviewState &&
        candidate.review.body === expected.reviewBody &&
        candidate.review.commitOid === expected.reviewCommitOid &&
        candidate.review.authorNodeId === expected.reviewAuthorNodeId &&
        candidate.review.authorType === expected.reviewAuthorType
    );
}

function assertPreservedImmutableEnvelopeBeforeConvergence(
    thread: ReviewThread,
    context: ResolutionReviewContext,
    immutableEnvelope: ManagedReplyMarker
): void {
    assertManagedReplyMarkersReadable(thread, context, ['COMMENTED'], true);
    const managed = managedReplyMarkers(thread, context, ['COMMENTED'], true);
    const snapshot = reviewResolutionMarkerSnapshot(immutableEnvelope);
    const preserved = managed.filter(
        (candidate) =>
            matchesReviewResolutionMarkerSnapshot(candidate, snapshot) &&
            candidate.currentHead &&
            isImmutableEmptySubmittedReview(candidate.review)
    );
    if (
        preserved.length !== 1 ||
        managed.some(
            (candidate) =>
                candidate.review.id !== immutableEnvelope.review.id && isImmutableEmptySubmittedReview(candidate.review)
        )
    ) {
        fail(`review thread ${context.threadId} no longer has its immutable empty submitted-review envelope`);
    }
}

function repairManagedCommentedReviewEnvelopes(
    number: number,
    threadId: string,
    thread: ReviewThread | null,
    port: ResolveReviewThreadPort,
    context: ResolutionReviewContext,
    allowedStates: string[] = ['COMMENTED'],
    beforeUpdate?: () => void,
    preservedImmutableReviewId?: string
): boolean {
    if (thread === null) {
        fail(`review thread ${threadId} was not found on this pull request`);
    }
    const repairedReviewIds = new Set<string>();
    let updated = false;
    for (const candidate of managedReplyMarkers(thread, context, allowedStates, true)) {
        if (
            repairedReviewIds.has(candidate.review.id) ||
            candidate.review.id === preservedImmutableReviewId ||
            isImmutableEmptySubmittedReview(candidate.review) ||
            candidate.review.body.trim() !== ''
        ) {
            continue;
        }
        const reviewCommitOid = requireReviewCommitOid(candidate.review, `Done reply ${candidate.marker.id}`);
        const expectedBody = resolutionReviewBody(context, reviewCommitOid);
        assertExclusiveBackfillReviewAttachment(number, candidate.review.id, context, port);
        beforeUpdate?.();
        const updatedReview = port.updateReviewBody(
            candidate.review.id,
            expectedBody,
            reviewCommitOid,
            candidate.review,
            candidate.marker
        );
        assertProvenReviewBodyReceipt(updatedReview, candidate.review, expectedBody);
        repairedReviewIds.add(candidate.review.id);
        updated = true;
    }
    return updated;
}

function isImmutableEmptySubmittedReview(review: PullRequestReview): boolean {
    return review.state === 'COMMENTED' && review.body === '';
}

function hasExactImmutableEmptySubmittedReviewEnvelope(
    number: number,
    thread: ReviewThread,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort
): ManagedReplyMarker | undefined {
    const commented = managedReplyMarkers(thread, context, ['COMMENTED'], true);
    const immutable = commented.filter(
        (candidate) => candidate.currentHead && isImmutableEmptySubmittedReview(candidate.review)
    );
    if (immutable.length === 0) {
        return undefined;
    }
    const immutableByReviewId = new Map<string, ManagedReplyMarker>();
    for (const candidate of immutable) {
        if (!immutableByReviewId.has(candidate.review.id)) {
            immutableByReviewId.set(candidate.review.id, candidate);
        }
    }
    if (immutableByReviewId.size > 1) {
        fail(`review thread ${context.threadId} has multiple immutable empty submitted-review envelopes`);
    }
    const candidate = immutableByReviewId.values().next().value;
    if (candidate === undefined) {
        fail(`review thread ${context.threadId} has no deterministic immutable submitted-review envelope`);
    }
    assertExclusiveBackfillReviewAttachment(number, candidate.review.id, context, port);
    return candidate;
}
function isExactPendingReview(review: PullRequestReview, context: ResolutionReviewContext): boolean {
    return (
        review.state === 'PENDING' &&
        review.body === resolutionReviewBody(context, context.expectedHead) &&
        review.commitOid === context.expectedHead &&
        isAuthorBotActor(review.authorNodeId, review.authorType)
    );
}
function assertExclusiveBackfillReviewAttachment(
    number: number,
    reviewId: string,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort,
    snapshotHead: string = context.expectedHead
): void {
    const attachedThreadIds = [
        ...new Set(port.inspectAttachedReviewThreadIds(number, reviewId, context.pullRequestId, snapshotHead)),
    ].sort();
    if (attachedThreadIds.length === 1 && attachedThreadIds[0] === context.threadId) {
        return;
    }
    const foreignThreadIds = attachedThreadIds.filter((threadId) => threadId !== context.threadId);
    if (attachedThreadIds.includes(context.threadId) && foreignThreadIds.length > 0) {
        fail(
            `pending author review ${reviewId} still has attached review-thread comments on ${foreignThreadIds.join(', ')}`
        );
    }
    if (attachedThreadIds.length === 0) {
        fail(`pending author review ${reviewId} is not attached to review thread ${context.threadId}`);
    }
    fail(`pending author review ${reviewId} is shared across review threads ${attachedThreadIds.join(', ')}`);
}
function assertReusablePendingReviewAttachment(
    number: number,
    reviewId: string,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort,
    snapshotHead: string = context.expectedHead
): void {
    const attachedThreadIds = [
        ...new Set(port.inspectAttachedReviewThreadIds(number, reviewId, context.pullRequestId, snapshotHead)),
    ].sort();
    if (
        attachedThreadIds.length === 0 ||
        (attachedThreadIds.length === 1 && attachedThreadIds[0] === context.threadId)
    ) {
        return;
    }
    const foreignThreadIds = attachedThreadIds.filter((threadId) => threadId !== context.threadId);
    if (foreignThreadIds.length > 0) {
        fail(
            `pending author review ${reviewId} still has attached review-thread comments on ${foreignThreadIds.join(', ')}`
        );
    }
    fail(`pending author review ${reviewId} has an invalid attached review-thread set`);
}
function isCanonicalAuthorPendingReview(review: PullRequestReview, context: ResolutionReviewContext): boolean {
    return (
        review.state === 'PENDING' &&
        typeof review.commitOid === 'string' &&
        review.commitOid !== '' &&
        review.body === resolutionReviewBody(context, review.commitOid) &&
        isAuthorBotActor(review.authorNodeId, review.authorType)
    );
}
function attachedManagedReviewIds(thread: ReviewThread, context: ResolutionReviewContext): Set<string> {
    return new Set(
        managedReplyMarkers(thread, context, ['PENDING', 'COMMENTED'], true).map((candidate) => candidate.review.id)
    );
}
function findRetirableStaleUnattachedPendingReview(
    pendingReviews: PullRequestReview[],
    thread: ReviewThread,
    context: ResolutionReviewContext
): PullRequestReview | undefined {
    const attachedReviewIds = attachedManagedReviewIds(thread, context);
    const authorPendingReviews = pendingReviews.filter((review) =>
        isAuthorBotActor(review.authorNodeId, review.authorType)
    );
    if (authorPendingReviews.length !== 1) {
        return undefined;
    }
    const [candidate] = authorPendingReviews;
    if (
        candidate === undefined ||
        candidate.commitOid === context.expectedHead ||
        attachedReviewIds.has(candidate.id) ||
        !isCanonicalAuthorPendingReview(candidate, context)
    ) {
        return undefined;
    }
    return candidate;
}
function hasBlockingAuthorPendingReview(
    pendingReviews: PullRequestReview[],
    thread: ReviewThread,
    context: ResolutionReviewContext
): boolean {
    const attachedReviewIds = attachedManagedReviewIds(thread, context);
    return pendingReviews.some(
        (review) => isAuthorBotActor(review.authorNodeId, review.authorType) && !attachedReviewIds.has(review.id)
    );
}
function retireRetirableStaleUnattachedPendingReview(
    number: number,
    threadId: string,
    working: ReviewThreadInspection,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort
): { working: ReviewThreadInspection; deleted: boolean } {
    const stalePendingReview = findRetirableStaleUnattachedPendingReview(
        working.pendingReviews,
        working.thread!,
        context
    );
    if (stalePendingReview === undefined) {
        return { working, deleted: false };
    }
    deletePendingReviewSafely(number, stalePendingReview.id, context, port);
    const refreshed = port.inspect(number, threadId);
    assertExpectedHeadAfterMutation(refreshed.head, context.expectedHead);
    return { working: refreshed, deleted: true };
}
function convergePendingReviews(
    number: number,
    pendingReviews: PullRequestReview[],
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort,
    preferredReviewId?: string,
    snapshotHead: string = context.expectedHead
): PullRequestReview | undefined {
    const exact = pendingReviews.filter((review) => isExactPendingReview(review, context));
    const canonical = exact.find((review) => review.id === preferredReviewId) ?? exact[0];
    if (canonical === undefined) {
        return undefined;
    }
    for (const review of exact) {
        if (review.id !== canonical.id) {
            deletePendingReviewSafely(number, review.id, context, port, [], snapshotHead);
        }
    }
    return canonical;
}
function reconcilePendingReviewsForReply(
    number: number,
    pendingReviews: PullRequestReview[],
    thread: ReviewThread | null,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort,
    allowEmptyCommentedReview: boolean = false
): boolean {
    if (thread === null) {
        fail(`review thread ${context.threadId} was not found on this pull request`);
    }
    const currentHeadCommentedReply = managedReplyMarkers(
        thread,
        context,
        ['COMMENTED'],
        allowEmptyCommentedReview
    ).find((candidate) => candidate.currentHead);
    const managedPendingReviewIds = new Set(
        managedReplyMarkers(thread, context, ['PENDING'], true).map((candidate) => candidate.review.id)
    );
    const currentHeadPendingReply = managedReplyMarkers(thread, context, ['PENDING'], true).find(
        (candidate) => candidate.currentHead
    );
    let keepReviewId: string | undefined;
    if (currentHeadCommentedReply === undefined && currentHeadPendingReply !== undefined) {
        const currentHeadPendingReplyCommitOid = requireReviewCommitOid(
            currentHeadPendingReply.review,
            `Done reply ${currentHeadPendingReply.marker.id}`
        );
        if (currentHeadPendingReply.review.body === resolutionReviewBody(context, currentHeadPendingReplyCommitOid)) {
            keepReviewId = currentHeadPendingReply.review.id;
        }
    }
    let deleted = false;
    for (const review of pendingReviews) {
        if (review.id === keepReviewId) {
            continue;
        }
        if (!managedPendingReviewIds.has(review.id) && !isExactPendingReview(review, context)) {
            continue;
        }
        deletePendingReviewSafely(
            number,
            review.id,
            context,
            port,
            managedPendingReviewIds.has(review.id) ? [context.threadId] : []
        );
        deleted = true;
    }
    return deleted;
}
function deletePendingReviewSafely(
    number: number,
    reviewId: string,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort,
    allowedAttachedThreadIds: string[] = [],
    snapshotHead: string = context.expectedHead
): void {
    const allowedThreadIds = new Set(allowedAttachedThreadIds);
    const attachedThreadIds = [
        ...new Set(port.inspectAttachedReviewThreadIds(number, reviewId, context.pullRequestId, snapshotHead)),
    ].sort();
    const unsafeThreadIds = attachedThreadIds.filter((threadId) => !allowedThreadIds.has(threadId));
    if (unsafeThreadIds.length > 0) {
        fail(
            `pending author review ${reviewId} still has attached review-thread comments on ${unsafeThreadIds.join(', ')}`
        );
    }
    port.deletePendingReview(reviewId, {
        allowedAttachedThreadIds: [...allowedThreadIds],
        snapshotHead,
    });
}

function convergePendingReplyStateBeforeSubmit(
    number: number,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    preferredReviewId: string,
    port: ResolveReviewThreadPort
): ReviewThreadInspection {
    let working = inspection;
    const exactPendingCount = working.pendingReviews.filter((review) => isExactPendingReview(review, context)).length;
    if (exactPendingCount > 1) {
        convergePendingReviews(number, working.pendingReviews, context, port, preferredReviewId, working.head);
        working = port.inspect(number, context.threadId);
        assertExpectedHeadAfterMutation(working.head, context.expectedHead);
    }
    if (working.thread === null) {
        fail(`review thread ${context.threadId} was not found on this pull request`);
    }
    const pendingMarkers = managedReplyMarkers(working.thread, context, ['PENDING'], true);
    if (pendingMarkers.length > 1) {
        convergeReplyMarkers(number, context.threadId, working.thread, port, context, ['PENDING']);
        working = port.inspect(number, context.threadId);
        assertExpectedHeadAfterMutation(working.head, context.expectedHead);
    }
    if (working.thread === null) {
        fail(`review thread ${context.threadId} was not found on this pull request`);
    }
    return working;
}
function deleteAmbiguousCreatedPendingReview(
    before: PullRequestReview[],
    current: PullRequestReview[],
    thread: ReviewThread | null,
    context: ResolutionReviewContext,
    _port: ResolveReviewThreadPort,
    failures: string[]
): boolean {
    const beforeIds = new Set(before.map((review) => review.id));
    const created = current.filter((review) => !beforeIds.has(review.id));
    if (created.length === 0) {
        return false;
    }
    if (
        thread !== null &&
        created.some((review) =>
            managedReplyMarkers(thread, context, ['PENDING', 'COMMENTED'], true).some(
                (candidate) => candidate.review.id === review.id
            )
        )
    ) {
        failures.push('pending review now has a managed Done reply; preserving attached review evidence');
        return true;
    }
    if (created.some((review) => isExactPendingReview(review, context))) {
        failures.push('ambiguous pending review mutation; preserving exact pending review evidence');
        return true;
    }
    failures.push('ambiguous pending review mutation; preserving newly visible pending review evidence');
    return true;
}
function assertCompletedResolution(thread: ReviewThread, threadId: string): void {
    assertRootReviewer(thread, threadId);
    if (!isAuthorResolutionActor(thread.resolvedByNodeId, thread.resolvedByType)) {
        fail(`review thread ${threadId} was not resolved by ${AUTHOR_BOT_NODE_ID}`);
    }
}
function assertCommentedResolutionReply(reply: ReviewComment, context: ResolutionReviewContext): void {
    requireReplyReview(reply, context, ['COMMENTED'], false, null);
}
function repairCompletedResolution(
    number: number,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort
): boolean {
    let working = inspection;
    let thread = inspection.thread;
    if (thread === null) {
        fail(`review thread ${context.threadId} was not found on this pull request`);
    }
    assertCompletedResolution(thread, context.threadId);
    assertManagedReplyMarkersReadable(thread, context, ['PENDING', 'COMMENTED'], true);
    const immutableEnvelope = hasExactImmutableEmptySubmittedReviewEnvelope(number, thread, context, port);
    const retired = retireRetirableStaleUnattachedPendingReview(number, context.threadId, working, context, port);
    if (retired.deleted) {
        working = retired.working;
        thread = working.thread;
        if (thread === null) {
            fail(`review thread ${context.threadId} was not found on this pull request`);
        }
    }
    if (hasBlockingAuthorPendingReview(working.pendingReviews, thread, context)) {
        fail(`review thread ${context.threadId} has a non-reusable pending author review`);
    }
    const refresh = (): ReviewThread => {
        working = port.inspect(number, context.threadId);
        assertExpectedHeadAfterMutation(working.head, context.expectedHead);
        if (working.thread === null) {
            fail(`review thread ${context.threadId} was not found on this pull request`);
        }
        assertCompletedResolution(working.thread, context.threadId);
        return working.thread;
    };
    const updated = repairManagedCommentedReviewEnvelopes(
        number,
        context.threadId,
        thread,
        port,
        context,
        ['PENDING', 'COMMENTED'],
        undefined,
        immutableEnvelope?.review.id
    );
    if (updated) {
        thread = refresh();
    }
    const canonical = requireCanonicalManagedReplyMarker(
        thread,
        context.threadId,
        context,
        ['PENDING', 'COMMENTED'],
        immutableEnvelope !== undefined
    );
    if (canonical.review.state === 'PENDING') {
        assertReusablePendingReviewAttachment(number, canonical.review.id, context, port);
        const reviewCommitOid = requireReviewCommitOid(canonical.review, `Done reply ${canonical.marker.id}`);
        const submittedReview = port.submitReview(
            canonical.review.id,
            resolutionReviewBody(context, reviewCommitOid),
            reviewCommitOid
        );
        assertReviewEnvelopeReceipt(
            submittedReview,
            submitReviewClientMutationId(canonical.review.id),
            'COMMENTED',
            resolutionReviewBody(context, reviewCommitOid),
            reviewCommitOid,
            'submit review'
        );
        thread = refresh();
    }
    const pendingReviewDeleted = reconcilePendingReviewsForReply(
        number,
        working.pendingReviews,
        thread,
        context,
        port,
        immutableEnvelope !== undefined
    );
    if (pendingReviewDeleted) {
        thread = refresh();
    }
    const pendingReplies = managedReplyMarkers(thread, context, ['PENDING'], false);
    const currentHeadCommentedReply = managedReplyMarkers(
        thread,
        context,
        ['COMMENTED'],
        immutableEnvelope !== undefined
    ).find((candidate) => candidate.currentHead);
    const managedPendingReviewIdsToDelete = new Set(
        pendingReplies
            .filter(
                (candidate) => currentHeadCommentedReply !== undefined || candidate.review.id !== canonical.review.id
            )
            .map((candidate) => candidate.review.id)
    );
    if (managedPendingReviewIdsToDelete.size > 0) {
        for (const reviewId of managedPendingReviewIdsToDelete) {
            deletePendingReviewSafely(number, reviewId, context, port, [context.threadId]);
        }
        thread = refresh();
    }
    if (hasBlockingAuthorPendingReview(working.pendingReviews, thread, context)) {
        fail(`review thread ${context.threadId} has a non-reusable pending author review`);
    }
    const duplicateMarkers = managedReplyMarkers(thread, context, ['COMMENTED'], immutableEnvelope !== undefined);
    if (duplicateMarkers.length <= 1) {
        if (immutableEnvelope !== undefined) {
            const terminal = port.inspect(number, context.threadId);
            assertExpectedHeadAfterMutation(terminal.head, context.expectedHead);
            if (terminal.thread === null) {
                fail(`review thread ${context.threadId} was not found on this pull request`);
            }
            assertCompletedResolution(terminal.thread, context.threadId);
            if (hasBlockingAuthorPendingReview(terminal.pendingReviews, terminal.thread, context)) {
                fail(`review thread ${context.threadId} has a non-reusable pending author review`);
            }
            const reply = requireOneReplyMarker(terminal.thread, context.threadId);
            const review = requireReplyReview(reply, context, ['COMMENTED'], true, null);
            if (
                !matchesReviewResolutionMarkerSnapshot(
                    { marker: reply, review, currentHead: review.commitOid === context.expectedHead },
                    reviewResolutionMarkerSnapshot(immutableEnvelope)
                ) ||
                !isImmutableEmptySubmittedReview(review)
            ) {
                fail(`review thread ${context.threadId} no longer has its immutable empty submitted-review envelope`);
            }
            assertExclusiveBackfillReviewAttachment(number, review.id, context, port);
            return true;
        }
        assertCommentedResolutionReply(requireOneReplyMarker(thread, context.threadId), context);
        return false;
    }
    if (immutableEnvelope !== undefined) {
        thread = refresh();
        assertPreservedImmutableEnvelopeBeforeConvergence(thread, context, immutableEnvelope);
    }
    convergeReplyMarkers(number, context.threadId, thread, port, context, ['COMMENTED'], immutableEnvelope?.marker.id);
    const verified = port.inspect(number, context.threadId);
    assertExpectedHeadAfterMutation(verified.head, context.expectedHead);
    if (verified.thread === null) {
        fail(`review thread ${context.threadId} was not found on this pull request`);
    }
    assertCompletedResolution(verified.thread, context.threadId);
    if (immutableEnvelope !== undefined) {
        const reply = requireOneReplyMarker(verified.thread, context.threadId);
        const review = requireReplyReview(reply, context, ['COMMENTED'], true, null);
        if (
            !matchesReviewResolutionMarkerSnapshot(
                { marker: reply, review, currentHead: review.commitOid === context.expectedHead },
                reviewResolutionMarkerSnapshot(immutableEnvelope)
            ) ||
            !isImmutableEmptySubmittedReview(review)
        ) {
            fail(`review thread ${context.threadId} no longer has its immutable empty submitted-review envelope`);
        }
        if (hasBlockingAuthorPendingReview(verified.pendingReviews, verified.thread, context)) {
            fail(`review thread ${context.threadId} has a non-reusable pending author review`);
        }
        assertExclusiveBackfillReviewAttachment(number, immutableEnvelope.review.id, context, port);
        return true;
    }
    assertCommentedResolutionReply(requireOneReplyMarker(verified.thread, context.threadId), context);
    return false;
}
function assertFinalResolution(
    thread: ReviewThread | null,
    threadId: string,
    replyId: string,
    context: ResolutionReviewContext,
    expectedResolution: {
        isResolved: boolean;
        resolvedByNodeId: string | null;
        resolvedByLogin: string | null;
        resolvedByType: string | null;
    }
): void {
    if (
        thread?.id !== threadId ||
        !thread.isResolved ||
        !isAuthorResolutionActor(thread.resolvedByNodeId, thread.resolvedByType)
    ) {
        fail(`review thread ${threadId} was not resolved by ${AUTHOR_BOT_NODE_ID}`);
    }
    if (!hasExpectedReply(thread, replyId)) {
        fail(`review reply receipt ${replyId} is not present on thread ${threadId}`);
    }
    assertMatchingThreadResolutionSnapshot(
        threadId,
        expectedResolution,
        threadResolutionSnapshot(
            threadId,
            thread.isResolved,
            thread.resolvedByNodeId,
            thread.resolvedByLogin,
            thread.resolvedByType
        ),
        'resolution confirmation'
    );
    assertCommentedResolutionReply(requireOneReplyMarker(thread, threadId), context);
}
function assertResolvableThread(thread: ReviewThread | null, expectedThreadId: string): void {
    if (thread === null || thread.id !== expectedThreadId) {
        fail(`review thread ${expectedThreadId} was not found on this pull request`);
    }
    if (thread.isResolved) {
        fail(`review thread ${expectedThreadId} is already resolved`);
    }
    assertRootReviewer(thread, expectedThreadId);
}
function assertRootReviewer(thread: ReviewThread, threadId: string): void {
    if (!isReviewerBotActor(thread.rootAuthorNodeId, thread.rootAuthorType)) {
        fail(`review thread ${threadId} root comment is not authored by ${REVIEWER_BOT_NODE_ID}`);
    }
    if (
        typeof thread.rootCommentId !== 'string' ||
        thread.rootCommentId === '' ||
        !isDecimalId(thread.rootCommentFullDatabaseId)
    ) {
        fail(`review thread ${threadId} root comment has no decimal fullDatabaseId`);
    }
}
function findReusableReply(thread: ReviewThread | null, context: ResolutionReviewContext): ReviewComment | undefined {
    if (thread === null) {
        return undefined;
    }
    return managedReplyMarkers(thread, context, ['PENDING', 'COMMENTED'], true).find(
        (candidate) => candidate.currentHead
    )?.marker;
}

export function shellPort(
    session: GhSession,
    cwd: string = process.cwd(),
    markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt'] = () => undefined,
    capture: typeof spawnCapture = spawnCapture,
    sharedMutationOwnerOid?: string,
    registerSuccessfulCompletion?: PullRequestRemoteMutationBoundary['registerSuccessfulCompletion']
): ResolveReviewThreadPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    const queryGh = (args: string[]) => capture('gh', args, { cwd: primaryRoot, env: session.env });
    const mutationGh = (args: string[]) => capture('gh', args, { cwd: primaryRoot, env: session.env });
    return {
        inspect: (number, id) => inspectReviewThread(number, id, queryGh),
        inspectPullRequestReview: (number, reviewId, expectedPullRequestId, expectedHead) =>
            inspectPullRequestReview(number, reviewId, expectedPullRequestId, expectedHead, queryGh),
        inspectAttachedReviewThreadIds: (number, reviewId, expectedPullRequestId, expectedHead) =>
            inspectAttachedReviewThreadIds(number, reviewId, expectedPullRequestId, expectedHead, queryGh),
        createPendingReview: (pullRequestId, commitOid, body) => {
            const active = activeReviewResolutionLocks.at(-1);
            if (active === undefined) {
                fail('pending review creation is not fenced by the active review-resolution lock');
            }
            advanceActiveReviewResolutionLockMutation(primaryRoot, active.number, {
                phase: 'createPendingReview',
                pullRequestId,
                body,
                reviewCommitOid: commitOid,
            });
            markRemoteMutationAttempt();
            return createPendingReview(pullRequestId, commitOid, body, mutationGh);
        },
        replyDone: (id, reviewId, review) => {
            const active = activeReviewResolutionLocks.at(-1);
            if (active === undefined) {
                fail('review reply creation is not fenced by the active review-resolution lock');
            }
            advanceActiveReviewResolutionLockMutation(primaryRoot, active.number, {
                phase: 'replyDone',
                reviewId,
                reviewState: 'PENDING',
                body: review.body,
                reviewCommitOid: requireReviewCommitOid(review, `Done reply for ${reviewId}`),
            });
            markRemoteMutationAttempt();
            return mutationReply(id, reviewId, mutationGh);
        },
        submitReview: (reviewId, body, reviewCommitOid) => {
            const active = activeReviewResolutionLocks.at(-1);
            if (active === undefined) {
                fail('review submission is not fenced by the active review-resolution lock');
            }
            advanceActiveReviewResolutionLockMutation(primaryRoot, active.number, {
                phase: 'submitReview',
                reviewId,
                body,
                reviewCommitOid,
            });
            markRemoteMutationAttempt();
            return submitReview(reviewId, body, mutationGh);
        },
        updateReviewBody: (reviewId, body, reviewCommitOid, expectedReview, expectedMarker) => {
            const active = activeReviewResolutionLocks.at(-1);
            if (active === undefined) {
                fail('review body update is not fenced by the active review-resolution lock');
            }
            if (
                expectedReview === undefined ||
                expectedReview.id !== reviewId ||
                expectedReview.commitOid !== reviewCommitOid ||
                !isDecimalId(expectedReview.fullDatabaseId)
            ) {
                fail(`review body update has no immutable decimal review identity for ${reviewId}`);
            }
            const marker =
                expectedMarker === undefined
                    ? undefined
                    : reviewResolutionMarkerSnapshot({
                          marker: expectedMarker,
                          review: expectedReview,
                          currentHead: expectedReview.commitOid === active.owner.head,
                      });
            advanceActiveReviewResolutionLockMutation(primaryRoot, active.number, {
                phase: 'updateReviewBody',
                reviewId,
                reviewDatabaseId: expectedReview.fullDatabaseId,
                body,
                reviewCommitOid,
                ...(marker === undefined ? {} : { marker }),
            });
            markRemoteMutationAttempt();
            return updateReviewBody(active.number, expectedReview, body, mutationGh);
        },
        resolve: (id) => {
            const active = activeReviewResolutionLocks.at(-1);
            if (active === undefined) {
                fail('thread resolution is not fenced by the active review-resolution lock');
            }
            advanceActiveReviewResolutionLockMutation(primaryRoot, active.number, {
                phase: 'resolveThread',
            });
            markRemoteMutationAttempt();
            return resolveThread(id, mutationGh);
        },
        deleteReply: (id, immutableEnvelope, target) => {
            const active = activeReviewResolutionLocks.at(-1);
            if (active === undefined) {
                fail('review reply deletion is not fenced by the active review-resolution lock');
            }
            advanceActiveReviewResolutionLockMutation(primaryRoot, active.number, {
                phase: 'deleteReply',
                replyId: id,
                ...(immutableEnvelope === undefined
                    ? {}
                    : {
                          immutableEnvelope: reviewResolutionMarkerSnapshot(immutableEnvelope),
                          ...(target === undefined ? {} : { target: reviewResolutionMarkerSnapshot(target) }),
                      }),
            });
            markRemoteMutationAttempt();
            return deleteReply(id, mutationGh);
        },
        deletePendingReview: (id, options) => {
            const active = activeReviewResolutionLocks.at(-1);
            if (active === undefined) {
                fail('pending review deletion is not fenced by the active review-resolution lock');
            }
            advanceActiveReviewResolutionLockMutation(primaryRoot, active.number, {
                phase: 'deletePendingReview',
                reviewId: id,
                allowedAttachedThreadIds: sortedUniqueStrings(
                    options?.allowedAttachedThreadIds ?? [],
                    'delete pending review requires valid attached thread ids'
                ),
                snapshotHead: canonicalGitObjectId(
                    options?.snapshotHead ?? active.owner.head,
                    'delete pending review requires a valid snapshot head'
                ),
            });
            markRemoteMutationAttempt();
            return deletePendingReview(id, mutationGh);
        },
        serializeReviewThreadMutation: (number, threadId, expectedHead, operation) =>
            withPullRequestReviewResolutionLock(
                primaryRoot,
                number,
                threadId,
                expectedHead,
                operation,
                sharedMutationOwnerOid === undefined ? {} : { sharedMutationOwnerOid, registerSuccessfulCompletion }
            ),
        log: (message) => console.log(message),
    };
}

function pullRequestReviewResolutionLockScope(number: number): string {
    if (!Number.isSafeInteger(number) || number <= 0) {
        fail('review-resolution lock requires a positive pull-request number');
    }
    return `review resolution on PR #${number}`;
}

function pullRequestReviewResolutionLockRef(number: number): string {
    pullRequestReviewResolutionLockScope(number);
    return `refs/sourdaw/review-resolution/pr-${number}`;
}

function trustedReviewResolutionGitPath(env: NodeJS.ProcessEnv = process.env): string {
    const trustedPath = env[TRUSTED_GIT_PATH_ENV];
    if (typeof trustedPath !== 'string' || trustedPath.trim() === '') {
        fail('review-resolution lock requires launcher-resolved trusted git path');
    }
    if (!isAbsolute(trustedPath)) {
        fail('trusted git executable path is not absolute');
    }
    return trustedPath;
}

function trustedReviewResolutionPsPath(env: NodeJS.ProcessEnv = process.env): string {
    const trustedPath = env[TRUSTED_PS_PATH_ENV];
    if (typeof trustedPath !== 'string' || trustedPath.trim() === '') {
        fail('review-resolution lock requires launcher-resolved trusted ps path');
    }
    if (!isAbsolute(trustedPath)) {
        fail('trusted ps executable path is not absolute');
    }
    if (normalize(trustedPath) !== trustedPath) {
        fail('trusted ps executable path is not normalized');
    }
    return trustedPath;
}

function trustedReviewResolutionPowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
    const trustedPath = env[TRUSTED_POWERSHELL_PATH_ENV];
    if (typeof trustedPath !== 'string' || trustedPath.trim() === '') {
        fail('review-resolution lock requires launcher-resolved trusted powershell path');
    }
    if (!isAbsolute(trustedPath)) {
        fail('trusted powershell executable path is not absolute');
    }
    if (normalize(trustedPath) !== trustedPath) {
        fail('trusted powershell executable path is not normalized');
    }
    return trustedPath;
}

function reviewResolutionLockGit(
    primaryRoot: string,
    args: string[],
    input?: string,
    env: NodeJS.ProcessEnv = process.env
) {
    return spawnSync(trustedReviewResolutionGitPath(env), args, {
        cwd: primaryRoot,
        encoding: 'utf8',
        shell: false,
        env,
        ...(input === undefined ? {} : { input }),
    });
}

function parseReviewResolutionLockOwner(contents: string, number: number): ReviewResolutionLockOwner {
    const scope = pullRequestReviewResolutionLockScope(number);
    let value: unknown;
    try {
        value = JSON.parse(contents) as unknown;
    } catch {
        fail(`${scope} lock ownership is malformed`);
    }
    if (
        typeof value !== 'object' ||
        value === null ||
        !('version' in value) ||
        (value.version !== 2 &&
            value.version !== 3 &&
            value.version !== 4 &&
            value.version !== 5 &&
            value.version !== 6) ||
        !('pid' in value) ||
        typeof value.pid !== 'number' ||
        !Number.isSafeInteger(value.pid) ||
        value.pid <= 0 ||
        !('threadId' in value) ||
        typeof value.threadId !== 'string' ||
        value.threadId.trim() === '' ||
        !('head' in value) ||
        typeof value.head !== 'string' ||
        !/^[0-9a-f]{40}$/iu.test(value.head) ||
        !('token' in value) ||
        typeof value.token !== 'string' ||
        !REVIEW_RESOLUTION_LOCK_TOKEN_PATTERN.test(value.token)
    ) {
        fail(`${scope} lock ownership is malformed`);
    }
    const label = `${scope} lock ownership is malformed`;
    let ownerFence: ReviewResolutionLockOwnerFence;
    if (value.version === 4 || value.version === 5 || value.version === 6) {
        ownerFence = parseReviewResolutionLockOwnerFence(
            (value as { ownerFence?: unknown }).ownerFence,
            label,
            value.pid,
            value.version === 5 || value.version === 6
        );
    } else {
        if (
            !('pgid' in value) ||
            typeof value.pgid !== 'number' ||
            !Number.isSafeInteger(value.pgid) ||
            value.pgid <= 0
        ) {
            fail(label);
        }
        ownerFence = { kind: 'pgid', pgid: value.pgid };
    }
    const hasLegacyUnjournaled = 'legacyUnjournaled' in value;
    if (value.version !== 4 && hasLegacyUnjournaled) {
        fail(label);
    }
    const common = {
        pid: value.pid,
        ownerFence,
        threadId: value.threadId,
        head: canonicalGitObjectId(value.head, label),
        token: value.token,
    };
    if (value.version === 5 || value.version === 6) {
        const mutation = parseReviewResolutionLockMutation((value as { mutation?: unknown }).mutation, label);
        if (hasLegacyUnjournaled) {
            fail(label);
        }
        const hasSharedMutationOwnerOid = 'sharedMutationOwnerOid' in value;
        const sharedMutationOwnerValue = (value as { sharedMutationOwnerOid?: unknown }).sharedMutationOwnerOid;
        const sharedMutationOwnerOid =
            hasSharedMutationOwnerOid && typeof sharedMutationOwnerValue === 'string'
                ? reviewResolutionLockObjectId(sharedMutationOwnerValue, number)
                : undefined;
        if (value.version === 6) {
            if (!hasSharedMutationOwnerOid || sharedMutationOwnerOid === undefined) {
                fail(label);
            }
            return {
                version: 6,
                ...common,
                mutation,
                sharedMutationOwnerOid,
            };
        }
        if (hasSharedMutationOwnerOid) {
            fail(label);
        }
        return {
            version: 5,
            ...common,
            mutation,
        };
    }
    if (value.version === 2) {
        return {
            version: 2,
            ...common,
            mutation: { phase: 'idle', epoch: 0 },
            legacyMutation: true,
            legacyUnjournaled: true,
        };
    }
    const mutation = parseLegacyReviewResolutionLockMutation((value as { mutation?: unknown }).mutation, label);
    if (
        value.version === 4 &&
        hasLegacyUnjournaled &&
        ((value as { legacyUnjournaled?: unknown }).legacyUnjournaled !== true ||
            mutation.phase !== 'idle' ||
            mutation.epoch !== 0)
    ) {
        fail(label);
    }
    return {
        version: value.version,
        ...common,
        mutation,
        legacyMutation: true,
        ...(value.version === 4 && hasLegacyUnjournaled ? { legacyUnjournaled: true } : {}),
    };
}

function parseLegacyReviewResolutionLockMutation(value: unknown, label: string): LegacyReviewResolutionLockMutation {
    if (typeof value !== 'object' || value === null || typeof (value as { phase?: unknown }).phase !== 'string') {
        fail(label);
    }
    const epoch = (value as { epoch?: unknown }).epoch;
    if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) {
        fail(label);
    }
    const phase = (value as { phase: string }).phase;
    if (phase === 'idle' || phase === 'createPendingReview' || phase === 'resolveThread') {
        return { phase, epoch };
    }
    if (phase === 'createPendingReviewSettlement') {
        const pendingReviewIds = sortedUniqueStrings(
            Array.isArray((value as { pendingReviewIds?: unknown }).pendingReviewIds)
                ? ((value as { pendingReviewIds: unknown[] }).pendingReviewIds as string[])
                : [],
            label
        );
        const settleAtMs = (value as { settleAtMs?: unknown }).settleAtMs;
        if (
            pendingReviewIds.length === 0 ||
            typeof settleAtMs !== 'number' ||
            !Number.isSafeInteger(settleAtMs) ||
            settleAtMs < 0
        ) {
            fail(label);
        }
        return { phase, epoch, pendingReviewIds, settleAtMs };
    }
    if (phase === 'replyDone') {
        const reviewId = (value as { reviewId?: unknown }).reviewId;
        if (typeof reviewId !== 'string' || reviewId.trim() === '') {
            fail(label);
        }
        return { phase, epoch, reviewId };
    }
    if (phase === 'replyDoneSettlement') {
        const reviewId = (value as { reviewId?: unknown }).reviewId;
        const rawReplies = (value as { replies?: unknown }).replies;
        const settleAtMs = (value as { settleAtMs?: unknown }).settleAtMs;
        if (
            typeof reviewId !== 'string' ||
            reviewId.trim() === '' ||
            !Array.isArray(rawReplies) ||
            typeof settleAtMs !== 'number' ||
            !Number.isSafeInteger(settleAtMs) ||
            settleAtMs < 0
        ) {
            fail(label);
        }
        const replies = rawReplies.map((entry) => {
            if (
                typeof entry !== 'object' ||
                entry === null ||
                typeof (entry as { replyId?: unknown }).replyId !== 'string' ||
                (entry as { replyId: string }).replyId.trim() === '' ||
                typeof (entry as { reviewId?: unknown }).reviewId !== 'string' ||
                (entry as { reviewId: string }).reviewId.trim() === '' ||
                ((entry as { reviewState?: unknown }).reviewState !== 'PENDING' &&
                    (entry as { reviewState?: unknown }).reviewState !== 'COMMENTED')
            ) {
                fail(label);
            }
            return {
                replyId: (entry as { replyId: string }).replyId,
                reviewId: (entry as { reviewId: string }).reviewId,
                reviewState: (entry as { reviewState: 'PENDING' | 'COMMENTED' }).reviewState,
            };
        });
        if (replies.length === 0) {
            fail(label);
        }
        return { phase, epoch, reviewId, replies, settleAtMs };
    }
    if (phase === 'deleteReply') {
        const replyId = (value as { replyId?: unknown }).replyId;
        if (typeof replyId !== 'string' || replyId.trim() === '') {
            fail(label);
        }
        return { phase, epoch, replyId };
    }
    if (phase === 'deletePendingReview') {
        const reviewId = (value as { reviewId?: unknown }).reviewId;
        const rawAllowedAttachedThreadIds = (value as { allowedAttachedThreadIds?: unknown }).allowedAttachedThreadIds;
        const snapshotHead = (value as { snapshotHead?: unknown }).snapshotHead;
        if (typeof reviewId !== 'string' || reviewId.trim() === '' || !Array.isArray(rawAllowedAttachedThreadIds)) {
            fail(label);
        }
        return {
            phase,
            epoch,
            reviewId,
            allowedAttachedThreadIds: sortedUniqueStrings(rawAllowedAttachedThreadIds as string[], label),
            snapshotHead: typeof snapshotHead === 'string' ? canonicalGitObjectId(snapshotHead, label) : fail(label),
        };
    }
    if (phase === 'submitReview' || phase === 'updateReviewBody') {
        const reviewId = (value as { reviewId?: unknown }).reviewId;
        const body = (value as { body?: unknown }).body;
        if (typeof reviewId !== 'string' || reviewId.trim() === '' || typeof body !== 'string') {
            fail(label);
        }
        return { phase, epoch, reviewId, body };
    }
    return fail(label);
}

function parseReviewResolutionMarkerSnapshot(value: unknown, label: string): ReviewResolutionMarkerSnapshot {
    if (typeof value !== 'object' || value === null) {
        fail(label);
    }
    const markerId = (value as { markerId?: unknown }).markerId;
    const markerFullDatabaseId = (value as { markerFullDatabaseId?: unknown }).markerFullDatabaseId;
    const reviewId = (value as { reviewId?: unknown }).reviewId;
    const reviewFullDatabaseId = (value as { reviewFullDatabaseId?: unknown }).reviewFullDatabaseId;
    const reviewState = (value as { reviewState?: unknown }).reviewState;
    const reviewBody = (value as { reviewBody?: unknown }).reviewBody;
    const reviewCommitOid = (value as { reviewCommitOid?: unknown }).reviewCommitOid;
    const reviewAuthorNodeId = (value as { reviewAuthorNodeId?: unknown }).reviewAuthorNodeId;
    const reviewAuthorLogin = (value as { reviewAuthorLogin?: unknown }).reviewAuthorLogin;
    const reviewAuthorType = (value as { reviewAuthorType?: unknown }).reviewAuthorType;
    if (
        typeof markerId !== 'string' ||
        markerId.trim() === '' ||
        !isDecimalId(markerFullDatabaseId) ||
        typeof reviewId !== 'string' ||
        reviewId.trim() === '' ||
        !isDecimalId(reviewFullDatabaseId) ||
        typeof reviewState !== 'string' ||
        typeof reviewBody !== 'string' ||
        typeof reviewCommitOid !== 'string' ||
        (reviewAuthorNodeId !== null && typeof reviewAuthorNodeId !== 'string') ||
        (reviewAuthorLogin !== null && typeof reviewAuthorLogin !== 'string') ||
        (reviewAuthorType !== null && typeof reviewAuthorType !== 'string')
    ) {
        fail(label);
    }
    return {
        markerId,
        markerFullDatabaseId,
        reviewId,
        reviewFullDatabaseId,
        reviewState,
        reviewBody,
        reviewCommitOid: canonicalGitObjectId(reviewCommitOid, label),
        reviewAuthorNodeId,
        reviewAuthorLogin,
        reviewAuthorType,
    };
}

function hasDistinctDeleteReplyMarkerSnapshots(
    immutableEnvelope: ReviewResolutionMarkerSnapshot,
    target: ReviewResolutionMarkerSnapshot
): boolean {
    return (
        immutableEnvelope.markerId !== target.markerId &&
        immutableEnvelope.markerFullDatabaseId !== target.markerFullDatabaseId &&
        (immutableEnvelope.reviewId === target.reviewId) ===
            (immutableEnvelope.reviewFullDatabaseId === target.reviewFullDatabaseId)
    );
}

function parseReviewResolutionLockMutation(value: unknown, label: string): ReviewResolutionLockMutation {
    if (typeof value !== 'object' || value === null || typeof (value as { phase?: unknown }).phase !== 'string') {
        fail(label);
    }
    const epoch = (value as { epoch?: unknown }).epoch;
    if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) {
        fail(label);
    }
    const phase = (value as { phase: string }).phase;
    if (phase === 'idle' || phase === 'resolveThread') {
        return { phase, epoch };
    }
    if (phase === 'createPendingReview') {
        const pullRequestId = (value as { pullRequestId?: unknown }).pullRequestId;
        const body = (value as { body?: unknown }).body;
        const reviewCommitOid = (value as { reviewCommitOid?: unknown }).reviewCommitOid;
        if (
            typeof pullRequestId !== 'string' ||
            pullRequestId.trim() === '' ||
            typeof body !== 'string' ||
            typeof reviewCommitOid !== 'string'
        ) {
            fail(label);
        }
        return {
            phase,
            epoch,
            pullRequestId,
            body,
            reviewCommitOid: canonicalGitObjectId(reviewCommitOid, label),
        };
    }
    if (phase === 'createPendingReviewSettlement') {
        const pullRequestId = (value as { pullRequestId?: unknown }).pullRequestId;
        const body = (value as { body?: unknown }).body;
        const reviewCommitOid = (value as { reviewCommitOid?: unknown }).reviewCommitOid;
        const replayed = (value as { replayed?: unknown }).replayed;
        const pendingReviewIds = sortedUniqueStrings(
            Array.isArray((value as { pendingReviewIds?: unknown }).pendingReviewIds)
                ? ((value as { pendingReviewIds: unknown[] }).pendingReviewIds as string[])
                : [],
            label
        );
        const settleAtMs = (value as { settleAtMs?: unknown }).settleAtMs;
        if (
            typeof pullRequestId !== 'string' ||
            pullRequestId.trim() === '' ||
            typeof body !== 'string' ||
            typeof reviewCommitOid !== 'string' ||
            typeof replayed !== 'boolean' ||
            typeof settleAtMs !== 'number' ||
            !Number.isSafeInteger(settleAtMs) ||
            settleAtMs < 0
        ) {
            fail(label);
        }
        return {
            phase,
            epoch,
            pullRequestId,
            body,
            reviewCommitOid: canonicalGitObjectId(reviewCommitOid, label),
            pendingReviewIds,
            settleAtMs,
            replayed,
        };
    }
    if (phase === 'replyDone') {
        const reviewId = (value as { reviewId?: unknown }).reviewId;
        const reviewState = (value as { reviewState?: unknown }).reviewState;
        const body = (value as { body?: unknown }).body;
        const reviewCommitOid = (value as { reviewCommitOid?: unknown }).reviewCommitOid;
        if (
            typeof reviewId !== 'string' ||
            reviewId.trim() === '' ||
            reviewState !== 'PENDING' ||
            typeof body !== 'string' ||
            typeof reviewCommitOid !== 'string'
        ) {
            fail(label);
        }
        return {
            phase,
            epoch,
            reviewId,
            reviewState,
            body,
            reviewCommitOid: canonicalGitObjectId(reviewCommitOid, label),
        };
    }
    if (phase === 'replyDoneSettlement') {
        const reviewId = (value as { reviewId?: unknown }).reviewId;
        const body = (value as { body?: unknown }).body;
        const reviewCommitOid = (value as { reviewCommitOid?: unknown }).reviewCommitOid;
        const replayed = (value as { replayed?: unknown }).replayed;
        const rawReplies = (value as { replies?: unknown }).replies;
        const settleAtMs = (value as { settleAtMs?: unknown }).settleAtMs;
        if (
            typeof reviewId !== 'string' ||
            reviewId.trim() === '' ||
            typeof body !== 'string' ||
            typeof reviewCommitOid !== 'string' ||
            typeof replayed !== 'boolean' ||
            !Array.isArray(rawReplies) ||
            typeof settleAtMs !== 'number' ||
            !Number.isSafeInteger(settleAtMs) ||
            settleAtMs < 0
        ) {
            fail(label);
        }
        const replies = rawReplies.map((entry) => {
            if (
                typeof entry !== 'object' ||
                entry === null ||
                typeof (entry as { replyId?: unknown }).replyId !== 'string' ||
                (entry as { replyId: string }).replyId.trim() === '' ||
                typeof (entry as { reviewId?: unknown }).reviewId !== 'string' ||
                (entry as { reviewId: string }).reviewId.trim() === '' ||
                ((entry as { reviewState?: unknown }).reviewState !== 'PENDING' &&
                    (entry as { reviewState?: unknown }).reviewState !== 'COMMENTED')
            ) {
                fail(label);
            }
            return {
                replyId: (entry as { replyId: string }).replyId,
                reviewId: (entry as { reviewId: string }).reviewId,
                reviewState: (entry as { reviewState: 'PENDING' | 'COMMENTED' }).reviewState,
            };
        });
        return {
            phase,
            epoch,
            reviewId,
            body,
            reviewCommitOid: canonicalGitObjectId(reviewCommitOid, label),
            replies,
            settleAtMs,
            replayed,
        };
    }
    if (phase === 'deleteReply') {
        const replyId = (value as { replyId?: unknown }).replyId;
        if (typeof replyId !== 'string' || replyId.trim() === '') {
            fail(label);
        }
        const immutableEnvelope = (value as { immutableEnvelope?: unknown }).immutableEnvelope;
        const target = (value as { target?: unknown }).target;
        if (target !== undefined && immutableEnvelope === undefined) {
            fail(label);
        }
        const parsedImmutableEnvelope =
            immutableEnvelope === undefined ? undefined : parseReviewResolutionMarkerSnapshot(immutableEnvelope, label);
        const parsedTarget = target === undefined ? undefined : parseReviewResolutionMarkerSnapshot(target, label);
        if (parsedTarget !== undefined && parsedTarget.markerId !== replyId) {
            fail(label);
        }
        if (
            parsedImmutableEnvelope !== undefined &&
            parsedTarget !== undefined &&
            !hasDistinctDeleteReplyMarkerSnapshots(parsedImmutableEnvelope, parsedTarget)
        ) {
            fail(label);
        }
        return {
            phase,
            epoch,
            replyId,
            ...(parsedImmutableEnvelope === undefined ? {} : { immutableEnvelope: parsedImmutableEnvelope }),
            ...(parsedTarget === undefined ? {} : { target: parsedTarget }),
        };
    }
    if (phase === 'deletePendingReview') {
        const reviewId = (value as { reviewId?: unknown }).reviewId;
        const rawAllowedAttachedThreadIds = (value as { allowedAttachedThreadIds?: unknown }).allowedAttachedThreadIds;
        const snapshotHead = (value as { snapshotHead?: unknown }).snapshotHead;
        if (typeof reviewId !== 'string' || reviewId.trim() === '' || !Array.isArray(rawAllowedAttachedThreadIds)) {
            fail(label);
        }
        return {
            phase,
            epoch,
            reviewId,
            allowedAttachedThreadIds: sortedUniqueStrings(rawAllowedAttachedThreadIds as string[], label),
            snapshotHead: typeof snapshotHead === 'string' ? canonicalGitObjectId(snapshotHead, label) : fail(label),
        };
    }
    if (phase === 'submitReview' || phase === 'updateReviewBody') {
        const reviewId = (value as { reviewId?: unknown }).reviewId;
        const reviewDatabaseId = (value as { reviewDatabaseId?: unknown }).reviewDatabaseId;
        const body = (value as { body?: unknown }).body;
        const reviewCommitOid = (value as { reviewCommitOid?: unknown }).reviewCommitOid;
        const marker = (value as { marker?: unknown }).marker;
        if (
            typeof reviewId !== 'string' ||
            reviewId.trim() === '' ||
            typeof body !== 'string' ||
            typeof reviewCommitOid !== 'string'
        ) {
            fail(label);
        }
        if (phase === 'updateReviewBody' && reviewDatabaseId !== undefined && !isDecimalId(reviewDatabaseId)) {
            fail(label);
        }
        return {
            phase,
            epoch,
            reviewId,
            ...(phase === 'updateReviewBody' && typeof reviewDatabaseId === 'string' ? { reviewDatabaseId } : {}),
            body,
            reviewCommitOid: canonicalGitObjectId(reviewCommitOid, label),
            ...(phase === 'updateReviewBody' && marker !== undefined
                ? { marker: parseReviewResolutionMarkerSnapshot(marker, label) }
                : {}),
        };
    }
    return fail(label);
}

function reviewResolutionLockObjectId(value: string, number: number): string {
    const scope = pullRequestReviewResolutionLockScope(number);
    return canonicalGitObjectId(value, `${scope} lock object identity is malformed`, [40, 64]);
}

function parseReviewResolutionLockOwnerFence(
    value: unknown,
    label: string,
    ownerPid?: number,
    requireDetachedPgidOwner: boolean = false
): ReviewResolutionLockOwnerFence {
    if (typeof value !== 'object' || value === null || typeof (value as { kind?: unknown }).kind !== 'string') {
        fail(label);
    }
    if ((value as { kind: string }).kind === 'pgid') {
        const pgid = (value as { pgid?: unknown }).pgid;
        const leaderStartedAt = (value as { leaderStartedAt?: unknown }).leaderStartedAt;
        if (
            !isPositiveSafeInteger(pgid) ||
            'pid' in value ||
            (requireDetachedPgidOwner && ownerPid !== undefined && pgid !== ownerPid) ||
            (leaderStartedAt !== undefined && (typeof leaderStartedAt !== 'string' || leaderStartedAt.trim() === ''))
        ) {
            fail(label);
        }
        return leaderStartedAt === undefined ? { kind: 'pgid', pgid } : { kind: 'pgid', pgid, leaderStartedAt };
    }
    if ((value as { kind: string }).kind === 'pid') {
        const pid = (value as { pid?: unknown }).pid;
        if (!isPositiveSafeInteger(pid) || 'pgid' in value || (ownerPid !== undefined && pid !== ownerPid)) {
            fail(label);
        }
        return { kind: 'pid', pid };
    }
    if ((value as { kind: string }).kind === 'win32-process-tree') {
        const version = (value as { version?: unknown }).version;
        const rootPid = (value as { rootPid?: unknown }).rootPid;
        const rootStartedAt = (value as { rootStartedAt?: unknown }).rootStartedAt;
        if (
            version !== 1 ||
            !isPositiveSafeInteger(rootPid) ||
            typeof rootStartedAt !== 'string' ||
            rootStartedAt.trim() === '' ||
            'pid' in value ||
            'pgid' in value ||
            (ownerPid !== undefined && rootPid !== ownerPid)
        ) {
            fail(label);
        }
        return {
            kind: 'win32-process-tree',
            version: 1,
            rootPid,
            rootStartedAt,
        };
    }
    return fail(label);
}

function reviewResolutionOwnerFenceLabel(ownerFence: ReviewResolutionLockOwnerFence): string {
    if (ownerFence.kind === 'pgid') {
        return `process group ${ownerFence.pgid}`;
    }
    if (ownerFence.kind === 'pid') {
        return `process ${ownerFence.pid}`;
    }
    return `Windows process tree rooted at process ${ownerFence.rootPid}`;
}

function signalReviewResolutionLivenessTarget(target: number): void {
    process.kill(target, 0);
}

function isLiveReviewResolutionTarget(
    target: number,
    probe: ReviewResolutionLivenessProbe = signalReviewResolutionLivenessTarget
): boolean {
    try {
        probe(target);
        return true;
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
            return false;
        }
        if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
            return true;
        }
        throw error;
    }
}

function isLiveProcessId(
    pid: number,
    probe: ReviewResolutionLivenessProbe = signalReviewResolutionLivenessTarget
): boolean {
    return isLiveReviewResolutionTarget(pid, probe);
}

function readTrustedWindowsProcessRows(
    command: string,
    env: NodeJS.ProcessEnv = process.env,
    runWindowsProcessQuery: WindowsProcessQueryRunner = spawnSync
): WindowsProcessRow[] | undefined {
    const result = runWindowsProcessQuery(
        trustedReviewResolutionPowerShellPath(env),
        ['-NoProfile', '-NonInteractive', '-Command', command],
        {
            encoding: 'utf8',
            shell: false,
            env,
            maxBuffer: 8 * 1024 * 1024,
        }
    );
    if (result.error !== undefined || result.status !== 0 || result.stdout.trim() === '') {
        return undefined;
    }
    return parseWindowsProcessRows(result.stdout);
}

function parseWindowsProcessRows(output: string): WindowsProcessRow[] | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(output) as unknown;
    } catch {
        return undefined;
    }
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const normalized: WindowsProcessRow[] = [];
    const seen = new Set<number>();
    for (const row of rows) {
        const processId =
            typeof row === 'object' && row !== null ? (row as { ProcessId?: unknown }).ProcessId : undefined;
        if (processId === 0) {
            continue;
        }
        if (
            typeof row !== 'object' ||
            row === null ||
            !isPositiveSafeInteger(processId) ||
            typeof (row as { ParentProcessId?: unknown }).ParentProcessId !== 'number' ||
            !Number.isSafeInteger((row as { ParentProcessId: number }).ParentProcessId) ||
            (row as { ParentProcessId: number }).ParentProcessId < 0 ||
            typeof (row as { CreationDate?: unknown }).CreationDate !== 'string' ||
            parseWindowsProcessStartedAt((row as { CreationDate: string }).CreationDate) === undefined
        ) {
            return undefined;
        }
        const pid = processId;
        if (seen.has(pid)) {
            return undefined;
        }
        seen.add(pid);
        normalized.push({
            pid,
            parentPid: (row as { ParentProcessId: number }).ParentProcessId,
            startedAt: (row as { CreationDate: string }).CreationDate,
        });
    }
    return normalized;
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
    const offsetMinutes = offset === null ? Number(selectedOffset[2]) : Number(offset[2]) * 60 + Number(offset[3]);
    if (offsetMinutes > 23 * 60 + 59) {
        return undefined;
    }
    const offsetTicks = BigInt(offsetMinutes) * 60_000n * 10_000n;
    return offsetSign === '+' ? ticks - offsetTicks : ticks + offsetTicks;
}

const windowsProcessCreationIdentityProperty =
    "@{Name='CreationDate';Expression={$_.CreationDate.ToUniversalTime().ToString('O',[System.Globalization.CultureInfo]::InvariantCulture)}}";

function inspectLiveWindowsProcesses(
    env: NodeJS.ProcessEnv = process.env,
    runWindowsProcessQuery: WindowsProcessQueryRunner = spawnSync
): WindowsProcessRow[] | undefined {
    return readTrustedWindowsProcessRows(
        `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,${windowsProcessCreationIdentityProperty} | ConvertTo-Json -Compress`,
        env,
        runWindowsProcessQuery
    );
}

export function currentWindowsProcessTreeFence(
    pid: number,
    env: NodeJS.ProcessEnv = process.env,
    runWindowsProcessQuery: WindowsProcessQueryRunner = spawnSync
): ReviewResolutionLockOwnerFence {
    const rows = readTrustedWindowsProcessRows(
        `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,ParentProcessId,${windowsProcessCreationIdentityProperty} | ConvertTo-Json -Compress`,
        env,
        runWindowsProcessQuery
    );
    const current = rows?.[0];
    if (rows === undefined || rows.length !== 1 || current?.pid !== pid) {
        fail('review-resolution lock could not determine the current Windows process identity');
    }
    return {
        kind: 'win32-process-tree',
        version: 1,
        rootPid: pid,
        rootStartedAt: current.startedAt,
    };
}

function isLiveWindowsProcessTree(
    ownerFence: Extract<ReviewResolutionLockOwnerFence, { kind: 'win32-process-tree' }>,
    inspect: () => WindowsProcessRow[] | undefined = () => inspectLiveWindowsProcesses()
): boolean {
    const rows = inspect();
    if (rows === undefined) {
        return true;
    }
    if (rows.length === 0) {
        return false;
    }
    const ownerStartedAt = parseWindowsProcessStartedAt(ownerFence.rootStartedAt);
    if (ownerStartedAt === undefined) {
        return true;
    }
    const root = rows.find((row) => row.pid === ownerFence.rootPid);
    const rootStartedAt = root === undefined ? undefined : parseWindowsProcessStartedAt(root.startedAt);
    if (root !== undefined && rootStartedAt === undefined) {
        return true;
    }
    if (rootStartedAt === ownerStartedAt) {
        return true;
    }
    const rowsByPid = new Map(rows.map((row) => [row.pid, row]));
    for (const candidate of rows) {
        const visited = new Set<number>();
        let current: WindowsProcessRow | undefined = candidate;
        while (current !== undefined && !visited.has(current.pid)) {
            const currentStartedAt = parseWindowsProcessStartedAt(current.startedAt);
            if (currentStartedAt === undefined) {
                return true;
            }
            const parent = rowsByPid.get(current.parentPid);
            if (parent !== undefined) {
                const parentStartedAt = parseWindowsProcessStartedAt(parent.startedAt);
                if (parentStartedAt === undefined || currentStartedAt < parentStartedAt) {
                    return true;
                }
            }
            if (current.parentPid === ownerFence.rootPid) {
                if (rootStartedAt !== undefined && currentStartedAt > rootStartedAt) {
                    break;
                }
                return true;
            }
            visited.add(current.pid);
            current = parent;
        }
    }
    return false;
}

export function reviewResolutionOwnerFenceIsLive(
    ownerFence: ReviewResolutionLockOwnerFence,
    port: ReviewResolutionOwnerFenceLivenessPort = {}
): boolean {
    const platform = port.platform ?? process.platform;
    const probe = port.probe ?? signalReviewResolutionLivenessTarget;
    if (ownerFence.kind === 'pgid') {
        if (typeof ownerFence.leaderStartedAt !== 'string' || ownerFence.leaderStartedAt.trim() === '') {
            return isLiveProcessGroup(ownerFence.pgid, probe);
        }
        const leaderStartedAt = (port.inspectPosixGroupLeader ?? inspectPosixProcessGroupLeader)(ownerFence.pgid);
        if (leaderStartedAt === null) {
            return true;
        }
        if (leaderStartedAt !== undefined && leaderStartedAt !== ownerFence.leaderStartedAt) {
            return false;
        }
        return isLiveProcessGroup(ownerFence.pgid, probe);
    }
    if (ownerFence.kind === 'pid') {
        if (platform === 'win32') {
            return true;
        }
        return isLiveProcessId(ownerFence.pid, probe);
    }
    const inspectWindowsProcessRows =
        port.inspectWindowsProcessRows ??
        (() => inspectLiveWindowsProcesses(port.windowsProcessQueryEnv, port.runWindowsProcessQuery));
    return isLiveWindowsProcessTree(ownerFence, inspectWindowsProcessRows);
}

function writeReviewResolutionLockOwner(
    primaryRoot: string,
    owner: CurrentReviewResolutionLockOwner,
    number: number
): string {
    const result = reviewResolutionLockGit(primaryRoot, ['hash-object', '-w', '--stdin'], JSON.stringify(owner));
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`${pullRequestReviewResolutionLockScope(number)} lock owner could not be stored`);
    }
    return reviewResolutionLockObjectId(result.stdout, number);
}

function readReviewResolutionLockOid(primaryRoot: string, ref: string, number: number) {
    const result = reviewResolutionLockGit(primaryRoot, ['show-ref', '--verify', '--hash', ref]);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status === 1) {
        return undefined;
    }
    if (result.status !== 0) {
        fail(`${pullRequestReviewResolutionLockScope(number)} lock ownership cannot be verified`);
    }
    return reviewResolutionLockObjectId(result.stdout, number);
}

function readReviewResolutionLockOwner(primaryRoot: string, oid: string, number: number): ReviewResolutionLockOwner {
    const result = reviewResolutionLockGit(primaryRoot, ['cat-file', 'blob', oid]);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`${pullRequestReviewResolutionLockScope(number)} lock ownership cannot be verified`);
    }
    return parseReviewResolutionLockOwner(result.stdout, number);
}

function updateReviewResolutionLockRef(primaryRoot: string, args: string[]): boolean {
    const result = reviewResolutionLockGit(primaryRoot, ['update-ref', ...args]);
    if (result.error !== undefined) {
        throw result.error;
    }
    return result.status === 0;
}

function updateReviewResolutionLockRefsTransaction(primaryRoot: string, commands: string[]): boolean {
    const result = reviewResolutionLockGit(
        primaryRoot,
        ['update-ref', '--stdin'],
        ['start', ...commands, 'prepare', 'commit', ''].join('\n')
    );
    if (result.error !== undefined) {
        throw result.error;
    }
    return result.status === 0;
}

export type StandaloneReviewResolutionSharedLockRecoveryPort = {
    ownerFenceIsLive?: (ownerFence: ReviewResolutionLockOwnerFence) => boolean;
    beforeExactRelease?: () => void;
    updateRef?: (primaryRoot: string, args: string[]) => boolean;
    updateRefsTransaction?: (primaryRoot: string, commands: string[]) => boolean;
    gitPath?: string;
    readReviewResolutionLockOid?: (primaryRoot: string, ref: string, number: number) => string | undefined;
};

export function recoverStandaloneReviewResolutionSharedMutationLock(
    primaryRoot: string,
    number: number,
    expectedSharedOwnerOid: string,
    port: StandaloneReviewResolutionSharedLockRecoveryPort = {}
): string | undefined {
    const reviewResolutionRef = pullRequestReviewResolutionLockRef(number);
    const readInnerRef = port.readReviewResolutionLockOid ?? readReviewResolutionLockOid;
    const sharedRef = pullRequestMutationLockRef(number);
    const expectedOid = reviewResolutionLockObjectId(expectedSharedOwnerOid, number);
    const gitPath = port.gitPath ?? trustedReviewResolutionGitPath();
    const innerOwnerOid = readInnerRef(primaryRoot, reviewResolutionRef, number);
    const currentOid = readPullRequestMutationLockOid(primaryRoot, sharedRef, number, gitPath);
    if (innerOwnerOid === expectedOid) {
        return undefined;
    }
    if (currentOid === undefined) {
        if (innerOwnerOid !== undefined) {
            return undefined;
        }
        fail(`${pullRequestReviewResolutionLockScope(number)} standalone shared lock is not held`);
    }
    if (currentOid !== expectedOid) {
        fail(
            `${pullRequestReviewResolutionLockScope(number)} standalone shared lock ownership changed before recovery`
        );
    }
    const owner = readPullRequestMutationLockOwner(primaryRoot, currentOid, number, gitPath);
    if (!isReviewResolutionPullRequestMutationLockOwner(owner)) {
        fail(`${pullRequestReviewResolutionLockScope(number)} standalone shared lock ownership is not recoverable`);
    }
    if ((port.ownerFenceIsLive ?? reviewResolutionOwnerFenceIsLive)(owner.ownerFence)) {
        fail(`${pullRequestReviewResolutionLockScope(number)} standalone shared lock execution fence remains live`);
    }
    if (innerOwnerOid !== undefined) {
        const innerOwner = readReviewResolutionLockOwner(primaryRoot, innerOwnerOid, number);
        if (innerOwner.version === 6 && innerOwner.sharedMutationOwnerOid === currentOid) {
            fail(
                `${pullRequestReviewResolutionLockScope(number)} standalone shared lock has a paired review-resolution lock`
            );
        }
        if (innerOwner.version === 6) {
            fail(
                `${pullRequestReviewResolutionLockScope(number)} standalone shared lock cannot retire while a review-resolution lock retains another shared owner`
            );
        }
        if (innerOwner.version !== 5) {
            fail(
                `${pullRequestReviewResolutionLockScope(number)} standalone shared lock has a non-current review-resolution lock`
            );
        }
        if (innerOwner.mutation.phase !== 'idle') {
            fail(
                `${pullRequestReviewResolutionLockScope(number)} standalone shared lock preserves a non-idle review-resolution lock; recover with ${reviewResolutionRecoveryCommand(number, innerOwnerOid)}`
            );
        }
        if ((port.ownerFenceIsLive ?? reviewResolutionOwnerFenceIsLive)(innerOwner.ownerFence)) {
            fail(
                `${pullRequestReviewResolutionLockScope(number)} standalone shared lock inner execution fence remains live`
            );
        }
    }
    port.beforeExactRelease?.();
    const expectedInnerOid = innerOwnerOid ?? '0'.repeat(currentOid.length);
    if (
        !(port.updateRefsTransaction ?? updateReviewResolutionLockRefsTransaction)(primaryRoot, [
            `verify ${reviewResolutionRef} ${expectedInnerOid}`,
            `delete ${sharedRef} ${currentOid}`,
        ])
    ) {
        fail(`${pullRequestReviewResolutionLockScope(number)} standalone shared lock ownership changed before release`);
    }
    return `review-resolution-standalone-shared-lock-recovered:${number}:${owner.threadId}:${owner.head}`;
}

function currentPosixProcessGroupFence(
    pid: number,
    env: NodeJS.ProcessEnv = process.env
): ReviewResolutionLockOwnerFence {
    const invariantEnv = invariantPosixProcessIdentityEnv();
    const result = spawnSync(trustedReviewResolutionPsPath(env), ['-o', 'pgid=', '-p', String(pid)], {
        encoding: 'utf8',
        shell: false,
        env: invariantEnv,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail('review-resolution lock could not determine the current process group');
    }
    const pgid = Number(result.stdout.trim());
    if (!Number.isSafeInteger(pgid) || pgid <= 0) {
        fail('review-resolution lock reported an invalid current process group');
    }
    const leader = spawnSync(trustedReviewResolutionPsPath(env), ['-o', 'lstart=', '-p', String(pgid)], {
        encoding: 'utf8',
        shell: false,
        env: invariantEnv,
    });
    if (leader.error !== undefined) {
        throw leader.error;
    }
    const leaderStartedAt = leader.stdout.trim();
    if (leader.status !== 0 || leaderStartedAt === '') {
        fail('review-resolution lock could not determine the current process-group leader identity');
    }
    return { kind: 'pgid', pgid, leaderStartedAt };
}

function currentReviewResolutionExecutionFence(
    platform: NodeJS.Platform = process.platform
): ReviewResolutionExecutionFence {
    const pid = process.pid;
    if (platform === 'win32') {
        return {
            pid,
            ownerFence: currentWindowsProcessTreeFence(pid),
        };
    }
    return {
        pid,
        ownerFence: currentPosixProcessGroupFence(pid),
    };
}

function assertReviewResolutionExecutionFence(
    executionFence: ReviewResolutionExecutionFence,
    platform: NodeJS.Platform
): ReviewResolutionExecutionFence {
    if (!isPositiveSafeInteger(executionFence.pid)) {
        fail('review-resolution lock reported an invalid execution PID');
    }
    if (platform === 'win32') {
        if (executionFence.ownerFence.kind === 'pid' && executionFence.ownerFence.pid === executionFence.pid) {
            return executionFence;
        }
        if (
            executionFence.ownerFence.kind === 'win32-process-tree' &&
            executionFence.ownerFence.version === 1 &&
            executionFence.ownerFence.rootPid === executionFence.pid &&
            executionFence.ownerFence.rootStartedAt.trim() !== ''
        ) {
            return executionFence;
        }
        {
            fail('review-resolution lock requires exact PID fencing on Windows');
        }
    }
    if (executionFence.ownerFence.kind !== 'pgid' || !isPositiveSafeInteger(executionFence.ownerFence.pgid)) {
        fail('review-resolution lock requires POSIX process-group fencing');
    }
    return executionFence;
}

function pushActiveReviewResolutionLock(lock: ActiveReviewResolutionLock): void {
    activeReviewResolutionLocks.push(lock);
}

function popActiveReviewResolutionLock(lock: ActiveReviewResolutionLock): void {
    const current = activeReviewResolutionLocks.pop();
    if (current !== lock) {
        fail('review-resolution lock stack corrupted');
    }
}

function currentActiveReviewResolutionLock(primaryRoot: string, number: number): ActiveReviewResolutionLock {
    const current = activeReviewResolutionLocks.at(-1);
    if (current === undefined || current.primaryRoot !== primaryRoot || current.number !== number) {
        fail(`${pullRequestReviewResolutionLockScope(number)} mutation is not fenced by the active lock owner`);
    }
    return current;
}

function advanceActiveReviewResolutionLockMutation(
    primaryRoot: string,
    number: number,
    mutation: ReviewResolutionLockMutationUpdate
): void {
    const active = currentActiveReviewResolutionLock(primaryRoot, number);
    replaceActiveReviewResolutionLockMutation(
        primaryRoot,
        active,
        {
            ...mutation,
            epoch: active.owner.mutation.epoch + 1,
        },
        number
    );
}

function replaceActiveReviewResolutionLockMutation(
    primaryRoot: string,
    active: ActiveReviewResolutionLock,
    mutation: ReviewResolutionLockMutation,
    number: number
): void {
    const nextOwner: CurrentReviewResolutionLockOwner =
        active.owner.version === 6 ? { ...active.owner, mutation } : { ...active.owner, mutation };
    const nextOid = writeReviewResolutionLockOwner(primaryRoot, nextOwner, number);
    if (!updateReviewResolutionLockRef(primaryRoot, [active.ref, nextOid, active.oid])) {
        fail(`${pullRequestReviewResolutionLockScope(number)} lock ownership changed before mutation`);
    }
    active.oid = nextOid;
    active.owner = nextOwner;
}

export async function assertDetachedReviewResolutionChild(
    markerValue: string,
    port: ReviewResolutionChildValidationPort = {}
): Promise<ReviewResolutionTrustedLauncher> {
    const marker = parseReviewResolutionChildLaunchMarker(markerValue);
    const platform = port.platform ?? process.platform;
    const executionFence = assertReviewResolutionExecutionFence(
        port.executionFence ?? currentReviewResolutionExecutionFence(platform),
        platform
    );
    if (executionFence.ownerFence.kind === 'pgid' && executionFence.pid !== executionFence.ownerFence.pgid) {
        fail('review:resolve must run in its own detached POSIX process group');
    }
    const sleep = port.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const persisted = readPersistedReviewResolutionChildLaunchMarker(marker);
        if (persisted.pid === null) {
            await sleep(10);
            continue;
        }
        if (persisted.pid !== executionFence.pid) {
            invalidReviewResolutionChildMarker();
        }
        const capability = readPersistedReviewResolutionBootstrapCapability(
            persisted.capabilityPath,
            marker.token,
            platform
        );
        rmSync(marker.path, { force: true });
        return capability.trustedLauncher;
    }
    return invalidReviewResolutionChildMarker();
}

function isLiveProcessGroup(
    pgid: number,
    probe: ReviewResolutionLivenessProbe = signalReviewResolutionLivenessTarget
): boolean {
    return isLiveReviewResolutionTarget(-pgid, probe);
}

function inspectPosixProcessGroupLeader(pgid: number, env: NodeJS.ProcessEnv = process.env): string | undefined | null {
    const invariantEnv = invariantPosixProcessIdentityEnv();
    const result = spawnSync(trustedReviewResolutionPsPath(env), ['-o', 'lstart=', '-p', String(pgid)], {
        encoding: 'utf8',
        shell: false,
        env: invariantEnv,
    });
    if (result.error !== undefined || (result.status !== 0 && result.status !== 1)) {
        return null;
    }
    const leaderStartedAt = result.stdout.trim();
    return leaderStartedAt === '' ? undefined : leaderStartedAt;
}

function invariantPosixProcessIdentityEnv(): NodeJS.ProcessEnv {
    return { LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
}

function acquirePullRequestReviewResolutionLock(
    primaryRoot: string,
    number: number,
    threadId: string,
    expectedHead: string,
    executionFence: ReviewResolutionExecutionFence,
    _platform: NodeJS.Platform,
    sharedMutationOwnerOid?: string,
    acquireRef: (primaryRoot: string, args: string[]) => boolean = updateReviewResolutionLockRef,
    readOid: (primaryRoot: string, ref: string, number: number) => string | undefined = readReviewResolutionLockOid
): { ref: string; oid: string; owner: CurrentReviewResolutionLockOwner } {
    const ref = pullRequestReviewResolutionLockRef(number);
    const commonOwner = {
        pid: executionFence.pid,
        ownerFence: executionFence.ownerFence,
        threadId,
        head: expectedHead,
        token: randomUUID(),
        mutation: { phase: 'idle', epoch: 0 },
    } satisfies ReviewResolutionLockOwnerBase;
    const owner: CurrentReviewResolutionLockOwner =
        sharedMutationOwnerOid === undefined
            ? { version: 5, ...commonOwner }
            : {
                  version: 6,
                  ...commonOwner,
                  sharedMutationOwnerOid: reviewResolutionLockObjectId(sharedMutationOwnerOid, number),
              };
    const oid = writeReviewResolutionLockOwner(primaryRoot, owner, number);
    if (acquireRef(primaryRoot, [ref, oid, '0'.repeat(oid.length)])) {
        return { ref, oid, owner };
    }

    const previousOid = readOid(primaryRoot, ref, number);
    if (previousOid === undefined) {
        return fail(`${pullRequestReviewResolutionLockScope(number)} lock could not be acquired`);
    }
    const previousOwner = readReviewResolutionLockOwner(primaryRoot, previousOid, number);
    return fail(
        `${pullRequestReviewResolutionLockScope(number)} is already being resolved by ${reviewResolutionOwnerFenceLabel(previousOwner.ownerFence)}; exact previous owner ${previousOid}; recover with ${reviewResolutionRecoveryCommand(number, previousOid)}`
    );
}

function releasePullRequestReviewResolutionLock(primaryRoot: string, ref: string, oid: string, number: number): void {
    if (!updateReviewResolutionLockRef(primaryRoot, ['-d', ref, oid])) {
        fail(`${pullRequestReviewResolutionLockScope(number)} lock ownership changed before release`);
    }
}

function reviewResolutionRecoveryCommand(number: number, ownerOid: string): string {
    return `pnpm review:resolve:recover ${number} --owner ${ownerOid}`;
}

function preserveReviewResolutionLockFailure(
    number: number,
    active: ActiveReviewResolutionLock,
    error: unknown
): never {
    const phase = active.owner.mutation.phase;
    const epoch = active.owner.mutation.epoch;
    throw new Error(
        `${errorMessage(error)}; ${pullRequestReviewResolutionLockScope(number)} preserved exact lock owner ${active.oid} after ${phase} epoch ${epoch}; recover with ${reviewResolutionRecoveryCommand(number, active.oid)}`,
        originalErrorOptions(error)
    );
}

function preserveNewerReviewResolutionLockOwner(
    number: number,
    active: ActiveReviewResolutionLock,
    error: unknown,
    currentOwnerOid: string
): never {
    const phase = active.owner.mutation.phase;
    const epoch = active.owner.mutation.epoch;
    throw new Error(
        `${errorMessage(error)}; ${pullRequestReviewResolutionLockScope(number)} lock ownership changed after ${phase} epoch ${epoch}; newer lock owner ${currentOwnerOid} preserved`,
        originalErrorOptions(error)
    );
}

function preserveReviewResolutionLockAfterInspectionFailure(
    number: number,
    active: ActiveReviewResolutionLock,
    error: unknown,
    inspectionError: unknown
): never {
    return preserveReviewResolutionLockFailure(
        number,
        active,
        new Error(
            `${errorMessage(error)}; ${pullRequestReviewResolutionLockScope(number)} ownership could not be re-read after failure: ${errorMessage(inspectionError)}`,
            originalErrorOptions(error)
        )
    );
}

function popActiveReviewResolutionLockIfPresent(lock: ActiveReviewResolutionLock): void {
    if (activeReviewResolutionLocks.at(-1) === lock) {
        popActiveReviewResolutionLock(lock);
    }
}

export function withPullRequestReviewResolutionLock<Value>(
    primaryRoot: string,
    number: number,
    threadId: string,
    expectedHead: string,
    operation: () => Value,
    port: ReviewResolutionLockInspectionPort = {}
): Value {
    const readOid = port.readOid ?? readReviewResolutionLockOid;
    const release = port.release ?? releasePullRequestReviewResolutionLock;
    const platform = port.platform ?? process.platform;
    const lock = acquirePullRequestReviewResolutionLock(
        primaryRoot,
        number,
        threadId,
        expectedHead,
        assertReviewResolutionExecutionFence(
            port.executionFence ?? currentReviewResolutionExecutionFence(platform),
            platform
        ),
        platform,
        port.sharedMutationOwnerOid,
        port.acquireRef,
        readOid
    );
    const active: ActiveReviewResolutionLock = {
        primaryRoot,
        number,
        ref: lock.ref,
        oid: lock.oid,
        owner: lock.owner,
    };
    pushActiveReviewResolutionLock(active);
    try {
        const result = operation();
        popActiveReviewResolutionLock(active);
        if (active.owner.version === 6 && port.registerSuccessfulCompletion !== undefined) {
            port.registerSuccessfulCompletion(() => releaseReviewResolutionAndSharedMutationLocks(primaryRoot, active));
            return result;
        }
        release(primaryRoot, active.ref, active.oid, number);
        return result;
    } catch (error) {
        let currentOwnerOid: string | undefined;
        try {
            currentOwnerOid = readOid(primaryRoot, active.ref, number);
        } catch (inspectionError) {
            popActiveReviewResolutionLockIfPresent(active);
            return preserveReviewResolutionLockAfterInspectionFailure(number, active, error, inspectionError);
        }
        if (currentOwnerOid === undefined) {
            popActiveReviewResolutionLockIfPresent(active);
            return fail(`${pullRequestReviewResolutionLockScope(number)} lock is not held`);
        }
        if (currentOwnerOid !== active.oid) {
            popActiveReviewResolutionLockIfPresent(active);
            return preserveNewerReviewResolutionLockOwner(number, active, error, currentOwnerOid);
        }
        if (active.owner.mutation.phase === 'idle') {
            popActiveReviewResolutionLockIfPresent(active);
            release(primaryRoot, active.ref, active.oid, number);
            throw error;
        }
        popActiveReviewResolutionLockIfPresent(active);
        return preserveReviewResolutionLockFailure(number, active, error);
    }
}

export function recoverPullRequestReviewResolutionLock<Value>(
    primaryRoot: string,
    number: number,
    expectedOwnerOid: string,
    reconcile: (owner: ReviewResolutionLockOwner) => Value,
    ownerFenceIsLive: (ownerFence: ReviewResolutionLockOwnerFence) => boolean = reviewResolutionOwnerFenceIsLive,
    port: ReviewResolutionLockRecoveryPort = {}
): Value {
    const ref = pullRequestReviewResolutionLockRef(number);
    let currentOwnerOid = readReviewResolutionLockOid(primaryRoot, ref, number);
    if (currentOwnerOid === undefined) {
        return fail(`${pullRequestReviewResolutionLockScope(number)} lock is not held`);
    }
    const expectedOid = reviewResolutionLockObjectId(expectedOwnerOid, number);
    if (currentOwnerOid !== expectedOid) {
        return fail(
            `${pullRequestReviewResolutionLockScope(number)} lock ownership changed before recovery; current lock owner ${currentOwnerOid}; recover with ${reviewResolutionRecoveryCommand(number, currentOwnerOid)}`
        );
    }
    let owner = readReviewResolutionLockOwner(primaryRoot, currentOwnerOid, number);
    const retainedSharedMutationLock = inspectRetainedSharedMutationLock(primaryRoot, number, owner, ownerFenceIsLive);
    if (ownerFenceIsLive(owner.ownerFence)) {
        return fail(
            `${pullRequestReviewResolutionLockScope(number)} lock is still held by live ${reviewResolutionOwnerFenceLabel(owner.ownerFence)}`
        );
    }
    if (owner.version === 3 || owner.version === 4) {
        if (owner.legacyUnjournaled === true) {
            fail(unjournaledLegacyReviewResolutionLockOwnerMessage(owner.version));
        }
        if (owner.mutation.phase !== 'idle') {
            fail(`review-resolution recovery refuses legacy v${owner.version} lock owner without a v5 replay receipt`);
        }
        const upgradedOwner: CurrentReviewResolutionLockOwner = {
            version: 5,
            pid: owner.pid,
            ownerFence: owner.ownerFence,
            threadId: owner.threadId,
            head: owner.head,
            token: owner.token,
            mutation: { phase: 'idle', epoch: 0 },
        };
        const upgradedOid = writeReviewResolutionLockOwner(primaryRoot, upgradedOwner, number);
        if (!updateReviewResolutionLockRef(primaryRoot, [ref, upgradedOid, currentOwnerOid])) {
            const winningOwnerOid = readReviewResolutionLockOid(primaryRoot, ref, number);
            if (winningOwnerOid === undefined) {
                fail(`${pullRequestReviewResolutionLockScope(number)} lock is not held after legacy upgrade`);
            }
            fail(
                `${pullRequestReviewResolutionLockScope(number)} lock ownership changed before recovery; current lock owner ${winningOwnerOid}; recover with ${reviewResolutionRecoveryCommand(number, winningOwnerOid)}`
            );
        }
        owner = upgradedOwner;
        currentOwnerOid = upgradedOid;
    }
    assertJournaledReviewResolutionLockOwner(owner);
    const platform = port.platform ?? process.platform;
    const claimed = claimRecoveringPullRequestReviewResolutionLock(
        primaryRoot,
        ref,
        currentOwnerOid,
        owner,
        number,
        assertReviewResolutionExecutionFence(
            port.executionFence ?? currentReviewResolutionExecutionFence(platform),
            platform
        ),
        retainedSharedMutationLock,
        port.updateRefsTransaction ?? updateReviewResolutionLockRefsTransaction
    );
    const active: ActiveReviewResolutionLock = {
        primaryRoot,
        number,
        ref,
        oid: claimed.oid,
        owner: claimed.owner,
    };
    pushActiveReviewResolutionLock(active);
    try {
        const reconciled = reconcile(active.owner);
        releaseReviewResolutionAndSharedMutationLocks(
            primaryRoot,
            active,
            port.releaseRefsTransaction ?? updateReviewResolutionLockRefsTransaction
        );
        popActiveReviewResolutionLock(active);
        return reconciled;
    } catch (error) {
        let latestOwnerOid: string | undefined;
        try {
            latestOwnerOid = readReviewResolutionLockOid(primaryRoot, active.ref, number);
            assertRetainedSharedMutationLock(primaryRoot, number, active.owner);
        } catch (inspectionError) {
            popActiveReviewResolutionLockIfPresent(active);
            return preserveReviewResolutionLockAfterInspectionFailure(number, active, error, inspectionError);
        }
        if (latestOwnerOid === undefined) {
            popActiveReviewResolutionLockIfPresent(active);
            return fail(`${pullRequestReviewResolutionLockScope(number)} lock is not held`);
        }
        if (latestOwnerOid !== active.oid) {
            popActiveReviewResolutionLockIfPresent(active);
            return preserveNewerReviewResolutionLockOwner(number, active, error, latestOwnerOid);
        }
        popActiveReviewResolutionLockIfPresent(active);
        return preserveReviewResolutionLockFailure(number, active, error);
    }
}

function assertJournaledReviewResolutionLockOwner(
    owner: ReviewResolutionLockOwner
): asserts owner is CurrentReviewResolutionLockOwner {
    if (owner.version === 5 || owner.version === 6) {
        return;
    }
    if (owner.legacyUnjournaled === true) {
        fail(unjournaledLegacyReviewResolutionLockOwnerMessage(owner.version));
    }
    fail(`review-resolution recovery refuses legacy v${owner.version} lock owner without a v5 replay receipt`);
}

function unjournaledLegacyReviewResolutionLockOwnerMessage(version: 2 | 3 | 4): string {
    return `review-resolution recovery refuses an unjournaled legacy v${version} lock owner without positive landed-mutation proof`;
}

type RetainedSharedMutationLock = {
    ref: string;
    oid?: string;
};

function inspectRetainedSharedMutationLock(
    primaryRoot: string,
    number: number,
    owner: ReviewResolutionLockOwner,
    ownerFenceIsLive: (ownerFence: ReviewResolutionLockOwnerFence) => boolean = reviewResolutionOwnerFenceIsLive
): RetainedSharedMutationLock {
    const ref = pullRequestMutationLockRef(number);
    const gitPath = trustedReviewResolutionGitPath();
    const oid = readPullRequestMutationLockOid(primaryRoot, ref, number, gitPath);
    if (owner.version !== 6) {
        if (oid === undefined) {
            return { ref };
        }
        const sharedOwner = readPullRequestMutationLockOwner(primaryRoot, oid, number, gitPath);
        if (!isReviewResolutionPullRequestMutationLockOwner(sharedOwner)) {
            fail(`${pullRequestReviewResolutionLockScope(number)} owner does not identify the retained delivery lock`);
        }
        if (ownerFenceIsLive(sharedOwner.ownerFence)) {
            fail(`${pullRequestReviewResolutionLockScope(number)} retained delivery lock execution fence remains live`);
        }
        return { ref, oid };
    }
    if (oid === undefined) {
        fail(`${pullRequestReviewResolutionLockScope(number)} retained delivery lock is not held`);
    }
    if (oid !== owner.sharedMutationOwnerOid) {
        fail(
            `${pullRequestReviewResolutionLockScope(number)} retained delivery lock ownership changed before recovery`
        );
    }
    const sharedOwner = readPullRequestMutationLockOwner(primaryRoot, oid, number, gitPath);
    if (sharedOwner.pid !== owner.pid) {
        fail(`${pullRequestReviewResolutionLockScope(number)} retained delivery lock owner does not match`);
    }
    return { ref, oid };
}

function assertRetainedSharedMutationLock(
    primaryRoot: string,
    number: number,
    owner: CurrentReviewResolutionLockOwner
): void {
    if (owner.version === 5) {
        return;
    }
    inspectRetainedSharedMutationLock(primaryRoot, number, owner);
}

function recoveredReviewResolutionLockOwner(
    owner: CurrentReviewResolutionLockOwner,
    executionFence: ReviewResolutionExecutionFence,
    sharedMutationOwnerOid: string
): DualRefReviewResolutionLockOwner {
    return {
        version: 6,
        pid: executionFence.pid,
        ownerFence: executionFence.ownerFence,
        threadId: owner.threadId,
        head: owner.head,
        token: owner.token,
        mutation: owner.mutation,
        sharedMutationOwnerOid,
    };
}

function releaseReviewResolutionAndSharedMutationLocks(
    primaryRoot: string,
    active: ActiveReviewResolutionLock,
    updateRefsTransaction: (
        primaryRoot: string,
        commands: string[]
    ) => boolean = updateReviewResolutionLockRefsTransaction
): void {
    if (active.owner.version === 5) {
        releasePullRequestReviewResolutionLock(primaryRoot, active.ref, active.oid, active.number);
        return;
    }
    const sharedRef = pullRequestMutationLockRef(active.number);
    if (
        !updateRefsTransaction(primaryRoot, [
            `delete ${active.ref} ${active.oid}`,
            `delete ${sharedRef} ${active.owner.sharedMutationOwnerOid}`,
        ])
    ) {
        fail(`${pullRequestReviewResolutionLockScope(active.number)} lock ownership changed before release`);
    }
}

function claimRecoveringPullRequestReviewResolutionLock(
    primaryRoot: string,
    ref: string,
    currentOwnerOid: string,
    owner: CurrentReviewResolutionLockOwner,
    number: number,
    executionFence: ReviewResolutionExecutionFence,
    retainedSharedMutationLock: RetainedSharedMutationLock,
    updateRefsTransaction: (primaryRoot: string, commands: string[]) => boolean
): { oid: string; owner: CurrentReviewResolutionLockOwner } {
    const claimedSharedMutationOwnerOid = writePullRequestMutationLockOwner(
        primaryRoot,
        { version: 1, pid: executionFence.pid, token: randomUUID() },
        number,
        trustedReviewResolutionGitPath()
    );
    const claimedOwner = recoveredReviewResolutionLockOwner(owner, executionFence, claimedSharedMutationOwnerOid);
    const claimedOid = writeReviewResolutionLockOwner(primaryRoot, claimedOwner, number);
    const previousSharedMutationOwnerOid =
        retainedSharedMutationLock.oid ?? '0'.repeat(claimedSharedMutationOwnerOid.length);
    const claimed = updateRefsTransaction(primaryRoot, [
        `update ${ref} ${claimedOid} ${currentOwnerOid}`,
        `update ${retainedSharedMutationLock.ref} ${claimedSharedMutationOwnerOid} ${previousSharedMutationOwnerOid}`,
    ]);
    if (!claimed) {
        const winningOwnerOid = readReviewResolutionLockOid(primaryRoot, ref, number);
        if (winningOwnerOid === undefined) {
            fail(`${pullRequestReviewResolutionLockScope(number)} lock is not held after recovery claim`);
        }
        fail(
            `${pullRequestReviewResolutionLockScope(number)} lock ownership changed before recovery; current lock owner ${winningOwnerOid}; recover with ${reviewResolutionRecoveryCommand(number, winningOwnerOid)}`
        );
    }
    return { oid: claimedOid, owner: claimedOwner };
}

type Gh = (args: string[]) => string;
function graphql(gh: Gh, query: string, fields: string[], label: string): unknown {
    return parseGraphqlResponse(gh(['api', 'graphql', '-f', `query=${query}`, ...fields]), label);
}
export function inspectReviewThread(number: number, requestedThreadId: string, gh: Gh): ReviewThreadInspection {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    let cursor: string | undefined;
    const cursors = new Set<string>();
    let pullRequestId: string | undefined;
    let head: string | undefined;
    for (;;) {
        const connection = cursor === undefined ? 'reviewThreads(first:100)' : 'reviewThreads(first:100,after:$cursor)';
        const query = `query($owner:String!,$name:String!,$number:Int!${cursor === undefined ? '' : ',$cursor:String!'}){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid ${connection}{nodes{id isResolved resolvedBy{id login __typename}} pageInfo{hasNextPage endCursor}}}}}`;
        const fields = ['-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `review thread query for PR #${number}`) as {
            data?: {
                repository?: {
                    pullRequest?: {
                        id?: unknown;
                        headRefOid?: unknown;
                        reviewThreads?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                    };
                };
            };
        };
        const pullRequest = response.data?.repository?.pullRequest;
        if (typeof pullRequest?.id !== 'string' || typeof pullRequest.headRefOid !== 'string') {
            fail(`cannot read current head for PR #${number}`);
        }
        if (pullRequestId === undefined) {
            pullRequestId = pullRequest.id;
        } else if (pullRequestId !== pullRequest.id) {
            fail(`pull-request changed while reading review threads for PR #${number}`);
        }
        const pageHead = canonicalGitObjectId(pullRequest.headRefOid, `cannot read current head for PR #${number}`);
        if (head === undefined) {
            head = pageHead;
        } else if (head !== pageHead) {
            fail(`pull-request head changed while reading review threads for PR #${number}`);
        }
        const threads = pullRequest.reviewThreads;
        if (!Array.isArray(threads?.nodes) || typeof threads.pageInfo?.hasNextPage !== 'boolean') {
            fail(`invalid review-thread page for PR #${number}`);
        }
        const selected = threads.nodes.find(
            (
                candidate
            ): candidate is {
                id?: unknown;
                isResolved?: unknown;
                resolvedBy?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
            } =>
                typeof candidate === 'object' &&
                candidate !== null &&
                (candidate as { id?: unknown }).id === requestedThreadId
        );
        if (selected !== undefined) {
            const thread = inspectThreadComments(
                number,
                pullRequestId,
                head,
                requestedThreadId,
                threadResolutionSnapshot(
                    requestedThreadId,
                    selected.isResolved,
                    selected.resolvedBy?.id,
                    selected.resolvedBy?.login,
                    selected.resolvedBy?.__typename
                ),
                gh
            );
            const pendingReviews = inspectPendingReviews(number, pullRequestId, head, gh);
            assertThreadResolutionAfterReviewInspection(
                number,
                pullRequestId,
                head,
                requestedThreadId,
                threadResolutionSnapshot(
                    requestedThreadId,
                    thread.isResolved,
                    thread.resolvedByNodeId,
                    thread.resolvedByLogin,
                    thread.resolvedByType
                ),
                gh
            );
            return {
                pullRequestId,
                head,
                thread,
                pendingReviews,
            };
        }
        if (!threads.pageInfo.hasNextPage) {
            return {
                pullRequestId,
                head,
                thread: null,
                pendingReviews: inspectPendingReviews(number, pullRequestId, head, gh),
            };
        }
        const next = threads.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || cursors.has(next)) {
            fail(`invalid review-thread pagination for PR #${number}`);
        }
        cursors.add(next);
        cursor = next;
    }
}
function inspectAttachedReviewThreadIds(
    number: number,
    reviewId: string,
    expectedPullRequestId: string,
    expectedHead: string,
    gh: Gh
): string[] {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const attachedThreadIds = new Set<string>();
    let pullRequestId: string | undefined;
    for (;;) {
        const connection = cursor === undefined ? 'reviewThreads(first:100)' : 'reviewThreads(first:100,after:$cursor)';
        const query = `query($owner:String!,$name:String!,$number:Int!${cursor === undefined ? '' : ',$cursor:String!'}){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid ${connection}{nodes{id isResolved resolvedBy{id login __typename}} pageInfo{hasNextPage endCursor}}}}}`;
        const fields = ['-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `review thread query for PR #${number}`) as {
            data?: {
                repository?: {
                    pullRequest?: {
                        id?: unknown;
                        headRefOid?: unknown;
                        reviewThreads?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                    };
                };
            };
        };
        const pullRequest = response.data?.repository?.pullRequest;
        if (typeof pullRequest?.id !== 'string' || typeof pullRequest.headRefOid !== 'string') {
            fail(`cannot read current head for PR #${number}`);
        }
        if (pullRequest.id !== expectedPullRequestId) {
            fail(`pull-request changed while reading review threads for PR #${number}`);
        }
        if (pullRequestId === undefined) {
            pullRequestId = pullRequest.id;
        } else if (pullRequestId !== pullRequest.id) {
            fail(`pull-request changed while reading review threads for PR #${number}`);
        }
        if (
            canonicalGitObjectId(pullRequest.headRefOid, `cannot read current head for PR #${number}`) !== expectedHead
        ) {
            fail(`pull-request head changed while reading review threads for PR #${number}`);
        }
        const threads = pullRequest.reviewThreads;
        if (!Array.isArray(threads?.nodes) || typeof threads.pageInfo?.hasNextPage !== 'boolean') {
            fail(`invalid review-thread page for PR #${number}`);
        }
        for (const candidate of threads.nodes) {
            if (
                typeof candidate !== 'object' ||
                candidate === null ||
                typeof (candidate as { id?: unknown }).id !== 'string'
            ) {
                fail(`invalid review-thread page for PR #${number}`);
            }
            const thread = candidate as {
                id: string;
                isResolved?: unknown;
                resolvedBy?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
            };
            if (
                inspectThreadComments(
                    number,
                    pullRequestId,
                    expectedHead,
                    thread.id,
                    threadResolutionSnapshot(
                        thread.id,
                        thread.isResolved,
                        thread.resolvedBy?.id,
                        thread.resolvedBy?.login,
                        thread.resolvedBy?.__typename
                    ),
                    gh
                ).comments.some((comment) => comment.reviewId === reviewId)
            ) {
                attachedThreadIds.add(thread.id);
            }
        }
        if (!threads.pageInfo.hasNextPage) {
            return [...attachedThreadIds];
        }
        const next = threads.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || cursors.has(next)) {
            fail(`invalid review-thread pagination for PR #${number}`);
        }
        cursors.add(next);
        cursor = next;
    }
}
function inspectPullRequestReview(
    number: number,
    reviewId: string,
    expectedPullRequestId: string,
    expectedHead: string,
    gh: Gh
): PullRequestReview | null {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    const response = graphql(
        gh,
        'query($owner:String!,$name:String!,$number:Int!,$reviewId:ID!){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid}} node(id:$reviewId){... on PullRequestReview{id fullDatabaseId state body commit{oid} author{login __typename ... on Bot{id}} pullRequest{id}}}}',
        ['-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`, '-F', `reviewId=${reviewId}`],
        `pull-request review ${reviewId}`
    ) as {
        data?: {
            repository?: {
                pullRequest?: {
                    id?: unknown;
                    headRefOid?: unknown;
                } | null;
            };
            node?: {
                id?: unknown;
                state?: unknown;
                body?: unknown;
                commit?: { oid?: unknown } | null;
                author?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
                pullRequest?: { id?: unknown } | null;
            } | null;
        };
    };
    assertExpectedPullRequestSnapshot(
        response.data?.repository?.pullRequest,
        expectedPullRequestId,
        expectedHead,
        `pull-request head changed while reading review ${reviewId}`
    );
    const review = response.data?.node;
    if (review === null || review === undefined) {
        return null;
    }
    if (review.pullRequest?.id !== expectedPullRequestId) {
        fail(`pull-request review ${reviewId} changed while reading reviews`);
    }
    return toPullRequestReview(review);
}
function inspectPendingReviews(
    number: number,
    pullRequestId: string,
    expectedHead: string,
    gh: Gh
): PullRequestReview[] {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const pending: PullRequestReview[] = [];
    for (;;) {
        const connection = cursor === undefined ? 'reviews(first:100)' : 'reviews(first:100,after:$cursor)';
        const query = `query($owner:String!,$name:String!,$number:Int!${cursor === undefined ? '' : ',$cursor:String!'}){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid ${connection}{nodes{id fullDatabaseId state body commit{oid} author{login __typename ... on Bot{id}}} pageInfo{hasNextPage endCursor}}}}}`;
        const fields = ['-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `pull-request reviews for PR #${number}`) as {
            data?: {
                repository?: {
                    pullRequest?: {
                        id?: unknown;
                        headRefOid?: unknown;
                        reviews?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                    };
                };
            };
        };
        const pullRequest = response.data?.repository?.pullRequest;
        if (pullRequest?.id !== pullRequestId || typeof pullRequest.headRefOid !== 'string') {
            fail(`pull-request head changed while reading reviews for PR #${number}`);
        }
        if (
            canonicalGitObjectId(
                pullRequest.headRefOid,
                `pull-request head changed while reading reviews for PR #${number}`
            ) !== expectedHead
        ) {
            fail(`pull-request head changed while reading reviews for PR #${number}`);
        }
        const reviews = pullRequest.reviews;
        if (!Array.isArray(reviews?.nodes) || typeof reviews.pageInfo?.hasNextPage !== 'boolean') {
            fail(`invalid review page for PR #${number}`);
        }
        for (const value of reviews.nodes) {
            const review = toPullRequestReview(value);
            if (review !== null && review.state === 'PENDING') {
                if (pending.some((current) => current.id === review.id)) {
                    fail(`duplicate pull-request review ${review.id}`);
                }
                pending.push(review);
            }
        }
        if (!reviews.pageInfo.hasNextPage) {
            return pending;
        }
        const next = reviews.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || cursors.has(next)) {
            fail(`invalid pull-request review pagination for PR #${number}`);
        }
        cursors.add(next);
        cursor = next;
    }
}
function inspectThreadComments(
    number: number,
    pullRequestId: string,
    expectedHead: string,
    threadId: string,
    expectedResolution: {
        isResolved: boolean;
        resolvedByNodeId: string | null;
        resolvedByLogin: string | null;
        resolvedByType: string | null;
    },
    gh: Gh
): ReviewThread {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const comments: ReviewComment[] = [];
    let currentResolution = expectedResolution;
    for (;;) {
        const connection = cursor === undefined ? 'comments(first:100)' : 'comments(first:100,after:$cursor)';
        const query = `query($owner:String!,$name:String!,$number:Int!,$threadId:ID!${cursor === undefined ? '' : ',$cursor:String!'}){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid}} node(id:$threadId){... on PullRequestReviewThread{id isResolved resolvedBy{id login __typename} ${connection}{nodes{id fullDatabaseId body author{login __typename ... on Bot{id}} pullRequestReview{id fullDatabaseId state body commit{oid} author{login __typename ... on Bot{id}}}} pageInfo{hasNextPage endCursor}}}}}`;
        const [owner, name] = REQUIRED_REPOSITORY.split('/');
        if (owner === undefined || name === undefined) {
            fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
        }
        const fields = [
            '-F',
            `owner=${owner}`,
            '-F',
            `name=${name}`,
            '-F',
            `number=${number}`,
            '-F',
            `threadId=${threadId}`,
        ];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `review comments for thread ${threadId}`) as {
            data?: {
                repository?: {
                    pullRequest?: {
                        id?: unknown;
                        headRefOid?: unknown;
                    } | null;
                };
                node?: {
                    id?: unknown;
                    isResolved?: unknown;
                    resolvedBy?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
                    comments?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                } | null;
            };
        };
        assertExpectedPullRequestSnapshot(
            response.data?.repository?.pullRequest,
            pullRequestId,
            expectedHead,
            `pull-request head changed while reading review comments for thread ${threadId}`
        );
        const thread = response.data?.node;
        if (
            thread?.id !== threadId ||
            typeof thread.isResolved !== 'boolean' ||
            !Array.isArray(thread.comments?.nodes) ||
            typeof thread.comments.pageInfo?.hasNextPage !== 'boolean'
        ) {
            fail(`invalid review comments for thread ${threadId}`);
        }
        currentResolution = threadResolutionSnapshot(
            threadId,
            thread.isResolved,
            thread.resolvedBy?.id,
            thread.resolvedBy?.login,
            thread.resolvedBy?.__typename
        );
        assertMatchingThreadResolutionSnapshot(threadId, expectedResolution, currentResolution);
        for (const value of thread.comments.nodes) {
            const comment = toReviewComment(value);
            if (comments.some((current) => current.id === comment.id)) {
                fail(`duplicate review comment ${comment.id}`);
            }
            comments.push(comment);
        }
        if (!thread.comments.pageInfo.hasNextPage) {
            break;
        }
        const next = thread.comments.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || cursors.has(next)) {
            fail(`invalid review-comment pagination for thread ${threadId}`);
        }
        cursors.add(next);
        cursor = next;
    }
    const root = comments[0];
    return {
        id: threadId,
        isResolved: currentResolution.isResolved,
        resolvedByNodeId: currentResolution.resolvedByNodeId,
        resolvedByLogin: currentResolution.resolvedByLogin,
        resolvedByType: currentResolution.resolvedByType,
        rootCommentId: root?.id ?? null,
        rootCommentFullDatabaseId: root?.fullDatabaseId ?? null,
        rootAuthorNodeId: root?.authorNodeId ?? null,
        rootAuthorLogin: root?.authorLogin ?? null,
        rootAuthorType: root?.authorType ?? null,
        comments,
    };
}
function threadResolutionSnapshot(
    threadId: string,
    isResolved: unknown,
    resolvedByNodeId: unknown,
    resolvedByLogin: unknown,
    resolvedByType: unknown
): {
    isResolved: boolean;
    resolvedByNodeId: string | null;
    resolvedByLogin: string | null;
    resolvedByType: string | null;
} {
    if (typeof isResolved !== 'boolean') {
        fail(`invalid review thread ${threadId}`);
    }
    return {
        isResolved,
        resolvedByNodeId: typeof resolvedByNodeId === 'string' ? resolvedByNodeId : null,
        resolvedByLogin: typeof resolvedByLogin === 'string' ? resolvedByLogin : null,
        resolvedByType: typeof resolvedByType === 'string' ? resolvedByType : null,
    };
}
function assertMatchingThreadResolutionSnapshot(
    threadId: string,
    expected: {
        isResolved: boolean;
        resolvedByNodeId: string | null;
        resolvedByLogin: string | null;
        resolvedByType: string | null;
    },
    current: {
        isResolved: boolean;
        resolvedByNodeId: string | null;
        resolvedByLogin: string | null;
        resolvedByType: string | null;
    },
    phase: 'review comments' | 'reviews' | 'resolution confirmation' = 'review comments'
): void {
    if (
        expected.isResolved !== current.isResolved ||
        expected.resolvedByNodeId !== current.resolvedByNodeId ||
        expected.resolvedByLogin !== current.resolvedByLogin ||
        expected.resolvedByType !== current.resolvedByType
    ) {
        fail(`review thread ${threadId} changed while reading ${phase}`);
    }
}
function assertThreadResolutionAfterReviewInspection(
    number: number,
    expectedPullRequestId: string,
    expectedHead: string,
    threadId: string,
    expectedResolution: {
        isResolved: boolean;
        resolvedByNodeId: string | null;
        resolvedByLogin: string | null;
        resolvedByType: string | null;
    },
    gh: Gh
): void {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    const query =
        'query($owner:String!,$name:String!,$number:Int!,$threadId:ID!){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid}} node(id:$threadId){... on PullRequestReviewThread{id isResolved resolvedBy{id login __typename}}}}';
    const response = graphql(
        gh,
        query,
        ['-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`, '-F', `threadId=${threadId}`],
        `review thread resolution for ${threadId}`
    ) as {
        data?: {
            repository?: {
                pullRequest?: {
                    id?: unknown;
                    headRefOid?: unknown;
                } | null;
            };
            node?: {
                id?: unknown;
                isResolved?: unknown;
                resolvedBy?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
            } | null;
        };
    };
    assertExpectedPullRequestSnapshot(
        response.data?.repository?.pullRequest,
        expectedPullRequestId,
        expectedHead,
        `pull-request head changed while reading reviews for PR #${number}`
    );
    const thread = response.data?.node;
    if (thread?.id !== threadId) {
        fail(`review thread ${threadId} changed while reading reviews`);
    }
    assertMatchingThreadResolutionSnapshot(
        threadId,
        expectedResolution,
        threadResolutionSnapshot(
            threadId,
            thread.isResolved,
            thread.resolvedBy?.id,
            thread.resolvedBy?.login,
            thread.resolvedBy?.__typename
        ),
        'reviews'
    );
}
export function assertRecoverableReviewResolutionLockOwner(
    number: number,
    owner: ReviewResolutionLockOwner,
    inspection: ReviewThreadInspection,
    port: ResolveReviewThreadPort,
    _primaryRoot: string = process.cwd()
): void {
    assertJournaledReviewResolutionLockOwner(owner);
    const thread = inspection.thread;
    if (thread === null || thread.id !== owner.threadId) {
        fail(`review thread ${owner.threadId} was not found on this pull request`);
    }
    const mutation = owner.mutation;
    if (mutation.phase === 'idle') {
        return;
    }
    const context = resolutionReviewContext(inspection.pullRequestId, owner.threadId, owner.head);
    if (hasRecoveredReviewResolutionMutation(number, owner, inspection, context, thread, port)) {
        return;
    }
    fail(unreconciledReviewResolutionMutationMessage(number, mutation));
}

function unreconciledReviewResolutionMutationMessage(
    number: number,
    mutation: Exclude<ReviewResolutionLockMutation, { phase: 'idle' }>
): string {
    return `${pullRequestReviewResolutionLockScope(number)} has an unreconciled in-flight ${normalizedRecoveryMutationPhase(mutation.phase)} mutation from epoch ${mutation.epoch}; retry recovery after GitHub state changes`;
}

function normalizedRecoveryMutationPhase(phase: ReviewResolutionLockMutation['phase']): string {
    if (phase === 'createPendingReviewSettlement') {
        return 'createPendingReview';
    }
    if (phase === 'replyDoneSettlement') {
        return 'replyDone';
    }
    return phase;
}

function exactRecoveredReviewIdsAtOwnerHead(
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext
): string[] {
    const reviewIds = new Set<string>();
    for (const review of inspection.pendingReviews) {
        if (isExactPendingReview(review, context)) {
            reviewIds.add(review.id);
        }
    }
    if (inspection.thread !== null) {
        for (const candidate of managedReplyMarkers(inspection.thread, context, ['PENDING', 'COMMENTED'], true)) {
            if (candidate.currentHead) {
                reviewIds.add(candidate.review.id);
            }
        }
    }
    return [...reviewIds].sort();
}

function exactLandedCreatePendingReviewIds(
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'createPendingReview' | 'createPendingReviewSettlement' }>
): string[] {
    if (inspection.pullRequestId !== mutation.pullRequestId) {
        return [];
    }
    const reviewIds = new Set<string>();
    for (const review of inspection.pendingReviews) {
        if (
            review.state === 'PENDING' &&
            review.commitOid === mutation.reviewCommitOid &&
            review.body === mutation.body &&
            isAuthorBotActor(review.authorNodeId, review.authorType)
        ) {
            reviewIds.add(review.id);
        }
    }
    if (inspection.thread !== null) {
        for (const candidate of managedReplyMarkers(inspection.thread, context, ['PENDING', 'COMMENTED'], false)) {
            if (
                candidate.currentHead &&
                candidate.review.commitOid === mutation.reviewCommitOid &&
                candidate.review.body === mutation.body
            ) {
                reviewIds.add(candidate.review.id);
            }
        }
    }
    return [...reviewIds].sort();
}

function exactRecoveredReplyMarkersAtOwnerHead(
    thread: ReviewThread,
    context: ResolutionReviewContext,
    reviewId: string
): ManagedReplyMarker[] {
    return managedReplyMarkers(thread, context, ['PENDING', 'COMMENTED'], true).filter(
        (candidate) => candidate.currentHead && candidate.review.id === reviewId
    );
}

function exactRetirementMutationEvidenceCount(
    owner: CurrentReviewResolutionLockOwner,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext
): number {
    const mutation = owner.mutation;
    switch (mutation.phase) {
        case 'createPendingReview':
        case 'createPendingReviewSettlement':
            return exactLandedCreatePendingReviewIds(inspection, context, mutation).length;
        case 'replyDone':
        case 'replyDoneSettlement':
            return managedReplyMarkers(inspection.thread!, context, ['PENDING', 'COMMENTED'], false).filter(
                (candidate) =>
                    candidate.currentHead &&
                    candidate.review.id === mutation.reviewId &&
                    candidate.review.body === mutation.body &&
                    candidate.review.commitOid === mutation.reviewCommitOid
            ).length;
        default:
            return 0;
    }
}

function assertExactRecoveredMutationAfterHeadDrift(
    number: number,
    owner: CurrentReviewResolutionLockOwner,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    thread: ReviewThread
): void {
    switch (owner.mutation.phase) {
        case 'createPendingReview':
        case 'createPendingReviewSettlement': {
            if (exactRecoveredReviewIdsAtOwnerHead(inspection, context).length === 1) {
                return;
            }
            fail(
                `${pullRequestReviewResolutionLockScope(number)} could not prove exact landed createPendingReview after head drift`
            );
            break;
        }
        case 'replyDone':
        case 'replyDoneSettlement': {
            const matchingReplies = exactRecoveredReplyMarkersAtOwnerHead(thread, context, owner.mutation.reviewId);
            if (matchingReplies.length === 1) {
                return;
            }
            fail(
                `${pullRequestReviewResolutionLockScope(number)} could not prove exact landed replyDone after head drift`
            );
            break;
        }
        default:
            return;
    }
}

function hasExactImmutableEmptySubmittedReviewRecovery(
    number: number,
    owner: CurrentReviewResolutionLockOwner,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    thread: ReviewThread,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'updateReviewBody' }>,
    port: ResolveReviewThreadPort
): boolean {
    if (!thread.isResolved) {
        return false;
    }
    if (mutation.marker === undefined) {
        return false;
    }
    assertCompletedResolution(thread, owner.threadId);
    assertManagedReplyMarkersReadable(thread, context, ['PENDING', 'COMMENTED'], true);
    const marker = managedReplyMarkers(thread, context, ['COMMENTED'], true).find(
        (candidate) =>
            matchesReviewResolutionMarkerSnapshot(candidate, mutation.marker!) &&
            isImmutableEmptySubmittedReview(candidate.review)
    );
    if (marker === undefined) {
        return false;
    }
    const review = requireReplayableHistoricalReviewBodyUpdate(number, owner, inspection, context, mutation, port);
    return (
        matchesReviewResolutionMarkerSnapshot(marker, mutation.marker) &&
        matchesReviewResolutionMarkerSnapshot(
            { marker: marker.marker, review, currentHead: review.commitOid === context.expectedHead },
            mutation.marker
        )
    );
}

function hasExactImmutableEmptySubmittedReviewTerminal(
    number: number,
    owner: CurrentReviewResolutionLockOwner,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    thread: ReviewThread,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'updateReviewBody' }>,
    port: ResolveReviewThreadPort
): boolean {
    if (!hasExactImmutableEmptySubmittedReviewRecovery(number, owner, inspection, context, thread, mutation, port)) {
        return false;
    }
    if (mutation.marker === undefined) {
        return false;
    }
    const marker = requireOneReplyMarker(thread, owner.threadId);
    const review = requireReplyReview(marker, context, ['COMMENTED'], true, null);
    return (
        matchesReviewResolutionMarkerSnapshot(
            { marker, review, currentHead: review.commitOid === context.expectedHead },
            mutation.marker
        ) &&
        isImmutableEmptySubmittedReview(review) &&
        !hasBlockingAuthorPendingReview(inspection.pendingReviews, thread, context)
    );
}

function hasImmutableEmptySubmittedReviewMarker(
    thread: ReviewThread,
    context: ResolutionReviewContext,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'updateReviewBody' }>
): boolean {
    if (mutation.marker === undefined) {
        return false;
    }
    return managedReplyMarkers(thread, context, ['COMMENTED'], true).some(
        (candidate) =>
            matchesReviewResolutionMarkerSnapshot(candidate, mutation.marker!) &&
            isImmutableEmptySubmittedReview(candidate.review)
    );
}

function hasRecoveredReviewResolutionMutation(
    number: number,
    owner: CurrentReviewResolutionLockOwner,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    thread: ReviewThread,
    port: ResolveReviewThreadPort
): boolean {
    const mutation = owner.mutation;
    switch (mutation.phase) {
        case 'idle':
            return true;
        case 'createPendingReview':
            return exactLandedCreatePendingReviewIds(inspection, context, mutation).length === 1;
        case 'createPendingReviewSettlement':
            return exactLandedCreatePendingReviewIds(inspection, context, mutation).length > 0;
        case 'replyDone':
            return managedReplyMarkers(thread, context, ['PENDING', 'COMMENTED'], false).some(
                (candidate) =>
                    candidate.review.id === mutation.reviewId &&
                    candidate.review.body === mutation.body &&
                    candidate.review.commitOid === mutation.reviewCommitOid
            );
        case 'replyDoneSettlement':
            return managedReplyMarkers(thread, context, ['PENDING', 'COMMENTED'], false).some(
                (candidate) =>
                    candidate.review.id === mutation.reviewId &&
                    candidate.review.commitOid === mutation.reviewCommitOid &&
                    candidate.review.body === mutation.body
            );
        case 'submitReview':
            return managedReplyMarkers(thread, context, ['COMMENTED'], false).some(
                (candidate) =>
                    candidate.review.id === mutation.reviewId &&
                    candidate.review.body === mutation.body &&
                    candidate.review.commitOid === mutation.reviewCommitOid
            );
        case 'updateReviewBody': {
            const landed =
                inspection.pendingReviews.some(
                    (review) =>
                        review.id === mutation.reviewId &&
                        (mutation.reviewDatabaseId === undefined ||
                            review.fullDatabaseId === mutation.reviewDatabaseId) &&
                        review.body === mutation.body &&
                        review.commitOid === mutation.reviewCommitOid &&
                        isAuthorBotActor(review.authorNodeId, review.authorType)
                ) ||
                managedReplyMarkers(thread, context, ['PENDING', 'COMMENTED'], true).some(
                    (candidate) =>
                        candidate.review.id === mutation.reviewId &&
                        (mutation.reviewDatabaseId === undefined ||
                            candidate.review.fullDatabaseId === mutation.reviewDatabaseId) &&
                        candidate.review.body === mutation.body &&
                        candidate.review.commitOid === mutation.reviewCommitOid
                );
            if (landed) {
                return true;
            }
            return hasExactImmutableEmptySubmittedReviewRecovery(
                number,
                owner,
                inspection,
                context,
                thread,
                mutation,
                port
            );
        }
        case 'resolveThread':
            return (
                thread.isResolved &&
                isAuthorResolutionActor(thread.resolvedByNodeId, thread.resolvedByType) &&
                managedReplyMarkers(thread, context, ['COMMENTED'], false).length === 1
            );
        case 'deleteReply':
            return (
                immutableDeleteReplyTargetIsAbsent(thread, mutation) &&
                (mutation.immutableEnvelope === undefined
                    ? hasCanonicalCommentedReplyAfterExcluding(thread, context, mutation.replyId)
                    : hasExactImmutableDeleteReplySurvivor(thread, context, mutation))
            );
        case 'deletePendingReview':
            return (
                port.inspectPullRequestReview(number, mutation.reviewId, inspection.pullRequestId, inspection.head) ===
                null
            );
        default:
            return fail('review-resolution lock ownership is malformed');
    }
}

export function reviewResolutionRecoveryResult(
    owner: ReviewResolutionLockOwner,
    inspection: ReviewThreadInspection
): ReviewResolutionRecoveryResult {
    assertJournaledReviewResolutionLockOwner(owner);
    return { kind: 'reconciled', inspection };
}

export function retireUnseenReviewResolutionLockOwnerState(
    number: number,
    owner: ReviewResolutionLockOwner,
    port: ResolveReviewThreadPort,
    clock: ReviewResolutionRecoveryClock = systemReviewResolutionRecoveryClock,
    primaryRoot: string = process.cwd(),
    retirementClock: ReviewResolutionRetirementClock = systemReviewResolutionRetirementClock
): ReviewThreadInspection {
    assertJournaledReviewResolutionLockOwner(owner);
    if (
        owner.mutation.phase !== 'createPendingReview' &&
        owner.mutation.phase !== 'createPendingReviewSettlement' &&
        owner.mutation.phase !== 'replyDone' &&
        owner.mutation.phase !== 'replyDoneSettlement'
    ) {
        fail('review-resolution retirement requires an unseen createPendingReview or replyDone settlement');
    }
    const initialInspection = inspectReviewResolutionRecovery(number, owner, port);
    const initialContext = resolutionReviewContext(initialInspection.pullRequestId, owner.threadId, owner.head);
    if (exactRetirementMutationEvidenceCount(owner, initialInspection, initialContext) !== 0) {
        fail('review-resolution retirement found mutation evidence during remote inspection');
    }
    const recoveryPrimaryRoot = activeReviewResolutionLocks.at(-1)?.primaryRoot ?? primaryRoot;
    if (owner.mutation.phase === 'createPendingReview' || owner.mutation.phase === 'replyDone') {
        restartRetirementSettlement(number, recoveryPrimaryRoot, initialInspection, owner.mutation, clock);
    }
    const active = currentActiveReviewResolutionLock(recoveryPrimaryRoot, number);
    const expectedOwnerOid = active.oid;
    const deadline = retirementClock.monotonicNow() + REVIEW_RESOLUTION_SETTLEMENT_WINDOW_NS;
    retirementClock.wait(REVIEW_RESOLUTION_SETTLEMENT_WINDOW_MS);
    if (retirementClock.monotonicNow() < deadline) {
        fail(`${pullRequestReviewResolutionLockScope(number)} could not prove settlement elapsed with monotonic time`);
    }
    if (readReviewResolutionLockOid(recoveryPrimaryRoot, active.ref, number) !== expectedOwnerOid) {
        fail(`${pullRequestReviewResolutionLockScope(number)} lock ownership changed during retirement settlement`);
    }
    const settledOwner = active.owner;
    if (settledOwner.head !== owner.head || settledOwner.threadId !== owner.threadId) {
        fail('review-resolution retirement lock owner changed during settlement');
    }
    const settledInspection = inspectReviewResolutionRecovery(number, settledOwner, port);
    if (
        settledInspection.pullRequestId !== initialInspection.pullRequestId ||
        settledInspection.head !== initialInspection.head
    ) {
        fail('review-resolution retirement refuses head drift during remote inspection');
    }
    const settledContext = resolutionReviewContext(
        settledInspection.pullRequestId,
        settledOwner.threadId,
        settledOwner.head
    );
    if (exactRetirementMutationEvidenceCount(settledOwner, settledInspection, settledContext) !== 0) {
        fail('review-resolution retirement found mutation evidence during remote inspection');
    }
    return settledInspection;
}

function continueRecoveredReviewResolution(
    number: number,
    owner: CurrentReviewResolutionLockOwner,
    port: ResolveReviewThreadPort
): ReviewThreadInspection {
    resolveReviewThreadWithinMutation(number, owner.threadId, owner.head, port);
    const inspection = inspectReviewResolutionRecovery(number, owner, port);
    assertExpectedHeadAfterMutation(inspection.head, owner.head);
    return inspection;
}

function inspectReviewResolutionRecovery(
    number: number,
    owner: ReviewResolutionLockOwner,
    port: ResolveReviewThreadPort
): ReviewThreadInspection {
    const inspection = port.inspect(number, owner.threadId);
    if (inspection.thread === null || inspection.thread.id !== owner.threadId) {
        fail(`review thread ${owner.threadId} was not found on this pull request`);
    }
    return inspection;
}

function assertMutationPhaseOwner(
    owner: CurrentReviewResolutionLockOwner
): Exclude<ReviewResolutionLockMutation, { phase: 'idle' }> {
    if (owner.mutation.phase === 'idle') {
        fail('review-resolution recovery requires an active mutation phase');
    }
    return owner.mutation;
}

function requireReplayableHistoricalReviewBodyUpdate(
    number: number,
    owner: CurrentReviewResolutionLockOwner,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'updateReviewBody' }>,
    port: ResolveReviewThreadPort
): PullRequestReview {
    if (mutation.body !== resolutionReviewBody(context, mutation.reviewCommitOid)) {
        fail(`update review body recovery has an invalid historical body for ${mutation.reviewId}`);
    }
    const review = port.inspectPullRequestReview(number, mutation.reviewId, inspection.pullRequestId, inspection.head);
    if (
        review === null ||
        review.id !== mutation.reviewId ||
        (mutation.reviewDatabaseId !== undefined && review.fullDatabaseId !== mutation.reviewDatabaseId) ||
        !['PENDING', 'COMMENTED'].includes(review.state) ||
        review.body.trim() !== '' ||
        review.commitOid !== mutation.reviewCommitOid ||
        !isAuthorBotActor(review.authorNodeId, review.authorType)
    ) {
        fail(`update review body recovery could not prove an unlanded historical review ${mutation.reviewId}`);
    }
    const currentHeadContext = resolutionReviewContext(inspection.pullRequestId, owner.threadId, inspection.head);
    assertExclusiveBackfillReviewAttachment(number, mutation.reviewId, currentHeadContext, port);
    return review;
}

function requireReplayableHistoricalReviewSubmission(
    number: number,
    owner: CurrentReviewResolutionLockOwner,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'submitReview' }>,
    port: ResolveReviewThreadPort
): PullRequestReview {
    assertCanonicalHistoricalReviewSubmissionBody(context, mutation);
    const review = port.inspectPullRequestReview(number, mutation.reviewId, inspection.pullRequestId, inspection.head);
    if (
        review === null ||
        review.id !== mutation.reviewId ||
        review.state !== 'PENDING' ||
        review.body !== mutation.body ||
        review.commitOid !== mutation.reviewCommitOid ||
        !isAuthorBotActor(review.authorNodeId, review.authorType)
    ) {
        fail(`submit review recovery could not prove an unlanded historical review ${mutation.reviewId}`);
    }
    const currentHeadContext = resolutionReviewContext(inspection.pullRequestId, owner.threadId, inspection.head);
    assertExclusiveBackfillReviewAttachment(number, mutation.reviewId, currentHeadContext, port);
    return review;
}

function assertCanonicalHistoricalReviewSubmissionBody(
    context: ResolutionReviewContext,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'submitReview' }>
): void {
    if (mutation.body !== resolutionReviewBody(context, mutation.reviewCommitOid)) {
        fail(`submit review recovery has an invalid historical body for ${mutation.reviewId}`);
    }
}

function assertProvenReviewBodyReceipt(
    receipt: ReviewEnvelopeReceipt,
    review: PullRequestReview,
    expectedBody: string
): void {
    if (
        receipt.id !== review.id ||
        receipt.state !== review.state ||
        receipt.body !== expectedBody ||
        receipt.commitOid !== review.commitOid ||
        receipt.fullDatabaseId !== review.fullDatabaseId ||
        !isAuthorBotActor(receipt.authorNodeId, receipt.authorType) ||
        receipt.clientMutationId !== updateReviewClientMutationId(review.id)
    ) {
        fail(`update review body returned an invalid result for ${review.id}`);
    }
}

function assertProvenReviewSubmissionReceipt(
    receipt: ReviewEnvelopeReceipt,
    review: PullRequestReview,
    expectedBody: string
): void {
    if (
        receipt.id !== review.id ||
        receipt.state !== 'COMMENTED' ||
        receipt.body !== expectedBody ||
        receipt.commitOid !== review.commitOid ||
        !isAuthorBotActor(receipt.authorNodeId, receipt.authorType) ||
        receipt.clientMutationId !== submitReviewClientMutationId(review.id)
    ) {
        fail(`submit review returned an invalid result for ${review.id}`);
    }
}

function settlementDeadline(clock: ReviewResolutionRecoveryClock): number {
    return clock.now() + REVIEW_RESOLUTION_SETTLEMENT_WINDOW_MS;
}

function settledReviewState(state: string): ReviewResolutionSettledReply['reviewState'] {
    if (state === 'PENDING' || state === 'COMMENTED') {
        return state;
    }
    return fail('review-resolution settlement has an unsupported review state');
}

function preserveCreatePendingReviewSettlement(
    number: number,
    primaryRoot: string,
    inspection: ReviewThreadInspection,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'createPendingReview' }>,
    clock: ReviewResolutionRecoveryClock
): never {
    advanceActiveReviewResolutionLockMutation(primaryRoot, number, {
        phase: 'createPendingReviewSettlement',
        pullRequestId: mutation.pullRequestId,
        body: mutation.body,
        reviewCommitOid: mutation.reviewCommitOid,
        pendingReviewIds: inspection.pendingReviews.map((review) => review.id).sort(),
        settleAtMs: settlementDeadline(clock),
        replayed: false,
    });
    return fail(unreconciledReviewResolutionMutationMessage(number, mutation));
}

function preserveReplyDoneSettlement(
    number: number,
    primaryRoot: string,
    inspection: ReviewThreadInspection,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'replyDone' }>,
    clock: ReviewResolutionRecoveryClock
): never {
    const context = resolutionReviewContext(inspection.pullRequestId, inspection.thread!.id, inspection.head);
    const replies = managedReplyMarkers(inspection.thread!, context, ['PENDING', 'COMMENTED'], false)
        .map((candidate) => ({
            replyId: candidate.marker.id,
            reviewId: candidate.review.id,
            reviewState: settledReviewState(candidate.review.state),
        }))
        .sort((left, right) => left.replyId.localeCompare(right.replyId));
    advanceActiveReviewResolutionLockMutation(primaryRoot, number, {
        phase: 'replyDoneSettlement',
        reviewId: mutation.reviewId,
        body: mutation.body,
        reviewCommitOid: mutation.reviewCommitOid,
        replies,
        settleAtMs: settlementDeadline(clock),
        replayed: false,
    });
    fail(unreconciledReviewResolutionMutationMessage(number, mutation));
}

function restartRetirementSettlement(
    number: number,
    primaryRoot: string,
    inspection: ReviewThreadInspection,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'createPendingReview' | 'replyDone' }>,
    clock: ReviewResolutionRecoveryClock
): void {
    if (mutation.phase === 'createPendingReview') {
        advanceActiveReviewResolutionLockMutation(primaryRoot, number, {
            phase: 'createPendingReviewSettlement',
            pullRequestId: mutation.pullRequestId,
            body: mutation.body,
            reviewCommitOid: mutation.reviewCommitOid,
            pendingReviewIds: inspection.pendingReviews.map((review) => review.id).sort(),
            settleAtMs: settlementDeadline(clock),
            replayed: false,
        });
        return;
    }
    const context = resolutionReviewContext(inspection.pullRequestId, inspection.thread!.id, inspection.head);
    const replies = managedReplyMarkers(inspection.thread!, context, ['PENDING', 'COMMENTED'], false)
        .map((candidate) => ({
            replyId: candidate.marker.id,
            reviewId: candidate.review.id,
            reviewState: settledReviewState(candidate.review.state),
        }))
        .sort((left, right) => left.replyId.localeCompare(right.replyId));
    advanceActiveReviewResolutionLockMutation(primaryRoot, number, {
        phase: 'replyDoneSettlement',
        reviewId: mutation.reviewId,
        body: mutation.body,
        reviewCommitOid: mutation.reviewCommitOid,
        replies,
        settleAtMs: settlementDeadline(clock),
        replayed: false,
    });
}

function recoverCreatePendingReviewSettlement(
    number: number,
    owner: CurrentReviewResolutionLockOwner,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'createPendingReviewSettlement' }>,
    port: ResolveReviewThreadPort,
    _clock: ReviewResolutionRecoveryClock,
    _primaryRoot: string
): ReviewThreadInspection {
    const recoveredReviewIds = exactRecoveredReviewIdsAtOwnerHead(inspection, context);
    if (inspection.head !== owner.head) {
        if (recoveredReviewIds.length > 0) {
            assertExactRecoveredMutationAfterHeadDrift(number, owner, inspection, context, inspection.thread!);
            return inspection;
        }
        fail(unreconciledReviewResolutionMutationMessage(number, mutation));
    }
    if (recoveredReviewIds.length > 0) {
        return continueRecoveredReviewResolution(number, owner, port);
    }
    return fail(unreconciledReviewResolutionMutationMessage(number, mutation));
}

function recoverReplyDoneSettlement(
    number: number,
    owner: CurrentReviewResolutionLockOwner,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    mutation: Extract<ReviewResolutionLockMutation, { phase: 'replyDoneSettlement' }>,
    port: ResolveReviewThreadPort,
    _clock: ReviewResolutionRecoveryClock,
    _primaryRoot: string
): ReviewThreadInspection {
    const recoveredReplies = exactRecoveredReplyMarkersAtOwnerHead(inspection.thread!, context, mutation.reviewId);
    if (inspection.head !== owner.head) {
        if (recoveredReplies.length > 0) {
            assertExactRecoveredMutationAfterHeadDrift(number, owner, inspection, context, inspection.thread!);
            return inspection;
        }
        fail(unreconciledReviewResolutionMutationMessage(number, mutation));
    }
    if (recoveredReplies.length > 0) {
        return continueRecoveredReviewResolution(number, owner, port);
    }
    return fail(unreconciledReviewResolutionMutationMessage(number, mutation));
}

function convergeSubmittedCommentedReplyMarkers(
    number: number,
    owner: CurrentReviewResolutionLockOwner,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort
): ReviewThreadInspection {
    if (
        repairManagedCommentedReviewEnvelopes(number, owner.threadId, inspection.thread, port, context, ['COMMENTED'])
    ) {
        inspection = inspectReviewResolutionRecovery(number, owner, port);
    }
    if (managedReplyMarkers(inspection.thread!, context, ['COMMENTED'], false).length > 1) {
        convergeReplyMarkers(
            number,
            owner.threadId,
            inspection.thread,
            port,
            context,
            ['COMMENTED'],
            undefined,
            inspection.head
        );
        inspection = inspectReviewResolutionRecovery(number, owner, port);
    }
    if (managedReplyMarkers(inspection.thread!, context, ['COMMENTED'], false).length !== 1) {
        fail(`submit review recovery could not converge to one Done reply marker on thread ${owner.threadId}`);
    }
    return inspection;
}

export function recoverReviewResolutionLockOwnerState(
    number: number,
    owner: ReviewResolutionLockOwner,
    port: ResolveReviewThreadPort,
    clock: ReviewResolutionRecoveryClock = systemReviewResolutionRecoveryClock,
    primaryRoot: string = process.cwd()
): ReviewThreadInspection {
    assertJournaledReviewResolutionLockOwner(owner);
    let inspection = inspectReviewResolutionRecovery(number, owner, port);
    if (owner.mutation.phase === 'idle') {
        return inspection;
    }
    const context = resolutionReviewContext(inspection.pullRequestId, owner.threadId, owner.head);
    const mutation = assertMutationPhaseOwner(owner);
    const recoveryPrimaryRoot = activeReviewResolutionLocks.at(-1)?.primaryRoot ?? primaryRoot;
    switch (mutation.phase) {
        case 'createPendingReview':
            if (!hasRecoveredReviewResolutionMutation(number, owner, inspection, context, inspection.thread!, port)) {
                if (inspection.head === owner.head) {
                    preserveCreatePendingReviewSettlement(number, recoveryPrimaryRoot, inspection, mutation, clock);
                }
                fail(unreconciledReviewResolutionMutationMessage(number, mutation));
            }
            if (inspection.head !== owner.head) {
                assertExactRecoveredMutationAfterHeadDrift(number, owner, inspection, context, inspection.thread!);
                break;
            }
            inspection = continueRecoveredReviewResolution(number, owner, port);
            break;
        case 'replyDone':
            if (!hasRecoveredReviewResolutionMutation(number, owner, inspection, context, inspection.thread!, port)) {
                if (inspection.head === owner.head) {
                    preserveReplyDoneSettlement(number, recoveryPrimaryRoot, inspection, mutation, clock);
                }
                fail(unreconciledReviewResolutionMutationMessage(number, mutation));
            }
            if (inspection.head !== owner.head) {
                assertExactRecoveredMutationAfterHeadDrift(number, owner, inspection, context, inspection.thread!);
                break;
            }
            inspection = continueRecoveredReviewResolution(number, owner, port);
            break;
        case 'createPendingReviewSettlement':
            return recoverCreatePendingReviewSettlement(
                number,
                owner,
                inspection,
                context,
                mutation,
                port,
                clock,
                recoveryPrimaryRoot
            );
        case 'replyDoneSettlement':
            return recoverReplyDoneSettlement(
                number,
                owner,
                inspection,
                context,
                mutation,
                port,
                clock,
                recoveryPrimaryRoot
            );
        case 'submitReview': {
            if (hasRecoveredReviewResolutionMutation(number, owner, inspection, context, inspection.thread!, port)) {
                if (inspection.head !== owner.head) {
                    inspection = convergeSubmittedCommentedReplyMarkers(number, owner, inspection, context, port);
                }
                break;
            }
            if (inspection.head !== owner.head) {
                const review = requireReplayableHistoricalReviewSubmission(
                    number,
                    owner,
                    inspection,
                    context,
                    mutation,
                    port
                );
                const submitted = port.submitReview(mutation.reviewId, mutation.body, mutation.reviewCommitOid);
                assertProvenReviewSubmissionReceipt(submitted, review, mutation.body);
                inspection = inspectReviewResolutionRecovery(number, owner, port);
                inspection = convergeSubmittedCommentedReplyMarkers(number, owner, inspection, context, port);
                break;
            }
            assertCanonicalHistoricalReviewSubmissionBody(context, mutation);
            if (inspection.head === owner.head) {
                inspection = convergePendingReplyStateBeforeSubmit(
                    number,
                    inspection,
                    context,
                    mutation.reviewId,
                    port
                );
                assertRecoveryHeadMatchesOwner(inspection.head, owner.head);
            }
            const review = requireReplayableHistoricalReviewSubmission(
                number,
                owner,
                inspection,
                context,
                mutation,
                port
            );
            const submitted = port.submitReview(mutation.reviewId, mutation.body, mutation.reviewCommitOid);
            assertProvenReviewSubmissionReceipt(submitted, review, mutation.body);
            inspection = inspectReviewResolutionRecovery(number, owner, port);
            inspection = convergeSubmittedCommentedReplyMarkers(number, owner, inspection, context, port);
            break;
        }
        case 'updateReviewBody': {
            const immutableEmptySubmittedReview = hasImmutableEmptySubmittedReviewMarker(
                inspection.thread!,
                context,
                mutation
            );
            if (hasRecoveredReviewResolutionMutation(number, owner, inspection, context, inspection.thread!, port)) {
                if (immutableEmptySubmittedReview) {
                    inspection = inspectReviewResolutionRecovery(number, owner, port);
                    const freshContext = resolutionReviewContext(inspection.pullRequestId, owner.threadId, owner.head);
                    if (
                        !hasExactImmutableEmptySubmittedReviewRecovery(
                            number,
                            owner,
                            inspection,
                            freshContext,
                            inspection.thread!,
                            mutation,
                            port
                        )
                    ) {
                        fail(unreconciledReviewResolutionMutationMessage(number, mutation));
                    }
                    if (inspection.head !== owner.head) {
                        if (
                            !hasExactImmutableEmptySubmittedReviewTerminal(
                                number,
                                owner,
                                inspection,
                                freshContext,
                                inspection.thread!,
                                mutation,
                                port
                            )
                        ) {
                            fail(unreconciledReviewResolutionMutationMessage(number, mutation));
                        }
                        break;
                    }
                    if (!repairCompletedResolution(number, inspection, freshContext, port)) {
                        fail(unreconciledReviewResolutionMutationMessage(number, mutation));
                    }
                    inspection = inspectReviewResolutionRecovery(number, owner, port);
                    const terminalContext = resolutionReviewContext(
                        inspection.pullRequestId,
                        owner.threadId,
                        owner.head
                    );
                    if (
                        !hasExactImmutableEmptySubmittedReviewTerminal(
                            number,
                            owner,
                            inspection,
                            terminalContext,
                            inspection.thread!,
                            mutation,
                            port
                        )
                    ) {
                        fail(unreconciledReviewResolutionMutationMessage(number, mutation));
                    }
                }
                break;
            }
            const review = requireReplayableHistoricalReviewBodyUpdate(
                number,
                owner,
                inspection,
                context,
                mutation,
                port
            );
            if (isImmutableEmptySubmittedReview(review)) {
                fail(unreconciledReviewResolutionMutationMessage(number, mutation));
            }
            const updated = port.updateReviewBody(mutation.reviewId, mutation.body, mutation.reviewCommitOid, review);
            assertProvenReviewBodyReceipt(updated, review, mutation.body);
            inspection = inspectReviewResolutionRecovery(number, owner, port);
            break;
        }
        case 'resolveThread': {
            if (hasRecoveredReviewResolutionMutation(number, owner, inspection, context, inspection.thread!, port)) {
                break;
            }
            assertRecoveryHeadMatchesOwner(inspection.head, owner.head);
            const receipt = port.resolve(owner.threadId);
            assertResolutionReceipt(receipt, resolveClientMutationId(owner.threadId));
            inspection = inspectReviewResolutionRecovery(number, owner, port);
            if (managedReplyMarkers(inspection.thread!, context, ['COMMENTED'], false).length > 1) {
                convergeReplyMarkers(number, owner.threadId, inspection.thread, port, context, ['COMMENTED']);
                inspection = inspectReviewResolutionRecovery(number, owner, port);
            }
            break;
        }
        case 'deleteReply':
            if (mutation.immutableEnvelope !== undefined) {
                if (!hasExactImmutableDeleteReplySurvivor(inspection.thread!, context, mutation)) {
                    fail(unreconciledReviewResolutionMutationMessage(number, mutation));
                }
                const target = exactImmutableDeleteReplyTarget(inspection.thread!, context, mutation);
                if (!immutableDeleteReplyTargetIsAbsent(inspection.thread!, mutation)) {
                    if (target === undefined) {
                        fail(unreconciledReviewResolutionMutationMessage(number, mutation));
                    }
                    assertRecoveryHeadMatchesOwner(inspection.head, owner.head);
                    const survivor = managedReplyMarkers(inspection.thread!, context, ['COMMENTED'], true).find(
                        (candidate) =>
                            matchesReviewResolutionMarkerSnapshot(candidate, mutation.immutableEnvelope!) &&
                            isImmutableEmptySubmittedReview(candidate.review)
                    );
                    if (survivor === undefined) {
                        fail(unreconciledReviewResolutionMutationMessage(number, mutation));
                    }
                    assertExclusiveBackfillReviewAttachment(number, survivor.review.id, context, port, inspection.head);
                    port.deleteReply(target.marker.id, survivor, target);
                    inspection = inspectReviewResolutionRecovery(number, owner, port);
                    if (
                        !immutableDeleteReplyTargetIsAbsent(inspection.thread!, mutation) ||
                        !hasExactImmutableDeleteReplySurvivor(inspection.thread!, context, mutation)
                    ) {
                        fail(unreconciledReviewResolutionMutationMessage(number, mutation));
                    }
                }
            } else if (!hasCanonicalCommentedReplyAfterExcluding(inspection.thread!, context, mutation.replyId)) {
                fail(unreconciledReviewResolutionMutationMessage(number, mutation));
            }
            if (hasRecoveredReviewResolutionMutation(number, owner, inspection, context, inspection.thread!, port)) {
                if (mutation.immutableEnvelope !== undefined && inspection.head === owner.head) {
                    const survivor = managedReplyMarkers(inspection.thread!, context, ['COMMENTED'], true).find(
                        (candidate) =>
                            matchesReviewResolutionMarkerSnapshot(candidate, mutation.immutableEnvelope!) &&
                            isImmutableEmptySubmittedReview(candidate.review)
                    );
                    if (survivor === undefined) {
                        fail(unreconciledReviewResolutionMutationMessage(number, mutation));
                    }
                    const managed = managedReplyMarkers(inspection.thread!, context, ['COMMENTED'], true);
                    if (managed.length > 1) {
                        assertPreservedImmutableEnvelopeBeforeConvergence(inspection.thread!, context, survivor);
                        convergeReplyMarkers(
                            number,
                            owner.threadId,
                            inspection.thread,
                            port,
                            context,
                            ['COMMENTED'],
                            survivor.marker.id,
                            owner.head
                        );
                        inspection = inspectReviewResolutionRecovery(number, owner, port);
                    }
                } else if (
                    inspection.head === owner.head &&
                    managedReplyMarkers(inspection.thread!, context, ['PENDING', 'COMMENTED'], false).length > 0
                ) {
                    inspection = continueRecoveredReviewResolution(number, owner, port);
                }
                if (mutation.immutableEnvelope !== undefined) {
                    assertExactImmutableDeleteReplyTerminal(number, inspection, context, mutation, port);
                }
                break;
            }
            assertRecoveryHeadMatchesOwner(inspection.head, owner.head);
            port.deleteReply(mutation.replyId);
            inspection = inspectReviewResolutionRecovery(number, owner, port);
            break;
        case 'deletePendingReview':
            if (hasRecoveredReviewResolutionMutation(number, owner, inspection, context, inspection.thread!, port)) {
                break;
            }
            assertRecoveryHeadMatchesOwner(inspection.head, owner.head);
            if (
                port.inspectPullRequestReview(number, mutation.reviewId, inspection.pullRequestId, inspection.head)
                    ?.state !== 'PENDING'
            ) {
                fail(unreconciledReviewResolutionMutationMessage(number, mutation));
            }
            deletePendingReviewSafely(
                number,
                mutation.reviewId,
                context,
                port,
                mutation.allowedAttachedThreadIds,
                mutation.snapshotHead
            );
            inspection = inspectReviewResolutionRecovery(number, owner, port);
            break;
        default:
            fail(`${pullRequestReviewResolutionLockScope(number)} lock ownership is malformed`);
    }
    assertRecoverableReviewResolutionLockOwner(number, owner, inspection, port);
    return inspection;
}
function assertExpectedPullRequestSnapshot(
    pullRequest: { id?: unknown; headRefOid?: unknown } | null | undefined,
    expectedPullRequestId: string,
    expectedHead: string,
    label: string
): void {
    if (pullRequest?.id !== expectedPullRequestId || typeof pullRequest.headRefOid !== 'string') {
        fail(label);
    }
    if (canonicalGitObjectId(pullRequest.headRefOid, label) !== expectedHead) {
        fail(label);
    }
}
function toReviewComment(value: unknown): ReviewComment {
    const comment = value as {
        id?: unknown;
        fullDatabaseId?: unknown;
        body?: unknown;
        author?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
        pullRequestReview?: unknown;
    };
    if (typeof comment.id !== 'string' || !isDecimalId(comment.fullDatabaseId) || typeof comment.body !== 'string') {
        fail('invalid review comment');
    }
    const review = toPullRequestReview(comment.pullRequestReview);
    return {
        id: comment.id,
        fullDatabaseId: comment.fullDatabaseId,
        body: comment.body,
        authorNodeId: typeof comment.author?.id === 'string' ? comment.author.id : null,
        authorLogin: typeof comment.author?.login === 'string' ? comment.author.login : null,
        authorType: typeof comment.author?.__typename === 'string' ? comment.author.__typename : null,
        reviewId: review?.id ?? null,
        ...(typeof review?.fullDatabaseId === 'string' ? { reviewFullDatabaseId: review.fullDatabaseId } : {}),
        reviewState: review?.state ?? null,
        reviewBody: review?.body ?? null,
        reviewCommitOid: review?.commitOid ?? null,
        reviewAuthorNodeId: review?.authorNodeId ?? null,
        reviewAuthorLogin: review?.authorLogin ?? null,
        reviewAuthorType: review?.authorType ?? null,
    };
}
function toPullRequestReview(value: unknown): PullRequestReview | null {
    if (value === null || value === undefined) {
        return null;
    }
    const review = value as {
        id?: unknown;
        fullDatabaseId?: unknown;
        state?: unknown;
        body?: unknown;
        commit?: { oid?: unknown } | null;
        author?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
    };
    if (typeof review.id !== 'string' || typeof review.state !== 'string' || typeof review.body !== 'string') {
        fail('invalid pull-request review');
    }
    if (review.fullDatabaseId !== undefined && review.fullDatabaseId !== null && !isDecimalId(review.fullDatabaseId)) {
        fail('invalid pull-request review');
    }
    const commitOid = review.commit?.oid;
    if (commitOid !== null && commitOid !== undefined && typeof commitOid !== 'string') {
        fail('invalid pull-request review');
    }
    return {
        id: review.id,
        ...(typeof review.fullDatabaseId === 'string' ? { fullDatabaseId: review.fullDatabaseId } : {}),
        state: review.state,
        body: review.body,
        commitOid:
            typeof commitOid === 'string' ? canonicalGitObjectId(commitOid, 'invalid pull-request review') : null,
        authorNodeId: typeof review.author?.id === 'string' ? review.author.id : null,
        authorLogin: typeof review.author?.login === 'string' ? review.author.login : null,
        authorType: typeof review.author?.__typename === 'string' ? review.author.__typename : null,
    };
}
function createPendingReview(pullRequestId: string, commitOid: string, body: string, gh: Gh): ReviewEnvelopeReceipt {
    const clientMutationId = createReviewClientMutationId(extractThreadIdFromBody(body));
    const query =
        'mutation($pullRequestId:ID!,$body:String!,$commitOid:GitObjectID!,$clientMutationId:String!){addPullRequestReview(input:{pullRequestId:$pullRequestId,body:$body,commitOID:$commitOid,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}';
    const response = graphql(
        gh,
        query,
        [
            '-F',
            `pullRequestId=${pullRequestId}`,
            '-f',
            `body=${body}`,
            '-F',
            `commitOid=${commitOid}`,
            '-f',
            `clientMutationId=${clientMutationId}`,
        ],
        'create pending review'
    ) as {
        data?: {
            addPullRequestReview?: {
                clientMutationId?: unknown;
                pullRequestReview?: unknown;
            };
        };
    };
    const receipt = toPullRequestReview(response.data?.addPullRequestReview?.pullRequestReview);
    const responseClientMutationId = response.data?.addPullRequestReview?.clientMutationId;
    if (receipt === null) {
        fail('create pending review returned an invalid result');
    }
    return {
        ...receipt,
        clientMutationId: typeof responseClientMutationId === 'string' ? responseClientMutationId : '',
    };
}
function mutationReply(threadId: string, reviewId: string, gh: Gh): ReviewReply {
    const clientMutationId = replyClientMutationId(threadId);
    const query =
        'mutation($threadId:ID!,$reviewId:ID!,$body:String!,$clientMutationId:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewId:$reviewId,pullRequestReviewThreadId:$threadId,body:$body,clientMutationId:$clientMutationId}){clientMutationId comment{id fullDatabaseId body author{login __typename ... on Bot{id}} pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}}';
    const response = graphql(
        gh,
        query,
        [
            '-F',
            `threadId=${threadId}`,
            '-F',
            `reviewId=${reviewId}`,
            '-f',
            'body=Done',
            '-f',
            `clientMutationId=${clientMutationId}`,
        ],
        'add review-thread reply'
    ) as {
        data?: {
            addPullRequestReviewThreadReply?: {
                clientMutationId?: unknown;
                comment?: {
                    id?: unknown;
                    fullDatabaseId?: unknown;
                    body?: unknown;
                    author?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
                    pullRequestReview?: unknown;
                };
            };
        };
    };
    const comment = response.data?.addPullRequestReviewThreadReply?.comment;
    const authorNodeId = typeof comment?.author?.id === 'string' ? comment.author.id : null;
    const authorLogin = typeof comment?.author?.login === 'string' ? comment.author.login : null;
    const authorType = typeof comment?.author?.__typename === 'string' ? comment.author.__typename : null;
    if (
        comment?.body !== 'Done' ||
        typeof comment.id !== 'string' ||
        !isDecimalId(comment.fullDatabaseId) ||
        !isAuthorBotActor(authorNodeId, authorType) ||
        response.data?.addPullRequestReviewThreadReply?.clientMutationId !== clientMutationId
    ) {
        fail(`add review-thread reply returned an invalid result for ${threadId}`);
    }
    const review = toPullRequestReview(comment.pullRequestReview);
    return {
        id: comment.id,
        fullDatabaseId: comment.fullDatabaseId,
        authorNodeId,
        authorLogin,
        authorType,
        reviewId: review?.id ?? null,
        ...(typeof review?.fullDatabaseId === 'string' ? { reviewFullDatabaseId: review.fullDatabaseId } : {}),
        reviewState: review?.state ?? null,
        reviewBody: review?.body ?? null,
        reviewCommitOid: review?.commitOid ?? null,
        reviewAuthorNodeId: review?.authorNodeId ?? null,
        reviewAuthorLogin: review?.authorLogin ?? null,
        reviewAuthorType: review?.authorType ?? null,
        clientMutationId,
    };
}
export function submitReview(reviewId: string, body: string, gh: Gh): ReviewEnvelopeReceipt {
    const clientMutationId = submitReviewClientMutationId(reviewId);
    const query =
        'mutation($reviewId:ID!,$body:String!,$clientMutationId:String!){submitPullRequestReview(input:{pullRequestReviewId:$reviewId,event:COMMENT,body:$body,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}';
    const response = graphql(
        gh,
        query,
        ['-F', `reviewId=${reviewId}`, '-f', `body=${body}`, '-f', `clientMutationId=${clientMutationId}`],
        'submit review'
    ) as {
        data?: {
            submitPullRequestReview?: {
                clientMutationId?: unknown;
                pullRequestReview?: unknown;
            };
        };
    };
    const receipt = toPullRequestReview(response.data?.submitPullRequestReview?.pullRequestReview);
    const responseClientMutationId = response.data?.submitPullRequestReview?.clientMutationId;
    if (receipt === null || responseClientMutationId !== clientMutationId) {
        fail(`submit review returned an invalid result for ${reviewId}`);
    }
    return {
        ...receipt,
        clientMutationId: responseClientMutationId,
    };
}
function skipJsonWhitespace(value: string, start: number): number {
    let index = start;
    while (index < value.length && /\s/.test(value[index]!)) {
        index += 1;
    }
    return index;
}

function jsonStringEnd(value: string, start: number, label: string): number {
    if (value[start] !== '"') {
        fail(label);
    }
    for (let index = start + 1; index < value.length; index += 1) {
        if (value[index] === '\\') {
            index += 1;
            continue;
        }
        if (value[index] === '"') {
            return index + 1;
        }
    }
    return fail(label);
}

function topLevelJsonValueEnd(value: string, start: number, label: string): number {
    let depth = 0;
    for (let index = start; index < value.length; index += 1) {
        const current = value[index];
        if (current === '"') {
            index = jsonStringEnd(value, index, label) - 1;
            continue;
        }
        if (current === '{' || current === '[') {
            depth += 1;
            continue;
        }
        if (current === '}' || current === ']') {
            if (depth === 0) {
                return index;
            }
            depth -= 1;
            continue;
        }
        if (current === ',' && depth === 0) {
            return index;
        }
    }
    return fail(label);
}

function decimalRestReviewId(response: string, label: string): string {
    let index = skipJsonWhitespace(response, 0);
    if (response[index] !== '{') {
        return fail(label);
    }
    index += 1;
    let id: string | undefined;
    for (;;) {
        index = skipJsonWhitespace(response, index);
        if (response[index] === '}') {
            break;
        }
        const keyStart = index;
        const keyEnd = jsonStringEnd(response, keyStart, label);
        let key: unknown;
        try {
            key = JSON.parse(response.slice(keyStart, keyEnd));
        } catch {
            return fail(label);
        }
        if (typeof key !== 'string') {
            return fail(label);
        }
        index = skipJsonWhitespace(response, keyEnd);
        if (response[index] !== ':') {
            return fail(label);
        }
        const valueStart = skipJsonWhitespace(response, index + 1);
        const valueEnd = topLevelJsonValueEnd(response, valueStart, label);
        if (key === 'id') {
            const candidate = response.slice(valueStart, valueEnd).trim();
            if (id !== undefined || !/^[1-9][0-9]*$/.test(candidate)) {
                return fail(label);
            }
            id = candidate;
        }
        index = skipJsonWhitespace(response, valueEnd);
        if (response[index] === '}') {
            break;
        }
        if (response[index] !== ',') {
            return fail(label);
        }
        index += 1;
    }
    if (id === undefined || skipJsonWhitespace(response, index + 1) !== response.length) {
        return fail(label);
    }
    return id;
}

export function updateReviewBody(
    number: number,
    review: PullRequestReview,
    body: string,
    gh: Gh
): ReviewEnvelopeReceipt {
    if (!Number.isSafeInteger(number) || number <= 0 || !isDecimalId(review.fullDatabaseId)) {
        fail(`update review body has no immutable decimal review identity for ${review.id}`);
    }
    const label = `update review body returned an invalid result for ${review.id}`;
    const response = gh([
        'api',
        '--method',
        'PUT',
        `repos/${REQUIRED_REPOSITORY}/pulls/${number}/reviews/${review.fullDatabaseId}`,
        '-f',
        `body=${body}`,
    ]);
    let parsed: unknown;
    try {
        parsed = JSON.parse(response) as unknown;
    } catch {
        fail(label);
    }
    const result = parsed as {
        node_id?: unknown;
        body?: unknown;
        state?: unknown;
        commit_id?: unknown;
        user?: { node_id?: unknown; login?: unknown; type?: unknown } | null;
    };
    if (
        decimalRestReviewId(response, label) !== review.fullDatabaseId ||
        result.node_id !== review.id ||
        typeof result.body !== 'string' ||
        typeof result.state !== 'string' ||
        typeof result.commit_id !== 'string' ||
        typeof result.user?.node_id !== 'string' ||
        typeof result.user?.type !== 'string' ||
        result.body !== body ||
        result.state !== review.state ||
        result.commit_id !== review.commitOid ||
        !isAuthorBotActor(result.user?.node_id, result.user?.type)
    ) {
        fail(label);
    }
    return {
        id: review.id,
        fullDatabaseId: review.fullDatabaseId,
        state: result.state,
        body: result.body,
        commitOid: result.commit_id,
        authorNodeId: result.user.node_id,
        authorLogin: typeof result.user?.login === 'string' ? result.user.login : null,
        authorType: result.user.type,
        clientMutationId: updateReviewClientMutationId(review.id),
    };
}
function resolveThread(threadId: string, gh: Gh): ReviewResolutionReceipt {
    const clientMutationId = resolveClientMutationId(threadId);
    const query = `mutation($threadId:ID!,$clientMutationId:String!){resolveReviewThread(input:{threadId:$threadId,clientMutationId:$clientMutationId}){clientMutationId thread{id isResolved resolvedBy{id login __typename}}}}`;
    const response = graphql(
        gh,
        query,
        ['-F', `threadId=${threadId}`, '-f', `clientMutationId=${clientMutationId}`],
        'resolve review thread'
    ) as {
        data?: {
            resolveReviewThread?: {
                clientMutationId?: unknown;
                thread?: {
                    id?: unknown;
                    isResolved?: unknown;
                    resolvedBy?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
                };
            };
        };
    };
    const receipt = response.data?.resolveReviewThread;
    const resolvedByNodeId = receipt?.thread?.resolvedBy?.id;
    const resolvedByLogin = receipt?.thread?.resolvedBy?.login;
    if (
        receipt?.clientMutationId !== clientMutationId ||
        receipt.thread?.id !== threadId ||
        receipt.thread.isResolved !== true
    ) {
        fail(`resolveReviewThread returned an invalid result for ${threadId}`);
    }
    const resolvedByType = receipt?.thread?.resolvedBy?.__typename;
    if (typeof resolvedByType !== 'string' || !isAuthorResolutionActor(resolvedByNodeId, resolvedByType)) {
        fail(`resolveReviewThread returned an invalid result for ${threadId}`);
    }
    return {
        resolvedByNodeId: authorBotNodeId(resolvedByNodeId),
        resolvedByLogin: typeof resolvedByLogin === 'string' ? resolvedByLogin : '',
        resolvedByType,
        clientMutationId,
    };
}
export function deletePendingReview(reviewId: string, gh: Gh): void {
    const response = graphql(
        gh,
        'mutation($reviewId:ID!,$clientMutationId:String!){deletePullRequestReview(input:{pullRequestReviewId:$reviewId,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}',
        ['-F', `reviewId=${reviewId}`, '-f', `clientMutationId=${reviewId}`],
        'delete pending review'
    ) as {
        data?: {
            deletePullRequestReview?: {
                clientMutationId?: unknown;
                pullRequestReview?: unknown;
            };
        };
    };
    const receipt = toPullRequestReview(response.data?.deletePullRequestReview?.pullRequestReview);
    if (
        response.data?.deletePullRequestReview?.clientMutationId !== reviewId ||
        receipt === null ||
        receipt.id !== reviewId ||
        receipt.state !== 'PENDING' ||
        !isAuthorBotActor(receipt.authorNodeId, receipt.authorType)
    ) {
        fail(`delete pending review returned an invalid result for ${reviewId}`);
    }
}
export function deleteReply(replyId: string, gh: Gh): void {
    const response = graphql(
        gh,
        'mutation($replyId:ID!,$clientMutationId:String!){deletePullRequestReviewComment(input:{id:$replyId,clientMutationId:$clientMutationId}){clientMutationId pullRequestReviewComment{id body author{login __typename ... on Bot{id}}}}}',
        ['-F', `replyId=${replyId}`, '-f', `clientMutationId=${replyId}`],
        'delete review reply'
    ) as {
        data?: {
            deletePullRequestReviewComment?: {
                clientMutationId?: unknown;
                pullRequestReviewComment?: {
                    id?: unknown;
                    body?: unknown;
                    author?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
                } | null;
            };
        };
    };
    const receipt = response.data?.deletePullRequestReviewComment;
    if (
        receipt?.clientMutationId !== replyId ||
        receipt.pullRequestReviewComment?.id !== replyId ||
        receipt.pullRequestReviewComment.body !== 'Done' ||
        !isAuthorBotActor(
            receipt.pullRequestReviewComment.author?.id,
            receipt.pullRequestReviewComment.author?.__typename
        )
    ) {
        fail(`delete review reply returned an invalid result for ${replyId}`);
    }
}

export async function runDetachedReviewResolutionWorker(
    modulePath: string,
    args: string[],
    trustedLauncher: ReviewResolutionTrustedLauncher
): Promise<number> {
    const marker = createReviewResolutionChildLaunchMarker(trustedLauncher);
    try {
        const child = spawn(process.execPath, [modulePath, ...args], {
            cwd: process.cwd(),
            env: { ...process.env, [REVIEW_RESOLUTION_CHILD_ENV]: marker.envValue },
            stdio: 'inherit',
            shell: false,
            detached: true,
        });
        if (child.pid === undefined) {
            fail('review:resolve detached launcher could not determine the child process');
        }
        marker.bindChildPid(child.pid);
        return await new Promise<number>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, signal) => {
                if (code === null) {
                    reject(new Error(`review:resolve terminated by ${signal ?? 'unknown signal'}`));
                    return;
                }
                resolve(code);
            });
        });
    } finally {
        marker.cleanup();
    }
}

export function defaultResolveReviewThreadCoordinatorDependencies(): ResolveReviewThreadCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        serializeMutation: withPullRequestMutationLock,
        authenticateAuthor: (primaryRoot) => authenticateRole({ primaryRoot, role: 'author' }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        threadPort: (
            session,
            primaryRoot,
            markRemoteMutationAttempt,
            sharedMutationOwnerOid,
            registerSuccessfulCompletion
        ) =>
            shellPort(
                session,
                primaryRoot,
                markRemoteMutationAttempt,
                spawnCapture,
                sharedMutationOwnerOid,
                registerSuccessfulCompletion
            ),
        resolve: resolveReviewThread,
    };
}

export async function coordinateResolveReviewThread(
    number: number,
    threadId: string,
    expectedHead: string,
    dependencies: ResolveReviewThreadCoordinatorDependencies = defaultResolveReviewThreadCoordinatorDependencies()
): Promise<void> {
    const primaryRoot = dependencies.primaryRoot();
    await dependencies.serializeMutation(
        primaryRoot,
        number,
        async ({ markRemoteMutationAttempt, ownerOid, registerSuccessfulCompletion }) => {
            const auth = await dependencies.authenticateAuthor(primaryRoot);
            try {
                if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
                    fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
                }
                assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
                dependencies.resolve(
                    number,
                    threadId,
                    expectedHead,
                    auth.minted.actorNodeId,
                    dependencies.threadPort(
                        auth.session,
                        primaryRoot,
                        markRemoteMutationAttempt,
                        ownerOid,
                        registerSuccessfulCompletion
                    )
                );
            } finally {
                auth.session.dispose();
            }
        },
        {
            reviewResolution: {
                threadId,
                head: expectedHead,
                ownerFence: () =>
                    assertReviewResolutionExecutionFence(currentReviewResolutionExecutionFence(), process.platform)
                        .ownerFence,
            },
        }
    );
}

export async function runResolveReviewThreadCli(
    args: string[],
    dependencies?: ResolveReviewThreadCliDependencies
): Promise<number> {
    const parsed = parseResolveReviewThreadArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.number === undefined || parsed.threadId === undefined || parsed.head === undefined) {
        fail(usage);
    }
    const childMarker = process.env[REVIEW_RESOLUTION_CHILD_ENV];
    if (childMarker === undefined) {
        const resolvedDependencies = resolveReviewThreadCliDependencies(dependencies);
        return await runDetachedReviewResolutionWorker(
            fileURLToPath(import.meta.url),
            args,
            resolvedDependencies.trustedLauncher
        );
    }
    const trustedLauncher = await assertDetachedReviewResolutionChild(childMarker);
    const resolvedDependencies = resolveReviewThreadCliDependencies(dependencies, trustedLauncher);
    const cwd = process.cwd();
    const trustedOriginCommit = requiredTrustedReviewResolutionOriginCommit();
    assertTrustedExecutingBlob(
        'scripts/resolveReviewThread.ts',
        fileURLToPath(import.meta.url),
        originMainBlob('scripts/resolveReviewThread.ts', cwd, undefined, undefined, trustedOriginCommit)
    );
    const primaryRoot = resolvedDependencies.trustedLauncher.primaryRoot;
    await coordinateResolveReviewThread(parsed.number, parsed.threadId, parsed.head, {
        primaryRoot: () => primaryRoot,
        serializeMutation: resolvedDependencies.serializeMutation,
        authenticateAuthor: resolvedDependencies.authenticateAuthor,
        repositoryName: resolvedDependencies.repositoryName,
        threadPort: resolvedDependencies.createPort,
        resolve: resolveReviewThread,
    });
    return 0;
}

async function main(): Promise<number> {
    return await runResolveReviewThreadCli(process.argv.slice(2));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void main().then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
