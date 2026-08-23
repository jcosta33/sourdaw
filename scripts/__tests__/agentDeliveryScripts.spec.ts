import { execFileSync } from 'node:child_process';
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
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { coordinateDelivery } from '../deliverPullRequest.ts';
import { githubTrackerIssuePort } from '../reconcileTrackerIssue.ts';
import {
    BOOTSTRAP_PATH,
    executeTrustedSnapshot,
    resolveTrustedLauncherBinding,
    runTrustedGithubWriteCommand,
    trustedGitReadEnv,
    trustedDependencyPaths,
    trustedSnapshotEnv,
} from '../trustedGithubWriteBootstrap.ts';

import type { DeliveryAuthentication, DeliveryCoordinatorDependencies, DeliveryPort } from '../deliverPullRequest.ts';
import type { ReconcileTrackerIssuePort } from '../trackerIssueReconciliation.ts';

function runGit(repository: string, args: string[]): string {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    return execFileSync('git', args, { cwd: repository, env, encoding: 'utf8' }).trim();
}

function runPackageRoute(repository: string, args: string[]): string {
    const pnpmCli = process.env.npm_execpath;
    if (!pnpmCli) {
        throw new Error('The package-route fixture requires the active pnpm CLI path');
    }
    return execFileSync(process.execPath, [pnpmCli, ...args], {
        cwd: repository,
        env: process.env,
        encoding: 'utf8',
        timeout: 5_000,
    });
}

function trustedPublishFixture(root: string, policy: string): void {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
            type: 'module',
            private: true,
            scripts: { 'lane:publish': 'node scripts/trustedGithubWriteBootstrap.ts lane:publish' },
        })
    );
    writeFileSync(
        join(root, 'scripts/trustedGithubWriteBootstrap.ts'),
        readFileSync(join(import.meta.dirname, '../trustedGithubWriteBootstrap.ts'), 'utf8')
    );
    writeFileSync(
        join(root, 'scripts/publishLane.ts'),
        "import { appendFileSync } from 'node:fs';\n" +
            "import { publishingPermission } from './githubAppIdentity.ts';\n" +
            `export async function runPublishLaneCli(args) { appendFileSync(args.at(-1), ${JSON.stringify(policy)} + ':' + publishingPermission + '\\n'); return 0; }\n`
    );
    writeFileSync(join(root, 'scripts/githubAppIdentity.ts'), 'export const publishingPermission = "ordinary";\n');
    writeFileSync(join(root, 'scripts/prContract.ts'), 'export {};\n');
    runGit(root, ['init', '-b', 'main']);
    runGit(root, ['config', 'user.name', 'Fixture']);
    runGit(root, ['config', 'user.email', 'fixture@example.com']);
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '--no-gpg-sign', '-m', 'test: trusted publishing fixture']);
    runGit(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
}

describe('package scripts and gitignore', () => {
    it('defines the trusted pnpm commands as direct node invocations', () => {
        const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        expect(pkg.scripts['lane:open']).toBe('node scripts/openLane.ts');
        expect(pkg.scripts['lane:publish']).toBe('node scripts/trustedGithubWriteBootstrap.ts lane:publish');
        expect(pkg.scripts['review:prepare']).toBe('node scripts/prepareReview.ts');
        expect(pkg.scripts['review:publish']).toBe('node scripts/publishReview.ts');
        expect(pkg.scripts['review:resolve']).toBe('node scripts/resolveReviewThread.ts');
        expect(pkg.scripts['pr:supersede']).toBe('node scripts/supersedePullRequest.ts');
        expect(pkg.scripts['issue:reconcile']).toBe('node scripts/trustedGithubWriteBootstrap.ts issue:reconcile');
        expect(pkg.scripts['lane:remove']).toBe('node scripts/removeLane.ts');
        expect(pkg.scripts.deliver).toBe('node scripts/trustedGithubWriteBootstrap.ts deliver');
    });

    it('ignores role credential files and review bundles', () => {
        const gitignore = readFileSync(join(import.meta.dirname, '../../.gitignore'), 'utf8');
        expect(gitignore).toContain('.env.*');
        expect(gitignore).toContain('.agents/review-bundles/');
    });

    /**
     * `lane:publish` opens the pull request and `deliver` merges it, and a base the two disagree
     * about is a squash onto a branch nobody reviewed against. Neither may carry its own literal.
     */
    it('opens and merges every pull request against the one trunk constant', () => {
        const identity = readFileSync(join(import.meta.dirname, '../githubAppIdentity.ts'), 'utf8');
        expect(identity).toMatch(/export const REQUIRED_BASE_BRANCH = 'main';/);
        const publish = readFileSync(join(import.meta.dirname, '../publishLane.ts'), 'utf8');
        expect(publish).toMatch(/'--base',\s+REQUIRED_BASE_BRANCH,/);
        const deliver = readFileSync(join(import.meta.dirname, '../deliverPullRequest.ts'), 'utf8');
        expect(deliver).toMatch(/baseRefName !== REQUIRED_BASE_BRANCH/);
    });

    it('does not spawn a language-model CLI from the trusted scripts', () => {
        const files = [
            'openLane.ts',
            'publishLane.ts',
            'prepareReview.ts',
            'publishReview.ts',
            'deliverPullRequest.ts',
            'removeLane.ts',
            'resolveReviewThread.ts',
            'supersedePullRequest.ts',
            'reconcileTrackerIssue.ts',
            'trackerIssueReconciliation.ts',
            'trustedGithubWriteBootstrap.ts',
            'githubAppIdentity.ts',
        ];
        for (const file of files) {
            const source = readFileSync(join(import.meta.dirname, '..', file), 'utf8');
            expect(source).not.toMatch(/spawnSync\(\s*['"]claude/);
            expect(source).not.toMatch(/spawnSync\(\s*['"]codex/);
            expect(source).not.toMatch(/spawnSync\(\s*['"]cursor/);
        }
    });

    it('routes mutation commands through a self-contained trusted-source bootstrap', async () => {
        const path = join(import.meta.dirname, '../trustedGithubWriteBootstrap.ts');
        expect(existsSync(path)).toBe(true);
        const source = readFileSync(path, 'utf8');
        expect(source).not.toMatch(/^import .*from ['"]\./m);

        const paths = trustedDependencyPaths('deliver');
        expect(paths).toEqual([
            'scripts/trustedGithubWriteBootstrap.ts',
            'scripts/deliverPullRequest.ts',
            'scripts/reconcileTrackerIssue.ts',
            'scripts/trackerIssueReconciliation.ts',
            'scripts/githubAppIdentity.ts',
            'scripts/prContract.ts',
        ]);
        // A lane holding a different copy of any executed script — mutated, or
        // simply older than main — still delivers, and still runs main's code.
        // Every source handed to the snapshot comes from the pinned origin
        // commit, and the port exposes no way to read the lane's copy at all.
        // This says nothing about the loader itself, which `package.json`
        // resolves from the working tree and no snapshot imports.
        let executedSources: ReadonlyMap<string, string> | undefined;
        const exitCode = await runTrustedGithubWriteCommand('deliver', ['42'], {
            resolveOriginMain: () => 'trusted-sha',
            readOriginSource: (commit, candidate) => {
                expect(commit).toBe('trusted-sha');
                return `origin:${candidate}`;
            },
            executeSnapshot: async (_command, _args, snapshot) => {
                executedSources = snapshot.sources;
                return 0;
            },
        });

        expect(exitCode).toBe(0);
        expect([...(executedSources ?? new Map())]).toEqual(paths.map((path) => [path, `origin:${path}`]));

        let executedUncheckedDependency = false;
        await expect(
            runTrustedGithubWriteCommand('deliver', ['42'], {
                resolveOriginMain: () => 'trusted-sha',
                readOriginSource: (_commit, candidate) =>
                    candidate === 'scripts/deliverPullRequest.ts' ? "import './unchecked.ts';" : 'trusted',
                executeSnapshot: async () => {
                    executedUncheckedDependency = true;
                    return 0;
                },
            })
        ).rejects.toThrow(/imports unchecked local dependency scripts\/unchecked\.ts/);
        expect(executedUncheckedDependency).toBe(false);
    });

    it('runs the package route only from the protected primary root and snapshots modified helpers', () => {
        expect(trustedDependencyPaths('lane:publish')).toEqual([
            'scripts/trustedGithubWriteBootstrap.ts',
            'scripts/publishLane.ts',
            'scripts/githubAppIdentity.ts',
            'scripts/prContract.ts',
        ]);
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-package-'));
        const checkout = join(fixtureRoot, 'checkout');
        const lane = join(fixtureRoot, 'lane');
        const policyLog = join(fixtureRoot, 'policy.log');
        mkdirSync(checkout);
        try {
            trustedPublishFixture(checkout, 'checkout');
            writeFileSync(
                join(checkout, 'scripts/githubAppIdentity.ts'),
                'export const publishingPermission = "workflow-write";\n'
            );

            runPackageRoute(checkout, ['lane:publish', policyLog]);

            expect(readFileSync(policyLog, 'utf8')).toBe('checkout:ordinary\n');

            writeFileSync(
                join(checkout, 'scripts/trustedGithubWriteBootstrap.ts'),
                `${readFileSync(join(checkout, 'scripts/trustedGithubWriteBootstrap.ts'), 'utf8')}\n// lane-local drift\n`
            );
            expect(() => runPackageRoute(checkout, ['lane:publish', policyLog])).toThrow(
                /protected primary launcher does not match/
            );

            runGit(checkout, ['restore', 'scripts/trustedGithubWriteBootstrap.ts']);
            runGit(checkout, ['worktree', 'add', '-b', 'agent/test/current-route', lane]);
            expect(() => runPackageRoute(lane, ['lane:publish', policyLog])).toThrow(/protected primary checkout/);
        } finally {
            rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    }, 15_000);

    it('publishes a pre-migration lane through the primary package without executing its package route', () => {
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-primary-lane-route-'));
        const primary = join(fixtureRoot, 'primary');
        const lane = join(fixtureRoot, 'old-lane');
        const policyLog = join(fixtureRoot, 'policy.log');
        const poisonLog = join(fixtureRoot, 'poison.log');
        try {
            trustedPublishFixture(primary, 'primary');
            runGit(primary, ['worktree', 'add', '-b', 'agent/old-lane', lane]);
            writeFileSync(join(primary, 'main-advanced.txt'), 'new launcher-era main\n');
            runGit(primary, ['add', 'main-advanced.txt']);
            runGit(primary, ['commit', '--no-gpg-sign', '-m', 'test: advance main past old lane']);
            runGit(primary, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
            writeFileSync(
                join(lane, 'package.json'),
                JSON.stringify({
                    type: 'module',
                    private: true,
                    scripts: { 'lane:publish': 'node poison.mjs' },
                })
            );
            writeFileSync(
                join(lane, 'poison.mjs'),
                `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(poisonLog)}, 'entered');\n`
            );

            runPackageRoute(primary, ['lane:publish', '--lane', lane, policyLog]);

            expect(readFileSync(policyLog, 'utf8')).toBe('primary:ordinary\n');
            expect(existsSync(poisonLog)).toBe(false);
        } finally {
            rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it('resolves the trusted snapshot with no inherited Git or GitHub routing', () => {
        const env = trustedGitReadEnv({
            PATH: '/usr/bin',
            GIT_DIR: '/hostile/.git',
            GIT_WORK_TREE: '/hostile',
            GH_TOKEN: 'personal',
            GITHUB_TOKEN: 'actions',
            SOURDAW_GITHUB_APP_PRIVATE_KEY: 'secret',
            SOURDAW_TRUSTED_REPOSITORY_ROOT: '/repo',
            NODE_OPTIONS: '--import=/hostile/preload.mjs',
            NODE_PATH: '/hostile/modules',
        });

        expect(env.GIT_DIR).toBeUndefined();
        expect(env.GIT_WORK_TREE).toBeUndefined();
        expect(env.GH_TOKEN).toBeUndefined();
        expect(env.GITHUB_TOKEN).toBeUndefined();
        expect(env.SOURDAW_GITHUB_APP_PRIVATE_KEY).toBeUndefined();
        expect(env.SOURDAW_TRUSTED_REPOSITORY_ROOT).toBeUndefined();
        expect(env.NODE_OPTIONS).toBeUndefined();
        expect(env.NODE_PATH).toBeUndefined();
        expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
        expect(env.GIT_CONFIG_SYSTEM).toBe('/dev/null');
    });

    it('does not enter inherited Node preloads or child PATH shims', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-child-env-'));
        const preloadMarker = join(root, 'preload-entered');
        const pathMarker = join(root, 'path-entered');
        const preload = join(root, 'preload.mjs');
        const hostileBin = join(root, 'hostile-bin');
        const hostileGit = join(hostileBin, 'git');
        const previousNodeOptions = process.env.NODE_OPTIONS;
        const previousPath = process.env.PATH;
        try {
            mkdirSync(hostileBin);
            writeFileSync(
                preload,
                `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(preloadMarker)}, 'entered');\n`
            );
            writeFileSync(hostileGit, `#!/bin/sh\nprintf entered > ${JSON.stringify(pathMarker)}\nexit 91\n`);
            chmodSync(hostileGit, 0o700);
            process.env.NODE_OPTIONS = `--import=${preload}`;
            process.env.PATH = `${hostileBin}:${previousPath ?? ''}`;
            const gitPath = execFileSync('/usr/bin/which', ['git'], {
                encoding: 'utf8',
                env: { ...process.env, PATH: previousPath },
            }).trim();
            const ghPath = execFileSync('/usr/bin/which', ['gh'], {
                encoding: 'utf8',
                env: { ...process.env, PATH: previousPath },
            }).trim();
            const snapshot = {
                commit: 'a'.repeat(40),
                sources: new Map([
                    [
                        'scripts/deliverPullRequest.ts',
                        "import { spawnSync } from 'node:child_process'; export async function runDeliverCli() { const result = spawnSync('git', ['--version']); return result.status ?? 1; }",
                    ],
                ]),
                launcher: {
                    primaryRoot: '/repo',
                    commonDir: '/repo/.git',
                    gitPath,
                    ghPath,
                },
            };

            expect(trustedSnapshotEnv(snapshot).NODE_OPTIONS).toBeUndefined();
            await expect(executeTrustedSnapshot('deliver', [], snapshot)).resolves.toBe(0);
            expect(existsSync(preloadMarker)).toBe(false);
            expect(existsSync(pathMarker)).toBe(false);
        } finally {
            if (previousNodeOptions === undefined) {
                delete process.env.NODE_OPTIONS;
            } else {
                process.env.NODE_OPTIONS = previousNodeOptions;
            }
            process.env.PATH = previousPath;
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('pins one origin commit and executes only that snapshot while origin advances', async () => {
        const paths = trustedDependencyPaths('deliver');
        const trusted = new Map(paths.map((path) => [path, `trusted:${path}`]));
        const originReads: string[] = [];
        let resolves = 0;
        let liveOrigin = 'pinned-sha';

        const result = await runTrustedGithubWriteCommand('deliver', ['2495'], {
            resolveOriginMain: () => {
                resolves += 1;
                const resolved = liveOrigin;
                liveOrigin = 'advanced-sha';
                return resolved;
            },
            readOriginSource: (commit, path) => {
                expect(liveOrigin).toBe('advanced-sha');
                originReads.push(`${commit}:${path}`);
                return trusted.get(path) ?? '';
            },
            executeSnapshot: async (command, args, snapshot) => {
                expect(command).toBe('deliver');
                expect(args).toEqual(['2495']);
                expect(snapshot.commit).toBe('pinned-sha');
                expect(snapshot.sources).toEqual(trusted);
                return 17;
            },
        });

        expect(result).toBe(17);
        expect(resolves).toBe(1);
        expect(originReads).toEqual(paths.map((path) => `pinned-sha:${path}`));
    });

    it('binds the launcher to the primary checkout instead of a worktree alias', () => {
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-launcher-root-'));
        const primary = join(fixtureRoot, 'primary');
        const lane = join(fixtureRoot, 'lane');
        try {
            trustedPublishFixture(primary, 'primary');
            runGit(primary, ['worktree', 'add', '-b', 'agent/test/launcher', lane]);

            expect(resolveTrustedLauncherBinding(primary).primaryRoot).toBe(realpathSync(primary));
            expect(() => resolveTrustedLauncherBinding(lane)).toThrow(/protected primary checkout/);
        } finally {
            rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });

    it('keeps the loader inside its own trusted closure', () => {
        for (const command of ['deliver', 'issue:reconcile', 'lane:publish'] as const) {
            expect(trustedDependencyPaths(command)).toContain(BOOTSTRAP_PATH);
        }
    });

    it('cleans the exact-byte snapshot tree after success and failure', async () => {
        await expect(
            executeTrustedSnapshot('deliver', ['2495'], {
                commit: 'pinned-sha',
                sources: new Map([
                    [
                        'scripts/deliverPullRequest.ts',
                        "export async function runDeliverCli(args) { return args[0] === '2495' ? 0 : 1; }",
                    ],
                ]),
            })
        ).resolves.toBe(0);

        let snapshotDirectory = '';
        const execute = (fail: boolean) =>
            executeTrustedSnapshot(
                'deliver',
                ['2495'],
                {
                    commit: 'pinned-sha',
                    sources: new Map([['scripts/deliverPullRequest.ts', 'trusted delivery bytes']]),
                },
                async (entryPath) => {
                    snapshotDirectory = dirname(dirname(entryPath));
                    expect(readFileSync(entryPath, 'utf8')).toBe('trusted delivery bytes');
                    if (fail) {
                        throw new Error('command failed');
                    }
                    return 23;
                }
            );

        await expect(execute(false)).resolves.toBe(23);
        expect(existsSync(snapshotDirectory)).toBe(false);
        await expect(execute(true)).rejects.toThrow('command failed');
        expect(existsSync(snapshotDirectory)).toBe(false);
    });

    it('passes the exact publisher argv tuple into the trusted snapshot runner', async () => {
        const expectedArgs = ['12', '--test', 'Run the focused publisher specs and confirm they pass.'];
        await expect(
            executeTrustedSnapshot('lane:publish', expectedArgs, {
                commit: 'pinned-sha',
                sources: new Map([
                    [
                        'scripts/publishLane.ts',
                        `export async function runPublishLaneCli(args) { return JSON.stringify(args) === ${JSON.stringify(JSON.stringify(expectedArgs))} ? 0 : 1; }`,
                    ],
                ]),
            })
        ).resolves.toBe(0);
    });

    it('wires PR operations and the regular-issue adapter to distinct least-privilege sessions', async () => {
        const disposed: string[] = [];
        const authentication = (token: string, permissions: Record<string, string>): DeliveryAuthentication => ({
            minted: { token, login: 'jcosta33-author[bot]', permissions },
            session: {
                configDir: `/${token}`,
                env: { GH_TOKEN: token },
                dispose: () => disposed.push(token),
            },
        });
        const author = authentication('ghs_author', { contents: 'write', pull_requests: 'write' });
        const tracker = authentication('ghs_tracker', { issues: 'write' });
        const deliveryPort: DeliveryPort = {
            fetch: () => undefined,
            pullRequest: () => expect.fail('delivery domain should be injected in this coordinator test'),
            reviewState: () => expect.fail('delivery domain should be injected in this coordinator test'),
            dependents: () => [],
            repositoryDeletesMergedBranches: () => false,
            merge: () => undefined,
            retarget: () => undefined,
            deliveryReceipts: () => [],
            addDeliveryReceipt: () => expect.fail('delivery domain should be injected in this coordinator test'),
            log: () => undefined,
        };
        const seen: string[] = [];
        const adapterRequests: Array<{ args: string[]; token: string }> = [];
        let trackerPort: ReconcileTrackerIssuePort | undefined;
        const dependencies: DeliveryCoordinatorDependencies = {
            primaryRoot: () => '/repo',
            authenticateAuthor: async () => author,
            authenticateTracker: async () => tracker,
            repositoryName: (session) => {
                seen.push(`repository:${session.env.GH_TOKEN ?? ''}`);
                return 'jcosta33/sourdaw';
            },
            deliveryPort: (_repository, auth) => {
                seen.push(`delivery:${auth.session.env.GH_TOKEN ?? ''}`);
                return deliveryPort;
            },
            trackerPort: (session) => {
                seen.push(`tracker:${session.env.GH_TOKEN ?? ''}`);
                trackerPort = githubTrackerIssuePort(
                    (args) => {
                        adapterRequests.push({ args, token: session.env.GH_TOKEN ?? '' });
                        if (args.includes('--paginate')) {
                            return JSON.stringify([[]]);
                        }
                        return JSON.stringify({
                            node_id: 'I_2406',
                            number: 2406,
                            repository_url: 'https://api.github.com/repos/jcosta33/sourdaw',
                            state: 'closed',
                            state_reason: 'completed',
                            body: 'unchanged tracker body',
                        });
                    },
                    (operation) => operation()
                );
                return trackerPort;
            },
            completeIssue: (issue, login, port) => {
                expect(port).toBe(trackerPort);
                port.update(issue, { state: 'CLOSED', stateReason: 'COMPLETED' });
                seen.push(`complete:${login}`);
            },
            deliver: (_number, port, completion) => {
                expect(port).toBe(deliveryPort);
                completion.complete(2406);
            },
        };

        await coordinateDelivery(2495, dependencies);

        expect(author.minted.permissions).toEqual({ contents: 'write', pull_requests: 'write' });
        expect(tracker.minted.permissions).toEqual({ issues: 'write' });
        expect(seen).toEqual([
            'repository:ghs_author',
            'tracker:ghs_tracker',
            'delivery:ghs_author',
            'complete:jcosta33-author[bot]',
        ]);
        expect(adapterRequests).toEqual([
            {
                args: [
                    'api',
                    '--method',
                    'PATCH',
                    'repos/jcosta33/sourdaw/issues/2406',
                    '-f',
                    'state=closed',
                    '-f',
                    'state_reason=completed',
                ],
                token: 'ghs_tracker',
            },
            {
                args: ['api', '--paginate', '--slurp', 'repos/jcosta33/sourdaw/issues/2406/comments?per_page=100'],
                token: 'ghs_tracker',
            },
        ]);
        expect(disposed).toEqual(['ghs_tracker', 'ghs_author']);
    });
});
