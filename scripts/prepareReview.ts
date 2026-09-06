#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
    mergeBase: (baseSha: string, headSha: string) => string;
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
    const baseSha = port.mergeBase(pullRequest.baseRefOid, pullRequest.headRefOid);
    const agents = port.showFile(baseSha, 'AGENTS.md');
    const claude = port.showFile(baseSha, 'CLAUDE.md');
    const decisionFiles = port.listDecisionFiles(baseSha);
    const files: Record<string, string> = {
        'diff.patch': port.diff(baseSha, pullRequest.headRefOid),
        'pr.md': `# ${pullRequest.title}\n\n${pullRequest.body ?? ''}\n`,
        'contracts/AGENTS.md': agents,
        'contracts/CLAUDE.md': claude,
    };
    for (const path of decisionFiles) {
        files[`contracts/${path}`] = port.showFile(baseSha, path);
    }
    // The manifest's own `generated` field is derived from the files assembled above, plus itself,
    // so the recorded list always matches what this run actually writes.
    const generated = [...Object.keys(files), 'manifest.json'].sort();
    files['manifest.json'] = `${JSON.stringify(
        {
            pr: pullRequest.number,
            baseSha,
            headSha: pullRequest.headRefOid,
            generated,
        },
        null,
        4
    )}\n`;
    const destination = reviewBundlePath(port.primaryRoot(), pullRequest.number, pullRequest.headRefOid);
    port.installBundle(destination, files);
    port.log(destination);
    return destination;
}

/**
 * The `generated` list a previous install recorded in its own `manifest.json`, or `undefined` when
 * that record is unavailable: no manifest, an unparseable one, one whose `generated` field is
 * missing, or one whose `generated` field holds something other than an array of strings.
 * `undefined` means the previous generated set is unknown, not empty — `preserveCallerFiles` treats
 * those two differently; see its doc comment.
 */
function previousGeneratedSet(destination: string): ReadonlySet<string> | undefined {
    try {
        const manifest = JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8')) as {
            generated?: unknown;
        };
        return Array.isArray(manifest.generated) &&
            manifest.generated.every((entry): entry is string => typeof entry === 'string')
            ? new Set(manifest.generated)
            : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Copies files from `source` into `target`, preserving subdirectories, except files whose relative
 * path is in `generated`. `generated` is the union of what THIS run generates and — when the
 * previous run's own record is known — what THAT run recorded generating: the bundle directory is
 * keyed by head sha, but `contracts/` is derived from the base sha, which is the moving tip of
 * `main`. A file this run does not generate is not necessarily caller-written — it can be an
 * artifact a previous base produced that the current base no longer does, such as a decision file
 * `main` has since deleted. The previous run's own record of what it generated is what tells the two
 * apart; this run's generated set alone cannot, because anything the base stopped producing looks
 * identical to something a caller wrote.
 *
 * `rootOnly` is set whenever that previous record is unknown — no manifest, one predating this
 * field, or one this function cannot parse. Without it, there is no way to tell a caller's file from
 * a stale artifact of a base that has since moved, so classification falls back to position instead
 * of name: the caller writes `review.json` and `discarded.json` beside each other at the bundle
 * root, and every nested path belongs to the script. A nested file is therefore presumed generated
 * and dropped, not carried forward on a guess.
 */
function preserveCallerFiles(
    source: string,
    target: string,
    generated: ReadonlySet<string>,
    rootOnly: boolean,
    prefix = ''
): void {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
        const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        const from = join(source, entry.name);
        if (entry.isDirectory()) {
            if (rootOnly) {
                continue;
            }
            preserveCallerFiles(from, target, generated, rootOnly, relative);
            continue;
        }
        if (generated.has(relative)) {
            continue;
        }
        const to = join(target, relative);
        mkdirSync(join(to, '..'), { recursive: true });
        writeFileSync(to, readFileSync(from));
    }
}

export function isProcessAlive(pid: number): boolean {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

export function sweepStaleBundleSiblings(
    destination: string,
    checkProcessAlive: (pid: number) => boolean = isProcessAlive
): void {
    const parentDir = dirname(destination);
    if (!existsSync(parentDir)) {
        return;
    }
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const match = entry.name.match(/\.(?:staging|previous)-(\d+)-\d+$/);
        if (!match) {
            continue;
        }
        const pid = Number(match[1]);
        if (!checkProcessAlive(pid)) {
            try {
                rmSync(join(parentDir, entry.name), { recursive: true, force: true });
            } catch {
                // Ignore cleanup race if concurrently removed.
            }
        }
    }
}

/**
 * Preservation reads directly from the live `destination` before either rename, so a failure there
 * leaves `destination` exactly as it was — it was never touched. That makes the swap itself two
 * adjacent renames with nothing between them, the same shape the base had before this function
 * existed: no window where the bundle directory is provably absent, and no rollback branch to keep
 * correct, because none is reachable.
 */
export function installBundleAtomically(
    destination: string,
    files: Record<string, string>,
    checkProcessAlive?: (pid: number) => boolean
): void {
    sweepStaleBundleSiblings(destination, checkProcessAlive);
    const staging = `${destination}.staging-${process.pid}-${Date.now()}`;
    const previous = `${destination}.previous-${process.pid}-${Date.now()}`;
    mkdirSync(staging, { recursive: true });
    try {
        for (const [relative, contents] of Object.entries(files)) {
            const target = join(staging, relative);
            mkdirSync(join(target, '..'), { recursive: true });
            writeFileSync(target, contents);
        }
        if (existsSync(destination)) {
            const previousGenerated = previousGeneratedSet(destination);
            const generated = new Set([...(previousGenerated ?? []), ...Object.keys(files)]);
            preserveCallerFiles(destination, staging, generated, previousGenerated === undefined);
            renameSync(destination, previous);
            renameSync(staging, destination);
            rmSync(previous, { recursive: true, force: true });
        } else {
            renameSync(staging, destination);
        }
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
        mergeBase: (baseSha, headSha) =>
            spawnCapture('git', ['merge-base', baseSha, headSha], {
                cwd: primaryRoot,
                env: session.env,
            }),
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
