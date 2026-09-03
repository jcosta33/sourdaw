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

type IncidentBase = {
    number: number;
    ownerOid: string;
    owner: PullRequestMutationLockOwner;
};

type RejectedMergeIncident = IncidentBase & {
    kind: 'rejected-merge';
    rejectedHead: string;
    receiptId: number;
};

type MissingReceiptIncident = IncidentBase & {
    kind: 'missing-receipt';
};

export type RecoveryIncident = RejectedMergeIncident | MissingReceiptIncident;

const INCIDENT_3344: RejectedMergeIncident = {
    kind: 'rejected-merge',
    number: 3344,
    ownerOid: '9f9c875746e69d6282e4233b32dfb1d07f418724',
    owner: {
        version: 1,
        pid: 1297320,
        token: 'bcf9e594-59ce-450e-a357-97a433899ce5',
    },
    rejectedHead: '8dca20782dfc174bf28ed2ad985414674e7a8180',
    receiptId: 5506507863,
};

// PR #3437's delivery died before any receipt was posted, so this incident proves the
// absence of an author-App delivery receipt instead of matching a rejected merge.
const INCIDENT_3437: MissingReceiptIncident = {
    kind: 'missing-receipt',
    number: 3437,
    ownerOid: '3ebcbf92f6a331dcd31a00b1891b522fbd170748',
    owner: {
        version: 1,
        pid: 26953,
        token: 'f515a71d-c25a-4714-b725-ef6e9b141005',
    },
};

const INCIDENTS: readonly RecoveryIncident[] = [INCIDENT_3344, INCIDENT_3437];

const usage = `usage: ${INCIDENTS.map(
    (incident) => `pnpm deliver --recover-lock ${incident.number} --owner ${incident.ownerOid}`
).join('\n       ')}`;

export type RecoverDeliveryLockArgs = { help: boolean; number?: number; ownerOid?: string };

export type DeliveryLockRecoveryTrustedLauncher = {
    primaryRoot: string;
    gitPath: string;
    ghPath: string;
};

export type RejectedMergeRecoveryRemoteState = {
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

export type IssueCommentObservation = {
    id: number;
    authorNodeId: string;
    body: string;
};

export type MissingReceiptRecoveryRemoteState = {
    state: string;
    head: string;
    merged: boolean;
    comments: IssueCommentObservation[];
};

export type DeliveryLockRecoveryRemoteState = RejectedMergeRecoveryRemoteState | MissingReceiptRecoveryRemoteState;

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

function mergedState(value: unknown): boolean {
    if (typeof value !== 'boolean') {
        fail('delivery lock recovery could not read pull-request merged state');
    }
    return value;
}

function readPullRequestRecord(repository: string, session: GhSession, primaryRoot: string, number: number) {
    const pullRequest = record(
        readJson(
            spawnCapture('gh', ['api', `repos/${repository}/pulls/${number}`], {
                cwd: primaryRoot,
                env: session.env,
            }),
            'pull-request state'
        ),
        'pull-request state'
    );
    return { pullRequest, head: record(pullRequest.head, 'pull-request head') };
}

function readRejectedMergeRemoteState(
    repository: string,
    session: GhSession,
    primaryRoot: string,
    incident: RejectedMergeIncident
): RejectedMergeRecoveryRemoteState {
    const { pullRequest, head } = readPullRequestRecord(repository, session, primaryRoot, incident.number);
    const comment = record(
        readJson(
            spawnCapture('gh', ['api', `repos/${repository}/issues/comments/${incident.receiptId}`], {
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

function readIssueCommentObservation(value: unknown): IssueCommentObservation {
    const comment = record(value, 'issue comment');
    const author = record(comment.user, 'issue comment author');
    return {
        id: numericId(comment.id, 'issue comment id'),
        authorNodeId: text(author.node_id, 'issue comment author'),
        body: text(comment.body, 'issue comment body'),
    };
}

// REST issue comments come back in ascending comment-ID order; pagination and flattening
// keep that order so the two stability reads compare the same observation sequence.
function readIssueComments(
    repository: string,
    session: GhSession,
    primaryRoot: string,
    number: number
): IssueCommentObservation[] {
    const pages = readJson(
        spawnCapture(
            'gh',
            ['api', '--paginate', '--slurp', `repos/${repository}/issues/${number}/comments?per_page=100`],
            { cwd: primaryRoot, env: session.env }
        ),
        'issue comments'
    );
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
        fail('delivery lock recovery could not read issue comments');
    }
    return pages.flat().map(readIssueCommentObservation);
}

function readMissingReceiptRemoteState(
    repository: string,
    session: GhSession,
    primaryRoot: string,
    incident: MissingReceiptIncident
): MissingReceiptRecoveryRemoteState {
    const { pullRequest, head } = readPullRequestRecord(repository, session, primaryRoot, incident.number);
    return {
        state: text(pullRequest.state, 'pull-request state'),
        head: text(head.sha, 'pull-request head'),
        merged: mergedState(pullRequest.merged),
        comments: readIssueComments(repository, session, primaryRoot, incident.number),
    };
}

function defaultRemoteState(
    repository: string,
    session: GhSession,
    primaryRoot: string,
    incident: RecoveryIncident
): DeliveryLockRecoveryRemoteState {
    if (incident.kind === 'rejected-merge') {
        return readRejectedMergeRemoteState(repository, session, primaryRoot, incident);
    }
    return readMissingReceiptRemoteState(repository, session, primaryRoot, incident);
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
    const incident = INCIDENTS.find((candidate) => args[0] === String(candidate.number));
    if (
        args.length !== 3 ||
        incident === undefined ||
        args[1] !== '--owner' ||
        args[2]?.toLowerCase() !== incident.ownerOid
    ) {
        fail(usage);
    }
    return { help: false, number: incident.number, ownerOid: incident.ownerOid };
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

function sameRejectedMergeRemoteState(
    left: RejectedMergeRecoveryRemoteState,
    right: RejectedMergeRecoveryRemoteState
): boolean {
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

function sameIssueCommentObservation(
    left: IssueCommentObservation,
    right: IssueCommentObservation | undefined
): boolean {
    return (
        right !== undefined &&
        left.id === right.id &&
        left.authorNodeId === right.authorNodeId &&
        left.body === right.body
    );
}

function sameMissingReceiptRemoteState(
    left: MissingReceiptRecoveryRemoteState,
    right: MissingReceiptRecoveryRemoteState
): boolean {
    return (
        left.state === right.state &&
        left.head === right.head &&
        left.merged === right.merged &&
        left.comments.length === right.comments.length &&
        left.comments.every((comment, index) => sameIssueCommentObservation(comment, right.comments[index]))
    );
}

function sameRemoteState(left: DeliveryLockRecoveryRemoteState, right: DeliveryLockRecoveryRemoteState): boolean {
    if ('receipt' in left && 'receipt' in right) {
        return sameRejectedMergeRemoteState(left, right);
    }
    if ('merged' in left && 'merged' in right) {
        return sameMissingReceiptRemoteState(left, right);
    }
    return false;
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

export async function runRecoverDeliveryLockCli(
    args: string[],
    dependencies?: DeliveryLockRecoveryDependencies
): Promise<number> {
    const parsed = parseRecoverDeliveryLockArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    const incident = INCIDENTS.find((candidate) => candidate.number === parsed.number);
    if (incident === undefined || parsed.ownerOid !== incident.ownerOid) {
        fail(usage);
    }
    const resolved = resolveDependencies(dependencies);
    const primaryRoot = resolved.trustedLauncher.primaryRoot;
    const ownerOid = resolved.readLockOid(primaryRoot, pullRequestMutationLockRef(incident.number), incident.number);
    if (ownerOid !== incident.ownerOid) {
        fail(`PR #${incident.number} delivery lock owner does not match this recovery incident`);
    }
    const owner = resolved.readLockOwner(primaryRoot, ownerOid, incident.number);
    assertExactOwner(incident, owner);
    if (!resolved.processIsDead(owner.pid)) {
        fail(`PR #${incident.number} delivery lock process is still live or cannot be proven dead`);
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
            fail(`PR #${incident.number} remote state changed during delivery lock recovery`);
        }
        resolved.releaseLock(primaryRoot, incident.number, ownerOid);
        console.log(`delivery-lock-recovered:${incident.number}:${ownerOid}:${after.head}`);
        return 0;
    } finally {
        auth.session.dispose();
    }
}
