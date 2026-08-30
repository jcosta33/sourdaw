import {
    AUTHOR_BOT_NODE_ID,
    assertRequiredRepository,
    authenticateRole,
    isAuthorBotNodeId,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import {
    inspectReviewThread,
    recoverPullRequestReviewResolutionLock,
    type ReviewResolutionLockOwner,
    type ReviewThreadInspection,
} from './resolveReviewThread.ts';

export type RecoverReviewResolutionLockArgs = {
    number?: number;
    owner?: string;
    help: boolean;
};

export type ReviewResolutionRecoveryDependencies = {
    trustedPrimaryRoot: () => string;
    authenticateAuthor: (primaryRoot: string) => Promise<{
        minted: { actorNodeId: string };
        session: GhSession;
    }>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    gh: (session: GhSession, primaryRoot: string) => (args: string[]) => string;
    inspectThread: (number: number, threadId: string, gh: (args: string[]) => string) => ReviewThreadInspection;
    recoverLock: <Value>(
        primaryRoot: string,
        number: number,
        expectedOwnerOid: string,
        reconcile: (owner: ReviewResolutionLockOwner) => Value
    ) => Value;
};

const usage = 'usage: pnpm review:resolve:recover <pr-number> --owner <lock-object-id>';

function trustedPrimaryRootFromBootstrap(parent: NodeJS.ProcessEnv = process.env): string {
    const primaryRoot = parent.SOURDAW_TRUSTED_PRIMARY_ROOT;
    const originCommit = parent.SOURDAW_TRUSTED_ORIGIN_COMMIT;
    const gitPath = parent.SOURDAW_TRUSTED_GIT_PATH;
    const ghPath = parent.SOURDAW_TRUSTED_GH_PATH;
    if (
        typeof primaryRoot !== 'string' ||
        primaryRoot.trim() === '' ||
        typeof originCommit !== 'string' ||
        !/^[0-9a-f]{40}$/iu.test(originCommit) ||
        typeof gitPath !== 'string' ||
        gitPath.trim() === '' ||
        typeof ghPath !== 'string' ||
        ghPath.trim() === ''
    ) {
        fail('review:resolve:recover must run through the protected primary checkout launcher');
    }
    return primaryRoot;
}

function defaultRecoveryDependencies(): ReviewResolutionRecoveryDependencies {
    return {
        trustedPrimaryRoot: () => trustedPrimaryRootFromBootstrap(),
        authenticateAuthor: (primaryRoot) => authenticateRole({ primaryRoot, role: 'author' }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        gh: (session, primaryRoot) => (args) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env }),
        inspectThread: inspectReviewThread,
        recoverLock: recoverPullRequestReviewResolutionLock,
    };
}

export function parseRecoverReviewResolutionLockArgs(args: string[]): RecoverReviewResolutionLockArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    if (
        args.length !== 3 ||
        args[1] !== '--owner' ||
        args[0] === undefined ||
        args[2] === undefined ||
        !/^[1-9][0-9]*$/.test(args[0]) ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(args[2])
    ) {
        fail(usage);
    }
    const number = Number(args[0]);
    if (!Number.isSafeInteger(number)) {
        fail(usage);
    }
    return { number, owner: args[2], help: false };
}

function recoverySummary(number: number, owner: ReviewResolutionLockOwner, inspection: ReviewThreadInspection): string {
    if (inspection.thread?.id !== owner.threadId) {
        fail(`review thread ${owner.threadId} was not found on this pull request`);
    }
    const resolutionState = inspection.thread.isResolved ? 'resolved' : 'unresolved';
    return `review-resolution-lock-recovered:${number}:${owner.threadId}:${owner.head}:${inspection.head}:${resolutionState}:${inspection.pendingReviews.length}`;
}

export async function runRecoverReviewResolutionLockCli(
    args: string[],
    dependencies: ReviewResolutionRecoveryDependencies = defaultRecoveryDependencies()
): Promise<number> {
    const parsed = parseRecoverReviewResolutionLockArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.number === undefined || parsed.owner === undefined) {
        fail(usage);
    }

    const primaryRoot = dependencies.trustedPrimaryRoot();
    const auth = await dependencies.authenticateAuthor(primaryRoot);
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
        const gh = dependencies.gh(auth.session, primaryRoot);
        const { owner, inspection } = dependencies.recoverLock(
            primaryRoot,
            parsed.number,
            parsed.owner,
            (lockOwner) => ({
                owner: lockOwner,
                inspection: dependencies.inspectThread(parsed.number!, lockOwner.threadId, gh),
            })
        );
        console.log(recoverySummary(parsed.number, owner, inspection));
        return 0;
    } finally {
        auth.session.dispose();
    }
}
