#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_LOGIN,
    AUTHOR_LOCK_REASON,
    GITHUB_HTTPS_REMOTE,
    REQUIRED_REPOSITORY,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    gitAuthenticatedArgs,
    originMainBlob,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    spawnRun,
    type GhSession,
} from './githubAppIdentity.ts';
import {
    assertConventionalSubject,
    assertIssueNumber,
    composePublishBody,
    fail,
    issueRelationshipFromBody,
    type IssueRelationship,
} from './prContract.ts';

export type PublishWorktree = {
    path: string;
    branch?: string;
    locked: boolean;
    lockReason?: string;
};

export type ExistingPullRequest = { number: number; body: unknown };

export const PUBLISH_LANE_USAGE = 'usage: pnpm lane:publish [issue-number] [--relates]';

export type PublishLanePort = {
    fetchMain: () => void;
    worktrees: () => PublishWorktree[];
    cwd: () => string;
    issueExists: (issue: number) => boolean;
    aheadBehind: (lane: string) => { ahead: number; behind: number };
    dirty: (lane: string) => boolean;
    laneSubject: (lane: string) => string | undefined;
    headSha: (lane: string) => string;
    remoteBranchSha: (branch: string) => string | undefined;
    isAncestor: (ancestorSha: string, descendantSha: string, lane: string) => boolean;
    push: (lane: string, branch: string) => void;
    existingOpenPullRequest: (branch: string) => ExistingPullRequest | undefined;
    createPullRequest: (input: { branch: string; title: string; body: string }) => number;
    updatePullRequest: (number: number, input: { title: string; body: string }) => void;
    log: (message: string) => void;
};

export function parsePublishLaneArgs(args: string[]): {
    issue?: number;
    relationship?: IssueRelationship;
    help: boolean;
} {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const relationship: IssueRelationship | undefined = args.includes('--relates') ? 'relates' : undefined;
    const positional = args.filter((arg) => arg !== '--relates');
    if (positional.length !== args.length - (relationship === undefined ? 0 : 1) || positional.length > 1) {
        fail(PUBLISH_LANE_USAGE);
    }
    const issueArg = positional[0];
    if (issueArg === undefined) {
        return relationship === undefined ? { help: false } : { relationship, help: false };
    }
    const issue = assertIssueNumber(issueArg, PUBLISH_LANE_USAGE);
    return relationship === undefined ? { issue, help: false } : { issue, relationship, help: false };
}

type ResolvedLane = { path: string; branch: string };

export const NO_ISSUE_LANE_FAILURE =
    'not inside a locked author lane: run pnpm lane:publish from inside the lane, or pass the issue number';

export function canonicalPath(path: string, resolveExisting: (path: string) => string): string {
    const absolute = resolve(path);
    try {
        return resolveExisting(absolute);
    } catch {
        return absolute;
    }
}

export function containsPath(container: string, candidate: string): boolean {
    const relation = relative(container, candidate);
    return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

export const AUTHOR_LANE_BRANCH_PREFIX = 'agent/';

/**
 * A push target must be lock-shaped *and* branch-shaped. `lockReason` is only ever set on a locked
 * worktree, so it alone proves the lock; the branch prefix is the part that keeps a hand-locked
 * checkout on, say, `release/1.2` out of the issueless resolution path, where no issue argument
 * constrains the branch name.
 */
function authorLanes(worktrees: PublishWorktree[]): ResolvedLane[] {
    return worktrees.flatMap((worktree) => {
        const branch = worktree.branch;
        if (
            worktree.lockReason !== AUTHOR_LOCK_REASON ||
            branch === undefined ||
            !branch.startsWith(AUTHOR_LANE_BRANCH_PREFIX)
        ) {
            return [];
        }
        return [{ path: worktree.path, branch }];
    });
}

/**
 * The issue a lane branch carries, or `undefined` for an issueless lane. `lane:open <issue>` is the
 * only producer of the `agent/<issue>/<slug>` shape, so the branch records the issue it tracks.
 */
export function laneIssueNumber(branch: string): number | undefined {
    const captured = /^agent\/(\d+)\//.exec(branch)?.[1];
    if (captured === undefined) {
        return undefined;
    }
    const issue = Number(captured);
    return Number.isSafeInteger(issue) && issue > 0 ? issue : undefined;
}

export function resolveAuthorLane(
    issue: number | undefined,
    worktrees: PublishWorktree[],
    cwd: string,
    resolveExisting: (path: string) => string = realpathSync
): ResolvedLane {
    const lanes = authorLanes(worktrees);
    if (issue === undefined) {
        const here = canonicalPath(cwd, resolveExisting);
        const enclosing = lanes.flatMap((lane) => {
            const canonical = canonicalPath(lane.path, resolveExisting);
            return containsPath(canonical, here) ? [{ lane, canonical }] : [];
        });
        // Depth is measured on the same canonical spellings containment used. Comparing the
        // recorded paths instead lets a symlinked outer lane out-rank the inner lane it contains.
        const innermost = enclosing.reduce<{ lane: ResolvedLane; canonical: string } | undefined>(
            (deepest, candidate) =>
                deepest === undefined || candidate.canonical.length > deepest.canonical.length ? candidate : deepest,
            undefined
        );
        if (innermost === undefined) {
            fail(`${cwd} is ${NO_ISSUE_LANE_FAILURE}`);
        }
        return innermost.lane;
    }
    const prefix = `agent/${issue}/`;
    const matches = lanes.filter((lane) => lane.branch.startsWith(prefix));
    if (matches.length !== 1) {
        fail(`expected exactly one locked author lane for issue #${issue}`);
    }
    const lane = matches[0];
    if (lane === undefined) {
        fail(`expected exactly one locked author lane for issue #${issue}`);
    }
    return lane;
}

export const DIRTY_LANE_FAILURE =
    'has uncommitted changes: commit them yourself with a conventional subject (type(scope): subject), then publish';

export const NO_LANE_SUBJECT_FAILURE =
    'carries no non-merge commit above origin/main: commit the lane work with a conventional subject (type(scope): subject) before publishing';

export function publishLane(
    issue: number | undefined,
    port: PublishLanePort,
    relationship?: IssueRelationship
): number {
    port.fetchMain();
    const lane = resolveAuthorLane(issue, port.worktrees(), port.cwd());
    // Without an argument the target is whatever the caller happened to be standing in, and the
    // next steps push it. Name the selection before anything mutates, so a caller who was in the
    // wrong lane sees which one it was.
    port.log(`publishing ${lane.path} on ${lane.branch}`);
    if (issue !== undefined && !port.issueExists(issue)) {
        fail(`issue #${issue} does not exist in ${REQUIRED_REPOSITORY}`);
    }
    // Publishing never authors a commit message. The only subject this script could invent for
    // uncommitted work is some earlier commit's, which describes a different change; the operator
    // is the one who knows what the leftover files are.
    if (port.dirty(lane.path)) {
        fail(`${lane.branch} ${DIRTY_LANE_FAILURE}`);
    }
    const { ahead, behind } = port.aheadBehind(lane.path);
    if (behind !== 0 || ahead < 1) {
        fail('lane must be strictly ahead of origin/main');
    }
    const title = port.laneSubject(lane.path);
    if (title === undefined) {
        fail(`${lane.branch} ${NO_LANE_SUBJECT_FAILURE}`);
    }
    assertConventionalSubject(title, 'pull-request title');
    const laneIssue = issue ?? laneIssueNumber(lane.branch);
    if (relationship === 'relates' && laneIssue === undefined) {
        fail('--relates requires an issue lane or issue number');
    }
    const headSha = port.headSha(lane.path);
    const remoteSha = port.remoteBranchSha(lane.branch);
    if (remoteSha !== undefined && !port.isAncestor(remoteSha, headSha, lane.path)) {
        fail(`refusing non-fast-forward push of ${lane.branch}`);
    }
    const existing = port.existingOpenPullRequest(lane.branch);
    if (existing !== undefined && typeof existing.body !== 'string') {
        fail('existing pull-request body is unreadable');
    }
    const existingRelationship =
        existing === undefined ? undefined : issueRelationshipFromBody(existing.body as string, laneIssue);
    const resolvedRelationship = relationship ?? existingRelationship ?? 'closes';
    const body = composePublishBody(laneIssue, title, resolvedRelationship);
    port.push(lane.path, lane.branch);
    const number =
        existing === undefined
            ? port.createPullRequest({ branch: lane.branch, title, body })
            : (port.updatePullRequest(existing.number, { title, body }), existing.number);
    port.log(String(number));
    return number;
}

/**
 * The pull-request title is squash-merged onto `main`, so it has to name the lane's work. Keeping a
 * published lane current means merging `origin/main` into it — rebasing would force a
 * non-fast-forward push — which leaves HEAD a merge commit, so HEAD alone titles the pull request
 * after the merge that carried it. Both halves of this argument list are load-bearing:
 * `--no-merges` skips the merge commits, and `origin/main..HEAD` keeps the walk inside the lane's
 * own commits. Without the range, a lane commit older than `origin/main`'s tip loses the date sort
 * and the title comes from a commit `main` already has.
 */
export const LANE_SUBJECT_ARGS = ['log', '-1', '--format=%s', '--no-merges', 'origin/main..HEAD'];

export function shellPort(session: GhSession, cwd: string = process.cwd()): PublishLanePort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const token = session.env.GH_TOKEN ?? '';
    const git = (args: string[], directory: string) =>
        spawnCapture('git', gitAuthenticatedArgs(token, session.configDir, args), {
            cwd: directory,
            env: session.env,
        });
    const gh = (args: string[]) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    const ghRun = (args: string[]) => spawnRun('gh', args, { cwd: primaryRoot, env: session.env });
    return {
        fetchMain: () => {
            spawnRun(
                'git',
                gitAuthenticatedArgs(token, session.configDir, [
                    'fetch',
                    GITHUB_HTTPS_REMOTE,
                    '+refs/heads/main:refs/remotes/origin/main',
                ]),
                { cwd: primaryRoot, env: session.env }
            );
        },
        worktrees: () =>
            parsePublishWorktrees(spawnCapture('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: primaryRoot })),
        cwd: () => cwd,
        issueExists: (issue) => {
            const result = spawnSync('gh', issueLookupArgs(issue), {
                cwd: primaryRoot,
                env: session.env,
                encoding: 'utf8',
                shell: false,
            });
            if (result.error !== undefined) {
                throw result.error;
            }
            return issueExistsFromLookup(issue, result);
        },
        aheadBehind: (lane) => {
            const output = spawnCapture('git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD'], {
                cwd: lane,
            });
            const [behindText, aheadText] = output.split(/\s+/);
            const behind = Number(behindText);
            const ahead = Number(aheadText);
            if (!Number.isSafeInteger(behind) || !Number.isSafeInteger(ahead)) {
                fail('cannot prove lane ahead/behind origin/main');
            }
            return { ahead, behind };
        },
        dirty: (lane) =>
            spawnCapture('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: lane }) !== '',
        laneSubject: (lane) => spawnCapture('git', LANE_SUBJECT_ARGS, { cwd: lane }) || undefined,
        headSha: (lane) => spawnCapture('git', ['rev-parse', 'HEAD'], { cwd: lane }),
        remoteBranchSha: (branch) => {
            const output = git(['ls-remote', GITHUB_HTTPS_REMOTE, `refs/heads/${branch}`], primaryRoot);
            if (output === '') {
                return undefined;
            }
            const sha = output.split(/\s+/)[0];
            return sha === undefined || sha === '' ? undefined : sha;
        },
        isAncestor: (ancestorSha, descendantSha, lane) => isAncestorCommit(lane, ancestorSha, descendantSha),
        push: (lane, branch) => {
            spawnRun(
                'git',
                gitAuthenticatedArgs(token, session.configDir, [
                    'push',
                    GITHUB_HTTPS_REMOTE,
                    `HEAD:refs/heads/${branch}`,
                ]),
                {
                    cwd: lane,
                    env: session.env,
                }
            );
        },
        existingOpenPullRequest: (branch) => {
            const rows = parseJson<ExistingPullRequest[]>(
                gh(existingOpenPullRequestArgs(branch)),
                'open pull-request query'
            );
            if (rows.length > 1) {
                fail(`branch ${branch} has more than one open pull request`);
            }
            return rows[0];
        },
        createPullRequest: ({ branch, title, body }) => {
            const url = gh([
                'pr',
                'create',
                '--repo',
                REQUIRED_REPOSITORY,
                '--base',
                'main',
                '--head',
                branch,
                '--title',
                title,
                '--body',
                body,
            ]);
            const number = Number(url.split('/').at(-1));
            if (!Number.isSafeInteger(number) || number <= 0) {
                fail(`gh pr create returned an unreadable url: ${url}`);
            }
            return number;
        },
        updatePullRequest: (number, { title, body }) => {
            ghRun(['pr', 'edit', String(number), '--repo', REQUIRED_REPOSITORY, '--title', title, '--body', body]);
        },
        log: (message) => {
            console.log(message);
        },
    };
}

function isAncestorCommit(lane: string, ancestorSha: string, descendantSha: string): boolean {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestorSha, descendantSha], {
        cwd: lane,
        encoding: 'utf8',
        shell: false,
    });
    if (result.status === 0) {
        return true;
    }
    if (result.status === 1) {
        return false;
    }
    throw new Error(result.stderr.trim() || 'git merge-base --is-ancestor failed');
}

const ISSUE_NOT_FOUND_PATTERN = /HTTP 404|Not Found|Could not resolve to an? Issue/i;

/**
 * The REST issues endpoint resolves pull-request numbers too, and answers with the same `number`.
 * Only the `pull_request` key tells the two apart, so the lookup has to ask for it: without it a
 * pull-request number passes the existence gate and lands `Closes #<pr>` in the body.
 */
export const ISSUE_LOOKUP_JQ = '{number: .number, isPullRequest: (has("pull_request"))}';

type IssueLookup = { number?: number; isPullRequest?: boolean };

export function issueLookupArgs(issue: number): string[] {
    return ['api', `repos/${REQUIRED_REPOSITORY}/issues/${issue}`, '--jq', ISSUE_LOOKUP_JQ];
}

export function issueExistsFromLookup(
    issue: number,
    result: { status: number | null; stdout: string; stderr: string }
): boolean {
    if (result.status === 0) {
        const lookup = parseJson<IssueLookup>(result.stdout, `issue #${issue} lookup`);
        if (lookup.isPullRequest === true) {
            fail(`#${issue} in ${REQUIRED_REPOSITORY} is a pull request, not an issue; pass the issue it closes`);
        }
        return lookup.number === issue;
    }
    const stderr = result.stderr.trim();
    if (ISSUE_NOT_FOUND_PATTERN.test(stderr)) {
        return false;
    }
    throw new Error(stderr || `cannot prove issue #${issue} exists in ${REQUIRED_REPOSITORY}`);
}

export function existingOpenPullRequestArgs(branch: string): string[] {
    return ['pr', 'list', '--repo', REQUIRED_REPOSITORY, '--head', branch, '--state', 'open', '--json', 'number,body'];
}

export function parsePublishWorktrees(value: string): PublishWorktree[] {
    return value
        .split('\0\0')
        .filter((record) => record !== '')
        .map((record) => {
            const fields = record.split('\0');
            const worktree = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length);
            if (worktree === undefined) {
                fail('git returned malformed worktree state');
            }
            const locked = fields.find((field) => field === 'locked' || field.startsWith('locked '));
            return {
                path: worktree,
                branch: fields.find((field) => field.startsWith('branch '))?.slice('branch refs/heads/'.length),
                locked: locked !== undefined,
                lockReason: locked?.slice('locked '.length) || undefined,
            };
        });
}

async function main(): Promise<number> {
    const parsed = parsePublishLaneArgs(process.argv.slice(2));
    if (parsed.help) {
        console.log('Usage: pnpm lane:publish [issue-number] [--relates]');
        return 0;
    }
    const executingFile = fileURLToPath(import.meta.url);
    const cwd = process.cwd();
    assertTrustedExecutingBlob('scripts/publishLane.ts', executingFile, originMainBlob('scripts/publishLane.ts', cwd));
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'author' });
    try {
        const repository = spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
            env: auth.session.env,
            cwd: primaryRoot,
        });
        assertRequiredRepository(repository);
        if (auth.minted.login !== AUTHOR_BOT_LOGIN) {
            fail(`minted login ${auth.minted.login} is not ${AUTHOR_BOT_LOGIN}`);
        }
        publishLane(parsed.issue, shellPort(auth.session), parsed.relationship);
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
