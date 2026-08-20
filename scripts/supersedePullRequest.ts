#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_LOGIN,
    REQUIRED_REPOSITORY,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isAuthorBotLogin,
    originMainBlob,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export type IssueComment = { id: string; fullDatabaseId: string; body: string; authorLogin: string | null };
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
    authorLogin: string,
    port: SupersedePullRequestPort
): string {
    if (authorLogin !== AUTHOR_BOT_LOGIN) {
        fail(`authenticated author login ${authorLogin} is not ${AUTHOR_BOT_LOGIN}`);
    }
    if (oldNumber === replacementNumber) {
        fail('replacement pull request must differ from the old pull request');
    }
    const before = port.inspect(oldNumber);
    const replacement = port.inspect(replacementNumber);
    assertOld(before, oldNumber, expectedHead);
    assertReplacement(replacement, replacementNumber, before);
    const body = `Superseded by #${replacementNumber}.`;
    let commentAttempted = false;
    let commentId: string | undefined;
    let closeAttempted = false;
    let closeReceipt: PullRequestCloseReceipt | undefined;
    try {
        commentAttempted = true;
        const comment = port.comment(oldNumber, body);
        commentId = assertCommentReceipt(comment, commentClientMutationId(oldNumber, body));
        assertCommentBody(comment, body);
        assertStableOpen(port.inspect(oldNumber), oldNumber, expectedHead, before.base);
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
            commentId,
            closeAttempted,
            closeReceipt,
            port,
            error
        );
    }
    const success = `pull-request-superseded:${oldNumber}:${replacementNumber}`;
    port.log(success);
    return success;
}

function compensateSupersession(
    number: number,
    before: SupersededPullRequest,
    expectedCommentBody: string,
    commentAttempted: boolean,
    commentId: string | undefined,
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
        if (closeReceipt !== undefined && current.state !== before.state) {
            failures.push('pull-request closure was receipted but is not rollback-safe; refusing to reopen');
        } else if (closeAttempted && current.state !== before.state) {
            failures.push(`ambiguous PR closure for #${number}; refusing to reopen an unverified transition`);
        }
        if (commentAttempted) {
            if (commentId === undefined) {
                failures.push('ambiguous supersession comment mutation; refusing to delete an unverified comment');
            } else if (closeReceipt !== undefined) {
                failures.push('supersession comment is durable evidence for a receipted close; refusing to delete it');
            } else if (hasExpectedComment(current.comments, commentId, expectedCommentBody)) {
                attempt(failures, 'delete supersession comment', () => port.deleteComment(commentId));
            } else {
                failures.push(
                    'supersession comment receipt is no longer present; refusing to delete an unverified comment'
                );
            }
        }
    }
    attempt(failures, 'verify supersession compensation', () => {
        const verified = port.inspect(number);
        if (
            closeReceipt === undefined &&
            (verified.state !== before.state || !sameCommentIds(verified.comments, before.comments))
        ) {
            fail(`PR #${number} compensation was not verified`);
        }
    });
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
function assertOld(value: SupersededPullRequest, number: number, head: string): void {
    if (value.number !== number || value.repository !== REQUIRED_REPOSITORY) {
        fail(`cannot inspect PR #${number} in ${REQUIRED_REPOSITORY}`);
    }
    if (value.state !== 'OPEN') {
        fail(`PR #${number} is ${value.state.toLowerCase()}`);
    }
    if (value.head !== head) {
        fail('supplied head does not match the current pull-request head');
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
function hasExpectedComment(comments: IssueComment[], id: string, body: string): boolean {
    return comments.some(
        (comment) => comment.id === id && comment.body === body && isAuthorBotLogin(comment.authorLogin)
    );
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
}
function isDecimalId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
}
function assertCommentReceipt(value: AddedIssueCommentReceipt, expectedClientMutationId: string): string {
    if (
        typeof value.id !== 'string' ||
        value.id === '' ||
        !isDecimalId(value.fullDatabaseId) ||
        !isAuthorBotLogin(value.authorLogin) ||
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
    return parseJson(gh(['api', 'graphql', '-f', `query=${query}`, ...fields]), label);
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
        const query = `query($subjectId:ID!${cursor === undefined ? '' : ',$cursor:String!'}){node(id:$subjectId){... on PullRequest{${connection}{nodes{id fullDatabaseId body author{login}} pageInfo{hasNextPage endCursor}}}}}`;
        const fields = ['-F', `subjectId=${subjectId}`];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `issue comments for ${subjectId}`) as {
            data?: {
                node?: {
                    comments?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                } | null;
            };
        };
        const node = response.data?.node;
        if (!Array.isArray(node?.comments?.nodes) || typeof node.comments.pageInfo?.hasNextPage !== 'boolean') {
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
        author?: { login?: unknown } | null;
    };
    if (typeof comment.id !== 'string' || !isDecimalId(comment.fullDatabaseId) || typeof comment.body !== 'string') {
        fail('invalid issue comment');
    }
    return {
        id: comment.id,
        fullDatabaseId: comment.fullDatabaseId,
        body: comment.body,
        authorLogin: typeof comment.author?.login === 'string' ? comment.author.login : null,
    };
}
function addComment(subjectId: string, body: string, clientMutationId: string, gh: Gh): AddedIssueCommentReceipt {
    const query =
        'mutation($subjectId:ID!,$body:String!,$clientMutationId:String!){addComment(input:{subjectId:$subjectId,body:$body,clientMutationId:$clientMutationId}){clientMutationId commentEdge{node{id fullDatabaseId body author{login}}}}}';
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
        if (auth.minted.login !== AUTHOR_BOT_LOGIN) {
            fail(`minted login ${auth.minted.login} is not ${AUTHOR_BOT_LOGIN}`);
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
            auth.minted.login,
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
