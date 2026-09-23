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

/**
 * The modules the entry composes at runtime — its own file, its direct local imports, and the
 * resolver's own local imports — resolved as repository paths and asserted against origin/main so a
 * drifted copy of any of them refuses. A path the default branch does not hold is refused too: the
 * assertion must never be vacuous about a module it names.
 */
export const TRUSTED_EXECUTING_PATHS = [
    'scripts/prepareReviewEntry.ts',
    'scripts/githubAppIdentity.ts',
    'scripts/prContract.ts',
    'scripts/prepareReview.ts',
    'scripts/semanticReviewContext.ts',
    'scripts/semanticReview/contracts.ts',
    'scripts/semanticReview/report.ts',
    'scripts/semanticReviewWorkflowContract.ts',
] as const;

export type TrustedExecutingBlob = {
    readonly path: string;
    readonly originBlob: string | undefined;
    readonly source: string;
};

export function assertTrustedExecutingBlobs(blobs: readonly TrustedExecutingBlob[]): void {
    for (const blob of blobs) {
        if (blob.originBlob === undefined) {
            throw new Error(`${blob.path} has no blob on origin/main; refusing to run an unverifiable copy`);
        }
        assertTrustedExecutingBlob(blob.path, blob.path, blob.originBlob, blob.source);
    }
}

export function collectTrustedExecutingBlobs(
    executingFile: string,
    cwd: string,
    readFile: (path: string) => string = (path) => readFileSync(path, 'utf8')
): readonly TrustedExecutingBlob[] {
    const repositoryRoot = dirname(dirname(executingFile));
    return TRUSTED_EXECUTING_PATHS.map((path) => ({
        path,
        originBlob: originMainBlob(path, cwd),
        source: readFile(join(repositoryRoot, path)),
    }));
}

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
    // `review:prepare` runs only the default branch's revision of itself and of the resolver it
    // composes: a drifted copy of any asserted file must refuse rather than write a forged record.
    assertTrustedExecutingBlobs(collectTrustedExecutingBlobs(executingFile, cwd));
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
