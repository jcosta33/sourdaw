#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_NODE_ID,
    REQUIRED_REPOSITORY,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isAuthorBotNodeId,
    originMainBlob,
    parseGraphqlResponse,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail, supersessionCommentBody } from './prContract.ts';

export type IssueComment = {
    id: string;
    fullDatabaseId: string;
    body: string;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
};
export type SupersededPullRequest = {
    number: number;
    state: string;
    head: string;
    repository: string;
    base: string;
    closedAt: string | null;
    comments: IssueComment[];
};
export type PullRequestCloseReceipt = { closedAt: string };
export type AddedIssueCommentReceipt = IssueComment & { clientMutationId: string };
export type SupersedePullRequestPort = {
    inspect: (number: number) => SupersededPullRequest;
    comment: (number: number, body: string) => AddedIssueCommentReceipt;
    close: (number: number) => PullRequestCloseReceipt;
    deleteComment: (id: string) => void;
    log: (message: string) => void;
};
export type SupersedePullRequestArgs = { oldNumber?: number; head?: string; replacementNumber?: number; help: boolean };
const usage = 'usage: pnpm pr:supersede <old-pr-number> --head <40-hex-sha> --replacement <merged-pr-number>';

export function parseSupersedePullRequestArgs(args: string[]): SupersedePullRequestArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    if (
        args.length !== 5 ||
        args[1] !== '--head' ||
        args[3] !== '--replacement' ||
        args[0] === undefined ||
        args[2] === undefined ||
        args[4] === undefined ||
        !/^[1-9][0-9]*$/.test(args[0]) ||
        !/^[0-9a-f]{40}$/i.test(args[2]) ||
        !/^[1-9][0-9]*$/.test(args[4])
    ) {
        fail(usage);
    }
    const oldNumber = Number(args[0]);
    const replacementNumber = Number(args[4]);
    if (
        !Number.isSafeInteger(oldNumber) ||
        !Number.isSafeInteger(replacementNumber) ||
        oldNumber === replacementNumber
    ) {
        fail(usage);
    }
    return { oldNumber, head: args[2], replacementNumber, help: false };
}

export function supersedePullRequest(
    oldNumber: number,
    expectedHead: string,
    replacementNumber: number,
    authorNodeId: string,
    port: SupersedePullRequestPort
): string {
    if (!isAuthorBotNodeId(authorNodeId)) {
        fail(`authenticated author actor ${authorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
    }
    if (oldNumber === replacementNumber) {
        fail('replacement pull request must differ from the old pull request');
    }
    const before = port.inspect(oldNumber);
    const replacement = port.inspect(replacementNumber);
    assertOldBinding(before, oldNumber, expectedHead);
    assertReplacement(replacement, replacementNumber, before);
    const body = supersessionCommentBody(replacementNumber);
    if (before.state === 'CLOSED') {
        assertCompletedSupersession(before, oldNumber, expectedHead, before.base, body);
        return logSupersessionSuccess(oldNumber, replacementNumber, port);
    }
    assertOpen(before, oldNumber);
    let commentAttempted = false;
    let commentCreated = false;
    let createdCommentId: string | undefined;
    let commentId: string | undefined;
    let closeAttempted = false;
    let closeReceipt: PullRequestCloseReceipt | undefined;
    try {
        const existingComment = findReusableComment(before.comments, body);
        if (existingComment === undefined) {
            commentAttempted = true;
            const comment = port.comment(oldNumber, body);
            commentId = assertCommentReceipt(comment, commentClientMutationId(oldNumber, body));
            assertCommentBody(comment, body);
            commentCreated = true;
            createdCommentId = comment.id;
        } else {
            commentId = existingComment.id;
        }
        const afterComment = port.inspect(oldNumber);
        assertStableOpen(afterComment, oldNumber, expectedHead, before.base);
        commentId = convergeCommentMarkers(oldNumber, body, afterComment, port);
        const converged = port.inspect(oldNumber);
        assertStableOpen(converged, oldNumber, expectedHead, before.base);
        commentId = requireOneCommentMarker(converged.comments, body, oldNumber).id;
        closeAttempted = true;
        const receipt = port.close(oldNumber);
        assertCloseReceipt(receipt);
        closeReceipt = receipt;
        const verified = port.inspect(oldNumber);
        assertFinalSupersession(verified, oldNumber, expectedHead, before.base, commentId, body, closeReceipt);
    } catch (error) {
        compensateSupersession(
            oldNumber,
            before,
            body,
            commentAttempted,
            commentCreated,
            createdCommentId,
            closeAttempted,
            closeReceipt,
            port,
            error
        );
    }
    return logSupersessionSuccess(oldNumber, replacementNumber, port);
}

function logSupersessionSuccess(oldNumber: number, replacementNumber: number, port: SupersedePullRequestPort): string {
    const success = `pull-request-superseded:${oldNumber}:${replacementNumber}`;
    port.log(success);
    return success;
}

function compensateSupersession(
    number: number,
    before: SupersededPullRequest,
    expectedCommentBody: string,
    commentAttempted: boolean,
    commentCreated: boolean,
    createdCommentId: string | undefined,
    closeAttempted: boolean,
    closeReceipt: PullRequestCloseReceipt | undefined,
    port: SupersedePullRequestPort,
    original: unknown
): never {
    const failures: string[] = [];
    let current: SupersededPullRequest | undefined;
    attempt(failures, 'inspect ambiguous supersession transaction', () => {
        current = port.inspect(number);
    });
    if (current === undefined) {
        failures.push('cannot determine ambiguous supersession transaction state');
    } else {
        const stateMayHaveMutated = closeReceipt !== undefined || closeAttempted;
        if (stateMayHaveMutated) {
            failures.push('pull-request closure was attempted; preserving supersession comment as durable evidence');
        }
        if (!closeAttempted && current.state === 'CLOSED' && commentCreated && createdCommentId !== undefined) {
            deleteCreatedNoncanonicalComment(current.comments, expectedCommentBody, createdCommentId, port, failures);
        } else if (commentAttempted && !commentCreated) {
            failures.push('ambiguous supersession comment mutation; refusing to delete an unverified comment');
        } else if (commentCreated && !stateMayHaveMutated && current.state === before.state) {
            if (createdCommentId === undefined) {
                failures.push('ambiguous supersession comment mutation; refusing to delete an unverified comment');
            } else if (hasExpectedComment(current.comments, createdCommentId, expectedCommentBody)) {
                attempt(failures, 'delete supersession comment', () => port.deleteComment(createdCommentId));
            } else if (current.comments.some((comment) => comment.id === createdCommentId)) {
                failures.push(
                    'supersession comment receipt is no longer present; refusing to delete an unverified comment'
                );
            }
        }
    }
    if (current !== undefined && current.state === before.state && closeReceipt === undefined) {
        attempt(failures, 'verify supersession compensation', () => {
            const verified = port.inspect(number);
            if (verified.state !== before.state || !sameCommentIds(verified.comments, before.comments)) {
                fail(`PR #${number} compensation was not verified`);
            }
        });
    }
    throwWithCompensation(original, failures);
}
function sameCommentIds(left: IssueComment[], right: IssueComment[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const ids = new Set(left.map((comment) => comment.id));
    return ids.size === right.length && right.every((comment) => ids.has(comment.id));
}
function throwWithCompensation(original: unknown, failures: string[]): never {
    const message = errorMessage(original);
    if (failures.length > 0) {
        throw new Error(`${message}; compensation failed: ${failures.join('; ')}`, { cause: original });
    }
    if (original instanceof Error) {
        throw original;
    }
    throw new Error(message);
}
function attempt(failures: string[], label: string, operation: () => void): void {
    try {
        operation();
    } catch (error) {
        failures.push(`${label}: ${errorMessage(error)}`);
    }
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
function assertOldBinding(value: SupersededPullRequest, number: number, head: string): void {
    if (value.number !== number || value.repository !== REQUIRED_REPOSITORY) {
        fail(`cannot inspect PR #${number} in ${REQUIRED_REPOSITORY}`);
    }
    if (value.head !== head) {
        fail('supplied head does not match the current pull-request head');
    }
}
function assertOpen(value: SupersededPullRequest, number: number): void {
    if (value.state !== 'OPEN') {
        fail(`PR #${number} is ${value.state.toLowerCase()}`);
    }
}
function assertReplacement(value: SupersededPullRequest, number: number, old: SupersededPullRequest): void {
    if (value.number !== number || value.repository !== REQUIRED_REPOSITORY || value.repository !== old.repository) {
        fail(`replacement PR #${number} is not in the required repository`);
    }
    if (value.state !== 'MERGED') {
        fail(`replacement PR #${number} is not merged`);
    }
    if (value.base !== old.base) {
        fail(`replacement PR #${number} does not target ${old.base}`);
    }
}
function assertStableOpen(value: SupersededPullRequest, number: number, head: string, base: string): void {
    if (
        value.number !== number ||
        value.repository !== REQUIRED_REPOSITORY ||
        value.state !== 'OPEN' ||
        value.base !== base
    ) {
        fail(`PR #${number} changed after supersession comment; compensating`);
    }
    if (value.head !== head) {
        fail('pull-request head moved after mutation; compensating');
    }
}
function assertCloseReceipt(receipt: PullRequestCloseReceipt): void {
    if (typeof receipt.closedAt !== 'string' || receipt.closedAt === '') {
        fail('closePullRequest returned an invalid result');
    }
}
function commentClientMutationId(number: number, body: string): string {
    return `supersede-comment:${number}:${body}`;
}
function closeClientMutationId(pullRequestId: string): string {
    return `supersede-close:${pullRequestId}`;
}
function isAuthorBotActor(nodeId: unknown, type: unknown): boolean {
    return type === 'Bot' && typeof nodeId === 'string' && isAuthorBotNodeId(nodeId);
}
function hasExpectedComment(comments: IssueComment[], id: string, body: string): boolean {
    return comments.some(
        (comment) =>
            comment.id === id && comment.body === body && isAuthorBotActor(comment.authorNodeId, comment.authorType)
    );
}
function validatedCommentMarkers(comments: IssueComment[], body: string): IssueComment[] {
    const owned = comments.filter((comment) => isAuthorBotNodeId(comment.authorNodeId));
    for (const comment of owned) {
        if (
            !isDecimalId(comment.fullDatabaseId) ||
            comment.body !== body ||
            !isAuthorBotActor(comment.authorNodeId, comment.authorType)
        ) {
            fail('owned supersession marker is not an exact author-bot receipt');
        }
    }
    return owned.sort(compareMarkers);
}
function compareMarkers(left: IssueComment, right: IssueComment): number {
    // The smallest decimal fullDatabaseId, then node ID, is the canonical concurrent marker.
    const difference = BigInt(left.fullDatabaseId) - BigInt(right.fullDatabaseId);
    if (difference === 0n) {
        return left.id.localeCompare(right.id);
    }
    return difference < 0n ? -1 : 1;
}
function requireOneCommentMarker(comments: IssueComment[], body: string, number: number): IssueComment {
    const markers = validatedCommentMarkers(comments, body);
    const [marker] = markers;
    if (marker === undefined || markers.length !== 1) {
        fail(`PR #${number} does not have exactly one valid supersession comment marker`);
    }
    return marker;
}
function requireOneOrMoreCommentMarker(comments: IssueComment[], body: string, number: number): IssueComment {
    const [marker] = validatedCommentMarkers(comments, body);
    if (marker === undefined) {
        fail(`PR #${number} has no valid supersession comment marker`);
    }
    return marker;
}
function convergeCommentMarkers(
    number: number,
    body: string,
    value: SupersededPullRequest,
    port: SupersedePullRequestPort
): string {
    const canonical = requireOneOrMoreCommentMarker(value.comments, body, number);
    for (const marker of validatedCommentMarkers(value.comments, body)) {
        if (marker.id !== canonical.id) {
            port.deleteComment(marker.id);
        }
    }
    return canonical.id;
}
function deleteCreatedNoncanonicalComment(
    comments: IssueComment[],
    body: string,
    createdCommentId: string,
    port: SupersedePullRequestPort,
    failures: string[]
): void {
    let canonical: IssueComment;
    try {
        canonical = requireOneOrMoreCommentMarker(comments, body, 0);
    } catch (error) {
        failures.push(`inspect concurrent supersession markers: ${errorMessage(error)}`);
        return;
    }
    if (canonical.id === createdCommentId || !hasExpectedComment(comments, createdCommentId, body)) {
        failures.push("concurrent closure retained this invocation's canonical or unverified supersession comment");
        return;
    }
    attempt(failures, 'delete noncanonical supersession comment', () => port.deleteComment(createdCommentId));
}
function findReusableComment(comments: IssueComment[], body: string): IssueComment | undefined {
    const markers = validatedCommentMarkers(comments, body);
    if (markers.length === 0) {
        return undefined;
    }
    return markers[0];
}
function assertFinalSupersession(
    value: SupersededPullRequest,
    number: number,
    head: string,
    base: string,
    commentId: string,
    body: string,
    closeReceipt: PullRequestCloseReceipt
): void {
    if (value.number !== number || value.repository !== REQUIRED_REPOSITORY || value.head !== head) {
        fail('pull-request head moved after mutation; compensating');
    }
    if (value.base !== base) {
        fail('pull-request base changed after mutation; compensating');
    }
    if (value.state !== 'CLOSED' || value.closedAt !== closeReceipt.closedAt) {
        fail(`PR #${number} was closed by another actor`);
    }
    if (!hasExpectedComment(value.comments, commentId, body)) {
        fail(`supersession comment receipt ${commentId} is not present on PR #${number}`);
    }
    requireOneCommentMarker(value.comments, body, number);
}
function assertCompletedSupersession(
    value: SupersededPullRequest,
    number: number,
    head: string,
    base: string,
    body: string
): void {
    if (
        value.number !== number ||
        value.repository !== REQUIRED_REPOSITORY ||
        value.head !== head ||
        value.base !== base ||
        value.state !== 'CLOSED'
    ) {
        fail(`PR #${number} is not the expected completed supersession`);
    }
    requireOneCommentMarker(value.comments, body, number);
}
function isDecimalId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
}
function assertCommentReceipt(value: AddedIssueCommentReceipt, expectedClientMutationId: string): string {
    if (
        typeof value.id !== 'string' ||
        value.id === '' ||
        !isDecimalId(value.fullDatabaseId) ||
        !isAuthorBotActor(value.authorNodeId, value.authorType) ||
        value.clientMutationId !== expectedClientMutationId
    ) {
        fail('add supersession comment returned an invalid result');
    }
    return value.id;
}
function assertCommentBody(value: IssueComment, expectedBody: string): void {
    if (value.body !== expectedBody) {
        fail('add supersession comment returned an invalid result');
    }
}

export function shellPort(session: GhSession, cwd: string = process.cwd()): SupersedePullRequestPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[]) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    const ids = new Map<number, string>();
    const nodeId = (number: number) => ids.get(number) ?? fail(`PR #${number} was not inspected`);
    return {
        inspect: (number) => inspectPullRequest(number, gh, ids),
        comment: (number, body) => addComment(nodeId(number), body, commentClientMutationId(number, body), gh),
        close: (number) => closePullRequest(nodeId(number), gh),
        deleteComment: (id) => deleteComment(id, gh),
        log: (message) => console.log(message),
    };
}
type Gh = (args: string[]) => string;
function graphql(gh: Gh, query: string, fields: string[], label: string): unknown {
    return parseGraphqlResponse(gh(['api', 'graphql', '-f', `query=${query}`, ...fields]), label);
}
function inspectPullRequest(number: number, gh: Gh, ids: Map<number, string>): SupersededPullRequest {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    const query =
        'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){nameWithOwner pullRequest(number:$number){id number state headRefOid baseRefName closedAt}}}';
    const response = graphql(
        gh,
        query,
        ['-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`],
        `PR #${number} query`
    ) as {
        data?: {
            repository?: {
                nameWithOwner?: unknown;
                pullRequest?: {
                    id?: unknown;
                    number?: unknown;
                    state?: unknown;
                    headRefOid?: unknown;
                    baseRefName?: unknown;
                    closedAt?: unknown;
                };
            };
        };
    };
    const repository = response.data?.repository;
    const pullRequest = repository?.pullRequest;
    if (
        repository?.nameWithOwner !== REQUIRED_REPOSITORY ||
        typeof pullRequest?.id !== 'string' ||
        typeof pullRequest.number !== 'number' ||
        !Number.isSafeInteger(pullRequest.number) ||
        typeof pullRequest.state !== 'string' ||
        typeof pullRequest.headRefOid !== 'string' ||
        typeof pullRequest.baseRefName !== 'string' ||
        (typeof pullRequest.closedAt !== 'string' && pullRequest.closedAt !== null)
    ) {
        fail(`cannot inspect PR #${number}`);
    }
    ids.set(number, pullRequest.id);
    return {
        number: pullRequest.number,
        state: pullRequest.state,
        head: pullRequest.headRefOid,
        repository: repository.nameWithOwner,
        base: pullRequest.baseRefName,
        closedAt: pullRequest.closedAt,
        comments: inspectIssueComments(pullRequest.id, gh),
    };
}
export function inspectIssueComments(subjectId: string, gh: Gh): IssueComment[] {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const comments: IssueComment[] = [];
    for (;;) {
        const connection = cursor === undefined ? 'comments(first:100)' : 'comments(first:100,after:$cursor)';
        const query = `query($subjectId:ID!${cursor === undefined ? '' : ',$cursor:String!'}){node(id:$subjectId){id ... on PullRequest{${connection}{nodes{id fullDatabaseId body author{login __typename ... on Bot{id}}} pageInfo{hasNextPage endCursor}}}}}`;
        const fields = ['-F', `subjectId=${subjectId}`];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `issue comments for ${subjectId}`) as {
            data?: {
                node?: {
                    id?: unknown;
                    comments?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                } | null;
            };
        };
        const node = response.data?.node;
        if (
            node?.id !== subjectId ||
            !Array.isArray(node.comments?.nodes) ||
            typeof node.comments.pageInfo?.hasNextPage !== 'boolean'
        ) {
            fail(`invalid issue comments for ${subjectId}`);
        }
        for (const value of node.comments.nodes) {
            const comment = toIssueComment(value);
            if (comments.some((current) => current.id === comment.id)) {
                fail(`duplicate issue comment ${comment.id}`);
            }
            comments.push(comment);
        }
        if (!node.comments.pageInfo.hasNextPage) {
            return comments;
        }
        const next = node.comments.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || cursors.has(next)) {
            fail(`invalid issue-comment pagination for ${subjectId}`);
        }
        cursors.add(next);
        cursor = next;
    }
}
function toIssueComment(value: unknown): IssueComment {
    const comment = value as {
        id?: unknown;
        fullDatabaseId?: unknown;
        body?: unknown;
        author?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
    };
    if (typeof comment.id !== 'string' || !isDecimalId(comment.fullDatabaseId) || typeof comment.body !== 'string') {
        fail('invalid issue comment');
    }
    return {
        id: comment.id,
        fullDatabaseId: comment.fullDatabaseId,
        body: comment.body,
        authorNodeId: typeof comment.author?.id === 'string' ? comment.author.id : null,
        authorLogin: typeof comment.author?.login === 'string' ? comment.author.login : null,
        authorType: typeof comment.author?.__typename === 'string' ? comment.author.__typename : null,
    };
}
function addComment(subjectId: string, body: string, clientMutationId: string, gh: Gh): AddedIssueCommentReceipt {
    const query =
        'mutation($subjectId:ID!,$body:String!,$clientMutationId:String!){addComment(input:{subjectId:$subjectId,body:$body,clientMutationId:$clientMutationId}){clientMutationId commentEdge{node{id fullDatabaseId body author{login __typename ... on Bot{id}}}}}}';
    const response = graphql(
        gh,
        query,
        ['-F', `subjectId=${subjectId}`, '-f', `body=${body}`, '-f', `clientMutationId=${clientMutationId}`],
        'add supersession comment'
    ) as { data?: { addComment?: { clientMutationId?: unknown; commentEdge?: { node?: unknown } } } };
    if (response.data?.addComment?.clientMutationId !== clientMutationId) {
        fail('add supersession comment returned an invalid result');
    }
    return { ...toIssueComment(response.data?.addComment?.commentEdge?.node), clientMutationId };
}
function closePullRequest(pullRequestId: string, gh: Gh): PullRequestCloseReceipt {
    const clientMutationId = closeClientMutationId(pullRequestId);
    const query = `mutation($pullRequestId:ID!,$clientMutationId:String!){closePullRequest(input:{pullRequestId:$pullRequestId,clientMutationId:$clientMutationId}){clientMutationId pullRequest{id state closedAt}}}`;
    const response = graphql(
        gh,
        query,
        ['-F', `pullRequestId=${pullRequestId}`, '-f', `clientMutationId=${clientMutationId}`],
        'close pull request'
    ) as {
        data?: {
            closePullRequest?: {
                clientMutationId?: unknown;
                pullRequest?: { id?: unknown; state?: unknown; closedAt?: unknown };
            };
        };
    };
    const receipt = response.data?.closePullRequest;
    if (
        receipt?.clientMutationId !== clientMutationId ||
        receipt.pullRequest?.id !== pullRequestId ||
        receipt.pullRequest.state !== 'CLOSED' ||
        typeof receipt.pullRequest.closedAt !== 'string' ||
        receipt.pullRequest.closedAt === ''
    ) {
        fail('closePullRequest returned an invalid result');
    }
    return { closedAt: receipt.pullRequest.closedAt };
}
export function deleteComment(id: string, gh: Gh): void {
    const response = graphql(
        gh,
        'mutation($id:ID!,$clientMutationId:String!){deleteIssueComment(input:{id:$id,clientMutationId:$clientMutationId}){clientMutationId}}',
        ['-F', `id=${id}`, '-f', `clientMutationId=${id}`],
        'delete supersession comment'
    ) as { data?: { deleteIssueComment?: { clientMutationId?: unknown } } };
    if (response.data?.deleteIssueComment?.clientMutationId !== id) {
        fail(`delete supersession comment returned an invalid result for ${id}`);
    }
}
async function main(): Promise<number> {
    const parsed = parseSupersedePullRequestArgs(process.argv.slice(2));
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.oldNumber === undefined || parsed.head === undefined || parsed.replacementNumber === undefined) {
        fail(usage);
    }
    const cwd = process.cwd();
    assertTrustedExecutingBlob(
        'scripts/supersedePullRequest.ts',
        fileURLToPath(import.meta.url),
        originMainBlob('scripts/supersedePullRequest.ts', cwd)
    );
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'author' });
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        assertRequiredRepository(
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: auth.session.env,
                cwd: primaryRoot,
            })
        );
        supersedePullRequest(
            parsed.oldNumber,
            parsed.head,
            parsed.replacementNumber,
            auth.minted.actorNodeId,
            shellPort(auth.session)
        );
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
