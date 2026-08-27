import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    AUTHOR_BOT_NODE_ID,
    AUTHOR_WORKFLOW_MINT_PERMISSIONS,
    TRACKER_AUTHOR_MINT_PERMISSIONS,
    isAuthorBotNodeId,
    AUTHOR_MINT_PERMISSIONS,
    GITHUB_HTTPS_REMOTE,
    REVIEWER_BOT_NODE_ID,
    REVIEWER_MINT_PERMISSIONS,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticatePublishingAuthor,
    authenticateRole,
    authenticateTrackerAuthor,
    createGhSession,
    gitAuthenticatedArgs,
    gitCredentialHelperPath,
    githubChildEnv,
    githubAuthorizationGitEnv,
    isReviewerBotNodeId,
    loadRoleCredentials,
    mintInstallationToken,
    parseDotenv,
    parseGraphqlResponse,
    resolvePrimaryRoot,
    spawnCapture,
    authorWorkflowWriteRequired,
    type FileReader,
    type GitHubJsonClient,
} from '../githubAppIdentity.ts';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const PUBLISHING_HEAD = 'a'.repeat(40);
const PUBLISHING_BASE = 'b'.repeat(40);
const RENAMED_AUTHOR_LOGIN = 'hplovecraft208[bot]';
const RENAMED_REVIEWER_LOGIN = 'tmckenna1611[bot]';

const authorFile = `SOURDAW_GITHUB_APP_ID=4650613
SOURDAW_GITHUB_APP_INSTALLATION_ID=154969409
SOURDAW_GITHUB_APP_PRIVATE_KEY_FILE=.env.sourdaw-author.pem
`;

function files(overrides: Record<string, string> = {}): FileReader {
    const tree: Record<string, string> = {
        '/repo/.env.sourdaw-author': authorFile,
        '/repo/.env.sourdaw-author.pem': pem,
        '/repo/.env.sourdaw-reviewer': `SOURDAW_GITHUB_APP_ID=4650634
SOURDAW_GITHUB_APP_INSTALLATION_ID=154970590
SOURDAW_GITHUB_APP_PRIVATE_KEY="${pem.replaceAll('\n', '\\n')}"
`,
        '/repo/.env': `SOURDAW_GITHUB_APP_PRIVATE_KEY=shared-secret
GH_TOKEN=parent-token
`,
        '/lane/.env.sourdaw-author': 'SOURDAW_GITHUB_APP_ID=should-not-load\n',
        ...overrides,
    };
    return (path) => {
        const contents = tree[path];
        if (contents === undefined) {
            throw new Error(`ENOENT ${path}`);
        }
        return contents;
    };
}

function mintClient(input: {
    login: string;
    actorNodeId?: string;
    permissions: Record<string, string>;
    token?: string;
    appStatus?: number;
    actorStatus?: number;
    mintStatus?: number;
}): {
    requests: Array<{ url: string; body?: string; authorization?: string }>;
    request: GitHubJsonClient;
} {
    const requests: Array<{ url: string; body?: string; authorization?: string }> = [];
    return {
        requests,
        request: async (url, init) => {
            requests.push({ url, body: init.body, authorization: init.headers.Authorization });
            if (url.includes('/access_tokens')) {
                return {
                    status: input.mintStatus ?? 201,
                    body: { token: input.token ?? 'ghs_minted', permissions: input.permissions },
                };
            }
            if (url.endsWith('/app')) {
                return { status: input.appStatus ?? 200, body: { slug: input.login.replace('[bot]', '') } };
            }
            return {
                status: input.actorStatus ?? 200,
                body: {
                    login: input.login,
                    node_id:
                        input.actorNodeId ??
                        (input.login === RENAMED_AUTHOR_LOGIN ? AUTHOR_BOT_NODE_ID : REVIEWER_BOT_NODE_ID),
                    type: 'Bot',
                },
            };
        },
    };
}

function publishingCapture(diff: string, onDiff?: () => void) {
    return (_command: string, args: string[]) => {
        if (args[0] === 'rev-parse') {
            return `${PUBLISHING_HEAD}\n`;
        }
        onDiff?.();
        return diff;
    };
}

function runCredentialHelper(helperPath: string, action: string, input: string): string {
    const result = spawnSync(helperPath, [action], { encoding: 'utf8', input });
    if (result.error !== undefined) {
        throw result.error;
    }
    expect(result.status).toBe(0);
    return result.stdout;
}

describe('dotenv and role files', () => {
    it('loads only the author file from the primary root', () => {
        const read = files();
        const reads: string[] = [];
        const credentials = loadRoleCredentials('/repo', 'author', (path) => {
            reads.push(path);
            return read(path);
        });
        expect(reads).toEqual(['/repo/.env.sourdaw-author', '/repo/.env.sourdaw-author.pem']);
        expect(credentials.appId).toBe('4650613');
        expect(credentials.privateKey.includes('BEGIN')).toBe(true);
    });

    it('loads only the reviewer file from the primary root', () => {
        const reads: string[] = [];
        loadRoleCredentials('/repo', 'reviewer', (path) => {
            reads.push(path);
            return files()(path);
        });
        expect(reads.some((path) => path.endsWith('.env.sourdaw-reviewer'))).toBe(true);
        expect(reads.some((path) => path.endsWith('.env.sourdaw-author'))).toBe(false);
        expect(reads.some((path) => path.endsWith('/.env'))).toBe(false);
    });

    it('ignores a worktree-local author file', () => {
        const reads: string[] = [];
        loadRoleCredentials('/repo', 'author', (path) => {
            reads.push(path);
            return files()(path);
        });
        expect(reads).not.toContain('/lane/.env.sourdaw-author');
    });

    it('parses quoted escaped newlines', () => {
        expect(parseDotenv('SOURDAW_GITHUB_APP_PRIVATE_KEY="a\\nb"').SOURDAW_GITHUB_APP_PRIVATE_KEY).toBe('a\nb');
    });

    it('fails when the author credentials file is missing', () => {
        expect(() =>
            loadRoleCredentials('/repo', 'author', () => {
                throw new Error('ENOENT');
            })
        ).toThrow(/missing author credentials/);
    });

    it('fails when the author credentials file is incomplete', () => {
        expect(() =>
            loadRoleCredentials('/repo', 'author', files({ '/repo/.env.sourdaw-author': 'SOURDAW_GITHUB_APP_ID=1\n' }))
        ).toThrow(/missing SOURDAW_GITHUB_APP_ID/);
    });

    it('fails when the private key file is unreadable', () => {
        expect(() =>
            loadRoleCredentials('/repo', 'author', (path) => {
                if (path.endsWith('.pem')) {
                    throw new Error('ENOENT');
                }
                return files()(path);
            })
        ).toThrow(/unreadable/);
    });
});

describe('GraphQL envelopes', () => {
    it.each(['[]', 'null', '{"errors":{}}', '{"data":{},"errors":[]}', '{}'])(
        'rejects malformed envelopes: %s',
        (response) => {
            expect(() => parseGraphqlResponse(response, 'GraphQL query')).toThrow(/invalid GraphQL envelope/i);
        }
    );
});

describe('installation mint', () => {
    it.each([
        ['workflow file', '.github/workflows/health-gates.yml\0', true],
        ['workflow file containing a newline', '.github/workflows/nightly\ncheck.yml\0', true],
        ['lookalike directory', '.github/workflows-disabled/health-gates.yml\0', false],
        ['workflow directory itself', '.github/workflows\0', false],
        ['parent traversal lookalike', '.github/workflows/../CODEOWNERS\0', false],
        ['leading-dot lookalike', './.github/workflows/health-gates.yml\0', false],
    ])('detects an exact committed %s before mint', (_case, diff, expected) => {
        const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

        expect(
            authorWorkflowWriteRequired('/lane', PUBLISHING_BASE, 'HEAD', (command, args, cwd) => {
                calls.push({ command, args, cwd });
                return diff;
            })
        ).toBe(expected);
        expect(calls).toEqual([
            {
                command: 'git',
                args: [
                    'diff',
                    '--no-ext-diff',
                    '--no-textconv',
                    '--name-only',
                    '--no-renames',
                    '-z',
                    `${PUBLISHING_BASE}...HEAD`,
                    '--',
                ],
                cwd: '/lane',
            },
        ]);
    });

    it('rejects a non-NUL-terminated committed-path result', () => {
        expect(() =>
            authorWorkflowWriteRequired('/lane', PUBLISHING_BASE, 'HEAD', () => '.github/workflows/health-gates.yml')
        ).toThrow(/NUL-terminated/);
    });

    it('keeps an ordinary lane on the ordinary mint despite hostile inherited Git routing', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-workflow-auth-'));
        const ordinary = join(root, 'ordinary');
        const hostile = join(root, 'hostile');
        const git = (repository: string, args: string[]): string => {
            const env = { ...process.env };
            delete env.GIT_DIR;
            delete env.GIT_WORK_TREE;
            const result = spawnSync('git', args, { cwd: repository, env, encoding: 'utf8', shell: false });
            if (result.error !== undefined) {
                throw result.error;
            }
            expect(result.status, result.stderr).toBe(0);
            return result.stdout.trim();
        };
        const repository = (path: string, changedPath: string): string => {
            mkdirSync(path, { recursive: true });
            git(path, ['init', '-b', 'main']);
            git(path, ['config', 'user.name', 'Fixture']);
            git(path, ['config', 'user.email', 'fixture@example.com']);
            writeFileSync(join(path, 'base.txt'), 'base\n');
            git(path, ['add', 'base.txt']);
            git(path, ['commit', '--no-gpg-sign', '-m', 'chore: base']);
            const baseSha = git(path, ['rev-parse', 'HEAD']);
            git(path, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
            const target = join(path, changedPath);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, 'change\n');
            git(path, ['add', '--', changedPath]);
            git(path, ['commit', '--no-gpg-sign', '-m', 'test: lane change']);
            return baseSha;
        };

        try {
            const ordinaryBase = repository(ordinary, 'scripts/publishLane.ts');
            repository(hostile, '.github/workflows/hostile.yml');
            const { requests, request } = mintClient({
                login: RENAMED_AUTHOR_LOGIN,
                permissions: { contents: 'write', pull_requests: 'write' },
            });
            const auth = await authenticatePublishingAuthor({
                primaryRoot: '/repo',
                lane: { path: ordinary, branch: 'agent/12/ordinary' },
                baseSha: ordinaryBase,
                readFile: files(),
                request,
                env: {
                    PATH: process.env.PATH,
                    GIT_DIR: join(hostile, '.git'),
                    GIT_WORK_TREE: hostile,
                },
            });

            try {
                expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ permissions: AUTHOR_MINT_PERMISSIONS });
                expect(requests[0]?.body).not.toContain('workflows');
            } finally {
                auth.session.dispose();
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('classifies against the fetched base instead of stale workflow history', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-workflow-base-'));
        const git = (args: string[]): string =>
            spawnCapture('git', args, { cwd: repository, env: githubAuthorizationGitEnv(), trim: false }).trim();
        try {
            git(['init', '-b', 'main']);
            git(['config', 'user.name', 'Fixture']);
            git(['config', 'user.email', 'fixture@example.com']);
            writeFileSync(join(repository, 'base.txt'), 'base\n');
            git(['add', 'base.txt']);
            git(['commit', '--no-gpg-sign', '-m', 'chore: base']);
            const staleBase = git(['rev-parse', 'HEAD']);
            mkdirSync(join(repository, '.github/workflows'), { recursive: true });
            writeFileSync(join(repository, '.github/workflows/gate.yml'), 'name: gate\n');
            git(['add', '.github/workflows/gate.yml']);
            git(['commit', '--no-gpg-sign', '-m', 'ci: add gate']);
            const fetchedBase = git(['rev-parse', 'HEAD']);
            writeFileSync(join(repository, 'lane.txt'), 'ordinary\n');
            git(['add', 'lane.txt']);
            git(['commit', '--no-gpg-sign', '-m', 'fix: ordinary lane']);
            const headSha = git(['rev-parse', 'HEAD']);

            expect(authorWorkflowWriteRequired(repository, staleBase, headSha)).toBe(true);
            expect(authorWorkflowWriteRequired(repository, fetchedBase, headSha)).toBe(false);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('sterilizes inherited Git and GitHub authority for authorization-only reads', () => {
        const env = githubAuthorizationGitEnv({
            PATH: '/usr/bin',
            GIT_DIR: '/hostile/.git',
            GIT_WORK_TREE: '/hostile',
            GIT_CONFIG_COUNT: '1',
            GIT_EXTERNAL_DIFF: '/hostile/diff',
            GH_TOKEN: 'personal',
            GITHUB_TOKEN: 'actions',
            SOURDAW_GITHUB_APP_PRIVATE_KEY: 'secret',
            SSH_AUTH_SOCK: '/tmp/agent.sock',
            NODE_OPTIONS: '--import=/hostile/preload.mjs',
            NODE_PATH: '/hostile/modules',
        });

        expect(env).toMatchObject({
            PATH: '/usr/bin',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_SYSTEM: '/dev/null',
            GIT_TERMINAL_PROMPT: '0',
            GIT_SSH_COMMAND: '/usr/bin/false',
            GIT_SSH: '/usr/bin/false',
            GCM_INTERACTIVE: 'never',
        });
        expect(env.GIT_DIR).toBeUndefined();
        expect(env.GIT_WORK_TREE).toBeUndefined();
        expect(env.GIT_CONFIG_COUNT).toBeUndefined();
        expect(env.GIT_EXTERNAL_DIFF).toBeUndefined();
        expect(env.GH_TOKEN).toBeUndefined();
        expect(env.GITHUB_TOKEN).toBeUndefined();
        expect(env.SOURDAW_GITHUB_APP_PRIVATE_KEY).toBeUndefined();
        expect(env.SSH_AUTH_SOCK).toBeUndefined();
        expect(env.NODE_OPTIONS).toBeUndefined();
        expect(env.NODE_PATH).toBeUndefined();
    });

    it('uses the launcher-resolved Git path instead of a child PATH command', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-git-path-'));
        const hostileBin = join(root, 'hostile');
        const hostileMarker = join(root, 'hostile-entered');
        const trustedGit = join(root, 'trusted-git');
        try {
            mkdirSync(hostileBin);
            writeFileSync(
                join(hostileBin, 'git'),
                `#!/bin/sh\nprintf entered > ${JSON.stringify(hostileMarker)}\nexit 91\n`
            );
            chmodSync(join(hostileBin, 'git'), 0o700);
            writeFileSync(trustedGit, '#!/bin/sh\nprintf trusted\n');
            chmodSync(trustedGit, 0o700);

            expect(
                spawnCapture('git', [], {
                    env: { PATH: hostileBin, SOURDAW_TRUSTED_GIT_PATH: trustedGit },
                })
            ).toBe('trusted');
            expect(existsSync(hostileMarker)).toBe(false);
            expect(() =>
                spawnCapture('git', [], {
                    env: { PATH: hostileBin, SOURDAW_TRUSTED_GIT_PATH: 'relative/git' },
                })
            ).toThrow(/trusted git executable path is not absolute/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('requests workflows write only when the publishing lane changes a workflow', async () => {
        const order: string[] = [];
        const { requests, request } = mintClient({
            login: RENAMED_AUTHOR_LOGIN,
            permissions: { contents: 'write', pull_requests: 'write', workflows: 'write' },
        });
        const auth = await authenticatePublishingAuthor({
            primaryRoot: '/repo',
            lane: { path: '/lane', branch: 'agent/12/workflow' },
            baseSha: PUBLISHING_BASE,
            readFile: files(),
            request: async (url, init) => {
                order.push(url.includes('/access_tokens') ? 'mint' : 'identity');
                return request(url, init);
            },
            env: {},
            capture: publishingCapture('.github/workflows/health-gates.yml\0', () => order.push('diff')),
        });
        try {
            expect(order[0]).toBe('diff');
            expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({
                permissions: AUTHOR_WORKFLOW_MINT_PERMISSIONS,
            });
        } finally {
            auth.session.dispose();
        }
    });

    it('keeps ordinary publishing lanes on the existing least-privilege author mint', async () => {
        const { requests, request } = mintClient({
            login: RENAMED_AUTHOR_LOGIN,
            permissions: { contents: 'write', pull_requests: 'write' },
        });
        const auth = await authenticatePublishingAuthor({
            primaryRoot: '/repo',
            lane: { path: '/lane', branch: 'agent/12/ordinary' },
            baseSha: PUBLISHING_BASE,
            readFile: files(),
            request,
            env: {},
            capture: publishingCapture('scripts/publishLane.ts\0'),
        });
        try {
            expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ permissions: AUTHOR_MINT_PERMISSIONS });
            expect(requests[0]?.body).not.toContain('workflows');
        } finally {
            auth.session.dispose();
        }
    });

    it('refuses workflow write returned for an ordinary publishing lane', async () => {
        const { requests, request } = mintClient({
            login: RENAMED_AUTHOR_LOGIN,
            permissions: { contents: 'write', pull_requests: 'write', workflows: 'write' },
        });

        await expect(
            authenticatePublishingAuthor({
                primaryRoot: '/repo',
                lane: { path: '/lane', branch: 'agent/12/ordinary' },
                baseSha: PUBLISHING_BASE,
                readFile: files(),
                request,
                env: {},
                capture: publishingCapture('scripts/publishLane.ts\0'),
            })
        ).rejects.toThrow(/workflows: write/);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it('refuses a workflow publishing token that omits workflow write', async () => {
        const { requests, request } = mintClient({
            login: RENAMED_AUTHOR_LOGIN,
            permissions: { contents: 'write', pull_requests: 'write' },
        });

        await expect(
            authenticatePublishingAuthor({
                primaryRoot: '/repo',
                lane: { path: '/lane', branch: 'agent/12/workflow' },
                baseSha: PUBLISHING_BASE,
                readFile: files(),
                request,
                env: {},
                capture: publishingCapture('.github/workflows/health-gates.yml\0'),
            })
        ).rejects.toThrow(/workflows is <missing>/);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it('accepts a renamed reviewer bot with the immutable reviewer actor ID', async () => {
        const { requests, request } = mintClient({
            login: RENAMED_REVIEWER_LOGIN,
            permissions: { contents: 'read', pull_requests: 'write' },
        });
        const minted = await mintInstallationToken({
            appId: '4650634',
            installationId: '1',
            privateKey: pem,
            permissions: REVIEWER_MINT_PERMISSIONS,
            expectedActorNodeId: REVIEWER_BOT_NODE_ID,
            request,
        });
        expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ permissions: REVIEWER_MINT_PERMISSIONS });
        expect(minted.login).toBe(RENAMED_REVIEWER_LOGIN);
        expect(minted.actorNodeId).toBe(REVIEWER_BOT_NODE_ID);
        expect(minted.token).toBe('ghs_minted');
        expect(requests.find((entry) => entry.url.includes('/users/'))?.authorization).toBe('Bearer ghs_minted');
    });
    it.each([
        ['reviewer', RENAMED_REVIEWER_LOGIN, AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID],
        ['author', RENAMED_AUTHOR_LOGIN, REVIEWER_BOT_NODE_ID, AUTHOR_BOT_NODE_ID],
    ])(
        'rejects the %s login when the author and reviewer actor IDs are swapped',
        async (_role, login, actorNodeId, expectedActorNodeId) => {
            const { request } = mintClient({
                login,
                actorNodeId,
                permissions: { contents: 'read', pull_requests: 'write' },
            });
            await expect(
                mintInstallationToken({
                    appId: '1',
                    installationId: '1',
                    privateKey: pem,
                    permissions: REVIEWER_MINT_PERMISSIONS,
                    expectedActorNodeId,
                    request,
                })
            ).rejects.toThrow(/minted bot actor .* is not expected actor/);
        }
    );
    it('rejects a non-success App identity response even when its slug matches', async () => {
        const { request } = mintClient({
            login: RENAMED_REVIEWER_LOGIN,
            permissions: { contents: 'read', pull_requests: 'write' },
            appStatus: 401,
        });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: REVIEWER_MINT_PERMISSIONS,
                expectedActorNodeId: REVIEWER_BOT_NODE_ID,
                request,
            })
        ).rejects.toThrow(/failed to verify GitHub App identity/i);
    });
    it.each([
        ['installation token mint', { mintStatus: 202 }, /failed to mint GitHub App installation token/],
        ['App identity', { appStatus: 202 }, /failed to verify GitHub App identity/],
    ])('rejects a 202 %s response with an otherwise valid payload', async (_case, statuses, expected) => {
        const { request } = mintClient({
            login: RENAMED_REVIEWER_LOGIN,
            permissions: { contents: 'read', pull_requests: 'write' },
            ...statuses,
        });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: REVIEWER_MINT_PERMISSIONS,
                expectedActorNodeId: REVIEWER_BOT_NODE_ID,
                request,
            })
        ).rejects.toThrow(expected);
    });

    it('refuses a reviewer token with contents write before further GitHub writes', async () => {
        const { requests, request } = mintClient({
            login: RENAMED_REVIEWER_LOGIN,
            permissions: { contents: 'write', pull_requests: 'write' },
        });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: REVIEWER_MINT_PERMISSIONS,
                expectedActorNodeId: REVIEWER_BOT_NODE_ID,
                request,
            })
        ).rejects.toThrow(/contents: write/);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it('refuses a reviewer token missing contents before further GitHub writes', async () => {
        const { requests, request } = mintClient({
            login: RENAMED_REVIEWER_LOGIN,
            permissions: { pull_requests: 'write' },
        });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: REVIEWER_MINT_PERMISSIONS,
                expectedActorNodeId: REVIEWER_BOT_NODE_ID,
                request,
            })
        ).rejects.toThrow(/contents is <missing>/);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it.each([
        ['missing', { contents: 'read' }],
        ['downgraded', { contents: 'read', pull_requests: 'read' }],
    ])('refuses a reviewer token with %s pull_requests before further GitHub writes', async (_case, permissions) => {
        const { requests, request } = mintClient({ login: RENAMED_REVIEWER_LOGIN, permissions });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: REVIEWER_MINT_PERMISSIONS,
                expectedActorNodeId: REVIEWER_BOT_NODE_ID,
                request,
            })
        ).rejects.toThrow(/pull_requests is (?:<missing>|read)/);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it('refuses extra write grants on a minted token before further GitHub writes', async () => {
        const { requests, request } = mintClient({
            login: RENAMED_REVIEWER_LOGIN,
            permissions: { contents: 'read', pull_requests: 'write', administration: 'write' },
        });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: REVIEWER_MINT_PERMISSIONS,
                expectedActorNodeId: REVIEWER_BOT_NODE_ID,
                request,
            })
        ).rejects.toThrow(/administration: write/);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it.each([
        [
            'unrequested admin',
            { contents: 'read', pull_requests: 'write', repository_projects: 'admin' },
            /repository_projects: admin/,
        ],
        ['requested write upgraded to admin', { contents: 'read', pull_requests: 'admin' }, /pull_requests is admin/],
    ])('refuses %s before further GitHub writes', async (_case, permissions, expected) => {
        const { requests, request } = mintClient({ login: RENAMED_REVIEWER_LOGIN, permissions });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: REVIEWER_MINT_PERMISSIONS,
                expectedActorNodeId: REVIEWER_BOT_NODE_ID,
                request,
            })
        ).rejects.toThrow(expected);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it('refuses an author token whose contents level does not match the request', async () => {
        const { requests, request } = mintClient({
            login: RENAMED_AUTHOR_LOGIN,
            permissions: { contents: 'read', pull_requests: 'write' },
        });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: AUTHOR_MINT_PERMISSIONS,
                expectedActorNodeId: AUTHOR_BOT_NODE_ID,
                request,
            })
        ).rejects.toThrow(/contents is read/);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it('allows extra read-only grants on a minted token', async () => {
        const { request } = mintClient({
            login: RENAMED_REVIEWER_LOGIN,
            permissions: { contents: 'read', pull_requests: 'write', metadata: 'read' },
        });
        const minted = await mintInstallationToken({
            appId: '1',
            installationId: '1',
            privateKey: pem,
            permissions: REVIEWER_MINT_PERMISSIONS,
            expectedActorNodeId: REVIEWER_BOT_NODE_ID,
            request,
        });
        expect(minted.token).toBe('ghs_minted');
    });

    it('requests only author contents write and pull_requests write', async () => {
        const { requests, request } = mintClient({
            login: RENAMED_AUTHOR_LOGIN,
            permissions: { contents: 'write', pull_requests: 'write' },
        });
        await mintInstallationToken({
            appId: '4650613',
            installationId: '1',
            privateKey: pem,
            permissions: AUTHOR_MINT_PERMISSIONS,
            expectedActorNodeId: AUTHOR_BOT_NODE_ID,
            request,
        });
        expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ permissions: AUTHOR_MINT_PERMISSIONS });
        expect(requests[0]?.body).not.toContain('administration');
        expect(requests[0]?.body).not.toContain('workflows');
    });

    it('requests only issues write for tracker maintenance', async () => {
        const { requests, request } = mintClient({
            login: RENAMED_AUTHOR_LOGIN,
            permissions: { issues: 'write' },
        });
        await mintInstallationToken({
            appId: '4650613',
            installationId: '1',
            privateKey: pem,
            permissions: TRACKER_AUTHOR_MINT_PERMISSIONS,
            expectedActorNodeId: AUTHOR_BOT_NODE_ID,
            request,
        });
        expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ permissions: TRACKER_AUTHOR_MINT_PERMISSIONS });
        expect(requests[0]?.body).not.toContain('contents');
        expect(requests[0]?.body).not.toContain('pull_requests');
    });

    it('creates an isolated issues-only tracker author session', async () => {
        const parent: NodeJS.ProcessEnv = { PATH: '/usr/bin', GH_TOKEN: 'inherited' };
        const { requests, request } = mintClient({
            login: RENAMED_AUTHOR_LOGIN,
            permissions: { issues: 'write' },
            token: 'ghs_tracker',
        });
        const auth = await authenticateTrackerAuthor({
            primaryRoot: '/repo',
            readFile: files(),
            request,
            env: parent,
        });
        try {
            expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ permissions: TRACKER_AUTHOR_MINT_PERMISSIONS });
            expect(auth.session.env.GH_TOKEN).toBe('ghs_tracker');
            expect(parent.GH_TOKEN).toBeUndefined();
        } finally {
            auth.session.dispose();
        }
    });

    it('mints tracker authentication against the installed author App grants without issue mutation', async () => {
        const requests: Array<{ url: string; body?: string }> = [];
        const request: GitHubJsonClient = async (url, init) => {
            requests.push({ url, body: init.body });
            if (url.includes('/access_tokens')) {
                if (init.body !== JSON.stringify({ permissions: { issues: 'write' } })) {
                    return { status: 422, body: { message: 'permissions exceed installation grants' } };
                }
                return {
                    status: 201,
                    body: {
                        token: 'ghs_tracker',
                        permissions: { issues: 'write', metadata: 'read' },
                    },
                };
            }
            if (url.endsWith('/app')) {
                return { status: 200, body: { slug: RENAMED_AUTHOR_LOGIN.replace('[bot]', '') } };
            }
            return {
                status: 200,
                body: { login: RENAMED_AUTHOR_LOGIN, node_id: AUTHOR_BOT_NODE_ID, type: 'Bot' },
            };
        };

        const auth = await authenticateTrackerAuthor({
            primaryRoot: '/repo',
            readFile: files(),
            request,
            env: { PATH: '/usr/bin' },
        });
        try {
            expect(auth.minted.permissions).toEqual({ issues: 'write', metadata: 'read' });
            expect(requests.map((entry) => entry.url)).toEqual([
                'https://api.github.com/app/installations/154969409/access_tokens',
                'https://api.github.com/app',
                `https://api.github.com/users/${encodeURIComponent(RENAMED_AUTHOR_LOGIN)}`,
            ]);
            expect(requests.some((entry) => entry.url.includes('/issues/'))).toBe(false);
        } finally {
            auth.session.dispose();
        }
    });

    it('refuses extra write grants on a tracker maintenance token', async () => {
        const { requests, request } = mintClient({
            login: RENAMED_AUTHOR_LOGIN,
            permissions: { issues: 'write', contents: 'write' },
        });
        await expect(
            mintInstallationToken({
                appId: '4650613',
                installationId: '1',
                privateKey: pem,
                permissions: TRACKER_AUTHOR_MINT_PERMISSIONS,
                expectedActorNodeId: AUTHOR_BOT_NODE_ID,
                request,
            })
        ).rejects.toThrow(/contents: write/);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it('refuses the current author login when it resolves to the wrong actor ID', async () => {
        const { request } = mintClient({
            login: RENAMED_AUTHOR_LOGIN,
            actorNodeId: REVIEWER_BOT_NODE_ID,
            permissions: { contents: 'write', pull_requests: 'write' },
        });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: AUTHOR_MINT_PERMISSIONS,
                expectedActorNodeId: AUTHOR_BOT_NODE_ID,
                request,
            })
        ).rejects.toThrow(/minted bot actor .* is not expected actor/);
    });
});

describe('isolated gh sessions', () => {
    it('strips inherited GitHub env and keeps only the minted token', async () => {
        const parent: NodeJS.ProcessEnv = {
            PATH: '/usr/bin',
            GH_TOKEN: 'parent-token',
            GITHUB_TOKEN: 'actions-token',
            GH_ENTERPRISE_TOKEN: 'ent',
            GITHUB_ENTERPRISE_TOKEN: 'ent2',
            GH_CONFIG_DIR: '/tmp/shared-gh',
            SOURDAW_GITHUB_APP_ID: '4650634',
            SSH_AUTH_SOCK: '/tmp/ssh',
            GIT_ASKPASS: 'ask',
            GIT_SSH_COMMAND: 'ssh',
            GIT_CONFIG_GLOBAL: '/tmp/global',
            GIT_CONFIG_SYSTEM: '/tmp/system',
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'url.https://evil.example/.insteadof',
            GIT_CONFIG_VALUE_0: 'https://github.com/',
            GIT_CONFIG_PARAMETERS: "'credential.helper=osxkeychain'",
            GIT_TRACE: '1',
            GIT_TRACE2: '1',
            GIT_CURL_VERBOSE: '1',
        };
        const { requests, request } = mintClient({
            login: RENAMED_AUTHOR_LOGIN,
            permissions: { contents: 'write', pull_requests: 'write' },
            token: 'ghs_author',
        });
        const auth = await authenticateRole({
            primaryRoot: '/repo',
            role: 'author',
            readFile: files(),
            request,
            env: parent,
        });
        expect(parent.GH_TOKEN).toBeUndefined();
        expect(parent.SOURDAW_GITHUB_APP_ID).toBeUndefined();
        expect(auth.session.env.GH_TOKEN).toBe('ghs_author');
        expect(auth.session.env.GH_CONFIG_DIR).toBe(auth.session.configDir);
        expect(auth.session.env.GH_CONFIG_DIR).not.toBe('/tmp/shared-gh');
        expect(auth.session.env.GITHUB_TOKEN).toBeUndefined();
        expect(auth.session.env.GH_ENTERPRISE_TOKEN).toBeUndefined();
        expect(auth.session.env.SOURDAW_GITHUB_APP_ID).toBeUndefined();
        expect(auth.session.env.SSH_AUTH_SOCK).toBeUndefined();
        expect(auth.session.env.GIT_ASKPASS).toBeUndefined();
        expect(auth.session.env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
        expect(auth.session.env.GIT_CONFIG_SYSTEM).toBe('/dev/null');
        expect(auth.session.env.GIT_TERMINAL_PROMPT).toBe('0');
        expect(auth.session.env.GIT_CONFIG_COUNT).toBeUndefined();
        expect(auth.session.env.GIT_CONFIG_KEY_0).toBeUndefined();
        expect(auth.session.env.GIT_CONFIG_VALUE_0).toBeUndefined();
        expect(auth.session.env.GIT_CONFIG_PARAMETERS).toBeUndefined();
        expect(auth.session.env.GIT_TRACE).toBeUndefined();
        expect(auth.session.env.GIT_TRACE2).toBeUndefined();
        expect(auth.session.env.GIT_CURL_VERBOSE).toBeUndefined();
        expect(auth.session.env.GIT_SSH_COMMAND).toBe('/usr/bin/false');
        expect(auth.session.env.GIT_SSH).toBe('/usr/bin/false');
        expect(auth.minted.login).toBe(RENAMED_AUTHOR_LOGIN);
        expect(auth.minted.actorNodeId).toBe(AUTHOR_BOT_NODE_ID);
        expect(JSON.stringify(auth.session.env)).not.toContain(pem.slice(0, 40));
        expect(requests[0]?.url).toContain('/app/installations/154969409/access_tokens');
        auth.session.dispose();
    });

    it('does not read the reviewer file when authenticating the author', async () => {
        const reads: string[] = [];
        const { request } = mintClient({
            login: RENAMED_AUTHOR_LOGIN,
            permissions: { contents: 'write', pull_requests: 'write' },
        });
        const auth = await authenticateRole({
            primaryRoot: '/repo',
            role: 'author',
            readFile: (path) => {
                reads.push(path);
                return files()(path);
            },
            request,
            env: {},
        });
        expect(reads.some((path) => path.includes('reviewer'))).toBe(false);
        auth.session.dispose();
    });

    it('gives overlapping sessions distinct GH_CONFIG_DIR paths', () => {
        const first = createGhSession('token-a');
        const second = createGhSession('token-b');
        expect(first.configDir).not.toBe(second.configDir);
        expect(githubChildEnv('token-a', first.configDir).GH_CONFIG_DIR).toBe(first.configDir);
        first.dispose();
        second.dispose();
    });

    it('authenticates git over HTTPS with a host-scoped helper file', () => {
        const helperDir = mkdtempSync(join(tmpdir(), 'sourdaw-git-helper-'));
        try {
            const args = gitAuthenticatedArgs('ghs_minted', helperDir, [
                'push',
                GITHUB_HTTPS_REMOTE,
                'HEAD:refs/heads/agent/12/work',
            ]);
            const helperPath = gitCredentialHelperPath(helperDir);
            expect(args).toEqual([
                '-c',
                'credential.helper=',
                '-c',
                `credential.helper=${helperPath}`,
                'push',
                GITHUB_HTTPS_REMOTE,
                'HEAD:refs/heads/agent/12/work',
            ]);
            expect(args.join('\0')).not.toContain('ghs_minted');
            expect(args.some((arg) => arg.includes('!f()'))).toBe(false);
            expect(args).not.toContain('--force');
            expect(args).not.toContain('--force-with-lease');
            expect(statSync(helperPath).mode & 0o777).toBe(0o700);
            expect(runCredentialHelper(helperPath, 'get', 'protocol=https\nhost=github.com\n\n')).toBe(
                'username=x-access-token\npassword=ghs_minted\n'
            );
            expect(runCredentialHelper(helperPath, 'get', 'protocol=https\nhost=gist.github.com\n\n')).toBe('');
            expect(runCredentialHelper(helperPath, 'get', 'protocol=https\nhost=github.com.evil.example\n\n')).toBe('');
            expect(runCredentialHelper(helperPath, 'get', 'protocol=http\nhost=github.com\n\n')).toBe('');
            expect(runCredentialHelper(helperPath, 'store', 'protocol=https\nhost=github.com\n\n')).toBe('');
            expect(runCredentialHelper(helperPath, 'erase', 'protocol=https\nhost=github.com\n\n')).toBe('');
        } finally {
            rmSync(helperDir, { recursive: true, force: true });
        }
    });

    it('rejects installation tokens outside the ghs_ charset before writing a helper', () => {
        const helperDir = mkdtempSync(join(tmpdir(), 'sourdaw-git-helper-'));
        try {
            expect(() => gitAuthenticatedArgs('ghs_minted;rm', helperDir, ['status'])).toThrow(/ghs_/);
            expect(() => gitAuthenticatedArgs('gho_minted', helperDir, ['status'])).toThrow(/ghs_/);
            expect(() => gitAuthenticatedArgs('ghs_', helperDir, ['status'])).toThrow(/ghs_/);
            expect(readdirSync(helperDir)).toEqual([]);
            expect(() => gitAuthenticatedArgs('ghs_1_header.payload.signature', helperDir, ['status'])).not.toThrow();
        } finally {
            rmSync(helperDir, { recursive: true, force: true });
        }
    });
});

describe('repository and trusted blob', () => {
    it('refuses a foreign repository slug', () => {
        expect(() => assertRequiredRepository('other/repo')).toThrow(/jcosta33\/sourdaw/);
    });

    it('allows a new script missing from origin/main and refuses a mutated existing blob', () => {
        assertTrustedExecutingBlob('scripts/openLane.ts', '/tmp/openLane.ts', undefined, 'new');
        expect(() =>
            assertTrustedExecutingBlob('scripts/deliverPullRequest.ts', '/tmp/deliver.ts', 'origin', 'mutated')
        ).toThrow(/does not match origin\/main/);
        assertTrustedExecutingBlob('scripts/deliverPullRequest.ts', '/tmp/deliver.ts', 'same', 'same');
    });

    it('resolves the primary root from git-common-dir, not cwd', () => {
        const root = resolvePrimaryRoot(
            () => '/repo/.git',
            '/repo/.agents/worktrees/lane',
            (path) => path
        );
        expect(root).toBe('/repo');
    });

    it('recognizes only the immutable reviewer bot actor ID', () => {
        expect(isReviewerBotNodeId(REVIEWER_BOT_NODE_ID)).toBe(true);
        expect(isReviewerBotNodeId(AUTHOR_BOT_NODE_ID)).toBe(false);
        expect(isReviewerBotNodeId('BOT_renamed-login-does-not-matter')).toBe(false);
        expect(isReviewerBotNodeId(undefined)).toBe(false);
    });

    it('recognizes only the immutable author bot actor ID', () => {
        expect(isAuthorBotNodeId(AUTHOR_BOT_NODE_ID)).toBe(true);
        expect(isAuthorBotNodeId(REVIEWER_BOT_NODE_ID)).toBe(false);
        expect(isAuthorBotNodeId('BOT_renamed-login-does-not-matter')).toBe(false);
        expect(isAuthorBotNodeId(undefined)).toBe(false);
    });
});

describe('spawnCapture output capacity', () => {
    it('captures stdout larger than spawnSync 1 MiB default intact', () => {
        const payload = `--capture-start--\n${'x'.repeat(4 * 1024 * 1024)}\n--capture-end--`;
        const captured = spawnCapture(process.execPath, [
            '-e',
            `process.stdout.write("--capture-start--\\n" + "x".repeat(4 * 1024 * 1024) + "\\n--capture-end--")`,
        ]);
        expect(captured).toBe(payload);
    });
});
