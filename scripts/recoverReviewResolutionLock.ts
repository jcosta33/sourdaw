import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_NODE_ID,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isAuthorBotNodeId,
    originMainBlob,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import {
    REVIEW_RESOLUTION_CHILD_ENV,
    assertRecoverableReviewResolutionLockOwner,
    assertDetachedReviewResolutionChild,
    assertTrustedReviewResolutionLauncher,
    inspectReviewThread,
    requiredTrustedReviewResolutionOriginCommit,
    recoverReviewResolutionLockOwnerState,
    reviewResolutionRecoveryResult,
    recoverPullRequestReviewResolutionLock,
    runDetachedReviewResolutionWorker,
    shellPort,
    type ResolveReviewThreadPort,
    type ReviewResolutionRecoveryClock,
    type ReviewResolutionTrustedLauncher,
    type ReviewResolutionLockOwner,
    type ReviewResolutionRecoveryResult,
    type ReviewThreadInspection,
} from './resolveReviewThread.ts';

export type RecoverReviewResolutionLockArgs = {
    number?: number;
    owner?: string;
    help: boolean;
};

export type ReviewResolutionRecoveryDependencies = {
    trustedLauncher?: ReviewResolutionTrustedLauncher;
    trustedPrimaryRoot?: () => string;
    authenticateAuthor?: (primaryRoot: string) => Promise<{
        minted: { actorNodeId: string };
        session: GhSession;
    }>;
    repositoryName?: (session: GhSession, primaryRoot: string) => string;
    gh?: (session: GhSession, primaryRoot: string) => (args: string[]) => string;
    inspectThread?: (number: number, threadId: string, gh: (args: string[]) => string) => ReviewThreadInspection;
    createPort?: (
        session: GhSession,
        primaryRoot: string,
        inspectThread: (number: number, threadId: string, gh: (args: string[]) => string) => ReviewThreadInspection,
        gh: (args: string[]) => string
    ) => ResolveReviewThreadPort;
    clock?: ReviewResolutionRecoveryClock;
    recoverLock?: <Value>(
        primaryRoot: string,
        number: number,
        expectedOwnerOid: string,
        reconcile: (owner: ReviewResolutionLockOwner) => Value
    ) => Value;
};
type ResolvedReviewResolutionRecoveryDependencies = {
    trustedLauncher?: ReviewResolutionTrustedLauncher;
    trustedPrimaryRoot: () => string;
    authenticateAuthor: (primaryRoot: string) => Promise<{
        minted: { actorNodeId: string };
        session: GhSession;
    }>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    gh: (session: GhSession, primaryRoot: string) => (args: string[]) => string;
    inspectThread: (number: number, threadId: string, gh: (args: string[]) => string) => ReviewThreadInspection;
    createPort: (
        session: GhSession,
        primaryRoot: string,
        inspectThread: (number: number, threadId: string, gh: (args: string[]) => string) => ReviewThreadInspection,
        gh: (args: string[]) => string
    ) => ResolveReviewThreadPort;
    clock: ReviewResolutionRecoveryClock;
    recoverLock: <Value>(
        primaryRoot: string,
        number: number,
        expectedOwnerOid: string,
        reconcile: (owner: ReviewResolutionLockOwner) => Value
    ) => Value;
};

const usage = 'usage: pnpm review:resolve:recover <pr-number> --owner <lock-object-id>';

function resolveRecoveryDependencies(
    dependencies: ReviewResolutionRecoveryDependencies | undefined
): ResolvedReviewResolutionRecoveryDependencies {
    if (dependencies === undefined) {
        fail('review:resolve:recover must run through the protected primary checkout launcher');
    }
    const trustedLauncher =
        dependencies.trustedLauncher === undefined
            ? undefined
            : assertTrustedReviewResolutionLauncher(
                  dependencies.trustedLauncher,
                  'review:resolve:recover must run through the protected primary checkout launcher'
              );
    return {
        trustedLauncher,
        trustedPrimaryRoot:
            dependencies.trustedPrimaryRoot ??
            (() => {
                if (trustedLauncher === undefined) {
                    fail('review:resolve:recover must run through the protected primary checkout launcher');
                }
                return trustedLauncher.primaryRoot;
            }),
        authenticateAuthor:
            dependencies.authenticateAuthor ?? ((primaryRoot) => authenticateRole({ primaryRoot, role: 'author' })),
        repositoryName:
            dependencies.repositoryName ??
            ((session, primaryRoot) =>
                spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                    env: session.env,
                    cwd: primaryRoot,
                })),
        gh:
            dependencies.gh ??
            ((session, primaryRoot) => (args) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env })),
        inspectThread: dependencies.inspectThread ?? inspectReviewThread,
        createPort:
            dependencies.createPort ??
            ((session, primaryRoot, inspectThread, gh) => ({
                ...shellPort(session, primaryRoot),
                inspect: (number, threadId) => inspectThread(number, threadId, gh),
            })),
        clock: dependencies.clock ?? { now: () => Date.now() },
        recoverLock: dependencies.recoverLock ?? recoverPullRequestReviewResolutionLock,
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
    return { number, owner: args[2].toLowerCase(), help: false };
}

function recoverySummary(
    number: number,
    owner: ReviewResolutionLockOwner,
    result: ReviewResolutionRecoveryResult,
    port: ResolveReviewThreadPort
): string {
    const inspection = result.inspection;
    assertRecoverableReviewResolutionLockOwner(number, owner, inspection, port);
    const thread = inspection.thread;
    if (thread === null) {
        fail(`review thread ${owner.threadId} was not found on this pull request`);
    }
    const resolutionState = thread.isResolved ? 'resolved' : 'unresolved';
    return `review-resolution-lock-recovered:${number}:${owner.threadId}:${owner.head}:${inspection.head}:${resolutionState}:${inspection.pendingReviews.length}`;
}

async function runRecoverReviewResolutionLockCliResolved(
    parsed: RecoverReviewResolutionLockArgs,
    resolvedDependencies: ResolvedReviewResolutionRecoveryDependencies
): Promise<number> {
    if (parsed.number === undefined || parsed.owner === undefined) {
        fail(usage);
    }
    const primaryRoot = resolvedDependencies.trustedPrimaryRoot();
    const auth = await resolvedDependencies.authenticateAuthor(primaryRoot);
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        assertRequiredRepository(resolvedDependencies.repositoryName(auth.session, primaryRoot));
        const gh = resolvedDependencies.gh(auth.session, primaryRoot);
        const port = resolvedDependencies.createPort(auth.session, primaryRoot, resolvedDependencies.inspectThread, gh);
        const summary = resolvedDependencies.recoverLock(primaryRoot, parsed.number, parsed.owner, (lockOwner) => {
            return recoverySummary(
                parsed.number!,
                lockOwner,
                reviewResolutionRecoveryResult(
                    lockOwner,
                    recoverReviewResolutionLockOwnerState(parsed.number!, lockOwner, port, resolvedDependencies.clock)
                ),
                port
            );
        });
        console.log(summary);
        return 0;
    } finally {
        auth.session.dispose();
    }
}

export async function runRecoverReviewResolutionLockCli(
    args: string[],
    dependencies?: ReviewResolutionRecoveryDependencies
): Promise<number> {
    const parsed = parseRecoverReviewResolutionLockArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.number === undefined || parsed.owner === undefined) {
        fail(usage);
    }
    const childMarker = process.env[REVIEW_RESOLUTION_CHILD_ENV];
    if (childMarker === undefined) {
        const resolvedDependencies = resolveRecoveryDependencies(dependencies);
        if (resolvedDependencies.trustedLauncher !== undefined) {
            return await runDetachedReviewResolutionWorker(
                fileURLToPath(import.meta.url),
                args,
                resolvedDependencies.trustedLauncher
            );
        }
        return await runRecoverReviewResolutionLockCliResolved(parsed, resolvedDependencies);
    }
    const trustedLauncher = await assertDetachedReviewResolutionChild(childMarker);
    const trustedOriginCommit = requiredTrustedReviewResolutionOriginCommit(
        'review:resolve:recover must run through the protected primary checkout launcher'
    );
    assertTrustedExecutingBlob(
        'scripts/recoverReviewResolutionLock.ts',
        fileURLToPath(import.meta.url),
        originMainBlob(
            'scripts/recoverReviewResolutionLock.ts',
            process.cwd(),
            undefined,
            undefined,
            trustedOriginCommit
        )
    );
    return await runRecoverReviewResolutionLockCliResolved(
        parsed,
        resolveRecoveryDependencies({ ...(dependencies ?? {}), trustedLauncher })
    );
}

async function main(): Promise<number> {
    return await runRecoverReviewResolutionLockCli(process.argv.slice(2));
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
