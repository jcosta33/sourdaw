#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_NODE_ID,
    assertRequiredRepository,
    authenticateRole,
    isAuthorBotNodeId,
    resolvePrimaryRoot,
    spawnCapture,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import {
    inspectReviewThread,
    recoverPullRequestReviewResolutionLock,
    type ReviewThreadInspection,
} from './resolveReviewThread.ts';

export type RecoverReviewResolutionLockArgs = {
    number?: number;
    threadId?: string;
    owner?: string;
    help: boolean;
};

const usage =
    'usage: pnpm review:resolve:recover <pr-number> --thread <graphql-thread-node-id> --owner <lock-object-id>';

export function parseRecoverReviewResolutionLockArgs(args: string[]): RecoverReviewResolutionLockArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    if (
        args.length !== 5 ||
        args[1] !== '--thread' ||
        args[3] !== '--owner' ||
        args[0] === undefined ||
        args[2] === undefined ||
        args[4] === undefined ||
        !/^[1-9][0-9]*$/.test(args[0]) ||
        !/^\S+$/.test(args[2]) ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(args[4])
    ) {
        fail(usage);
    }
    const number = Number(args[0]);
    if (!Number.isSafeInteger(number)) {
        fail(usage);
    }
    return { number, threadId: args[2], owner: args[4], help: false };
}

function recoverySummary(number: number, threadId: string, inspection: ReviewThreadInspection): string {
    if (inspection.thread?.id !== threadId) {
        fail(`review thread ${threadId} was not found on this pull request`);
    }
    const resolutionState = inspection.thread.isResolved ? 'resolved' : 'unresolved';
    return `review-resolution-lock-recovered:${number}:${threadId}:${inspection.head}:${resolutionState}:${inspection.pendingReviews.length}`;
}

export async function runRecoverReviewResolutionLockCli(args: string[]): Promise<number> {
    const parsed = parseRecoverReviewResolutionLockArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.number === undefined || parsed.threadId === undefined || parsed.owner === undefined) {
        fail(usage);
    }

    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'author' });
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        assertRequiredRepository(
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: auth.session.env,
                cwd: primaryRoot,
            })
        );
        const gh = (ghArgs: string[]) => spawnCapture('gh', ghArgs, { cwd: primaryRoot, env: auth.session.env });
        const inspection = recoverPullRequestReviewResolutionLock(primaryRoot, parsed.number, parsed.owner, () =>
            inspectReviewThread(parsed.number!, parsed.threadId!, gh)
        );
        console.log(recoverySummary(parsed.number, parsed.threadId, inspection));
        return 0;
    } finally {
        auth.session.dispose();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void runRecoverReviewResolutionLockCli(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
