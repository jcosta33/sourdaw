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
    recoverLeaseToken?: string;
    issueNumber?: number;
    expectedBodySha256?: string;
    editsFile?: string;
    replacementNumber?: number;
};

const usage =
    'usage: pnpm issue:reconcile <issue-number> --expected-body-sha256 <64-hex> (--edits-file <json> | --superseded-by <issue-number>)\n' +
    '       pnpm issue:reconcile --recover-lease <token>';

export function parseReconcileTrackerIssueArgs(args: string[]): ReconcileTrackerIssueArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    if (args[0] === '--recover-lease') {
        if (args.length !== 2 || args[1] === undefined || args[1].trim() === '') {
            fail(usage);
        }
        return { help: false, recoverLeaseToken: args[1] };
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

export type TrackerMutationLeaseDependencies = {
    /** True only when the owner process is proven gone; live, reused, or unreadable is false. */
    processIsProvenDead: (pid: number) => boolean;
};

type TrackerMutationLeaseOwner = { pid: number; token: string };

const TRACKER_MUTATION_LEASE_VERSION = 2;
const UNPROVABLE_LEASE_REMEDY = 'remove it manually after confirming no reconcile or deliver is running';

/**
 * `kill(pid, 0)` answering ESRCH proves the pid is unused. The owner held its pid for as long as it
 * held the lease, so an unused pid means the owner is gone; pid reuse can only make a dead owner
 * look live, which refuses recovery. Success, EPERM, and any other error prove nothing.
 */
export function processIsProvenDead(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return false;
    } catch (error) {
        return errorCode(error) === 'ESRCH';
    }
}

const defaultLeaseDependencies: TrackerMutationLeaseDependencies = { processIsProvenDead };

function trackerMutationLeasePath(primaryRoot: string): string {
    return join(primaryRoot, '.git', 'sourdaw-tracker-mutation.lease');
}

/** Reads only what this file writes: the versioned owner, or the unversioned `{ pid, token }` before it. */
function parseTrackerMutationLeaseOwner(contents: string): TrackerMutationLeaseOwner | undefined {
    let value: unknown;
    try {
        value = JSON.parse(contents) as unknown;
    } catch {
        return undefined;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    const owner = value as Record<string, unknown>;
    const keys = Object.keys(owner).sort().join(',');
    const versioned = keys === 'pid,token,version' && owner.version === TRACKER_MUTATION_LEASE_VERSION;
    if (
        (!versioned && keys !== 'pid,token') ||
        typeof owner.pid !== 'number' ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid <= 0 ||
        typeof owner.token !== 'string' ||
        !/^[0-9A-Za-z-]+$/u.test(owner.token)
    ) {
        return undefined;
    }
    return { pid: owner.pid, token: owner.token };
}

function busyLeaseMessage(leasePath: string, dependencies: TrackerMutationLeaseDependencies): string {
    let contents: string;
    try {
        contents = readFileSync(leasePath, 'utf8');
    } catch {
        return `tracker mutation lease is busy and its owner record at ${leasePath} is unreadable; retry`;
    }
    const owner = parseTrackerMutationLeaseOwner(contents);
    if (owner === undefined) {
        return `tracker mutation lease is busy and its owner record at ${leasePath} is unprovable; ${UNPROVABLE_LEASE_REMEDY}`;
    }
    const prefix = `tracker mutation lease is busy: owner pid ${owner.pid}, token ${owner.token}`;
    if (!dependencies.processIsProvenDead(owner.pid)) {
        return `${prefix}; the owner is live or unprovable`;
    }
    return (
        `${prefix}; the owner is proven dead; ` + `recover it with: pnpm issue:reconcile --recover-lease ${owner.token}`
    );
}

/**
 * Removes a lease only when it names the supplied token and its owner is proven dead, and only if the
 * lease bytes are still the proven ones immediately before the unlink. Acquisition never does this.
 */
export function recoverRepositoryTrackerMutationLease(
    primaryRoot: string,
    token: string,
    dependencies: TrackerMutationLeaseDependencies = defaultLeaseDependencies
): void {
    const leasePath = trackerMutationLeasePath(primaryRoot);
    let proven: string;
    try {
        proven = readFileSync(leasePath, 'utf8');
    } catch (error) {
        if (errorCode(error) === 'ENOENT') {
            fail(`no tracker mutation lease exists at ${leasePath}`);
        }
        fail(`tracker mutation lease at ${leasePath} is unreadable; nothing removed`);
    }
    const owner = parseTrackerMutationLeaseOwner(proven);
    if (owner === undefined) {
        fail(`tracker mutation lease at ${leasePath} is unprovable; ${UNPROVABLE_LEASE_REMEDY}`);
    }
    if (owner.token !== token) {
        fail(`tracker mutation lease token ${owner.token} does not match ${token}; nothing removed`);
    }
    if (!dependencies.processIsProvenDead(owner.pid)) {
        fail(`tracker mutation lease owner pid ${owner.pid} is live or unprovable; nothing removed`);
    }
    if (readFileSync(leasePath, 'utf8') !== proven) {
        fail(`tracker mutation lease at ${leasePath} changed while it was proven; nothing removed`);
    }
    unlinkSync(leasePath);
}

/**
 * GitHub's issue PATCH endpoint has no conditional compare-and-swap.
 * Only sanctioned local writers are serialized through this repository-owned lease, held from the
 * final read/digest check through the verified PATCH. External GitHub issue body edits are unsupported
 * because they cannot participate in this cooperative serialization boundary.
 */
export function withRepositoryTrackerMutationLease<Value>(
    primaryRoot: string,
    operation: () => Value,
    dependencies: TrackerMutationLeaseDependencies = defaultLeaseDependencies
): Value {
    const leasePath = trackerMutationLeasePath(primaryRoot);
    const owner = JSON.stringify({ version: TRACKER_MUTATION_LEASE_VERSION, pid: process.pid, token: randomUUID() });
    let descriptor: number;
    try {
        descriptor = openSync(leasePath, 'wx', 0o600);
    } catch (error) {
        if (errorCode(error) === 'EEXIST') {
            fail(busyLeaseMessage(leasePath, dependencies));
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

export type ReconcileTrackerIssueCliDependencies = Partial<TrackerMutationLeaseDependencies> & {
    resolvePrimaryRoot?: () => string;
    authenticateTrackerAuthor?: typeof authenticateTrackerAuthor;
};

export async function runReconcileTrackerIssueCli(
    args: string[],
    dependencies: ReconcileTrackerIssueCliDependencies = {}
): Promise<number> {
    const parsed = parseReconcileTrackerIssueArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    const primaryRoot = (dependencies.resolvePrimaryRoot ?? resolvePrimaryRoot)();
    if (parsed.recoverLeaseToken !== undefined) {
        recoverRepositoryTrackerMutationLease(primaryRoot, parsed.recoverLeaseToken, {
            processIsProvenDead: dependencies.processIsProvenDead ?? processIsProvenDead,
        });
        console.log(`tracker-mutation-lease-recovered:${parsed.recoverLeaseToken}`);
        return 0;
    }
    if (parsed.issueNumber === undefined || parsed.expectedBodySha256 === undefined) {
        fail(usage);
    }

    const cwd = process.cwd();
    const auth = await (dependencies.authenticateTrackerAuthor ?? authenticateTrackerAuthor)({ primaryRoot });
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
