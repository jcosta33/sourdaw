#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    REVIEWER_BOT_NODE_ID,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isReviewerBotNodeId,
    originMainBlob,
    resolvePrimaryRoot,
    spawnCapture,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import { parsePrepareReviewArgs, prepareReview, shellPort } from './prepareReview.ts';
import { resolveSemanticReviewContext, shellSemanticReviewContextPort } from './semanticReviewContext.ts';

const ENTRY_PATH = 'scripts/prepareReviewEntry.ts';
const PREPARE_REVIEW_PATH = 'scripts/prepareReview.ts';

async function main(): Promise<number> {
    const parsed = parsePrepareReviewArgs(process.argv.slice(2));
    if (parsed.help) {
        console.log('Usage: pnpm review:prepare <pr-number>');
        return 0;
    }
    if (parsed.number === undefined) {
        fail('usage: pnpm review:prepare <pr-number>');
    }
    const executingFile = fileURLToPath(import.meta.url);
    const cwd = process.cwd();
    // `review:prepare` runs only the default branch's revision of itself: a mutated copy of either
    // the entry or the library it composes must refuse rather than read a head with unverified code.
    assertTrustedExecutingBlob(ENTRY_PATH, executingFile, originMainBlob(ENTRY_PATH, cwd));
    assertTrustedExecutingBlob(
        PREPARE_REVIEW_PATH,
        executingFile,
        originMainBlob(PREPARE_REVIEW_PATH, cwd),
        readFileSync(join(dirname(executingFile), 'prepareReview.ts'), 'utf8')
    );
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'reviewer' });
    try {
        if (!isReviewerBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${REVIEWER_BOT_NODE_ID}`);
        }
        const repository = spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
            env: auth.session.env,
            cwd: primaryRoot,
        });
        assertRequiredRepository(repository);
        const port = {
            ...shellPort(auth.session),
            semanticCiJson: (pr: number, headSha: string): string =>
                JSON.stringify(
                    resolveSemanticReviewContext(
                        pr,
                        headSha,
                        shellSemanticReviewContextPort(auth.session, primaryRoot)
                    ),
                    null,
                    4
                ),
        };
        prepareReview(parsed.number, port);
        return 0;
    } finally {
        auth.session.dispose();
    }
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
