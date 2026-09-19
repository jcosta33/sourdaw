#!/usr/bin/env node
/**
 * Reviewer-side confirmation of author-recorded repairs for one pull request (#3000).
 *
 * The author records a repair without resolving the thread (`review:repair`); only a head that
 * addresses a finding may resolve it. This command is the reviewer's half: in ONE transaction it
 * resolves exactly those review threads whose recorded repair validates against the live head — the
 * finding must be the thread's own root comment, the repairing commit must be an ancestor of that
 * head, and every record must pass the contract's validation. A thread the selection refuses makes
 * the transaction refuse whole: one ambiguous thread means nothing is resolved, and a re-run is what
 * retries. A failure mid-pass stops at once and leaves earlier resolutions standing, so a re-run
 * ignores the resolved threads and completes the remainder.
 *
 * The confirmation reply carries the confirmed record's canonical form on the contract's own marker
 * line, so a later reader reconstructs which record was accepted from the same bytes
 * `parseReviewRepairReply` already reads. Both mutations carry an id derived from the pr, thread and
 * head, never from a clock or a random source, so a replay repeats the identical request.
 */

import { spawnSync } from 'node:child_process';

import {
    AUTHOR_BOT_NODE_ID,
    REVIEWER_BOT_NODE_ID,
    assertRequiredRepository,
    authenticateRole,
    isReviewerBotNodeId,
    parseGraphqlResponse,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import {
    confirmClientMutationId,
    renderReviewRepairReply,
    selectEligibleRepairs,
    type ReviewRepairRecord,
    type ReviewRepairSelection,
    type ReviewRepairThreadState,
} from './reviewRepair.ts';

export const CONFIRM_USAGE = 'usage: pnpm review:confirm <pr-number> --head <full-sha>';

const FORTY_HEX_PATTERN = /^[0-9a-f]{40}$/;
const COMMENT_ID_PATTERN = /^[0-9]+$/;
const GRAPHQL_PAGE_SIZE = 100;

/** One line the reviewer's confirmation reply carries before the contract's record marker. */
const CONFIRMATION_SENTENCE =
    'Confirmed against the current head: the recorded repair validates, so this review thread is resolved.';

export type ConfirmReviewRepairsAuthentication = {
    minted: { actorNodeId: string };
    session: GhSession;
};

export type ConfirmReviewRepairsPort = {
    pullRequestHead(pr: number): string;
    readThreads(pr: number): ReviewRepairThreadState[];
    postConfirmation(thread: string, body: string, clientMutationId: string): void;
    resolve(thread: string, clientMutationId: string): void;
    isAncestor(commit: string, head: string): boolean;
    log(message: string): void;
};

export type ConfirmReviewRepairsCoordinatorDependencies = {
    primaryRoot: () => string;
    authenticateReviewer: (primaryRoot: string) => Promise<ConfirmReviewRepairsAuthentication>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    port: (session: GhSession, primaryRoot: string) => ConfirmReviewRepairsPort;
    confirm: (number: number, head: string, port: ConfirmReviewRepairsPort) => { resolved: string[] };
};

export type ConfirmReviewRepairsArgs = { number?: number; head?: string; help: boolean };

type ConfirmRepair = { thread: string; record: ReviewRepairRecord };

/**
 * `addPullRequestReviewThreadReply` is the mutation that names a thread; `resolveReviewThread` is the
 * one that settles it. A review command cannot hand a rendered body to `review:resolve`, whose only
 * body is the fixed word `Done`.
 */
export function confirmReplyClientMutationId(pr: number, thread: string, head: string): string {
    return `${confirmClientMutationId(pr, thread, head)}:reply`;
}

export function confirmResolveClientMutationId(pr: number, thread: string, head: string): string {
    return `${confirmClientMutationId(pr, thread, head)}:resolve`;
}

/**
 * The confirmation body is a short human sentence plus the contract's own canonical record line, so a
 * later reader reconstructs the accepted record from the exact bytes `parseReviewRepairReply` reads
 * rather than from a second, drifting canonical form.
 */
export function renderConfirmationReply(record: ReviewRepairRecord): string {
    return `${CONFIRMATION_SENTENCE}\n\n${renderReviewRepairReply(record)}`;
}

export function parseConfirmReviewRepairsArgs(args: string[]): ConfirmReviewRepairsArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const [number, headFlag, head] = args;
    if (
        args.length !== 3 ||
        headFlag !== '--head' ||
        number === undefined ||
        head === undefined ||
        !/^[1-9][0-9]*$/.test(number) ||
        !FORTY_HEX_PATTERN.test(head)
    ) {
        fail(CONFIRM_USAGE);
    }
    const parsed = Number(number);
    if (!Number.isSafeInteger(parsed)) {
        fail(CONFIRM_USAGE);
    }
    return { number: parsed, head, help: false };
}

/**
 * Logs every ignored and refused reason as one line, prefixed `<prefix>:<pr>:<thread>:`, so the
 * delivery tooling reads the selection's reasons without parsing prose.
 */
function logReasons(
    prefix: string,
    pr: number,
    entries: { thread: string; reason: string }[],
    log: (line: string) => void
): void {
    for (const entry of entries) {
        log(`${prefix}:${pr}:${entry.thread}:${entry.reason}`);
    }
}

/**
 * The confirmation transaction. The live head is compared before anything is read beyond it, a
 * non-empty refusal list aborts the whole batch, and a mutation failure propagates at once: the lines
 * already logged are the compensation record, and a re-run ignores resolved threads and finishes the
 * remainder.
 */
export function confirmReviewRepairs(
    number: number,
    head: string,
    port: ConfirmReviewRepairsPort
): { resolved: string[] } {
    const live = port.pullRequestHead(number);
    if (live !== head) {
        fail(`head moved: ${live} is not ${head}`);
    }
    const selection: ReviewRepairSelection = selectEligibleRepairs({
        threads: port.readThreads(number),
        pr: number,
        head,
        authorNodeId: AUTHOR_BOT_NODE_ID,
        isAncestor: port.isAncestor,
    });
    logReasons('repair-ignored', number, selection.ignored, port.log);
    if (selection.refused.length > 0) {
        fail(
            `refusing to confirm ${selection.refused.length} review thread(s) on PR #${number}: a refused repair makes the transaction unsafe`
        );
    }
    const confirmed: ConfirmRepair[] = selection.eligible.map((entry) => ({
        thread: entry.thread,
        record: entry.record,
    }));
    for (const entry of confirmed) {
        port.postConfirmation(
            entry.thread,
            renderConfirmationReply(entry.record),
            confirmReplyClientMutationId(number, entry.thread, head)
        );
        port.resolve(entry.thread, confirmResolveClientMutationId(number, entry.thread, head));
        port.log(`repair-confirmed:${number}:${entry.thread}`);
    }
    return { resolved: confirmed.map((entry) => entry.thread) };
}

type Gh = (args: string[]) => string;

function graphql(gh: Gh, query: string, fields: string[], label: string): unknown {
    return parseGraphqlResponse(gh(['api', 'graphql', '-f', `query=${query}`, ...fields]), label);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A narrow type guard rather than `Array.isArray`, whose `any[]` narrowing would carry an unsafe
 * element type through every later read.
 */
function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

/** `gh api graphql` speaks JSON, so a comment id arrives as a string; anything else is unreadable. */
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

function readPath(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`${label} must carry a file path, found ${describeValue(value)}`);
    }
    return value;
}

function readLine(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        fail(`${label} must carry a positive line number, found ${describeValue(value)}`);
    }
    return value;
}

function readReply(comment: unknown, label: string): ReviewRepairThreadState['replies'][number] {
    if (!isRecord(comment) || typeof comment.id !== 'string' || typeof comment.body !== 'string') {
        fail(`${label} returned an unreadable comment`);
    }
    const author = isRecord(comment.author) ? comment.author : {};
    if (typeof author.id !== 'string') {
        fail(`${label} comment ${comment.id} carries no author node id`);
    }
    return { id: Number(comment.id), body: comment.body, authorNodeId: author.id };
}

/**
 * The thread as this command needs it: the root comment supplies the finding the record must bind,
 * and every comment supplies the author identity the selection reads records from. The root must be a
 * numeric database id and carry a position, because a record binds exactly those values.
 */
function readThread(node: unknown, label: string): ReviewRepairThreadState {
    if (!isRecord(node) || typeof node.id !== 'string' || typeof node.isResolved !== 'boolean') {
        fail(`${label} is not a readable pull-request review thread`);
    }
    const comments = node.comments;
    if (!isRecord(comments) || !isUnknownArray(comments.nodes)) {
        fail(`${label} carries no comment connection`);
    }
    const [root, ...rest] = comments.nodes;
    if (!isRecord(root)) {
        fail(`${label} carries no root comment`);
    }
    return {
        thread: node.id,
        resolved: node.isResolved,
        rootCommentId: readCommentId(root.id, `${label} root comment id`),
        rootPath: readPath(root.path, `${label} root comment path`),
        rootLine: readLine(root.line, `${label} root comment line`),
        rootSide: readSide(root.side, `${label} root comment side`),
        replies: [root, ...rest].map((comment) => readReply(comment, label)),
    };
}

const THREAD_COMMENT_FIELDS =
    'nodes{id body path line side author{__typename login ... on Bot{id}} pageInfo{hasNextPage endCursor}}';

/** The cursor is only a variable once a second page exists, so it joins the fields only then. */
function appendCursor(fields: string[], cursor: string | undefined): string[] {
    if (cursor === undefined) {
        return fields;
    }
    return [...fields, '-f', `cursor=${cursor}`];
}

function threadPage(cursor: string | undefined): string {
    const connection = `reviewThreads(first:${GRAPHQL_PAGE_SIZE}${cursor === undefined ? '' : ',after:$cursor'})`;
    const variables = `$owner:String!,$name:String!,$number:Int!${cursor === undefined ? '' : ',$cursor:String!'}`;
    const pullRequest = `pullRequest(number:$number){${connection}{${THREAD_COMMENT_FIELDS}}}`;
    return `query(${variables}){repository(owner:$owner,name:$name){${pullRequest}}}`;
}

type ThreadPage = { threads: ReviewRepairThreadState[]; hasNextPage: boolean; endCursor: string | null };

function readThreadPage(pullRequest: unknown, label: string): ThreadPage {
    if (!isRecord(pullRequest) || !isRecord(pullRequest.reviewThreads)) {
        fail(`${label} is not a readable pull request`);
    }
    const connection = pullRequest.reviewThreads;
    if (!Array.isArray(connection.nodes) || !isRecord(connection.pageInfo)) {
        fail(`${label} carries no review thread connection`);
    }
    const pageInfo = connection.pageInfo;
    if (typeof pageInfo.hasNextPage !== 'boolean') {
        fail(`${label} returned an unreadable review thread page`);
    }
    return {
        threads: connection.nodes.map((node) => readThread(node, label)),
        hasNextPage: pageInfo.hasNextPage,
        endCursor: typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null,
    };
}

/**
 * The repository owner and name are fixed for the run, so they are read once through the same
 * capture the rest of the port uses rather than re-resolved per call.
 */
function repositoryFields(gh: Gh): string[] {
    const nameWithOwner = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    const [owner, name] = nameWithOwner.split('/');
    if (owner === undefined || name === undefined) {
        fail(`repository name ${nameWithOwner} is not owner/name`);
    }
    return ['-f', `owner=${owner}`, '-f', `name=${name}`];
}

export function readReviewThreads(pr: number, gh: Gh, fields: string[]): ReviewRepairThreadState[] {
    const label = `PR #${pr} review threads`;
    const threads: ReviewRepairThreadState[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (;;) {
        const input = appendCursor([...fields, '-f', `number=${pr}`], cursor);
        const response = graphql(gh, threadPage(cursor), input, label) as {
            data?: { repository?: { pullRequest?: unknown } };
        };
        const page = readThreadPage(response.data?.repository?.pullRequest, label);
        threads.push(...page.threads);
        if (!page.hasNextPage) {
            return threads;
        }
        const next = page.endCursor;
        if (next === null || next === '' || seen.has(next)) {
            fail(`${label} returned invalid thread pagination`);
        }
        seen.add(next);
        cursor = next;
    }
}

export function readPullRequestHead(pr: number, gh: Gh, fields: string[]): string {
    const label = `PR #${pr} head`;
    const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid}}}`;
    const response = graphql(gh, query, [...fields, '-f', `number=${pr}`], label) as {
        data?: { repository?: { pullRequest?: { headRefOid?: unknown } } };
    };
    const head = response.data?.repository?.pullRequest?.headRefOid;
    if (typeof head !== 'string') {
        fail(`${label} is not a readable pull request head`);
    }
    return head;
}

/**
 * `addPullRequestReviewThreadReply` is the mutation that names a thread. The body is this command's
 * confirmation, so the receipt is checked for that exact body rather than for a fixed token.
 */
export function postConfirmationReply(threadId: string, body: string, clientMutationId: string, gh: Gh): void {
    const query =
        'mutation($threadId:ID!,$body:String!,$clientMutationId:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId,body:$body,clientMutationId:$clientMutationId}){clientMutationId comment{id body}}}';
    const response = graphql(
        gh,
        query,
        ['-f', `threadId=${threadId}`, '-f', `body=${body}`, '-f', `clientMutationId=${clientMutationId}`],
        `confirmation reply on review thread ${threadId}`
    ) as { data?: { addPullRequestReviewThreadReply?: { clientMutationId?: unknown; comment?: { body?: unknown } } } };
    const receipt = response.data?.addPullRequestReviewThreadReply;
    if (receipt?.clientMutationId !== clientMutationId || receipt.comment?.body !== body) {
        fail(`addPullRequestReviewThreadReply returned an invalid result for ${threadId}`);
    }
}

export function resolveConfirmedThread(threadId: string, clientMutationId: string, gh: Gh): void {
    const query =
        'mutation($threadId:ID!,$clientMutationId:String!){resolveReviewThread(input:{threadId:$threadId,clientMutationId:$clientMutationId}){clientMutationId thread{id isResolved}}}';
    const response = graphql(
        gh,
        query,
        ['-f', `threadId=${threadId}`, '-f', `clientMutationId=${clientMutationId}`],
        `resolve review thread ${threadId}`
    ) as { data?: { resolveReviewThread?: { clientMutationId?: unknown; thread?: { id?: unknown } } } };
    const receipt = response.data?.resolveReviewThread;
    if (receipt?.clientMutationId !== clientMutationId || receipt.thread?.id !== threadId) {
        fail(`resolveReviewThread returned an invalid result for ${threadId}`);
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
 * directly rather than through a capturing helper. The spawn is injectable so the exit-status reading
 * can be exercised without a repository.
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
): ConfirmReviewRepairsPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[]) => capture('gh', args, { cwd: primaryRoot, env: session.env });
    const fields = repositoryFields(gh);
    return {
        pullRequestHead: (pr) => readPullRequestHead(pr, gh, fields),
        readThreads: (pr) => readReviewThreads(pr, gh, fields),
        postConfirmation: (thread, body, clientMutationId) => postConfirmationReply(thread, body, clientMutationId, gh),
        resolve: (thread, clientMutationId) => resolveConfirmedThread(thread, clientMutationId, gh),
        isAncestor: shellIsAncestor(primaryRoot, session.env),
        log: (message) => {
            console.log(message);
        },
    };
}

export function defaultConfirmReviewRepairsCoordinatorDependencies(): ConfirmReviewRepairsCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        authenticateReviewer: (primaryRoot) => authenticateRole({ primaryRoot, role: 'reviewer' }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        port: (session, primaryRoot) => shellPort(session, primaryRoot, spawnCapture),
        confirm: confirmReviewRepairs,
    };
}

export async function coordinateConfirmReviewRepairs(
    number: number,
    head: string,
    dependencies: ConfirmReviewRepairsCoordinatorDependencies = defaultConfirmReviewRepairsCoordinatorDependencies()
): Promise<void> {
    const primaryRoot = dependencies.primaryRoot();
    const auth = await dependencies.authenticateReviewer(primaryRoot);
    try {
        if (!isReviewerBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${REVIEWER_BOT_NODE_ID}`);
        }
        assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
        dependencies.confirm(number, head, dependencies.port(auth.session, primaryRoot));
    } finally {
        auth.session.dispose();
    }
}

export async function runConfirmReviewRepairsCli(
    args: string[],
    dependencies?: ConfirmReviewRepairsCoordinatorDependencies
): Promise<number> {
    const parsed = parseConfirmReviewRepairsArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${CONFIRM_USAGE.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.number === undefined || parsed.head === undefined) {
        fail(CONFIRM_USAGE);
    }
    await coordinateConfirmReviewRepairs(parsed.number, parsed.head, dependencies);
    return 0;
}
