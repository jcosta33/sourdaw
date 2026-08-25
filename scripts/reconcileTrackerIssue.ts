#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
    REQUIRED_REPOSITORY,
    assertRequiredRepository,
    authenticateTrackerAuthor,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import {
    applyExactBodyEdits,
    assertBodyDigest,
    reconcileTrackerIssue,
    type BodyEdit,
    type ReconcileTrackerIssuePort,
    type TrackerIssue,
    type TrackerIssueComment,
} from './trackerIssueReconciliation.ts';

export type ReconcileTrackerIssueArgs = {
    help: boolean;
    issueNumber?: number;
    expectedBodySha256?: string;
    editsFile?: string;
    replacementNumber?: number;
};

const usage =
    'usage: pnpm issue:reconcile <issue-number> --expected-body-sha256 <64-hex> (--edits-file <json> | --superseded-by <issue-number>)';

export function parseReconcileTrackerIssueArgs(args: string[]): ReconcileTrackerIssueArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    if (
        args.length !== 5 ||
        args[1] !== '--expected-body-sha256' ||
        (args[3] !== '--edits-file' && args[3] !== '--superseded-by') ||
        args[0] === undefined ||
        args[2] === undefined ||
        args[4] === undefined ||
        !isIssueNumber(args[0]) ||
        !/^[0-9a-f]{64}$/i.test(args[2])
    ) {
        fail(usage);
    }

    const issueNumber = Number(args[0]);
    if (!Number.isSafeInteger(issueNumber)) {
        fail(usage);
    }
    if (args[3] === '--edits-file') {
        if (args[4].trim() === '') {
            fail(usage);
        }
        return {
            help: false,
            issueNumber,
            expectedBodySha256: args[2].toLowerCase(),
            editsFile: args[4],
        };
    }

    if (!isIssueNumber(args[4])) {
        fail(usage);
    }
    const replacementNumber = Number(args[4]);
    if (!Number.isSafeInteger(replacementNumber) || replacementNumber === issueNumber) {
        fail(usage);
    }
    return {
        help: false,
        issueNumber,
        expectedBodySha256: args[2].toLowerCase(),
        replacementNumber,
    };
}

export function readBodyEdits(path: string): BodyEdit[] {
    let value: unknown;
    try {
        value = parseJson<unknown>(readFileSync(path, 'utf8'), `tracker body edits: ${path}`);
    } catch {
        fail(`cannot read tracker body edits: ${path}`);
    }
    if (!isUnknownArray(value) || value.length === 0 || value.length > 64) {
        fail('tracker body edits must contain between 1 and 64 entries');
    }
    return value.map((entry, index) => {
        if (
            typeof entry !== 'object' ||
            entry === null ||
            !('from' in entry) ||
            typeof entry.from !== 'string' ||
            entry.from === '' ||
            !('to' in entry) ||
            typeof entry.to !== 'string' ||
            entry.from === entry.to
        ) {
            fail(`invalid tracker body edit at index ${index}`);
        }
        return { from: entry.from, to: entry.to };
    });
}

export type Gh = (args: string[]) => string;

type TrackerMutationLease = <Value>(operation: () => Value) => Value;

/**
 * GitHub's issue PATCH endpoint has no conditional compare-and-swap.
 * Only sanctioned local writers are serialized through this repository-owned lease, held from the
 * final read/digest check through the verified PATCH. External GitHub issue body edits are unsupported
 * because they cannot participate in this cooperative serialization boundary.
 */
export function withRepositoryTrackerMutationLease<Value>(primaryRoot: string, operation: () => Value): Value {
    const leasePath = join(primaryRoot, '.git', 'sourdaw-tracker-mutation.lease');
    const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
    let descriptor: number;
    try {
        descriptor = openSync(leasePath, 'wx', 0o600);
    } catch (error) {
        if (errorCode(error) === 'EEXIST') {
            fail('tracker mutation lease is busy; remove a confirmed stale lease manually');
        }
        throw error;
    }
    let initialized = false;
    try {
        writeFileSync(descriptor, owner, 'utf8');
        initialized = true;
    } finally {
        closeSync(descriptor);
        if (!initialized) {
            rmSync(leasePath, { force: true });
        }
    }
    try {
        return operation();
    } finally {
        if (readFileSync(leasePath, 'utf8') !== owner) {
            fail('tracker mutation lease ownership changed');
        }
        unlinkSync(leasePath);
    }
}

function errorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
}

function issuePath(number: number): string {
    return `repos/${REQUIRED_REPOSITORY}/issues/${number}`;
}

export function inspectTrackerIssue(number: number, gh: Gh): TrackerIssue {
    const issue = parseJson(gh(['api', issuePath(number)]), `issue #${number}`) as Record<string, unknown>;
    if ('pull_request' in issue) {
        fail(`#${number} is a pull request, not a tracker issue`);
    }
    const state = parseIssueState(issue.state);
    const stateReason = parseIssueStateReason(issue.state_reason, state);
    if (
        typeof issue.node_id !== 'string' ||
        issue.node_id === '' ||
        issue.number !== number ||
        issue.repository_url !== `https://api.github.com/repos/${REQUIRED_REPOSITORY}` ||
        state === undefined ||
        stateReason === undefined ||
        typeof issue.body !== 'string'
    ) {
        fail(`cannot inspect issue #${number}`);
    }
    return {
        id: issue.node_id,
        number,
        repository: REQUIRED_REPOSITORY,
        state,
        stateReason,
        body: issue.body,
        comments: inspectComments(number, gh),
    };
}

function inspectComments(number: number, gh: Gh): TrackerIssueComment[] {
    const pages = parseJson(
        gh(['api', '--paginate', '--slurp', `${issuePath(number)}/comments?per_page=100`]),
        `comments for issue #${number}`
    );
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
        fail(`cannot inspect comments for issue #${number}`);
    }
    const comments: TrackerIssueComment[] = [];
    for (const value of pages.flat()) {
        const comment = toComment(value);
        if (comments.some((current) => current.id === comment.id)) {
            fail(`duplicate issue comment ${comment.id}`);
        }
        comments.push(comment);
    }
    return comments;
}

function toComment(value: unknown): TrackerIssueComment {
    const comment = value as {
        node_id?: unknown;
        body?: unknown;
        user?: { node_id?: unknown; login?: unknown; type?: unknown } | null;
    };
    if (typeof comment.node_id !== 'string' || typeof comment.body !== 'string') {
        fail('invalid tracker issue comment');
    }
    return {
        id: comment.node_id,
        body: comment.body,
        authorNodeId: typeof comment.user?.node_id === 'string' ? comment.user.node_id : null,
        authorLogin: typeof comment.user?.login === 'string' ? comment.user.login : null,
        authorType: typeof comment.user?.type === 'string' ? comment.user.type : null,
    };
}

function updateTrackerIssue(
    number: number,
    input: Parameters<ReconcileTrackerIssuePort['update']>[1],
    gh: Gh
): TrackerIssue {
    const changesBody = input.body !== undefined;
    const changesState = input.state !== undefined;
    if (
        changesBody === changesState ||
        (changesBody && input.stateReason !== undefined) ||
        (changesState && input.stateReason !== 'COMPLETED' && input.stateReason !== 'NOT_PLANNED')
    ) {
        fail('tracker issue update must change exactly one field');
    }
    const fields =
        input.body === undefined
            ? ['-f', 'state=closed', '-f', `state_reason=${input.stateReason.toLowerCase()}`]
            : ['-f', `body=${input.body}`];
    const response = parseJson(gh(['api', '--method', 'PATCH', issuePath(number), ...fields]), 'update tracker issue');
    return toMutationIssue(number, response, gh);
}

function toMutationIssue(number: number, value: unknown, gh: Gh): TrackerIssue {
    const issue = value as Record<string, unknown>;
    const state = parseIssueState(issue.state);
    const stateReason = parseIssueStateReason(issue.state_reason, state);
    if (
        typeof issue.node_id !== 'string' ||
        issue.number !== number ||
        issue.repository_url !== `https://api.github.com/repos/${REQUIRED_REPOSITORY}` ||
        state === undefined ||
        stateReason === undefined ||
        typeof issue.body !== 'string'
    ) {
        fail('invalid tracker issue mutation receipt');
    }
    return {
        id: issue.node_id,
        number,
        repository: REQUIRED_REPOSITORY,
        state,
        stateReason,
        body: issue.body,
        comments: inspectComments(number, gh),
    };
}

function addComment(number: number, body: string, gh: Gh): TrackerIssueComment {
    const response = parseJson(
        gh(['api', '--method', 'POST', `${issuePath(number)}/comments`, '-f', `body=${body}`]),
        'add tracker supersession comment'
    );
    return toComment(response);
}

export function githubTrackerIssuePort(
    gh: Gh,
    withMutationLease: TrackerMutationLease,
    log: (message: string) => void = (message) => console.log(message)
): ReconcileTrackerIssuePort {
    return {
        withMutationLease,
        inspect: (number) => inspectTrackerIssue(number, gh),
        update: (number, input) => updateTrackerIssue(number, input, gh),
        comment: (number, body) => addComment(number, body, gh),
        log,
    };
}

export function shellPort(session: GhSession, cwd: string = process.cwd()): ReconcileTrackerIssuePort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[]) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    return githubTrackerIssuePort(
        gh,
        (operation) => withRepositoryTrackerMutationLease(primaryRoot, operation),
        (message) => console.log(message)
    );
}

function parseIssueState(value: unknown): TrackerIssue['state'] | undefined {
    if (value === 'open') {
        return 'OPEN';
    }
    if (value === 'closed') {
        return 'CLOSED';
    }
    return undefined;
}

function parseIssueStateReason(
    value: unknown,
    state: TrackerIssue['state'] | undefined
): TrackerIssue['stateReason'] | undefined {
    if (state === 'OPEN' && value === null) {
        return null;
    }
    if (state === 'OPEN' && value === 'reopened') {
        return 'REOPENED';
    }
    if (state === 'CLOSED' && value === 'completed') {
        return 'COMPLETED';
    }
    if (state === 'CLOSED' && value === 'not_planned') {
        return 'NOT_PLANNED';
    }
    if (state === 'CLOSED' && value === 'duplicate') {
        return 'DUPLICATE';
    }
    if (state === 'CLOSED' && value === null) {
        return null;
    }
    return undefined;
}

function isIssueNumber(value: string): boolean {
    return /^[1-9][0-9]*$/.test(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

export async function runReconcileTrackerIssueCli(args: string[]): Promise<number> {
    const parsed = parseReconcileTrackerIssueArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.issueNumber === undefined || parsed.expectedBodySha256 === undefined) {
        fail(usage);
    }

    const cwd = process.cwd();
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateTrackerAuthor({ primaryRoot });
    try {
        assertRequiredRepository(
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: auth.session.env,
                cwd: primaryRoot,
            })
        );
        const port = shellPort(auth.session, cwd);
        if (parsed.editsFile !== undefined) {
            const before = port.inspect(parsed.issueNumber);
            assertBodyDigest(before.body, parsed.expectedBodySha256, parsed.issueNumber);
            const nextBody = applyExactBodyEdits(before.body, readBodyEdits(resolve(cwd, parsed.editsFile)));
            reconcileTrackerIssue(
                { issueNumber: parsed.issueNumber, expectedBodySha256: parsed.expectedBodySha256, nextBody },
                auth.minted.actorNodeId,
                port
            );
            return 0;
        }
        if (parsed.replacementNumber === undefined) {
            fail(usage);
        }
        reconcileTrackerIssue(
            {
                issueNumber: parsed.issueNumber,
                expectedBodySha256: parsed.expectedBodySha256,
                replacementNumber: parsed.replacementNumber,
            },
            auth.minted.actorNodeId,
            port
        );
        return 0;
    } finally {
        auth.session.dispose();
    }
}
