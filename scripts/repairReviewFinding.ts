#!/usr/bin/env node
/**
 * Author-side record of a repair for one blocking review finding (#3000).
 *
 * The reviewer's `selectEligibleRepairs` refuses a thread that carries two distinct records, and only
 * a head that addresses a finding may resolve its thread. So the author records the repair without
 * resolving: where `review:resolve` writes the fixed word `Done`, this command writes the rendered
 * repair reply — prose plus the machine-readable marker — and leaves the thread open. Recording twice
 * is a no-op: a reply whose canonical rendering is byte-identical to the one about to be posted is
 * already the record this command exists to make.
 *
 * The read is this module's own single-thread GraphQL query rather than `readThread.ts`'s reply
 * shape, because the record binds the thread's root comment — its id, path, line and side — and
 * GitHub exposes the root of a review thread only as the first comment of the thread.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
    AUTHOR_BOT_NODE_ID,
    assertRequiredRepository,
    authenticateRole,
    isAuthorBotNodeId,
    parseGraphqlResponse,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import {
    REVIEW_REPAIR_FORMAT,
    REVIEW_THREAD_COMMENT_FIELDS,
    assertReviewRepairRecord,
    parseReviewRepairReply,
    renderReviewRepairReply,
    type ReviewRepairEvidence,
    type ReviewRepairRecord,
} from './reviewRepair.ts';

export const REPAIR_USAGE =
    'usage: pnpm review:repair <pr-number> --thread <thread-node-id> --head <full-sha> --commit <full-sha> --summary <single-line> [--evidence <path-to-json>]';

const FORTY_HEX_PATTERN = /^[0-9a-f]{40}$/;
const COMMENT_ID_PATTERN = /^[0-9]+$/;
const SHORT_COMMIT_LENGTH = 12;

export type RepairReviewFindingReply = { id: string; body: string; authorNodeId: string | null };

/**
 * The thread as this command needs it. `rootComment` is the finding the repair answers; `replies`
 * carries every comment on the thread, the root included, as GitHub returns them.
 */
export type RepairReviewFindingThread = {
    threadId: string;
    isResolved: boolean;
    pullRequestNumber: number;
    head: string;
    base: string;
    rootComment: { id: number; path: string; line: number; side: 'LEFT' | 'RIGHT' };
    replies: RepairReviewFindingReply[];
};

export type RepairReviewFindingPort = {
    readThread: (threadId: string) => RepairReviewFindingThread;
    postReply: (threadId: string, body: string, clientMutationId: string) => void;
    readEvidenceFile: (path: string) => string;
    isAncestor: (commit: string, head: string) => boolean;
    log: (message: string) => void;
};

export type RepairReviewFindingInput = {
    threadId: string;
    head: string;
    commit: string;
    summary: string;
    evidencePath?: string;
};

export type RepairReviewFindingArgs = {
    number?: number;
    threadId?: string;
    head?: string;
    commit?: string;
    summary?: string;
    evidencePath?: string;
    help: boolean;
};

type RepairOptionKey = 'threadId' | 'head' | 'commit' | 'summary' | 'evidencePath';

const OPTION_FLAGS: Readonly<Record<string, RepairOptionKey>> = {
    '--thread': 'threadId',
    '--head': 'head',
    '--commit': 'commit',
    '--summary': 'summary',
    '--evidence': 'evidencePath',
};

/** `--evidence` is the one flag a run may leave out; the rest bind the record. */
const REQUIRED_OPTION_KEYS = ['threadId', 'head', 'commit', 'summary'] as const;

const ALL_OPTION_KEYS = [...REQUIRED_OPTION_KEYS, 'evidencePath'] as const;

const SHA_OPTION_KEYS: ReadonlySet<RepairOptionKey> = new Set(['head', 'commit']);

type ScannedArguments = { number?: number; options: string[] };

/**
 * The usage prints the pull request first and then flag/value pairs, so the optional pull request is
 * the one leading token that is not itself a flag. Classifying one token at a time is what keeps the
 * summary safe: its value is consumed as a value, so a summary that looks like a flag or a number is
 * never read as either.
 */
function scanArguments(args: string[]): ScannedArguments {
    let index = 0;
    let number: number | undefined;
    if (args[0] !== undefined && OPTION_FLAGS[args[0]] === undefined) {
        number = parsePullRequestNumber(args[0]);
        index = 1;
    }
    const options: string[] = [];
    for (; index < args.length; index += 2) {
        const flag = args[index];
        const value = args[index + 1];
        if (flag === undefined || value === undefined || OPTION_FLAGS[flag] === undefined) {
            fail(REPAIR_USAGE);
        }
        options.push(flag, value);
    }
    const scanned: ScannedArguments = { options };
    if (number !== undefined) {
        scanned.number = number;
    }
    return scanned;
}

export function parseRepairReviewFindingArgs(args: string[]): RepairReviewFindingArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const scanned = scanArguments(args);
    const options = readRepairOptions(scanned.options);
    if (scanned.number === undefined) {
        return { ...options, help: false };
    }
    return { number: scanned.number, ...options, help: false };
}

function parsePullRequestNumber(value: string): number {
    if (!/^[1-9][0-9]*$/.test(value)) {
        fail(REPAIR_USAGE);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        fail(REPAIR_USAGE);
    }
    return parsed;
}

/**
 * Flags are told apart from values by taking tokens two at a time, so a summary is free to carry
 * anything — `--` included — without being read as the next flag.
 */
function readRepairOptions(args: string[]): Omit<RepairReviewFindingArgs, 'number' | 'help'> {
    if (args.length % 2 !== 0) {
        fail(REPAIR_USAGE);
    }
    const options: Partial<Record<RepairOptionKey, string>> = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = OPTION_FLAGS[args[index] ?? ''];
        const value = args[index + 1];
        if (key === undefined || value === undefined || options[key] !== undefined) {
            fail(REPAIR_USAGE);
        }
        options[key] = value;
    }
    for (const key of ALL_OPTION_KEYS) {
        const value = options[key];
        if (value !== undefined) {
            assertOptionBound(key, value);
        } else if (key !== 'evidencePath') {
            fail(REPAIR_USAGE);
        }
    }
    const required = {
        threadId: requireOption(options, 'threadId'),
        head: requireOption(options, 'head'),
        commit: requireOption(options, 'commit'),
        summary: requireOption(options, 'summary'),
    };
    if (options.evidencePath === undefined) {
        return required;
    }
    return { ...required, evidencePath: options.evidencePath };
}

function requireOption(options: Partial<Record<RepairOptionKey, string>>, key: RepairOptionKey): string {
    const value = options[key];
    if (value === undefined) {
        fail(REPAIR_USAGE);
    }
    return value;
}

function assertOptionBound(key: RepairOptionKey, value: string): void {
    if (value.trim() === '') {
        fail(REPAIR_USAGE);
    }
    if (SHA_OPTION_KEYS.has(key) && !FORTY_HEX_PATTERN.test(value)) {
        fail(REPAIR_USAGE);
    }
}

/**
 * Derived from what the caller asked for, never from a clock or a random source: a rerun after a
 * partial failure replays the identical request, and the receipt GitHub returns can be matched
 * against the id that was sent. The commit joins the other three fields because two repairs of one
 * finding on one head are two distinct records, not a replay of one.
 */
export function recordClientMutationId(pr: number, thread: string, head: string, commit: string): string {
    return `review-repair-record:${pr}:${thread}:${head}:${commit}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

export function parseRepairEvidence(json: string): ReviewRepairEvidence[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        throw new Error('review repair evidence file is not valid JSON', { cause: error });
    }
    if (!Array.isArray(parsed)) {
        throw new TypeError('review repair evidence file must hold an array of evidence entries');
    }
    const entries: ReviewRepairEvidence[] = [];
    for (let index = 0; index < parsed.length; index += 1) {
        entries.push(readRepairEvidenceEntry(parsed[index], index));
    }
    return entries;
}

/**
 * Validated here rather than left to `assertReviewRepairRecord`, so a malformed file is named as a
 * malformed file instead of as a malformed record bound to a thread.
 */
function readRepairEvidenceEntry(value: unknown, index: number): ReviewRepairEvidence {
    if (!isRecord(value)) {
        throw new TypeError(
            `review repair evidence entry ${index} must be a JSON object, found ${describeValue(value)}`
        );
    }
    return {
        observable: readEvidenceField(value, 'observable', index),
        verification: readEvidenceField(value, 'verification', index),
        observed: readEvidenceField(value, 'observed', index),
    };
}

function readEvidenceField(entry: Record<string, unknown>, field: string, index: number): string {
    const value = entry[field];
    if (typeof value !== 'string') {
        throw new TypeError(
            `review repair evidence entry ${index} field ${field} must be a string, found ${describeValue(value)}`
        );
    }
    return value;
}

function loadRepairEvidence(evidencePath: string | undefined, port: RepairReviewFindingPort): ReviewRepairEvidence[] {
    if (evidencePath === undefined) {
        return [];
    }
    return parseRepairEvidence(port.readEvidenceFile(evidencePath));
}

function assertThreadPrecondition(state: RepairReviewFindingThread, number: number, expectedHead: string): void {
    if (state.pullRequestNumber !== number) {
        fail(`thread ${state.threadId} belongs to PR #${state.pullRequestNumber}, not PR #${number}`);
    }
    if (state.isResolved) {
        fail(`thread ${state.threadId} is already resolved`);
    }
    if (state.head !== expectedHead) {
        fail(`head moved: ${state.head} is not ${expectedHead}`);
    }
}

/** The author's own records on this thread, parsed. A foreign actor's marker is not this command's. */
function authorRepairRecords(state: RepairReviewFindingThread): ReviewRepairRecord[] {
    const records: ReviewRepairRecord[] = [];
    for (const reply of state.replies) {
        if (!isAuthorBotNodeId(reply.authorNodeId)) {
            continue;
        }
        const record = parseReviewRepairReply(reply.body);
        if (record !== undefined) {
            records.push(record);
        }
    }
    return records;
}

/**
 * Whether the rendered reply this command would post already sits on the thread. Compared as bytes,
 * because that is what a later reader of the thread sees: a record that differs anywhere — another
 * commit, another head, one more evidence entry — is a different record, and the reviewer's
 * selection treats two distinct records as a refusal, so it is recorded rather than replaced.
 */
function isRepairAlreadyRecorded(state: RepairReviewFindingThread, incoming: ReviewRepairRecord): boolean {
    const rendered = renderReviewRepairReply(incoming);
    return authorRepairRecords(state).some((record) => renderReviewRepairReply(record) === rendered);
}

function buildRepairReviewRecord(
    number: number,
    input: RepairReviewFindingInput,
    state: RepairReviewFindingThread,
    evidence: ReviewRepairEvidence[] = []
): ReviewRepairRecord {
    const record: ReviewRepairRecord = {
        format: REVIEW_REPAIR_FORMAT,
        pr: number,
        thread: state.threadId,
        finding: {
            commentId: state.rootComment.id,
            path: state.rootComment.path,
            line: state.rootComment.line,
            side: state.rootComment.side,
        },
        commit: input.commit,
        summary: input.summary.trim(),
        evidence,
        head: input.head,
    };
    assertReviewRepairRecord(record);
    return record;
}

export function repairReviewFinding(
    number: number,
    input: RepairReviewFindingInput,
    port: RepairReviewFindingPort
): string {
    const state = port.readThread(input.threadId);
    if (state.threadId !== input.threadId) {
        fail(`GitHub returned thread ${state.threadId} for requested thread ${input.threadId}`);
    }
    assertThreadPrecondition(state, number, input.head);
    if (input.commit === input.head) {
        fail(`commit ${input.commit} is not a distinct commit from head ${input.head}`);
    }
    // Inside the reviewed range `base..head`: every base commit is an ancestor of the head, so the
    // head ancestry check alone would accept the merge base or any pre-pull-request commit.
    if (!port.isAncestor(input.commit, input.head)) {
        fail(`commit ${input.commit} is not an ancestor of head ${input.head}`);
    }
    if (port.isAncestor(input.commit, state.base)) {
        fail(`commit ${input.commit} is an ancestor of the pull request base ${state.base}`);
    }
    const record = buildRepairReviewRecord(number, input, state, loadRepairEvidence(input.evidencePath, port));
    if (isRepairAlreadyRecorded(state, record)) {
        return logRepair(`repair-already-recorded:${number}:${state.threadId}`, port);
    }
    const threadId = state.threadId;
    const clientMutationId = recordClientMutationId(number, threadId, input.head, input.commit);
    port.postReply(threadId, renderReviewRepairReply(record), clientMutationId);
    return logRepair(`repair-recorded:${number}:${threadId}:${record.commit.slice(0, SHORT_COMMIT_LENGTH)}`, port);
}

function logRepair(line: string, port: RepairReviewFindingPort): string {
    port.log(line);
    return line;
}

type Gh = (args: string[]) => string;

function graphql(gh: Gh, query: string, fields: string[], label: string): unknown {
    return parseGraphqlResponse(gh(['api', 'graphql', '-f', `query=${query}`, ...fields]), label);
}

type ThreadNode = {
    id?: unknown;
    isResolved?: unknown;
    pullRequest?: { number?: unknown; headRefOid?: unknown; baseRefOid?: unknown };
    comments?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
};

export function threadQuery(paged: boolean): string {
    const connection = paged ? 'comments(first:100,after:$cursor)' : 'comments(first:100)';
    return `query($threadId:ID!${paged ? ',$cursor:String!' : ''}){node(id:$threadId){... on PullRequestReviewThread{id isResolved pullRequest{number headRefOid baseRefOid} ${connection}{${REVIEW_THREAD_COMMENT_FIELDS}}}}}`;
}

type ThreadCommentNode = {
    id?: unknown;
    body?: unknown;
    path?: unknown;
    line?: unknown;
    side?: unknown;
    author?: unknown;
};

function readCommentId(value: unknown, label: string): number {
    if (typeof value !== 'string' || !COMMENT_ID_PATTERN.test(value)) {
        fail(`${label} must be a numeric database id, found ${describeValue(value)}`);
    }
    return Number(value);
}

function readSide(value: unknown, label: string): 'LEFT' | 'RIGHT' {
    if (value !== 'LEFT' && value !== 'RIGHT') {
        fail(`${label} must be LEFT or RIGHT, found ${describeValue(value)}`);
    }
    return value;
}

function readRootComment(node: ThreadCommentNode, label: string): RepairReviewFindingThread['rootComment'] {
    if (
        typeof node.path !== 'string' ||
        node.path.trim() === '' ||
        typeof node.line !== 'number' ||
        !Number.isSafeInteger(node.line) ||
        node.line <= 0
    ) {
        fail(`${label} root comment carries no file position`);
    }
    return {
        id: readCommentId(node.id, `${label} root comment id`),
        path: node.path,
        line: node.line,
        side: readSide(node.side, `${label} root comment side`),
    };
}

function readThreadReply(node: ThreadCommentNode, label: string): RepairReviewFindingReply {
    if (typeof node.id !== 'string' || typeof node.body !== 'string') {
        fail(`${label} returned an unreadable comment`);
    }
    const author = isRecord(node.author) ? node.author : {};
    return { id: node.id, body: node.body, authorNodeId: typeof author.id === 'string' ? author.id : null };
}

type ReadThreadPage = {
    threadId: string;
    isResolved: boolean;
    pullRequestNumber: number;
    head: string;
    base: string;
    nodes: ThreadCommentNode[];
    hasNextPage: boolean;
    endCursor: string | null;
};

/**
 * `node` arrives typed as `unknown`, so this is the one place that decides a page is a review
 * thread. Reading through a validated copy keeps the checks and their subject in one statement
 * instead of leaving the property accesses to rest on an assertion made several lines earlier.
 */
function readThreadPage(node: ThreadNode | null | undefined): ReadThreadPage | undefined {
    const pullRequest = node?.pullRequest;
    const comments = node?.comments;
    const pageInfo = comments?.pageInfo;
    if (
        node === null ||
        node === undefined ||
        typeof node.id !== 'string' ||
        typeof node.isResolved !== 'boolean' ||
        typeof pullRequest?.number !== 'number' ||
        typeof pullRequest.headRefOid !== 'string' ||
        typeof pullRequest.baseRefOid !== 'string' ||
        !Array.isArray(comments?.nodes) ||
        typeof pageInfo?.hasNextPage !== 'boolean'
    ) {
        return undefined;
    }
    return {
        threadId: node.id,
        isResolved: node.isResolved,
        pullRequestNumber: pullRequest.number,
        head: pullRequest.headRefOid,
        base: pullRequest.baseRefOid,
        nodes: comments.nodes as ThreadCommentNode[],
        hasNextPage: pageInfo.hasNextPage,
        endCursor: typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null,
    };
}

export function readRepairReviewThread(threadId: string, gh: Gh): RepairReviewFindingThread {
    const label = `review thread ${threadId}`;
    let cursor: string | undefined;
    const seen = new Set<string>();
    const replies: RepairReviewFindingReply[] = [];
    let firstPage: ReadThreadPage | undefined;
    for (;;) {
        const fields = ['-f', `threadId=${threadId}`];
        if (cursor !== undefined) {
            fields.push('-f', `cursor=${cursor}`);
        }
        const response = graphql(gh, threadQuery(cursor !== undefined), fields, label) as {
            data?: { node?: ThreadNode | null };
        };
        const page = readThreadPage(response.data?.node);
        if (page === undefined) {
            fail(`${label} is not a readable pull-request review thread`);
        }
        firstPage ??= page;
        replies.push(...page.nodes.map((comment) => readThreadReply(comment, label)));
        const next = page.endCursor;
        if (!page.hasNextPage) {
            // The root is the first comment GitHub returns, so it is read from the first page only; a
            // later page's first comment is a reply.
            const root = firstPage.nodes[0];
            if (root === undefined) {
                fail(`${label} carries no root comment`);
            }
            return {
                threadId: firstPage.threadId,
                isResolved: firstPage.isResolved,
                pullRequestNumber: firstPage.pullRequestNumber,
                head: firstPage.head,
                base: firstPage.base,
                rootComment: readRootComment(root, label),
                replies,
            };
        }
        if (typeof next !== 'string' || next === '' || seen.has(next)) {
            fail(`${label} returned invalid comment pagination`);
        }
        seen.add(next);
        cursor = next;
    }
}

/**
 * `addPullRequestReviewThreadReply` is the mutation that names a thread. The body is this command's
 * rendered record, so the receipt is checked for that exact body rather than for a fixed token.
 */
export function postRepairReply(threadId: string, body: string, clientMutationId: string, gh: Gh): void {
    const query =
        'mutation($threadId:ID!,$body:String!,$clientMutationId:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId,body:$body,clientMutationId:$clientMutationId}){clientMutationId comment{id body}}}';
    const response = graphql(
        gh,
        query,
        ['-f', `threadId=${threadId}`, '-f', `body=${body}`, '-f', `clientMutationId=${clientMutationId}`],
        `repair reply on review thread ${threadId}`
    ) as { data?: { addPullRequestReviewThreadReply?: { clientMutationId?: unknown; comment?: { body?: unknown } } } };
    const receipt = response.data?.addPullRequestReviewThreadReply;
    if (receipt?.clientMutationId !== clientMutationId || receipt.comment?.body !== body) {
        fail(`addPullRequestReviewThreadReply returned an invalid result for ${threadId}`);
    }
}

/** The exit status is the answer: exit 1 is the false answer rather than a failure. */
export function isAncestorExitStatus(status: number | null, stderr: string): boolean {
    if (status === 0) {
        return true;
    }
    if (status === 1) {
        return false;
    }
    throw new Error(stderr.trim() || 'git merge-base --is-ancestor failed');
}

type AncestorSpawn = (
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; encoding: 'utf8'; shell: false }
) => { status: number | null; stderr: string };

/**
 * `git merge-base --is-ancestor` answers with its exit status and writes nothing, so it is spawned
 * directly rather than through a capturing helper. The spawn is injectable so the exit-status
 * reading can be exercised without a repository.
 */
export function shellIsAncestor(
    primaryRoot: string,
    env?: NodeJS.ProcessEnv,
    spawn: AncestorSpawn = spawnSync
): (commit: string, head: string) => boolean {
    return (commit, head) => {
        const result = spawn('git', ['merge-base', '--is-ancestor', commit, head], {
            cwd: primaryRoot,
            env,
            encoding: 'utf8',
            shell: false,
        });
        return isAncestorExitStatus(result.status, result.stderr);
    };
}

export function shellPort(
    session: GhSession,
    cwd: string = process.cwd(),
    capture: typeof spawnCapture = spawnCapture
): RepairReviewFindingPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[]) => capture('gh', args, { cwd: primaryRoot, env: session.env });
    return {
        readThread: (threadId) => readRepairReviewThread(threadId, gh),
        postReply: (threadId, body, clientMutationId) => postRepairReply(threadId, body, clientMutationId, gh),
        readEvidenceFile: (path) => readFileSync(path, 'utf8'),
        isAncestor: shellIsAncestor(primaryRoot, session.env),
        log: (message) => {
            console.log(message);
        },
    };
}

export type RepairReviewFindingAuthentication = {
    minted: { actorNodeId: string };
    session: GhSession;
};

export type RepairReviewFindingCoordinatorDependencies = {
    primaryRoot: () => string;
    authenticateAuthor: (primaryRoot: string) => Promise<RepairReviewFindingAuthentication>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    port: (session: GhSession, primaryRoot: string) => RepairReviewFindingPort;
    repair: (number: number, input: RepairReviewFindingInput, port: RepairReviewFindingPort) => string;
};

export function defaultRepairReviewFindingCoordinatorDependencies(): RepairReviewFindingCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        authenticateAuthor: (primaryRoot) => authenticateRole({ primaryRoot, role: 'author' }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        port: (session, primaryRoot) => shellPort(session, primaryRoot, spawnCapture),
        repair: repairReviewFinding,
    };
}

export async function coordinateRepairReviewFinding(
    number: number,
    input: RepairReviewFindingInput,
    dependencies: RepairReviewFindingCoordinatorDependencies = defaultRepairReviewFindingCoordinatorDependencies()
): Promise<void> {
    const primaryRoot = dependencies.primaryRoot();
    const auth = await dependencies.authenticateAuthor(primaryRoot);
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
        dependencies.repair(number, input, dependencies.port(auth.session, primaryRoot));
    } finally {
        auth.session.dispose();
    }
}

export async function runRepairReviewFindingCli(
    args: string[],
    dependencies?: RepairReviewFindingCoordinatorDependencies
): Promise<number> {
    const parsed = parseRepairReviewFindingArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${REPAIR_USAGE.slice('usage: '.length)}`);
        return 0;
    }
    if (
        parsed.number === undefined ||
        parsed.threadId === undefined ||
        parsed.head === undefined ||
        parsed.commit === undefined ||
        parsed.summary === undefined
    ) {
        fail(REPAIR_USAGE);
    }
    const input: RepairReviewFindingInput = {
        threadId: parsed.threadId,
        head: parsed.head,
        commit: parsed.commit,
        summary: parsed.summary,
    };
    if (parsed.evidencePath !== undefined) {
        input.evidencePath = parsed.evidencePath;
    }
    await coordinateRepairReviewFinding(parsed.number, input, dependencies);
    return 0;
}
