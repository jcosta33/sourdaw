import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    AUTHOR_BOT_LOGIN,
    AUTHOR_MINT_PERMISSIONS,
    GITHUB_HTTPS_REMOTE,
    REVIEWER_BOT_LOGIN,
    REVIEWER_MINT_PERMISSIONS,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    createGhSession,
    gitAuthenticatedArgs,
    gitCredentialHelperPath,
    githubChildEnv,
    loadRoleCredentials,
    mintInstallationToken,
    parseDotenv,
    resolvePrimaryRoot,
    type FileReader,
    type GitHubJsonClient,
} from '../githubAppIdentity.ts';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

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

function mintClient(input: { login: string; permissions: Record<string, string>; token?: string }): {
    requests: Array<{ url: string; body?: string }>;
    request: GitHubJsonClient;
} {
    const requests: Array<{ url: string; body?: string }> = [];
    return {
        requests,
        request: async (url, init) => {
            requests.push({ url, body: init.body });
            if (url.includes('/access_tokens')) {
                return {
                    status: 201,
                    body: { token: input.token ?? 'ghs_minted', permissions: input.permissions },
                };
            }
            return { status: 200, body: { slug: input.login.replace('[bot]', '') } };
        },
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

describe('installation mint', () => {
    it('mints reviewer permissions without contents write and checks login', async () => {
        const { requests, request } = mintClient({
            login: REVIEWER_BOT_LOGIN,
            permissions: { contents: 'read', pull_requests: 'write' },
        });
        const minted = await mintInstallationToken({
            appId: '4650634',
            installationId: '1',
            privateKey: pem,
            permissions: REVIEWER_MINT_PERMISSIONS,
            expectedLogin: REVIEWER_BOT_LOGIN,
            request,
        });
        expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ permissions: REVIEWER_MINT_PERMISSIONS });
        expect(minted.login).toBe(REVIEWER_BOT_LOGIN);
        expect(minted.token).toBe('ghs_minted');
    });

    it('refuses a reviewer token with contents write before further GitHub writes', async () => {
        const { requests, request } = mintClient({
            login: REVIEWER_BOT_LOGIN,
            permissions: { contents: 'write', pull_requests: 'write' },
        });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: REVIEWER_MINT_PERMISSIONS,
                expectedLogin: REVIEWER_BOT_LOGIN,
                request,
            })
        ).rejects.toThrow(/contents: write/);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it('refuses a reviewer token missing contents before further GitHub writes', async () => {
        const { requests, request } = mintClient({
            login: REVIEWER_BOT_LOGIN,
            permissions: { pull_requests: 'write' },
        });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: REVIEWER_MINT_PERMISSIONS,
                expectedLogin: REVIEWER_BOT_LOGIN,
                request,
            })
        ).rejects.toThrow(/contents is <missing>/);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it('refuses extra write grants on a minted token before further GitHub writes', async () => {
        const { requests, request } = mintClient({
            login: REVIEWER_BOT_LOGIN,
            permissions: { contents: 'read', pull_requests: 'write', administration: 'write' },
        });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: REVIEWER_MINT_PERMISSIONS,
                expectedLogin: REVIEWER_BOT_LOGIN,
                request,
            })
        ).rejects.toThrow(/administration: write/);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it('refuses an author token whose contents level does not match the request', async () => {
        const { requests, request } = mintClient({
            login: AUTHOR_BOT_LOGIN,
            permissions: { contents: 'read', pull_requests: 'write' },
        });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: AUTHOR_MINT_PERMISSIONS,
                expectedLogin: AUTHOR_BOT_LOGIN,
                request,
            })
        ).rejects.toThrow(/contents is read/);
        expect(requests.filter((entry) => entry.url.endsWith('/app'))).toHaveLength(0);
    });

    it('allows extra read-only grants on a minted token', async () => {
        const { request } = mintClient({
            login: REVIEWER_BOT_LOGIN,
            permissions: { contents: 'read', pull_requests: 'write', metadata: 'read' },
        });
        const minted = await mintInstallationToken({
            appId: '1',
            installationId: '1',
            privateKey: pem,
            permissions: REVIEWER_MINT_PERMISSIONS,
            expectedLogin: REVIEWER_BOT_LOGIN,
            request,
        });
        expect(minted.token).toBe('ghs_minted');
    });

    it('requests only author contents write and pull_requests write', async () => {
        const { requests, request } = mintClient({
            login: AUTHOR_BOT_LOGIN,
            permissions: { contents: 'write', pull_requests: 'write' },
        });
        await mintInstallationToken({
            appId: '4650613',
            installationId: '1',
            privateKey: pem,
            permissions: AUTHOR_MINT_PERMISSIONS,
            expectedLogin: AUTHOR_BOT_LOGIN,
            request,
        });
        expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ permissions: AUTHOR_MINT_PERMISSIONS });
        expect(requests[0]?.body).not.toContain('administration');
        expect(requests[0]?.body).not.toContain('workflows');
    });

    it('refuses a minted login that is not the expected bot', async () => {
        const { request } = mintClient({
            login: 'jcosta33',
            permissions: { contents: 'write', pull_requests: 'write' },
        });
        await expect(
            mintInstallationToken({
                appId: '1',
                installationId: '1',
                privateKey: pem,
                permissions: AUTHOR_MINT_PERMISSIONS,
                expectedLogin: AUTHOR_BOT_LOGIN,
                request,
            })
        ).rejects.toThrow(/not jcosta33-author\[bot\]/);
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
            login: AUTHOR_BOT_LOGIN,
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
        expect(auth.session.env.GIT_SSH_COMMAND).toBeUndefined();
        expect(auth.minted.login).toBe(AUTHOR_BOT_LOGIN);
        expect(JSON.stringify(auth.session.env)).not.toContain(pem.slice(0, 40));
        expect(requests[0]?.url).toContain('/app/installations/154969409/access_tokens');
        auth.session.dispose();
    });

    it('does not read the reviewer file when authenticating the author', async () => {
        const reads: string[] = [];
        const { request } = mintClient({
            login: AUTHOR_BOT_LOGIN,
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
});
