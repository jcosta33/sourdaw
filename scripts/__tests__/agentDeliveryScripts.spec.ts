import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { coordinateDelivery } from '../deliverPullRequest.ts';
import { runTrustedGithubWriteCommand, trustedDependencyPaths } from '../trustedGithubWriteBootstrap.ts';

import type { DeliveryAuthentication, DeliveryCoordinatorDependencies, DeliveryPort } from '../deliverPullRequest.ts';
import type { ReconcileTrackerIssuePort } from '../trackerIssueReconciliation.ts';

describe('package scripts and gitignore', () => {
    it('defines the trusted pnpm commands as direct node invocations', () => {
        const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        expect(pkg.scripts['lane:open']).toBe('node scripts/openLane.ts');
        expect(pkg.scripts['lane:publish']).toBe('node scripts/publishLane.ts');
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
        for (const changedPath of paths) {
            let loaded = false;
            await expect(
                runTrustedGithubWriteCommand('deliver', ['42'], {
                    readSource: (candidate) => (candidate === changedPath ? 'mutated' : 'trusted'),
                    originMainSource: () => 'trusted',
                    loadCommand: async () => {
                        loaded = true;
                        return async () => 0;
                    },
                })
            ).rejects.toThrow(new RegExp(changedPath.replaceAll('.', '\\.')));
            expect(loaded).toBe(false);
        }

        let loadedUncheckedDependency = false;
        const sourceFor = (candidate: string) =>
            candidate === 'scripts/deliverPullRequest.ts' ? "import './unchecked.ts';" : 'trusted';
        await expect(
            runTrustedGithubWriteCommand('deliver', ['42'], {
                readSource: sourceFor,
                originMainSource: sourceFor,
                loadCommand: async () => {
                    loadedUncheckedDependency = true;
                    return async () => 0;
                },
            })
        ).rejects.toThrow(/imports unchecked local dependency scripts\/unchecked\.ts/);
        expect(loadedUncheckedDependency).toBe(false);
    });

    it('wires PR operations and tracker operations to distinct least-privilege sessions', async () => {
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
        const trackerPort: ReconcileTrackerIssuePort = {
            withMutationLease: (operation) => operation(),
            inspect: () => expect.fail('completion should be injected in this coordinator test'),
            update: () => expect.fail('completion should be injected in this coordinator test'),
            comment: () => expect.fail('completion should be injected in this coordinator test'),
            log: () => undefined,
        };
        const seen: string[] = [];
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
                return trackerPort;
            },
            completeIssue: (_issue, login, port) => {
                expect(port).toBe(trackerPort);
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
        expect(disposed).toEqual(['ghs_tracker', 'ghs_author']);
    });
});
