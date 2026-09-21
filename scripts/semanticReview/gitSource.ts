/**
 * Git-object reads and revision resolution for the semantic-review command.
 *
 * Source is read as data. Nothing here checks out a tree, executes repository tooling, initialises
 * submodules, or runs source-controlled programs, and every git invocation passes an argument array
 * with external diff drivers and text conversion disabled.
 *
 * The reviewed branch is never checked out. `mergeBaseSha` and `targetBaseSha` are resolved
 * separately: the bundle's `baseSha` is a merge base, and the base branch tip is a different commit.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';

import { REQUIRED_REPOSITORY, spawnCapture } from '../githubAppIdentity.ts';
import { changedReviewPaths } from '../reviewDiffSummary.ts';

import { refuse, type SemanticRevisionBase } from './contracts.ts';

import type { LineRange, PathHunks, SemanticChangedFile, SemanticSourcePort } from './evidence.ts';

const GIT_HARDENING = ['-c', 'core.safecrlf=false', '-c', 'diff.external='] as const;

function git(args: readonly string[], cwd: string, trim = true): string {
    return spawnCapture('git', [...GIT_HARDENING, ...args], { cwd, trim });
}

function gitOrUndefined(args: readonly string[], cwd: string): string | undefined {
    try {
        return git(args, cwd, false);
    } catch {
        return undefined;
    }
}

function assertSafeRepoPath(path: string): void {
    if (path === '' || isAbsolute(path)) {
        refuse('unsupported_scope', `refusing an absolute or empty source path: ${path}`);
    }
    const normalised = normalize(path);
    if (normalised.startsWith('..') || normalised.includes('/../')) {
        refuse('unsupported_scope', `refusing a source path that escapes the repository: ${path}`);
    }
}

type NameStatus = { readonly kind: SemanticChangedFile['kind']; readonly previousPath?: string };

/** The `git diff --name-status` letter mapped to this module's change kind. */
function changeKindFor(status: string): SemanticChangedFile['kind'] {
    if (status.startsWith('A')) {
        return 'added';
    }
    if (status.startsWith('D')) {
        return 'deleted';
    }
    return 'modified';
}

export function parseNameStatus(raw: string): Map<string, NameStatus> {
    const fields = raw.split('\0');
    const result = new Map<string, NameStatus>();
    let index = 0;
    while (index < fields.length) {
        const status = fields[index];
        if (status === undefined || status === '') {
            break;
        }
        index += 1;
        const first = fields[index];
        if (first === undefined || first === '') {
            break;
        }
        index += 1;
        if (status.startsWith('R') || status.startsWith('C')) {
            const second = fields[index];
            // A rename record whose second path is absent is truncated; an empty path is never a change.
            if (second === undefined || second === '') {
                break;
            }
            index += 1;
            result.set(second, { kind: 'renamed', previousPath: first });
            continue;
        }
        result.set(first, { kind: changeKindFor(status) });
    }
    return result;
}

/** The margin of unchanged lines carried either side of a change, so a hunk can be read in place. */
const HUNK_CONTEXT_LINES = 6;

/** The path a `---`/`+++` header names, or `undefined` for `/dev/null` and for a quoted empty name. */
function diffHeaderPath(header: string): string | undefined {
    const trimmed = header.replace(/\t.*$/u, '').trim();
    if (trimmed === '/dev/null' || trimmed === '') {
        return undefined;
    }
    const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
    return unquoted.replace(/^[ab]\//u, '');
}

/**
 * The changed line ranges of every path in one unified diff, keyed by the post-change path.
 *
 * Line numbers come from the source processing, never from a model, and the range a hunk names already
 * includes the margin the diff was taken at.
 */
export function parseUnifiedDiffRanges(raw: string): Map<string, PathHunks> {
    const result = new Map<string, PathHunks>();
    let previousPath: string | undefined;
    let current: { path: string; previousPath?: string; before: LineRange[]; after: LineRange[] } | undefined;
    for (const line of raw.split('\n')) {
        if (line.startsWith('--- ')) {
            previousPath = diffHeaderPath(line.slice(4));
            continue;
        }
        if (line.startsWith('+++ ')) {
            const path = diffHeaderPath(line.slice(4)) ?? previousPath;
            if (path === undefined) {
                current = undefined;
                continue;
            }
            current = { path, before: [], after: [] };
            if (previousPath !== undefined && previousPath !== path) {
                current.previousPath = previousPath;
            }
            result.set(path, current);
            continue;
        }
        if (current === undefined || !line.startsWith('@@')) {
            continue;
        }
        const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
        if (match === null) {
            continue;
        }
        const beforeStart = Number(match[1]);
        const beforeCount = match[2] === undefined ? 1 : Number(match[2]);
        const afterStart = Number(match[3]);
        const afterCount = match[4] === undefined ? 1 : Number(match[4]);
        if (beforeCount > 0) {
            current.before.push({ startLine: beforeStart, endLine: beforeStart + beforeCount - 1 });
        }
        if (afterCount > 0) {
            current.after.push({ startLine: afterStart, endLine: afterStart + afterCount - 1 });
        }
    }
    return result;
}

export function createGitSourcePort(primaryRoot: string): SemanticSourcePort {
    return {
        changedFiles: (mergeBaseSha, headSha) => {
            const numstat = git(
                ['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', `${mergeBaseSha}...${headSha}`],
                primaryRoot,
                false
            );
            const nameStatus = git(
                ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', `${mergeBaseSha}...${headSha}`],
                primaryRoot,
                false
            );
            const statuses = parseNameStatus(nameStatus);
            return changedReviewPaths(primaryRoot, Buffer.from(numstat)).map((entry) => {
                const status = statuses.get(entry.path);
                return {
                    path: entry.path,
                    previousPath: status?.previousPath,
                    kind: status?.kind ?? 'modified',
                    binary: entry.binary,
                    generated: entry.group === 'generated',
                    added: entry.added,
                    deleted: entry.deleted,
                };
            });
        },
        readFile: (sha, path) => {
            assertSafeRepoPath(path);
            const text = gitOrUndefined(['show', `${sha}:${path}`], primaryRoot);
            return text;
        },
        changedHunks: (mergeBaseSha, headSha) => {
            // One diff for the whole change, at a fixed margin: the ranges it names are the regions.
            const raw = git(
                [
                    'diff',
                    '--no-ext-diff',
                    '--no-textconv',
                    '--no-color',
                    '-M',
                    `--unified=${String(HUNK_CONTEXT_LINES)}`,
                    `${mergeBaseSha}...${headSha}`,
                ],
                primaryRoot,
                false
            );
            return parseUnifiedDiffRanges(raw);
        },
    };
}

function ensureObjectsPresent(primaryRoot: string, shas: readonly string[]): void {
    for (const sha of shas) {
        try {
            git(['cat-file', '-e', `${sha}^{commit}`], primaryRoot);
            continue;
        } catch {
            try {
                git(['fetch', '--no-write-fetch-head', 'origin', sha], primaryRoot);
            } catch {
                refuse('context_collection_failed', `could not obtain revision ${sha} as a Git object`);
            }
        }
    }
}

/**
 * The revision supplying the executable review code.
 *
 * CI passes the commit it actually checked out, because in a `pull_request_target` run `origin/main`
 * can advance past the checked-out tree; recording the branch tip instead of the tree that ran would
 * make `trustedExecutionSha` a claim the run cannot support. Locally the branch tip is the checked-out
 * tree, so it is the right default.
 */
function resolveTrustedExecutionSha(primaryRoot: string, override?: string): string {
    if (override !== undefined) {
        if (!/^[0-9a-f]{40}$/u.test(override)) {
            refuse('unsupported_scope', '--trusted-sha must be a full 40-hex commit sha');
        }
        return override;
    }
    const sha = gitOrUndefined(['rev-parse', 'origin/main'], primaryRoot)?.trim();
    if (sha === undefined || sha === '') {
        refuse('context_collection_failed', 'could not resolve origin/main as the trusted execution revision');
    }
    return sha;
}

function resolveRepositoryId(primaryRoot: string, pr: number | undefined): string {
    if (pr !== undefined) {
        try {
            const id = spawnCapture('gh', ['api', `repos/${REQUIRED_REPOSITORY}`, '--jq', '.id'], {
                cwd: primaryRoot,
            }).trim();
            if (id !== '') {
                return id;
            }
        } catch {
            // Fall through to the remote-derived identity below.
        }
    }
    const remote = gitOrUndefined(['remote', 'get-url', 'origin'], primaryRoot)?.trim();
    if (remote === undefined || remote === '') {
        refuse('context_collection_failed', 'could not resolve the origin remote for repository identity');
    }
    return remote;
}

export type ResolvedRevision = {
    readonly revision: SemanticRevisionBase;
    readonly headSha: string;
    readonly mergeBaseSha: string;
};

export function resolveFromPullRequest(primaryRoot: string, pr: number, trustedSha?: string): ResolvedRevision {
    const raw = spawnCapture(
        'gh',
        [
            'pr',
            'view',
            String(pr),
            '--repo',
            REQUIRED_REPOSITORY,
            '--json',
            'number,headRefOid,baseRefOid,headRefName,baseRefName,state',
        ],
        { cwd: primaryRoot }
    );
    const view = JSON.parse(raw) as {
        number: number;
        headRefOid: string;
        baseRefOid: string;
        baseRefName: string;
        state: string;
    };
    if (view.state !== 'OPEN') {
        refuse('stale_context', `PR #${String(pr)} is ${view.state}; refusing to assess a closed change`);
    }
    ensureObjectsPresent(primaryRoot, [view.baseRefOid, view.headRefOid]);
    const mergeBase = git(['merge-base', view.baseRefOid, view.headRefOid], primaryRoot);
    return {
        headSha: view.headRefOid,
        mergeBaseSha: mergeBase,
        revision: {
            repository: REQUIRED_REPOSITORY,
            repositoryId: resolveRepositoryId(primaryRoot, pr),
            prNumber: pr,
            headSha: view.headRefOid,
            // The base branch tip as captured now, distinct from the merge base below.
            targetBaseSha: view.baseRefOid,
            mergeBaseSha: mergeBase,
            trustedExecutionSha: resolveTrustedExecutionSha(primaryRoot, trustedSha),
            contractSourceSha: mergeBase,
        },
    };
}

export function resolveFromBundle(primaryRoot: string, bundlePath: string, trustedSha?: string): ResolvedRevision {
    const manifestPath = join(bundlePath, 'manifest.json');
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    } catch {
        refuse('unsupported_scope', `no readable review bundle manifest at ${manifestPath}`);
    }
    if (typeof parsed !== 'object' || parsed === null) {
        refuse('unsupported_scope', `review bundle manifest at ${manifestPath} is not an object`);
    }
    const manifest = parsed as Record<string, unknown>;
    const headSha = typeof manifest.headSha === 'string' ? manifest.headSha : undefined;
    const baseSha = typeof manifest.baseSha === 'string' ? manifest.baseSha : undefined;
    const pr = typeof manifest.pr === 'number' ? manifest.pr : undefined;
    if (headSha === undefined || baseSha === undefined) {
        refuse('unsupported_scope', `review bundle manifest at ${manifestPath} lacks head or base identity`);
    }
    ensureObjectsPresent(primaryRoot, [baseSha, headSha]);
    let targetBaseSha = baseSha;
    if (pr !== undefined) {
        try {
            const live = spawnCapture(
                'gh',
                ['pr', 'view', String(pr), '--repo', REQUIRED_REPOSITORY, '--json', 'baseRefOid'],
                { cwd: primaryRoot }
            );
            const baseRefOid = (JSON.parse(live) as { baseRefOid?: string }).baseRefOid;
            if (typeof baseRefOid === 'string' && baseRefOid !== '') {
                targetBaseSha = baseRefOid;
            }
        } catch {
            // The bundle's merge base stands in; the report records what was actually captured.
        }
    }
    return {
        headSha,
        mergeBaseSha: baseSha,
        revision: {
            repository: REQUIRED_REPOSITORY,
            repositoryId: resolveRepositoryId(primaryRoot, pr),
            prNumber: pr,
            headSha,
            targetBaseSha,
            mergeBaseSha: baseSha,
            trustedExecutionSha: resolveTrustedExecutionSha(primaryRoot, trustedSha),
            contractSourceSha: baseSha,
        },
    };
}

export function resolveFromRefs(
    primaryRoot: string,
    base: string,
    head: string,
    trustedSha?: string
): ResolvedRevision {
    const headSha = git(['rev-parse', head], primaryRoot);
    const targetBaseSha = git(['rev-parse', base], primaryRoot);
    if (headSha === targetBaseSha) {
        refuse('unsupported_scope', 'base and head resolve to the same commit; there is no change to assess');
    }
    ensureObjectsPresent(primaryRoot, [targetBaseSha, headSha]);
    const mergeBase = git(['merge-base', targetBaseSha, headSha], primaryRoot);
    return {
        headSha,
        mergeBaseSha: mergeBase,
        revision: {
            repository: REQUIRED_REPOSITORY,
            repositoryId: resolveRepositoryId(primaryRoot, undefined),
            headSha,
            targetBaseSha,
            mergeBaseSha: mergeBase,
            trustedExecutionSha: resolveTrustedExecutionSha(primaryRoot, trustedSha),
            contractSourceSha: mergeBase,
        },
    };
}

/**
 * The API key comes from the environment, or from a primary-root gitignored dotenv file. It is never
 * printed, never written into a report, and never placed in a cache key.
 */
