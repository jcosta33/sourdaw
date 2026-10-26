import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import {
    RESOLUTION_RETIRED_MESSAGE,
    USAGE,
    parseResolveReviewThreadArgs,
    runResolveReviewThreadCli,
} from '../resolveThread.ts';
import { executeTrustedSnapshot, trustedDependencyPaths } from '../trustedGithubWriteBootstrap.ts';

const HEAD = 'a'.repeat(40);
const THREAD = 'PRRT_kwDOabc';
const NUMBER = 42;

function resolutionIdentityFixture(): string {
    return [
        "import { appendFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        'const root = process.env.SOURDAW_REVIEW_RESOLUTION_TEST_ROOT;',
        "if (typeof root !== 'string') throw new Error('resolution fixture root is missing');",
        "const log = (event) => appendFileSync(join(root, 'remote-calls.log'), event + '\\n');",
        `export const AUTHOR_BOT_NODE_ID = ${JSON.stringify(AUTHOR_BOT_NODE_ID)};`,
        'export const isAuthorBotNodeId = (id) => id === AUTHOR_BOT_NODE_ID;',
        'export const assertRequiredRepository = () => {};',
        'export const parseGraphqlResponse = (response) => JSON.parse(response);',
        'export const resolvePrimaryRoot = () => root;',
        'export async function authenticateRole() {',
        "  log('authenticate-author');",
        "  return { minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session: { env: {}, dispose: () => log('dispose') } };",
        '}',
        `const state = { id: ${JSON.stringify(THREAD)}, isResolved: false, pullRequest: { number: ${NUMBER}, state: 'OPEN', headRefOid: ${JSON.stringify(HEAD)} }, comments: { nodes: [{ id: 'root', body: 'Modern reviewer finding.', createdAt: '2026-10-25T09:00:00Z', author: { __typename: 'Bot', id: ${JSON.stringify(REVIEWER_BOT_NODE_ID)} } }], pageInfo: { hasNextPage: false, endCursor: null } } };`,
        'export function spawnCapture(command, args) {',
        "  if (command !== 'gh') throw new Error('unexpected executable');",
        "  if (args[0] === 'repo') { log('read-repository'); return 'jcosta33/sourdaw'; }",
        "  const fields = Object.fromEntries(args.flatMap((arg, index) => args[index - 1] === '-f' ? [[arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]] : []));",
        "  if (fields.query.includes('addPullRequestReviewThreadReply')) {",
        "    log('reply-Done');",
        "    state.comments.nodes.push({ id: 'done', body: 'Done', author: { __typename: 'Bot', id: AUTHOR_BOT_NODE_ID } });",
        "    return JSON.stringify({ data: { addPullRequestReviewThreadReply: { clientMutationId: fields.clientMutationId, comment: { id: 'done', body: 'Done' } } } });",
        '  }',
        "  if (fields.query.includes('mutation') && fields.query.includes('resolveReviewThread')) {",
        "    log('resolve-thread'); state.isResolved = true;",
        '    return JSON.stringify({ data: { resolveReviewThread: { clientMutationId: fields.clientMutationId, thread: state } } });',
        '  }',
        "  log('read-thread'); return JSON.stringify({ data: { node: state } });",
        '}',
    ].join('\n');
}

/** The entry and launcher are production source; only authenticated GitHub I/O is controlled. */
async function runResolutionSnapshot(args: string[]): Promise<{ result: number | string; calls: string }> {
    const directory = mkdtempSync(join(tmpdir(), "sourdaw-retired-resolution-'quoted space-"));
    const logPath = join(directory, 'remote-calls.log');
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const sources = new Map(
        trustedDependencyPaths('review:resolve').map((path) => [path, readFileSync(join(root, path), 'utf8')])
    );
    // Retain this trap even outside the retired command's closure: restoring the old writer must
    // reach its authenticated mutations instead of passing the refusal assertion on a missing import.
    sources.set('scripts/githubAppIdentity.ts', resolutionIdentityFixture());
    const previousRoot = process.env.SOURDAW_REVIEW_RESOLUTION_TEST_ROOT;
    // Pass the path as child-process data, never as executable module source.
    process.env.SOURDAW_REVIEW_RESOLUTION_TEST_ROOT = directory;
    try {
        let result: number | string;
        try {
            result = await executeTrustedSnapshot('review:resolve', args, {
                commit: 'production-entry-under-test',
                sources,
            });
        } catch (error) {
            result = error instanceof Error ? error.message : String(error);
        }
        return { result, calls: existsSync(logPath) ? readFileSync(logPath, 'utf8') : '' };
    } finally {
        if (previousRoot === undefined) {
            delete process.env.SOURDAW_REVIEW_RESOLUTION_TEST_ROOT;
        } else {
            process.env.SOURDAW_REVIEW_RESOLUTION_TEST_ROOT = previousRoot;
        }
        rmSync(directory, { recursive: true, force: true });
    }
}

describe('retired resolution trusted entry', () => {
    it('refuses a modern thread through the real trusted entry before authentication or GitHub access', async () => {
        await expect(runResolutionSnapshot([String(NUMBER), '--thread', THREAD, '--head', HEAD])).resolves.toEqual({
            result: 'trusted snapshot failed with exit 1',
            calls: '',
        });
    });

    it('refuses historical inputs through the real trusted entry without GitHub access', async () => {
        await expect(
            runResolutionSnapshot(['4411', '--thread', 'PRRT_kwDORobapc6j97u1', '--head', HEAD])
        ).resolves.toEqual({ result: 'trusted snapshot failed with exit 1', calls: '' });
    });

    it('runs help through the real trusted entry without authentication', async () => {
        await expect(runResolutionSnapshot(['--help'])).resolves.toEqual({ result: 0, calls: '' });
    });

    it('refuses malformed inputs through the real trusted entry without authentication', async () => {
        await expect(runResolutionSnapshot([String(NUMBER)])).resolves.toEqual({
            result: 'trusted snapshot failed with exit 1',
            calls: '',
        });
    });
});

describe('parseResolveReviewThreadArgs', () => {
    it('reads the retained pull request, thread and full head syntax', () => {
        expect(parseResolveReviewThreadArgs([String(NUMBER), '--thread', THREAD, '--head', HEAD])).toEqual({
            number: NUMBER,
            threadId: THREAD,
            head: HEAD,
            help: false,
        });
    });

    it.each([
        [],
        ['0', '--thread', THREAD, '--head', HEAD],
        ['9007199254740992', '--thread', THREAD, '--head', HEAD],
        [String(NUMBER), '--thread', THREAD, '--head', 'a'.repeat(7)],
        [String(NUMBER), THREAD, '--head', HEAD],
        [String(NUMBER), '--thread', 'invalid thread', '--head', HEAD],
    ])('refuses malformed legacy arguments %j', (...args) => {
        expect(() => parseResolveReviewThreadArgs(args)).toThrow(USAGE);
    });

    it('accepts help alone and refuses mixed help arguments', () => {
        expect(parseResolveReviewThreadArgs(['--help'])).toEqual({ help: true });
        expect(() => parseResolveReviewThreadArgs(['--help', String(NUMBER)])).toThrow(
            '--help takes no other arguments'
        );
    });
});

describe('runResolveReviewThreadCli', () => {
    it.each([
        [String(NUMBER), THREAD, HEAD],
        ['4411', 'PRRT_kwDORobapc6j97u1', '096ce744c52558d55018b341e93e81dcf87f30ec'],
    ])('directs PR %s to author repair and reviewer confirmation', async (number, thread, head) => {
        await expect(runResolveReviewThreadCli([number, '--thread', thread, '--head', head])).rejects.toThrow(
            RESOLUTION_RETIRED_MESSAGE
        );
    });

    it('prints help and migration guidance successfully', async () => {
        const printed = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            await expect(runResolveReviewThreadCli(['--help'])).resolves.toBe(0);
            expect(printed.mock.calls).toEqual([
                [`Usage: ${USAGE.slice('usage: '.length)}`],
                [RESOLUTION_RETIRED_MESSAGE],
            ]);
        } finally {
            printed.mockRestore();
        }
    });

    it('preserves the malformed-argument diagnostic', async () => {
        await expect(runResolveReviewThreadCli([String(NUMBER)])).rejects.toThrow(USAGE);
    });
});
