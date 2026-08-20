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
import { assertConventionalSubject, assertIssueNumber, composePublishBody, fail } from './prContract.ts';

export type PublishWorktree = {
    path: string;
    branch?: string;
    locked: boolean;
    lockReason?: string;
};

export const PUBLISH_LANE_USAGE = 'usage: pnpm lane:publish [issue-number]';

export type PublishLanePort = {
    fetchMain: () => void;
    worktrees: () => PublishWorktree[];
    cwd: () => string;
    issueExists: (issue: number) => boolean;
    aheadBehind: (lane: string) => { ahead: number; behind: number };
    dirty: (lane: string) => boolean;
    headSubject: (lane: string) => string;
    headSha: (lane: string) => string;
    commitAll: (lane: string, subject: string) => void;
    remoteBranchSha: (branch: string) => string | undefined;
    isAncestor: (ancestorSha: string, descendantSha: string, lane: string) => boolean;
    push: (lane: string, branch: string) => void;
    existingOpenPullRequest: (branch: string) => number | undefined;
    createPullRequest: (input: { branch: string; title: string; body: string }) => number;
    updatePullRequest: (number: number, input: { title: string; body: string }) => void;
    log: (message: string) => void;
};

export function parsePublishLaneArgs(args: string[]): { issue?: number; help: boolean } {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const issueArg = args[0];
    if (issueArg === undefined) {
        return { help: false };
    }
    if (args.length !== 1) {
        fail(PUBLISH_LANE_USAGE);
    }
    return { issue: assertIssueNumber(issueArg, PUBLISH_LANE_USAGE), help: false };
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

function authorLanes(worktrees: PublishWorktree[]): ResolvedLane[] {
    return worktrees.flatMap((worktree) => {
        const branch = worktree.branch;
        if (!worktree.locked || worktree.lockReason !== AUTHOR_LOCK_REASON || branch === undefined) {
            return [];
        }
        return [{ path: worktree.path, branch }];
    });
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
        const enclosing = lanes.filter((lane) => containsPath(canonicalPath(lane.path, resolveExisting), here));
        const innermost = enclosing.reduce<ResolvedLane | undefined>(
            (deepest, lane) => (deepest === undefined || lane.path.length > deepest.path.length ? lane : deepest),
            undefined
        );
        if (innermost === undefined) {
            fail(`${cwd} is ${NO_ISSUE_LANE_FAILURE}`);
        }
        return innermost;
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

export function publishLane(issue: number | undefined, port: PublishLanePort): number {
    port.fetchMain();
    const lane = resolveAuthorLane(issue, port.worktrees(), port.cwd());
    if (issue !== undefined && !port.issueExists(issue)) {
        fail(`issue #${issue} does not exist in ${REQUIRED_REPOSITORY}`);
    }
    if (port.dirty(lane.path)) {
        const subject = port.headSubject(lane.path);
        assertConventionalSubject(subject, 'commit subject');
        port.commitAll(lane.path, subject);
    }
    const { ahead, behind } = port.aheadBehind(lane.path);
    if (behind !== 0 || ahead < 1) {
        fail('lane must be strictly ahead of origin/main');
    }
    const title = port.headSubject(lane.path);
    assertConventionalSubject(title, 'pull-request title');
    const body = composePublishBody(issue, title);
    const headSha = port.headSha(lane.path);
    const remoteSha = port.remoteBranchSha(lane.branch);
    if (remoteSha !== undefined && !port.isAncestor(remoteSha, headSha, lane.path)) {
        fail(`refusing non-fast-forward push of ${lane.branch}`);
    }
    port.push(lane.path, lane.branch);
    const existing = port.existingOpenPullRequest(lane.branch);
    const number =
        existing === undefined
            ? port.createPullRequest({ branch: lane.branch, title, body })
            : (port.updatePullRequest(existing, { title, body }), existing);
    port.log(String(number));
    return number;
}

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
        headSubject: (lane) => spawnCapture('git', ['log', '-1', '--format=%s'], { cwd: lane }),
        headSha: (lane) => spawnCapture('git', ['rev-parse', 'HEAD'], { cwd: lane }),
        commitAll: (lane, subject) => {
            spawnRun('git', ['add', '-A'], { cwd: lane });
            spawnRun('git', ['commit', '-m', subject], { cwd: lane });
        },
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
            const rows = parseJson<Array<{ number: number }>>(
                gh(existingOpenPullRequestArgs(branch)),
                'open pull-request query'
            );
            if (rows.length > 1) {
                fail(`branch ${branch} has more than one open pull request`);
            }
            return rows[0]?.number;
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

export function issueLookupArgs(issue: number): string[] {
    return ['api', `repos/${REQUIRED_REPOSITORY}/issues/${issue}`, '--jq', '.number'];
}

export function issueExistsFromLookup(
    issue: number,
    result: { status: number | null; stdout: string; stderr: string }
): boolean {
    if (result.status === 0) {
        return result.stdout.trim() === String(issue);
    }
    const stderr = result.stderr.trim();
    if (ISSUE_NOT_FOUND_PATTERN.test(stderr)) {
        return false;
    }
    throw new Error(stderr || `cannot prove issue #${issue} exists in ${REQUIRED_REPOSITORY}`);
}

export function existingOpenPullRequestArgs(branch: string): string[] {
    return ['pr', 'list', '--repo', REQUIRED_REPOSITORY, '--head', branch, '--state', 'open', '--json', 'number'];
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
        console.log('Usage: pnpm lane:publish [issue-number]');
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
        publishLane(parsed.issue, shellPort(auth.session));
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
