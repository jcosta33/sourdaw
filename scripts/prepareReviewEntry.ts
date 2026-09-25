#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
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
import { snapshotImportSpecifiers } from './trustedGithubWriteBootstrap.ts';

function localImportClosure(entryFile: string, readFile: (path: string) => string): readonly string[] {
    const closure = new Set<string>();
    const pending = [entryFile];
    while (pending.length > 0) {
        const path = pending.pop();
        if (path === undefined || closure.has(path)) {
            continue;
        }
        closure.add(path);
        const source = readFile(path);
        for (const specifier of snapshotImportSpecifiers(source)) {
            if (specifier.startsWith('.')) {
                pending.push(join(dirname(path), specifier));
            }
        }
    }
    return [...closure].sort();
}

/**
 * The repository-relative local-import closure of the entry: the entry, its direct imports, and
 * every module they import transitively. This set is asserted against origin/main before the record
 * is produced; the check runs after the entry's module graph is evaluated, so it guards the closure
 * modules' behaviour, not their import-time side effects.
 */
export function trustedExecutingPaths(
    executingFile: string,
    readFile: (path: string) => string = (path) => readFileSync(path, 'utf8')
): readonly string[] {
    const repositoryRoot = dirname(dirname(executingFile));
    return localImportClosure(executingFile, readFile).map((path) => relative(repositoryRoot, path));
}

export type TrustedExecutingBlob = {
    readonly path: string;
    readonly originBlob: string | undefined;
    readonly source: string;
};

export function assertTrustedExecutingBlobs(blobs: readonly TrustedExecutingBlob[]): void {
    const paths = new Set(blobs.map((blob) => blob.path));
    for (const blob of blobs) {
        if (blob.originBlob === undefined) {
            throw new Error(`${blob.path} has no blob on origin/main; refusing to run an unverifiable copy`);
        }
        assertTrustedExecutingBlob(blob.path, blob.path, blob.originBlob, blob.source);
        for (const specifier of snapshotImportSpecifiers(blob.source)) {
            if (!specifier.startsWith('.')) {
                continue;
            }
            const resolved = join(dirname(blob.path), specifier);
            if (!paths.has(resolved)) {
                throw new Error(`${blob.path} imports unlisted local dependency ${resolved}`);
            }
        }
    }
}

export function collectTrustedExecutingBlobs(
    executingFile: string,
    cwd: string,
    readFile: (path: string) => string = (path) => readFileSync(path, 'utf8')
): readonly TrustedExecutingBlob[] {
    const repositoryRoot = dirname(dirname(executingFile));
    return trustedExecutingPaths(executingFile, readFile).map((path) => ({
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
    // `review:prepare` runs only the default branch's revision of the closure it composes: before the
    // record is written, a drifted copy of any asserted file refuses. The check runs after the module
    // graph is evaluated, so it guards the modules' behaviour, not their import-time side effects.
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
