#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_LOGIN,
    REQUIRED_REPOSITORY,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    originMainBlob,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export type SupersededPullRequest = { number: number; state: string; head: string; repository: string; base: string };
export type IssueComment = { id: string; fullDatabaseId: string };
export type SupersedePullRequestPort = {
    inspect: (number: number) => SupersededPullRequest;
    comment: (number: number, body: string) => IssueComment;
    close: (number: number) => void;
    reopen: (number: number) => void;
    deleteComment: (commentId: string) => void;
    inspectComment: (commentId: string) => boolean;
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
    const oldPullRequest = port.inspect(oldNumber);
    const replacement = port.inspect(replacementNumber);
    assertOld(oldPullRequest, oldNumber, expectedHead);
    assertReplacement(replacement, replacementNumber, oldPullRequest);
    const comment = port.comment(oldNumber, `Superseded by #${replacementNumber}.`);
    assertComment(comment);
    let closed = false;
    try {
        assertStableOpen(port.inspect(oldNumber), oldNumber, expectedHead);
        port.close(oldNumber);
        closed = true;
        const verified = port.inspect(oldNumber);
        if (verified.head !== expectedHead) {
            fail('pull-request head moved after mutation; compensating');
        }
        if (verified.state !== 'CLOSED') {
            fail(`PR #${oldNumber} was not closed`);
        }
    } catch (error) {
        compensateSupersession(oldNumber, comment.id, closed, port, error);
    }
    const success = `pull-request-superseded:${oldNumber}:${replacementNumber}`;
    port.log(success);
    return success;
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
function assertStableOpen(value: SupersededPullRequest, number: number, head: string): void {
    if (value.number !== number || value.repository !== REQUIRED_REPOSITORY || value.state !== 'OPEN') {
        fail(`PR #${number} changed after supersession comment; compensating`);
    }
    if (value.head !== head) {
        fail('pull-request head moved after mutation; compensating');
    }
}
function isDecimalId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
}
function assertComment(value: IssueComment): void {
    if (typeof value.id !== 'string' || value.id === '' || !isDecimalId(value.fullDatabaseId)) {
        fail('add supersession comment returned an invalid result');
    }
}
function compensateSupersession(
    number: number,
    commentId: string,
    closed: boolean,
    port: SupersedePullRequestPort,
    original: unknown
): never {
    const failures: string[] = [];
    if (closed) {
        attempt(failures, 'reopen pull request', () => port.reopen(number));
    }
    attempt(failures, 'delete supersession comment', () => port.deleteComment(commentId));
    attempt(failures, 'verify supersession compensation', () => {
        const current = port.inspect(number);
        if (current.state !== 'OPEN' || port.inspectComment(commentId)) {
            fail(`PR #${number} compensation was not verified`);
        }
    });
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

export function shellPort(session: GhSession, cwd: string = process.cwd()): SupersedePullRequestPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[]) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    const nodeIds = new Map<number, string>();
    const nodeId = (number: number) => nodeIds.get(number) ?? fail(`PR #${number} was not inspected`);
    return {
        inspect: (number) => inspectPullRequest(number, gh, nodeIds),
        comment: (number, body) => addComment(nodeId(number), body, gh),
        close: (number) => setPullRequestState('closePullRequest', nodeId(number), 'CLOSED', gh),
        reopen: (number) => setPullRequestState('reopenPullRequest', nodeId(number), 'OPEN', gh),
        deleteComment: (id) => deleteComment(id, gh),
        inspectComment: (id) => inspectComment(id, gh),
        log: (message) => console.log(message),
    };
}
type Gh = (args: string[]) => string;
function graphql(gh: Gh, query: string, fields: string[], label: string): unknown {
    return parseJson(gh(['api', 'graphql', '-f', `query=${query}`, ...fields]), label);
}
function inspectPullRequest(number: number, gh: Gh, nodeIds: Map<number, string>): SupersededPullRequest {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    const query =
        'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){nameWithOwner pullRequest(number:$number){id number state headRefOid baseRefName}}}';
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
        typeof pullRequest.baseRefName !== 'string'
    ) {
        fail(`cannot inspect PR #${number}`);
    }
    nodeIds.set(number, pullRequest.id);
    return {
        number: pullRequest.number,
        state: pullRequest.state,
        head: pullRequest.headRefOid,
        repository: repository.nameWithOwner,
        base: pullRequest.baseRefName,
    };
}
function addComment(subjectId: string, body: string, gh: Gh): IssueComment {
    const query =
        'mutation($subjectId:ID!,$body:String!){addComment(input:{subjectId:$subjectId,body:$body}){commentEdge{node{id fullDatabaseId body}}}}';
    const response = graphql(
        gh,
        query,
        ['-F', `subjectId=${subjectId}`, '-f', `body=${body}`],
        'add supersession comment'
    ) as {
        data?: { addComment?: { commentEdge?: { node?: { id?: unknown; fullDatabaseId?: unknown; body?: unknown } } } };
    };
    const comment = response.data?.addComment?.commentEdge?.node;
    if (comment?.body !== body || typeof comment.id !== 'string' || !isDecimalId(comment.fullDatabaseId)) {
        fail('add supersession comment returned an invalid result');
    }
    return { id: comment.id, fullDatabaseId: comment.fullDatabaseId };
}
function setPullRequestState(
    name: 'closePullRequest' | 'reopenPullRequest',
    pullRequestId: string,
    expectedState: string,
    gh: Gh
): void {
    const query = `mutation($pullRequestId:ID!){${name}(input:{pullRequestId:$pullRequestId}){pullRequest{id state}}}`;
    const response = graphql(gh, query, ['-F', `pullRequestId=${pullRequestId}`], name) as {
        data?: Record<string, { pullRequest?: { id?: unknown; state?: unknown } }>;
    };
    const pullRequest = response.data?.[name]?.pullRequest;
    if (pullRequest?.id !== pullRequestId || pullRequest.state !== expectedState) {
        fail(`${name} returned an invalid result`);
    }
}
function deleteComment(commentId: string, gh: Gh): void {
    graphql(
        gh,
        'mutation($id:ID!){deleteIssueComment(input:{id:$id}){clientMutationId}}',
        ['-F', `id=${commentId}`],
        'delete supersession comment'
    );
}
function inspectComment(commentId: string, gh: Gh): boolean {
    const response = graphql(
        gh,
        'query($id:ID!){node(id:$id){id}}',
        ['-F', `id=${commentId}`],
        'inspect supersession comment'
    ) as { data?: { node?: { id?: unknown } | null } };
    return response.data?.node?.id === commentId;
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
