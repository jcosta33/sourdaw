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
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockOwner,
    releasePullRequestMutationLockExact,
    type PullRequestMutationLockOwner,
} from './pullRequestMutationLock.ts';

const INCIDENT = {
    number: 3344,
    ownerOid: '9f9c875746e69d6282e4233b32dfb1d07f418724',
    owner: {
        version: 1 as const,
        pid: 1297320,
        token: 'bcf9e594-59ce-450e-a357-97a433899ce5',
    },
    rejectedHead: '8dca20782dfc174bf28ed2ad985414674e7a8180',
    receiptId: 5506507863,
} as const;

const usage = 'usage: pnpm deliver --recover-lock 3344 --owner 9f9c875746e69d6282e4233b32dfb1d07f418724';

export type RecoverDeliveryLockArgs = { help: boolean; number?: number; ownerOid?: string };

export type DeliveryLockRecoveryTrustedLauncher = {
    primaryRoot: string;
    gitPath: string;
    ghPath: string;
};

export type DeliveryLockRecoveryRemoteState = {
    state: string;
    head: string;
    receipt: {
        id: number;
        body: string;
        authorNodeId: string;
        createdAt: string;
        updatedAt: string;
    };
};

export type DeliveryLockRecoveryDependencies = {
    trustedLauncher?: DeliveryLockRecoveryTrustedLauncher;
    authenticateAuthor?: (primaryRoot: string) => Promise<{
        minted: { actorNodeId: string };
        session: GhSession;
    }>;
    repositoryName?: (session: GhSession, primaryRoot: string) => string;
    readRemoteState?: (repository: string, session: GhSession, primaryRoot: string) => DeliveryLockRecoveryRemoteState;
    processIsDead?: (pid: number) => boolean;
    readLockOid?: (primaryRoot: string, ref: string, number: number) => string | undefined;
    readLockOwner?: (primaryRoot: string, oid: string, number: number) => PullRequestMutationLockOwner;
    releaseLock?: (primaryRoot: string, number: number, ownerOid: string) => void;
};

type ResolvedDependencies = Required<DeliveryLockRecoveryDependencies>;

function readJson(value: string, label: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return fail(`delivery lock recovery could not read ${label}`);
    }
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        fail(`delivery lock recovery could not read ${label}`);
    }
    return Object.fromEntries(Object.entries(value));
}

function text(value: unknown, label: string): string {
    if (typeof value !== 'string' || value === '') {
        fail(`delivery lock recovery could not read ${label}`);
    }
    return value;
}

function numericId(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        fail(`delivery lock recovery could not read ${label}`);
    }
    return value;
}

function defaultRemoteState(
    repository: string,
    session: GhSession,
    primaryRoot: string
): DeliveryLockRecoveryRemoteState {
    const pullRequest = record(
        readJson(
            spawnCapture('gh', ['api', `repos/${repository}/pulls/${INCIDENT.number}`], {
                cwd: primaryRoot,
                env: session.env,
            }),
            'pull-request state'
        ),
        'pull-request state'
    );
    const head = record(pullRequest.head, 'pull-request head');
    const comment = record(
        readJson(
            spawnCapture('gh', ['api', `repos/${repository}/issues/comments/${INCIDENT.receiptId}`], {
                cwd: primaryRoot,
                env: session.env,
            }),
            'delivery receipt'
        ),
        'delivery receipt'
    );
    const author = record(comment.user, 'delivery receipt author');
    return {
        state: text(pullRequest.state, 'pull-request state'),
        head: text(head.sha, 'pull-request head'),
        receipt: {
            id: numericId(comment.id, 'delivery receipt id'),
            body: text(comment.body, 'delivery receipt body'),
            authorNodeId: text(author.node_id, 'delivery receipt author'),
            createdAt: text(comment.created_at, 'delivery receipt created time'),
            updatedAt: text(comment.updated_at, 'delivery receipt updated time'),
        },
    };
}

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
        processIsDead: dependencies.processIsDead ?? defaultProcessIsDead,
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
    if (
        args.length !== 3 ||
        args[0] !== String(INCIDENT.number) ||
        args[1] !== '--owner' ||
        args[2]?.toLowerCase() !== INCIDENT.ownerOid
    ) {
        fail(usage);
    }
    return { help: false, number: INCIDENT.number, ownerOid: INCIDENT.ownerOid };
}

function assertIncidentRemoteState(remote: DeliveryLockRecoveryRemoteState): void {
    if (remote.state.toUpperCase() !== 'OPEN') {
        fail(`PR #${INCIDENT.number} is not open`);
    }
    if (!/^[0-9a-f]{40}$/iu.test(remote.head) || remote.head.toLowerCase() === INCIDENT.rejectedHead) {
        fail(`PR #${INCIDENT.number} current head does not prove the rejected merge is obsolete`);
    }
    if (remote.receipt.id !== INCIDENT.receiptId) {
        fail(`PR #${INCIDENT.number} delivery receipt does not match the rejected merge`);
    }
    if (remote.receipt.authorNodeId !== AUTHOR_BOT_NODE_ID) {
        fail(`PR #${INCIDENT.number} delivery receipt actor does not match the author App`);
    }
    if (remote.receipt.createdAt !== remote.receipt.updatedAt) {
        fail(`PR #${INCIDENT.number} delivery receipt was edited`);
    }
    const receipt = parseDeliveryReceipt(remote.receipt.body);
    if (receipt?.pullRequest !== INCIDENT.number || receipt.head.toLowerCase() !== INCIDENT.rejectedHead) {
        fail(`PR #${INCIDENT.number} delivery receipt does not match the rejected merge`);
    }
}

function sameRemoteState(left: DeliveryLockRecoveryRemoteState, right: DeliveryLockRecoveryRemoteState): boolean {
    return (
        left.state === right.state &&
        left.head === right.head &&
        left.receipt.id === right.receipt.id &&
        left.receipt.body === right.receipt.body &&
        left.receipt.authorNodeId === right.receipt.authorNodeId &&
        left.receipt.createdAt === right.receipt.createdAt &&
        left.receipt.updatedAt === right.receipt.updatedAt
    );
}

function assertExactOwner(owner: PullRequestMutationLockOwner): void {
    if (
        owner.version !== INCIDENT.owner.version ||
        owner.pid !== INCIDENT.owner.pid ||
        owner.token !== INCIDENT.owner.token
    ) {
        fail(`PR #${INCIDENT.number} delivery lock payload does not match the retained incident owner`);
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
    const resolved = resolveDependencies(dependencies);
    const primaryRoot = resolved.trustedLauncher.primaryRoot;
    const ownerOid = resolved.readLockOid(primaryRoot, pullRequestMutationLockRef(INCIDENT.number), INCIDENT.number);
    if (ownerOid !== INCIDENT.ownerOid) {
        fail(`PR #${INCIDENT.number} delivery lock owner does not match this recovery incident`);
    }
    const owner = resolved.readLockOwner(primaryRoot, ownerOid, INCIDENT.number);
    assertExactOwner(owner);
    if (!resolved.processIsDead(owner.pid)) {
        fail(`PR #${INCIDENT.number} delivery lock process is still live or cannot be proven dead`);
    }
    const auth = await resolved.authenticateAuthor(primaryRoot);
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        const repository = resolved.repositoryName(auth.session, primaryRoot);
        assertRequiredRepository(repository);
        const before = resolved.readRemoteState(repository, auth.session, primaryRoot);
        assertIncidentRemoteState(before);
        const after = resolved.readRemoteState(repository, auth.session, primaryRoot);
        assertIncidentRemoteState(after);
        if (!sameRemoteState(before, after)) {
            fail(`PR #${INCIDENT.number} remote state changed during delivery lock recovery`);
        }
        resolved.releaseLock(primaryRoot, INCIDENT.number, ownerOid);
        console.log(`delivery-lock-recovered:${INCIDENT.number}:${ownerOid}:${after.head}`);
        return 0;
    } finally {
        auth.session.dispose();
    }
}
