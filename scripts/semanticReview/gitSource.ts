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

import type { ChangedSourceLine, PathChangedLines } from './changeFacts.ts';
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
            // A rename or copy record whose second path is absent is truncated; an empty path is never
            // a change.
            if (second === undefined || second === '') {
                break;
            }
            index += 1;
            const kind = status.startsWith('C') ? 'copied' : 'renamed';
            result.set(second, { kind, previousPath: first });
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
 * One path's parsed diff: the hunk ranges both sides are sliced at, and the added and removed lines the
 * change facts are classified from. It is one parse and not two because the ranges and the lines have to
 * describe the same diff: a hunk range read from one parse and lines from another could disagree about
 * which hunk sits where, and the facts would then name lines the request never carried.
 */
type ParsedPathDiff = {
    readonly path: string;
    previousPath?: string;
    readonly before: LineRange[];
    readonly after: LineRange[];
    readonly added: ChangedSourceLine[];
    readonly removed: ChangedSourceLine[];
};

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

/** The line counters of one hunk body, advanced by the one function that reads a body line. */
type HunkBody = {
    remainingBefore: number;
    remainingAfter: number;
    beforeLine: number;
    afterLine: number;
};

/**
 * Records one line of an open hunk body. Returns false when the line is not a body line of an open hunk,
 * which ends the body early so a malformed or truncated hunk cannot swallow the headers that follow it.
 *
 * A hunk's declared counts decide where its body ends, not the `-`/`+`/`@@` shape of a line: a removed line
 * whose own text begins with `-- ` arrives as `--- …` and is a body line while the counts still owe one,
 * never a file header.
 */
function recordBodyLine(line: string, target: ParsedPathDiff | undefined, body: HunkBody): boolean {
    if (body.remainingBefore <= 0 && body.remainingAfter <= 0) {
        return false;
    }
    if (line.startsWith('+')) {
        target?.added.push({ line: body.afterLine, text: line.slice(1) });
        body.afterLine += 1;
        body.remainingAfter -= 1;
        return true;
    }
    if (line.startsWith('-')) {
        target?.removed.push({ line: body.beforeLine, text: line.slice(1) });
        body.beforeLine += 1;
        body.remainingBefore -= 1;
        return true;
    }
    if (line.startsWith(' ')) {
        body.beforeLine += 1;
        body.afterLine += 1;
        body.remainingBefore -= 1;
        body.remainingAfter -= 1;
        return true;
    }
    // Any other line ends the body, so a truncated hunk cannot swallow the headers that follow it: the
    // next `--- `/`+++ ` pair would otherwise be read as a removed line while the counts still owed one.
    // The `\ No newline at end of file` marker is the exception: it carries no line of its own, and the
    // body stays open across it.
    if (line.startsWith('\\')) {
        return true;
    }
    body.remainingBefore = 0;
    body.remainingAfter = 0;
    return false;
}

/**
 * The changed line ranges and changed lines of every path in one unified diff, keyed by the post-change
 * path.
 *
 * Line numbers come from the source processing, never from a model, and the range a hunk names already
 * includes the margin the diff was taken at.
 */
function parseUnifiedDiff(raw: string): Map<string, ParsedPathDiff> {
    const result = new Map<string, ParsedPathDiff>();
    let previousPath: string | undefined;
    let current: ParsedPathDiff | undefined;
    const body: HunkBody = { remainingBefore: 0, remainingAfter: 0, beforeLine: 0, afterLine: 0 };
    for (const line of raw.split('\n')) {
        if (recordBodyLine(line, current, body)) {
            continue;
        }
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
            current = { path, before: [], after: [], added: [], removed: [] };
            if (previousPath !== undefined && previousPath !== path) {
                current.previousPath = previousPath;
            }
            result.set(path, current);
            continue;
        }
        if (current === undefined || !line.startsWith('@@')) {
            continue;
        }
        const match = HUNK_HEADER_PATTERN.exec(line);
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
        body.remainingBefore = beforeCount;
        body.remainingAfter = afterCount;
        body.beforeLine = beforeStart;
        body.afterLine = afterStart;
    }
    return result;
}

/**
 * The changed line ranges of every path in one unified diff, keyed by the post-change path.
 *
 * Line numbers come from the source processing, never from a model, and the range a hunk names already
 * includes the margin the diff was taken at.
 */
export function parseUnifiedDiffRanges(raw: string): Map<string, PathHunks> {
    const result = new Map<string, PathHunks>();
    for (const [path, parsed] of parseUnifiedDiff(raw)) {
        // A path with no previous name carries no `previousPath` key at all: the shape a caller compares
        // against must not gain an undefined field from the shared parser's own record.
        if (parsed.previousPath === undefined) {
            result.set(path, { path: parsed.path, before: parsed.before, after: parsed.after });
            continue;
        }
        result.set(path, {
            path: parsed.path,
            previousPath: parsed.previousPath,
            before: parsed.before,
            after: parsed.after,
        });
    }
    return result;
}

/** The added and removed lines of every path in one unified diff, keyed by the post-change path. */
export function parseChangedLines(raw: string): Map<string, PathChangedLines> {
    const result = new Map<string, PathChangedLines>();
    for (const [path, parsed] of parseUnifiedDiff(raw)) {
        result.set(path, { added: parsed.added, removed: parsed.removed });
    }
    return result;
}

/**
 * One diff for the whole change, at a fixed margin: the ranges it names are the regions and the lines it
 * names are the change facts. Both reads issue this same command, so a diff read one way can never come
 * from a different revision pair, rename detection, or margin than the same diff read the other way.
 */
function readChangeDiff(primaryRoot: string, mergeBaseSha: string, headSha: string): string {
    return git(
        [
            'diff',
            '--no-ext-diff',
            '--no-textconv',
            '--no-color',
            '-M',
            '-C',
            '--find-copies-harder',
            `--unified=${String(HUNK_CONTEXT_LINES)}`,
            `${mergeBaseSha}...${headSha}`,
        ],
        primaryRoot,
        false
    );
}

export function createGitSourcePort(primaryRoot: string): SemanticSourcePort {
    return {
        changedFiles: (mergeBaseSha, headSha) => {
            // All three invocations agree about a path's change kind. `-M` is explicit rather than
            // inherited from the `diff.renames=true` default, so a user or runner configuration that
            // sets `diff.renames=false` cannot silently turn one rename record into an add plus delete
            // and break the pairing between numstat and name-status. `-C --find-copies-harder` makes
            // numstat, name-status, and the hunk diff all report a copy as one copied path.
            const numstat = git(
                [
                    'diff',
                    '--no-ext-diff',
                    '--no-textconv',
                    '--numstat',
                    '-z',
                    '-M',
                    '-C',
                    '--find-copies-harder',
                    `${mergeBaseSha}...${headSha}`,
                ],
                primaryRoot,
                false
            );
            const nameStatus = git(
                [
                    'diff',
                    '--no-ext-diff',
                    '--no-textconv',
                    '--name-status',
                    '-z',
                    '-M',
                    '-C',
                    '--find-copies-harder',
                    `${mergeBaseSha}...${headSha}`,
                ],
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
        changedHunks: (mergeBaseSha, headSha) =>
            parseUnifiedDiffRanges(readChangeDiff(primaryRoot, mergeBaseSha, headSha)),
        changedLines: (mergeBaseSha, headSha) => parseChangedLines(readChangeDiff(primaryRoot, mergeBaseSha, headSha)),
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
