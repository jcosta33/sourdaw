import { spawnSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { fail } from './prContract.ts';

export const AUTHOR_BOT_LOGIN = 'jcosta33-author[bot]';
export const AUTHOR_GRAPHQL_LOGIN = 'jcosta33-author';
export const REVIEWER_BOT_LOGIN = 'jcosta33-reviewer[bot]';
export const REVIEWER_GRAPHQL_LOGIN = 'jcosta33-reviewer';

export function isReviewerBotLogin(login: string | undefined | null): boolean {
    return login === REVIEWER_BOT_LOGIN || login === REVIEWER_GRAPHQL_LOGIN;
}
export function isAuthorBotLogin(login: string | undefined | null): boolean {
    return login === AUTHOR_BOT_LOGIN || login === AUTHOR_GRAPHQL_LOGIN;
}
export const REQUIRED_REPOSITORY = 'jcosta33/sourdaw';
export const GITHUB_HTTPS_REMOTE = `https://github.com/${REQUIRED_REPOSITORY}.git`;
export function githubAuthenticatedRemote(token: string): string {
    return `https://x-access-token:${token}@github.com/${REQUIRED_REPOSITORY}.git`;
}
export const AUTHOR_LOCK_REASON = 'active:sourdaw-author';

/**
 * `removeLane` locks a lane `lane-remove:<pid>` for the length of a removal, so that reason records
 * work in flight rather than an owner. It and `AUTHOR_LOCK_REASON` are the only lock reasons lane
 * tooling writes, and both readers of the marker share this one definition: `removeLane` asks
 * whether the pid is still alive, `publishLane` only needs to know the lock names nobody. A pid that
 * is not a safe positive integer is not this marker, so it is treated as an unrecognized reason
 * rather than handed on as a number no caller can act on.
 */
export function removalLockPid(lockReason: string | undefined): number | undefined {
    const captured = /^lane-remove:(\d+)$/.exec(lockReason ?? '')?.[1];
    if (captured === undefined) {
        return undefined;
    }
    const pid = Number(captured);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

export const AUTHOR_MINT_PERMISSIONS = {
    contents: 'write',
    pull_requests: 'write',
} as const;

export const REVIEWER_MINT_PERMISSIONS = {
    contents: 'read',
    pull_requests: 'write',
} as const;

export type Role = 'author' | 'reviewer';

export type RoleCredentials = {
    appId: string;
    installationId: string;
    privateKey: string;
    sourcePath: string;
};

export type MintPermissions = {
    contents: 'read' | 'write';
    pull_requests: 'write';
};

export type MintedInstallation = {
    token: string;
    login: string;
    permissions: Record<string, string>;
};

export type GitHubJsonClient = (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{ status: number; body: unknown }>;

export type FileReader = (path: string) => string;

export type GhSession = {
    configDir: string;
    env: NodeJS.ProcessEnv;
    dispose: () => void;
};

export function roleEnvFileName(role: Role): string {
    return role === 'author' ? '.env.sourdaw-author' : '.env.sourdaw-reviewer';
}

export function credentialFilePath(primaryRoot: string, role: Role): string {
    return join(primaryRoot, roleEnvFileName(role));
}

export function parseDotenv(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const rawLine of text.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (trimmed === '' || trimmed.startsWith('#')) {
            continue;
        }
        const line = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
        const separator = line.indexOf('=');
        if (separator <= 0) {
            continue;
        }
        const key = line.slice(0, separator).trim();
        const rawValue = line.slice(separator + 1);
        result[key] = unquoteDotenvValue(rawValue);
    }
    return result;
}

export function clearInheritedGithubEnv(env: NodeJS.ProcessEnv = process.env): void {
    for (const key of Object.keys(env)) {
        if (key.startsWith('SOURDAW_GITHUB_APP_') || key.startsWith('GH_') || key.startsWith('GITHUB_')) {
            delete env[key];
        }
    }
}

export function loadRoleCredentials(
    primaryRoot: string,
    role: Role,
    readFile: FileReader = (path) => readFileSync(path, 'utf8')
): RoleCredentials {
    const sourcePath = credentialFilePath(primaryRoot, role);
    let text: string;
    try {
        text = readFile(sourcePath);
    } catch {
        fail(`missing ${role} credentials file: ${sourcePath}`);
    }
    const parsed = parseDotenv(text);
    const appId = parsed.SOURDAW_GITHUB_APP_ID?.trim();
    const installationId = parsed.SOURDAW_GITHUB_APP_INSTALLATION_ID?.trim();
    if (appId === undefined || appId === '' || installationId === undefined || installationId === '') {
        fail(`${role} credentials file is missing SOURDAW_GITHUB_APP_ID or SOURDAW_GITHUB_APP_INSTALLATION_ID`);
    }
    const keyFile = parsed.SOURDAW_GITHUB_APP_PRIVATE_KEY_FILE?.trim();
    let privateKey = parsed.SOURDAW_GITHUB_APP_PRIVATE_KEY;
    if (keyFile !== undefined && keyFile !== '') {
        const keyPath = resolve(primaryRoot, keyFile);
        try {
            privateKey = readFile(keyPath);
        } catch {
            fail(`${role} private key file is unreadable: ${keyPath}`);
        }
    }
    if (privateKey === undefined || privateKey.trim() === '') {
        fail(`${role} credentials file is missing a private key`);
    }
    return { appId, installationId, privateKey: normalizePem(privateKey), sourcePath };
}

export function createAppJwt(
    appId: string,
    privateKey: string,
    nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
    const issuer = Number(appId);
    if (!Number.isSafeInteger(issuer) || issuer <= 0) {
        fail('SOURDAW_GITHUB_APP_ID must be a positive integer');
    }
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64Url(
        JSON.stringify({
            iat: nowSeconds - 60,
            exp: nowSeconds + 540,
            iss: issuer,
        })
    );
    const data = `${header}.${payload}`;
    const signer = createSign('RSA-SHA256');
    signer.update(data);
    return `${data}.${signer.sign(privateKey, 'base64url')}`;
}

export async function mintInstallationToken(input: {
    appId: string;
    installationId: string;
    privateKey: string;
    permissions: MintPermissions;
    expectedLogin: string;
    request?: GitHubJsonClient;
}): Promise<MintedInstallation> {
    const request = input.request ?? defaultGitHubRequest;
    const jwt = createAppJwt(input.appId, input.privateKey);
    const minted = await request(
        `https://api.github.com/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${jwt}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ permissions: input.permissions }),
        }
    );
    if (minted.status !== 201 || minted.body === null || typeof minted.body !== 'object') {
        fail('failed to mint GitHub App installation token');
    }
    const payload = minted.body as { token?: unknown; permissions?: unknown };
    if (typeof payload.token !== 'string' || payload.token === '') {
        fail('installation token response is missing token');
    }
    const permissions = stringRecord(payload.permissions);
    assertMintedPermissions(input.permissions, permissions);
    const app = await request('https://api.github.com/app', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (app.status !== 200) {
        fail('failed to verify GitHub App identity');
    }
    const slug =
        app.body !== null && typeof app.body === 'object' && 'slug' in app.body && typeof app.body.slug === 'string'
            ? app.body.slug
            : undefined;
    const login = slug === undefined ? undefined : `${slug}[bot]`;
    if (login !== input.expectedLogin) {
        fail(`minted login ${login ?? '<missing>'} is not ${input.expectedLogin}`);
    }
    return { token: payload.token, login, permissions };
}

export async function authenticateRole(input: {
    primaryRoot: string;
    role: Role;
    readFile?: FileReader;
    request?: GitHubJsonClient;
    env?: NodeJS.ProcessEnv;
}): Promise<{ credentials: RoleCredentials; minted: MintedInstallation; session: GhSession }> {
    const env = input.env ?? process.env;
    clearInheritedGithubEnv(env);
    const credentials = loadRoleCredentials(input.primaryRoot, input.role, input.readFile);
    const minted = await mintInstallationToken({
        appId: credentials.appId,
        installationId: credentials.installationId,
        privateKey: credentials.privateKey,
        permissions: input.role === 'author' ? AUTHOR_MINT_PERMISSIONS : REVIEWER_MINT_PERMISSIONS,
        expectedLogin: input.role === 'author' ? AUTHOR_BOT_LOGIN : REVIEWER_BOT_LOGIN,
        request: input.request,
    });
    return { credentials, minted, session: createGhSession(minted.token, env) };
}

export function createGhSession(token: string, parent: NodeJS.ProcessEnv = process.env): GhSession {
    const configDir = mkdtempSync(join(tmpdir(), 'sourdaw-gh-'));
    return {
        configDir,
        env: githubChildEnv(token, configDir, parent),
        dispose: () => {
            rmSync(configDir, { recursive: true, force: true });
        },
    };
}

export function githubChildEnv(
    token: string,
    configDir: string,
    parent: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...parent };
    for (const key of Object.keys(env)) {
        if (
            key.startsWith('SOURDAW_GITHUB_APP_') ||
            key.startsWith('GH_') ||
            key.startsWith('GITHUB_') ||
            key.startsWith('GIT_') ||
            key === 'SSH_AUTH_SOCK'
        ) {
            delete env[key];
        }
    }
    env.GH_TOKEN = token;
    env.GH_CONFIG_DIR = configDir;
    env.GIT_CONFIG_GLOBAL = '/dev/null';
    env.GIT_CONFIG_SYSTEM = '/dev/null';
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_SSH_COMMAND = '/usr/bin/false';
    env.GIT_SSH = '/usr/bin/false';
    env.GCM_INTERACTIVE = 'never';
    return env;
}

export function gitCredentialHelperPath(helperDir: string): string {
    return resolve(helperDir, 'git-credential-github');
}

export function gitAuthenticatedArgs(token: string, helperDir: string, args: string[]): string[] {
    const helperPath = installGitCredentialHelper(helperDir, token);
    return ['-c', 'credential.helper=', '-c', `credential.helper=${helperPath}`, ...args];
}

export function spawnCapture(
    command: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; trim?: boolean } = {}
): string {
    const result = spawnSync(command, args, {
        cwd: options.cwd ?? process.cwd(),
        env: options.env,
        encoding: 'utf8',
        shell: false,
        input: options.input,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `${command} failed with exit ${result.status ?? 'signal'}`);
    }
    return options.trim === false ? result.stdout : result.stdout.trim();
}

export function spawnRun(
    command: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): void {
    const result = spawnSync(command, args, {
        cwd: options.cwd ?? process.cwd(),
        env: options.env,
        stdio: 'inherit',
        shell: false,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} failed with exit ${result.status ?? 'signal'}`);
    }
}

export function resolvePrimaryRoot(
    capture: (command: string, args: string[], cwd?: string) => string = (command, args, cwd) =>
        spawnCapture(command, args, { cwd }),
    cwd: string = process.cwd(),
    resolveExisting: (path: string) => string = realpathSync
): string {
    const common = capture('git', ['rev-parse', '--git-common-dir'], cwd).trim();
    const absolute = isAbsolute(common) ? common : resolve(cwd, common);
    return dirname(resolveExisting(absolute));
}

export function originMainBlob(repoRelativePath: string, cwd: string = process.cwd()): string | undefined {
    try {
        spawnCapture('git', ['cat-file', '-e', `origin/main:${repoRelativePath}`], { cwd });
    } catch {
        return undefined;
    }
    return spawnCapture('git', ['show', `origin/main:${repoRelativePath}`], { cwd, trim: false });
}

export function assertTrustedExecutingBlob(
    repoRelativePath: string,
    executingFile: string,
    originBlob: string | undefined,
    executingSource: string = readFileSync(executingFile, 'utf8')
): void {
    if (originBlob === undefined) {
        return;
    }
    if (originBlob !== executingSource) {
        fail(`${repoRelativePath} does not match origin/main; refusing to run a mutated copy`);
    }
}

export function assertRequiredRepository(nameWithOwner: string): void {
    if (nameWithOwner !== REQUIRED_REPOSITORY) {
        fail(`refusing to operate on ${nameWithOwner}; expected ${REQUIRED_REPOSITORY}`);
    }
}

export function parseJson<Value>(value: string, label: string): Value {
    try {
        return JSON.parse(value) as Value;
    } catch (error) {
        throw new Error(`${label} returned invalid JSON`, { cause: error });
    }
}

export function parseGraphqlResponse<Value>(value: string, label: string): Value {
    const response = parseJson<unknown>(value, label);
    if (typeof response !== 'object' || response === null || Array.isArray(response)) {
        fail(`${label} returned an invalid GraphQL envelope`);
    }
    const envelope = response as { data?: unknown; errors?: unknown };
    if (!Object.hasOwn(envelope, 'data') || Object.hasOwn(envelope, 'errors')) {
        fail(`${label} returned an invalid GraphQL envelope`);
    }
    return response as Value;
}

async function defaultGitHubRequest(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string }
): Promise<{ status: number; body: unknown }> {
    const response = await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
    });
    const text = await response.text();
    if (text.trim() === '') {
        return { status: response.status, body: null };
    }
    try {
        return { status: response.status, body: JSON.parse(text) as unknown };
    } catch (error) {
        throw new Error('GitHub returned invalid JSON', { cause: error });
    }
}

function unquoteDotenvValue(rawValue: string): string {
    if (rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"')) {
        return rawValue
            .slice(1, -1)
            .replaceAll('\\n', '\n')
            .replaceAll('\\t', '\t')
            .replaceAll('\\"', '"')
            .replaceAll('\\\\', '\\');
    }
    if (rawValue.length >= 2 && rawValue.startsWith("'") && rawValue.endsWith("'")) {
        return rawValue.slice(1, -1);
    }
    return rawValue;
}

function normalizePem(value: string): string {
    return value.replaceAll('\\n', '\n').trim();
}

function assertMintedPermissions(requested: MintPermissions, granted: Record<string, string>): void {
    if (requested.contents === 'read' && granted.contents === 'write') {
        fail('reviewer installation token granted contents: write');
    }
    if (granted.contents !== requested.contents) {
        fail(`installation token contents is ${granted.contents ?? '<missing>'}; expected ${requested.contents}`);
    }
    if (granted.pull_requests !== requested.pull_requests) {
        fail(
            `installation token pull_requests is ${granted.pull_requests ?? '<missing>'}; expected ${requested.pull_requests}`
        );
    }
    const requestedNames = new Set(Object.keys(requested));
    for (const [key, level] of Object.entries(granted)) {
        if (!requestedNames.has(key) && level !== 'read' && level !== 'none') {
            fail(`installation token granted ${key}: ${level}`);
        }
    }
}

function assertInstallationToken(token: string): void {
    if (!/^ghs_[A-Za-z0-9._-]+$/.test(token)) {
        fail('GitHub App installation token must be ghs_ followed by alphanumeric, dot, hyphen, or underscore');
    }
}

function gitCredentialHelperSource(token: string): string {
    return [
        '#!/bin/sh',
        'set -eu',
        'if [ "${1-}" != get ]; then',
        '    exit 0',
        'fi',
        'protocol=',
        'host=',
        'while IFS= read -r line || [ -n "$line" ]; do',
        '    case "$line" in',
        '        protocol=*) protocol=${line#protocol=} ;;',
        '        host=*) host=${line#host=} ;;',
        "        '') break ;;",
        '    esac',
        'done',
        'if [ "$protocol" = https ] && [ "$host" = github.com ]; then',
        `    printf 'username=x-access-token\\npassword=%s\\n' '${token}'`,
        'fi',
        '',
    ].join('\n');
}

function installGitCredentialHelper(helperDir: string, token: string): string {
    assertInstallationToken(token);
    const helperPath = gitCredentialHelperPath(helperDir);
    writeFileSync(helperPath, gitCredentialHelperSource(token), { encoding: 'utf8', mode: 0o700 });
    chmodSync(helperPath, 0o700);
    return helperPath;
}

function stringRecord(value: unknown): Record<string, string> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const result: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'string') {
            result[key] = entry;
        }
    }
    return result;
}

function base64Url(value: string): string {
    return Buffer.from(value).toString('base64url');
}
