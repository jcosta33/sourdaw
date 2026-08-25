import { spawnSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { fail } from './prContract.ts';

export const AUTHOR_BOT_NODE_ID = 'BOT_kgDOEv71mA';
export const REVIEWER_BOT_NODE_ID = 'BOT_kgDOEv74EA';

export function isReviewerBotNodeId(nodeId: string | undefined | null): boolean {
    return nodeId === REVIEWER_BOT_NODE_ID;
}
export function isAuthorBotNodeId(nodeId: string | undefined | null): boolean {
    return nodeId === AUTHOR_BOT_NODE_ID;
}
export const REQUIRED_REPOSITORY = 'jcosta33/sourdaw';
/**
 * The one branch a pull request may target. `lane:publish` opens every pull request against it and
 * `deliver` merges into nothing else, so a base that is not this branch is a retarget the delivery
 * scripts did not make.
 */
export const REQUIRED_BASE_BRANCH = 'main';
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

export const AUTHOR_WORKFLOW_MINT_PERMISSIONS = {
    ...AUTHOR_MINT_PERMISSIONS,
    workflows: 'write',
} as const;

export const TRACKER_AUTHOR_MINT_PERMISSIONS = {
    issues: 'write',
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
    contents?: 'read' | 'write';
    pull_requests?: 'write';
    issues?: 'write';
    workflows?: 'write';
};

export type MintedInstallation = {
    token: string;
    login: string;
    actorNodeId: string;
    permissions: Record<string, string>;
};

export type GitHubJsonClient = (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{ status: number; body: unknown }>;

export type FileReader = (path: string) => string;

export type CommandCapture = (command: string, args: string[], cwd?: string) => string;

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
    expectedActorNodeId: string;
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
    assertInstallationToken(payload.token);
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
    if (slug === undefined || slug === '') {
        fail('GitHub App identity is missing its slug');
    }
    const botLogin = `${slug}[bot]`;
    const actor = await request(`https://api.github.com/users/${encodeURIComponent(botLogin)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${payload.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    const actorPayload =
        actor.body !== null && typeof actor.body === 'object'
            ? (actor.body as { node_id?: unknown; login?: unknown; type?: unknown })
            : undefined;
    if (
        actor.status !== 200 ||
        typeof actorPayload?.node_id !== 'string' ||
        typeof actorPayload.login !== 'string' ||
        actorPayload.type !== 'Bot'
    ) {
        fail(`failed to resolve GitHub App bot actor for ${botLogin}`);
    }
    if (actorPayload.node_id !== input.expectedActorNodeId) {
        fail(
            `minted bot actor ${actorPayload.node_id} (${actorPayload.login}) is not expected actor ${input.expectedActorNodeId}`
        );
    }
    return { token: payload.token, login: actorPayload.login, actorNodeId: actorPayload.node_id, permissions };
}

export async function authenticateRole(input: {
    primaryRoot: string;
    role: Role;
    readFile?: FileReader;
    request?: GitHubJsonClient;
    env?: NodeJS.ProcessEnv;
}): Promise<{ credentials: RoleCredentials; minted: MintedInstallation; session: GhSession }> {
    return authenticateWithPermissions(
        input,
        input.role === 'author' ? AUTHOR_MINT_PERMISSIONS : REVIEWER_MINT_PERMISSIONS
    );
}

const AUTHOR_WORKFLOW_PATH_PREFIX = '.github/workflows/';
function committedDiffPathArgs(baseSha: string, headSha: string): string[] {
    return [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--name-only',
        '--no-renames',
        '-z',
        `${baseSha}...${headSha}`,
        '--',
    ];
}

/**
 * Authorization reads use only the repository named by `cwd`. Inherited Git routing can redirect
 * even a local `git diff` through `GIT_DIR` or `GIT_WORK_TREE`, so none of it crosses this boundary.
 * The replacement values disable ambient config, credentials, prompts, and SSH for the read.
 */
export function githubAuthorizationGitEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...parent };
    for (const key of Object.keys(env)) {
        if (
            key.startsWith('GIT_') ||
            key.startsWith('GH_') ||
            key.startsWith('GITHUB_') ||
            key.startsWith('SOURDAW_GITHUB_APP_') ||
            key.startsWith('NODE_') ||
            key === 'SSH_AUTH_SOCK'
        ) {
            delete env[key];
        }
    }
    env.GIT_CONFIG_GLOBAL = '/dev/null';
    env.GIT_CONFIG_SYSTEM = '/dev/null';
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_SSH_COMMAND = '/usr/bin/false';
    env.GIT_SSH = '/usr/bin/false';
    env.GCM_INTERACTIVE = 'never';
    return env;
}

/**
 * Git's `-z` form is the authority here: it preserves every byte that may occur in a path instead
 * of quoting newlines or other unusual characters. The component check is defense in depth against
 * lookalikes and traversal-shaped input before the exact workflow-directory prefix is considered.
 */
export function authorWorkflowWriteRequired(
    lane: string,
    baseSha: string,
    headSha: string,
    capture?: CommandCapture,
    parentEnv: NodeJS.ProcessEnv = process.env
): boolean {
    const read =
        capture ??
        ((command: string, args: string[], cwd?: string) =>
            spawnCapture(command, args, { cwd, env: githubAuthorizationGitEnv(parentEnv), trim: false }));
    const output = read('git', committedDiffPathArgs(baseSha, headSha), lane);
    if (output === '') {
        return false;
    }
    if (!output.endsWith('\0')) {
        fail('git committed-path diff was not NUL-terminated');
    }
    return output
        .slice(0, -1)
        .split('\0')
        .some((path) => {
            const components = path.split('/');
            const canonical = components.every(
                (component) => component !== '' && component !== '.' && component !== '..'
            );
            return canonical && path.startsWith(AUTHOR_WORKFLOW_PATH_PREFIX);
        });
}

export type PublishingPermissionClass = 'ordinary' | 'workflow';

export type PublishingAuthorAuthorization = {
    lanePath: string;
    branch: string;
    baseSha: string;
    headSha: string;
    permissionClass: PublishingPermissionClass;
};

export function resolvePublishingAuthorAuthorization(
    lane: { path: string; branch: string },
    baseSha: string,
    capture?: CommandCapture,
    parentEnv: NodeJS.ProcessEnv = process.env
): PublishingAuthorAuthorization {
    const read =
        capture ??
        ((command: string, args: string[], cwd?: string) =>
            spawnCapture(command, args, { cwd, env: githubAuthorizationGitEnv(parentEnv), trim: false }));
    const headSha = read('git', ['rev-parse', '--verify', 'HEAD^{commit}'], lane.path).trim();
    if (!/^[0-9a-f]{40,64}$/.test(headSha)) {
        fail('publishing lane HEAD did not resolve to a commit');
    }
    if (!/^[0-9a-f]{40,64}$/.test(baseSha)) {
        fail('publishing base did not resolve to a commit');
    }
    const permissionClass = authorWorkflowWriteRequired(lane.path, baseSha, headSha, read, parentEnv)
        ? 'workflow'
        : 'ordinary';
    return { lanePath: lane.path, branch: lane.branch, baseSha, headSha, permissionClass };
}

/**
 * Publishing is the only author operation allowed to acquire workflow authority. The caller can
 * identify the locked lane, but cannot supply permissions: this function derives the fixed scope
 * directly from that lane's committed Git diff before credentials are loaded or a token is minted.
 */
export async function authenticatePublishingAuthor(input: {
    primaryRoot: string;
    lane: { path: string; branch: string };
    baseSha: string;
    readFile?: FileReader;
    request?: GitHubJsonClient;
    env?: NodeJS.ProcessEnv;
    capture?: CommandCapture;
}): Promise<{
    credentials: RoleCredentials;
    minted: MintedInstallation;
    session: GhSession;
    authorization: PublishingAuthorAuthorization;
}> {
    const authorization = resolvePublishingAuthorAuthorization(input.lane, input.baseSha, input.capture, input.env);
    const authentication = await authenticateWithPermissions(
        { ...input, role: 'author' },
        authorization.permissionClass === 'workflow' ? AUTHOR_WORKFLOW_MINT_PERMISSIONS : AUTHOR_MINT_PERMISSIONS
    );
    return { ...authentication, authorization };
}

async function authenticateWithPermissions(
    input: {
        primaryRoot: string;
        role: Role;
        readFile?: FileReader;
        request?: GitHubJsonClient;
        env?: NodeJS.ProcessEnv;
    },
    permissions: MintPermissions
): Promise<{ credentials: RoleCredentials; minted: MintedInstallation; session: GhSession }> {
    const env = input.env ?? process.env;
    clearInheritedGithubEnv(env);
    const credentials = loadRoleCredentials(input.primaryRoot, input.role, input.readFile);
    const minted = await mintInstallationToken({
        appId: credentials.appId,
        installationId: credentials.installationId,
        privateKey: credentials.privateKey,
        permissions,
        expectedActorNodeId: input.role === 'author' ? AUTHOR_BOT_NODE_ID : REVIEWER_BOT_NODE_ID,
        request: input.request,
    });
    return { credentials, minted, session: createGhSession(minted.token, env) };
}

export async function authenticateTrackerAuthor(input: {
    primaryRoot: string;
    readFile?: FileReader;
    request?: GitHubJsonClient;
    env?: NodeJS.ProcessEnv;
}): Promise<{ credentials: RoleCredentials; minted: MintedInstallation; session: GhSession }> {
    const env = input.env ?? process.env;
    clearInheritedGithubEnv(env);
    const credentials = loadRoleCredentials(input.primaryRoot, 'author', input.readFile);
    const minted = await mintInstallationToken({
        appId: credentials.appId,
        installationId: credentials.installationId,
        privateKey: credentials.privateKey,
        permissions: TRACKER_AUTHOR_MINT_PERMISSIONS,
        expectedActorNodeId: AUTHOR_BOT_NODE_ID,
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
            key.startsWith('NODE_') ||
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
    const childCommand = trustedChildExecutable(command, options.env ?? process.env);
    const result = spawnSync(childCommand, args, {
        cwd: options.cwd ?? process.cwd(),
        env: options.env,
        encoding: 'utf8',
        // Sized at 64 MiB: spawnSync's 1 MiB default kills any larger capture with ENOBUFS.
        // The largest legitimate capture is `git show` of the biggest tracked blob (~5 MiB
        // sample wav today); `git diff` captures stay textual because git elides binaries.
        // 64 MiB covers that plus a whole-source-tree textual diff with headroom, and a
        // capture exceeding even this bound still fails loudly through result.error below.
        maxBuffer: 64 * 1024 * 1024,
        shell: false,
        input: options.input,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `${childCommand} failed with exit ${result.status ?? 'signal'}`);
    }
    return options.trim === false ? result.stdout : result.stdout.trim();
}

export function spawnRun(
    command: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): void {
    const childCommand = trustedChildExecutable(command, options.env ?? process.env);
    const result = spawnSync(childCommand, args, {
        cwd: options.cwd ?? process.cwd(),
        env: options.env,
        stdio: 'inherit',
        shell: false,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${childCommand} failed with exit ${result.status ?? 'signal'}`);
    }
}

export function trustedChildExecutable(command: string, env: NodeJS.ProcessEnv = process.env): string {
    let trustedPath: string | undefined;
    if (command === 'git') {
        trustedPath = env.SOURDAW_TRUSTED_GIT_PATH;
    } else if (command === 'gh') {
        trustedPath = env.SOURDAW_TRUSTED_GH_PATH;
    }
    if (trustedPath === undefined) {
        return command;
    }
    if (!isAbsolute(trustedPath)) {
        fail(`trusted ${command} executable path is not absolute`);
    }
    return trustedPath;
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

export function originMainBlob(
    repoRelativePath: string,
    cwd: string = process.cwd(),
    env?: NodeJS.ProcessEnv,
    gitCommand: string = 'git',
    revision: string = 'origin/main'
): string | undefined {
    try {
        spawnCapture(gitCommand, ['cat-file', '-e', `${revision}:${repoRelativePath}`], { cwd, env });
    } catch {
        return undefined;
    }
    return spawnCapture(gitCommand, ['show', `${revision}:${repoRelativePath}`], { cwd, env, trim: false });
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
    for (const [name, expected] of Object.entries(requested)) {
        if (granted[name] !== expected) {
            fail(`installation token ${name} is ${granted[name] ?? '<missing>'}; expected ${expected}`);
        }
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
