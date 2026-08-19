#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
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

export type PublishLanePort = {
    worktrees: () => PublishWorktree[];
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
    if (issueArg === undefined || args.length !== 1) {
        fail('usage: pnpm lane:publish <issue-number>');
    }
    return { issue: assertIssueNumber(issueArg, 'usage: pnpm lane:publish <issue-number>'), help: false };
}

export function publishLane(issue: number, port: PublishLanePort): number {
    const prefix = `agent/${issue}/`;
    const matches = port.worktrees().filter((worktree) => {
        const branch = worktree.branch;
        return (
            worktree.locked &&
            worktree.lockReason === AUTHOR_LOCK_REASON &&
            branch !== undefined &&
            branch.startsWith(prefix)
        );
    });
    if (matches.length !== 1) {
        fail(`expected exactly one locked author lane for issue #${issue}`);
    }
    const lane = matches[0];
    if (lane === undefined || lane.branch === undefined) {
        fail(`expected exactly one locked author lane for issue #${issue}`);
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
    const git = (args: string[], directory: string) =>
        spawnCapture('git', gitAuthenticatedArgs(session.env.GH_TOKEN ?? '', args), {
            cwd: directory,
            env: session.env,
        });
    const gh = (args: string[]) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    const ghRun = (args: string[]) => spawnRun('gh', args, { cwd: primaryRoot, env: session.env });
    return {
        worktrees: () =>
            parsePublishWorktrees(spawnCapture('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: primaryRoot })),
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
                gitAuthenticatedArgs(session.env.GH_TOKEN ?? '', [
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
                gh([
                    'pr',
                    'list',
                    '--repo',
                    REQUIRED_REPOSITORY,
                    '--head',
                    `${REQUIRED_REPOSITORY.split('/')[0]}:${branch}`,
                    '--state',
                    'open',
                    '--json',
                    'number',
                ]),
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
        console.log('Usage: pnpm lane:publish <issue-number>');
        return 0;
    }
    if (parsed.issue === undefined) {
        fail('usage: pnpm lane:publish <issue-number>');
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
