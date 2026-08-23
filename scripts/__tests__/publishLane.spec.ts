import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    AUTHOR_LOCK_REASON,
    GITHUB_HTTPS_REMOTE,
    createGhSession,
    resolvePrimaryRoot,
    type GhSession,
} from '../githubAppIdentity.ts';
import { composePublishBody } from '../prContract.ts';
import {
    existingOpenPullRequestArgs,
    issueExistsFromLookup,
    issueLookupArgs,
    laneIssueNumber,
    matchingOpenPullRequest,
    parsePublishLaneArgs,
    parsePublishWorktrees,
    publishLane,
    resolveAuthorLane,
    shellPort,
    type OpenPullRequestRow,
    type PublishLanePort,
    type PublishWorktree,
} from '../publishLane.ts';

const PRIMARY_ROOT = '/repo';
const DEFAULT_SUBJECT = 'feat(vcs): add identities';
const TEST_INSTRUCTIONS = 'Run the focused publisher specs and confirm they pass.';
const ISSUE_LANE = '/repo/.agents/worktrees/agent-12-work';
const CLEANUP_LANE = '/repo/.agents/worktrees/agent--cleanup';
const LEGACY_LANE = '/repo/.agents/worktrees/collab-sync-state';
const LEGACY_BRANCH = 'fix/collab-sync-state-2039';

function fixtureGit(repository: string, args: string[]): string {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    return execFileSync('git', args, { cwd: repository, env, encoding: 'utf8' }).trim();
}

function runPackageRoute(repository: string, args: string[], env: NodeJS.ProcessEnv): string {
    const pnpmCli = process.env.npm_execpath;
    if (!pnpmCli) {
        throw new Error('The protected-publisher fixture requires the active pnpm CLI path');
    }
    return execFileSync(process.execPath, [pnpmCli, ...args], {
        cwd: repository,
        env,
        encoding: 'utf8',
        timeout: 8_000,
    });
}

function initializeRepository(path: string): void {
    mkdirSync(path, { recursive: true });
    fixtureGit(path, ['init', '-b', 'main']);
    fixtureGit(path, ['config', 'user.name', 'Fixture']);
    fixtureGit(path, ['config', 'user.email', 'fixture@example.com']);
}

function addLockedLane(primary: string, lane: string, branch: string, changedPath: string): string {
    fixtureGit(primary, ['worktree', 'add', '-b', branch, lane]);
    const target = join(lane, changedPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'change\n');
    fixtureGit(lane, ['add', '--', changedPath]);
    fixtureGit(lane, ['commit', '--no-gpg-sign', '-m', 'fix(delivery): fixture lane']);
    fixtureGit(primary, ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, lane]);
    return fixtureGit(lane, ['rev-parse', 'HEAD']);
}

function worktree(overrides: Partial<PublishWorktree> = {}): PublishWorktree {
    return {
        path: ISSUE_LANE,
        branch: 'agent/12/work',
        locked: true,
        lockReason: AUTHOR_LOCK_REASON,
        ...overrides,
    };
}

function otherAuthorLanes(): PublishWorktree[] {
    return [
        worktree({ path: '/repo/.agents/worktrees/agent-2237-proof', branch: 'agent/2237/proof' }),
        worktree({ path: '/repo/.agents/worktrees/agent-2241-titlebar', branch: 'agent/2241/titlebar' }),
        worktree({ path: '/repo/.agents/worktrees/agent--policy', branch: 'agent/policy' }),
        worktree({ path: '/repo/.agents/worktrees/agent--tracker', branch: 'agent/tracker' }),
    ];
}

type FakeInput = {
    trees?: PublishWorktree[];
    cwd?: string;
    ahead?: number;
    behind?: number;
    dirty?: boolean;
    /** `null` stands for a lane with no non-merge commit of its own above `origin/main`. */
    subject?: string | null;
    headSha?: string;
    baseSha?: string;
    remoteSha?: string;
    ancestor?: boolean;
    existing?: number;
    /** Per-lookup answers, so a pull request can close between the authorizing query and the push. */
    existingByCall?: Array<number | undefined>;
    existingBody?: unknown;
    issueExists?: boolean;
};

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    const logs: string[] = [];
    const bodies: string[] = [];
    const dirty = input.dirty ?? false;
    const subject = input.subject === undefined ? DEFAULT_SUBJECT : (input.subject ?? undefined);
    let pullRequestQueries = 0;
    const port: PublishLanePort = {
        baseSha: () => input.baseSha ?? 'base',
        worktrees: () => input.trees ?? [worktree()],
        cwd: () => input.cwd ?? PRIMARY_ROOT,
        issueExists: (issue) => {
            calls.push(`issueExists:${issue}`);
            return input.issueExists ?? true;
        },
        aheadBehind: () => ({ ahead: input.ahead ?? 1, behind: input.behind ?? 0 }),
        dirty: () => dirty,
        laneSubject: () => subject,
        headSha: () => input.headSha ?? 'abc',
        remoteBranchSha: () => input.remoteSha,
        isAncestor: () => input.ancestor ?? true,
        push: (_lane, branch, headSha) => {
            calls.push(`push:${branch}`);
            calls.push(`pushHead:${headSha}`);
        },
        // The queried branch is the entire authorization decision on the legacy path, so it goes
        // into the ledger: a fake that discarded it would stay green if resolution asked about a
        // sibling lane's branch, or a constant.
        existingOpenPullRequest: (branch) => {
            const query = pullRequestQueries++;
            calls.push(`pr:${branch}`);
            const number = input.existingByCall === undefined ? input.existing : input.existingByCall[query];
            return number === undefined
                ? undefined
                : {
                      number,
                      body:
                          input.existingBody === undefined
                              ? composePublishBody(12, DEFAULT_SUBJECT, TEST_INSTRUCTIONS)
                              : input.existingBody,
                  };
        },
        createPullRequest: ({ title, body, branch }) => {
            bodies.push(body);
            calls.push(`create:${branch}:${title}:${body.includes('Closes #12') ? 'closes' : 'missing'}`);
            return 88;
        },
        updatePullRequest: (number, { title, body }) => {
            bodies.push(body);
            calls.push(`edit:${number}:${title}`);
        },
        // Logging is ordered against the mutating calls, so it shares their ledger.
        log: (message) => {
            calls.push(`log:${message}`);
            logs.push(message);
        },
    };
    return { port, calls, logs, bodies };
}

/**
 * The whole text of a refusal, so a test can assert what it must *not* say. `toThrow` can only
 * assert presence, and the defect these tests pin is an extra sentence, not a missing one.
 */
function refusalMessage(run: () => unknown): string {
    try {
        run();
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error('expected a refusal, but resolution succeeded');
}

const REFUSED_PUBLISH_CASES: Array<[string, FakeInput, RegExp]> = [
    ['zero lanes', { trees: [] }, /expected exactly one locked author lane for issue #12/],
    [
        'two lanes',
        { trees: [worktree(), worktree({ path: '/repo/.agents/worktrees/other', branch: 'agent/12/other' })] },
        /expected exactly one locked author lane for issue #12/,
    ],
    ['zero ahead', { ahead: 0 }, /lane must be ahead of origin\/main/],
    ['free-text subject', { subject: 'WIP' }, /pull-request title is not conventional/],
    [
        'a lane whose only commits above origin/main are merges',
        { subject: null },
        /agent\/12\/work carries no non-merge commit above origin\/main/,
    ],
    ['diverged remote', { remoteSha: 'other', ancestor: false }, /refusing non-fast-forward push of agent\/12\/work/],
];

describe('lane publish', () => {
    it('publishes the exact classified lane through the protected primary launcher', () => {
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-publish-routing-'));
        const primary = join(fixtureRoot, 'primary');
        const authorizedLane = join(fixtureRoot, 'authorized-lane');
        const hostilePrimary = join(fixtureRoot, 'hostile-primary');
        const hostileLane = join(fixtureRoot, 'hostile-lane');
        const bin = join(fixtureRoot, 'bin');
        const pushLog = join(fixtureRoot, 'push.json');
        const mintLog = join(fixtureRoot, 'mint.json');
        const eventLog = join(fixtureRoot, 'events.log');
        try {
            initializeRepository(primary);
            mkdirSync(join(primary, 'scripts'), { recursive: true });
            for (const file of [
                'trustedGithubWriteBootstrap.ts',
                'publishLane.ts',
                'githubAppIdentity.ts',
                'prContract.ts',
            ]) {
                const fixtureSource = readFileSync(join(import.meta.dirname, '..', file), 'utf8');
                const fetchFixture =
                    file === 'githubAppIdentity.ts'
                        ? '\nglobalThis.fetch = async (url, init = {}) => {\n' +
                          "  if (String(url).endsWith('/access_tokens')) { const { appendFileSync } = await import('node:fs'); const body = JSON.parse(String(init.body)); appendFileSync(process.env.TEST_EVENT_LOG, 'mint\\n'); appendFileSync(process.env.TEST_MINT_LOG, JSON.stringify(body) + '\\n'); return new Response(JSON.stringify({ token: 'ghs_minted', permissions: body.permissions }), { status: 201 }); }\n" +
                          "  if (String(url).endsWith('/app')) return new Response(JSON.stringify({ slug: 'jcosta33-author' }), { status: 200 });\n" +
                          "  return new Response('{}', { status: 404 });\n" +
                          '};\n'
                        : '';
                writeFileSync(join(primary, 'scripts', file), fixtureSource + fetchFixture);
            }
            writeFileSync(
                join(primary, 'package.json'),
                JSON.stringify({
                    type: 'module',
                    private: true,
                    scripts: { 'lane:publish': 'node scripts/trustedGithubWriteBootstrap.ts lane:publish' },
                })
            );
            fixtureGit(primary, ['add', '.']);
            fixtureGit(primary, ['commit', '--no-gpg-sign', '-m', 'test: trusted publisher']);
            fixtureGit(primary, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
            const authorizedHead = addLockedLane(
                primary,
                authorizedLane,
                'agent/12/authorized',
                '.github/workflows/fixture.yml'
            );

            initializeRepository(hostilePrimary);
            writeFileSync(join(hostilePrimary, 'base.txt'), 'base\n');
            fixtureGit(hostilePrimary, ['add', 'base.txt']);
            fixtureGit(hostilePrimary, ['commit', '--no-gpg-sign', '-m', 'test: hostile base']);
            fixtureGit(hostilePrimary, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
            addLockedLane(hostilePrimary, hostileLane, 'agent/12/hostile', 'ordinary.txt');

            const { privateKey } = generateKeyPairSync('rsa', {
                modulusLength: 2048,
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
                publicKeyEncoding: { type: 'spki', format: 'pem' },
            });
            writeFileSync(
                join(primary, '.env.sourdaw-author'),
                'SOURDAW_GITHUB_APP_ID=1\n' +
                    'SOURDAW_GITHUB_APP_INSTALLATION_ID=1\n' +
                    `SOURDAW_GITHUB_APP_PRIVATE_KEY="${privateKey.replaceAll('\n', '\\n')}"\n`
            );

            mkdirSync(bin);
            const systemGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
            const gitWrapper = join(bin, 'git');
            writeFileSync(
                gitWrapper,
                '#!/usr/bin/env node\n' +
                    "import { appendFileSync } from 'node:fs';\n" +
                    "import { spawnSync } from 'node:child_process';\n" +
                    'const args = process.argv.slice(2);\n' +
                    "if (args.includes('fetch')) { appendFileSync(process.env.TEST_EVENT_LOG, 'fetch\\n'); process.exit(0); }\n" +
                    "if (args.includes('ls-remote')) process.exit(0);\n" +
                    "if (args.includes('push')) { appendFileSync(process.env.TEST_EVENT_LOG, 'push\\n'); appendFileSync(process.env.TEST_PUSH_LOG, JSON.stringify({ cwd: process.cwd(), args }) + '\\n'); process.exit(0); }\n" +
                    `const result = spawnSync(${JSON.stringify(systemGit)}, args, { stdio: 'inherit', env: process.env });\n` +
                    'if (result.error) throw result.error; process.exit(result.status ?? 1);\n'
            );
            chmodSync(gitWrapper, 0o700);
            const ghWrapper = join(bin, 'gh');
            writeFileSync(
                ghWrapper,
                '#!/usr/bin/env node\n' +
                    "import { appendFileSync } from 'node:fs';\n" +
                    'const args = process.argv.slice(2);\n' +
                    "if (args[0] === 'repo') console.log('jcosta33/sourdaw');\n" +
                    "else if (args[0] === 'api') console.log(JSON.stringify({ number: 12, isPullRequest: false }));\n" +
                    "else if (args[0] === 'pr' && args[1] === 'list') console.log('[]');\n" +
                    "else if (args[0] === 'pr' && args[1] === 'create') { appendFileSync(process.env.TEST_EVENT_LOG, 'pr-write\\n'); console.log('https://github.com/jcosta33/sourdaw/pull/88'); }\n" +
                    "else { console.error('unexpected gh ' + args.join(' ')); process.exit(1); }\n"
            );
            chmodSync(ghWrapper, 0o700);
            const launcherEnv = {
                ...process.env,
                PATH: `${bin}:${process.env.PATH ?? ''}`,
                GIT_DIR: join(hostilePrimary, '.git'),
                GIT_WORK_TREE: hostileLane,
                TEST_PUSH_LOG: pushLog,
                TEST_MINT_LOG: mintLog,
                TEST_EVENT_LOG: eventLog,
            };
            runPackageRoute(primary, ['lane:publish', '12', '--test', TEST_INSTRUCTIONS], launcherEnv);

            expect(JSON.parse(readFileSync(mintLog, 'utf8').trim())).toEqual({
                permissions: { contents: 'write', pull_requests: 'write', workflows: 'write' },
            });
            const push = JSON.parse(readFileSync(pushLog, 'utf8').trim()) as { cwd: string; args: string[] };
            expect(realpathSync(push.cwd)).toBe(realpathSync(authorizedLane));
            expect(push.args).toContain(`${authorizedHead}:refs/heads/agent/12/authorized`);
            expect(push.args).not.toContain('HEAD:refs/heads/agent/12/hostile');
            const events = readFileSync(eventLog, 'utf8').trim().split('\n');
            const mintEvent = events.indexOf('mint');
            const pushEvent = events.indexOf('push');
            const pullRequestWriteEvent = events.indexOf('pr-write');
            expect(events.indexOf('fetch')).toBeLessThan(mintEvent);
            expect(
                events.filter((event, index) => event === 'fetch' && index > mintEvent && index < pushEvent)
            ).toHaveLength(2);
            expect(events[pushEvent - 1]).toBe('fetch');
            expect(
                events.findIndex(
                    (event, index) => event === 'fetch' && index > pushEvent && index < pullRequestWriteEvent
                )
            ).toBeGreaterThan(pushEvent);
            expect(events[pullRequestWriteEvent - 1]).toBe('fetch');
            expect(() => runPackageRoute(primary, ['lane:publish', '--lane', authorizedLane], launcherEnv)).toThrow(
                /issue lanes must publish by issue number/
            );
            expect(() =>
                runPackageRoute(primary, ['lane:publish', '--lane', join(authorizedLane, '.github')], launcherEnv)
            ).toThrow(/--lane must name the exact author worktree root/);
        } finally {
            rmSync(fixtureRoot, { recursive: true, force: true });
        }
    }, 20_000);

    it('resolves the locked lane before requesting its diff-scoped publishing token', () => {
        const source = readFileSync(join(import.meta.dirname, '../publishLane.ts'), 'utf8');
        const cli = source.slice(source.indexOf('export async function runPublishLaneCli'));
        const resolveLane = cli.indexOf('resolveAuthorLane(parsed.issue, localWorktrees');
        const authenticate = cli.indexOf(
            'authenticatePublishingAuthor({\n        primaryRoot,\n        lane: { path: authenticationLane.path, branch: authenticationLane.branch },'
        );

        expect(resolveLane).toBeGreaterThanOrEqual(0);
        expect(authenticate).toBeGreaterThan(resolveLane);
        expect(cli).not.toMatch(/\bauthenticateRole\b/);
    });

    it('does not run a lane-controlled pre-push hook in the token-bearing Git child', () => {
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-publish-hooks-'));
        const primary = join(fixtureRoot, 'primary');
        const lane = join(fixtureRoot, 'lane');
        const remote = join(fixtureRoot, 'remote.git');
        const hookMarker = join(fixtureRoot, 'hook-token');
        const systemGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        let session: GhSession | undefined;
        try {
            initializeRepository(primary);
            writeFileSync(join(primary, 'base.txt'), 'base\n');
            fixtureGit(primary, ['add', 'base.txt']);
            fixtureGit(primary, ['commit', '--no-gpg-sign', '-m', 'test: hook fixture base']);
            fixtureGit(primary, ['worktree', 'add', '-b', 'agent/12/hook-proof', lane]);

            mkdirSync(join(lane, '.githooks'));
            const prePushHook = join(lane, '.githooks/pre-push');
            writeFileSync(prePushHook, `#!/bin/sh\nprintf %s "$GH_TOKEN" > ${JSON.stringify(hookMarker)}\n`);
            chmodSync(prePushHook, 0o700);
            fixtureGit(lane, ['add', '.githooks/pre-push']);
            fixtureGit(lane, ['commit', '--no-gpg-sign', '-m', 'test: add hostile pre-push hook']);
            fixtureGit(primary, ['config', 'core.hooksPath', '.githooks']);

            execFileSync(systemGit, ['init', '--bare', remote], { cwd: fixtureRoot, encoding: 'utf8' });
            fixtureGit(primary, ['config', `url.${remote}.insteadOf`, GITHUB_HTTPS_REMOTE]);
            const headSha = fixtureGit(lane, ['rev-parse', 'HEAD']);
            session = createGhSession('ghs_hook_marker', { PATH: process.env.PATH });

            shellPort(session, lane, primary, { git: systemGit, gh: 'gh' }).push(lane, 'agent/12/hook-proof', headSha);

            expect(existsSync(hookMarker)).toBe(false);
            expect(fixtureGit(remote, ['rev-parse', 'refs/heads/agent/12/hook-proof'])).toBe(headSha);
        } finally {
            session?.dispose();
            rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it('pushes without force, opens one PR, and prints the number', () => {
        const { port, calls, logs } = fakePort();

        expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS)).toBe(88);
        expect(calls.some((call) => call.includes('--force'))).toBe(false);
        expect(calls.some((call) => call.includes('merge --auto'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(true);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
        expect(logs.at(-1)).toBe('88');
    });

    it('updates an existing open pull request instead of opening a second', () => {
        const { port, calls } = fakePort({ existing: 41 });

        expect(publishLane(12, port)).toBe(41);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
        expect(calls).toContain('edit:41:feat(vcs): add identities');
    });

    it('refuses to open a pull request without explicit test instructions', () => {
        const { port, calls } = fakePort();

        expect(() => publishLane(12, port)).toThrow(/requires --test <instructions>/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('refuses a dirty lane instead of committing it under an earlier commit subject', () => {
        const { port, calls } = fakePort({ dirty: true });

        expect(() => publishLane(12, port)).toThrow(
            /agent\/12\/work has uncommitted changes: commit them yourself with a conventional subject/
        );
        expect(calls).not.toContain('fetch');
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('publishes a clean lane', () => {
        const { port, calls } = fakePort({ dirty: false });

        publishLane(12, port, undefined, TEST_INSTRUCTIONS);

        expect(calls).toContain('push:agent/12/work');
    });

    it('pushes the exact permission-classified head and refuses a changed HEAD', () => {
        const classifiedHead = 'a'.repeat(40);
        const authorization = {
            lanePath: ISSUE_LANE,
            branch: 'agent/12/work',
            legacy: false,
            headSha: classifiedHead,
            baseSha: 'base',
            permissionClass: 'ordinary' as const,
        };
        const accepted = fakePort({ headSha: classifiedHead });

        publishLane(12, accepted.port, undefined, TEST_INSTRUCTIONS, authorization);
        expect(accepted.calls).toContain(`pushHead:${classifiedHead}`);

        const changed = fakePort({ headSha: 'b'.repeat(40) });
        expect(() => publishLane(12, changed.port, undefined, TEST_INSTRUCTIONS, authorization)).toThrow(
            /HEAD changed after its permission-scoped token was minted/
        );
        expect(changed.calls.some((call) => call.startsWith('push:'))).toBe(false);
    });

    it('refuses when origin/main changes after permission classification', () => {
        const authorization = {
            lanePath: ISSUE_LANE,
            branch: 'agent/12/work',
            legacy: false,
            headSha: 'a'.repeat(40),
            baseSha: 'b'.repeat(40),
            permissionClass: 'ordinary' as const,
        };
        const { port, calls } = fakePort({ headSha: authorization.headSha, baseSha: 'c'.repeat(40) });

        expect(() => publishLane(12, port, undefined, TEST_INSTRUCTIONS, authorization)).toThrow(
            /origin\/main changed after its permission-scoped token was minted/
        );
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:') || call.startsWith('edit:'))).toBe(false);
    });

    it('publishes a lane that is behind origin/main when it still has lane commits to publish', () => {
        const { port, calls } = fakePort({ dirty: false, ahead: 1, behind: 1, existing: 41 });

        expect(publishLane(12, port)).toBe(41);

        expect(calls).toContain('push:agent/12/work');
        expect(calls).toContain('edit:41:feat(vcs): add identities');
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('names the resolved lane before it pushes or opens a pull request', () => {
        const { port, calls } = fakePort();

        publishLane(12, port, undefined, TEST_INSTRUCTIONS);

        const receipt = calls.indexOf(`log:publishing ${ISSUE_LANE} on agent/12/work`);
        expect(receipt).toBeGreaterThanOrEqual(0);
        expect(receipt).toBeLessThan(calls.findIndex((call) => call.startsWith('push:')));
        expect(receipt).toBeLessThan(calls.findIndex((call) => call.startsWith('create:')));
    });

    it('writes Closes #<issue> into the body when an issue is given', () => {
        const { port, bodies } = fakePort();

        publishLane(12, port, undefined, TEST_INSTRUCTIONS);

        expect(bodies.at(-1)).toContain('Closes #12');
        expect(bodies.at(-1)).toContain(`### 🧪 How to test\n${TEST_INSTRUCTIONS}`);
    });

    it('takes Closes #<issue> from the lane branch when no issue argument is given', () => {
        const { port, calls, bodies } = fakePort({
            trees: [...otherAuthorLanes(), worktree()],
            cwd: `${ISSUE_LANE}/scripts`,
        });

        expect(publishLane(undefined, port, undefined, TEST_INSTRUCTIONS)).toBe(88);
        expect(calls).toContain('push:agent/12/work');
        expect(bodies.at(-1)).toContain('Closes #12');
    });

    it('references a campaign issue without closing it', () => {
        const { port, bodies } = fakePort();

        publishLane(12, port, 'relates', TEST_INSTRUCTIONS);

        expect(bodies.at(-1)).toContain('Related #12');
        expect(bodies.at(-1)).not.toContain('Closes #12');
    });

    it('takes the related issue from the lane branch', () => {
        const { port, bodies } = fakePort({
            trees: [...otherAuthorLanes(), worktree()],
            cwd: `${ISSUE_LANE}/scripts`,
        });

        publishLane(undefined, port, 'relates', TEST_INSTRUCTIONS);

        expect(bodies.at(-1)).toContain('Related #12');
    });

    it('preserves Related on a later flagless update', () => {
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, TEST_INSTRUCTIONS, 'relates'),
        });

        publishLane(12, port);

        expect(bodies.at(-1)).toContain('Related #12');
        expect(bodies.at(-1)).not.toContain('Closes #12');
    });

    it('preserves Closes on a later flagless update', () => {
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, TEST_INSTRUCTIONS),
        });

        publishLane(12, port);

        expect(bodies.at(-1)).toContain('Closes #12');
        expect(bodies.at(-1)).not.toContain('Related #12');
    });

    it('preserves valid existing test instructions when --test is omitted', () => {
        const existingInstructions = 'Open the settings panel and confirm the new control is visible.';
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, existingInstructions),
        });

        publishLane(12, port);

        expect(bodies.at(-1)).toContain(`### 🧪 How to test\n${existingInstructions}`);
    });

    it('updates existing test instructions when --test is supplied', () => {
        const updatedInstructions = 'Run the publisher CLI and confirm the updated instructions appear.';
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, TEST_INSTRUCTIONS),
        });

        publishLane(12, port, undefined, updatedInstructions);

        expect(bodies.at(-1)).toContain(`### 🧪 How to test\n${updatedInstructions}`);
        expect(bodies.at(-1)).not.toContain(TEST_INSTRUCTIONS);
    });

    it('changes a valid existing relationship only when requested', () => {
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, TEST_INSTRUCTIONS),
        });

        publishLane(12, port, 'relates');

        expect(bodies.at(-1)).toContain('Related #12');
        expect(bodies.at(-1)).not.toContain('Closes #12');
    });

    it('validates existing state before an explicit relationship change', () => {
        const { port, calls } = fakePort({ existing: 41, existingBody: 'None.' });

        expect(() => publishLane(12, port, 'relates')).toThrow(/Related tickets/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('validates existing state before a flagless update', () => {
        const { port, calls } = fakePort({ existing: 41, existingBody: null });

        expect(() => publishLane(12, port)).toThrow(/body is unreadable/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('rejects mixed None and issue relationships before mutation', () => {
        const { port, calls } = fakePort({
            existing: 41,
            existingBody: '### 📌 Related tickets & additional notes\nNone.\nCloses #12',
        });

        expect(() => publishLane(12, port)).toThrow(/exactly one relationship/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('validates an existing issueless pull request', () => {
        const { port, calls } = fakePort({
            trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
            cwd: CLEANUP_LANE,
            existing: 41,
            existingBody: '### 📌 Related tickets & additional notes\nCloses #12',
        });

        expect(() => publishLane(undefined, port)).toThrow(/issueless pull-request body/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('preserves None on a later issueless update', () => {
        const { port, bodies } = fakePort({
            trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
            cwd: CLEANUP_LANE,
            existing: 41,
            existingBody: composePublishBody(undefined, DEFAULT_SUBJECT, TEST_INSTRUCTIONS),
        });

        publishLane(undefined, port);

        expect(bodies.at(-1)).toContain('### 📌 Related tickets & additional notes\nNone.');
        expect(bodies.at(-1)).not.toContain('Closes #');
        expect(bodies.at(-1)).not.toContain('Related #');
    });

    it('rejects --relates on an issueless lane', () => {
        const { port } = fakePort({
            trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
            cwd: CLEANUP_LANE,
        });

        expect(() => publishLane(undefined, port, 'relates')).toThrow(/requires an issue lane/);
    });

    it('publishes the lane it is standing in even when other author lanes exist', () => {
        const { port, calls, bodies, logs } = fakePort({
            trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
            cwd: CLEANUP_LANE,
        });

        expect(publishLane(undefined, port, undefined, TEST_INSTRUCTIONS)).toBe(88);
        expect(calls).toContain('push:agent/cleanup');
        expect(calls.some((call) => call.startsWith('issueExists:'))).toBe(false);
        expect(bodies.at(-1)).not.toContain('Closes #');
        expect(bodies.at(-1)).toContain('### 📌 Related tickets & additional notes\nNone.');
        expect(logs.at(-1)).toBe('88');
    });

    it('resolves the lane from a nested subdirectory of the lane', () => {
        const { port, calls } = fakePort({
            trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
            cwd: `${CLEANUP_LANE}/scripts/__tests__`,
        });

        expect(publishLane(undefined, port, undefined, TEST_INSTRUCTIONS)).toBe(88);
        expect(calls).toContain('push:agent/cleanup');
    });

    it('never matches a lane whose path is only a string prefix of the cwd', () => {
        const foo = worktree({ path: '/repo/.agents/worktrees/agent--foo', branch: 'agent/foo' });
        const fooTwo = worktree({ path: '/repo/.agents/worktrees/agent--foo-2', branch: 'agent/foo-2' });

        expect(resolveAuthorLane(undefined, [foo, fooTwo], '/repo/.agents/worktrees/agent--foo-2')).toEqual({
            path: '/repo/.agents/worktrees/agent--foo-2',
            branch: 'agent/foo-2',
            legacy: false,
        });
        expect(() => resolveAuthorLane(undefined, [foo], '/repo/.agents/worktrees/agent--foo-2')).toThrow(
            /not inside a locked author lane/
        );
    });

    it('picks the innermost lane when one author lane is nested inside another', () => {
        const outer = worktree({ path: '/repo/.agents/worktrees/agent--foo', branch: 'agent/foo' });
        const inner = worktree({ path: '/repo/.agents/worktrees/agent--foo/inner', branch: 'agent/inner' });

        expect(resolveAuthorLane(undefined, [outer, inner], '/repo/.agents/worktrees/agent--foo/inner/src')).toEqual({
            path: '/repo/.agents/worktrees/agent--foo/inner',
            branch: 'agent/inner',
            legacy: false,
        });
    });

    it('measures lane depth on the canonical paths, not the recorded spellings', () => {
        const resolver = (path: string) => (path === '/w' || path.startsWith('/w/') ? `/private${path}` : path);
        const outer = worktree({ path: '/private/w/a', branch: 'agent/outer' });
        const inner = worktree({ path: '/w/a/i', branch: 'agent/inner' });

        expect(resolveAuthorLane(undefined, [outer, inner], '/w/a/i/src', resolver)).toEqual({
            path: '/w/a/i',
            branch: 'agent/inner',
            legacy: false,
        });
    });

    it.each([
        ['there is no locked author lane at all', [] as PublishWorktree[], PRIMARY_ROOT],
        ['the cwd is the primary root', otherAuthorLanes(), PRIMARY_ROOT],
        ['the cwd is outside every lane', otherAuthorLanes(), '/elsewhere/checkout'],
        [
            'the cwd is inside a worktree locked by someone else',
            [
                ...otherAuthorLanes(),
                worktree({
                    path: '/repo/.agents/worktrees/collab-sync-state',
                    branch: 'collab/sync',
                    lockReason: 'active:collab-lane-3',
                }),
            ],
            '/repo/.agents/worktrees/collab-sync-state',
        ],
    ])('refuses to publish without an issue when %s', (_case, trees, cwd) => {
        const { port, calls } = fakePort({ trees, cwd });

        expect(() => publishLane(undefined, port)).toThrow(
            /not inside a locked author lane: pass its issue number or --lane with its absolute worktree root/
        );
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('refuses to publish without an issue when the cwd is inside an unlocked worktree with an open pull request', () => {
        // An open pull request alone must never grant push authority: `locked` is the other half
        // of the legacy-candidacy gate, and dropping it would let an unlocked worktree fall to
        // `legacyLockMigrationMessage`, which hands out `git worktree unlock`/`lock` for a
        // worktree that was never locked and never an author lane — the exact misdirection this
        // gate exists to prevent.
        const trees = [
            ...otherAuthorLanes(),
            worktree({
                path: '/repo/.agents/worktrees/scratch',
                branch: 'scratch',
                locked: false,
                lockReason: undefined,
            }),
        ];
        const { port, calls } = fakePort({ trees, cwd: '/repo/.agents/worktrees/scratch', existing: 99 });

        const message = refusalMessage(() => publishLane(undefined, port));
        expect(message).toMatch(
            /not inside a locked author lane: pass its issue number or --lane with its absolute worktree root/
        );
        expect(message).not.toContain('git worktree unlock');
        expect(message).not.toContain('git worktree lock');
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('refuses an author-locked, off-convention branch with no open pull request, naming the branch', () => {
        // Correctly locked (AUTHOR_LOCK_REASON) but off-convention, e.g. a hand-locked release
        // branch or a not-yet-published legacy lane: proves the lock alone is not enough, the open
        // pull request is the actual gate.
        const trees = [...otherAuthorLanes(), worktree({ path: '/repo/release-1-2', branch: 'release/1.2' })];

        expect(() => resolveAuthorLane(undefined, trees, '/repo/release-1-2')).toThrow(/release\/1\.2/);
        expect(() => resolveAuthorLane(undefined, trees, '/repo/release-1-2')).toThrow(/no open pull request/);
    });

    it('resolves symlinked paths on both sides before comparing', () => {
        const resolver = (path: string) => (path.startsWith('/var/') ? `/private${path}` : path);
        const trees = [
            worktree({ path: '/var/lanes/agent--cleanup', branch: 'agent/cleanup' }),
            worktree({ path: '/private/var/lanes/agent--other', branch: 'agent/other' }),
        ];

        expect(resolveAuthorLane(undefined, trees, '/var/lanes/agent--cleanup/scripts', resolver)).toEqual({
            path: '/var/lanes/agent--cleanup',
            branch: 'agent/cleanup',
            legacy: false,
        });
        expect(resolveAuthorLane(undefined, trees, '/private/var/lanes/agent--cleanup', resolver)).toEqual({
            path: '/var/lanes/agent--cleanup',
            branch: 'agent/cleanup',
            legacy: false,
        });
    });

    it('makes a relative lane path absolute before resolving symlinks', () => {
        const laneAbsolute = resolve('lanes/agent--relative');
        const resolver = (path: string) => (path === laneAbsolute ? `${laneAbsolute}-real` : path);
        const trees = [worktree({ path: 'lanes/agent--relative', branch: 'agent/relative' })];

        expect(resolveAuthorLane(undefined, trees, `${laneAbsolute}-real/src`, resolver)).toEqual({
            path: 'lanes/agent--relative',
            branch: 'agent/relative',
            legacy: false,
        });
    });

    it('resolves a supplied issue by branch prefix without consulting the cwd', () => {
        const trees = [...otherAuthorLanes(), worktree()];

        expect(resolveAuthorLane(12, trees, PRIMARY_ROOT)).toEqual({
            path: ISSUE_LANE,
            branch: 'agent/12/work',
            legacy: false,
        });
        expect(resolveAuthorLane(12, trees, '/elsewhere/checkout')).toEqual({
            path: ISSUE_LANE,
            branch: 'agent/12/work',
            legacy: false,
        });
        expect(() =>
            resolveAuthorLane(2237, [...trees, worktree({ branch: 'agent/2237/second' })], PRIMARY_ROOT)
        ).toThrow(/expected exactly one locked author lane for issue #2237/);
    });

    it('refuses a supplied issue that does not exist and touches nothing first', () => {
        const { port, calls } = fakePort({ issueExists: false, dirty: true });

        expect(() => publishLane(12, port)).toThrow(/issue #12 does not exist in jcosta33\/sourdaw/);
        expect(calls).toContain('issueExists:12');
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('reads issue existence from the gh api exit status, not from stdout alone', () => {
        expect(issueLookupArgs(12)).toEqual([
            'api',
            'repos/jcosta33/sourdaw/issues/12',
            '--jq',
            '{number: .number, isPullRequest: (has("pull_request"))}',
        ]);
        const found = issueExistsFromLookup(12, {
            status: 0,
            stdout: '{"number":12,"isPullRequest":false}\n',
            stderr: '',
        });
        expect(found).toBe(true);
        expect(issueExistsFromLookup(12, { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' })).toBe(false);
        expect(() =>
            issueExistsFromLookup(12, { status: 1, stdout: '', stderr: 'gh: Bad credentials (HTTP 401)' })
        ).toThrow(/Bad credentials/);
    });

    it('refuses a pull-request number, which the issues endpoint resolves just as happily', () => {
        expect(() =>
            issueExistsFromLookup(2254, { status: 0, stdout: '{"number":2254,"isPullRequest":true}\n', stderr: '' })
        ).toThrow(/#2254 in jcosta33\/sourdaw is a pull request, not an issue/);
    });

    it('uses the lane subject as the pull-request title', () => {
        const { port, calls } = fakePort({ subject: 'feat(foo): bar' });

        publishLane(12, port, undefined, TEST_INSTRUCTIONS);

        expect(calls.some((call) => call.includes('feat(foo): bar'))).toBe(true);
    });

    it.each(REFUSED_PUBLISH_CASES)('refuses %s', (_case, input, message) => {
        const { port, calls } = fakePort(input);

        expect(() => publishLane(12, port, undefined, TEST_INSTRUCTIONS)).toThrow(message);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('parses porcelain worktrees and argv', () => {
        const parsed = parsePublishWorktrees(
            'worktree /repo\0HEAD root\0branch refs/heads/main\0\0worktree /lane\0HEAD head\0branch refs/heads/agent/12/work\0locked active:sourdaw-author\0\0'
        );
        expect(parsed[1]).toEqual({
            path: '/lane',
            branch: 'agent/12/work',
            locked: true,
            lockReason: AUTHOR_LOCK_REASON,
        });
        expect(parsePublishLaneArgs(['12'])).toEqual({ issue: 12, help: false });
        expect(parsePublishLaneArgs(['12', '--relates'])).toEqual({ issue: 12, relationship: 'relates', help: false });
        expect(parsePublishLaneArgs(['--lane', CLEANUP_LANE, '--relates'])).toEqual({
            lanePath: CLEANUP_LANE,
            relationship: 'relates',
            help: false,
        });
        expect(parsePublishLaneArgs(['--test', TEST_INSTRUCTIONS, '12', '--relates'])).toEqual({
            issue: 12,
            relationship: 'relates',
            testInstructions: TEST_INSTRUCTIONS,
            help: false,
        });
        expect(parsePublishLaneArgs(['--relates'])).toEqual({ relationship: 'relates', help: false });
        expect(parsePublishLaneArgs([])).toEqual({ help: false });
        expect(parsePublishLaneArgs(['--help'])).toEqual({ help: true });
        expect(() => parsePublishLaneArgs(['12', '13'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['--relates', '--relates'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['--test'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['--test', TEST_INSTRUCTIONS, '--test', TEST_INSTRUCTIONS])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['--lane', 'relative/lane'])).toThrow(/absolute path/);
        expect(() => parsePublishLaneArgs(['12', '--lane', CLEANUP_LANE])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['beat'])).toThrow(/usage/);
    });

    it('carries the selected lane path into the port for explicit path resolution', () => {
        const session: GhSession = { configDir: '/tmp/sourdaw-gh', env: {}, dispose: () => undefined };
        const here = dirname(fileURLToPath(import.meta.url));

        expect(here).not.toBe(resolvePrimaryRoot(undefined, here));
        expect(shellPort(session, here).cwd()).toBe(here);
        expect(shellPort(session).cwd()).toBe(process.cwd());
    });

    /**
     * The regression this pins is a real merge commit, so it is measured against real git history:
     * a fake port can only prove which port member `publishLane` calls, never what the git command
     * behind it answers. The merge subject is the one that reached `main` through pull request
     * #2281, and the `main` commit is dated after the lane commit so a walk that leaves the
     * `origin/main..HEAD` range picks it up.
     */
    it('takes the subject from the newest lane commit, never a merge or an origin/main commit', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-subject-'));
        const session: GhSession = { configDir: '/tmp/sourdaw-gh', env: {}, dispose: () => undefined };
        const git = (args: string[], date = '2026-01-01T00:00:00') =>
            execFileSync('git', args, {
                cwd: repository,
                encoding: 'utf8',
                env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
            }).trim();
        const commit = (file: string, message: string, date: string) => {
            writeFileSync(join(repository, file), `${message}\n`);
            git(['add', '-A'], date);
            git(['commit', '--no-gpg-sign', '-m', message], date);
        };
        try {
            git(['init', '-b', 'main']);
            git(['config', 'user.name', 'Fixture']);
            git(['config', 'user.email', 'fixture@example.com']);
            commit('base.txt', 'chore(fixture): base', '2026-01-01T00:00:00');
            const base = git(['rev-parse', 'HEAD']);
            git(['checkout', '-b', 'agent/12/work']);
            commit('lane.txt', 'feat(issue): add milestone and project support', '2026-01-01T00:01:00');
            git(['checkout', 'main']);
            commit('main.txt', 'docs(main): a commit the lane merely merged in', '2026-01-01T00:05:00');
            git(['update-ref', 'refs/remotes/origin/main', git(['rev-parse', 'main'])]);
            git(['checkout', 'agent/12/work']);
            const mergeSubject = 'chore(build): merge main into the tracker metadata lane';
            git(['merge', '--no-ff', '--no-gpg-sign', 'main', '-m', mergeSubject], '2026-01-01T00:10:00');

            expect(git(['log', '-1', '--format=%s'])).toBe(mergeSubject);
            expect(
                shellPort(session, repository).laneSubject(repository, git(['rev-parse', 'origin/main']), 'HEAD')
            ).toBe('feat(issue): add milestone and project support');

            git(['checkout', '-b', 'agent/13/merge-only', base]);
            git(['merge', '--no-ff', '--no-gpg-sign', 'main', '-m', mergeSubject], '2026-01-01T00:11:00');
            expect(git(['rev-list', '--count', 'origin/main..HEAD'])).toBe('1');
            expect(
                shellPort(session, repository).laneSubject(repository, git(['rev-parse', 'origin/main']), 'HEAD')
            ).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it('requests headRefName, isCrossRepository, and the body the update path must preserve', () => {
        expect(existingOpenPullRequestArgs('agent/12/work')).toEqual([
            'pr',
            'list',
            '--repo',
            'jcosta33/sourdaw',
            '--head',
            'agent/12/work',
            '--state',
            'open',
            '--json',
            'number,headRefName,isCrossRepository,body',
        ]);
        expect(existingOpenPullRequestArgs('agent/12/work').join(' ')).not.toContain('jcosta33:agent');
    });

    describe('matchingOpenPullRequest', () => {
        function row(overrides: Partial<OpenPullRequestRow> = {}): OpenPullRequestRow {
            return {
                number: 41,
                headRefName: 'agent/12/work',
                isCrossRepository: false,
                body: '### 📌 Related tickets & additional notes\nCloses #12',
                ...overrides,
            };
        }

        it('accepts an exact same-repo head match, and carries its body forward', () => {
            expect(matchingOpenPullRequest([row()], 'agent/12/work')).toEqual({
                number: 41,
                headRefName: 'agent/12/work',
                isCrossRepository: false,
                body: '### 📌 Related tickets & additional notes\nCloses #12',
            });
        });

        it('rejects a longer branch name that merely starts with the queried one', () => {
            // Neither `--head` nor `gh`'s matching is documented as exact vs. prefix; the gate must
            // not depend on that. A pull request open on `agent/12/work-extra` must never authorize
            // a push targeting `agent/12/work`.
            expect(
                matchingOpenPullRequest([row({ headRefName: 'agent/12/work-extra' })], 'agent/12/work')
            ).toBeUndefined();
        });

        it('rejects a cross-repository pull request with the identical head name', () => {
            // `--repo` scopes the base repository, not the head repository, so a fork can open a
            // pull request whose head branch happens to share the exact same name.
            expect(matchingOpenPullRequest([row({ isCrossRepository: true })], 'agent/12/work')).toBeUndefined();
        });

        it('still refuses more than one matching open pull request', () => {
            expect(() => matchingOpenPullRequest([row(), row({ number: 42 })], 'agent/12/work')).toThrow(
                /agent\/12\/work has more than one open pull request/
            );
        });
    });

    describe('legacy, pre-agent/ lanes', () => {
        function legacyWorktree(overrides: Partial<PublishWorktree> = {}): PublishWorktree {
            return {
                path: LEGACY_LANE,
                branch: LEGACY_BRANCH,
                locked: true,
                lockReason: AUTHOR_LOCK_REASON,
                ...overrides,
            };
        }

        it('never resolves a legacy candidate by issue argument, even fully qualified', () => {
            // The candidate here is exactly what an unmodified legacy fallback would accept: correct
            // lock, an open pull request. Nothing in the branch ties it to issue 2039 specifically —
            // `laneIssueNumber` requires the `agent/` prefix this branch doesn't have — so resolving
            // it here would let `pnpm lane:publish <any real issue>` push an unrelated stranded lane
            // and stamp `Closes #<that issue>` on its pull request. This is the test that goes red if
            // the legacy fallback is reinstated in the issue-argument branch.
            const trees = [...otherAuthorLanes(), legacyWorktree()];

            expect(() => resolveAuthorLane(2039, trees, PRIMARY_ROOT, undefined, () => true)).toThrow(
                /expected exactly one locked author lane for issue #2039/
            );
        });

        it('never resolves a legacy candidate whose path does not enclose cwd, even with an open pull request', () => {
            // Live on this machine: several author-locked, off-convention worktrees carry open
            // pull requests beside the primary root. Without the containment check, `cwd` outside
            // every one of them would still let the loop resolve and push whichever candidate
            // sorts first by canonical path length, instead of refusing outright.
            const trees = [...otherAuthorLanes(), legacyWorktree()];
            const { port, calls } = fakePort({ trees, cwd: PRIMARY_ROOT, existing: 2275 });

            expect(() => publishLane(undefined, port)).toThrow(
                /not inside a locked author lane: pass its issue number or --lane with its absolute worktree root/
            );
            expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        });

        it('never treats the primary worktree as a legacy candidate, even locked with an open pull request', () => {
            // `git worktree list` always lists the primary checkout first. A hand-locked root
            // whose branch happens to have an open pull request must still refuse, symmetrically
            // with `removeLane`'s own explicit "refusing to remove the primary worktree" check.
            const trees = [
                worktree({ path: PRIMARY_ROOT, branch: 'main', lockReason: AUTHOR_LOCK_REASON }),
                ...otherAuthorLanes(),
            ];
            const { port, calls } = fakePort({ trees, cwd: PRIMARY_ROOT, existing: 2275 });

            expect(() => publishLane(undefined, port)).toThrow(
                /not inside a locked author lane: pass its issue number or --lane with its absolute worktree root/
            );
            expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        });

        it('resolves an explicitly selected off-convention branch with an open pull request', () => {
            const trees = [...otherAuthorLanes(), legacyWorktree()];

            expect(resolveAuthorLane(undefined, trees, `${LEGACY_LANE}/src`, undefined, () => true)).toEqual({
                path: LEGACY_LANE,
                branch: LEGACY_BRANCH,
                legacy: true,
            });
        });

        it('refuses an off-convention branch with no open pull request, naming the branch as the reason', () => {
            const trees = [...otherAuthorLanes(), legacyWorktree()];

            expect(() => resolveAuthorLane(undefined, trees, LEGACY_LANE, undefined, () => false)).toThrow(
                new RegExp(`${LEGACY_BRANCH.replace('/', '\\/')}.*no open pull request`)
            );
        });

        it('refuses a lock that names another owner without telling the caller how to take it', () => {
            // The lock reason is the only ownership signal this gate has, so an unrecognized
            // `active:<someone>` is an owner, not a lane that forgot to migrate. Printing the
            // unlock/relock pair here is a recipe: run the two commands and the next invocation
            // resolves, commits, pushes, and rewrites that owner's pull request.
            const trees = [...otherAuthorLanes(), legacyWorktree({ lockReason: 'active:principal' })];
            const message = refusalMessage(() =>
                resolveAuthorLane(undefined, trees, LEGACY_LANE, undefined, () => true)
            );

            expect(message).toContain('active:principal');
            expect(message).toContain(`only ${AUTHOR_LOCK_REASON} may publish`);
            expect(message).not.toContain('git worktree unlock');
            expect(message).not.toContain('git worktree lock');
        });

        it('offers the lock migration only for a lock that names nobody', () => {
            const remedy = new RegExp(
                `git worktree unlock ${LEGACY_LANE} && git worktree lock --reason ${AUTHOR_LOCK_REASON} ${LEGACY_LANE}`
            );
            const unowned = (lockReason: string | undefined) => [...otherAuthorLanes(), legacyWorktree({ lockReason })];

            expect(
                refusalMessage(() =>
                    resolveAuthorLane(undefined, unowned(undefined), LEGACY_LANE, undefined, () => true)
                )
            ).toMatch(remedy);
            // `lane-remove:<pid>` is `removeLane`'s own marker: it records a removal, not an owner.
            expect(
                refusalMessage(() =>
                    resolveAuthorLane(undefined, unowned('lane-remove:2147483647'), LEGACY_LANE, undefined, () => true)
                )
            ).toMatch(remedy);
        });

        it('does not treat a foreign lock on an off-convention branch as a legacy candidate at all', () => {
            // A collaboration-session lock is not "not yet migrated" — it was never an author lane.
            // Without a proven open pull request it must fall through to the ordinary refusal, not
            // a legacy-specific one that would wrongly invite relocking someone else's worktree.
            const trees = [
                ...otherAuthorLanes(),
                legacyWorktree({ lockReason: 'active:collab-lane-3', branch: 'collab/sync' }),
            ];

            expect(() => resolveAuthorLane(undefined, trees, LEGACY_LANE, undefined, () => false)).toThrow(
                /not inside a locked author lane: pass its issue number or --lane with its absolute worktree root/
            );
        });

        it('parses no issue number out of a legacy branch whose slug happens to end in digits', () => {
            expect(laneIssueNumber(LEGACY_BRANCH)).toBeUndefined();
            expect(laneIssueNumber('fix/proof-metering-bs1770-2039')).toBeUndefined();
            expect(laneIssueNumber('fix/arrangement-satellite-paths-2039')).toBeUndefined();
        });

        it('falls through to a valid enclosing conforming lane when a deeper legacy candidate refuses', () => {
            // The legacy candidate is nested inside the conforming lane and is the deepest enclosing
            // candidate, so it is tried first. Its lock is wrong (`active:collab-lane-9`, not
            // AUTHOR_LOCK_REASON) and it does have an open pull request, so `resolveLegacyCandidate`
            // refuses it as someone else's worktree. That refusal is the deepest candidate's, not
            // the operator's: the loop must record it and fall through to the shallower conforming
            // lane the operator is actually standing in.
            const outer = worktree({ path: '/repo/.agents/worktrees/agent--outer', branch: 'agent/outer' });
            const nestedLegacy = worktree({
                path: '/repo/.agents/worktrees/agent--outer/legacy-nested',
                branch: 'fix/legacy-nested',
                lockReason: 'active:collab-lane-9',
            });

            expect(
                resolveAuthorLane(
                    undefined,
                    [outer, nestedLegacy],
                    '/repo/.agents/worktrees/agent--outer/legacy-nested/src',
                    undefined,
                    () => true
                )
            ).toEqual({ path: '/repo/.agents/worktrees/agent--outer', branch: 'agent/outer', legacy: false });
        });

        it.each([
            ['the token is rejected', 'gh: Bad credentials (HTTP 401)'],
            [
                'the branch has more than one open pull request',
                'branch fix/legacy-nested has more than one open pull request',
            ],
        ])('propagates a pull-request lookup that failed when %s', (_case, failure) => {
            // A throw out of `hasOpenPullRequest` means "could not find out", never "this candidate
            // does not apply". Only `resolveLegacyCandidate`'s own two refusals mean the latter, so
            // an unknown must stop resolution instead of falling through to a shallower lane and
            // pushing it.
            const outer = worktree({ path: '/repo/.agents/worktrees/agent--outer', branch: 'agent/outer' });
            const nestedLegacy = worktree({
                path: '/repo/.agents/worktrees/agent--outer/legacy-nested',
                branch: 'fix/legacy-nested',
            });

            expect(() =>
                resolveAuthorLane(
                    undefined,
                    [outer, nestedLegacy],
                    '/repo/.agents/worktrees/agent--outer/legacy-nested/src',
                    undefined,
                    () => {
                        throw new Error(failure);
                    }
                )
            ).toThrow(failure);
        });

        it('publishes a legacy lane by pushing only, leaving its pull request exactly as written', () => {
            // `lane:publish` did not author this pull request and cannot reproduce it:
            // `laneIssueNumber` reads only the `agent/<issue>/` shape, so recomposing the body would
            // replace a hand-written `Closes #2039` with `None.` and stop the merge closing the
            // issue. The push is the whole deliverable.
            const { port, calls, bodies } = fakePort({
                trees: [...otherAuthorLanes(), legacyWorktree()],
                cwd: LEGACY_LANE,
                existing: 2275,
            });

            expect(publishLane(undefined, port)).toBe(2275);
            expect(calls).toContain(`push:${LEGACY_BRANCH}`);
            expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
            expect(bodies).toEqual([]);
        });

        it('publishes a legacy lane whose only commits above origin/main are merges', () => {
            // The newest-non-merge-commit title rule, and the refusal for a lane that has no such
            // commit, both exist to name a title this script is about to write. A legacy lane's
            // title is not this script's to write, so neither may reach it. `subject: null` is
            // exactly the input that refuses on a conforming lane; here the push must still happen.
            const { port, calls, bodies } = fakePort({
                trees: [...otherAuthorLanes(), legacyWorktree()],
                cwd: LEGACY_LANE,
                existing: 2275,
                subject: null,
            });

            expect(publishLane(undefined, port)).toBe(2275);
            expect(calls).toContain(`push:${LEGACY_BRANCH}`);
            expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
            expect(bodies).toEqual([]);
        });

        it('asks about the legacy lane own branch, both when authorizing and after the push', () => {
            const { port, calls } = fakePort({
                trees: [...otherAuthorLanes(), legacyWorktree()],
                cwd: LEGACY_LANE,
                existing: 2275,
            });

            publishLane(undefined, port);

            expect(calls.filter((call) => call.startsWith('pr:'))).toEqual([
                `pr:${LEGACY_BRANCH}`,
                `pr:${LEGACY_BRANCH}`,
            ]);
        });

        it('refuses when the pull request that authorized the legacy push is gone by the time it lands', () => {
            // Resolution and the post-push lookup are two separate queries. If the pull request
            // closed in between there is nothing to update and nothing this script may author, so
            // it must refuse rather than open a replacement carrying a regenerated body.
            const { port, calls } = fakePort({
                trees: [...otherAuthorLanes(), legacyWorktree()],
                cwd: LEGACY_LANE,
                existingByCall: [2275, undefined],
            });

            expect(() => publishLane(undefined, port)).toThrow(/no longer has an open pull request/);
            expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
        });
    });
});
