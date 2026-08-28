import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
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
import { createInterface } from 'node:readline';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import { coordinateDelivery, withPullRequestDeliveryLock } from '../deliverPullRequest.ts';
import { AUTHOR_BOT_NODE_ID } from '../githubAppIdentity.ts';
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

function initializeDeliveryLockRepository(root: string): void {
    runGit(root, ['init', '--quiet']);
}

function deliveryLockRef(number: number): string {
    return `refs/sourdaw/delivery/pr-${number}`;
}

function writeDeliveryLockOwner(root: string, number: number, contents: string): string {
    const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: root,
        encoding: 'utf8',
        input: contents,
    }).trim();
    runGit(root, ['update-ref', deliveryLockRef(number), oid]);
    return oid;
}

function readDeliveryLockOid(root: string, number: number): string {
    return runGit(root, ['rev-parse', '--verify', deliveryLockRef(number)]);
}

function deliveryLockExists(root: string, number: number): boolean {
    try {
        readDeliveryLockOid(root, number);
        return true;
    } catch {
        return false;
    }
}

async function contendForDeliveryLock(root: string): Promise<string[]> {
    const moduleUrl = new URL('../deliverPullRequest.ts', import.meta.url).href;
    const childSource = `
import { createInterface } from 'node:readline';
import { withPullRequestDeliveryLock } from ${JSON.stringify(moduleUrl)};

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const commands = input[Symbol.asyncIterator]();
console.log('ready');
await commands.next();
try {
    await withPullRequestDeliveryLock(${JSON.stringify(root)}, 2495, async () => {
        console.log('entered');
        await commands.next();
    });
    console.log('released');
} catch (error) {
    console.log('refused:' + (error instanceof Error ? error.message : String(error)));
} finally {
    input.close();
}
`;
    const startContender = () => {
        const child = spawn(
            process.execPath,
            ['--no-warnings', '--experimental-strip-types', '--input-type=module', '--eval', childSource],
            { stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
        return { child, lines, exited: once(child, 'exit') };
    };
    const contenders = [startContender(), startContender()];

    try {
        const ready = await Promise.all(contenders.map(({ lines }) => lines.next()));
        expect(ready.map((line) => line.value)).toEqual(['ready', 'ready']);
        for (const contender of contenders) {
            contender.child.stdin.write('go\n');
        }

        const outcomes = await Promise.all(contenders.map(({ lines }) => lines.next()));
        const values = outcomes.map((line) => line.value ?? '');
        const winner = contenders[values.findIndex((value) => value === 'entered')];
        expect(winner).toBeDefined();
        winner?.child.stdin.write('release\n');
        expect((await winner?.lines.next())?.value).toBe('released');
        for (const contender of contenders) {
            contender.child.stdin.end();
        }
        const exits = await Promise.all(contenders.map(({ exited }) => exited));
        expect(exits.map(([code]) => code)).toEqual([0, 0]);
        return values;
    } finally {
        for (const contender of contenders) {
            contender.child.kill();
        }
    }
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

/**
 * Runs `deliver` through the launcher with one poisoned executed source and answers with the
 * refusal. Nothing may execute: a rule that refuses only once the command has started refuses
 * nothing, because `ERR_MODULE_NOT_FOUND` has already killed the delivery by then.
 */
async function snapshotRefusalFor(poisoned: string): Promise<string> {
    let executed = false;
    const run = runTrustedGithubWriteCommand('deliver', ['42'], {
        resolveOriginMain: () => 'trusted-sha',
        readOriginSource: (_commit, candidate) =>
            candidate === 'scripts/deliverPullRequest.ts' ? poisoned : 'trusted',
        executeSnapshot: async () => {
            executed = true;
            return 0;
        },
    });
    const refusal = await run.then(
        () => 'no refusal',
        (error: unknown) => String(error)
    );
    expect(executed).toBe(false);
    return refusal;
}

function runTrustedDeliverWithLoader(loader: string): Promise<number> {
    return runTrustedGithubWriteCommand('deliver', ['42'], {
        resolveOriginMain: () => 'trusted-sha',
        readOriginSource: (_commit, candidate) => (candidate === BOOTSTRAP_PATH ? loader : 'trusted'),
        executeSnapshot: async () => 0,
    });
}

type WorkflowRecord = Record<string, unknown>;

const AUTHORIZED_APPROVAL_CONDITION =
    "github.event_name != 'pull_request_review' || github.event.review.state == 'approved'";
const REVIEW_ISOLATED_CONCURRENCY_GROUP = 'health-gates-${{ github.event.pull_request.number || github.ref }}';
const AUTHORIZED_CANCELLATION_CONDITION = "${{ github.event_name == 'pull_request' }}";
const GATE_SUMMARY_NAME = 'Gate';
const AUTHORIZED_GATE_CONDITION = 'always()';
const CODEQL_CONDITION = "needs.decide.outputs.heavy == 'true'";

function asWorkflowRecord(value: unknown, label: string): WorkflowRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be a mapping`);
    }
    return value as WorkflowRecord;
}

function workflowRecordAt(record: WorkflowRecord, key: string): WorkflowRecord {
    return asWorkflowRecord(record[key], key);
}

function workflowArrayAt(record: WorkflowRecord, key: string): unknown[] {
    const value = record[key];
    if (!Array.isArray(value)) {
        throw new TypeError(`${key} must be an array`);
    }
    return value;
}

function workflowJob(candidate: WorkflowRecord, name: string): WorkflowRecord {
    return workflowRecordAt(workflowRecordAt(candidate, 'jobs'), name);
}

function workflowStep(owner: WorkflowRecord, name: string): WorkflowRecord {
    const step = workflowArrayAt(owner, 'steps').find(
        (candidate: unknown) => asWorkflowRecord(candidate, 'step').name === name
    );
    if (step === undefined) {
        throw new Error(`missing workflow step: ${name}`);
    }
    return asWorkflowRecord(step, name);
}

function healthGateWorkflow(): { document: ReturnType<typeof parseDocument>; workflow: WorkflowRecord } {
    const source = readFileSync(join(import.meta.dirname, '../../.github/workflows/health-gates.yml'), 'utf8');
    const document = parseDocument(source);
    if (document.errors.length > 0) {
        throw new Error(
            `health-gates.yml is invalid YAML: ${document.errors.map((error) => error.message).join('; ')}`
        );
    }
    return { document, workflow: asWorkflowRecord(document.toJS(), 'workflow') };
}

function stableInformationalGateSummary(workflow: WorkflowRecord): WorkflowRecord {
    for (const [jobId, value] of Object.entries(workflowRecordAt(workflow, 'jobs'))) {
        const name = asWorkflowRecord(value, jobId).name;
        if (typeof name !== 'string') {
            throw new TypeError(`${jobId} name must be a string`);
        }
        if (/\$\{\{\s*github\.(?:event|ref)/.test(name)) {
            throw new Error('workflow job check names must be event-independent');
        }
        if (jobId !== 'gate' && (name === GATE_SUMMARY_NAME || /['"]Gate['"]/.test(name))) {
            throw new Error('only the gate job may emit the stable Gate summary check name');
        }
    }
    const gate = workflowJob(workflow, 'gate');
    if (gate.name !== GATE_SUMMARY_NAME) {
        throw new Error('the gate job must emit the stable Gate summary check name');
    }
    return gate;
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

    it('keeps the informational Gate summary stable and validates job outcomes', () => {
        const { document, workflow } = healthGateWorkflow();
        expect(document.errors).toEqual([]);
        const events = workflowRecordAt(workflow, 'on');
        expect(workflowRecordAt(events, 'pull_request_review').types).toEqual(['submitted']);

        const concurrency = workflowRecordAt(workflow, 'concurrency');
        expect(concurrency.group).toBe(REVIEW_ISOLATED_CONCURRENCY_GROUP);
        expect(concurrency['cancel-in-progress']).toBe(AUTHORIZED_CANCELLATION_CONDITION);
        expect(workflowJob(workflow, 'decide').if).toBe(AUTHORIZED_APPROVAL_CONDITION);

        const gate = stableInformationalGateSummary(workflow);
        const eventDependentGate = structuredClone(workflow);
        workflowJob(eventDependentGate, 'gate').name =
            "${{ github.event_name == 'workflow_dispatch' && 'Gate' || 'Gate' }}";
        expect(() => stableInformationalGateSummary(eventDependentGate)).toThrow(
            'workflow job check names must be event-independent'
        );
        const renamedGate = structuredClone(workflow);
        workflowJob(renamedGate, 'gate').name = 'Health summary';
        expect(() => stableInformationalGateSummary(renamedGate)).toThrow(
            'the gate job must emit the stable Gate summary check name'
        );
        const duplicateGate = structuredClone(workflow);
        workflowJob(duplicateGate, 'lint').name = GATE_SUMMARY_NAME;
        expect(() => stableInformationalGateSummary(duplicateGate)).toThrow(
            'only the gate job may emit the stable Gate summary check name'
        );
        expect(gate.if).toBe(AUTHORIZED_GATE_CONDITION);
        const gateStep = workflowStep(gate, 'Require every job to have succeeded or been skipped');
        expect(workflowRecordAt(gateStep, 'env')).toEqual({ RESULTS: '${{ toJSON(needs) }}' });
    });

    it('runs CodeQL only in the approved heavy lane', () => {
        const { workflow } = healthGateWorkflow();
        const events = workflowRecordAt(workflow, 'on');
        expect(Object.hasOwn(events, 'pull_request')).toBe(true);
        expect(Object.hasOwn(events, 'pull_request_target')).toBe(false);

        const codeql = workflowJob(workflow, 'codeql');
        expect(codeql.if).toBe(CODEQL_CONDITION);
        expect(workflowRecordAt(codeql, 'permissions')).toEqual({
            contents: 'read',
            'security-events': 'write',
            actions: 'read',
        });
        expect(Object.hasOwn(workflowStep(codeql, 'Checkout'), 'if')).toBe(false);

        const analyze = workflowStep(codeql, 'Analyse');
        expect(analyze.uses).toBe('github/codeql-action/analyze@c16c0f3f2812ec4bb3750a5ed64873fe2ce0fbef');
        expect(Object.hasOwn(analyze, 'with')).toBe(false);
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

    /**
     * The snapshot is a temporary directory holding nothing but `scripts/`, so Node resolves a bare
     * specifier upward from there, finds no `node_modules`, and kills the command with
     * `ERR_MODULE_NOT_FOUND` partway through a delivery. Checking only local specifiers left that
     * failure mode invisible until it happened, which is why it is refused before anything executes.
     *
     * A bare package is named by three shapes, not one. A rule that read only a `from` clause let the
     * side-effect statement and the dynamic call straight through — and the dynamic call is the shape
     * the loader itself uses, so the rule passed on that file by never seeing its import at all.
     */
    it.each([
        {
            label: 'a bare package specifier no snapshot can resolve',
            poisoned: "import { parse } from 'yaml';",
        },
        {
            label: 'a re-exported bare package specifier',
            poisoned: "export { parse } from 'yaml';",
        },
        {
            label: 'a bare package imported for its side effects alone',
            poisoned: "import 'yaml';",
        },
        {
            label: 'a bare package reached through a dynamic import',
            poisoned: "const { parse } = await import('yaml');",
        },
    ])('refuses $label', async ({ poisoned }) => {
        expect(await snapshotRefusalFor(poisoned)).toMatch(
            /scripts\/deliverPullRequest\.ts imports yaml, which does not resolve in the trusted snapshot/
        );
    });

    it('refuses an import of the loader the snapshot never executes', async () => {
        expect(await snapshotRefusalFor("import { BOOTSTRAP_PATH } from './trustedGithubWriteBootstrap.ts';")).toMatch(
            /scripts\/deliverPullRequest\.ts imports scripts\/trustedGithubWriteBootstrap\.ts, which the trusted snapshot never executes/
        );
    });

    /**
     * The loader's exemption is one package in one file, and it is sound only because that import
     * never resolves from a snapshot: the launcher runs the loader from the protected primary
     * checkout, where the repository's packages do resolve, and the snapshot writes the loader
     * without ever importing it. The real loader is fed through the rule here rather than a fixture,
     * so widening the exemption — or letting the loader take a second package — fails.
     */
    it('exempts the loader own yaml dependency and no other bare package in it', async () => {
        const loader = readFileSync(join(import.meta.dirname, '../trustedGithubWriteBootstrap.ts'), 'utf8');

        await expect(runTrustedDeliverWithLoader(loader)).resolves.toBe(0);
        await expect(runTrustedDeliverWithLoader(`${loader}\nawait import('chalk');\n`)).rejects.toThrow(
            /scripts\/trustedGithubWriteBootstrap\.ts imports chalk, which does not resolve in the trusted snapshot/
        );
    });

    /**
     * The exemption above is only sound while the loader itself needs it, and it does: `deliver`
     * parses the gating workflow with the repository's YAML package, which no snapshot can reach.
     * Behind a dynamic call, because `lane:publish` and `issue:reconcile` read no workflow and must
     * not fail to start over a package neither one uses.
     */
    it('imports the yaml parser only from the loader, and never statically', () => {
        const loader = readFileSync(join(import.meta.dirname, '../trustedGithubWriteBootstrap.ts'), 'utf8');

        expect(loader).not.toMatch(/^import .*from ['"]yaml['"]/m);
        expect(loader).toMatch(/await import\('yaml'\)/);
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
        // The gating workflow is read at that same pinned commit, and only for `deliver`. Reading it
        // at a ref, a `HEAD`, or a second resolution would let the merge gate be decided by a commit
        // other than the one this closure was snapshotted from.
        expect(originReads).toEqual([
            ...paths.map((path) => `pinned-sha:${path}`),
            'pinned-sha:.github/workflows/health-gates.yml',
        ]);
    });

    /**
     * `lane:publish` and `issue:reconcile` decide no merge, so neither reads a workflow. A launcher
     * that read one for every command would make them fail over a file and a parser they never use.
     */
    it.each(['lane:publish', 'issue:reconcile'] as const)('reads no gating workflow for %s', async (command) => {
        const originReads: string[] = [];
        let gateWorkflow: unknown = 'unset';

        await runTrustedGithubWriteCommand(command, [], {
            resolveOriginMain: () => 'pinned-sha',
            readOriginSource: (_commit, path) => {
                originReads.push(path);
                return 'trusted';
            },
            executeSnapshot: async (_command, _args, snapshot) => {
                gateWorkflow = snapshot.gateWorkflow;
                return 0;
            },
        });

        expect(originReads).toEqual([...trustedDependencyPaths(command)]);
        expect(gateWorkflow).toBeUndefined();
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

    it('should import the snapshot entry without direct execution and invoke its runner once with exact args', async () => {
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-entry-import-'));
        const recordPath = join(fixtureRoot, 'invocations.jsonl');
        const callerArgs = ['2495', '--label', 'value with spaces', recordPath];
        try {
            await expect(
                executeTrustedSnapshot('deliver', callerArgs, {
                    commit: 'pinned-sha',
                    sources: new Map([
                        [
                            'scripts/deliverPullRequest.ts',
                            [
                                "import { appendFileSync } from 'node:fs';",
                                "import { fileURLToPath } from 'node:url';",
                                'const recordPath = process.argv.at(-1);',
                                "if (recordPath === undefined) throw new Error('missing invocation record path');",
                                "if (process.argv[1] === fileURLToPath(import.meta.url)) appendFileSync(recordPath, `${JSON.stringify({ kind: 'direct' })}\\n`);",
                                "export async function runDeliverCli(args) { appendFileSync(recordPath, `${JSON.stringify({ kind: 'runner', args })}\\n`); return 0; }",
                            ].join('\n'),
                        ],
                    ]),
                })
            ).resolves.toBe(0);

            expect(readFileSync(recordPath, 'utf8')).toBe(`${JSON.stringify({ kind: 'runner', args: callerArgs })}\n`);
        } finally {
            rmSync(fixtureRoot, { recursive: true, force: true });
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
                        `export async function runPublishLaneCli(args) {
    return args.length === 3
        && args[0] === '12'
        && args[1] === '--test'
        && args[2] === 'Run the focused publisher specs and confirm they pass.'
        ? 0
        : 1;
}
`,
                    ],
                ]),
            })
        ).resolves.toBe(0);
    });

    it('refuses a live delivery owner before authentication or delivery starts', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);
        const entered: string[] = [];
        const dependencies: DeliveryCoordinatorDependencies = {
            primaryRoot: () => root,
            serializeDelivery: withPullRequestDeliveryLock,
            authenticateAuthor: async () => {
                entered.push('authenticate');
                throw new Error('authentication should not start');
            },
            authenticateTracker: async () => expect.fail('tracker authentication should not start'),
            repositoryName: () => expect.fail('repository lookup should not start'),
            deliveryPort: () => expect.fail('delivery port should not be created'),
            trackerPort: () => expect.fail('tracker port should not be created'),
            completeIssue: () => expect.fail('tracker completion should not start'),
            deliver: () => {
                entered.push('deliver');
            },
        };

        try {
            await withPullRequestDeliveryLock(root, 2495, async () => {
                await expect(coordinateDelivery(2495, dependencies)).rejects.toThrow(/already being delivered/);
            });
            expect(entered).toEqual([]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('leaves malformed primary-lock bytes untouched and starts no authentication or operation', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        const malformed = '{"pid":"not-a-number"}';
        initializeDeliveryLockRepository(root);
        const originalOid = writeDeliveryLockOwner(root, 2495, malformed);
        const entered: string[] = [];
        const dependencies: DeliveryCoordinatorDependencies = {
            primaryRoot: () => root,
            serializeDelivery: withPullRequestDeliveryLock,
            authenticateAuthor: async () => {
                entered.push('authenticate');
                throw new Error('authentication should not start');
            },
            authenticateTracker: async () => expect.fail('tracker authentication should not start'),
            repositoryName: () => expect.fail('repository lookup should not start'),
            deliveryPort: () => expect.fail('delivery port should not be created'),
            trackerPort: () => expect.fail('tracker port should not be created'),
            completeIssue: () => expect.fail('tracker completion should not start'),
            deliver: () => {
                entered.push('deliver');
            },
        };

        try {
            await expect(coordinateDelivery(2495, dependencies)).rejects.toThrow(/ownership is malformed/);
            expect(entered).toEqual([]);
            expect(readDeliveryLockOid(root, 2495)).toBe(originalOid);
            expect(runGit(root, ['cat-file', 'blob', originalOid])).toBe(malformed);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('fails closed without changing current or stale owner blobs that carry an extra key', async () => {
        const deadProcess = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
        expect(deadProcess.status).toBe(0);
        for (const pid of [process.pid, deadProcess.pid]) {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
            initializeDeliveryLockRepository(root);
            const contents = JSON.stringify({
                version: 1,
                pid,
                token: '00000000-0000-4000-8000-000000000001',
                extra: true,
            });
            const originalOid = writeDeliveryLockOwner(root, 2495, contents);
            let entered = false;

            try {
                await expect(
                    withPullRequestDeliveryLock(root, 2495, async () => {
                        entered = true;
                    })
                ).rejects.toThrow(/ownership is malformed/);
                expect(entered).toBe(false);
                expect(readDeliveryLockOid(root, 2495)).toBe(originalOid);
                expect(runGit(root, ['cat-file', 'blob', originalOid])).toBe(contents);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }
    });

    it('reclaims one well-formed lock whose owner process is conclusively dead', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);
        const deadProcess = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
        expect(deadProcess.status).toBe(0);
        expect(deadProcess.pid).toBeTypeOf('number');
        writeDeliveryLockOwner(
            root,
            2495,
            JSON.stringify({ version: 1, pid: deadProcess.pid, token: '00000000-0000-4000-8000-000000000001' })
        );
        let delivered = false;

        try {
            await withPullRequestDeliveryLock(root, 2495, async () => {
                delivered = true;
            });
            expect(delivered).toBe(true);
            expect(deliveryLockExists(root, 2495)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('admits exactly one simultaneous contender for a dead owner', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);
        const deadProcess = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
        expect(deadProcess.status).toBe(0);
        writeDeliveryLockOwner(
            root,
            2495,
            JSON.stringify({ version: 1, pid: deadProcess.pid, token: '00000000-0000-4000-8000-000000000001' })
        );

        try {
            const values = await contendForDeliveryLock(root);
            expect(values.filter((value) => value === 'entered')).toHaveLength(1);
            expect(values.filter((value) => value.startsWith('refused:'))).toHaveLength(1);
            expect(deliveryLockExists(root, 2495)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 10_000);

    it('releases the current delivery token after success and failure', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);

        try {
            await withPullRequestDeliveryLock(root, 2495, async () => undefined);
            expect(deliveryLockExists(root, 2495)).toBe(false);

            await expect(
                withPullRequestDeliveryLock(root, 2495, async () => {
                    throw new Error('delivery failed');
                })
            ).rejects.toThrow('delivery failed');
            expect(deliveryLockExists(root, 2495)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('does not release a delivery lock whose ownership token changed', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);
        let replacementOid = '';

        try {
            await expect(
                withPullRequestDeliveryLock(root, 2495, async () => {
                    replacementOid = writeDeliveryLockOwner(
                        root,
                        2495,
                        JSON.stringify({
                            version: 1,
                            pid: process.pid,
                            token: '00000000-0000-4000-8000-000000000002',
                        })
                    );
                })
            ).rejects.toThrow(/ownership changed before release/);
            expect(readDeliveryLockOid(root, 2495)).toBe(replacementOid);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('keeps per-PR owners isolated without releasing the wrong delivery', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);

        try {
            await withPullRequestDeliveryLock(root, 2495, async () => {
                await withPullRequestDeliveryLock(root, 2496, async () => undefined);
                expect(deliveryLockExists(root, 2495)).toBe(true);
                expect(deliveryLockExists(root, 2496)).toBe(false);
                await expect(withPullRequestDeliveryLock(root, 2495, async () => undefined)).rejects.toThrow(
                    /already being delivered/
                );
                expect(deliveryLockExists(root, 2495)).toBe(true);
            });
            expect(deliveryLockExists(root, 2495)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('admits exactly one fresh process while a same-PR contender is held at the lock boundary', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);

        try {
            const values = await contendForDeliveryLock(root);
            expect(values.filter((value) => value === 'entered')).toHaveLength(1);
            expect(
                values.filter((value) => value.startsWith('refused:PR #2495 is already being delivered'))
            ).toHaveLength(1);
            expect(deliveryLockExists(root, 2495)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 10_000);

    it('wires PR operations and the regular-issue adapter to distinct least-privilege sessions', async () => {
        const disposed: string[] = [];
        const authentication = (token: string, permissions: Record<string, string>): DeliveryAuthentication => ({
            minted: { token, login: 'renamed-author[bot]', actorNodeId: AUTHOR_BOT_NODE_ID, permissions },
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
            gateRequiredCheckNames: () => expect.fail('delivery domain should be injected in this coordinator test'),
            headCheckRuns: () => expect.fail('delivery domain should be injected in this coordinator test'),
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
            serializeDelivery: async (_primaryRoot, number, operation) => {
                seen.push(`lock:${number}:acquire`);
                try {
                    await operation();
                } finally {
                    seen.push(`lock:${number}:release`);
                }
            },
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
            'lock:2495:acquire',
            'repository:ghs_author',
            'tracker:ghs_tracker',
            'delivery:ghs_author',
            `complete:${AUTHOR_BOT_NODE_ID}`,
            'lock:2495:release',
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
