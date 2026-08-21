#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_LOGIN,
    AUTHOR_LOCK_REASON,
    GITHUB_HTTPS_REMOTE,
    REQUIRED_BASE_BRANCH,
    REQUIRED_REPOSITORY,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    gitAuthenticatedArgs,
    originMainBlob,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import {
    assertConventionalSubject,
    assertPullRequestBody,
    canonicalIssueReferenceFromBody,
    fail,
} from './prContract.ts';
import { parsePublishWorktrees } from './publishLane.ts';

export const DESCRIBE_PULL_REQUEST_USAGE = 'usage: pnpm pr:describe <pr-number> --body-file <path>';
const SCREENSHOTS_HEADING = '### 🖼️ Screenshots';
const HOW_TO_TEST_HEADING = '### 🧪 How to test';
const RELATED_TICKETS_HEADING = '### 📌 Related tickets & additional notes';

export type DescribePullRequestArgs = { number?: number; bodyFile?: string; help: boolean };

export type PullRequestDescriptionSnapshot = {
    number: number;
    state: string;
    isDraft: boolean;
    title: string;
    body: string | null;
    repository: string;
    headRepository: string;
    baseRefName: string;
    headRefName: string;
    headRefOid: string;
};

export type DescribeLaneSnapshot = {
    root: string;
    primaryRoot: string;
    branch: string;
    head: string;
    remoteHead: string | undefined;
    dirty: boolean;
    locked: boolean;
    lockReason: string | undefined;
};

export type DescribePullRequestPort = {
    lane: () => DescribeLaneSnapshot;
    inspect: (number: number) => PullRequestDescriptionSnapshot;
    update: (number: number, input: { title: string; body: string }) => void;
    log: (message: string) => void;
};

export function parseDescribePullRequestArgs(args: string[]): DescribePullRequestArgs {
    if (args[0] === '--help' && args.length === 1) {
        return { help: true };
    }
    if (
        args.length !== 3 ||
        args[1] !== '--body-file' ||
        args[0] === undefined ||
        args[2] === undefined ||
        !/^[1-9][0-9]*$/u.test(args[0])
    ) {
        fail(DESCRIBE_PULL_REQUEST_USAGE);
    }
    const number = Number(args[0]);
    if (!Number.isSafeInteger(number)) {
        fail(DESCRIBE_PULL_REQUEST_USAGE);
    }
    return { number, bodyFile: args[2], help: false };
}

function laneIssue(branch: string): number {
    const raw = /^agent\/([1-9][0-9]*)\/[^/]+$/u.exec(branch)?.[1];
    const issue = Number(raw);
    if (raw === undefined || !Number.isSafeInteger(issue)) {
        fail(`branch ${branch} is not an issue-owned author lane`);
    }
    return issue;
}

function assertLaneOwnership(lane: DescribeLaneSnapshot): number {
    if (lane.root === lane.primaryRoot || !lane.root.startsWith(`${lane.primaryRoot}/.agents/worktrees/`)) {
        fail('pr:describe must run from an agent worktree, not the primary checkout');
    }
    if (!lane.locked || lane.lockReason !== AUTHOR_LOCK_REASON) {
        fail('pr:describe must run from a locked author lane');
    }
    if (lane.dirty) {
        fail('lane is dirty; commit and publish the description tooling first');
    }
    if (lane.remoteHead !== lane.head) {
        fail('lane head is not published to its exact remote branch');
    }
    return laneIssue(lane.branch);
}

function assertPullRequestOwnership(
    pullRequest: PullRequestDescriptionSnapshot,
    number: number,
    lane: DescribeLaneSnapshot
): void {
    if (
        pullRequest.number !== number ||
        pullRequest.repository !== REQUIRED_REPOSITORY ||
        pullRequest.headRepository !== REQUIRED_REPOSITORY
    ) {
        fail(`PR #${number} is not an open same-repository pull request in ${REQUIRED_REPOSITORY}`);
    }
    if (pullRequest.state !== 'OPEN') {
        fail(`PR #${number} is ${pullRequest.state.toLowerCase()}`);
    }
    if (pullRequest.isDraft) {
        fail(`PR #${number} is a draft`);
    }
    if (pullRequest.baseRefName !== REQUIRED_BASE_BRANCH) {
        fail(`PR #${number} targets ${pullRequest.baseRefName}, not ${REQUIRED_BASE_BRANCH}`);
    }
    if (pullRequest.headRefName !== lane.branch) {
        fail(`PR #${number} branch does not match the current lane`);
    }
    if (pullRequest.headRefOid !== lane.head) {
        fail(`PR #${number} head does not match the published current lane head`);
    }
    assertConventionalSubject(pullRequest.title, `PR #${number} title`);
}

function assertStableDescription(
    before: PullRequestDescriptionSnapshot,
    after: PullRequestDescriptionSnapshot,
    body: string
): void {
    const stable: Array<keyof PullRequestDescriptionSnapshot> = [
        'number',
        'state',
        'isDraft',
        'repository',
        'headRepository',
        'baseRefName',
        'headRefName',
        'headRefOid',
        'title',
    ];
    for (const field of stable) {
        if (after[field] !== before[field]) {
            fail(`PR #${before.number} ${field} changed during description update`);
        }
    }
    if (after.body !== body) {
        fail(`PR #${before.number} body update was not confirmed`);
    }
}

function assertFourHeadingBody(body: string): void {
    assertPullRequestBody(body, 'pull-request body');
    const screenshotIndex = body.indexOf(SCREENSHOTS_HEADING);
    const howToTestIndex = body.indexOf(HOW_TO_TEST_HEADING);
    const relatedIndex = body.indexOf(RELATED_TICKETS_HEADING);
    if (
        screenshotIndex < 0 ||
        screenshotIndex !== body.lastIndexOf(SCREENSHOTS_HEADING) ||
        screenshotIndex <= howToTestIndex ||
        screenshotIndex >= relatedIndex
    ) {
        fail(`pull-request body must contain one ${SCREENSHOTS_HEADING} section before related tickets`);
    }
    if (body.slice(screenshotIndex + SCREENSHOTS_HEADING.length, relatedIndex).trim() === '') {
        fail(`pull-request body section is empty: ${SCREENSHOTS_HEADING}`);
    }
}

export function describePullRequest(
    number: number,
    body: string,
    authorLogin: string,
    port: DescribePullRequestPort
): string {
    if (authorLogin !== AUTHOR_BOT_LOGIN) {
        fail(`authenticated author login ${authorLogin} is not ${AUTHOR_BOT_LOGIN}`);
    }
    assertFourHeadingBody(body);
    const lane = port.lane();
    const issue = assertLaneOwnership(lane);
    const relationship = canonicalIssueReferenceFromBody(body, REQUIRED_REPOSITORY);
    if (relationship?.relationship !== 'closes' || relationship.issue !== issue) {
        fail(`pull-request body must close #${issue}`);
    }
    const before = port.inspect(number);
    assertPullRequestOwnership(before, number, lane);
    port.update(number, { title: before.title, body });
    const after = port.inspect(number);
    assertStableDescription(before, after, body);
    const result = `pull-request-described:${number}:${lane.head}`;
    port.log(result);
    return result;
}

type PullRequestApi = {
    number?: unknown;
    state?: unknown;
    draft?: unknown;
    title?: unknown;
    body?: unknown;
    base?: { ref?: unknown; repo?: { full_name?: unknown } };
    head?: { ref?: unknown; sha?: unknown; repo?: { full_name?: unknown } };
};

function parsePullRequestSnapshot(value: string, number: number): PullRequestDescriptionSnapshot {
    const response = parseJson<PullRequestApi>(value, `PR #${number} query`);
    if (
        response.number !== number ||
        typeof response.state !== 'string' ||
        typeof response.draft !== 'boolean' ||
        typeof response.title !== 'string' ||
        !(typeof response.body === 'string' || response.body === null) ||
        typeof response.base?.repo?.full_name !== 'string' ||
        typeof response.head?.repo?.full_name !== 'string' ||
        typeof response.base.ref !== 'string' ||
        typeof response.head.ref !== 'string' ||
        typeof response.head.sha !== 'string'
    ) {
        fail(`PR #${number} query returned an invalid snapshot`);
    }
    return {
        number,
        state: response.state.toUpperCase(),
        isDraft: response.draft,
        title: response.title,
        body: response.body,
        repository: response.base.repo.full_name,
        headRepository: response.head.repo.full_name,
        baseRefName: response.base.ref,
        headRefName: response.head.ref,
        headRefOid: response.head.sha,
    };
}

export function shellPort(session: GhSession, cwd = process.cwd()): DescribePullRequestPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const root = realpathSync(spawnCapture('git', ['rev-parse', '--show-toplevel'], { cwd }));
    const gh = (args: string[], input?: string) =>
        spawnCapture('gh', args, { cwd: primaryRoot, env: session.env, input });
    return {
        lane: () => {
            const worktree = parsePublishWorktrees(
                spawnCapture('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: primaryRoot })
            ).find((candidate) => realpathSync(candidate.path) === root);
            if (worktree?.branch === undefined) {
                fail('current directory is not a registered branch worktree');
            }
            const branch = worktree.branch;
            const head = spawnCapture('git', ['rev-parse', 'HEAD'], { cwd: root });
            const remote = spawnCapture(
                'git',
                gitAuthenticatedArgs(session.env.GH_TOKEN ?? '', session.configDir, [
                    'ls-remote',
                    GITHUB_HTTPS_REMOTE,
                    `refs/heads/${branch}`,
                ]),
                { cwd: primaryRoot, env: session.env }
            );
            return {
                root,
                primaryRoot,
                branch,
                head,
                remoteHead: remote.split(/\s+/u)[0] || undefined,
                dirty: spawnCapture('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root }) !== '',
                locked: worktree.locked,
                lockReason: worktree.lockReason,
            };
        },
        inspect: (number) =>
            parsePullRequestSnapshot(gh(['api', `repos/${REQUIRED_REPOSITORY}/pulls/${String(number)}`]), number),
        update: (number, input) => {
            gh(
                ['api', '--method', 'PATCH', `repos/${REQUIRED_REPOSITORY}/pulls/${String(number)}`, '--input', '-'],
                JSON.stringify({ title: input.title, body: input.body })
            );
        },
        log: (message) => console.log(message),
    };
}

async function main(): Promise<number> {
    const parsed = parseDescribePullRequestArgs(process.argv.slice(2));
    if (parsed.help) {
        console.log(`Usage: ${DESCRIBE_PULL_REQUEST_USAGE.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.number === undefined || parsed.bodyFile === undefined) {
        fail(DESCRIBE_PULL_REQUEST_USAGE);
    }
    const cwd = process.cwd();
    assertTrustedExecutingBlob(
        'scripts/describePullRequest.ts',
        fileURLToPath(import.meta.url),
        originMainBlob('scripts/describePullRequest.ts', cwd)
    );
    const body = readFileSync(resolve(parsed.bodyFile), 'utf8');
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'author' });
    try {
        assertRequiredRepository(
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                cwd: primaryRoot,
                env: auth.session.env,
            })
        );
        describePullRequest(parsed.number, body, auth.minted.login, shellPort(auth.session, cwd));
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
