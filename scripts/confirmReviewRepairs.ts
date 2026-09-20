#!/usr/bin/env node
/**
 * Reviewer-side confirmation of author-recorded repairs for one pull request (#3000).
 *
 * The author records a repair without resolving the thread (`review:repair`); only a head that
 * addresses a finding may resolve it. This command is the reviewer's half: in ONE transaction it
 * resolves exactly those review threads whose recorded repair validates against the live head — the
 * finding must be the thread's own root comment, the repairing commit must lie inside the reviewed
 * range (an ancestor of that head and not of the pull request's base), and every record must pass the
 * contract's validation. A thread the selection refuses makes
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
    CONFIRM_REVIEWER_MINT_PERMISSIONS,
    REVIEWER_BOT_NODE_ID,
    assertRequiredRepository,
    authenticateRole,
    isReviewerBotNodeId,
    parseGraphqlResponse,
    resolvePrimaryRoot,
    spawnCapture,
    type FileReader,
    type GhSession,
    type GitHubJsonClient,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import {
    REVIEW_THREAD_COMMENT_FIELDS,
    confirmClientMutationId,
    parseReviewRepairReply,
    readCommentDatabaseId,
    readFindingLine,
    readFindingReviewedHead,
    renderReviewRepairReply,
    selectEligibleRepairs,
    type ReviewRepairRecord,
    type ReviewRepairSelection,
    type ReviewRepairThreadState,
} from './reviewRepair.ts';

export const CONFIRM_USAGE = 'usage: pnpm review:confirm <pr-number> --head <full-sha>';

const FORTY_HEX_PATTERN = /^[0-9a-f]{40}$/;
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
    pullRequestBase(pr: number): string;
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
    const base = port.pullRequestBase(number);
    const threads = port.readThreads(number);
    const selection: ReviewRepairSelection = selectEligibleRepairs({
        threads,
        pr: number,
        head,
        base,
        authorNodeId: AUTHOR_BOT_NODE_ID,
        reviewerNodeId: REVIEWER_BOT_NODE_ID,
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
    const threadsById = new Map(threads.map((thread) => [thread.thread, thread] as const));
    for (const entry of confirmed) {
        if (!confirmationAlreadyPosted(threadsById.get(entry.thread), entry.record)) {
            port.postConfirmation(
                entry.thread,
                renderConfirmationReply(entry.record),
                confirmReplyClientMutationId(number, entry.thread, head)
            );
        }
        port.resolve(entry.thread, confirmResolveClientMutationId(number, entry.thread, head));
        port.log(`repair-confirmed:${number}:${entry.thread}`);
    }
    return { resolved: confirmed.map((entry) => entry.thread) };
}

/**
 * GitHub echoes the deterministic `clientMutationId` rather than deduplicating the reply, so a rerun
 * after a failed resolve would post the confirmation a second time. The posted reply itself is the
 * state that proves the first post landed: an unresolved thread that already carries this reviewer's
 * confirmation for the same record performs only the missing resolve. The record is compared parsed,
 * exactly as the selection's refusal compares it, so a bare marker line counts as already posted
 * rather than earning a second reply.
 */
function confirmationAlreadyPosted(thread: ReviewRepairThreadState | undefined, record: ReviewRepairRecord): boolean {
    if (thread === undefined) {
        return false;
    }
    const accepted = renderReviewRepairReply(record);
    return thread.replies.some(
        (reply) => isReviewerBotNodeId(reply.authorNodeId) && parsesToReplyRecord(reply.body, accepted)
    );
}

/** A body that carries a marker the contract can read back to exactly the accepted record. */
function parsesToReplyRecord(body: string, accepted: string): boolean {
    const posted = parseReviewRepairReply(body);
    return posted !== undefined && renderReviewRepairReply(posted) === accepted;
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

/**
 * Only a Bot comment can be an author or reviewer reply. A person's actor node carries no id in the
 * shared fragment, and reading that prose as an agent reply would let a human comment become a repair
 * record, so a non-Bot author is read as a reply no selection acts on. GitHub reports a deleted
 * account as a null author, which is the same dead end rather than an unreadable thread. A Bot comment
 * without an id still refuses, because the selection tells the two agent identities apart by exactly
 * that id.
 */
function readReply(comment: unknown, label: string): ReviewRepairThreadState['replies'][number] {
    if (!isRecord(comment) || typeof comment.id !== 'string' || typeof comment.body !== 'string') {
        fail(`${label} returned an unreadable comment`);
    }
    const id = readCommentDatabaseId(comment.databaseId, `${label} comment ${comment.id} id`);
    const author = isRecord(comment.author) ? comment.author : {};
    if (author.__typename === 'Bot') {
        if (typeof author.id !== 'string') {
            fail(`${label} comment ${comment.id} carries no author node id`);
        }
        return { id, body: comment.body, authorNodeId: author.id };
    }
    return { id, body: comment.body, authorNodeId: null };
}

/** A listed thread plus the cursor of its unread comment pages, when the first page was truncated. */
type ListedThread = { state: ReviewRepairThreadState; commentCursor: string | null };

function readCommentCursor(comments: Record<string, unknown>, label: string): string | null {
    const pageInfo = comments.pageInfo;
    if (!isRecord(pageInfo) || typeof pageInfo.hasNextPage !== 'boolean') {
        fail(`${label} carries no comment page info`);
    }
    if (!pageInfo.hasNextPage) {
        return null;
    }
    if (typeof pageInfo.endCursor !== 'string' || pageInfo.endCursor === '') {
        fail(`${label} returned invalid comment pagination`);
    }
    return pageInfo.endCursor;
}

/**
 * The thread as this command needs it: the root comment supplies the finding's database id, path and
 * line, the thread's own `diffSide` supplies its side, and every comment supplies the author identity
 * the selection reads records from. The root must be a numeric database id and carry a position —
 * the live line, or the original line once GitHub nulls the live one for an outdated diff — because a
 * record binds exactly those values.
 */
function readThread(node: unknown, label: string): ListedThread {
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
        state: {
            thread: node.id,
            resolved: node.isResolved,
            rootCommentId: readCommentDatabaseId(root.databaseId, `${label} root comment id`),
            rootPath: readPath(root.path, `${label} root comment path`),
            rootLine: readFindingLine(root.line, root.originalLine, `${label} root comment line`),
            rootSide: readSide(node.diffSide, `${label} diff side`),
            rootReviewedHead: readFindingReviewedHead(root.pullRequestReview, `${label} root comment`),
            replies: [root, ...rest].map((comment) => readReply(comment, label)),
        },
        commentCursor: readCommentCursor(comments, label),
    };
}

/** The cursor is only a variable once a second page exists, so it joins the fields only then. */
function appendCursor(fields: string[], cursor: string | undefined): string[] {
    if (cursor === undefined) {
        return fields;
    }
    return [...fields, '-f', `cursor=${cursor}`];
}

/**
 * The GraphQL argument list every pull request reader sends. `number` is this module's only typed
 * variable, and it must ride `-F`: `-f` sends a JSON string, which GitHub refuses against the
 * `Int!` these queries declare, so every reviewer read fails with an invalid-value error. The
 * repository fields stay on `-f` because `owner` and `name` are `String!`.
 */
export function pullRequestNumberArgs(fields: string[], pr: number): string[] {
    return [...fields, '-F', `number=${pr}`];
}

/**
 * The thread page selects what `readThread` needs: the thread's own `isResolved` and `diffSide`, and
 * its comment connection, where the shared *comment* fragment nests. Each connection carries its own
 * `pageInfo`, because `ReviewThreadsPageInfo` and `PageInfo` are different selections on different
 * connections.
 */
export function threadPage(cursor: string | undefined): string {
    const paged = cursor !== undefined;
    const connection = `reviewThreads(first:${GRAPHQL_PAGE_SIZE}${paged ? ',after:$cursor' : ''})`;
    const variables = `$owner:String!,$name:String!,$number:Int!${paged ? ',$cursor:String!' : ''}`;
    const comments = `comments(first:${GRAPHQL_PAGE_SIZE}){${REVIEW_THREAD_COMMENT_FIELDS}}`;
    const threadFields = `nodes{id isResolved diffSide ${comments}} pageInfo{hasNextPage endCursor}`;
    const pullRequest = `pullRequest(number:$number){${connection}{${threadFields}}}`;
    return `query(${variables}){repository(owner:$owner,name:$name){${pullRequest}}}`;
}

type ThreadPage = { threads: ListedThread[]; hasNextPage: boolean; endCursor: string | null };

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
 * The single-thread query that drains a thread whose comment connection exceeds one page. It names
 * the thread node directly — the same connection the author-side reader paginates — because the
 * repository listing already carried that thread's first comment page.
 */
export function threadCommentsPage(): string {
    return `query($threadId:ID!,$cursor:String!){node(id:$threadId){... on PullRequestReviewThread{comments(first:${GRAPHQL_PAGE_SIZE},after:$cursor){${REVIEW_THREAD_COMMENT_FIELDS}}}}}`;
}

/**
 * Reads a thread's remaining comment pages before the selection sees it. A repair recorded past the
 * hundredth comment would otherwise make the thread look like it recorded none, so the connection is
 * drained rather than truncated. A page that claims another while returning no comment nodes would
 * drain forever, so it refuses instead.
 */
function drainComments(listed: ListedThread, gh: Gh, label: string): ReviewRepairThreadState {
    const replies = [...listed.state.replies];
    const seen = new Set<string>();
    let cursor = listed.commentCursor;
    while (cursor !== null) {
        if (seen.has(cursor)) {
            fail(`${label} returned invalid comment pagination`);
        }
        seen.add(cursor);
        const input = ['-f', `threadId=${listed.state.thread}`, '-f', `cursor=${cursor}`];
        const response = graphql(gh, threadCommentsPage(), input, label);
        const node = isRecord(response) && isRecord(response.data) ? response.data.node : undefined;
        if (!isRecord(node) || !isRecord(node.comments) || !isUnknownArray(node.comments.nodes)) {
            fail(`${label} carries no comment connection`);
        }
        const nodes = node.comments.nodes;
        replies.push(...nodes.map((comment) => readReply(comment, label)));
        cursor = readCommentCursor(node.comments, label);
        if (nodes.length === 0 && cursor !== null) {
            fail(`${label} returned an empty comment page while claiming another`);
        }
    }
    return { ...listed.state, replies };
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
        const input = appendCursor(pullRequestNumberArgs(fields, pr), cursor);
        const response = graphql(gh, threadPage(cursor), input, label) as {
            data?: { repository?: { pullRequest?: unknown } };
        };
        const page = readThreadPage(response.data?.repository?.pullRequest, label);
        threads.push(...page.threads.map((listed) => drainComments(listed, gh, label)));
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
    const response = graphql(gh, query, pullRequestNumberArgs(fields, pr), label) as {
        data?: { repository?: { pullRequest?: { headRefOid?: unknown } } };
    };
    const head = response.data?.repository?.pullRequest?.headRefOid;
    if (typeof head !== 'string') {
        fail(`${label} is not a readable pull request head`);
    }
    return head;
}

/**
 * The pull request's live base. A repairing commit outside `base..head` is a pre-pull-request commit
 * (the merge base and anything below it), so the recorder and the selection refuse it.
 */
export function readPullRequestBase(pr: number, gh: Gh, fields: string[]): string {
    const label = `PR #${pr} base`;
    const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){baseRefOid}}}`;
    const response = graphql(gh, query, pullRequestNumberArgs(fields, pr), label) as {
        data?: { repository?: { pullRequest?: { baseRefOid?: unknown } } };
    };
    const base = response.data?.repository?.pullRequest?.baseRefOid;
    if (typeof base !== 'string') {
        fail(`${label} is not a readable pull request base`);
    }
    return base;
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
        pullRequestBase: (pr) => readPullRequestBase(pr, gh, fields),
        readThreads: (pr) => readReviewThreads(pr, gh, fields),
        postConfirmation: (thread, body, clientMutationId) => postConfirmationReply(thread, body, clientMutationId, gh),
        resolve: (thread, clientMutationId) => resolveConfirmedThread(thread, clientMutationId, gh),
        isAncestor: shellIsAncestor(primaryRoot, session.env),
        log: (message) => {
            console.log(message);
        },
    };
}

/**
 * Confirm's reviewer identity. Resolving a thread is a repository write on GitHub's side, so this
 * mint carries contents write, which the plain reviewer mint (publication only) deliberately omits.
 */
export async function authenticateConfirmReviewer(
    primaryRoot: string,
    readFile?: FileReader,
    request?: GitHubJsonClient,
    env?: NodeJS.ProcessEnv
): Promise<ConfirmReviewRepairsAuthentication> {
    const auth = await authenticateRole({
        primaryRoot,
        role: 'reviewer',
        permissions: CONFIRM_REVIEWER_MINT_PERMISSIONS,
        readFile,
        request,
        env,
    });
    return { minted: auth.minted, session: auth.session };
}

export function defaultConfirmReviewRepairsCoordinatorDependencies(): ConfirmReviewRepairsCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        authenticateReviewer: authenticateConfirmReviewer,
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
