import { execFileSync, spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import {
    DeliveryMergeRejectedError,
    coordinateDelivery,
    deliverPullRequest,
    shellPort,
    withPullRequestDeliveryLock,
} from '../deliverPullRequest.ts';
import { AUTHOR_BOT_NODE_ID, REQUIRED_REPOSITORY, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import {
    coordinatePublishReview,
    runPublishReviewCli,
    runRecoverPublishReviewLockCli,
    type PublishReviewCoordinatorDependencies,
} from '../publishReview.ts';
import { withPullRequestReviewPublicationMutationLock } from '../pullRequestMutationLock.ts';
import { githubTrackerIssuePort } from '../reconcileTrackerIssue.ts';
import { runResolveReviewThreadCli } from '../resolveThread.ts';
import {
    BOOTSTRAP_PATH,
    assertTrustedSourceGraph,
    executeTrustedSnapshot,
    resolveTrustedLauncherBinding,
    resolveTrustedExecutable,
    runTrustedGithubWriteCommand,
    trustedGitReadEnv,
    trustedDependencyPaths,
    trustedSnapshotEnv,
} from '../trustedGithubWriteBootstrap.ts';

import type {
    DeliveryAuthentication,
    DeliveryCoordinatorDependencies,
    DeliveryReceiptComment,
    DeliveryReceiptProof,
    DeliveryPort,
    PersistedDeliveryReceiptAuthority,
    PersistedPreparedPostMergeValidation,
    PullRequestSnapshot,
    StackedPullRequest,
    TrackerCompletionPort,
} from '../deliverPullRequest.ts';
import type { ReconcileTrackerIssuePort } from '../trackerIssueReconciliation.ts';
import type { Readable, Writable } from 'node:stream';

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

function deliveryReceiptAuthorityRef(number: number): string {
    return `refs/sourdaw/delivery-receipt/pr-${number}`;
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

function writeDeliveryReceiptAuthority(root: string, number: number, contents: string): string {
    const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: root,
        encoding: 'utf8',
        input: contents,
    }).trim();
    runGit(root, ['update-ref', deliveryReceiptAuthorityRef(number), oid]);
    return oid;
}

function readDeliveryReceiptAuthorityOid(root: string, number: number): string {
    return runGit(root, ['show-ref', '--verify', '--hash', deliveryReceiptAuthorityRef(number)]);
}

function writeRawRef(root: string, ref: string, contents: string): void {
    const gitDir = runGit(root, ['rev-parse', '--git-dir']);
    const path = join(root, gitDir, ref);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
}

type CompleteDeliveryReceiptProof = DeliveryReceiptProof & {
    commentIds: string[];
    editedCommentIds: string[];
};

function deliveryReceiptProof(
    comments: DeliveryReceiptComment[],
    editedCommentIds: string[] = []
): CompleteDeliveryReceiptProof {
    return {
        totalCount: comments.length,
        latestCommentId: comments.at(-1)?.id,
        commentIds: comments.map((comment) => comment.id),
        editedCommentIds,
    };
}

async function expectAmbiguousDeliveryMutationRetainsOwner(
    operation: (root: string, number: number) => Promise<void>
): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
    const number = 2495;
    initializeDeliveryLockRepository(root);
    let reacquired = false;

    try {
        await expect(operation(root, number)).rejects.toThrow('remote mutation result is indeterminate');
        const retainedOwnerOid = readDeliveryLockOid(root, number);
        expect(retainedOwnerOid).not.toBe('');

        await expect(
            withPullRequestDeliveryLock(root, number, async () => {
                reacquired = true;
            })
        ).rejects.toThrow(/already being delivered/);
        expect(reacquired).toBe(false);
        expect(readDeliveryLockOid(root, number)).toBe(retainedOwnerOid);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function pullRequestSnapshot(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
    return {
        number: 2495,
        state: 'OPEN',
        isDraft: false,
        title: 'fix(delivery): keep recovery fenced',
        body: [
            '### 🎯 What does this PR do?',
            'Keep delivery stable.',
            '',
            '### 🧪 How to test',
            'Run the focused delivery checks.',
            '',
            '### 🖼️ Screenshots',
            'None.',
            '',
            '### 📌 Related tickets & additional notes',
            'Closes #2406',
        ].join('\n'),
        headRefName: 'agent/2495/delivery-lock',
        headRefOid: 'a'.repeat(40),
        baseRefName: 'main',
        baseRefOid: 'b'.repeat(40),
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        reviewDecision: 'APPROVED',
        changedFiles: 1,
        additions: 2,
        deletions: 1,
        mergedByActorNodeId: null,
        ...overrides,
    };
}

function ghPullRequestView(snapshot: PullRequestSnapshot, mergedBy: unknown): string {
    const { mergedByActorNodeId: _mergedByActorNodeId, ...rest } = snapshot;
    return JSON.stringify({ ...rest, mergedBy });
}

function ghMergedByGraphql(mergedBy: unknown): string {
    return JSON.stringify({
        data: {
            repository: {
                pullRequest: {
                    mergedBy,
                },
            },
        },
    });
}

function deliveryReceiptComment(body: string, id = 'comment-1'): DeliveryReceiptComment {
    return {
        id,
        body,
        authorNodeId: AUTHOR_BOT_NODE_ID,
        authorLogin: 'sourdaw-author[bot]',
        authorType: 'Bot',
        createdAt: '2026-08-29T08:00:00Z',
        updatedAt: '2026-08-29T08:00:00Z',
    };
}

type LockContender = {
    child: ChildProcessByStdio<Writable, Readable, Readable>;
    lines: AsyncIterableIterator<string>;
    stderr: string[];
    closed: Promise<[number | null, NodeJS.Signals | null]>;
};

type LockContenderStartup =
    | {
          kind: 'ready';
          value: string | undefined;
      }
    | {
          kind: 'closed';
          code: number | null;
          signal: NodeJS.Signals | null;
          stderr: string;
      };

function describeLockContenderStartup(index: number, outcome: LockContenderStartup): string {
    if (outcome.kind === 'ready') {
        return `contender ${index + 1}: stdout=${JSON.stringify(outcome.value ?? null)}`;
    }
    return `contender ${index + 1}: code=${outcome.code ?? 'null'} signal=${outcome.signal ?? 'null'} stderr=${JSON.stringify(outcome.stderr)}`;
}

async function waitForLockContenderReady(contender: LockContender): Promise<LockContenderStartup> {
    const outcome = await Promise.race([
        contender.lines.next().then((line) => ({ kind: 'line' as const, line })),
        contender.closed.then(([code, signal]) => ({ kind: 'closed' as const, code, signal })),
    ]);
    if (outcome.kind === 'line') {
        if (!outcome.line.done) {
            return { kind: 'ready', value: outcome.line.value };
        }
        const [code, signal] = await contender.closed;
        return {
            kind: 'closed',
            code,
            signal,
            stderr: contender.stderr.join('').trim(),
        };
    }
    return {
        kind: 'closed',
        code: outcome.code,
        signal: outcome.signal,
        stderr: contender.stderr.join('').trim(),
    };
}

async function contendForDeliveryLock(root: string): Promise<string[]> {
    const moduleUrl = pathToFileURL(join(import.meta.dirname, '../deliverPullRequest.ts')).href;
    const tsxImport = import.meta.resolve('tsx');
    const repositoryRoot = join(import.meta.dirname, '..', '..');
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
    const startContender = (): LockContender => {
        const stdio: ['pipe', 'pipe', 'pipe'] = ['pipe', 'pipe', 'pipe'];
        const child = spawn(
            process.execPath,
            ['--no-warnings', '--import', tsxImport, '--input-type=module', '--eval', childSource],
            {
                cwd: repositoryRoot,
                stdio,
            }
        );
        const stderr: string[] = [];
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => stderr.push(chunk));
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
        return {
            child,
            lines,
            stderr,
            closed: once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>,
        };
    };
    const contenders = [startContender(), startContender()];

    try {
        const ready = await Promise.all(contenders.map(waitForLockContenderReady));
        if (ready.some((outcome) => outcome.kind === 'closed')) {
            expect.fail(ready.map((outcome, index) => describeLockContenderStartup(index, outcome)).join('\n'));
        }
        const readyValues = ready.map((outcome) => {
            if (outcome.kind !== 'ready') {
                expect.fail(`unexpected contender startup state: ${outcome.kind}`);
            }
            return outcome.value;
        });
        expect(readyValues).toEqual(['ready', 'ready']);
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
        const exits = await Promise.all(contenders.map(({ closed }) => closed));
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

let trustedPublishPrimaryTemplateRoot: string | undefined;

function ensureTrustedPublishPrimaryTemplate(): string {
    if (trustedPublishPrimaryTemplateRoot !== undefined) {
        return join(trustedPublishPrimaryTemplateRoot, 'primary');
    }
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-publish-primary-template-'));
    const primary = join(root, 'primary');
    trustedPublishFixture(primary, 'primary');
    trustedPublishPrimaryTemplateRoot = root;
    return primary;
}

function cloneTrustedPublishPrimaryFixture(prefix: string): { fixtureRoot: string; primary: string } {
    const templatePrimary = ensureTrustedPublishPrimaryTemplate();
    const fixtureRoot = mkdtempSync(join(tmpdir(), prefix));
    const primary = join(fixtureRoot, 'primary');
    cpSync(templatePrimary, primary, { recursive: true });
    return { fixtureRoot, primary };
}

function trustedReviewMutationFixture(root: string, mutationLog: string): void {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
            type: 'module',
            private: true,
            scripts: {
                'review:publish': 'node scripts/trustedGithubWriteBootstrap.ts review:publish',
                'review:resolve': 'node scripts/trustedGithubWriteBootstrap.ts review:resolve',
            },
        })
    );
    writeFileSync(
        join(root, 'scripts/trustedGithubWriteBootstrap.ts'),
        readFileSync(join(import.meta.dirname, '../trustedGithubWriteBootstrap.ts'), 'utf8')
    );
    writeFileSync(
        join(root, 'scripts/pullRequestMutationLock.ts'),
        [
            "import { appendFileSync } from 'node:fs';",
            'export async function withPullRequestMutationLock(_primaryRoot, _number, operation) {',
            `    appendFileSync(${JSON.stringify(mutationLog)}, 'pinned-lock\\n');`,
            '    return operation();',
            '}',
        ].join('\n')
    );
    writeFileSync(
        join(root, 'scripts/publishReview.ts'),
        [
            "import { appendFileSync } from 'node:fs';",
            "import { withPullRequestMutationLock } from './pullRequestMutationLock.ts';",
            'export async function runPublishReviewCli(args) {',
            '    await withPullRequestMutationLock(process.cwd(), 3239, async () => {',
            `        appendFileSync(${JSON.stringify(mutationLog)}, 'publish:auth:' + JSON.stringify(args) + '\\n');`,
            '    });',
            '    return 0;',
            '}',
        ].join('\n')
    );
    writeFileSync(
        join(root, 'scripts/resolveThread.ts'),
        [
            "import { appendFileSync } from 'node:fs';",
            'export async function runResolveReviewThreadCli(args) {',
            `    appendFileSync(${JSON.stringify(mutationLog)}, 'resolve:auth:' + JSON.stringify(args) + '\\n');`,
            '    return 0;',
            '}',
        ].join('\n')
    );
    for (const path of [
        'githubAppIdentity.ts',
        'prContract.ts',
        'reviewPublicationLegacyIncidents.ts',
        'prepareReview.ts',
    ]) {
        writeFileSync(join(root, 'scripts', path), 'export {};\n');
    }
    runGit(root, ['init', '-b', 'main']);
    runGit(root, ['config', 'user.name', 'Fixture']);
    runGit(root, ['config', 'user.email', 'fixture@example.com']);
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '--no-gpg-sign', '-m', 'test: trusted review mutation fixture']);
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

const GATE_SUMMARY_NAME = 'Gate';
// `!cancelled()` rather than `always()`: the summary must still evaluate failed
// and skipped dependencies on a live run. This workflow answers pull_request
// only, so a review event cannot mint a skipped Gate that GitHub would treat as
// a required-check success.
const AUTHORIZED_GATE_CONDITION = '${{ !cancelled() }}';
const PULL_REQUEST_CONCURRENCY_GROUP = 'health-gates-${{ github.event.pull_request.number }}';
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
    it.each([
        {
            label: 'author bot',
            graphQlMergedBy: { __typename: 'Bot', id: AUTHOR_BOT_NODE_ID },
            expectedActorNodeId: AUTHOR_BOT_NODE_ID,
        },
        {
            label: 'foreign bot',
            graphQlMergedBy: { __typename: 'Bot', id: 'B_foreign-bot-node-id' },
            expectedActorNodeId: 'B_foreign-bot-node-id',
        },
    ])(
        'reads the immutable merged bot ID from GraphQL for a $label merger',
        ({ graphQlMergedBy, expectedActorNodeId }) => {
            const mergedSnapshot = pullRequestSnapshot({ state: 'MERGED' });
            const requests: Array<{ command: string; args: string[] }> = [];
            const port = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: (command, args) => {
                        requests.push({ command, args });
                        if (args[0] === 'pr' && args[1] === 'view') {
                            return ghPullRequestView(mergedSnapshot, {
                                is_bot: true,
                                login: 'sourdaw-author[bot]',
                            });
                        }
                        if (args[0] === 'api' && args[1] === 'graphql') {
                            return ghMergedByGraphql(graphQlMergedBy);
                        }
                        throw new Error(`unexpected shell capture: ${command} ${args.join(' ')}`);
                    },
                    run: () => expect.fail('pullRequest should not run shell commands'),
                },
                {}
            );

            const snapshot = port.pullRequest(2495);

            expect(snapshot.mergedByActorNodeId).toBe(expectedActorNodeId);
            expect(requests).toHaveLength(2);
            expect(requests[0]?.args).toEqual([
                'pr',
                'view',
                '2495',
                '--repo',
                'jcosta33/sourdaw',
                '--json',
                expect.stringContaining('mergedBy'),
            ]);
            expect(requests[1]?.args).toContain('graphql');
            expect(requests[1]?.args.some((arg) => arg.includes('mergedBy{__typename ... on Bot{id}}'))).toBe(true);
        }
    );

    it.each([
        { label: 'null merger', graphQlMergedBy: null },
        { label: 'non-Bot merger', graphQlMergedBy: { __typename: 'User' } },
    ])('fails closed when GraphQL returns a $label for a merged PR', ({ graphQlMergedBy }) => {
        const mergedSnapshot = pullRequestSnapshot({ state: 'MERGED' });
        const port = shellPort(
            'jcosta33/sourdaw',
            {
                capture: (_command, args) => {
                    if (args[0] === 'pr' && args[1] === 'view') {
                        return ghPullRequestView(mergedSnapshot, {
                            is_bot: true,
                            login: 'sourdaw-author[bot]',
                        });
                    }
                    if (args[0] === 'api' && args[1] === 'graphql') {
                        return ghMergedByGraphql(graphQlMergedBy);
                    }
                    throw new Error(`unexpected shell capture: ${args.join(' ')}`);
                },
                run: () => expect.fail('pullRequest should not run shell commands'),
            },
            {}
        );

        expect(() => port.pullRequest(2495)).toThrow(/merger cannot be verified/);
    });

    it('recovers a final merged snapshot whose mergeability remains UNKNOWN', () => {
        const initial = pullRequestSnapshot();
        const final = pullRequestSnapshot({
            state: 'MERGED',
            mergeable: 'UNKNOWN',
            mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
        });
        const dependentBefore: StackedPullRequest = {
            number: 2601,
            state: 'OPEN',
            headRefName: 'agent/2601/stacked-dependent',
            headRefOid: 'c'.repeat(40),
            baseRefName: initial.headRefName,
        };
        let dependentAfter = { ...dependentBefore };
        let receiptBody = '';
        let receipt: DeliveryReceiptComment | undefined;
        let persistedReceiptAuthority: PersistedDeliveryReceiptAuthority | undefined;
        const retargets: Array<{ number: number; base: string }> = [];
        const trackerCompletions: number[] = [];
        const logs: string[] = [];
        const tracker: TrackerCompletionPort = {
            complete: (issueNumber) => {
                trackerCompletions.push(issueNumber);
            },
        };
        const port: DeliveryPort = {
            fetch: () => undefined,
            pullRequest: (number) => {
                if (number === 2495) {
                    return receipt === undefined ? initial : final;
                }
                if (number === dependentBefore.number) {
                    return pullRequestSnapshot({
                        ...dependentAfter,
                        body: initial.body,
                        title: 'fix(delivery): dependent stays stable',
                        baseRefOid: initial.baseRefOid,
                        mergeable: 'MERGEABLE',
                        mergeStateStatus: 'CLEAN',
                        reviewDecision: 'APPROVED',
                        changedFiles: 1,
                        additions: 1,
                        deletions: 0,
                    });
                }
                return expect.fail(`unexpected pull request read: ${number}`);
            },
            gateRequiredCheckNames: () => new Set(['Gate']),
            headCheckRuns: () => [],
            requiredStatusCheckContexts: () => ['Gate'],
            reviewState: () => ({ latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 0 }),
            dependents: (baseBranch) => (baseBranch === initial.headRefName ? [dependentBefore] : []),
            repositoryDeletesMergedBranches: () => false,
            merge: () => expect.fail('merge should not run after the final snapshot is already merged'),
            retarget: (number, baseBranch) => {
                retargets.push({ number, base: baseBranch });
                dependentAfter = { ...dependentAfter, baseRefName: baseBranch };
            },
            deliveryReceipts: () => (receipt === undefined ? [] : [receipt]),
            deliveryReceiptProof: () => deliveryReceiptProof(receipt === undefined ? [] : [receipt]),
            addDeliveryReceipt: (_number, body) => {
                receiptBody = body;
                receipt = deliveryReceiptComment(body);
                return receipt;
            },
            readDeliveryReceiptAuthority: () => persistedReceiptAuthority,
            writeDeliveryReceiptAuthority: (_number, authority) => {
                persistedReceiptAuthority = authority;
            },
            clearDeliveryReceiptAuthority: () => {
                persistedReceiptAuthority = undefined;
            },
            log: (message) => {
                logs.push(message);
            },
        };

        deliverPullRequest(2495, port, tracker);

        expect(receiptBody).toContain(`head: ${initial.headRefOid}`);
        expect(retargets).toEqual([{ number: 2601, base: 'main' }]);
        expect(trackerCompletions).toEqual([2406]);
        expect(logs).toEqual([
            'review size: 1 file(s), +2/-1',
            'PR #2495 became merged during delivery; repaired 1 dependent(s)',
        ]);
    });

    it('defines the trusted pnpm commands as direct node invocations', () => {
        const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        expect(pkg.scripts['lane:open']).toBe('node scripts/openLane.ts');
        expect(pkg.scripts['lane:publish']).toBe('node scripts/trustedGithubWriteBootstrap.ts lane:publish');
        expect(pkg.scripts['review:prepare']).toBe('node scripts/prepareReview.ts');
        expect(pkg.scripts['review:publish']).toBe('node scripts/trustedGithubWriteBootstrap.ts review:publish');
        expect(pkg.scripts['review:publish:recover']).toBe(
            'node scripts/trustedGithubWriteBootstrap.ts review:publish:recover'
        );
        expect(pkg.scripts['review:resolve']).toBe('node scripts/trustedGithubWriteBootstrap.ts review:resolve');
        expect(pkg.scripts['review:resolve:recover']).toBeUndefined();
        expect(pkg.scripts['deliver:recover-lock']).toBeUndefined();
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
        expect(Object.hasOwn(events, 'pull_request')).toBe(true);
        expect(Object.hasOwn(events, 'pull_request_review')).toBe(false);

        const concurrency = workflowRecordAt(workflow, 'concurrency');
        expect(concurrency.group).toBe(PULL_REQUEST_CONCURRENCY_GROUP);
        expect(concurrency['cancel-in-progress']).toBe(true);
        expect(workflowJob(workflow, 'decide').if).toBeUndefined();

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
        const source = readFileSync(join(import.meta.dirname, '../../.github/workflows/nightly.yml'), 'utf8');
        const document = parseDocument(source);
        expect(document.errors).toEqual([]);
        const workflow = asWorkflowRecord(document.toJS(), 'nightly workflow');
        const events = workflowRecordAt(workflow, 'on');
        expect(Object.hasOwn(events, 'schedule')).toBe(true);
        expect(Object.hasOwn(events, 'workflow_dispatch')).toBe(true);
        expect(Object.hasOwn(events, 'pull_request')).toBe(false);
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
            'pullRequestMutationLock.ts',
            'removeLane.ts',
            'resolveThread.ts',
            'recoverDeliveryLock.ts',
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
            'scripts/recoverDeliveryLock.ts',
            'scripts/pullRequestMutationLock.ts',
            'scripts/reconcileTrackerIssue.ts',
            'scripts/trackerIssueReconciliation.ts',
            'scripts/githubAppIdentity.ts',
            'scripts/prContract.ts',
        ]);
        expect(trustedDependencyPaths('review:resolve')).toEqual([
            'scripts/trustedGithubWriteBootstrap.ts',
            'scripts/resolveThread.ts',
            'scripts/githubAppIdentity.ts',
            'scripts/prContract.ts',
        ]);
        expect(trustedDependencyPaths('review:publish:recover')).toEqual([
            'scripts/trustedGithubWriteBootstrap.ts',
            'scripts/publishReview.ts',
            'scripts/reviewPublicationLegacyIncidents.ts',
            'scripts/prepareReview.ts',
            'scripts/pullRequestMutationLock.ts',
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

    it('accepts the real deliver trusted-source closure instead of placeholder bytes', async () => {
        const repositoryRoot = join(import.meta.dirname, '../..');
        const deliverPaths = trustedDependencyPaths('deliver');
        let executedSources: ReadonlyMap<string, string> | undefined;

        const exitCode = await runTrustedGithubWriteCommand('deliver', ['42'], {
            resolveOriginMain: () => 'trusted-sha',
            readOriginSource: (_commit, candidate) => {
                if (candidate.startsWith('scripts/')) {
                    return readFileSync(join(import.meta.dirname, '..', candidate.slice('scripts/'.length)), 'utf8');
                }
                return readFileSync(join(repositoryRoot, candidate), 'utf8');
            },
            executeSnapshot: async (_command, _args, snapshot) => {
                executedSources = snapshot.sources;
                return 0;
            },
        });

        expect(exitCode).toBe(0);
        expect(executedSources).toEqual(
            new Map(
                deliverPaths.map((path) => {
                    const absolutePath = path.startsWith('scripts/')
                        ? join(import.meta.dirname, '..', path.slice('scripts/'.length))
                        : join(repositoryRoot, path);
                    return [path, readFileSync(absolutePath, 'utf8')];
                })
            )
        );
    });

    it('pins complete and exact reviewer-mutation source closures', async () => {
        const repositoryRoot = join(import.meta.dirname, '..', '..');
        const cases = [
            {
                command: 'review:publish' as const,
                entry: 'scripts/publishReview.ts',
                required: 'scripts/pullRequestMutationLock.ts',
                expected: [
                    'scripts/trustedGithubWriteBootstrap.ts',
                    'scripts/publishReview.ts',
                    'scripts/reviewPublicationLegacyIncidents.ts',
                    'scripts/prepareReview.ts',
                    'scripts/pullRequestMutationLock.ts',
                    'scripts/githubAppIdentity.ts',
                    'scripts/prContract.ts',
                ],
            },
            {
                command: 'review:publish:recover' as const,
                entry: 'scripts/publishReview.ts',
                required: 'scripts/pullRequestMutationLock.ts',
                expected: [
                    'scripts/trustedGithubWriteBootstrap.ts',
                    'scripts/publishReview.ts',
                    'scripts/reviewPublicationLegacyIncidents.ts',
                    'scripts/prepareReview.ts',
                    'scripts/pullRequestMutationLock.ts',
                    'scripts/githubAppIdentity.ts',
                    'scripts/prContract.ts',
                ],
            },
            {
                command: 'review:resolve' as const,
                entry: 'scripts/resolveThread.ts',
                required: 'scripts/githubAppIdentity.ts',
                expected: [
                    'scripts/trustedGithubWriteBootstrap.ts',
                    'scripts/resolveThread.ts',
                    'scripts/githubAppIdentity.ts',
                    'scripts/prContract.ts',
                ],
            },
        ];

        for (const { command, entry, required, expected } of cases) {
            const paths = trustedDependencyPaths(command);
            expect(paths).toEqual(expected);
            const sources = new Map(paths.map((path) => [path, readFileSync(join(repositoryRoot, path), 'utf8')]));
            expect(() => assertTrustedSourceGraph(command, sources)).not.toThrow();
            await expect(executeTrustedSnapshot(command, ['--help'], { commit: 'pinned-sha', sources })).resolves.toBe(
                0
            );

            const incomplete = new Map(sources);
            incomplete.delete(required);
            expect(() => assertTrustedSourceGraph(command, incomplete)).toThrow(
                `trusted snapshot is missing ${required}`
            );

            const extra = new Map(sources).set('scripts/unexpected.ts', 'export {};');
            expect(() => assertTrustedSourceGraph(command, extra)).toThrow(
                'trusted snapshot contains unexpected source scripts/unexpected.ts'
            );

            const unresolvable = new Map(sources);
            unresolvable.set(entry, `${sources.get(entry) ?? ''}\nimport './unchecked.ts';\n`);
            expect(() => assertTrustedSourceGraph(command, unresolvable)).toThrow(
                `${entry} imports unchecked local dependency scripts/unchecked.ts`
            );
        }
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
     * Behind a dynamic call, because no non-delivery command reads a workflow or may fail to start
     * over a package it never uses.
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
            Git_Dir: '/hostile/.git',
            gIt_Work_Tree: '/hostile',
            Gh_Token: 'personal',
            Github_Token: 'actions',
            Sourdaw_Github_App_Private_Key: 'secret',
            Sourdaw_Trusted_Repository_Root: '/repo',
            Sourdaw_Trusted_Primary_Root: '/hostile/primary',
            Sourdaw_Trusted_Common_Dir: '/hostile/common',
            Sourdaw_Trusted_Git_Path: '/hostile/git',
            Sourdaw_Trusted_Gh_Path: '/hostile/gh',
            Sourdaw_Trusted_Ps_Path: '/hostile/ps',
            Sourdaw_Trusted_Powershell_Path: '/hostile/powershell.exe',
            Sourdaw_Trusted_Origin_Commit: 'b'.repeat(40),
            Sourdaw_Trusted_Gate_Workflow: '{"jobs":{}}',
            Node_Options: '--import=/hostile/preload.mjs',
            nOdE_Path: '/hostile/modules',
            Ssh_Auth_Sock: '/hostile/agent.sock',
            SOURDAW_RENDER_PROFILE: 'focused',
        });

        expect(env.Git_Dir).toBeUndefined();
        expect(env.gIt_Work_Tree).toBeUndefined();
        expect(env.Gh_Token).toBeUndefined();
        expect(env.Github_Token).toBeUndefined();
        expect(env.Sourdaw_Github_App_Private_Key).toBeUndefined();
        expect(env.Sourdaw_Trusted_Repository_Root).toBeUndefined();
        expect(env.Sourdaw_Trusted_Primary_Root).toBeUndefined();
        expect(env.Sourdaw_Trusted_Common_Dir).toBeUndefined();
        expect(env.Sourdaw_Trusted_Git_Path).toBeUndefined();
        expect(env.Sourdaw_Trusted_Gh_Path).toBeUndefined();
        expect(env.Sourdaw_Trusted_Ps_Path).toBeUndefined();
        expect(env.Sourdaw_Trusted_Powershell_Path).toBeUndefined();
        expect(env.Sourdaw_Trusted_Origin_Commit).toBeUndefined();
        expect(env.Sourdaw_Trusted_Gate_Workflow).toBeUndefined();
        expect(env.Node_Options).toBeUndefined();
        expect(env.nOdE_Path).toBeUndefined();
        expect(env.Ssh_Auth_Sock).toBeUndefined();
        expect(env.SOURDAW_RENDER_PROFILE).toBe('focused');
        expect(env.PATH).toBe('/usr/bin');
        expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
        expect(env.GIT_CONFIG_SYSTEM).toBe('/dev/null');
        expect(env.GIT_NO_REPLACE_OBJECTS).toBe('1');
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
                launcher: { primaryRoot: '/repo', commonDir: '/repo/.git', gitPath, ghPath },
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

    it('rejects Windows command scripts as trusted executable bindings', () => {
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-win32-command-scripts-'));
        const commandBin = join(fixtureRoot, 'bin');
        const commandScript = join(commandBin, 'gh.cmd');
        const batchScript = join(commandBin, 'git.bat');
        try {
            mkdirSync(commandBin);
            writeFileSync(commandScript, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
            writeFileSync(batchScript, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
            chmodSync(commandScript, 0o700);
            chmodSync(batchScript, 0o700);
            expect(() =>
                resolveTrustedExecutable('gh', { PATH: commandBin, PATHEXT: '.EXE;.CMD;.BAT' }, 'win32')
            ).toThrow(/cannot resolve trusted gh executable/i);
            expect(() =>
                resolveTrustedExecutable('git', { PATH: commandBin, PATHEXT: '.EXE;.CMD;.BAT' }, 'win32')
            ).toThrow(/cannot resolve trusted git executable/i);
        } finally {
            rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });

    describe('trusted launcher bindings with shared primary fixture', () => {
        beforeAll(() => {
            ensureTrustedPublishPrimaryTemplate();
        });

        afterAll(() => {
            if (trustedPublishPrimaryTemplateRoot !== undefined) {
                rmSync(trustedPublishPrimaryTemplateRoot, {
                    recursive: true,
                    force: true,
                    maxRetries: 3,
                    retryDelay: 20,
                });
                trustedPublishPrimaryTemplateRoot = undefined;
            }
        });

        it('binds split trusted git, gh, and ps paths and carries them into the snapshot env', () => {
            const { fixtureRoot, primary } = cloneTrustedPublishPrimaryFixture('sourdaw-split-trusted-tools-');
            const gitBin = join(fixtureRoot, 'git-bin');
            const ghBin = join(fixtureRoot, 'gh-bin');
            const psBin = join(fixtureRoot, 'ps-bin');
            const gitWrapper = join(gitBin, 'git');
            const ghWrapper = join(ghBin, 'gh');
            const psWrapper = join(psBin, 'ps');
            const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
            const realGh = execFileSync('/usr/bin/which', ['gh'], { encoding: 'utf8' }).trim();
            const realPs = execFileSync('/usr/bin/which', ['ps'], { encoding: 'utf8' }).trim();
            try {
                mkdirSync(gitBin);
                mkdirSync(ghBin);
                mkdirSync(psBin);
                writeFileSync(gitWrapper, `#!/bin/sh\nexec ${JSON.stringify(realGit)} "$@"\n`);
                writeFileSync(ghWrapper, `#!/bin/sh\nexec ${JSON.stringify(realGh)} "$@"\n`);
                writeFileSync(psWrapper, `#!/bin/sh\nexec ${JSON.stringify(realPs)} "$@"\n`);
                chmodSync(gitWrapper, 0o700);
                chmodSync(ghWrapper, 0o700);
                chmodSync(psWrapper, 0o700);

                const binding = resolveTrustedLauncherBinding(
                    primary,
                    { PATH: [gitBin, ghBin, psBin].join(delimiter) },
                    'review:publish'
                );

                expect(binding.primaryRoot).toBe(realpathSync(primary));
                expect(binding.gitPath).toBe(realpathSync(gitWrapper));
                expect(binding.ghPath).toBe(realpathSync(ghWrapper));
                expect(binding.psPath).toBe(realpathSync(psWrapper));

                const env = trustedSnapshotEnv({
                    commit: 'a'.repeat(40),
                    sources: new Map(),
                    launcher: binding,
                });

                expect(env.SOURDAW_TRUSTED_GIT_PATH).toBe(binding.gitPath);
                expect(env.SOURDAW_TRUSTED_GH_PATH).toBe(binding.ghPath);
                expect(env.SOURDAW_TRUSTED_PS_PATH).toBe(binding.psPath);
                expect(env.PATH).toBe(
                    [
                        ...new Set([
                            realpathSync(gitBin),
                            realpathSync(ghBin),
                            realpathSync(psBin),
                            dirname(process.execPath),
                        ]),
                    ].join(delimiter)
                );
            } finally {
                rmSync(fixtureRoot, { recursive: true, force: true });
            }
        });

        it('binds a trusted powershell path for Windows review-mutation commands without requiring ps', () => {
            const { fixtureRoot, primary } = cloneTrustedPublishPrimaryFixture('sourdaw-split-trusted-win32-tools-');
            const gitBin = join(fixtureRoot, 'git-bin');
            const ghBin = join(fixtureRoot, 'gh-bin');
            const powerShellBin = join(fixtureRoot, 'powershell-bin');
            const gitWrapper = join(gitBin, 'git.exe');
            const ghWrapper = join(ghBin, 'gh.exe');
            const powerShellWrapper = join(powerShellBin, 'powershell.exe');
            const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
            const realGh = execFileSync('/usr/bin/which', ['gh'], { encoding: 'utf8' }).trim();
            try {
                mkdirSync(gitBin);
                mkdirSync(ghBin);
                mkdirSync(powerShellBin);
                writeFileSync(gitWrapper, `#!/bin/sh\nexec ${JSON.stringify(realGit)} "$@"\n`);
                writeFileSync(ghWrapper, `#!/bin/sh\nexec ${JSON.stringify(realGh)} "$@"\n`);
                writeFileSync(powerShellWrapper, '#!/bin/sh\nexit 0\n');
                chmodSync(gitWrapper, 0o700);
                chmodSync(ghWrapper, 0o700);
                chmodSync(powerShellWrapper, 0o700);

                const binding = resolveTrustedLauncherBinding(
                    primary,
                    {
                        PATH: [gitBin, ghBin, powerShellBin].join(';'),
                        PATHEXT: '.EXE;.CMD;.BAT',
                    },
                    'review:publish',
                    'win32'
                );
                const powershellPath = binding.powershellPath;
                if (powershellPath === undefined) {
                    throw new Error('expected a trusted powershell executable for Windows review publication');
                }

                expect(binding.primaryRoot).toBe(realpathSync(primary));
                expect(binding.gitPath).toBe(realpathSync(gitWrapper));
                expect(binding.ghPath).toBe(realpathSync(ghWrapper));
                expect(binding.psPath).toBeUndefined();
                expect(powershellPath).toBe(realpathSync(powerShellWrapper));
                expect(spawnSync(powershellPath, [], { shell: false }).status).toBe(0);

                const env = trustedSnapshotEnv({
                    commit: 'a'.repeat(40),
                    sources: new Map(),
                    launcher: binding,
                });

                expect(env.SOURDAW_TRUSTED_POWERSHELL_PATH).toBe(powershellPath);
                expect(env.SOURDAW_TRUSTED_PS_PATH).toBeUndefined();
                expect(env.PATH).toBe(
                    [
                        ...new Set([
                            realpathSync(gitBin),
                            realpathSync(ghBin),
                            realpathSync(powerShellBin),
                            dirname(process.execPath),
                        ]),
                    ].join(delimiter)
                );
            } finally {
                rmSync(fixtureRoot, { recursive: true, force: true });
            }
        });

        it('skips non-executable Windows git.exe and powershell.exe candidates for executable fallbacks', () => {
            const { fixtureRoot, primary } = cloneTrustedPublishPrimaryFixture(
                'sourdaw-trusted-win32-executable-fallbacks-'
            );
            const rejectedBin = join(fixtureRoot, 'rejected-bin');
            const gitBin = join(fixtureRoot, 'git-bin');
            const ghBin = join(fixtureRoot, 'gh-bin');
            const powerShellBin = join(fixtureRoot, 'powershell-bin');
            const rejectedGit = join(rejectedBin, 'git.exe');
            const rejectedPowerShell = join(rejectedBin, 'powershell.exe');
            const gitWrapper = join(gitBin, 'git.exe');
            const ghWrapper = join(ghBin, 'gh.exe');
            const powerShellWrapper = join(powerShellBin, 'powershell.exe');
            const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
            const realGh = execFileSync('/usr/bin/which', ['gh'], { encoding: 'utf8' }).trim();
            try {
                mkdirSync(rejectedBin);
                mkdirSync(gitBin);
                mkdirSync(ghBin);
                mkdirSync(powerShellBin);
                writeFileSync(rejectedGit, '#!/bin/sh\nexit 99\n');
                writeFileSync(rejectedPowerShell, '#!/bin/sh\nexit 99\n');
                writeFileSync(gitWrapper, `#!/bin/sh\nexec ${JSON.stringify(realGit)} "$@"\n`);
                writeFileSync(ghWrapper, `#!/bin/sh\nexec ${JSON.stringify(realGh)} "$@"\n`);
                writeFileSync(powerShellWrapper, '#!/bin/sh\nexit 0\n');
                chmodSync(rejectedGit, 0o600);
                chmodSync(rejectedPowerShell, 0o600);
                chmodSync(gitWrapper, 0o700);
                chmodSync(ghWrapper, 0o700);
                chmodSync(powerShellWrapper, 0o700);

                const binding = resolveTrustedLauncherBinding(
                    primary,
                    {
                        PATH: [rejectedBin, gitBin, ghBin, powerShellBin].join(';'),
                        PATHEXT: '.EXE;.CMD;.BAT',
                    },
                    'review:publish',
                    'win32'
                );
                const powershellPath = binding.powershellPath;
                if (powershellPath === undefined) {
                    throw new Error('expected a trusted powershell executable for Windows review publication');
                }

                expect(binding.gitPath).toBe(realpathSync(gitWrapper));
                expect(binding.gitPath).not.toBe(realpathSync(rejectedGit));
                expect(powershellPath).toBe(realpathSync(powerShellWrapper));
                expect(powershellPath).not.toBe(realpathSync(rejectedPowerShell));
                expect(spawnSync(binding.gitPath, ['--version'], { shell: false }).status).toBe(0);
                expect(spawnSync(powershellPath, [], { shell: false }).status).toBe(0);
            } finally {
                rmSync(fixtureRoot, { recursive: true, force: true });
            }
        });

        it('requires trusted process-identity bindings on review-mutation commands and reports invalid commands before binding', () => {
            const { fixtureRoot, primary } = cloneTrustedPublishPrimaryFixture('sourdaw-bootstrap-command-gating-');
            const gitBin = join(fixtureRoot, 'git-bin');
            const ghBin = join(fixtureRoot, 'gh-bin');
            const gitWrapper = join(gitBin, 'git');
            const ghWrapper = join(ghBin, 'gh');
            const windowsGitWrapper = join(gitBin, 'git.exe');
            const windowsGhWrapper = join(ghBin, 'gh.exe');
            const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
            const realGh = execFileSync('/usr/bin/which', ['gh'], { encoding: 'utf8' }).trim();
            try {
                mkdirSync(gitBin);
                mkdirSync(ghBin);
                writeFileSync(gitWrapper, `#!/bin/sh\nexec ${JSON.stringify(realGit)} "$@"\n`);
                writeFileSync(ghWrapper, `#!/bin/sh\nexec ${JSON.stringify(realGh)} "$@"\n`);
                writeFileSync(windowsGitWrapper, `#!/bin/sh\nexec ${JSON.stringify(realGit)} "$@"\n`);
                writeFileSync(windowsGhWrapper, `#!/bin/sh\nexec ${JSON.stringify(realGh)} "$@"\n`);
                chmodSync(gitWrapper, 0o700);
                chmodSync(ghWrapper, 0o700);
                chmodSync(windowsGitWrapper, 0o700);
                chmodSync(windowsGhWrapper, 0o700);

                const path = [gitBin, ghBin].join(delimiter);
                const windowsPath = [gitBin, ghBin].join(';');
                expect(resolveTrustedLauncherBinding(primary, { PATH: path })).toEqual({
                    primaryRoot: realpathSync(primary),
                    commonDir: realpathSync(join(primary, '.git')),
                    gitPath: realpathSync(gitWrapper),
                    ghPath: realpathSync(ghWrapper),
                });
                expect(resolveTrustedLauncherBinding(primary, { PATH: path }, 'lane:publish').psPath).toBeUndefined();
                expect(
                    resolveTrustedLauncherBinding(primary, { PATH: path }, 'issue:reconcile').psPath
                ).toBeUndefined();
                expect(resolveTrustedLauncherBinding(primary, { PATH: path }, 'review:resolve').psPath).toBeUndefined();
                for (const command of ['deliver', 'lane:publish', 'issue:reconcile', 'review:resolve'] as const) {
                    expect(
                        resolveTrustedLauncherBinding(primary, { PATH: windowsPath }, command, 'win32')
                    ).toMatchObject({
                        primaryRoot: realpathSync(primary),
                        gitPath: realpathSync(windowsGitWrapper),
                        ghPath: realpathSync(windowsGhWrapper),
                        psPath: undefined,
                        powershellPath: undefined,
                    });
                }
                expect(resolveTrustedLauncherBinding(primary, { PATH: windowsPath }, undefined, 'win32')).toEqual({
                    primaryRoot: realpathSync(primary),
                    commonDir: realpathSync(join(primary, '.git')),
                    gitPath: realpathSync(windowsGitWrapper),
                    ghPath: realpathSync(windowsGhWrapper),
                });
                expect(() => resolveTrustedLauncherBinding(primary, { PATH: path }, 'review:publish')).toThrow(
                    /cannot resolve trusted ps executable/i
                );
                expect(() => resolveTrustedLauncherBinding(primary, { PATH: path }, 'review:publish:recover')).toThrow(
                    /cannot resolve trusted ps executable/i
                );
                expect(() =>
                    resolveTrustedLauncherBinding(primary, { PATH: windowsPath }, 'review:publish', 'win32')
                ).toThrow(/cannot resolve trusted powershell executable/i);
                expect(() =>
                    resolveTrustedLauncherBinding(primary, { PATH: windowsPath }, 'review:publish:recover', 'win32')
                ).toThrow(/cannot resolve trusted powershell executable/i);

                const result = spawnSync(
                    process.execPath,
                    [join(import.meta.dirname, '../trustedGithubWriteBootstrap.ts'), 'not-a-command'],
                    {
                        cwd: primary,
                        env: { ...process.env, PATH: '' },
                        encoding: 'utf8',
                        shell: false,
                    }
                );
                expect(result.status).toBe(1);
                expect(result.stderr).toMatch(/usage: trustedGithubWriteBootstrap\.ts/i);
                expect(result.stderr).not.toMatch(/trusted ps executable|protected primary checkout/i);
            } finally {
                rmSync(fixtureRoot, { recursive: true, force: true });
            }
        });

        it('binds the launcher to the primary checkout instead of a worktree alias', () => {
            const { fixtureRoot, primary } = cloneTrustedPublishPrimaryFixture('sourdaw-launcher-root-');
            const lane = join(fixtureRoot, 'lane');
            try {
                runGit(primary, ['worktree', 'add', '-b', 'agent/test/launcher', lane]);

                expect(resolveTrustedLauncherBinding(primary).primaryRoot).toBe(realpathSync(primary));
                expect(() => resolveTrustedLauncherBinding(lane)).toThrow(/protected primary checkout/);
            } finally {
                rmSync(fixtureRoot, { recursive: true, force: true });
            }
        });
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

    it('loads the literal origin/main closure even when a replacement commit preserves bootstrap bytes', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-replace-ref-'));
        const outputPath = join(root, 'publish-log.txt');

        try {
            trustedPublishFixture(root, 'literal');
            const bootstrap = readFileSync(join(root, 'scripts/trustedGithubWriteBootstrap.ts'), 'utf8');
            const literalCommit = runGit(root, ['rev-parse', 'HEAD']);

            writeFileSync(
                join(root, 'scripts/publishLane.ts'),
                "import { appendFileSync } from 'node:fs';\n" +
                    "export async function runPublishLaneCli(args) { appendFileSync(args.at(-1), 'replacement\\n'); return 0; }\n"
            );
            writeFileSync(join(root, 'scripts/trustedGithubWriteBootstrap.ts'), bootstrap);
            runGit(root, ['add', 'scripts/publishLane.ts', 'scripts/trustedGithubWriteBootstrap.ts']);
            runGit(root, ['commit', '--no-gpg-sign', '-m', 'test: replacement publish lane']);
            const replacementCommit = runGit(root, ['rev-parse', 'HEAD']);
            runGit(root, ['update-ref', `refs/replace/${literalCommit}`, replacementCommit]);

            expect(runGit(root, ['show', `${literalCommit}:scripts/publishLane.ts`])).toContain('replacement');

            const result = spawnSync(
                process.execPath,
                [join(root, 'scripts/trustedGithubWriteBootstrap.ts'), 'lane:publish', outputPath],
                {
                    cwd: root,
                    encoding: 'utf8',
                    shell: false,
                }
            );

            expect(result.status).toBe(0);
            expect(result.stderr).toBe('');
            expect(readFileSync(outputPath, 'utf8')).toBe('literal:ordinary\n');
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    /**
     * Only `deliver` decides a merge, so no other command reads a workflow. A launcher that read one
     * for every command would make them fail over a file and a parser they never use.
     */
    it.each(['lane:publish', 'issue:reconcile', 'review:publish', 'review:publish:recover', 'review:resolve'] as const)(
        'reads no gating workflow for %s',
        async (command) => {
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
        }
    );

    it('keeps the loader inside its own trusted closure', () => {
        for (const command of [
            'deliver',
            'issue:reconcile',
            'lane:publish',
            'review:publish',
            'review:publish:recover',
            'review:resolve',
        ] as const) {
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

    it.each([
        {
            command: 'review:publish' as const,
            entry: 'scripts/publishReview.ts',
            runner: 'runPublishReviewCli',
            args: ['3239', 'value with spaces'],
        },
        {
            command: 'review:publish:recover' as const,
            entry: 'scripts/publishReview.ts',
            runner: 'runRecoverPublishReviewLockCli',
            args: ['3344', '--owner', 'b'.repeat(40)],
        },
        {
            command: 'review:resolve' as const,
            entry: 'scripts/resolveThread.ts',
            runner: 'runResolveReviewThreadCli',
            args: ['3239', '--thread', 'PRRT_example', '--head', 'a'.repeat(40)],
        },
    ])('imports the $command entry and forwards its exact arguments', async ({ command, entry, runner, args }) => {
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-review-entry-'));
        const recordPath = join(fixtureRoot, 'args.json');
        try {
            const source = [
                "import { writeFileSync } from 'node:fs';",
                `export async function ${runner}(args) {`,
                `    writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(args));`,
                '    return 0;',
                '}',
            ].join('\n');
            await expect(
                executeTrustedSnapshot(command, args, {
                    commit: 'pinned-sha',
                    sources: new Map([[entry, source]]),
                })
            ).resolves.toBe(0);
            expect(JSON.parse(readFileSync(recordPath, 'utf8'))).toEqual(args);
            const importedRunners = {
                'review:publish': runPublishReviewCli,
                'review:publish:recover': runRecoverPublishReviewLockCli,
                'review:resolve': runResolveReviewThreadCli,
            } as const;
            expect(importedRunners[command]).toBeTypeOf('function');
        } finally {
            rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });

    it('refuses lane-mutated reviewer closures and executes only the pinned lock from the primary route', () => {
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-review-route-'));
        const primary = join(fixtureRoot, 'primary');
        const lane = join(fixtureRoot, 'lane');
        const mutationLog = join(fixtureRoot, 'mutations.log');
        mkdirSync(primary);
        try {
            trustedReviewMutationFixture(primary, mutationLog);
            runGit(primary, ['worktree', 'add', '-b', 'agent/test/reviewer-route', lane]);
            for (const entry of ['publishReview.ts', 'resolveThread.ts']) {
                expect(readFileSync(join(lane, 'scripts', entry), 'utf8')).toBe(
                    runGit(primary, ['show', `refs/remotes/origin/main:scripts/${entry}`])
                );
            }
            writeFileSync(
                join(lane, 'scripts/pullRequestMutationLock.ts'),
                'export async function withPullRequestMutationLock(_root, _number, operation) { return operation(); }\n'
            );

            const publishArgs = ['3239', 'publish value with spaces'];
            const resolveArgs = ['3239', '--thread', 'PRRT_example', '--head', 'a'.repeat(40)];
            runPackageRoute(primary, ['review:publish', ...publishArgs]);
            runPackageRoute(primary, ['review:resolve', ...resolveArgs]);
            expect(readFileSync(mutationLog, 'utf8')).toBe(
                [
                    'pinned-lock',
                    `publish:auth:${JSON.stringify(publishArgs)}`,
                    `resolve:auth:${JSON.stringify(resolveArgs)}`,
                    '',
                ].join('\n')
            );

            const beforeLaneAttempts = readFileSync(mutationLog, 'utf8');
            expect(() => runPackageRoute(lane, ['review:publish', ...publishArgs])).toThrow(
                /protected primary checkout/
            );
            expect(() => runPackageRoute(lane, ['review:resolve', ...resolveArgs])).toThrow(
                /protected primary checkout/
            );
            expect(readFileSync(mutationLog, 'utf8')).toBe(beforeLaneAttempts);
        } finally {
            rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    }, 15_000);

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

    it('refuses review publication before remote work while delivery owns the same PR fence', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);
        const head = 'e'.repeat(40);
        const bundle = join(root, '.agents', 'review-bundles', `2495-${head}`);
        mkdirSync(bundle, { recursive: true });
        writeFileSync(
            join(bundle, 'review.json'),
            JSON.stringify({ event: 'APPROVE', body: 'Attacked; held.', comments: [] })
        );
        writeFileSync(join(bundle, 'diff.patch'), '');
        const executable = join(root, 'ps');
        const previousPs = process.env.SOURDAW_TRUSTED_PS_PATH;
        writeFileSync(
            executable,
            '#!/bin/sh\nif [ "$2" = "pgid=" ]; then printf "%s\\n" "$4"; else printf "%s\\n" "publication-process-start"; fi\n'
        );
        chmodSync(executable, 0o700);
        process.env.SOURDAW_TRUSTED_PS_PATH = executable;
        const entered: string[] = [];
        // Publication journals its payload at lock acquisition, so reviewer authentication and
        // read-only preflight run before the fence is attempted; the fence must still refuse the
        // mutation itself while delivery owns the PR.
        const publishDependencies: PublishReviewCoordinatorDependencies = {
            primaryRoot: () => root,
            serializeMutation: withPullRequestReviewPublicationMutationLock,
            authenticateReviewer: async () => {
                entered.push('publish:authenticate');
                return {
                    minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                    session: { configDir: '/tmp/reviewer', env: {}, dispose: () => undefined },
                };
            },
            repositoryName: () => REQUIRED_REPOSITORY,
            reviewPort: () => ({
                primaryRoot: () => root,
                pullRequest: () => ({ state: 'OPEN', head }),
                readReviewJson: (path: string) => JSON.parse(readFileSync(path, 'utf8')),
                readBundleDiff: (path: string) => readFileSync(path, 'utf8'),
                postReview: () => expect.fail('review creation should not start'),
                log: () => undefined,
            }),
            publish: () => {
                entered.push('publish:post');
                return expect.fail('review creation should not start');
            },
        };
        try {
            await withPullRequestDeliveryLock(root, 2495, async () => {
                await expect(coordinatePublishReview(2495, publishDependencies)).rejects.toThrow(
                    /already being delivered/
                );
                expect(entered).toEqual(['publish:authenticate']);
                expect(deliveryLockExists(root, 2495)).toBe(true);
            });
            expect(deliveryLockExists(root, 2495)).toBe(false);
        } finally {
            if (previousPs === undefined) {
                delete process.env.SOURDAW_TRUSTED_PS_PATH;
            } else {
                process.env.SOURDAW_TRUSTED_PS_PATH = previousPs;
            }
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

    it('rejects each invalid value guard in an exact three-key stale owner blob without takeover', async () => {
        const deadProcess = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
        expect(deadProcess.status).toBe(0);
        const validToken = '00000000-0000-4000-8000-000000000001';
        const cases = [
            { label: 'version', owner: { version: 2, pid: deadProcess.pid, token: validToken } },
            { label: 'zero PID', owner: { version: 1, pid: 0, token: validToken } },
            { label: 'negative PID', owner: { version: 1, pid: -1, token: validToken } },
            { label: 'token', owner: { version: 1, pid: deadProcess.pid, token: 'not-a-uuid' } },
        ];

        for (const { label, owner } of cases) {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
            initializeDeliveryLockRepository(root);
            expect(Object.keys(owner).sort(), label).toEqual(['pid', 'token', 'version']);
            const contents = JSON.stringify(owner);
            const originalOid = writeDeliveryLockOwner(root, 2495, contents);
            let entered = false;

            try {
                await expect(
                    withPullRequestDeliveryLock(root, 2495, async () => {
                        entered = true;
                    }),
                    label
                ).rejects.toThrow(/ownership is malformed/);
                expect(entered, label).toBe(false);
                expect(readDeliveryLockOid(root, 2495), label).toBe(originalOid);
                expect(runGit(root, ['cat-file', 'blob', originalOid]), label).toBe(contents);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }
    });

    it('refuses a well-formed lock whose owner process is conclusively dead without takeover', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);
        const deadProcess = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
        expect(deadProcess.status).toBe(0);
        expect(deadProcess.pid).toBeTypeOf('number');
        const contents = JSON.stringify({
            version: 1,
            pid: deadProcess.pid,
            token: '00000000-0000-4000-8000-000000000001',
        });
        const originalOid = writeDeliveryLockOwner(root, 2495, contents);
        let delivered = false;

        try {
            await expect(
                withPullRequestDeliveryLock(root, 2495, async () => {
                    delivered = true;
                })
            ).rejects.toThrow(/already being delivered/);
            expect(delivered).toBe(false);
            expect(readDeliveryLockOid(root, 2495)).toBe(originalOid);
            expect(runGit(root, ['cat-file', 'blob', originalOid])).toBe(contents);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('releases the current delivery token after success and a pre-mutation failure', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);

        try {
            const sentinel = Symbol('delivery-result');
            await expect(
                withPullRequestDeliveryLock(root, 2495, async ({ markRemoteMutationAttempt }) => {
                    markRemoteMutationAttempt();
                    return sentinel;
                })
            ).resolves.toBe(sentinel);
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

    it('retains the exact owner after an attempted mutation error and refuses reacquisition', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);
        let reacquired = false;

        try {
            await expect(
                withPullRequestDeliveryLock(root, 2495, async ({ markRemoteMutationAttempt }) => {
                    markRemoteMutationAttempt();
                    throw new Error('remote result is indeterminate');
                })
            ).rejects.toThrow('remote result is indeterminate');
            const retainedOwnerOid = readDeliveryLockOid(root, 2495);
            expect(retainedOwnerOid).not.toBe('');

            await expect(
                withPullRequestDeliveryLock(root, 2495, async () => {
                    reacquired = true;
                })
            ).rejects.toThrow(/already being delivered/);
            expect(reacquired).toBe(false);
            expect(readDeliveryLockOid(root, 2495)).toBe(retainedOwnerOid);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('releases the exact owner when a known-absent record precedes an error', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);

        try {
            await expect(
                withPullRequestDeliveryLock(root, 2495, async (boundary) => {
                    boundary.markRemoteMutationAttempt();
                    boundary.markRemoteMutationKnownAbsent?.();
                    throw new DeliveryMergeRejectedError('PR #2495 was not merged: HTTP 422');
                })
            ).rejects.toThrow(/was not merged/);
            expect(deliveryLockExists(root, 2495)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each<[string, (port: DeliveryPort) => void, (command: string, args: string[]) => boolean]>([
        [
            'delivery receipt creation',
            (port) => {
                port.addDeliveryReceipt(2495, 'receipt');
            },
            (command, args) =>
                command === 'gh' &&
                args.includes('POST') &&
                args.includes('repos/jcosta33/sourdaw/issues/2495/comments'),
        ],
        [
            'squash merge',
            (port) => {
                port.merge(2495, 'head', false);
            },
            (command, args) =>
                command === 'gh' && args.includes('PUT') && args.includes('repos/jcosta33/sourdaw/pulls/2495/merge'),
        ],
        [
            'dependent retarget',
            (port) => {
                port.retarget(2496, 'main');
            },
            (command, args) =>
                command === 'gh' && args.includes('PATCH') && args.includes('repos/jcosta33/sourdaw/pulls/2496'),
        ],
    ])('retains the exact owner when production %s dispatch is indeterminate', async (_label, mutate, isDispatch) => {
        let dispatched = 0;
        await expectAmbiguousDeliveryMutationRetainsOwner(async (root, number) => {
            await withPullRequestDeliveryLock(root, number, async ({ markRemoteMutationAttempt }) => {
                const failDispatch = (command: string, args: string[]): never => {
                    if (!isDispatch(command, args)) {
                        throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
                    }
                    dispatched += 1;
                    throw new Error('remote mutation result is indeterminate');
                };
                const port = shellPort(
                    'jcosta33/sourdaw',
                    {
                        capture: (command, args) => {
                            if (args.join(' ') === 'api repos/jcosta33/sourdaw') {
                                return JSON.stringify({
                                    allow_merge_commit: false,
                                    allow_rebase_merge: false,
                                    allow_squash_merge: true,
                                    delete_branch_on_merge: false,
                                });
                            }
                            return failDispatch(command, args);
                        },
                        run: failDispatch,
                    },
                    { markRemoteMutationAttempt }
                );
                mutate(port);
            });
        });
        expect(dispatched).toBe(1);
    });

    it.each<[string, (port: ReconcileTrackerIssuePort) => void, 'PATCH' | 'POST']>([
        [
            'tracker issue update',
            (port) => {
                port.update(2406, { state: 'CLOSED', stateReason: 'COMPLETED' });
            },
            'PATCH',
        ],
        [
            'tracker issue comment',
            (port) => {
                port.comment(2406, 'delivery completed');
            },
            'POST',
        ],
    ])(
        'retains the exact owner when production %s dispatch is indeterminate',
        async (_label, mutate, expectedMethod) => {
            let dispatched = 0;
            await expectAmbiguousDeliveryMutationRetainsOwner(async (root, number) => {
                const authentication: DeliveryAuthentication = {
                    minted: {
                        token: 'ghs_delivery',
                        login: 'renamed-author[bot]',
                        actorNodeId: AUTHOR_BOT_NODE_ID,
                        permissions: {},
                    },
                    session: { configDir: '/tmp/sourdaw-delivery', env: {}, dispose: () => undefined },
                };
                const unusedPort: DeliveryPort = {
                    fetch: () => expect.fail('delivery domain should not run'),
                    pullRequest: () => expect.fail('delivery domain should not run'),
                    gateRequiredCheckNames: () => expect.fail('delivery domain should not run'),
                    headCheckRuns: () => expect.fail('delivery domain should not run'),
                    requiredStatusCheckContexts: () => expect.fail('delivery domain should not run'),
                    reviewState: () => expect.fail('delivery domain should not run'),
                    dependents: () => expect.fail('delivery domain should not run'),
                    repositoryDeletesMergedBranches: () => expect.fail('delivery domain should not run'),
                    merge: () => expect.fail('delivery domain should not run'),
                    retarget: () => expect.fail('delivery domain should not run'),
                    deliveryReceipts: () => expect.fail('delivery domain should not run'),
                    deliveryReceiptProof: () => expect.fail('delivery domain should not run'),
                    addDeliveryReceipt: () => expect.fail('delivery domain should not run'),
                    readDeliveryReceiptAuthority: () => expect.fail('delivery domain should not run'),
                    writeDeliveryReceiptAuthority: () => expect.fail('delivery domain should not run'),
                    clearDeliveryReceiptAuthority: () => expect.fail('delivery domain should not run'),
                    log: () => expect.fail('delivery domain should not run'),
                };
                const dependencies: DeliveryCoordinatorDependencies = {
                    primaryRoot: () => root,
                    serializeDelivery: withPullRequestDeliveryLock,
                    authenticateAuthor: async () => authentication,
                    authenticateTracker: async () => authentication,
                    repositoryName: () => 'jcosta33/sourdaw',
                    deliveryPort: () => unusedPort,
                    trackerPort: () =>
                        githubTrackerIssuePort(
                            (args) => {
                                if (!args.includes(expectedMethod)) {
                                    throw new Error(`unexpected tracker command in test: ${args.join(' ')}`);
                                }
                                dispatched += 1;
                                throw new Error('remote mutation result is indeterminate');
                            },
                            (operation) => operation()
                        ),
                    completeIssue: (_issueNumber, _actorNodeId, port) => mutate(port),
                    deliver: (_number, _port, tracker) => tracker.complete(2406),
                };
                await coordinateDelivery(number, dependencies);
            });
            expect(dispatched).toBe(1);
        }
    );

    it('forwards the known-absent marker so a definitive merge rejection releases the exact owner', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-lock-'));
        initializeDeliveryLockRepository(root);
        const authentication: DeliveryAuthentication = {
            minted: {
                token: 'ghs_delivery',
                login: 'renamed-author[bot]',
                actorNodeId: AUTHOR_BOT_NODE_ID,
                permissions: {},
            },
            session: { configDir: '/tmp/sourdaw-delivery', env: {}, dispose: () => undefined },
        };
        const unusedPort: DeliveryPort = {
            fetch: () => expect.fail('delivery domain should not run'),
            pullRequest: () => expect.fail('delivery domain should not run'),
            gateRequiredCheckNames: () => expect.fail('delivery domain should not run'),
            headCheckRuns: () => expect.fail('delivery domain should not run'),
            requiredStatusCheckContexts: () => expect.fail('delivery domain should not run'),
            reviewState: () => expect.fail('delivery domain should not run'),
            dependents: () => expect.fail('delivery domain should not run'),
            repositoryDeletesMergedBranches: () => expect.fail('delivery domain should not run'),
            merge: () => expect.fail('delivery domain should not run'),
            retarget: () => expect.fail('delivery domain should not run'),
            deliveryReceipts: () => expect.fail('delivery domain should not run'),
            deliveryReceiptProof: () => expect.fail('delivery domain should not run'),
            addDeliveryReceipt: () => expect.fail('delivery domain should not run'),
            readDeliveryReceiptAuthority: () => expect.fail('delivery domain should not run'),
            writeDeliveryReceiptAuthority: () => expect.fail('delivery domain should not run'),
            clearDeliveryReceiptAuthority: () => expect.fail('delivery domain should not run'),
            log: () => expect.fail('delivery domain should not run'),
        };
        let markRemoteMutationAttempt: (() => void) | undefined;
        let forwardedKnownAbsent: (() => void) | undefined;
        const dependencies: DeliveryCoordinatorDependencies = {
            primaryRoot: () => root,
            serializeDelivery: withPullRequestDeliveryLock,
            authenticateAuthor: async () => authentication,
            authenticateTracker: async () => authentication,
            repositoryName: () => 'jcosta33/sourdaw',
            deliveryPort: (_repository, _authentication, _primaryRoot, attempt) => {
                markRemoteMutationAttempt = attempt;
                return unusedPort;
            },
            trackerPort: () => ({
                withMutationLease: (operation) => operation(),
                inspect: () => expect.fail('tracker should not be inspected before the merge'),
                update: () => expect.fail('tracker should not be updated before the merge'),
                comment: () => expect.fail('tracker should not receive a comment before the merge'),
                log: () => undefined,
            }),
            completeIssue: () => expect.fail('no issue completes before the merge'),
            deliver: (_number, _port, _tracker, markRemoteMutationKnownAbsent) => {
                forwardedKnownAbsent = markRemoteMutationKnownAbsent;
                markRemoteMutationAttempt?.();
                markRemoteMutationKnownAbsent?.();
                throw new DeliveryMergeRejectedError('PR #2495 was not merged: HTTP 422', 'definitive-no-merge');
            },
        };

        try {
            await expect(coordinateDelivery(2495, dependencies)).rejects.toThrow(/was not merged/);
            expect(forwardedKnownAbsent).toBeInstanceOf(Function);
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

    it('round-trips prepared, merge-authorized, and terminal receipt authority across fresh shellPort instances', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-authority-'));
        initializeDeliveryLockRepository(root);
        const postMergeValidation: PersistedPreparedPostMergeValidation = {
            headRefOid: 'a'.repeat(40),
            headRefName: 'agent/2495/delivery-lock',
            baseRefName: 'main',
            bodySha256: 'c'.repeat(64),
            trackerTarget: 2406,
        };

        try {
            const writePrepared = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => expect.fail('receipt authority reads should not query GitHub'),
                    run: () => expect.fail('receipt authority reads should not run shell commands'),
                },
                { primaryRoot: root }
            );
            writePrepared.writeDeliveryReceiptAuthority(2495, {
                phase: 'prepared',
                receiptId: 'IC_exact_authority',
                postMergeValidation,
            });

            const readPrepared = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => expect.fail('receipt authority reads should not query GitHub'),
                    run: () => expect.fail('receipt authority reads should not run shell commands'),
                },
                { primaryRoot: root }
            );
            expect(readPrepared.readDeliveryReceiptAuthority(2495)).toEqual({
                phase: 'prepared',
                receiptId: 'IC_exact_authority',
                postMergeValidation,
            });

            const writeMergeAuthorized = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => expect.fail('receipt authority reads should not query GitHub'),
                    run: () => expect.fail('receipt authority reads should not run shell commands'),
                },
                { primaryRoot: root }
            );
            writeMergeAuthorized.writeDeliveryReceiptAuthority(2495, {
                phase: 'merge-authorized',
                receiptId: 'IC_exact_authority',
                postMergeValidation,
            });

            const readMergeAuthorized = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => expect.fail('receipt authority reads should not query GitHub'),
                    run: () => expect.fail('receipt authority reads should not run shell commands'),
                },
                { primaryRoot: root }
            );
            expect(readMergeAuthorized.readDeliveryReceiptAuthority(2495)).toEqual({
                phase: 'merge-authorized',
                receiptId: 'IC_exact_authority',
                postMergeValidation,
            });

            const writeTerminal = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => expect.fail('receipt authority reads should not query GitHub'),
                    run: () => expect.fail('receipt authority reads should not run shell commands'),
                },
                { primaryRoot: root }
            );
            writeTerminal.writeDeliveryReceiptAuthority(2495, {
                phase: 'terminal',
                receiptId: 'IC_exact_authority',
                postMergeValidation,
            });

            const readTerminal = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => expect.fail('receipt authority reads should not query GitHub'),
                    run: () => expect.fail('receipt authority reads should not run shell commands'),
                },
                { primaryRoot: root }
            );
            expect(readTerminal.readDeliveryReceiptAuthority(2495)).toEqual({
                phase: 'terminal',
                receiptId: 'IC_exact_authority',
                postMergeValidation,
            });
            expect(
                shellPort(
                    'jcosta33/sourdaw',
                    {
                        capture: () => expect.fail('receipt authority reads should not query GitHub'),
                        run: () => expect.fail('receipt authority reads should not run shell commands'),
                    },
                    { primaryRoot: root }
                ).readDeliveryReceiptAuthority(2495)
            ).toEqual({
                phase: 'terminal',
                receiptId: 'IC_exact_authority',
                postMergeValidation,
            });
            expect(readDeliveryReceiptAuthorityOid(root, 2495)).toMatch(/^[0-9a-f]{40,64}$/u);

            shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => expect.fail('receipt authority reads should not query GitHub'),
                    run: () => expect.fail('receipt authority reads should not run shell commands'),
                },
                { primaryRoot: root }
            ).clearDeliveryReceiptAuthority(2495);

            expect(
                shellPort(
                    'jcosta33/sourdaw',
                    {
                        capture: () => expect.fail('receipt authority reads should not query GitHub'),
                        run: () => expect.fail('receipt authority reads should not run shell commands'),
                    },
                    { primaryRoot: root }
                ).readDeliveryReceiptAuthority(2495)
            ).toBeUndefined();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('refuses malformed delivery receipt authority refs and blobs in a temp repository', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-authority-'));
        initializeDeliveryLockRepository(root);

        try {
            const port = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => expect.fail('receipt authority reads should not query GitHub'),
                    run: () => expect.fail('receipt authority reads should not run shell commands'),
                },
                { primaryRoot: root }
            );

            writeRawRef(root, deliveryReceiptAuthorityRef(2495), 'not-a-real-oid\n');
            expect(() => port.readDeliveryReceiptAuthority(2495)).toThrow(/cannot be verified/i);

            rmSync(join(root, '.git', 'refs', 'sourdaw'), { recursive: true, force: true });
            writeDeliveryReceiptAuthority(root, 2495, JSON.stringify({ version: 1, receiptId: '' }));
            expect(() => port.readDeliveryReceiptAuthority(2495)).toThrow(/delivery receipt authority is malformed/i);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('fails closed on corrupt packed delivery receipt refs instead of treating them as absent', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-authority-'));
        initializeDeliveryLockRepository(root);

        try {
            writeFileSync(join(root, '.git', 'packed-refs'), '# pack-refs with: peeled fully-peeled\n^broken\n');
            const port = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => expect.fail('receipt authority reads should not query GitHub'),
                    run: () => expect.fail('receipt authority reads should not run shell commands'),
                },
                { primaryRoot: root }
            );

            expect(() => port.readDeliveryReceiptAuthority(2495)).toThrow(/cannot be verified/i);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('fails closed on child-prefix delivery receipt refs instead of treating them as exact authority', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-authority-'));
        initializeDeliveryLockRepository(root);

        try {
            const childOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
                cwd: root,
                encoding: 'utf8',
                input: JSON.stringify({ version: 1, receiptId: 'IC_child_only' }),
            }).trim();
            runGit(root, ['update-ref', `${deliveryReceiptAuthorityRef(2495)}/child`, childOid]);
            const port = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => expect.fail('receipt authority reads should not query GitHub'),
                    run: () => expect.fail('receipt authority reads should not run shell commands'),
                },
                { primaryRoot: root }
            );

            expect(() => port.readDeliveryReceiptAuthority(2495)).toThrow(/cannot be verified/i);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects symbolic delivery receipt authority refs before resolving any object ID', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-authority-'));
        initializeDeliveryLockRepository(root);

        try {
            const targetOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
                cwd: root,
                encoding: 'utf8',
                input: JSON.stringify({ version: 2, phase: 'terminal', receiptId: 'IC_symbolic_target' }),
            }).trim();
            runGit(root, ['update-ref', 'refs/sourdaw/delivery-receipt/pr-2495-target', targetOid]);
            runGit(root, [
                'symbolic-ref',
                deliveryReceiptAuthorityRef(2495),
                'refs/sourdaw/delivery-receipt/pr-2495-target',
            ]);
            const port = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => expect.fail('receipt authority reads should not query GitHub'),
                    run: () => expect.fail('receipt authority reads should not run shell commands'),
                },
                { primaryRoot: root }
            );

            expect(() => port.readDeliveryReceiptAuthority(2495)).toThrow(/cannot be verified/i);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('reads delivery receipt authority blobs from their literal object IDs even when replace refs are present', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-authority-'));
        initializeDeliveryLockRepository(root);

        try {
            const original = JSON.stringify({ version: 2, phase: 'terminal', receiptId: 'IC_original' });
            const replacement = JSON.stringify({ version: 2, phase: 'terminal', receiptId: 'IC_replacement' });
            const originalOid = writeDeliveryReceiptAuthority(root, 2495, original);
            const replacementOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
                cwd: root,
                encoding: 'utf8',
                input: replacement,
            }).trim();
            runGit(root, ['update-ref', `refs/replace/${originalOid}`, replacementOid]);

            expect(runGit(root, ['cat-file', 'blob', originalOid])).toBe(replacement);

            const port = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => expect.fail('receipt authority reads should not query GitHub'),
                    run: () => expect.fail('receipt authority reads should not run shell commands'),
                },
                { primaryRoot: root }
            );

            expect(port.readDeliveryReceiptAuthority(2495)).toEqual({
                phase: 'terminal',
                receiptId: 'IC_original',
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('does not delete a delivery receipt authority ref whose object changed after verification', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-authority-'));
        const wrapperRoot = mkdtempSync(join(tmpdir(), 'sourdaw-git-wrapper-'));
        initializeDeliveryLockRepository(root);

        try {
            writeDeliveryReceiptAuthority(root, 2495, JSON.stringify({ version: 1, receiptId: 'IC_original' }));
            const replacementOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
                cwd: root,
                encoding: 'utf8',
                input: JSON.stringify({ version: 1, receiptId: 'IC_replacement' }),
            }).trim();
            const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
            const wrapperPath = join(wrapperRoot, 'git');
            writeFileSync(
                wrapperPath,
                [
                    '#!/usr/bin/env bash',
                    'set -euo pipefail',
                    `real_git=${JSON.stringify(realGit)}`,
                    `ref=${JSON.stringify(deliveryReceiptAuthorityRef(2495))}`,
                    `replacement=${JSON.stringify(replacementOid)}`,
                    `marker=${JSON.stringify(join(wrapperRoot, 'swapped'))}`,
                    'if [[ "${1:-}" == "for-each-ref" && "${@: -1}" == "$ref" && ! -e "$marker" ]]; then',
                    '  output="$("$real_git" "$@")"',
                    '  status=$?',
                    '  : > "$marker"',
                    '  "$real_git" update-ref "$ref" "$replacement"',
                    '  printf "%s\\n" "$output"',
                    '  exit "$status"',
                    'fi',
                    'exec "$real_git" "$@"',
                ].join('\n')
            );
            chmodSync(wrapperPath, 0o755);

            const previousPath = process.env.PATH;
            process.env.PATH = `${wrapperRoot}:${previousPath ?? ''}`;
            try {
                const port = shellPort(
                    'jcosta33/sourdaw',
                    {
                        capture: () => expect.fail('receipt authority reads should not query GitHub'),
                        run: () => expect.fail('receipt authority reads should not run shell commands'),
                    },
                    { primaryRoot: root }
                );

                expect(() => port.clearDeliveryReceiptAuthority(2495)).toThrow(
                    /could not be cleared|could not be verified|cannot be verified/i
                );
            } finally {
                process.env.PATH = previousPath;
            }

            expect(readDeliveryReceiptAuthorityOid(root, 2495)).toBe(replacementOid);
        } finally {
            rmSync(root, { recursive: true, force: true });
            rmSync(wrapperRoot, { recursive: true, force: true });
        }
    });

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
            requiredStatusCheckContexts: () =>
                expect.fail('delivery domain should be injected in this coordinator test'),
            reviewState: () => expect.fail('delivery domain should be injected in this coordinator test'),
            dependents: () => [],
            repositoryDeletesMergedBranches: () => false,
            merge: () => undefined,
            retarget: () => undefined,
            deliveryReceipts: () => [],
            deliveryReceiptProof: () => deliveryReceiptProof([]),
            addDeliveryReceipt: () => expect.fail('delivery domain should be injected in this coordinator test'),
            readDeliveryReceiptAuthority: () => undefined,
            writeDeliveryReceiptAuthority: () => undefined,
            clearDeliveryReceiptAuthority: () => undefined,
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
                    return await operation({
                        ownerOid: 'f'.repeat(40),
                        markRemoteMutationAttempt: () => undefined,
                        registerSuccessfulCompletion: () => undefined,
                    });
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
                expect(port).not.toBe(trackerPort);
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
