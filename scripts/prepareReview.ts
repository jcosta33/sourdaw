#!/usr/bin/env node
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    GITHUB_HTTPS_REMOTE,
    REQUIRED_REPOSITORY,
    REVIEWER_BOT_NODE_ID,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isReviewerBotNodeId,
    gitAuthenticatedArgs,
    originMainBlob,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export type ReviewPullRequest = {
    number: number;
    title: string;
    body: string | null;
    headRefOid: string;
    baseRefOid: string;
    headRefName: string;
    baseRefName: string;
};

export type PrepareReviewPort = {
    primaryRoot: () => string;
    pullRequest: (number: number) => ReviewPullRequest;
    fetchShas: (baseSha: string, headSha: string) => void;
    diff: (baseSha: string, headSha: string) => string;
    showFile: (sha: string, path: string) => string;
    listDecisionFiles: (sha: string) => string[];
    installBundle: (destination: string, files: Record<string, string>) => void;
    log: (message: string) => void;
};

export function parsePrepareReviewArgs(args: string[]): { number?: number; help: boolean } {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const value = Number(args[0]);
    if (!Number.isSafeInteger(value) || value <= 0 || args.length !== 1) {
        fail('usage: pnpm review:prepare <pr-number>');
    }
    return { number: value, help: false };
}

export function reviewBundlePath(primaryRoot: string, pr: number, headSha: string): string {
    return join(primaryRoot, '.agents', 'review-bundles', `${pr}-${headSha}`);
}

export function prepareReview(number: number, port: PrepareReviewPort): string {
    const pullRequest = port.pullRequest(number);
    port.fetchShas(pullRequest.baseRefOid, pullRequest.headRefOid);
    const agents = port.showFile(pullRequest.baseRefOid, 'AGENTS.md');
    const claude = port.showFile(pullRequest.baseRefOid, 'CLAUDE.md');
    const decisionFiles = port.listDecisionFiles(pullRequest.baseRefOid);
    const files: Record<string, string> = {
        'manifest.json': `${JSON.stringify(
            {
                pr: pullRequest.number,
                baseSha: pullRequest.baseRefOid,
                headSha: pullRequest.headRefOid,
            },
            null,
            4
        )}\n`,
        'diff.patch': port.diff(pullRequest.baseRefOid, pullRequest.headRefOid),
        'pr.md': `# ${pullRequest.title}\n\n${pullRequest.body ?? ''}\n`,
        'contracts/AGENTS.md': agents,
        'contracts/CLAUDE.md': claude,
    };
    for (const path of decisionFiles) {
        files[`contracts/${path}`] = port.showFile(pullRequest.baseRefOid, path);
    }
    const destination = reviewBundlePath(port.primaryRoot(), pullRequest.number, pullRequest.headRefOid);
    port.installBundle(destination, files);
    port.log(destination);
    return destination;
}

export function installBundleAtomically(destination: string, files: Record<string, string>): void {
    const staging = `${destination}.staging-${process.pid}-${Date.now()}`;
    const previous = `${destination}.previous-${process.pid}-${Date.now()}`;
    mkdirSync(staging, { recursive: true });
    try {
        for (const [relative, contents] of Object.entries(files)) {
            const target = join(staging, relative);
            mkdirSync(join(target, '..'), { recursive: true });
            writeFileSync(target, contents);
        }
        try {
            renameSync(destination, previous);
        } catch {
            // Destination did not exist.
        }
        renameSync(staging, destination);
        rmSync(previous, { recursive: true, force: true });
    } catch (error) {
        rmSync(staging, { recursive: true, force: true });
        throw error;
    }
}

export function shellPort(session: GhSession, cwd: string = process.cwd()): PrepareReviewPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const token = session.env.GH_TOKEN ?? '';
    const git = (args: string[]) =>
        spawnCapture('git', gitAuthenticatedArgs(token, session.configDir, args), {
            cwd: primaryRoot,
            env: session.env,
        });
    const gh = (args: string[]) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    return {
        primaryRoot: () => primaryRoot,
        pullRequest: (number) =>
            parseJson<ReviewPullRequest>(
                gh([
                    'pr',
                    'view',
                    String(number),
                    '--repo',
                    REQUIRED_REPOSITORY,
                    '--json',
                    'number,title,body,headRefOid,baseRefOid,headRefName,baseRefName',
                ]),
                `PR #${number}`
            ),
        fetchShas: (baseSha, headSha) => {
            git(['fetch', '--no-write-fetch-head', GITHUB_HTTPS_REMOTE, baseSha, headSha]);
        },
        diff: (baseSha, headSha) =>
            spawnCapture('git', ['diff', `${baseSha}...${headSha}`], {
                cwd: primaryRoot,
                env: session.env,
                trim: false,
            }),
        showFile: (sha, path) =>
            spawnCapture('git', ['show', `${sha}:${path}`], { cwd: primaryRoot, env: session.env, trim: false }),
        listDecisionFiles: (sha) => {
            try {
                return spawnCapture('git', ['ls-tree', '-r', '--name-only', sha, '--', '.agents/decisions'], {
                    cwd: primaryRoot,
                    env: session.env,
                })
                    .split('\n')
                    .filter((path) => path !== '');
            } catch {
                return [];
            }
        },
        installBundle: installBundleAtomically,
        log: (message) => {
            console.log(message);
        },
    };
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
    assertTrustedExecutingBlob(
        'scripts/prepareReview.ts',
        executingFile,
        originMainBlob('scripts/prepareReview.ts', cwd)
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
        prepareReview(parsed.number, shellPort(auth.session));
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
