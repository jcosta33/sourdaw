import { randomUUID } from 'node:crypto';

import {
    legacyDeliveryLockIncidents,
    type MissingReceiptIncident,
    type RecoveryIncident,
    type RejectedMergeIncident,
} from './deliveryLockLegacyIncidents.ts';
import {
    defaultJournaledRemoteState,
    defaultRemoteState,
    sameJournaledRemoteState,
    sameRemoteState,
    type DeliveryLockRecoveryRemoteState,
    type IssueCommentObservation,
    type JournaledRecoveryRemoteState,
    type MissingReceiptRecoveryRemoteState,
    type RejectedMergeRecoveryRemoteState,
} from './deliveryRemoteInspection.ts';
import {
    AUTHOR_BOT_NODE_ID,
    assertRequiredRepository,
    authenticateRole,
    isAuthorBotNodeId,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { parseDeliveryReceipt, fail } from './prContract.ts';
import {
    currentMutationOwnerFence,
    isDeliveryPullRequestMutationLockOwner,
    mutationOwnerFenceIsLive,
    pullRequestMutationLockRef,
    readDeliveryRecoveryReceipt,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockOwner,
    recordDeliveryRecoveryReceipt,
    releasePullRequestMutationLockExact,
    replacePullRequestMutationLockOwner,
    type PullRequestMutationLockOwner,
    type PullRequestMutationLockOwnerFence,
} from './pullRequestMutationLock.ts';

export type {
    DeliveryLockRecoveryRemoteState,
    IssueCommentObservation,
    JournaledRecoveryRemoteState,
    MissingReceiptRecoveryRemoteState,
    RecoveryIncident,
    RejectedMergeRecoveryRemoteState,
};

const usage = 'usage: pnpm deliver --recover-lock <pr-number> --owner <owner-oid>';

// A pre-journal owner carries no fence, so only these retained incidents can ever be proven safe.
const pinnedIncidentUsage = `usage: ${legacyDeliveryLockIncidents
    .map((incident) => `pnpm deliver --recover-lock ${incident.number} --owner ${incident.ownerOid}`)
    .join('\n       ')}`;

export type RecoverDeliveryLockArgs = { help: boolean; number?: number; ownerOid?: string };

export type DeliveryLockOwner = Extract<PullRequestMutationLockOwner, { version: 4 }>;

export type DeliveryLockRecoveryTrustedLauncher = {
    primaryRoot: string;
    gitPath: string;
    ghPath: string;
};

export type DeliveryLockRecoveryDependencies = {
    trustedLauncher?: DeliveryLockRecoveryTrustedLauncher;
    authenticateAuthor?: (primaryRoot: string) => Promise<{
        minted: { actorNodeId: string };
        session: GhSession;
    }>;
    repositoryName?: (session: GhSession, primaryRoot: string) => string;
    readRemoteState?: (
        repository: string,
        session: GhSession,
        primaryRoot: string,
        incident: RecoveryIncident
    ) => DeliveryLockRecoveryRemoteState;
    readJournaledRemoteState?: (
        repository: string,
        session: GhSession,
        primaryRoot: string,
        number: number
    ) => JournaledRecoveryRemoteState;
    processIsDead?: (pid: number) => boolean;
    ownerFenceIsLive?: (owner: DeliveryLockOwner) => boolean;
    currentOwnerFence?: () => PullRequestMutationLockOwnerFence;
    readLockOid?: (primaryRoot: string, ref: string, number: number) => string | undefined;
    readLockOwner?: (primaryRoot: string, oid: string, number: number) => PullRequestMutationLockOwner;
    releaseLock?: (primaryRoot: string, number: number, ownerOid: string) => void;
};

type ResolvedDependencies = Required<DeliveryLockRecoveryDependencies>;

function defaultProcessIsDead(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return false;
    } catch (error) {
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            (error as { code?: unknown }).code === 'ESRCH'
        ) {
            return true;
        }
        return false;
    }
}

function resolveDependencies(dependencies: DeliveryLockRecoveryDependencies | undefined): ResolvedDependencies {
    if (dependencies?.trustedLauncher === undefined) {
        fail('deliver --recover-lock must run through the protected primary checkout launcher');
    }
    return {
        trustedLauncher: dependencies.trustedLauncher,
        authenticateAuthor:
            dependencies.authenticateAuthor ?? ((primaryRoot) => authenticateRole({ primaryRoot, role: 'author' })),
        repositoryName:
            dependencies.repositoryName ??
            ((session, primaryRoot) =>
                spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                    env: session.env,
                    cwd: primaryRoot,
                })),
        readRemoteState: dependencies.readRemoteState ?? defaultRemoteState,
        readJournaledRemoteState: dependencies.readJournaledRemoteState ?? defaultJournaledRemoteState,
        processIsDead: dependencies.processIsDead ?? defaultProcessIsDead,
        ownerFenceIsLive: dependencies.ownerFenceIsLive ?? mutationOwnerFenceIsLive,
        currentOwnerFence: dependencies.currentOwnerFence ?? currentMutationOwnerFence,
        readLockOid: dependencies.readLockOid ?? readPullRequestMutationLockOid,
        readLockOwner: dependencies.readLockOwner ?? readPullRequestMutationLockOwner,
        releaseLock: dependencies.releaseLock ?? releasePullRequestMutationLockExact,
    };
}

export function parseRecoverDeliveryLockArgs(args: string[]): RecoverDeliveryLockArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const [pullRequest, flag, ownerOid] = args;
    if (
        args.length !== 3 ||
        flag !== '--owner' ||
        !/^[1-9][0-9]*$/u.test(pullRequest ?? '') ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(ownerOid ?? '')
    ) {
        fail(usage);
    }
    const number = Number(pullRequest);
    if (!Number.isSafeInteger(number)) {
        fail(usage);
    }
    return { help: false, number, ownerOid: ownerOid!.toLowerCase() };
}

function assertRejectedMergeRemoteState(
    incident: RejectedMergeIncident,
    remote: RejectedMergeRecoveryRemoteState
): void {
    if (remote.state.toUpperCase() !== 'OPEN') {
        fail(`PR #${incident.number} is not open`);
    }
    if (!/^[0-9a-f]{40}$/iu.test(remote.head) || remote.head.toLowerCase() === incident.rejectedHead) {
        fail(`PR #${incident.number} current head does not prove the rejected merge is obsolete`);
    }
    if (remote.receipt.id !== incident.receiptId) {
        fail(`PR #${incident.number} delivery receipt does not match the rejected merge`);
    }
    if (remote.receipt.authorNodeId !== AUTHOR_BOT_NODE_ID) {
        fail(`PR #${incident.number} delivery receipt actor does not match the author App`);
    }
    if (remote.receipt.createdAt !== remote.receipt.updatedAt) {
        fail(`PR #${incident.number} delivery receipt was edited`);
    }
    const receipt = parseDeliveryReceipt(remote.receipt.body);
    if (receipt?.pullRequest !== incident.number || receipt.head.toLowerCase() !== incident.rejectedHead) {
        fail(`PR #${incident.number} delivery receipt does not match the rejected merge`);
    }
}

function assertMissingReceiptRemoteState(
    incident: MissingReceiptIncident,
    remote: MissingReceiptRecoveryRemoteState
): void {
    if (remote.state.toUpperCase() !== 'OPEN') {
        fail(`PR #${incident.number} is not open`);
    }
    if (!/^[0-9a-f]{40}$/iu.test(remote.head)) {
        fail(`PR #${incident.number} current head cannot be verified`);
    }
    if (remote.merged) {
        fail(`PR #${incident.number} is already merged`);
    }
    const receipt = remote.comments.find(
        (comment) => isAuthorBotNodeId(comment.authorNodeId) && parseDeliveryReceipt(comment.body) !== undefined
    );
    if (receipt !== undefined) {
        fail(`PR #${incident.number} already carries an author delivery receipt`);
    }
}

function assertIncidentRemoteState(incident: RecoveryIncident, remote: DeliveryLockRecoveryRemoteState): void {
    if (incident.kind === 'rejected-merge') {
        if (!('receipt' in remote)) {
            fail('delivery lock recovery could not read pull-request state');
        }
        assertRejectedMergeRemoteState(incident, remote);
        return;
    }
    if (!('merged' in remote)) {
        fail('delivery lock recovery could not read pull-request state');
    }
    assertMissingReceiptRemoteState(incident, remote);
}

function assertExactOwner(incident: RecoveryIncident, owner: PullRequestMutationLockOwner): void {
    if (
        owner.version !== incident.owner.version ||
        owner.pid !== incident.owner.pid ||
        owner.token !== incident.owner.token
    ) {
        fail(`PR #${incident.number} delivery lock payload does not match the retained incident owner`);
    }
}

type JournaledRecoveryReceipt = {
    version: 1;
    number: number;
    ownerOid: string;
    adoptedOwnerOid: string;
    ownerPhase: DeliveryLockOwner['mutation']['phase'];
    ownerEpoch: number;
    state: string;
    head: string;
    mergedByActorNodeId: string | null;
    receiptIds: number[];
};

function observedDeliveryState(remote: JournaledRecoveryRemoteState): string {
    return remote.merged ? 'MERGED' : remote.state.toUpperCase();
}

function describeOwnerFence(ownerFence: PullRequestMutationLockOwnerFence): string {
    if (ownerFence.kind === 'pgid') {
        return `process group ${ownerFence.pgid}`;
    }
    if (ownerFence.kind === 'pid') {
        return `process ${ownerFence.pid}`;
    }
    return `Windows process tree ${ownerFence.rootPid}`;
}

function reportRecoveredLock(number: number, ownerOid: string, state: string): void {
    console.log(`delivery-lock-recovered:${number}:${ownerOid}:${state}`);
    console.log(`pnpm deliver ${number}`);
}

function isJournaledRecoveryReceipt(
    value: unknown,
    number: number,
    ownerOid: string
): value is JournaledRecoveryReceipt {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const receipt = value as Record<string, unknown>;
    return (
        receipt.version === 1 &&
        receipt.number === number &&
        receipt.ownerOid === ownerOid &&
        typeof receipt.adoptedOwnerOid === 'string' &&
        typeof receipt.state === 'string' &&
        receipt.state !== ''
    );
}

/**
 * A recovery that already recorded its receipt has finished reconciling: replaying it must reach the
 * same conclusion from the receipt alone, and must never read or write GitHub a second time.
 */
function replayRecordedRecovery(
    primaryRoot: string,
    number: number,
    ownerOid: string,
    liveOid: string | undefined,
    resolved: ResolvedDependencies
): number | undefined {
    const persisted = readDeliveryRecoveryReceipt(primaryRoot, number, ownerOid);
    if (!isJournaledRecoveryReceipt(persisted, number, ownerOid)) {
        return undefined;
    }
    if (liveOid === persisted.adoptedOwnerOid) {
        resolved.releaseLock(primaryRoot, number, persisted.adoptedOwnerOid);
    } else if (liveOid !== undefined) {
        fail(`PR #${number} delivery lock ownership changed before recovery`);
    }
    reportRecoveredLock(number, ownerOid, persisted.state);
    return 0;
}

function adoptedDeliveryOwner(
    number: number,
    owner: DeliveryLockOwner,
    ownerFence: PullRequestMutationLockOwnerFence
): DeliveryLockOwner {
    return {
        version: 4,
        pid: process.pid,
        token: randomUUID(),
        operation: 'delivery',
        number,
        ownerFence,
        mutation: { phase: owner.mutation.phase, epoch: owner.mutation.epoch + 1 },
    };
}

function journaledRecoveryReceipt(
    number: number,
    ownerOid: string,
    adoptedOwnerOid: string,
    owner: DeliveryLockOwner,
    remote: JournaledRecoveryRemoteState
): JournaledRecoveryReceipt {
    return {
        version: 1,
        number,
        ownerOid,
        adoptedOwnerOid,
        ownerPhase: owner.mutation.phase,
        ownerEpoch: owner.mutation.epoch,
        state: observedDeliveryState(remote),
        head: remote.head,
        mergedByActorNodeId: remote.mergedByActorNodeId ?? null,
        receiptIds: remote.receipts.map((receipt) => receipt.id),
    };
}

function assertRecoverableMergeActor(number: number, remote: JournaledRecoveryRemoteState): void {
    const actorNodeId = remote.mergedByActorNodeId;
    if (actorNodeId !== undefined && !isAuthorBotNodeId(actorNodeId)) {
        fail(`PR #${number} was merged by ${actorNodeId}, which is not the author App`);
    }
}

async function recoverJournaledOwner(
    number: number,
    ownerOid: string,
    owner: DeliveryLockOwner,
    primaryRoot: string,
    resolved: ResolvedDependencies
): Promise<number> {
    if (resolved.ownerFenceIsLive(owner)) {
        fail(
            `PR #${number} delivery lock is still held by live process ${owner.pid} ` +
                `(${describeOwnerFence(owner.ownerFence)})`
        );
    }
    const auth = await resolved.authenticateAuthor(primaryRoot);
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        const repository = resolved.repositoryName(auth.session, primaryRoot);
        assertRequiredRepository(repository);
        // Adopting first means a crash anywhere below leaves a journaled owner under this process's
        // own fence rather than a half-cleared ref no later recovery could attest.
        const adoptedOid = replacePullRequestMutationLockOwner(
            primaryRoot,
            number,
            ownerOid,
            adoptedDeliveryOwner(number, owner, resolved.currentOwnerFence())
        );
        const before = resolved.readJournaledRemoteState(repository, auth.session, primaryRoot, number);
        const after = resolved.readJournaledRemoteState(repository, auth.session, primaryRoot, number);
        if (!sameJournaledRemoteState(before, after)) {
            fail(`PR #${number} remote state changed between reads`);
        }
        assertRecoverableMergeActor(number, after);
        recordDeliveryRecoveryReceipt(
            primaryRoot,
            number,
            ownerOid,
            journaledRecoveryReceipt(number, ownerOid, adoptedOid, owner, after)
        );
        resolved.releaseLock(primaryRoot, number, adoptedOid);
        reportRecoveredLock(number, ownerOid, observedDeliveryState(after));
        return 0;
    } finally {
        auth.session.dispose();
    }
}

async function recoverPinnedIncident(
    number: number,
    ownerOid: string,
    owner: PullRequestMutationLockOwner,
    primaryRoot: string,
    resolved: ResolvedDependencies
): Promise<number> {
    const incident = legacyDeliveryLockIncidents.find(
        (candidate) => candidate.number === number && candidate.ownerOid === ownerOid
    );
    if (incident === undefined) {
        fail(pinnedIncidentUsage);
    }
    assertExactOwner(incident, owner);
    if (!resolved.processIsDead(owner.pid)) {
        fail(`PR #${number} delivery lock process is still live or cannot be proven dead`);
    }
    const auth = await resolved.authenticateAuthor(primaryRoot);
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        const repository = resolved.repositoryName(auth.session, primaryRoot);
        assertRequiredRepository(repository);
        const before = resolved.readRemoteState(repository, auth.session, primaryRoot, incident);
        assertIncidentRemoteState(incident, before);
        const after = resolved.readRemoteState(repository, auth.session, primaryRoot, incident);
        assertIncidentRemoteState(incident, after);
        if (!sameRemoteState(before, after)) {
            fail(`PR #${number} remote state changed during delivery lock recovery`);
        }
        resolved.releaseLock(primaryRoot, number, ownerOid);
        console.log(`delivery-lock-recovered:${number}:${ownerOid}:${after.head}`);
        return 0;
    } finally {
        auth.session.dispose();
    }
}

export async function runRecoverDeliveryLockCli(
    args: string[],
    dependencies?: DeliveryLockRecoveryDependencies
): Promise<number> {
    const parsed = parseRecoverDeliveryLockArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    const number = parsed.number!;
    const ownerOid = parsed.ownerOid!;
    const resolved = resolveDependencies(dependencies);
    const primaryRoot = resolved.trustedLauncher.primaryRoot;
    const liveOid = resolved.readLockOid(primaryRoot, pullRequestMutationLockRef(number), number);
    const replayed = replayRecordedRecovery(primaryRoot, number, ownerOid, liveOid, resolved);
    if (replayed !== undefined) {
        return replayed;
    }
    if (liveOid !== ownerOid) {
        fail(`PR #${number} delivery lock owner does not match this recovery incident`);
    }
    const owner = resolved.readLockOwner(primaryRoot, ownerOid, number);
    if (owner.version === 1) {
        return recoverPinnedIncident(number, ownerOid, owner, primaryRoot, resolved);
    }
    if (!isDeliveryPullRequestMutationLockOwner(owner)) {
        fail(`PR #${number} delivery lock recovery requires a delivery lock owner`);
    }
    return recoverJournaledOwner(number, ownerOid, owner, primaryRoot, resolved);
}
