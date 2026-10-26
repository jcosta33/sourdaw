import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../canonicalRecord.ts';
import { renderConfirmationReply } from '../confirmReviewRepairs.ts';
import { renderReviewRepairReply, type ReviewRepairRecord } from '../reviewRepair.ts';
import {
    bareModuleSpecifiers,
    executeTrustedSnapshot,
    forwardTrustedSnapshotSignal,
    resolveTrustedExecutable,
    resolveTrustedLauncherBinding,
    snapshotComputedDynamicSpecifiers,
    snapshotImportSpecifiers,
    trustedDependencyGraphs,
    trustedSnapshotRunsDetached,
} from '../trustedGithubWriteBootstrap.ts';

const supersessionPaths = [
    'scripts/trustedGithubWriteBootstrap.ts',
    'scripts/supersedePullRequest.ts',
    'scripts/supersedePullRequestGh.ts',
    'scripts/stackedLanes.ts',
    'scripts/findingLineage.ts',
    'scripts/pullRequestMutationLock.ts',
    'scripts/reviewRepair.ts',
    'scripts/canonicalRecord.ts',
    'scripts/evidenceSafety.ts',
    'scripts/githubAppIdentity.ts',
    'scripts/prContract.ts',
];
const retirementPaths = [...supersessionPaths, 'scripts/retirePullRequest.ts', 'scripts/retirementRecord.ts'];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type ReviewMutationCommand = 'review:repair' | 'review:confirm';

/** The package, snapshot, coordinator and default process fence are real; authentication refuses. */
function withNativeReviewMutation(
    command: ReviewMutationCommand,
    run: (root: string, bin: string, env: NodeJS.ProcessEnv) => void,
    unfenced = false
): void {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-native-review-mutation-'));
    const bin = join(root, 'bin');
    const gitPath = resolveTrustedExecutable('git');
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TRACE2_EVENT: '0',
    };
    for (const key of Object.keys(env)) {
        if (key.startsWith('SOURDAW_TRUSTED_')) {
            delete env[key];
        }
    }
    const git = (...args: string[]) => {
        const result = spawnSync(gitPath, args, { cwd: root, env, encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout.trim();
    };
    try {
        mkdirSync(bin);
        mkdirSync(join(root, 'scripts'));
        symlinkSync(gitPath, join(bin, 'git'));
        symlinkSync(gitPath, join(bin, 'git.exe'));
        symlinkSync(resolveTrustedExecutable('ps'), join(bin, 'ps'));
        for (const name of ['gh', 'gh.exe', 'powershell.exe']) {
            writeFileSync(join(bin, name), '#!/bin/sh\nexit 97\n');
            chmodSync(join(bin, name), 0o700);
        }
        env.PATH = [bin, dirname(process.execPath)].join(delimiter);
        for (const path of trustedDependencyGraphs[command]) {
            writeFileSync(join(root, path), readFileSync(join(repositoryRoot, path)));
        }
        const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({
                type: 'module',
                scripts: { [command]: manifest.scripts[command] },
            })
        );
        if (unfenced) {
            const path = join(root, 'scripts/trustedGithubWriteBootstrap.ts');
            const source = readFileSync(path, 'utf8');
            const fence = `command === '${command}' ||`;
            expect(source).toContain(fence);
            writeFileSync(path, source.replace(fence, ''));
        }
        const identityPath = join(root, 'scripts/githubAppIdentity.ts');
        const identity = readFileSync(identityPath, 'utf8');
        const authDeclaration = 'export async function authenticateRole(';
        expect(identity).toContain(authDeclaration);
        writeFileSync(
            identityPath,
            `${identity.replace(authDeclaration, 'export async function unusedFixtureAuthenticateRole(')}
            export async function authenticateRole(input) {
                const git = args => {
                    const result = spawnSync(process.env.SOURDAW_TRUSTED_GIT_PATH, args,
                        { cwd: input.primaryRoot, env: process.env, encoding: 'utf8' });
                    if (result.status !== 0) throw new Error(result.stderr);
                    return result.stdout.trim();
                };
                const oid = git(['rev-parse', '--verify', 'refs/sourdaw/delivery/pr-2244']);
                const owner = JSON.parse(git(['cat-file', 'blob', oid]));
                writeFileSync(join(input.primaryRoot, 'admitted.json'), JSON.stringify({
                    pid: process.pid, role: input.role, owner,
                    psPath: process.env.SOURDAW_TRUSTED_PS_PATH,
                    powershellPath: process.env.SOURDAW_TRUSTED_POWERSHELL_PATH,
                }));
                throw new Error('controlled authentication refusal after review mutation owner acquisition');
            }
        `
        );
        git('init', '--initial-branch=main');
        git('add', '.');
        git(
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            '-c',
            'core.hooksPath=/dev/null',
            'commit',
            '-qm',
            'fixture'
        );
        git('remote', 'add', 'origin', root);
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        run(root, bin, env);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function invokeNativeReviewMutation(root: string, env: NodeJS.ProcessEnv, command: ReviewMutationCommand) {
    const args = ['--run', command, '--', '2244', '--head', 'a'.repeat(40)];
    if (command === 'review:repair') {
        args.push('--thread', 'PRRT_fixture', '--commit', 'b'.repeat(40), '--summary', 'Bound repair.');
    }
    return spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8' });
}

describe.each(['review:repair', 'review:confirm'] as const)('native %s process-tool admission', (command) => {
    it('owns the real pinned default process fence before authentication', () => {
        withNativeReviewMutation(command, (root, _bin, env) => {
            const result = invokeNativeReviewMutation(
                root,
                {
                    ...env,
                    SOURDAW_TRUSTED_PS_PATH: '/forged/ps',
                    SOURDAW_TRUSTED_POWERSHELL_PATH: '/forged/powershell.exe',
                },
                command
            );
            expect(result.status).toBe(1);
            expect(result.stderr).toContain(
                'controlled authentication refusal after review mutation owner acquisition'
            );
            const admitted = JSON.parse(readFileSync(join(root, 'admitted.json'), 'utf8'));
            expect(admitted.role).toBe(command === 'review:repair' ? 'author' : 'reviewer');
            expect(admitted.owner).toMatchObject({
                version: 4,
                operation: 'delivery',
                number: 2244,
                pid: admitted.pid,
                ownerFence: { kind: 'pgid', pgid: admitted.pid, leaderStartedAt: expect.any(String) },
                mutation: { phase: 'prepared', epoch: 0 },
            });
            expect(admitted.psPath).toBe(resolveTrustedExecutable('ps'));
            expect(admitted.powershellPath).toBeUndefined();
            const lock = spawnSync(
                resolveTrustedExecutable('git'),
                ['rev-parse', '--verify', '--quiet', 'refs/sourdaw/delivery/pr-2244'],
                { cwd: root, env, encoding: 'utf8' }
            );
            expect(lock.status).toBe(1);
        });
    }, 30_000);

    it('detects an omitted fence classification before authentication', () => {
        withNativeReviewMutation(
            command,
            (root, _bin, env) => {
                const result = invokeNativeReviewMutation(root, env, command);
                expect(result.status).toBe(1);
                expect(result.stderr).toContain('mutation lock requires the trusted ps executable');
                expect(existsSync(join(root, 'admitted.json'))).toBe(false);
            },
            true
        );
    }, 30_000);

    it('pins required process tools through the launcher on both platforms', () => {
        withNativeReviewMutation(command, (root, bin, env) => {
            expect(resolveTrustedLauncherBinding(root, env, command, 'darwin').psPath).toBe(
                resolveTrustedExecutable('ps')
            );
            expect(resolveTrustedLauncherBinding(root, { ...env, PATH: bin }, command, 'win32').powershellPath).toBe(
                join(bin, 'powershell.exe')
            );
            expect(trustedSnapshotRunsDetached(command, 'darwin')).toBe(true);
            expect(trustedSnapshotRunsDetached(command, 'win32')).toBe(false);
            const missing = join(root, 'missing-tools');
            mkdirSync(missing);
            for (const name of ['git', 'git.exe']) {
                symlinkSync(resolveTrustedExecutable('git'), join(missing, name));
            }
            for (const name of ['gh', 'gh.exe']) {
                symlinkSync(join(bin, name), join(missing, name));
            }
            expect(() =>
                resolveTrustedLauncherBinding(
                    root,
                    {
                        ...env,
                        PATH: missing,
                        SOURDAW_TRUSTED_PS_PATH: '/forged/ps',
                    },
                    command,
                    'darwin'
                )
            ).toThrow('cannot resolve trusted ps executable');
            expect(() =>
                resolveTrustedLauncherBinding(
                    root,
                    {
                        ...env,
                        PATH: missing,
                        SOURDAW_TRUSTED_POWERSHELL_PATH: '/forged/powershell.exe',
                    },
                    command,
                    'win32'
                )
            ).toThrow('cannot resolve trusted powershell executable');
        });
    }, 30_000);
});

/** Only credential and remote-PR ports are controlled; the native launcher, CLI and lock are real. */
function withNativeSupersession(
    run: (root: string, bin: string, env: NodeJS.ProcessEnv) => void,
    mutation?: 'direct-package' | 'unfenced-command' | 'dropped-parent-argument',
    parentProof = false,
    retirementMode?: 'admission' | 'rollback'
): void {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-native-supersession-'));
    const bin = join(root, 'bin');
    const gitPath = resolveTrustedExecutable('git');
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TRACE2_EVENT: '0',
    };
    for (const key of Object.keys(env)) {
        if (key.startsWith('SOURDAW_TRUSTED_')) {
            delete env[key];
        }
    }
    const git = (...args: string[]) => {
        const result = spawnSync(gitPath, args, { cwd: root, env, encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout.trim();
    };
    try {
        mkdirSync(bin);
        mkdirSync(join(root, 'scripts'));
        symlinkSync(gitPath, join(bin, 'git'));
        symlinkSync(gitPath, join(bin, 'git.exe'));
        symlinkSync(resolveTrustedExecutable('ps'), join(bin, 'ps'));
        for (const name of ['gh', 'gh.exe', 'powershell.exe']) {
            writeFileSync(join(bin, name), '#!/bin/sh\nexit 97\n');
            chmodSync(join(bin, name), 0o700);
        }
        env.PATH = [bin, dirname(process.execPath)].join(delimiter);
        for (const path of retirementMode === undefined ? supersessionPaths : retirementPaths) {
            writeFileSync(join(root, path), readFileSync(join(repositoryRoot, path)));
        }
        const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({
                type: 'module',
                scripts: {
                    'pr:supersede':
                        mutation === 'direct-package'
                            ? 'node scripts/supersedePullRequest.ts'
                            : manifest.scripts['pr:supersede'],
                    'pr:retire':
                        mutation === 'direct-package'
                            ? 'node scripts/retirePullRequest.ts'
                            : manifest.scripts['pr:retire'],
                },
            })
        );
        if (mutation === 'unfenced-command') {
            const path = join(root, 'scripts/trustedGithubWriteBootstrap.ts');
            const source = readFileSync(path, 'utf8');
            const fence = retirementMode === undefined ? "command === 'pr:supersede' ||" : "command === 'pr:retire' ||";
            expect(source).toContain(fence);
            writeFileSync(path, source.replace(fence, ''));
        }
        if (mutation === 'dropped-parent-argument') {
            const path = join(root, 'scripts/supersedePullRequest.ts');
            const source = readFileSync(path, 'utf8');
            const forwarding = 'supersededParentNumber: parsed.supersededParentNumber,';
            expect(source).toContain(forwarding);
            writeFileSync(path, source.replace(forwarding, ''));
        }
        writeFileSync(
            join(root, 'lineage.json'),
            JSON.stringify({
                format: 'lineage-v1',
                oldPr: 2244,
                replacementPr: 2246,
                entries: [],
            })
        );
        writeFileSync(
            join(root, 'scripts/githubAppIdentity.ts'),
            `
            export const AUTHOR_BOT_NODE_ID = 'BOT_fixture_author';
            export const REQUIRED_REPOSITORY = 'fixture/repository';
            export const REQUIRED_BASE_BRANCH = 'main';
            export const isAuthorBotNodeId = value => value === AUTHOR_BOT_NODE_ID;
            export const assertTrustedExecutingBlob = () => undefined;
            export const originMainBlob = () => 'controlled-source-port';
            export const resolvePrimaryRoot = () => process.cwd();
            export const assertRequiredRepository = value => {
                if (value !== REQUIRED_REPOSITORY) throw new Error('wrong repository');
            };
            export const spawnCapture = () => REQUIRED_REPOSITORY;
            export async function authenticateRole() {
                return { minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                    session: { env: process.env, dispose() {} } };
            }
        `
        );
        writeFileSync(
            join(root, 'scripts/supersedePullRequestGh.ts'),
            `
            import { writeFileSync } from 'node:fs';
            import { join } from 'node:path';
            import { pullRequestMutationLockRef, readPullRequestMutationLockOid, readPullRequestMutationLockOwner }
                from './pullRequestMutationLock.ts';
            export const commentClientMutationId = (number, body) => 'supersede-comment:' + number + ':' + body;
            export const isDecimalId = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
            export function shellPort() {
                const parentProof = ${parentProof};
                const recordRead = number => {
                    const root = process.cwd();
                    const oid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(2244), 2244);
                    const owner = readPullRequestMutationLockOwner(root, oid, 2244);
                    writeFileSync(join(root, 'admitted.json'), JSON.stringify({
                        pid: process.pid, ownerFence: owner.ownerFence, psPath: process.env.SOURDAW_TRUSTED_PS_PATH,
                        powershellPath: process.env.SOURDAW_TRUSTED_POWERSHELL_PATH,
                        inspectedNumber: number, ownerNumber: owner.number, mutation: owner.mutation,
                    }));
                    if (!parentProof) throw new Error('controlled refusal before remote mutation');
                };
                const inspect = number => {
                    recordRead(number);
                    if (number === 2245) throw new Error('controlled parent proof read before remote mutation');
                    return {
                        number, repository: 'fixture/repository', comments: [],
                        head: 'a'.repeat(40), headRefName: 'fix/fixture-child', headRepository: 'fixture/repository',
                        state: number === 2244 ? 'OPEN' : 'MERGED',
                        base: number === 2244 ? 'fix/fixture-parent' : 'main',
                        merged: number !== 2244, closedAt: null,
                    };
                };
                return { inspect, inspectReviewThreads: number => { recordRead(number); return []; } };
            }
        `
        );
        if (retirementMode !== undefined) {
            writeNativeRetirementPorts(root, retirementMode);
        }
        git('init', '--initial-branch=main');
        git('add', '.');
        git(
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            '-c',
            'core.hooksPath=/dev/null',
            'commit',
            '-qm',
            'fixture'
        );
        git('remote', 'add', 'origin', root);
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        run(root, bin, env);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function invokeNativeSupersession(root: string, env: NodeJS.ProcessEnv, supersededParent = false) {
    const args = ['--run', 'pr:supersede', '--', '2244', '--head', 'a'.repeat(40), '--replacement', '2246'];
    if (supersededParent) {
        args.push('--superseded-parent', '2245');
    }
    args.push('--lineage', join(root, 'lineage.json'));
    return spawnSync(process.execPath, args, {
        cwd: root,
        env,
        encoding: 'utf8',
    });
}

function writeNativeRetirementPorts(root: string, mode: 'admission' | 'rollback'): void {
    const head = 'a'.repeat(40);
    const body = 'One attested blocking finding.';
    const repair: ReviewRepairRecord = {
        format: 'repair-v1',
        pr: 2244,
        thread: 'PRRT_fixture',
        finding: { commentId: 1001, path: 'scripts/fixture.ts', line: 1, side: 'RIGHT' },
        commit: head,
        head,
        summary: 'Corrected the finding.',
        evidence: [],
    };
    writeFileSync(
        join(root, 'retirement.json'),
        canonicalJson({
            format: 'retirement-v1',
            pr: 2244,
            head,
            base: 'main',
            rationale: 'The branch is obsolete.',
            evidence: [
                {
                    url: 'https://github.com/jcosta33/sourdaw/pull/2244',
                    observation: 'Owner released the obsolete branch.',
                },
            ],
            findings: [
                {
                    rootCommentId: '1001',
                    threadId: 'PRRT_fixture',
                    authorRepairCommentId: '1002',
                    reviewerConfirmationCommentId: '1003',
                },
            ],
            reviewBodies: [
                {
                    reviewId: 'PRR_fixture',
                    bodyDigest: createHash('sha256').update(body, 'utf8').digest('hex'),
                    rootCommentIds: ['1001'],
                },
            ],
        })
    );
    const reviews = {
        nodes: [{ id: 'PRR_fixture', state: 'CHANGES_REQUESTED', body, commit: { oid: head } }],
        pageInfo: { hasNextPage: false },
    };
    const reviewThreads = {
        nodes: [
            {
                id: 'PRRT_fixture',
                isResolved: true,
                comments: {
                    nodes: [
                        { databaseId: 1001, pullRequestReview: { id: 'PRR_fixture' } },
                        {
                            databaseId: 1002,
                            body: renderReviewRepairReply(repair),
                            author: { __typename: 'Bot', id: 'BOT_fixture_author' },
                        },
                        {
                            databaseId: 1003,
                            body: renderConfirmationReply(repair, head),
                            author: { __typename: 'Bot', id: 'BOT_fixture_reviewer' },
                        },
                    ],
                    pageInfo: { hasNextPage: false },
                },
            },
        ],
        pageInfo: { hasNextPage: false },
    };
    writeFileSync(join(root, 'reviews.json'), JSON.stringify({ reviews, reviewThreads }));
    writeFileSync(
        join(root, 'scripts/githubAppIdentity.ts'),
        `
        import { existsSync, readFileSync } from 'node:fs';
        import { join } from 'node:path';
        export const AUTHOR_BOT_NODE_ID = 'BOT_fixture_author';
        export const REVIEWER_BOT_NODE_ID = 'BOT_fixture_reviewer';
        export const REQUIRED_REPOSITORY = 'fixture/repository';
        export const REQUIRED_BASE_BRANCH = 'main';
        export const isAuthorBotNodeId = value => value === AUTHOR_BOT_NODE_ID;
        export const assertTrustedExecutingBlob = () => undefined;
        export const originMainBlob = () => 'controlled-source-port';
        export const resolvePrimaryRoot = () => process.cwd();
        export const assertRequiredRepository = value => { if (value !== REQUIRED_REPOSITORY) throw new Error('wrong repository'); };
        export const spawnCapture = (_command, args) => {
            if (args[0] !== 'api') return REQUIRED_REPOSITORY;
            const state = JSON.parse(readFileSync(join(process.cwd(), 'reviews.json'), 'utf8'));
            if (existsSync(join(process.cwd(), 'marker-posted'))) state.reviews.nodes[0].body += ' A later blocker.';
            return JSON.stringify({ data: { repository: { nameWithOwner: REQUIRED_REPOSITORY, pullRequest: { number: 2244, ...state } } } });
        };
        export async function authenticateRole() {
            return { minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session: { env: process.env, dispose() {} } };
        }
    `
    );
    writeFileSync(
        join(root, 'scripts/supersedePullRequestGh.ts'),
        `
        import { spawnSync } from 'node:child_process';
        import { writeFileSync } from 'node:fs';
        import { join } from 'node:path';
        import { pullRequestMutationLockRef, readPullRequestMutationLockOid, readPullRequestMutationLockOwner } from './pullRequestMutationLock.ts';
        export const commentClientMutationId = (number, body) => 'comment:' + number + ':' + body;
        export const isDecimalId = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
        export function shellPort() {
            const root = process.cwd();
            let comments = [];
            const persist = () => writeFileSync(join(root, 'remote.json'), JSON.stringify({ state: 'OPEN', comments }));
            const owner = () => {
                const oid = readPullRequestMutationLockOid(root, pullRequestMutationLockRef(2244), 2244);
                return readPullRequestMutationLockOwner(root, oid, 2244);
            };
            return {
                inspect: number => {
                    const held = owner();
                    writeFileSync(join(root, 'admitted.json'), JSON.stringify({ pid: process.pid, ownerFence: held.ownerFence,
                        psPath: process.env.SOURDAW_TRUSTED_PS_PATH, mutation: held.mutation }));
                    if (${JSON.stringify(mode)} === 'admission') throw new Error('controlled retirement refusal before remote mutation');
                    return { number, repository: 'fixture/repository', headRepository: 'fixture/repository',
                        head: '${head}', headRefName: 'fix/fixture', base: 'main', state: 'OPEN', merged: false, closedAt: null, comments: [...comments] };
                },
                inspectReviewThreads: () => [],
                comment: (number, body) => {
                    const created = { id: 'IC_2001', fullDatabaseId: '2001', body, authorNodeId: 'BOT_fixture_author', authorType: 'Bot' };
                    comments.push(created);
                    persist();
                    const result = spawnSync(process.execPath, ['--run', 'pr:retire', '--', '2244', '--head', '${head}', '--record', join(root, 'retirement.json')],
                        { cwd: root, env: process.env, encoding: 'utf8' });
                    writeFileSync(join(root, 'contender.json'), JSON.stringify({ status: result.status, stderr: result.stderr }));
                    writeFileSync(join(root, 'marker-posted'), 'edited');
                    return { ...created, clientMutationId: commentClientMutationId(number, body) };
                },
                deleteComment: id => { comments = comments.filter(comment => comment.id !== id); persist(); },
                close: () => { throw new Error('retirement must refuse before close'); },
                log: message => console.log(message),
            };
        }
    `
    );
}

function invokeNativeRetirement(root: string, env: NodeJS.ProcessEnv) {
    return spawnSync(
        process.execPath,
        ['--run', 'pr:retire', '--', '2244', '--head', 'a'.repeat(40), '--record', join(root, 'retirement.json')],
        { cwd: root, env, encoding: 'utf8' }
    );
}

describe('native retirement process-tool admission', () => {
    it('owns the real pinned default process fence before the first retirement PR read', () => {
        withNativeSupersession(
            (root, _bin, env) => {
                const result = invokeNativeRetirement(root, { ...env, SOURDAW_TRUSTED_PS_PATH: '/forged/ps' });
                expect(result.status).toBe(1);
                expect(result.stderr).toContain('controlled retirement refusal before remote mutation');
                const admitted = JSON.parse(readFileSync(join(root, 'admitted.json'), 'utf8'));
                expect(admitted.ownerFence).toMatchObject({
                    kind: 'pgid',
                    pgid: admitted.pid,
                    leaderStartedAt: expect.any(String),
                });
                expect(admitted.psPath).toBe(resolveTrustedExecutable('ps'));
                expect(admitted.mutation).toEqual({ phase: 'prepared', epoch: 0 });
            },
            undefined,
            false,
            'admission'
        );
    }, 30_000);

    it('excludes a native contender while the creator can still roll its marker back', () => {
        withNativeSupersession(
            (root, _bin, env) => {
                const result = invokeNativeRetirement(root, env);
                expect(result.status).toBe(1);
                expect(result.stderr).toMatch(/review.*body/u);
                const contender = JSON.parse(readFileSync(join(root, 'contender.json'), 'utf8'));
                expect(contender.status).toBe(1);
                expect(contender.stderr).toContain('already being delivered');
                expect(JSON.parse(readFileSync(join(root, 'remote.json'), 'utf8'))).toEqual({
                    state: 'OPEN',
                    comments: [],
                });
                const lock = spawnSync(
                    resolveTrustedExecutable('git'),
                    ['rev-parse', '--verify', '--quiet', 'refs/sourdaw/delivery/pr-2244'],
                    { cwd: root, env, encoding: 'utf8' }
                );
                expect(lock.status).toBe(1);
            },
            undefined,
            false,
            'rollback'
        );
    }, 30_000);

    it.each(['direct-package', 'unfenced-command'] as const)(
        'detects %s before retirement PR I/O',
        { timeout: 30_000 },
        (mutation) => {
            withNativeSupersession(
                (root, _bin, env) => {
                    const result = invokeNativeRetirement(root, env);
                    expect(result.status).toBe(1);
                    expect(result.stderr).toContain('mutation lock requires the trusted ps executable');
                    expect(existsSync(join(root, 'admitted.json'))).toBe(false);
                },
                mutation,
                false,
                'admission'
            );
        }
    );

    it('pins the retirement process tools on both platforms and includes its complete source closure', () => {
        withNativeSupersession(
            (root, bin, env) => {
                expect(resolveTrustedLauncherBinding(root, env, 'pr:retire', 'darwin').psPath).toBe(
                    resolveTrustedExecutable('ps')
                );
                expect(
                    resolveTrustedLauncherBinding(root, { ...env, PATH: bin }, 'pr:retire', 'win32').powershellPath
                ).toBe(join(bin, 'powershell.exe'));
                expect(trustedSnapshotRunsDetached('pr:retire', 'darwin')).toBe(true);
                expect(trustedSnapshotRunsDetached('pr:retire', 'win32')).toBe(false);
                expect([...trustedDependencyGraphs['pr:retire']].sort()).toEqual([...retirementPaths].sort());
            },
            undefined,
            false,
            'admission'
        );
    }, 30_000);
});

describe('native supersession process-tool admission', () => {
    it('forwards the superseded parent flag through the native package into the owned parent proof read', () => {
        withNativeSupersession(
            (root, _bin, env) => {
                const result = invokeNativeSupersession(root, env, true);
                expect(result.status).toBe(1);
                expect(result.stderr).toContain('controlled parent proof read before remote mutation');
                const admitted = JSON.parse(readFileSync(join(root, 'admitted.json'), 'utf8'));
                expect(admitted.inspectedNumber).toBe(2245);
                expect(admitted.ownerNumber).toBe(2244);
                expect(admitted.mutation).toEqual({ phase: 'prepared', epoch: 0 });
                expect(admitted.ownerFence.kind).toBe('pgid');
                expect(admitted.ownerFence.pgid).toBe(admitted.pid);
                expect(admitted.ownerFence.leaderStartedAt).toEqual(expect.any(String));
                expect(admitted.psPath).toBe(resolveTrustedExecutable('ps'));
            },
            undefined,
            true
        );
    }, 30_000);

    it('detects a dropped native parent argument before the parent proof read', () => {
        withNativeSupersession(
            (root, _bin, env) => {
                const result = invokeNativeSupersession(root, env, true);
                expect(result.status).toBe(1);
                expect(result.stderr).toContain('replacement PR #2246 does not target fix/fixture-parent');
                expect(result.stderr).not.toContain('controlled parent proof read before remote mutation');
                const admitted = JSON.parse(readFileSync(join(root, 'admitted.json'), 'utf8'));
                expect(admitted.inspectedNumber).toBe(2246);
                expect(admitted.ownerNumber).toBe(2244);
                expect(admitted.mutation).toEqual({ phase: 'prepared', epoch: 0 });
            },
            'dropped-parent-argument',
            true
        );
    }, 30_000);

    it('reaches the real default owner fence through the package and protected snapshot before PR I/O', () => {
        withNativeSupersession((root, _bin, env) => {
            const result = invokeNativeSupersession(root, {
                ...env,
                SOURDAW_TRUSTED_PS_PATH: '/forged/ps',
                SOURDAW_TRUSTED_POWERSHELL_PATH: '/forged/powershell.exe',
            });
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('controlled refusal before remote mutation');
            const admitted = JSON.parse(readFileSync(join(root, 'admitted.json'), 'utf8'));
            expect(admitted.ownerFence.kind).toBe('pgid');
            expect(admitted.ownerFence.pgid).toBeGreaterThan(0);
            expect(admitted.ownerFence.pgid).toBe(admitted.pid);
            expect(admitted.ownerFence.leaderStartedAt).toEqual(expect.any(String));
            expect(admitted.psPath).toBe(resolveTrustedExecutable('ps'));
            expect(admitted.powershellPath).toBeUndefined();
        });
    }, 30_000);

    it.each(['direct-package', 'unfenced-command'] as const)(
        'detects %s before the first PR port call',
        { timeout: 30_000 },
        (mutation) => {
            withNativeSupersession((root, _bin, env) => {
                const result = invokeNativeSupersession(root, env);
                expect(result.status).toBe(1);
                expect(result.stderr).toContain('mutation lock requires the trusted ps executable');
                expect(existsSync(join(root, 'admitted.json'))).toBe(false);
            }, mutation);
        }
    );

    it('freezes POSIX ps and Windows PowerShell for the same supersession command', () => {
        withNativeSupersession((root, bin, env) => {
            const posix = resolveTrustedLauncherBinding(root, env, 'pr:supersede', 'darwin');
            expect(posix.psPath).toBe(resolveTrustedExecutable('ps'));
            expect(posix.powershellPath).toBeUndefined();
            const windows = resolveTrustedLauncherBinding(root, { ...env, PATH: bin }, 'pr:supersede', 'win32');
            expect(windows.powershellPath).toBe(join(bin, 'powershell.exe'));
            expect(windows.psPath).toBeUndefined();
            expect(trustedSnapshotRunsDetached('pr:supersede', 'darwin')).toBe(true);
            expect(trustedSnapshotRunsDetached('pr:supersede', 'win32')).toBe(false);
        });
    }, 30_000);

    it('refuses missing process tools instead of accepting inherited forged pins', () => {
        withNativeSupersession((root, bin, env) => {
            const missing = join(root, 'missing-tools');
            mkdirSync(missing);
            symlinkSync(resolveTrustedExecutable('git'), join(missing, 'git'));
            symlinkSync(join(bin, 'gh'), join(missing, 'gh'));
            const forged = { ...env, PATH: missing, SOURDAW_TRUSTED_PS_PATH: '/forged/ps' };
            expect(() => resolveTrustedLauncherBinding(root, forged, 'pr:supersede', 'darwin')).toThrow(
                'cannot resolve trusted ps executable'
            );
            symlinkSync(resolveTrustedExecutable('git'), join(missing, 'git.exe'));
            symlinkSync(join(bin, 'gh.exe'), join(missing, 'gh.exe'));
            expect(() =>
                resolveTrustedLauncherBinding(
                    root,
                    {
                        ...forged,
                        SOURDAW_TRUSTED_POWERSHELL_PATH: '/forged/powershell.exe',
                    },
                    'pr:supersede',
                    'win32'
                )
            ).toThrow('cannot resolve trusted powershell executable');
            expect(existsSync(join(root, 'admitted.json'))).toBe(false);
        });
    }, 30_000);
});

describe('snapshotImportSpecifiers', () => {
    it('ignores from, import, and dynamic-import shapes inside comments', () => {
        const source = `
            // we used to read it from 'yaml'
            /* also import 'yaml' and import('yaml') once */
            export const ok = 1;
        `;

        expect(snapshotImportSpecifiers(source)).toEqual([]);
        expect(bareModuleSpecifiers(source)).toEqual([]);
    });

    it('ignores import-shaped prose inside a string literal', () => {
        const source = `
            const note = "import 'yaml' first";
            export const ok = 1;
        `;

        expect(snapshotImportSpecifiers(source)).toEqual([]);
        expect(bareModuleSpecifiers(source)).toEqual([]);
    });

    it('collects real from, side-effect, and dynamic import specifiers', () => {
        const source = `
            import { parse } from 'yaml';
            import 'yaml';
            const load = await import('yaml');
        `;

        expect(snapshotImportSpecifiers(source)).toEqual(['yaml']);
        expect(bareModuleSpecifiers(source)).toEqual(['yaml']);
    });

    it('ignores import-shaped prose inside a template literal', () => {
        const source = `
            const note = \`from 'yaml' and import 'yaml' and import('yaml')\`;
            export const ok = 1;
        `;

        expect(snapshotImportSpecifiers(source)).toEqual([]);
        expect(bareModuleSpecifiers(source)).toEqual([]);
    });

    it('ignores from, import, and dynamic-import shapes inside regex literals', () => {
        expect(snapshotImportSpecifiers(`/from 'yaml'/`)).toEqual([]);
        expect(snapshotImportSpecifiers(`/import 'yaml'/`)).toEqual([]);
        expect(snapshotImportSpecifiers(`/import('yaml')/`)).toEqual([]);
        expect(bareModuleSpecifiers(`/from 'yaml'/`)).toEqual([]);
    });

    it('does not treat /* inside a regex as a block comment that swallows a later import', () => {
        const source = "const x = /a/*/b/;\nimport { parse } from 'yaml'";

        expect(snapshotImportSpecifiers(source)).toEqual(['yaml']);
        expect(bareModuleSpecifiers(source)).toEqual(['yaml']);
    });

    it('collects dynamic imports inside template interpolations', () => {
        const source = "const x = `h ${await import('yaml')}`;";

        expect(snapshotImportSpecifiers(source)).toEqual(['yaml']);
        expect(bareModuleSpecifiers(source)).toEqual(['yaml']);
    });

    it('bounds the walk on a division after a parenthesized member expression inside a template', () => {
        // #4934: the regex-prefix question re-entered itself through this shape, one frame per round,
        // until the scan threw RangeError. Each of the four expressions names one part of the shape.
        expect(snapshotImportSpecifiers('const x = `${(a.b / 1000).toFixed(1)}`;')).toEqual([]);
        expect(snapshotImportSpecifiers('const x = `${(a / 1000).toFixed(1)}`;')).toEqual([]);
        expect(snapshotImportSpecifiers('const x = (a.b / 1000).toFixed(1);')).toEqual([]);
        expect(snapshotImportSpecifiers('const x = `${a.b / 1000}`;')).toEqual([]);
    });

    it('keeps scanning past that shape instead of stopping at the bounded walk', () => {
        // The bound answers the re-entrant question with a division, which keeps the walk moving. A
        // reading that consumed the region as a regex would hide both of these loads (#4934).
        expect(snapshotImportSpecifiers("const x = `${(a.b / 1000).toFixed(1)}`;\nimport 'yaml';")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("const x = `${(a.b / 1000).toFixed(1)}${await import('yaml')}`;")).toEqual([
            'yaml',
        ]);
    });

    it('ends // comments at CR so a following import is still collected', () => {
        const source = "// comment\rimport fs from 'fs';\n";

        expect(snapshotImportSpecifiers(source)).toEqual(['fs']);
        expect(bareModuleSpecifiers(source)).toEqual(['fs']);
    });

    it('ends // comments at LS or PS so a following import is still collected', () => {
        expect(snapshotImportSpecifiers("// comment\u2028import fs from 'fs';\n")).toEqual(['fs']);
        expect(snapshotImportSpecifiers("// comment\u2029import fs from 'fs';\n")).toEqual(['fs']);
        expect(bareModuleSpecifiers("// comment\u2028import fs from 'fs';\n")).toEqual(['fs']);
        expect(bareModuleSpecifiers("// comment\u2029import fs from 'fs';\n")).toEqual(['fs']);
    });

    it('collects imports separated by LS or PS whitespace', () => {
        expect(snapshotImportSpecifiers("import\u2028'yaml'")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("from\u2029'yaml'")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("import\u2028('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("import\u2028'yaml'")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("from\u2029'yaml'")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("import\u2028('yaml')")).toEqual(['yaml']);
    });

    it('collects static template literal dynamic import specifiers', () => {
        expect(snapshotImportSpecifiers('await import(`yaml`)')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('await import(`yaml`)')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('await import(`yaml${x}`)')).toEqual([]);
        expect(bareModuleSpecifiers('await import(`yaml${x}`)')).toEqual([]);
    });

    it('unwraps grouping parentheses around dynamic import specifiers', () => {
        expect(snapshotImportSpecifiers("await import(('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("await import( ('yaml') )")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("await import(/*c*/('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('await import((`yaml`))')).toEqual(['yaml']);
        expect(bareModuleSpecifiers("await import(('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('await import((`yaml${x}`))')).toEqual([]);
        expect(bareModuleSpecifiers('await import((`yaml${x}`))')).toEqual([]);
    });

    it('treats a slash after a block comment as a regex when the preceding token allows it', () => {
        expect(snapshotImportSpecifiers("const x = /*c*/ /from 'yaml'/")).toEqual([]);
        expect(bareModuleSpecifiers("const x = /*c*/ /from 'yaml'/")).toEqual([]);
        expect(snapshotImportSpecifiers("const x = /from 'yaml'/")).toEqual([]);
        expect(bareModuleSpecifiers("const x = /from 'yaml'/")).toEqual([]);
    });

    it('does not collect method-call import() after . or ?.', () => {
        expect(snapshotImportSpecifiers("registry.import('yaml');")).toEqual([]);
        expect(snapshotImportSpecifiers("registry?.import('yaml');")).toEqual([]);
        expect(bareModuleSpecifiers("registry.import('yaml');")).toEqual([]);
        expect(snapshotImportSpecifiers("await import('yaml');")).toEqual(['yaml']);
    });

    it('does not treat relative or node: specifiers as bare', () => {
        const source = `
            import { join } from 'node:path';
            import { helper } from './foo.ts';
        `;

        expect(snapshotImportSpecifiers(source).sort()).toEqual(['./foo.ts', 'node:path']);
        expect(bareModuleSpecifiers(source)).toEqual([]);
    });

    it('collects import.meta.resolve specifiers across quotes, grouping parens, and await', () => {
        expect(snapshotImportSpecifiers("import.meta.resolve('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("import.meta.resolve('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('import.meta.resolve("yaml")')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('import.meta.resolve("yaml")')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('import.meta.resolve(`yaml`)')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('import.meta.resolve(`yaml`)')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("await import.meta.resolve('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("await import.meta.resolve('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("import.meta.resolve(('yaml'))")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("import.meta.resolve(('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("import.meta.resolve( ('yaml') )")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("import.meta.resolve( ('yaml') )")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("import?.meta?.resolve?.('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("import?.meta?.resolve?.('yaml')")).toEqual(['yaml']);
    });

    it('ignores dynamic expressions in import.meta.resolve', () => {
        expect(snapshotImportSpecifiers('import.meta.resolve(`yaml${x}`)')).toEqual([]);
        expect(bareModuleSpecifiers('import.meta.resolve(`yaml${x}`)')).toEqual([]);
    });

    it('ignores method-call import.meta.resolve after property access', () => {
        expect(snapshotImportSpecifiers("obj.import.meta.resolve('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj.import.meta.resolve('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("obj?.import.meta.resolve('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj?.import.meta.resolve('yaml')")).toEqual([]);
    });

    it('collects require and require.resolve specifiers across quotes, grouping parens, and optional chaining', () => {
        expect(snapshotImportSpecifiers("require('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('require("yaml")')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('require("yaml")')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('require(`yaml`)')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('require(`yaml`)')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("require(('yaml'))")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require(('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("require( ('yaml') )")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require( ('yaml') )")).toEqual(['yaml']);

        expect(snapshotImportSpecifiers("require.resolve('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require.resolve('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('require.resolve("yaml")')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('require.resolve("yaml")')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('require.resolve(`yaml`)')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('require.resolve(`yaml`)')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("require.resolve(('yaml'))")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require.resolve(('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("require?.resolve('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require?.resolve('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("require?.resolve?.('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require?.resolve?.('yaml')")).toEqual(['yaml']);
    });

    it('ignores method-call require after property access', () => {
        expect(snapshotImportSpecifiers("obj.require('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj.require('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("obj?.require('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj?.require('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("obj.require.resolve('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj.require.resolve('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("obj?.require?.resolve('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj?.require?.resolve('yaml')")).toEqual([]);
    });

    it('collects a require load hidden by a dot-ending line comment', () => {
        expect(snapshotImportSpecifiers("// Fall back to the plugin entry.\nrequire('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("// Fall back to the plugin entry.\nrequire('yaml')")).toEqual(['yaml']);
    });

    it('collects a require load spread into an array', () => {
        expect(snapshotImportSpecifiers("[...require('yaml')]")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("[...require('yaml')]")).toEqual(['yaml']);
    });

    it('collects createRequire chained calls across quotes, grouping parens, and optional chaining', () => {
        expect(snapshotImportSpecifiers("createRequire(import.meta.url)('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("createRequire(import.meta.url)('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('createRequire(import.meta.url)("yaml")')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('createRequire(import.meta.url)("yaml")')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('createRequire(import.meta.url)(`yaml`)')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('createRequire(import.meta.url)(`yaml`)')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("createRequire(import.meta.url)(('yaml'))")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("createRequire(import.meta.url)(('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("createRequire(import.meta.url)?.('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("createRequire(import.meta.url)?.('yaml')")).toEqual(['yaml']);
    });

    it('ignores dynamic expressions in createRequire chained calls', () => {
        expect(snapshotImportSpecifiers('createRequire(import.meta.url)(`yaml${x}`)')).toEqual([]);
        expect(bareModuleSpecifiers('createRequire(import.meta.url)(`yaml${x}`)')).toEqual([]);
    });

    it('ignores method-call createRequire after property access', () => {
        expect(snapshotImportSpecifiers("obj.createRequire(import.meta.url)('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj.createRequire(import.meta.url)('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("obj?.createRequire(import.meta.url)('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj?.createRequire(import.meta.url)('yaml')")).toEqual([]);
    });

    /**
     * A statement-position regex after a control header's `)` or after `else` is a regex literal, so
     * the apostrophe in `/don't/` cannot open a string that swallows the rest of the file — the shape
     * that hid every later load (#4818). The division cases pin the other half: a `/` after a call's
     * `)` or after a `)` that closes no header still divides, including a private member named after
     * a control keyword, whose `#` makes it a member exactly as `.` does (#4828).
     */
    it('collects an import a statement-position regex used to hide', () => {
        expect(snapshotImportSpecifiers("if (ok) /don't/.test(line);\nimport { parse } from 'yaml';")).toEqual([
            'yaml',
        ]);
        expect(bareModuleSpecifiers("if (ok) /don't/.test(line);\nimport { parse } from 'yaml';")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("if (url) /^https?:\\/\\//.test(url);\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("if (x) run(); else /don't/.test(line);\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("for (;;) /x/.test(line);\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("while (ok) /x/.test(line);\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("with (o) /x/.test(line);\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("if (ok) report(x) / 2;\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("if (ok) { run(); } const v = g(a) / 2;\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("if (ok) obj / 2;\nrequire('yaml')")).toEqual(['yaml']);
        expect(
            snapshotImportSpecifiers(
                "class C { #while(n){return n} r(){ return this.#while(1) / require('yaml') / 2 } }"
            )
        ).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("obj.while(1) / require('yaml') / 2;")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("obj?.while(1) / require('yaml') / 2;")).toEqual(['yaml']);
    });

    /**
     * A division `/` inside the header a backward walk crosses must not pair with an earlier slash.
     * `a / g(b / c) / require(spec)` read itself as one literal from its second `/` back to the first,
     * so the walk stepped over the call's `(` and hid a real load the merge base refused (#4828).
     */
    it('reads a division pair inside a crossed header as a division', () => {
        expect(snapshotImportSpecifiers('if (x = a / g(b / c) / require(spec) / 2) {}')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('if (x = a / g(b / c) / require(spec) / 2) {}')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('if (ratio / compute(x / y) / import(spec) / 2 > 0) {}')).toEqual([
            'import(...)',
        ]);
    });

    /**
     * `for await (…)` is a control header exactly as `for (…)` is, so its `)` ends a header and
     * `/don't/` after it opens a regex whose apostrophe would otherwise swallow the load behind it.
     * The two-word header has to be read before the member guard, which sees the `r` of `for` in
     * front of `await` and rejects it as a member's name.
     */
    it('collects a load a for await header regex used to hide', () => {
        expect(snapshotComputedDynamicSpecifiers("for await (const a of b) /don't/.test(l);\nrequire(spec);")).toEqual([
            'require(...)',
        ]);
        expect(snapshotImportSpecifiers("for await (const a of b) /don't/.test(l);\nrequire('yaml');")).toEqual([
            'yaml',
        ]);
    });

    /**
     * A load reached through a wrapped or bound callee is the same load: `(require)(spec)`,
     * `(0, require)(spec)`, a name bound to `require` or to `createRequire(…)`, and an aliased
     * `createRequire` import (#4818). The boundary cases pin the limits: a parenthesis that continues
     * the enclosing call is an argument list rather than a wrapped callee — `pass(require)('./hidden')`
     * is an ordinary call, and reading it as a wrapped `require` refused it (#4828) — a longer name is
     * not the binding, and a name redeclared in a nested function, class, or parameter list keeps the
     * merge base's reading.
     */
    it('collects a load reached through a wrapped or bound callee', () => {
        expect(snapshotImportSpecifiers("(require)('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("(0, require)('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("const load = require;\nload('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("const load = createRequire(import.meta.url);\nload('yaml')")).toEqual([
            'yaml',
        ]);
        expect(
            snapshotImportSpecifiers(
                "import { createRequire as makeRequire } from 'node:module';\nmakeRequire(import.meta.url)('yaml')"
            )
        ).toEqual(['node:module', 'yaml']);
        expect(bareModuleSpecifiers("(0, require)('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("const load = require;\nload('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("const load = require;\ndownload('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("const load = require;\nregistry.load('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("const load = require;\nfunction f(load) { load('yaml') }")).toEqual([]);
        expect(snapshotImportSpecifiers("const load = require('yaml');\nload('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("pass(require)('./hidden');")).toEqual([]);
        expect(snapshotImportSpecifiers('pass(require)(specifier);')).toEqual([]);
        expect(snapshotImportSpecifiers("this.#m(require)('./hidden');")).toEqual([]);
        expect(
            snapshotImportSpecifiers(
                'function outer() { function load(s) { return s; } return load(1); }\nconst load = require;'
            )
        ).toEqual([]);
        expect(snapshotImportSpecifiers("const load = require;\nclass load {}\nload('yaml');")).toEqual([]);
        expect(
            snapshotImportSpecifiers(
                'const load = require;\nfunction outer(load) { return load(1); }\nload(specifier);'
            )
        ).toEqual([]);
        expect(
            snapshotImportSpecifiers(
                'const load = require;\nfunction outer() { function load(s) { return s; } return load(1); }'
            )
        ).toEqual([]);
        expect(
            snapshotImportSpecifiers("const load = require;\nfunction outer(s) { return s; }\nload('yaml');")
        ).toEqual(['yaml']);
    });

    /**
     * A loader's member is the same loader one indirection further out: `load.resolve` through a
     * bound `load`, and `require.bind(null)` whose result is the loader it was bound from. Both
     * initializers bound the name and both calls loaded a module the scan admitted (#4835). Whitespace
     * or a comment before the `.` changes nothing, so `load .resolve`, `load` newline `.resolve`, and
     * a block comment before `.resolve` read as `load.resolve`. Whitespace, a line break, or a block
     * comment after the `.` is skipped the same way, so `load. resolve`, `load.` newline `resolve`,
     * and a `load.` followed by a block comment and `resolve` read as `load.resolve` too. The boundary
     * cases pin the limits: a member on a name that reaches no loader, an unmodelled member, a
     * `resolve` that is itself called, and a `.bind(…)` that is then called or read as a member are not
     * the loader.
     */
    it('collects a load reached through a member of a bound loader', () => {
        expect(snapshotComputedDynamicSpecifiers('const load = require;\nconst r = load.resolve;\nr(spec);')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('const load = require;\nconst r = load\n.resolve;\nr(spec);')).toEqual(
            ['require(...)']
        );
        expect(snapshotComputedDynamicSpecifiers('const load = require;\nconst r = load .resolve;\nr(spec);')).toEqual([
            'require(...)',
        ]);
        expect(
            snapshotComputedDynamicSpecifiers('const load = require;\nconst r = load /*x*/ .resolve;\nr(spec);')
        ).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const load = require;\nconst r = load. resolve;\nr(spec);')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('const load = require;\nconst r = load.\nresolve;\nr(spec);')).toEqual(
            ['require(...)']
        );
        expect(
            snapshotComputedDynamicSpecifiers('const load = require;\nconst r = load./*c*/resolve;\nr(spec);')
        ).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const load = require.bind(null);\nload(spec);')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('const load = require.bind(null)();\nload(spec);')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('const load = require.bind(null).foo;\nload(spec);')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('const r = require.resolve;\nr(spec);')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const load = other;\nconst r = load.resolve;\nr(spec);')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('const load = require;\nconst r = load.foo;\nr(spec);')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers("const load = require.resolve('./yaml');")).toEqual([]);
    });

    /**
     * A name a default or a class field binds is the loader exactly as a declarator's is: the parameter
     * default, the destructuring default, and the shorthand entry that reads a class field's loader
     * back from an instance of the declaring class each reached a computed load the scan admitted
     * (#4835). The boundary cases pin the limits: an argument list's assignment binds nothing, a class
     * field alone binds no local, a shorthand read-back from an unrelated source object binds nothing,
     * a same-named field in another class does not drop a real binding, and a shadowing declaration
     * inside a nested function is that declaration.
     *
     * The read-back binds only an instance field of the class its constructor name resolves to in
     * scope. A `static` field sits on the constructor, not on the instance, so it binds nothing; a
     * same-named class in a nested scope owns the name there, so its non-loader field decides and the
     * outer class cannot; a subclass and a local holding an instance reach the field the instance
     * really carries, and each is a load.
     */
    it('collects a load a default or a class field binds the loader by', () => {
        expect(snapshotComputedDynamicSpecifiers('function f(load = require) { load(spec); }')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('const { load = require } = opts;\nload(spec);')).toEqual([
            'require(...)',
        ]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass J { loader = something; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('g(load = require);\nload(spec);')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('class H { loader = require; }\nloader(spec);')).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers('class H { loader = other; }\nconst { loader } = new H();\nloader(spec);')
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nconst { loader } = options;\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { load = require; }\nfunction f() { let load = other; return load(spec); }'
            )
        ).toEqual([]);
        // A static field is not on the instance, so `new H()` carries no loader to read back; the
        // sibling row is the one that witnesses the same-name static field not overwriting the
        // instance's own field.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { static loader = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = other; static loader = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        // The nested `class H` shadows the outer one where the read-back resolves, and its field is
        // `other`, so no loader is read back.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction build() {\n  class H { loader = other; }\n  const { loader } = new H();\n  loader(spec);\n}'
            )
        ).toEqual([]);
        // A subclass inherits the field, and a local holding an instance reads it back, so each is a load.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H {}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nconst h = new H();\nconst { loader } = h;\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // An aliased constructor (`const C = H`) is not resolved, so the read-back keeps the merge
        // base's reading and stays in the contract's undecided list.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nconst C = H;\nconst { loader } = new C();\nloader(spec);'
            )
        ).toEqual([]);
        // A class expression's name is bound only inside its own expression, so it does not shadow the
        // real class declaration the read-back reaches.
        expect(
            snapshotComputedDynamicSpecifiers(
                'const X = class H { loader = other; };\nclass H { loader = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A subclass's own field, method, or getter of a name shadows the parent's field of that name,
        // so each is not a load.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { loader = other; }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { loader() { return other; } }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { get loader() { return other; } }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        // A local bound to an instance in one scope does not bind a read-back of the same name in a
        // sibling scope. The second function only references `h`, so the scope-chain filter alone is
        // what keeps the outer instance from resolving here.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction a() { const h = new H(); return h; }\nfunction b() { const { loader } = h; loader(spec); }'
            )
        ).toEqual([]);
        // A nested redeclaration or a reassignment of a local to a non-instance shadows the instance
        // binding, so neither read-back reaches the loader.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nconst h = new H();\nfunction f() { const h = options; const { loader } = h; loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nlet h = new H();\nh = options;\nconst { loader } = h;\nloader(spec);'
            )
        ).toEqual([]);
        // A private field and an index signature declare no public `loader` property, so the parent's
        // field is still reached; a string-literal computed member does declare one, so it shadows it.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { #loader = other; }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { ["loader"]() { return other; } }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        // A template-literal computed member also declares the member, so it shadows the parent's field.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { [`loader`]() { return 1; } }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        // A field literally named a modifier is the member itself, not a modifier, so it is a load.
        expect(
            snapshotComputedDynamicSpecifiers('class H { get = require; }\nconst { get } = new H();\nget(spec);')
        ).toEqual(['require(...)']);
        // A local binding of the class name shadows the class, in both directions: a plain value binds
        // nothing, and a class expression binds its own loader.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { const H = Object; const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = other; }\nfunction f() { const H = class { loader = require; }; const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        // A class declared after the read-back is registered first, so the read-back reaches it.
        expect(
            snapshotComputedDynamicSpecifiers(
                'function make() { const { loader } = new H(); loader(spec); }\nclass H { loader = require; }'
            )
        ).toEqual(['require(...)']);
        // An optional/definite marker and a type annotation between the name and `=` still name a
        // loader field, and the module the field loads is what the read-back reaches.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader: NodeRequire = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader?: NodeRequire = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader!: NodeRequire = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A `declare` field emits nothing at runtime, so it does not shadow the parent's loader.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { declare loader: NodeRequire; }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A constructor parameter property binds an own instance field, so it shadows a parent's field of
        // that name and a read-back through the instance reaches the parameter's own value. A parameter
        // property with no initializer is an own member with no value, a `private readonly` spelling is
        // the same member, and a loader-valued parameter property is the loader the read-back binds.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class Base { loader = require }\nclass H extends Base { constructor(public loader: unknown = null) { super(); } }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class Base { loader = require }\nclass H extends Base { constructor(public loader: unknown) { super(); } }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class Base { loader = require }\nclass H extends Base { constructor(private readonly loader: unknown = null) { super(); } }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { constructor(public loader = require) {} }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A parameter with no modifier binds a local rather than a property, so it declares no instance
        // field and the parent's loader-valued field is still the one the read-back reaches.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class Base { loader = require }\nclass H extends Base { constructor(loader: unknown = null) { super(); } }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A field value is read only at the class body's own member position, so a parameter list, a
        // binding pattern, and a field initializer declare no field however their defaults read: the
        // instance carries nothing of the kind, and the merge base's reading stands.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = null; constructor(loader = require) {} }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader() { return other; } run(loader = require) { return 1; } }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { set loader(v) {} run(loader = require) { return 1; } }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { get loader() { return other; } run(loader = require) { return 1; } }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = other; x = (function (loader = require) { return 1; })(); }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        // A `}` a regex body holds does not carry the walk past the method body's `{` to the class
        // body's, so the assignment in the parameter is no member position and the method still
        // shadows the base's field.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class X {\n  m(loader: unknown) { const r = /}/; loader = require; }\n  loader() { return other; }\n}\nconst { loader } = new X();\nloader(spec);'
            )
        ).toEqual([]);
        // A member body is a balanced region the member-position walk crosses whole, so a real field
        // declared after a method or an accessor is still a member and still carries its loader.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H {\n  m() {}\n  loader = require;\n}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H {\n  get x() { return 1; }\n  loader = require;\n}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'const X = class { m() {} loader = require; };\nconst { loader } = new X();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A `}` a regex body holds is the literal's character rather than a delimiter, so the walk
        // crosses the literal whole and a real field after a method that holds one is still a member.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H {\n  m() { const r = /}/; }\n  loader = require;\n}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'const X = class { m() { const r = /}/; } loader = require; };\nconst { loader } = new X();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // An unbalanced delimiter in a regex initializer is the literal's character too, so the walk
        // still reaches the class body's own `{` and the next field is a member.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H {\n  x = /(/;\n  loader = require;\n}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H {\n  x = /)/;\n  loader = require;\n}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H {\n  x = /(/;\n  y = 1;\n  loader = require;\n}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A division slash starts no literal, so two of them never pair across a real delimiter: the
        // walk still reaches the class body's own `{` and the field after the division is a member.
        expect(
            snapshotComputedDynamicSpecifiers(
                'const a = 1 / 2; class H { x = 3 / 4; loader = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { x = f(a / b); y = c / d; loader = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A `/` after a control keyword's header or after `else` opens a regex rather than dividing, so
        // the `}` it holds is the literal's character: the class body does not close early and the
        // assignment inside the method is no member position. The same shapes without a loader field
        // report nothing either way.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D {\n  m() { do /}/; while (a); loader = require; }\n}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D {\n  m() { do /}/; while (a); }\n}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D {\n  m() { if (a) {} else /}/; loader = require; }\n}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D {\n  m() { if (a) {} else /}/; }\n}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        // A member named after a keyword the set holds is an expression end, so the `/` after it
        // divides rather than opening a literal: these readings can only come from the member guard.
        expect(snapshotComputedDynamicSpecifiers('class K { m() { return obj.return / require(spec) / 2; } }')).toEqual(
            ['require(...)']
        );
        expect(snapshotComputedDynamicSpecifiers('class K { m() { return this.#do / require(spec) / 2; } }')).toEqual([
            'require(...)',
        ]);
        // A member named after `else`, which is judged on its own, and the optional and keyword-named
        // spellings that reach no set entry: each keeps the division and reports the load.
        expect(
            snapshotComputedDynamicSpecifiers('class K { m() { return this.default / require(spec) / 2; } }')
        ).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('class K { m() { return obj.else / require(spec) / 2; } }')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('class K { m() { return obj?.if / require(spec) / 2; } }')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('class K { m() { return this.#if / require(spec) / 2; } }')).toEqual([
            'require(...)',
        ]);
        // A regex after a keyword stays a regex when a dot or an identifier on an earlier line precedes
        // the keyword: the member judgement is adjacency-bound, so `1.` above `typeof` and `b` above
        // `return` each belong to their own line's expression rather than naming the keyword a member.
        // A dot does NOT part them, so `obj.` newline `else` is still the member it spells.
        expect(
            snapshotComputedDynamicSpecifiers('const q = 1.\ntypeof /[\'"]/\nconst load = require\nload(spec);')
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                "function g() { const a = b\n return /[']/\n}\nconst load = require\nload(spec);"
            )
        ).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = obj.\nelse / require(spec) / y;')).toEqual([
            'require(...)',
        ]);
        // Only a `.`, an optional chain's `.`, or a `#` immediately before a keyword names a member: a
        // bare identifier ending the previous token is not member access, so `in` after `e` is the
        // operator and the `/` opens a regex instead of dividing.
        expect(snapshotComputedDynamicSpecifiers('const load = require;\ne in/}/*\nload(spec);')).toEqual([
            'require(...)',
        ]);
        // A dot following a digit run is a numeric literal's point only when that run holds no other
        // dot, so the second dot of `1.1.` is member access and the `/` after `else` divides, on one
        // line and across a break alike, while `1.` above `typeof` stays a point and the regex keeps
        // the load.
        expect(snapshotComputedDynamicSpecifiers('const r = 1.1.else / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = 1.1.\nelse / require(spec) / y;')).toEqual([
            'require(...)',
        ]);
        // A dot after a digit run is a numeric literal's point only when that run is a bare decimal's
        // integer part. A run that continues an identifier (`x1`, `item2`, `a1`) or that is a number's
        // exponent (`1e3`) or radix digits (`0x11`, `0o17`, `0b11`) is not one, so the dot is member
        // access and the `/` after the keyword divides rather than opening a regex that hides the load.
        expect(snapshotComputedDynamicSpecifiers('const r = x1.instanceof / require(spec) / y;')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('const r = item2.in / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = a1.else / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = 1e3.else / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = 0x11.else / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = 0o17.else / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = 0b11.else / require(spec) / y;')).toEqual(['require(...)']);
        // A signed exponent and an identifier-start tail carry the same judgements, so each keeps the
        // member dot.
        expect(snapshotComputedDynamicSpecifiers('const r = 1e+3.else / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = 1e-3.else / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = _1.else / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = $1.else / require(spec) / y;')).toEqual(['require(...)']);
        // A numeric separator keeps the run a plain decimal's integer part (`1_000.`, `1_0.`), and a
        // `+` after an identifier ending in `e` is an operator rather than an exponent sign (`mode+3.`).
        expect(
            snapshotComputedDynamicSpecifiers('const q = 1_000.\ntypeof /[\'"]/\nconst load = require\nload(spec);')
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers('const q = 1_0.\ntypeof /[\'"]/\nconst load = require\nload(spec);')
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers('const q = mode+3.else /[\'"]/\nconst load = require\nload(spec);')
        ).toEqual(['require(...)']);
        // The uppercase exponent and radix markers are their letter case, so each keeps the member dot.
        expect(snapshotComputedDynamicSpecifiers('const r = 1E+3.else / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = 1E3.else / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = 0X11.else / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = 0O17.else / require(spec) / y;')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const r = 0B11.else / require(spec) / y;')).toEqual(['require(...)']);
        // A separator inside a radix literal's digits is still that literal's digits, not a bare
        // decimal's, so the dot is member access and the load behind the division is reported.
        expect(snapshotComputedDynamicSpecifiers('const r = 0x1_1.else / require(spec) / y;')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('const r = 0b1_1.else / require(spec) / y;')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('const r = 0o1_7.else / require(spec) / y;')).toEqual([
            'require(...)',
        ]);
        // The uppercase radix markers carry the same judgement, so each keeps the member dot.
        expect(snapshotComputedDynamicSpecifiers('const r = 0X1_1.else / require(spec) / y;')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('const r = 0O1_7.else / require(spec) / y;')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('const r = 0B1_1.else / require(spec) / y;')).toEqual([
            'require(...)',
        ]);
        // An unmatched quote after a division ends at the line terminator instead of swallowing the file,
        // so the load on the next lines is still scanned — for `0x1_1.` before a keyword and for the
        // other radix spellings alike.
        expect(
            snapshotComputedDynamicSpecifiers('const q = 0x1_1.\ntypeof /[\'"]/\nconst load = require\nload(spec);')
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers('const q = 0x1_1.instanceof /[\'"]/\nconst load = require\nload(spec);')
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers('const q = 0x1_1.return /[\'"]/\nconst load = require\nload(spec);')
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers('const q = 0x1_1.in /[\'"]/\nconst load = require\nload(spec);')
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers('const q = 0o1_7.\ntypeof /[\'"]/\nconst load = require\nload(spec);')
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers('const q = 0b1_1.\ntypeof /[\'"]/\nconst load = require\nload(spec);')
        ).toEqual(['require(...)']);
        // A block comment's close is a `/` the `*` before it opens, so a division slash after a comment
        // is no comment close: the regex after it keeps its region and the field below is a member.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D {\n  m() { const ratio = total/* bytes *//typeof /}/; }\n  loader = require;\n}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A regex whose body ends in `*` closes with a slash the plain backward walk reads as a comment
        // close only where a `/*` opener stands; a `/ab*/` whose span holds no unclosed brace crosses
        // correctly, so the field below stays a member whose read-back reports the load.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D {\n  m() { const re = /ab*/; }\n  loader = require;\n}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D {\n  /* lead */ re = /ab*/;\n  loader = require;\n}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D {\n  m() { /* c */ const re = /ab*/; }\n  loader = require;\n}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A read-back through a subclass reaches the parent's loader field across the same regex.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class Base {\n  m() { /* c */ const re = /ab*/; }\n  loader = require;\n}\nclass D extends Base {}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A `/ab*/` after a block comment whose span to the slash crosses a method body's unclosed `{`
        // is the one the walk cannot place: the mis-placed field is not registered, so a method-local
        // `loader = require` never passes for the class's own `loader` method.
        expect(
            snapshotComputedDynamicSpecifiers(
                "const spec = './x';\nclass D {\n  /* note */\n  loader(_spec?: unknown): void {}\n  m(): void {\n    const re = /ab*/;\n    void re;\n    let loader: (s: string) => void;\n    loader = require;\n    loader(spec);\n  }\n}\nconst { loader } = new D();\nloader(spec);"
            )
        ).toEqual([]);
        // The bail skips only the binding its mis-placement condemns: an unrelated method-local `other`
        // does not discard the genuinely declared `loader`, and neither does the same method without it.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D { loader = require; /* c */ m() { const re = /ab*/; other = require; } }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D { loader = require; /* c */ m() { const re = /ab*/; } }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // The bail's scan stops at the field's own name, so a field declared before a method whose body
        // holds the same regex is still registered rather than condemned by the later member.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D { loader = require; m() { /* c */ if (x) { const re = /ab*/; } } }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // The bail fires only for a star-ending regex: a non-star regex in the same span keeps the load.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D { m() { /* c */ if (x) { const re = /ab/; } } loader = require; }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A quoted member name is read as its own member, not the identifier inside the quotes, so the
        // later field still enters the member set and shadows the parent's — or reports its own loader.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class Base { loader = require }\nclass H extends Base { "a" = other; loader = other; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class Base { loader = other }\nclass H extends Base { "a" = other; loader = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A regex after `do`, `try`, or `finally` keeps its region, so the field after it is a member.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D {\n  m() { do /}/; while (a); }\n  loader = require;\n}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D {\n  m() { try /}/; }\n  loader = require;\n}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class D {\n  m() { try { a(); } finally /}/; }\n  loader = require;\n}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A parameter property is read, and its own modifier run is what decides it: the loader default
        // reaches the read-back, while the same declaration without modifiers binds a local instead.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { constructor(public loader = require) {} }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A comparison in an earlier parameter's default nests nothing, so the parameter after it is
        // still read: its own field shadows the parent's, and its loader default is the loader.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class Base { loader = require }\nclass H extends Base { constructor(public a = b < c, public loader = null) {} }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        // The same comparison leaves the parameter's own loader initializer the only source of the
        // reading: this class has no parent, so nothing but that initializer can report the load.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { constructor(public a = b < c, public loader = require) {} }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // The splitter keeps reading parameters past that comparison, so a parameter property declared
        // after two such defaults is still the own field that shadows the parent's.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class Base { loader = require }\nclass H extends Base { constructor(public a = b < c, public z = 1, public loader = null) {} }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        // A class-scoped parameter default binds its local exactly as the top-level form does, so the
        // call through the parameter is the load the scan admits.
        expect(snapshotComputedDynamicSpecifiers('class H { m(loader = require) { loader(spec); } }')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('function f(loader = require) { loader(spec); }')).toEqual([
            'require(...)',
        ]);
        // A class name inside a parameter's default or annotation names a value or a type, not the
        // parameter, so it does not shadow the class.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f(x = H) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f(x: H) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        // A parameter whose own name is the class name shadows it, whichever order the class is declared in.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f(H) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'function f(H) { const { loader } = new H(); loader(spec); }\nclass H { loader = require; }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'function f() { const H = Object; const { loader } = new H(); loader(spec); }\nclass H { loader = require; }'
            )
        ).toEqual([]);
        // A class name in any annotation tail after the parameter's own name names a type or a value,
        // never the binding, so the class is still reached.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f(x: string | H) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f(x: A & H) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f(x: keyof H) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f(x: typeof H) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f(x: T extends H ? A : B) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f(x: () => H) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        // A parameter binds in its own function body, so a sibling parameter of the class name does
        // not shadow the class at the top level where the read-back stands.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction g(H) {}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'function g(H) {}\nclass H { loader = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A `for (… of/in …)` binding and a `var` hoisted to its function body bind the class name,
        // shadowing the class there.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfor (const H of xs) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfor (let H in xs) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { { var H = other; } const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        // A loop binding lives only inside the loop, so a read-back written before or after it, or after
        // a loop inside a function, still reaches the class.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfor (const H of xs) {}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nconst { loader } = new H();\nloader(spec);\nfor (const H of xs) {}'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { for (const H of xs) {} const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        // A `var` inside a nested function hoists to the nearest function body, so it neither shadows
        // the outer function nor leaks its own class expression there.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { function g() { var H = other; } const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = other; }\nfunction f() { function g() { var H = class { loader = require; }; } const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        // A nested function declaration and a destructured parameter bind the class name, shadowing it.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { const { loader } = new H(); function H() {} loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f({ H }) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f([H]) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        // A default value and a property key inside a destructured parameter name a value or a key,
        // never the binding, so the class is still reached.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f({ x = H }) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f({ H: y }) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        // A destructured variable binds the class name in the declaration's scope, however the entry is
        // spelled — renamed, shorthand, rest, or a nested pattern — so none reaches the class.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { const { x: H } = opts; const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { const { H } = opts; const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { let { H } = opts; const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { const { ...H } = opts; const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { const { a: { H } } = opts; const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        // A computed property key reads the class name as an expression, not a binding, so the class is
        // still reached.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { const { [H]: y } = opts; const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        // A name bound only by a comma-separated declarator or by an assignment pattern stays undecided:
        // `const a = 1, { H } = opts` and `({ H } = opts)` read the name as the class, so a construction
        // through it still reports the load rather than resolving the pattern.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { const a = 1, { H } = opts; const { loader } = new H(); loader(spec); }'
            )
        ).toEqual(['require(...)']);
        // A nested parameter pattern binds the class name in the function body, and a renamed, rest, or
        // modifier parameter binds it too.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f({ a: { H } }) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f({ x: H }) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f({ ...H }) { const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass C { constructor(public H) { const { loader } = new H(); loader(spec); } }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass C { constructor(private H) { const { loader } = new H(); loader(spec); } }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass C { constructor(protected H) { const { loader } = new H(); loader(spec); } }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass C { constructor(readonly H) { const { loader } = new H(); loader(spec); } }'
            )
        ).toEqual([]);
        // An expression-bodied arrow scopes its parameter to the arrow: a read-back inside its body sees
        // the parameter, and one outside it reaches the class.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nconst f = (H) => H;\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nconst f = (H) => ({ loader } = new H());\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nconst f = (H) => (() => ({ loader } = new H()))();\nloader(spec);'
            )
        ).toEqual([]);
        // A `var` in a `for` header hoists to its function, so a read-back before or after the loop
        // reaches the loop variable rather than the class.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { for (var H of xs) {} const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { const { loader } = new H(); loader(spec); for (var H of xs) {} }'
            )
        ).toEqual([]);
        // A binding pattern in a `for`/`for await` header takes the loop's scope, so a read-back after it
        // reaches the class.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfor (const { H } of xs) {}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfor (const [H] of xs) {}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfor (const { x: H } of xs) {}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfor await (const { H } of xs) {}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // An unbraced loop body is not modelled, so its binding keeps the declaration's own scope and a
        // read-back written after or inside it keeps the merge base's reading.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfor (const H of xs) log(H);\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfor (const H of xs) (() => { const { loader } = new H(); loader(spec); })();'
            )
        ).toEqual([]);
        // A `var` pattern in a loop header hoists to its function, so a read-back after or before it
        // reaches the loop variable rather than the class.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { for (var { H } of xs) {} const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { for (var [H] of xs) {} const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { const { loader } = new H(); loader(spec); for (var { H } of xs) {} }'
            )
        ).toEqual([]);
        // A `using` declarator in a loop header takes the loop's scope, so a read-back after it reaches
        // the class.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfor (using H of xs) {}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfor await (using H of xs) {}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfor (using H in xs) {}\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // A `using` declaration binds the class name to something other than the class.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { using H = other; const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        // An arrow whose body the walk can bound does not leak its parameter: a conditional's `:` ends
        // the body, so the read-back in the other branch reaches the class; an arrow ended by automatic
        // semicolon insertion cannot be bounded and keeps the merge base's reading.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nconst v = cond ? (H) => H : ({ loader } = new H());\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nconst f = (H) => H\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        // A decorator makes the class unmodelled, so a read-back through it keeps the merge base's
        // reading — on a member in either direction, and on a declaration whatever the decorator
        // spelling, its arguments, or a modifier after it. The shadow's own field is a loader, so only
        // the bail keeps these two declarations at the merge base's reading.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { @ns.dec loader = console.log; }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { @ns.dec loader = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { @dec class H { loader = require; } const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { @a.b.c(1) class H { loader = require; } const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                '@dec class H { loader = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        // A parenthesised decorator `@(expr)` decorates the class as the other spellings do, so it
        // marks the class unmodelled too — on a declaration and on an expression alike, whatever
        // expression it wraps. Each shadow's own field is a loader, so only the bail keeps these at
        // the merge base's reading.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { @(dec) class H { loader = require; } const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { const X = @(dec) class H { loader = require; }; const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { @(x => y) class H { loader = require; } const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { @(dec) class H { loader = other; } const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { const X = @(dec) class H { loader = other; }; const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        // A static block makes the class unmodelled, so the members after it keep the base reading.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { static {} loader = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        // A decorated `require` member declares the name, so the parameter list is not a loader call.
        expect(snapshotComputedDynamicSpecifiers('class C { x = 1; @dec require(spec) {} }')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('class C { @dec(arg) require(spec) {} }')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('class C { x = 1; @ns.dec require(spec) {} }')).toEqual([]);
        // The decorator walk closes over the chain rather than one more spelling: a group after a name
        // and a name after a group are each another segment, so a decorator that ends in a call of a
        // parenthesised expression does not leave its `)` read as the member's own parameter list.
        expect(snapshotComputedDynamicSpecifiers('class C { x = 1; @(dec)(arg) require(spec) {} }')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('class C { x = 1; @dec(1)(2) require(spec) {} }')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('class C { x = 1; @(dec) require(spec) {} }')).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nfunction f() { @(dec)(arg) class H { loader = console.log; } const { loader } = new H(); loader(spec); }'
            )
        ).toEqual([]);
        // A `using` loader declaration stays undecided, so the name binds no loader.
        expect(snapshotComputedDynamicSpecifiers('using load = require;\nload(spec);')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('await using load = require;\nload(spec);')).toEqual([]);
        // A statically computed member name is recorded but its loader value is not, so the read-back
        // keeps the merge base's reading.
        expect(
            snapshotComputedDynamicSpecifiers(
                "class H { ['loader'] = require; }\nconst { loader } = new H();\nloader(spec);"
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { [`loader`] = require; }\nconst { loader } = new H();\nloader(spec);'
            )
        ).toEqual([]);
        // A computed member name that is not a static string literal — a variable, a concatenation, an
        // interpolated template — names a property the reader cannot spell out, so it makes the class
        // unmodelled and a read-back through it keeps the merge base's reading, rather than the member
        // being skipped silently and the parent's loader inherited. The parent carries the
        // loader-valued `loader` field, so the bail is the only reason the read-back is refused.
        expect(
            snapshotComputedDynamicSpecifiers(
                "const key = 'loader';\nclass H { loader = require; }\nclass D extends H { [key] = console.log; }\nconst { loader } = new D();\nloader(spec);"
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                "class H { loader = require; }\nclass D extends H { ['lo' + 'ader'] = console.log; }\nconst { loader } = new D();\nloader(spec);"
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { [`${key}`] = console.log; }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        // The parent carries the loader-valued field, so this read-back is refused by the bail alone
        // rather than by the member walk declining a computed name it resolves to a static literal.
        expect(
            snapshotComputedDynamicSpecifiers(
                "const key = 'loader';\nclass H { loader = require; }\nclass D extends H { [key] = require; }\nconst { loader } = new D();\nloader(spec);"
            )
        ).toEqual([]);
        // A member name written with a unicode escape is the character it names rather than the
        // characters it is spelled with, so the reader cannot read it exactly: the class is unmodelled
        // and the read-back through it keeps the merge base's reading, on an identifier, a string
        // literal, and a template literal alike. The escape-less control shadows the same field.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { \\u006coader = console.log; }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { loade\\u0072 = console.log; }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                "class H { loader = require; }\nclass D extends H { ['\\u006coader'] = console.log; }\nconst { loader } = new D();\nloader(spec);"
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { [`\\u006coader`] = console.log; }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H { loader = require; }\nclass D extends H { loader = console.log; }\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual([]);
    });

    /**
     * An erased assertion on the initializer changes nothing at run time, so the loader behind it is
     * the loader: the angle-bracket assertion the binding pass never looked past bound the name and
     * its call loaded a module the scan admitted (#4835). The control pins that an assertion on a name
     * that reaches no loader binds nothing.
     */
    it('collects a load a loader bound through an erased assertion reaches', () => {
        expect(snapshotComputedDynamicSpecifiers('const load = <NodeRequire>require;\nload(spec);')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('const load = <NodeRequire>other;\nload(spec);')).toEqual([]);
    });

    /**
     * A `{` admits a member only where it opens a body that can hold one. A function body, a nested
     * block, and a control header's body hold statements, so the `require(spec)` before the block is a
     * call and its computed specifier is refused; the merge base read the brace as a method position
     * and admitted the load (#4835). The controls pin the bodies that really do hold members — object
     * literal, class, interface, and type literal — and a class whose header carries a type-parameter
     * list and a parenthesised heritage clause is still a class, while the brace after a `:` or an `=>`
     * that also stands in a type literal stays undecided.
     */
    it('collects a load whose parameter list opens on a block-opening brace', () => {
        expect(snapshotComputedDynamicSpecifiers('function load() { require(spec)\n{ run(); } }')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('{ require(spec)\n{ run(); } }')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('if (ok) { require(spec)\n{ run(); } }')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const o = { require(spec) { run(); } };')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('class C { require(spec) { run(); } }')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('class C<T> extends (B) { require(spec) { run(); } }')).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers('class Mix<T> extends (Mixin(Base)) { require(spec) { run(); } }')
        ).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('interface I { require(spec: string): void; }')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('type T = { require(spec: string): void };')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('const o = { a: { require(spec) { run(); } } };')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('type F = () => { require(spec: string): void };')).toEqual([]);
    });

    /**
     * A `<` or `>` in a class or type header is not a balanced delimiter, so a function type's `=>` and
     * a cast's `new () => B` in the header cannot open a depth the walk never closes. Counting them as
     * delimiters left the walk above depth zero and refused a header that declares no load, while the
     * merge base admitted each (#4835). A type-parameter list on the declared name still crosses —
     * `class C<T> extends (B)` above — as one balanced region, so an object type, a conditional type,
     * or a generic call inside the list cannot reach the fallthrough either, and a class whose parent
     * carries such a list still declares the field a read-back inherits.
     */
    it('admits a class or type header whose heritage holds an arrow', () => {
        expect(
            snapshotComputedDynamicSpecifiers(
                'type ModuleApi = (() => void) & { version: string; require(spec: string): void; };'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers('class C extends (B as new () => B) { require(spec: string) { run(); } }')
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class C extends (mixin(B) as new () => B) { x = 1; require(spec: string) { run(); } }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class C<T extends { a: string }> { x = 1; require(spec: string): void { run(); } }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class C<T extends U extends V ? X : Y> { x = 1; require(spec: string): void { run(); } }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class C<T extends Mixin<{ a: string }>> { x = 1; require(spec: string): void { run(); } }'
            )
        ).toEqual([]);
        // The parent's type-parameter list is crossed, so the field the subclass inherits is registered.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class H<T extends { a: string }> { loader = require; }\nclass D extends H<string> {}\nconst { loader } = new D();\nloader(spec);'
            )
        ).toEqual(['require(...)']);
        // Every balanced `<…>` region the walk meets is crossed, so an object, conditional, or nested
        // argument in a heritage or implements clause does not reach the fallthrough.
        expect(
            snapshotComputedDynamicSpecifiers(
                'class C extends Base<{ a: string }> { v = 1; require(spec: string): void { run(); } }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class C implements I<V extends W ? X : Y> { v = 1; require(spec: string): void { run(); } }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class C extends Base<Map<string, { a: string }>> { v = 1; require(spec: string): void { run(); } }'
            )
        ).toEqual([]);
    });

    /**
     * The `else`, `do`, `try`, and `finally` keywords open statement blocks, so the `{` after each holds
     * statements and the `require(spec)` before a nested block is a call rather than a member — the
     * merge base read it as a method position and admitted the load (#4835). Each word form is pinned
     * separately so the exclusion is witnessed: replacing it with `return true` admits exactly the
     * `{` after the word.
     */
    it('refuses a load whose parameter list opens on a block after else, do, try, or finally', () => {
        expect(snapshotComputedDynamicSpecifiers('if (x) {} else { require(spec)\n{ run(); } }')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('do { require(spec)\n{ run(); } } while (x);')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('try { require(spec)\n{ run(); } } finally {}')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('try {} finally { require(spec)\n{ run(); } }')).toEqual([
            'require(...)',
        ]);
    });

    /**
     * Regrouping a wrapped callee changes nothing: `((require))(spec)` reaches the loader that
     * `(require)(spec)` reaches, and the merge base's one paren of tolerance admitted the load (#4835).
     * The controls pin that only whole groupings are stripped — `pass(require)(spec)` is an argument
     * list and `(f(require))(spec)` wraps a call's result — so neither is the loader.
     */
    it('collects a load a double-parenthesised callee reaches', () => {
        expect(snapshotComputedDynamicSpecifiers('((require))(spec);')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('(((require)))(spec);')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('((0, require))(spec);')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('pass(require)(spec);')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('(f(require))(spec);')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('this.#m(require)(spec);')).toEqual([]);
    });

    /**
     * A name declared again in a nested function, class, or parameter list is that declaration, not the
     * loader bound outside it, so the binding is dropped and the nested call keeps the merge base's
     * reading (#4828). The bare bound name still resolves, which is what separates the two.
     */
    it('drops a loader binding redeclared in a nested scope', () => {
        expect(snapshotComputedDynamicSpecifiers('const load = require;\nload(specifier);')).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'function outer() { function load(s) { return s; } return load(1); }\nconst load = require;'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'const load = require;\nfunction outer() { class load {}\nreturn new load(); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers('const load = require;\nfunction outer(load) { return load(1); }')
        ).toEqual([]);
    });

    /**
     * A file that declares `require` itself — as a parameter, a `const`/`let`/`var` name, a
     * destructuring target, or a catch parameter — forms no binding of any name to the loader, so the
     * file keeps the merge base's reading. The four shapes load nothing, and reading them as loads
     * refused sources that reach no module (#4828). The declaration is the file's, not the scope's: the
     * file's own shadowing wins. It stops at the binding pass, which is what keeps the callee cases
     * below loads.
     */
    it('drops the loader binding when the file declares require itself', () => {
        expect(snapshotComputedDynamicSpecifiers('function f(require) { const load = require; load(spec); }')).toEqual(
            []
        );
        expect(snapshotComputedDynamicSpecifiers('const require = fake;\nconst load = require;\nload(spec);')).toEqual(
            []
        );
        expect(
            snapshotComputedDynamicSpecifiers('const { require } = box;\nconst load = require;\nload(spec);')
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers('try {} catch (require) { const load = require; load(spec); }')
        ).toEqual([]);
        expect(snapshotImportSpecifiers("const require = fake;\nconst load = require;\nload('yaml');")).toEqual([]);
        // The binding a file that does not declare `require` still makes, which is the rule's other half.
        expect(snapshotComputedDynamicSpecifiers('const load = require;\nload(spec);')).toEqual(['require(...)']);
    });

    /**
     * A declaration binds the name wherever its parameter list stands, whatever follows the list. The
     * list closes on its own `)`, so a return type or a body brace abutting that `)` still proves the
     * list a declaration; reading one character past the close missed every shape whose `)` is followed
     * by a significant character, and each of them loads nothing through the parameter (#4828).
     */
    it('drops the loader binding for a parameter list closed before a return type or a body', () => {
        expect(
            snapshotComputedDynamicSpecifiers('function f(require: string): void { const load = require; load(spec); }')
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'const f = (require: string): void => { const load = require; load(spec); };'
            )
        ).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('(require)=>{const load=require; load(spec);}')).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers('function(require: string): void { const load = require; load(spec); }')
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'class C { m(require: string): void { const load = require; load(spec); } }'
            )
        ).toEqual([]);
    });

    /**
     * An `import` clause binds the name it introduces — the default binding, a named specifier, a
     * namespace alias, and the type-only spellings of those clauses — and a rest parameter and an `enum`
     * name bind it too. Each is a local declaration of `require`, so none of them forms a binding of a
     * name to the loader and each file keeps the merge base's reading; without the branch, every one of
     * them was refused (#4828). A specifier the clause aliases away reads as a declaration as well, which
     * is the direction this test errs toward.
     */
    it('drops the loader binding for an import binding, a rest parameter, and an enum name', () => {
        expect(
            snapshotComputedDynamicSpecifiers("import require from 'x';\nconst load = require;\nload(spec);")
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers("import { require } from 'x';\nconst load = require;\nload(spec);")
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers("import * as require from 'x';\nconst load = require;\nload(spec);")
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers('function f(...require) {}\nconst load = require;\nload(spec);')
        ).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('enum require { A }\nconst load = require;\nload(spec);')).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers("import type { require } from 'x';\nconst load = require;\nload(spec);")
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers("import { type require } from 'x';\nconst load = require;\nload(spec);")
        ).toEqual([]);
    });

    /**
     * A declaration keyword announces the name wherever the language allows a modifier or a prefix or
     * nothing at all in front of it, and the TypeScript body keywords declare it too. Reading the
     * keyword at its own start is what separates a prefix from a member: `export const require = fake`
     * and `export namespace require {}` declare the name, while `obj.require = fake` names a member and
     * declares nothing, so the file's own `require` is the loader there. Without that reading every
     * shape below bound the loader to `require` and refused an ordinary call through it, which the
     * merge base admitted (#4828). Each case pins one family; `export default class` and
     * `export abstract class` pin a two-word prefix chain, and the ambient declarations pin the
     * `declare` modifier the merge base admitted with them.
     */
    it.each([
        ['a prefixed const', 'export const require = fake;'],
        ['a prefixed function', 'export function require() {}'],
        ['a prefixed class', 'export class require {}'],
        ['a prefixed enum', 'export enum require { A }'],
        ['a prefixed default class', 'export default class require {}'],
        ['a prefixed async function', 'export async function require() {}'],
        ['a bare async function', 'async function require() {}'],
        ['an abstract class', 'abstract class require {}'],
        ['a const enum', 'const enum require { A }'],
        ['a namespace', 'namespace require {}'],
        ['a module', 'module require {}'],
        ['a bare arrow parameter', 'const f = require => {};'],
        ['a parameter property', 'class C { constructor(private require: string) {} }'],
        ['a prefixed default function', 'export default function require() {}'],
        ['a prefixed abstract class', 'export abstract class require {}'],
        ['an ambient function', 'declare function require(name: string): unknown;'],
        ['a declared ambient const', 'declare const require: unknown;'],
        ['a prefixed declared ambient const', 'export declare const require: unknown;'],
        ['an ambient namespace', 'declare namespace require {}'],
    ])('drops the loader binding for %s named require', (_label, prelude) => {
        expect(snapshotComputedDynamicSpecifiers(`${prelude}\nconst load = require;\nload(spec);`)).toEqual([]);
    });

    /**
     * The member shapes the prefix rule must not swallow: a `.` or a `#` in front of the keyword names
     * a member, so no declaration of `require` stands in the file and the binding through the loader
     * resolves — which is what the merge base's own callee detection refused to see (#4818). Reading
     * the identifier character before the keyword as the member instead of the dot read every prefixed
     * declaration as a member.
     */
    it('drops no loader binding for a member named require', () => {
        expect(snapshotComputedDynamicSpecifiers('obj.require = fake;\nconst load = require;\nload(spec);')).toEqual([
            'require(...)',
        ]);
        expect(
            snapshotComputedDynamicSpecifiers('class C { require() {} }\nconst load = require;\nload(spec);')
        ).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('x.namespace = 1;\nconst load = require;\nload(spec);')).toEqual([
            'require(...)',
        ]);
    });

    /**
     * The declaration above stops the binding pass alone. A `require(…)` call is the loader whatever
     * else the file declares, as the merge base read it, so an unrelated declaration never hides a real
     * load: a literal specifier is collected, and a computed one is refused by `require(...)`. Only the
     * binding through the name is dropped, which is what the four stand-down shapes above observe.
     */
    it('keeps a require callee a load when the file declares the name elsewhere', () => {
        expect(snapshotImportSpecifiers("function f(require) {}\nconst y = require('yaml');")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("function f({ require }) {}\nconst y = require('yaml');")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("try {} catch (require) {}\nconst y = require('yaml');")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("const require = fake;\nconst y = require('yaml');")).toEqual(['yaml']);
        expect(snapshotComputedDynamicSpecifiers('const require = fake;\nrequire(spec);')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const require = fake;\nrequire.resolve(spec);')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('function f(require) { require(spec); }')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const require = fake;\n(0, require)(spec);')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('const require = fake;\n(require)(spec);')).toEqual(['require(...)']);
    });

    /**
     * A parameter list inside a type declares nothing at runtime, so it is no declaration of the name
     * `require` and must not stand the binding pass down: `const load = require` still binds the loader
     * and `load(spec)` is a computed load. Only the `=` of a `type` alias and the `:` of a declared
     * name's annotation prove the type position; every other list keeps the stand-down above (#4828).
     */
    it('reads a parameter list inside a type as no declaration of require', () => {
        expect(
            snapshotComputedDynamicSpecifiers('type L = (require: string) => void;\nconst load = require;\nload(spec);')
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'type L<T> = (require: string) => void;\nconst load = require;\nload(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'let loader: (require: string) => void;\nconst load = require;\nload(spec);'
            )
        ).toEqual(['require(...)']);
        expect(snapshotImportSpecifiers("type L = (require: string) => void;\nconst y = require('yaml');")).toEqual([
            'yaml',
        ]);
    });

    /**
     * Only a value `import { createRequire as <name> } from '…'` binds a local name, so only it makes a
     * call through that name a load. `export { … } from` re-exports without binding anything,
     * `import type { … }` imports a type, and an inline `type` specifier names a type, so
     * `cr(import.meta.url)('./hidden')` behind any of them reaches no local loader and the file reaches
     * `node:module` alone. Reading the alias out of any `{ … } from` clause collected `./hidden`, which
     * the merge base never did (#4828).
     */
    it.each([
        {
            label: 'an export clause re-exporting createRequire',
            source: "export { createRequire as cr } from 'node:module';\ncr(import.meta.url)('./hidden');",
        },
        {
            label: 'an export type clause re-exporting createRequire',
            source: "export type { createRequire as cr } from 'node:module';\ncr(import.meta.url)('./hidden');",
        },
        {
            label: 'a type-only import of createRequire',
            source: "import type { createRequire as cr } from 'node:module';\ncr(import.meta.url)('./hidden');",
        },
        {
            label: 'an inline type specifier of createRequire',
            source: "import { type createRequire as cr } from 'node:module';\ncr(import.meta.url)('./hidden');",
        },
    ])('binds no local loader through $label', ({ source }) => {
        expect(snapshotImportSpecifiers(source)).toEqual(['node:module']);
        expect(snapshotComputedDynamicSpecifiers(source)).toEqual([]);
    });

    /**
     * A type literal's `}` is not an operand-position object literal's `}`: treating it as one
     * mislexed the statement-position regex after it and let its apostrophe swallow the file (#4828).
     * Only the argument, array, sequence, `return`, arrow, and declaration-assignment positions keep
     * the division reading, so a `const` initializer's braces still divide while every type shape —
     * a type alias, an intersection or union branch, an annotation — keeps the merge base's reading.
     */
    it('keeps the merge base reading at a type literal close', () => {
        expect(snapshotImportSpecifiers("type T = { a: number }\n/don't/.test(line);\nrequire('yaml');")).toEqual([
            'yaml',
        ]);
        expect(snapshotImportSpecifiers("type T = A & { b: number }\n/don't/.test(line);\nrequire('yaml');")).toEqual([
            'yaml',
        ]);
        expect(snapshotImportSpecifiers("type T = A | { b: number }\n/don't/.test(line);\nrequire('yaml');")).toEqual([
            'yaml',
        ]);
        expect(snapshotImportSpecifiers("let x: { a: number }\n/don't/.test(line);\nrequire('yaml');")).toEqual([
            'yaml',
        ]);
        // The division reading is what the `const` initializer proves: the literal specifier after the
        // divided `/` is a real load and is collected, while the computed form is refused above.
        expect(snapshotImportSpecifiers("const r = {} / import('yaml') / 2;")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("const r = {} / require('yaml') / 2;")).toEqual(['yaml']);
    });

    /**
     * The operand-position proof crosses the same backward walks, so a division pair inside the brace
     * it matches has to read as a division there too. The `}` of `{ ({ a: 1 / 2 }) / c }` closes a
     * statement block and the `/ require(spec) /` after it is a regex literal the file loads nothing
     * through, as the merge base read it; pairing the slashes proved an object literal and refused it.
     */
    it('keeps a statement-position regex after a brace holding a division', () => {
        expect(snapshotComputedDynamicSpecifiers('{ ({ a: 1 / 2 }) / c } / require(spec) /;')).toEqual([]);
        expect(snapshotComputedDynamicSpecifiers('function f() { ({ a: b / c }) / d; } / require(spec) /;')).toEqual(
            []
        );
    });

    /**
     * The close-brace walk must answer each `/` once. `canStartRegexLiteral` re-enters itself through
     * `lineCommentOpenBefore`, because skipping a comment, string, or regex needs the same question
     * answered at an earlier index, so the cost of a line of repeated `} /` delimiters grew by about
     * nine times every four repetitions before the answers were memoised (#4828). The bound is loose:
     * the repaired scan takes under two milliseconds at this length, while the walk without the memo
     * took 9.7 s at 32 repetitions and 271 s here.
     */
    it('scans a line of repeated close-brace divisions in bounded time', () => {
        const source = `${'} / '.repeat(40)};`;
        const startedAt = performance.now();
        const shapes = snapshotComputedDynamicSpecifiers(source);
        const elapsedMs = performance.now() - startedAt;
        expect(shapes).toEqual([]);
        expect(elapsedMs).toBeLessThan(2_000);
    });
});

describe('trusted GitHub write snapshot launcher', () => {
    it.each([
        ['deliver', true],
        ['issue:reconcile', false],
        ['lane:publish', false],
        ['review:publish', true],
        ['review:publish:recover', true],
        ['review:repair', true],
        ['review:confirm', true],
        ['review:resolve', false],
        ['review:shadow-status', false],
        ['ruleset:harden', false],
    ] as const)('uses a detached POSIX process group only for %s: %s', (command, expected) => {
        expect(trustedSnapshotRunsDetached(command, 'linux')).toBe(expected);
        expect(trustedSnapshotRunsDetached(command, 'darwin')).toBe(expected);
        expect(trustedSnapshotRunsDetached(command, 'win32')).toBe(false);
    });

    it('forwards cancellation to the exact detached POSIX child group', () => {
        const forwarded: Array<{ target: number; signal: NodeJS.Signals }> = [];

        forwardTrustedSnapshotSignal(42, true, 'linux', 'SIGTERM', (target, signal) => {
            forwarded.push({ target, signal });
        });

        expect(forwarded).toEqual([{ target: -42, signal: 'SIGTERM' }]);
    });

    it('forwards non-detached and Windows cancellation to the child PID', () => {
        const forwarded: Array<{ target: number; signal: NodeJS.Signals }> = [];
        const send = (target: number, signal: NodeJS.Signals) => forwarded.push({ target, signal });

        forwardTrustedSnapshotSignal(42, false, 'linux', 'SIGINT', send);
        forwardTrustedSnapshotSignal(42, true, 'win32', 'SIGHUP', send);

        expect(forwarded).toEqual([
            { target: 42, signal: 'SIGINT' },
            { target: 42, signal: 'SIGHUP' },
        ]);
    });

    it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)(
        'forwards %s cancellation to the detached snapshot child group and waits for it to terminate',
        async (signal) => {
            await expect(
                executeTrustedSnapshot('review:publish', [], {
                    commit: 'test-snapshot',
                    sources: new Map([
                        [
                            'scripts/publishReview.ts',
                            [
                                'export async function runPublishReviewCli() {',
                                '  const keepAlive = setInterval(() => undefined, 10000);',
                                `  setTimeout(() => process.kill(process.ppid, '${signal}'), 100);`,
                                '  await new Promise(() => undefined);',
                                '  clearInterval(keepAlive);',
                                '  return 0;',
                                '}',
                            ].join('\n'),
                        ],
                    ]),
                })
            ).rejects.toThrow(`trusted snapshot terminated by ${signal}`);
        }
    );
});
