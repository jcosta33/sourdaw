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

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
    AUTHOR_BOT_COMMIT_EMAIL,
    AUTHOR_BOT_NODE_ID,
    AUTHOR_LOCK_REASON,
    GITHUB_HTTPS_REMOTE,
    ORCHESTRATOR_USER_NODE_ID,
    REQUIRED_REPOSITORY,
    createGhSession,
    resolvePrimaryRoot,
    type GhSession,
} from '../githubAppIdentity.ts';
import { AUTHOR_MODEL_PATTERN as OPEN_LANE_MODEL_PATTERN, AUTHOR_MODEL_RULE } from '../openLane.ts';
import { TRUSTED_GH_PATH_ENV, composePublishBody, type GuardFailureReceipt } from '../prContract.ts';
import {
    AUTHOR_MODEL_PATTERN,
    PERMITTED_GH_INVOCATIONS,
    PUBLICATION_COMMAND_RULE,
    ISSUE_LOOKUP_JQ,
    addPullRequestProjectsArgs,
    applyPullRequestMetadataArgs,
    assertGhCommandAllowed,
    canonicalLabelName,
    canonicalMilestoneTitle,
    canonicalProjectTitle,
    conflictingPathsFromMergeTree,
    derivedLabelFromSubject,
    derivedProjectFromSubject,
    descriptiveLabelNames,
    ensureModelLabelArgs,
    existingOpenPullRequestArgs,
    issueProjectItemsArgs,
    issueTrackerMetadataArgs,
    labelListArgs,
    labelRowsFromListing,
    metadataEditPlan,
    modelLabelName,
    openMilestoneTitlesArgs,
    openMilestoneTitlesFromRows,
    operatorSessionAccess,
    projectListArgs,
    projectTitlesFromListing,
    projectTitlesFromRow,
    pullRequestMergeabilityArgs,
    pullRequestMetadataArgs,
    pullRequestLabelMetadataFromRow,
    pullRequestProjectItemsArgs,
    repositoryNameWithOwnerArgs,
    trackerMetadataFromIssueRow,
    updatePullRequestArgs,
    issueExistsFromLookup,
    issueLookupArgs,
    laneIssueNumber,
    matchingOpenPullRequest,
    matchesPermittedGhInvocation,
    mergeabilityFromPullRequestRow,
    parsePublishLaneArgs,
    parsePublishWorktrees,
    publishLane,
    resolveAuthorLane,
    shellPort,
    type LabelRow,
    type PullRequestLabelMetadata,
    type PullRequestMergeability,
    type OpenPullRequestRow,
    type PublishLanePort,
    type PublishWorktree,
    type RemoteBranchRead,
} from '../publishLane.ts';
import { stackParentQuery, writeLaneStack } from '../stackedLanes.ts';
import { trustedDependencyPaths } from '../trustedGithubWriteBootstrap.ts';

const PRIMARY_ROOT = '/repo';
const DEFAULT_SUBJECT = 'feat(vcs): add identities';
const DEFAULT_SUMMARY = 'Keep VCS identity records so each authored change names who wrote it.';
const TEST_INSTRUCTIONS = 'Run the focused publisher specs and confirm they pass.';
const ISSUE_LANE = '/repo/.agents/worktrees/agent-12-work';
const CLEANUP_LANE = '/repo/.agents/worktrees/agent--cleanup';
const LEGACY_LANE = '/repo/.agents/worktrees/collab-sync-state';
const LEGACY_BRANCH = 'fix/collab-sync-state-2039';

/**
 * Fixture Git runs without the ambient global and system configuration. That configuration can wire
 * Git tracing into a developer's local git-ai daemon, which answers a fixture commit by extending
 * `refs/notes/ai` in the background; the authorship-notes case reads the note its own fixture just
 * created and asserts the push carried it, so a daemon write landing in between ships a note commit
 * the fixture never made. The same configuration can enable `commit.gpgsign`, making fixture commits
 * depend on a local signing key. Fixtures own their identity, refs, and objects, so ambient
 * configuration is noise; the production GitHub child is isolated the same way (`githubChildEnv`).
 */
const HERMETIC_GIT_CONFIG: NodeJS.ProcessEnv = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
};

function fixtureGitEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
        if (key.startsWith('GIT_')) {
            delete env[key];
        }
    }
    return { ...env, ...HERMETIC_GIT_CONFIG, ...overrides };
}

function fixtureGit(repository: string, args: string[]): string {
    return execFileSync('git', args, { cwd: repository, env: fixtureGitEnv(), encoding: 'utf8' }).trim();
}

function runTrustedLanePublish(cwd: string, args: string[], env: NodeJS.ProcessEnv): string {
    return execFileSync(process.execPath, ['scripts/trustedGithubWriteBootstrap.ts', 'lane:publish', ...args], {
        cwd,
        env,
        encoding: 'utf8',
        // Captured stderr keeps a deliberately provoked refusal on the thrown error's message
        // (and `stderr`) instead of the spec process's own stderr, where it read as a shard
        // failure (#4486). `execFileSync` still appends the captured stderr to the thrown error,
        // so `toThrow(/expected exactly one locked author lane .../)` keeps matching.
        stdio: ['pipe', 'pipe', 'pipe'],
    });
}

function initializeRepository(path: string): void {
    mkdirSync(path, { recursive: true });
    fixtureGit(path, ['init', '-b', 'main']);
    fixtureGit(path, ['config', 'user.name', 'Fixture']);
    fixtureGit(path, ['config', 'user.email', 'fixture@example.com']);
}

/**
 * A lane a publish accepts is one whose delta the authorship gate passes, so the fixture lanes
 * commit as the author App — the identity `lane:open` stamps into real lanes.
 */
function addLockedLane(primary: string, lane: string, branch: string, changedPath: string): string {
    fixtureGit(primary, ['worktree', 'add', '-b', branch, lane]);
    const target = join(lane, changedPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'change\n');
    fixtureGit(lane, ['add', '--', changedPath]);
    execFileSync('git', ['commit', '--no-gpg-sign', '-m', 'fix(delivery): fixture lane'], {
        cwd: lane,
        env: fixtureGitEnv({
            GIT_AUTHOR_NAME: 'hplovecraft208[bot]',
            GIT_AUTHOR_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
            GIT_COMMITTER_NAME: 'hplovecraft208[bot]',
            GIT_COMMITTER_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
        }),
        encoding: 'utf8',
    });
    fixtureGit(primary, ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, lane]);
    return fixtureGit(lane, ['rev-parse', 'HEAD']);
}

/** Commits one file in a fixture lane as the author App, the identity the publication gate admits. */
function commitAsAuthorApp(lane: string, filename: string, message: string): string {
    writeFileSync(join(lane, filename), `${filename}\n`);
    fixtureGit(lane, ['add', '--', filename]);
    execFileSync('git', ['commit', '--no-gpg-sign', '-m', message], {
        cwd: lane,
        env: fixtureGitEnv({
            GIT_AUTHOR_NAME: 'hplovecraft208[bot]',
            GIT_AUTHOR_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
            GIT_COMMITTER_NAME: 'hplovecraft208[bot]',
            GIT_COMMITTER_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
        }),
        encoding: 'utf8',
    });
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
    /** Author emails the publish delta's authorship read answers; defaults to the bot. */
    commitEmails?: string[];
    /** Object-store rewrites the pre-push read answers; defaults to a clean store. */
    objectStoreRewrites?: { graftsFile?: string; replaceRefs?: number };
    headSha?: string;
    baseSha?: string;
    /** The remote-tip read the port answers; defaults to `{ kind: 'present' }` (the branch exists). */
    remoteRead?: RemoteBranchRead;
    ancestor?: boolean;
    existing?: number;
    /** Per-lookup answers, so a pull request can close between the authorizing query and the push. */
    existingByCall?: Array<number | undefined>;
    existingBody?: unknown;
    existingTitle?: unknown;
    /** Live structural mergeability the post-push pull-request read answers; defaults to mergeable. */
    mergeability?: PullRequestMergeability;
    /** Conflicting paths the lane's trial merge answers; defaults to none. */
    conflictingPaths?: string[];
    issueExists?: boolean;
    guardFailureReceipt?: GuardFailureReceipt;
    guardFailure?: (laneName: string) => GuardFailureReceipt | undefined;
    /** `branch.<branch>.sourdaw-author-model` as publish reads it back; `null` records no model. */
    authorModel?: string | null;
    /** Raw `gh issue view` rows for both reads — the App's and the operator's — as one fixture. */
    issueTracker?: { labels?: unknown[]; milestone?: { title?: unknown } | null; projectItems?: unknown[] };
    openMilestoneTitles?: string[];
    knownProjects?: string[];
    /** When set, `gh project list` fails, as it does without a usable operator credential. */
    projectListError?: string;
    /** The repository label list `gh label list --limit 200 --json name,description` would answer. */
    repositoryLabels?: LabelRow[];
    /** Current pull-request metadata `gh pr view` would answer; defaults to a complete state. */
    currentMetadata?: {
        labels: string[];
        fencedAuthorLabels?: string[];
        milestoneTitle?: string;
        projectTitles: string[];
    };
};

/**
 * Wraps a fake port so every member it invokes is remembered by name, whatever the member is
 * called. The explicit `calls` ledger above names only the members it was written for, so an
 * assertion phrased over it cannot see a member added later — the escape that let a retired
 * attestation write stay green after the port learned to post it again. Comparing the whole
 * remembered set against the golden set a conforming publication calls closes that hole.
 */
function recordingPort(port: PublishLanePort, members: Set<string>): PublishLanePort {
    return new Proxy(port, {
        get: (target, property, receiver) => {
            const value = Reflect.get(target, property, receiver);
            if (typeof property !== 'string' || typeof value !== 'function') {
                return value;
            }
            return (...args: unknown[]) => {
                members.add(property);
                return Reflect.apply(value, target, args);
            };
        },
    });
}

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    const members = new Set<string>();
    const logs: string[] = [];
    const bodies: string[] = [];
    const dirty = input.dirty ?? false;
    const subject = input.subject === undefined ? DEFAULT_SUBJECT : (input.subject ?? undefined);
    const currentMetadata = input.currentMetadata ?? { labels: [modelLabelName('glm-5.3')], projectTitles: [] };
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
        commitAttribution: (_lane, deltaBaseSha, excludedBaseShas, headSha) => {
            calls.push(`attribution:${deltaBaseSha}:${excludedBaseShas.join('+')}:${headSha}`);
            return (input.commitEmails ?? [AUTHOR_BOT_COMMIT_EMAIL]).map((email, index) => ({
                // Index-first hex keeps the abbreviated display of neighboring fixture commits
                // distinct, so refusal-capping assertions can tell commit 7 from commit 8.
                oid: `${index.toString(16).padStart(2, '0')}${'0'.repeat(38)}`,
                name: 'hplovecraft208[bot]',
                email,
            }));
        },
        objectStoreRewrites: () => ({
            graftsFile: input.objectStoreRewrites?.graftsFile,
            replaceRefs: input.objectStoreRewrites?.replaceRefs ?? 0,
        }),
        headSha: () => input.headSha ?? 'a'.repeat(40),
        remoteBranchSha: () => input.remoteRead ?? { kind: 'present', sha: 'abc' },
        isAncestor: () => input.ancestor ?? true,
        push: (_lane, branch, headSha) => {
            calls.push(`push:${branch}`);
            calls.push(`pushHead:${headSha}`);
        },
        readPullRequestMergeability: (number) => {
            calls.push(`mergeability:${number}`);
            return input.mergeability ?? 'mergeable';
        },
        conflictingPaths: (_lane, base, head) => {
            calls.push(`conflicts:${base}:${head}`);
            return input.conflictingPaths ?? [];
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
                      title: input.existingTitle === undefined ? DEFAULT_SUBJECT : input.existingTitle,
                      body:
                          input.existingBody === undefined
                              ? composePublishBody(12, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS)
                              : input.existingBody,
                  };
        },
        createPullRequest: ({ title, body, branch }) => {
            bodies.push(body);
            calls.push(`create:${branch}:${title}:${body.includes('Closes #12') ? 'closes' : 'missing'}`);
            return 88;
        },
        updatePullRequest: (number, input) => {
            bodies.push(input.body);
            calls.push(`edit:${number}`);
            calls.push(`editKeys:${[...Object.keys(input)].sort().join(',')}`);
        },
        saveAuthorModel: (branch, model) => {
            calls.push(`saveModel:${branch}:${model}`);
        },
        readAuthorModel: (branch) => {
            calls.push(`readModel:${branch}`);
            return input.authorModel === null ? undefined : (input.authorModel ?? 'glm-5.3');
        },
        ensureModelLabel: (model) => {
            calls.push(`label:${modelLabelName(model)}`);
        },
        readIssueTrackerMetadata: (issue) => {
            calls.push(`issueView:${issue}`);
            return trackerMetadataFromIssueRow(input.issueTracker ?? {});
        },
        openMilestoneTitles: () => {
            calls.push('milestones');
            return input.openMilestoneTitles ?? [];
        },
        knownProjectTitles: () => {
            calls.push('projectList');
            if (input.projectListError !== undefined) {
                throw new Error(input.projectListError);
            }
            return input.knownProjects ?? [];
        },
        readIssueProjectTitles: (issue) => {
            calls.push(`issueProjects:${issue}`);
            return projectTitlesFromRow(input.issueTracker ?? {});
        },
        knownLabels: () => {
            calls.push('labelList');
            return input.repositoryLabels ?? [];
        },
        // The App read answers labels and milestone alone, exactly as the split `gh pr view` does.
        readPullRequestMetadata: (number) => {
            calls.push(`prMeta:${number}`);
            const metadata: PullRequestLabelMetadata = {
                labels: currentMetadata.labels,
                fencedAuthorLabels: currentMetadata.fencedAuthorLabels ?? [],
            };
            if (currentMetadata.milestoneTitle !== undefined) {
                metadata.milestoneTitle = currentMetadata.milestoneTitle;
            }
            return metadata;
        },
        readPullRequestProjectTitles: (number) => {
            calls.push(`prProjects:${number}`);
            return currentMetadata.projectTitles;
        },
        applyPullRequestMetadata: (number, plan) => {
            calls.push(
                `metaEdit:${number}:${plan.addLabels.join(',') || '-'}:${plan.milestoneTitle ?? '-'}:${
                    plan.addProjectTitles.join(',') || '-'
                }:${plan.removeLabels.join(',') || '-'}`
            );
        },
        // Logging is ordered against the mutating calls, so it shares their ledger.
        log: (message) => {
            calls.push(`log:${message}`);
            logs.push(message);
        },
        guardFailure: (laneName) => {
            calls.push(`guardFailure:${laneName}`);
            return input.guardFailure !== undefined ? input.guardFailure(laneName) : input.guardFailureReceipt;
        },
    };
    return { port: recordingPort(port, members), calls, logs, bodies, members };
}

describe('stack publication fencing', () => {
    it('updates an existing reconciled child retargeted to main without creating a replacement', () => {
        const f = fakePort({ existing: 41 });
        f.port.stackBase = () => ({
            branch: 'main',
            head: 'base',
            parentNumber: 12,
            parentState: 'MERGED',
            parentHead: 'parent',
        });
        const read = f.port.existingOpenPullRequest;
        f.port.existingOpenPullRequest = (branch) => {
            const current = read(branch);
            return current === undefined ? undefined : { ...current, baseRefName: 'main', headRefOid: 'a'.repeat(40) };
        };
        expect(publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(41);
        expect(f.calls).toContain('edit:41');
        expect(f.calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('stops after a pushed head when the parent merges during the push', () => {
        const f = fakePort();
        let pushed = false;
        f.port.stackBase = () => ({
            branch: pushed ? 'main' : 'agent/parent',
            head: 'parent',
            parentNumber: 12,
            parentState: pushed ? 'MERGED' : 'OPEN',
            parentHead: 'parent',
        });
        f.port.push = () => {
            pushed = true;
            f.calls.push('push');
        };
        expect(() => publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toThrow(/parent changed/);
        expect(f.calls).toContain('push');
        expect(f.calls.some((call) => call.startsWith('create:') || call.startsWith('edit:'))).toBe(false);
    });

    it.each(['parent', 'base', 'head'])('reports partial publication when %s changes during create', (change) => {
        const f = fakePort();
        let created = false;
        f.port.stackBase = () => ({
            branch: created && change === 'parent' ? 'main' : 'agent/parent',
            head: 'parent',
            parentNumber: 12,
            parentState: 'OPEN',
            parentHead: 'parent',
        });
        f.port.existingOpenPullRequest = () =>
            created
                ? {
                      number: 88,
                      title: DEFAULT_SUBJECT,
                      body: '',
                      baseRefName: change === 'base' ? 'agent/other' : 'agent/parent',
                      headRefOid: change === 'head' ? 'other' : 'a'.repeat(40),
                  }
                : undefined;
        f.port.createPullRequest = () => {
            created = true;
            f.calls.push('create');
            return 88;
        };
        expect(() => publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toThrow(
            /publication may be partial/
        );
        expect(f.calls).toContain('push:agent/12/work');
        expect(f.calls).toContain('create');
    });

    it.each(['agent/parent', 'main'])(
        'publishes against admitted %s while permission comparison remains main',
        (base) => {
            const { port, calls } = fakePort();
            let created = false;
            const comparison = base === 'main' ? 'base' : 'parent-head';
            port.stackBase = (_lane, _branch, _head, main) => {
                expect(main).toBe('base');
                return {
                    branch: base,
                    head: comparison,
                    parentNumber: 12,
                    parentState: base === 'main' ? 'MERGED' : 'OPEN',
                    parentHead: 'parent-head',
                };
            };
            port.laneSubject = (_lane, actual) => {
                expect(actual).toBe(comparison);
                return DEFAULT_SUBJECT;
            };
            port.reportDiff = (_lane, actual) => {
                expect(actual).toBe(comparison);
                calls.push('size');
            };
            port.existingOpenPullRequest = () =>
                created
                    ? { number: 88, title: DEFAULT_SUBJECT, body: '', baseRefName: base, headRefOid: 'a'.repeat(40) }
                    : undefined;
            port.createPullRequest = (input) => {
                expect(input.base).toBe(base);
                created = true;
                calls.push('create');
                return 88;
            };
            expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);
            expect(calls.indexOf('size')).toBeLessThan(calls.indexOf('push:agent/12/work'));
        }
    );

    it('refuses parent transition before push and unexpected child retargets', () => {
        const f = fakePort();
        let reads = 0;
        f.port.stackBase = () => ({
            branch: reads++ === 0 ? 'agent/parent' : 'main',
            head: 'parent',
            parentNumber: 12,
            parentState: 'OPEN',
            parentHead: 'parent',
        });
        expect(() => publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toThrow(/parent changed/);
        expect(f.calls.some((call) => call.startsWith('push:'))).toBe(false);
        const retarget = fakePort({ existing: 41 });
        retarget.port.stackBase = () => ({
            branch: 'main',
            head: 'base',
            parentNumber: 12,
            parentState: 'MERGED',
            parentHead: 'parent',
        });
        const original = retarget.port.existingOpenPullRequest;
        retarget.port.existingOpenPullRequest = (branch) => {
            const pr = original(branch);
            return pr === undefined ? undefined : { ...pr, baseRefName: 'agent/other' };
        };
        expect(() => publishLane(12, retarget.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toThrow(
            /base changed/
        );
        expect(retarget.calls.some((call) => call.startsWith('push:'))).toBe(false);
    });
});

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
    [
        'diverged remote',
        { remoteRead: { kind: 'present', sha: 'other' }, ancestor: false },
        /refusing non-fast-forward push of agent\/12\/work/,
    ],
    [
        'a human-authored push delta',
        { commitEmails: ['fixture-author@example.com'], remoteRead: { kind: 'absent' } },
        /carries commits above base authored as fixture-author@example\.com/,
    ],
    [
        'a lane whose common dir carries a grafts file',
        { objectStoreRewrites: { graftsFile: '/repo/.git/info/grafts' } },
        /info\/grafts: \/repo\/\.git\/info\/grafts, refs\/replace\/\* refs: 0/,
    ],
    [
        'a lane whose repository carries replace refs',
        { objectStoreRewrites: { replaceRefs: 2 } },
        /info\/grafts: none, refs\/replace\/\* refs: 2/,
    ],
];

describe('lane publish', () => {
    // The launcher integration boots a fixture primary, four lanes, and the trusted snapshot;
    // it holds ~13s locally but CI runners have taken 16.7s, past the 15s default. The budget
    // is the defect, not the test's work.
    it('enforces exact issue-lane publishing boundaries through the protected primary launcher', () => {
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-publish-routing-'));
        const primary = join(fixtureRoot, 'primary');
        const authorizedLane = join(fixtureRoot, 'authorized-lane');
        const siblingIssueLane = join(fixtureRoot, 'sibling-issue-lane');
        const foreignIssueLane = join(fixtureRoot, 'foreign-issue-lane');
        const unlockedIssueLane = join(fixtureRoot, 'unlocked-issue-lane');
        const hostilePrimary = join(fixtureRoot, 'hostile-primary');
        const hostileLane = join(fixtureRoot, 'hostile-lane');
        const bin = join(fixtureRoot, 'bin');
        const pushLog = join(fixtureRoot, 'push.json');
        const mintLog = join(fixtureRoot, 'mint.json');
        const eventLog = join(fixtureRoot, 'events.log');
        const pullRequestLog = join(fixtureRoot, 'pull-requests.json');
        const readLog = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
        const logLines = (path: string) => readLog(path).trim().split('\n').filter(Boolean);
        const snapshotLogs = () => ({
            mint: readLog(mintLog),
            events: readLog(eventLog),
            push: readLog(pushLog),
            pullRequest: readLog(pullRequestLog),
        });
        try {
            initializeRepository(primary);
            mkdirSync(join(primary, 'scripts'), { recursive: true });
            for (const file of [
                'trustedGithubWriteBootstrap.ts',
                'publishLane.ts',
                'githubAppIdentity.ts',
                'prContract.ts',
                'stackedLanes.ts',
                'reviewDiffSummary.ts',
                'wasm-artifacts.ts',
                'wasmToolchainPins.ts',
                'workspaceManifestFingerprint.ts',
            ]) {
                const fixtureSource = readFileSync(join(import.meta.dirname, '..', file), 'utf8');
                const fetchFixture =
                    file === 'githubAppIdentity.ts'
                        ? '\nglobalThis.fetch = async (url, init = {}) => {\n' +
                          "  if (String(url).endsWith('/access_tokens')) { const { appendFileSync } = await import('node:fs'); const body = JSON.parse(String(init.body)); appendFileSync(process.env.TEST_EVENT_LOG, 'mint\\n'); appendFileSync(process.env.TEST_MINT_LOG, JSON.stringify(body) + '\\n'); return new Response(JSON.stringify({ token: 'ghs_minted', permissions: body.permissions }), { status: 201 }); }\n" +
                          "  if (String(url).endsWith('/app')) return new Response(JSON.stringify({ slug: 'renamed-author' }), { status: 200 });\n" +
                          "  if (String(url).includes('/users/')) return new Response(JSON.stringify({ login: 'renamed-author[bot]', node_id: 'BOT_kgDOEv71mA', type: 'Bot' }), { status: 200 });\n" +
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
            const fixtureBase = fixtureGit(primary, ['rev-parse', 'HEAD']);
            addLockedLane(primary, siblingIssueLane, 'agent/12/sibling', 'sibling.txt');
            const authorizedHead = addLockedLane(
                primary,
                authorizedLane,
                'agent/12/authorized',
                '.github/workflows/fixture.yml'
            );
            // The lane records its authoring model at open; publish reads it back to label the PR.
            fixtureGit(primary, ['config', 'branch.agent/12/authorized.sourdaw-author-model', 'glm-5.3']);
            fixtureGit(primary, ['worktree', 'add', '-b', 'agent/12/foreign', foreignIssueLane]);
            fixtureGit(primary, ['worktree', 'lock', '--reason', 'active:foreign-author', foreignIssueLane]);
            fixtureGit(primary, ['worktree', 'add', '-b', 'agent/12/unlocked', unlockedIssueLane]);

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
                    "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';\n" +
                    "import { spawnSync } from 'node:child_process';\n" +
                    'const args = process.argv.slice(2);\n' +
                    "const readsBase = args[0] === 'rev-parse' && args[1] === '--verify' && args[2] === 'refs/remotes/origin/main^{commit}';\n" +
                    "if (readsBase && process.env.TEST_BASE_SHA_SEQUENCE) { const sequence = JSON.parse(process.env.TEST_BASE_SHA_SEQUENCE); const counter = process.env.TEST_BASE_SHA_COUNTER; const index = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0; writeFileSync(counter, String(index + 1)); console.log(sequence[Math.min(index, sequence.length - 1)]); process.exit(0); }\n" +
                    "if (args.includes('fetch')) { appendFileSync(process.env.TEST_EVENT_LOG, 'fetch\\n'); process.exit(0); }\n" +
                    "if (args.includes('ls-remote')) { console.log('f'.repeat(40) + '\\trefs/heads/main'); process.exit(0); }\n" +
                    "if (args.includes('push')) { appendFileSync(process.env.TEST_EVENT_LOG, 'push\\n'); appendFileSync(process.env.TEST_PUSH_LOG, JSON.stringify({ cwd: process.cwd(), args }) + '\\n'); process.exit(0); }\n" +
                    `const result = spawnSync(${JSON.stringify(systemGit)}, args, { stdio: ['inherit', 'inherit', 'pipe'], env: process.env });\n` +
                    'if (result.stderr) process.stderr.write(result.stderr);\n' +
                    'if (result.error) throw result.error; process.exit(result.status ?? 1);\n'
            );
            chmodSync(gitWrapper, 0o700);
            const ghWrapper = join(bin, 'gh');
            writeFileSync(
                ghWrapper,
                '#!/usr/bin/env node\n' +
                    "import { appendFileSync } from 'node:fs';\n" +
                    'const args = process.argv.slice(2);\n' +
                    "if (args[0] === 'repo') console.log(process.env.TEST_REPOSITORY ?? 'jcosta33/sourdaw');\n" +
                    "else if (args[0] === 'auth' && args[1] === 'token') console.log('gho_operator');\n" +
                    "else if (args[0] === 'api' && args.at(-1) === 'user') console.log(JSON.stringify({ type: 'User', node_id: 'MDQ6VXNlcjg5NzgyNzA=' }));\n" +
                    "else if (args[0] === 'api' && String(args[1]).includes('/issues/')) console.log(JSON.stringify({ number: 12, isPullRequest: false }));\n" +
                    "else if (args[0] === 'api') console.log('[]');\n" +
                    "else if (args[0] === 'issue' && args[1] === 'view') console.log(JSON.stringify({ milestone: null, projectItems: [] }));\n" +
                    "else if (args[0] === 'project' && args[1] === 'list') console.log(JSON.stringify({ projects: [], totalCount: 0 }));\n" +
                    "else if (args[0] === 'label' && args[1] === 'list') console.log(JSON.stringify([{ name: 'glm-5.3', description: 'Authored by glm-5.3' }]));\n" +
                    "else if (args[0] === 'label' && args[1] === 'create') process.exit(0);\n" +
                    "else if (args[0] === 'pr' && args[1] === 'list') console.log('[]');\n" +
                    "else if (args[0] === 'pr' && args[1] === 'view') console.log(JSON.stringify({ labels: [{ name: 'glm-5.3' }], milestone: null, projectItems: [] }));\n" +
                    "else if (args[0] === 'pr' && args[1] === 'create') { appendFileSync(process.env.TEST_EVENT_LOG, 'pr-write\\n'); appendFileSync(process.env.TEST_PR_LOG, JSON.stringify(args) + '\\n'); console.log('https://github.com/jcosta33/sourdaw/pull/88'); }\n" +
                    "else if (args[0] === 'pr' && args[1] === 'edit') { appendFileSync(process.env.TEST_EVENT_LOG, 'pr-write\\n'); appendFileSync(process.env.TEST_PR_LOG, JSON.stringify(args) + '\\n'); }\n" +
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
                TEST_PR_LOG: pullRequestLog,
            };
            const beforeAmbiguousIssue = snapshotLogs();
            expect(() =>
                runTrustedLanePublish(
                    primary,
                    ['12', '--summary', DEFAULT_SUMMARY, '--test', TEST_INSTRUCTIONS],
                    launcherEnv
                )
            ).toThrow(/expected exactly one locked author lane for issue #12/);
            // Every launcher run fetches origin/main exactly once before resolving its snapshot
            // (#4436) — a read of the remote the git shim records as a `fetch` event. The refusal
            // guarantee under test is that no authenticated write happened and that the refused
            // run performed only that one expected read, so the comparison strips exactly one
            // fetch per launcher run; mint, push, and pull-request events must still be none.
            const fetchCount = (logs: ReturnType<typeof snapshotLogs>) =>
                logs.events.split('\n').filter((line) => line === 'fetch').length;
            const withoutSnapshotFetches = (logs: ReturnType<typeof snapshotLogs>) => ({
                ...logs,
                events: logs.events
                    .split('\n')
                    .filter((line) => line !== 'fetch')
                    .join('\n'),
            });
            expect(withoutSnapshotFetches(snapshotLogs())).toEqual(withoutSnapshotFetches(beforeAmbiguousIssue));
            expect(fetchCount(snapshotLogs()) - fetchCount(beforeAmbiguousIssue)).toBe(1);
            runTrustedLanePublish(
                primary,
                ['--lane', authorizedLane, '--summary', DEFAULT_SUMMARY, '--test', TEST_INSTRUCTIONS],
                launcherEnv
            );

            expect(JSON.parse(readFileSync(mintLog, 'utf8').trim())).toEqual({
                permissions: { contents: 'write', pull_requests: 'write', issues: 'write', workflows: 'write' },
            });
            const push = JSON.parse(readFileSync(pushLog, 'utf8').trim()) as { cwd: string; args: string[] };
            const pushedRefspec = push.args.find((arg) => arg.includes(':refs/heads/'));
            expect(realpathSync(push.cwd)).toBe(realpathSync(authorizedLane));
            expect(pushedRefspec?.split(':')[0]).toBe(authorizedHead);
            expect(pushedRefspec?.split(':')[1]).toBe('refs/heads/agent/12/authorized');
            expect(push.args.some((arg) => arg.endsWith(':refs/heads/agent/12/sibling'))).toBe(false);
            expect(push.args.some((arg) => arg.endsWith(':refs/heads/agent/12/hostile'))).toBe(false);
            expect(push.args).not.toContain('--force');
            expect(push.args).not.toContain('--force-with-lease');
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
            const beforeForeignLock = snapshotLogs();
            expect(() => runTrustedLanePublish(primary, ['--lane', foreignIssueLane], launcherEnv)).toThrow(
                /not inside a locked author lane/
            );
            const afterForeignLock = snapshotLogs();
            expect(withoutSnapshotFetches(afterForeignLock)).toEqual(withoutSnapshotFetches(beforeForeignLock));
            expect(fetchCount(afterForeignLock) - fetchCount(beforeForeignLock)).toBe(1);

            const beforeUnlockedLane = snapshotLogs();
            expect(() => runTrustedLanePublish(primary, ['--lane', unlockedIssueLane], launcherEnv)).toThrow(
                /not inside a locked author lane/
            );
            expect(withoutSnapshotFetches(snapshotLogs())).toEqual(withoutSnapshotFetches(beforeUnlockedLane));
            expect(fetchCount(snapshotLogs()) - fetchCount(beforeUnlockedLane)).toBe(1);

            const beforeWrongRepository = snapshotLogs();
            expect(() =>
                runTrustedLanePublish(primary, ['--lane', authorizedLane], {
                    ...launcherEnv,
                    TEST_REPOSITORY: 'attacker/sourdaw',
                })
            ).toThrow(/expected jcosta33\/sourdaw/);
            const afterWrongRepository = snapshotLogs();
            expect(afterWrongRepository.push).toBe(beforeWrongRepository.push);
            expect(afterWrongRepository.pullRequest).toBe(beforeWrongRepository.pullRequest);

            const changedBase = 'f'.repeat(40);
            const beforePrePushRace = snapshotLogs();
            expect(() =>
                runTrustedLanePublish(
                    primary,
                    ['--lane', authorizedLane, '--summary', DEFAULT_SUMMARY, '--test', TEST_INSTRUCTIONS],
                    {
                        ...launcherEnv,
                        TEST_BASE_SHA_SEQUENCE: JSON.stringify([fixtureBase, fixtureBase, fixtureBase, changedBase]),
                        TEST_BASE_SHA_COUNTER: join(fixtureRoot, 'pre-push-base-counter'),
                    }
                )
            ).toThrow(/origin\/main changed after its permission-scoped token was minted/);
            const afterPrePushRace = snapshotLogs();
            expect(afterPrePushRace.push).toBe(beforePrePushRace.push);
            expect(afterPrePushRace.pullRequest).toBe(beforePrePushRace.pullRequest);

            const pushesBeforePostPushRace = logLines(pushLog).length;
            const pullRequestsBeforePostPushRace = readLog(pullRequestLog);
            expect(() =>
                runTrustedLanePublish(
                    primary,
                    ['--lane', authorizedLane, '--summary', DEFAULT_SUMMARY, '--test', TEST_INSTRUCTIONS],
                    {
                        ...launcherEnv,
                        TEST_BASE_SHA_SEQUENCE: JSON.stringify([
                            fixtureBase,
                            fixtureBase,
                            fixtureBase,
                            fixtureBase,
                            changedBase,
                        ]),
                        TEST_BASE_SHA_COUNTER: join(fixtureRoot, 'post-push-base-counter'),
                    }
                )
            ).toThrow(/origin\/main changed after its permission-scoped token was minted/);
            expect(logLines(pushLog)).toHaveLength(pushesBeforePostPushRace + 1);
            expect(readLog(pullRequestLog)).toBe(pullRequestsBeforePostPushRace);

            const beforeNestedPath = snapshotLogs();
            expect(() =>
                runTrustedLanePublish(primary, ['--lane', join(authorizedLane, '.github')], launcherEnv)
            ).toThrow(/--lane must name the exact author worktree root/);
            expect(withoutSnapshotFetches(snapshotLogs())).toEqual(withoutSnapshotFetches(beforeNestedPath));
            expect(fetchCount(snapshotLogs()) - fetchCount(beforeNestedPath)).toBe(1);
        } finally {
            rmSync(fixtureRoot, { recursive: true, force: true });
        }
    }, 60_000);

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

            execFileSync(systemGit, ['init', '--bare', remote], {
                cwd: fixtureRoot,
                env: fixtureGitEnv(),
                encoding: 'utf8',
            });
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

    it('pushes refs/notes/ai along with branch commits when refs/notes/ai exists', () => {
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-publish-lane-notes-'));
        const primary = join(fixtureRoot, 'primary');
        const lane = join(fixtureRoot, 'lane');
        const remote = join(fixtureRoot, 'remote.git');
        const systemGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        let session: GhSession | undefined;

        try {
            mkdirSync(primary, { recursive: true });
            fixtureGit(primary, ['init', '-b', 'main']);
            fixtureGit(primary, ['config', 'user.name', 'Fixture']);
            fixtureGit(primary, ['config', 'user.email', 'fixture@example.com']);
            writeFileSync(join(primary, 'base.txt'), 'base\n');
            fixtureGit(primary, ['add', 'base.txt']);
            fixtureGit(primary, ['commit', '--no-gpg-sign', '-m', 'test: fixture base']);
            fixtureGit(primary, ['worktree', 'add', '-b', 'agent/12/notes-proof', lane]);

            writeFileSync(join(lane, 'note.txt'), 'notes\n');
            fixtureGit(lane, ['add', 'note.txt']);
            fixtureGit(lane, ['commit', '--no-gpg-sign', '-m', 'test: commit in lane']);

            const headSha = fixtureGit(lane, ['rev-parse', 'HEAD']);
            fixtureGit(lane, ['notes', '--ref=ai', 'add', '-m', 'ai authorship note', headSha]);
            const noteSha = fixtureGit(lane, ['rev-parse', 'refs/notes/ai']);

            execFileSync(systemGit, ['init', '--bare', remote], {
                cwd: fixtureRoot,
                env: fixtureGitEnv(),
                encoding: 'utf8',
            });
            fixtureGit(primary, ['config', `url.${remote}.insteadOf`, GITHUB_HTTPS_REMOTE]);
            session = createGhSession('ghs_hook_marker', { PATH: process.env.PATH });

            shellPort(session, lane, primary, { git: systemGit, gh: 'gh' }).push(lane, 'agent/12/notes-proof', headSha);

            expect(fixtureGit(remote, ['rev-parse', 'refs/heads/agent/12/notes-proof'])).toBe(headSha);
            expect(fixtureGit(remote, ['rev-parse', 'refs/notes/ai'])).toBe(noteSha);
        } finally {
            session?.dispose();
            rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it('pushes without force, opens one PR, and prints the number', () => {
        const { port, calls, logs } = fakePort();

        expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);
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
        expect(calls).toContain('edit:41');
    });

    it('reports a conflicted head and its locally merged path, and still publishes', () => {
        // The defect this pins: a conflicted head gets no merge ref, so no `pull_request` run starts
        // and the required Gate check can never appear. The publish has already succeeded, so the
        // report must name the pull request, the head, why Gate cannot appear, and the path a real
        // trial merge conflicts on — without refusing and without touching the pull request.
        const head = '1'.repeat(40);
        const base = '2'.repeat(40);
        const { port, calls, logs } = fakePort({
            headSha: head,
            baseSha: base,
            mergeability: 'conflicting',
            conflictingPaths: ['src/modules/audio/engine.ts'],
        });

        expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

        const report = logs.join('\n');
        expect(report).toContain('pull request #88');
        expect(report).toContain(head);
        expect(report).toContain(base);
        expect(report).toContain('required Gate check cannot appear');
        expect(report).toContain('src/modules/audio/engine.ts');
        expect(calls).toContain(`conflicts:${base}:${head}`);
        expect(calls).toContain('push:agent/12/work');
        expect(calls.some((call) => call.startsWith('create:'))).toBe(true);
        expect(logs.at(-1)).toBe('88');
    });

    it('stays quiet about a mergeable head', () => {
        const { port, calls, logs } = fakePort({ mergeability: 'mergeable' });

        expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

        expect(calls).toContain('mergeability:88');
        expect(calls.some((call) => call.startsWith('conflicts:'))).toBe(false);
        // The uncertainty report also avoids the word `conflict`, so quiet must be observed against
        // every report this check can emit: any line mentioning mergeability is a report.
        expect(logs.some((line) => line.includes('mergeability'))).toBe(false);
        expect(logs.some((line) => line.includes('conflict'))).toBe(false);
        expect(logs.at(-1)).toBe('88');
    });

    it('reports an unknown mergeability as uncertainty, never as a conflict', () => {
        const { port, calls, logs } = fakePort({ mergeability: 'unknown' });

        expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

        expect(calls).toContain('mergeability:88');
        expect(logs.some((line) => line.includes('not yet known'))).toBe(true);
        expect(logs.some((line) => line.includes('conflict'))).toBe(false);
        expect(calls.some((call) => call.startsWith('conflicts:'))).toBe(false);
    });

    it('refuses to open a pull request without explicit test instructions', () => {
        const { port, calls } = fakePort();

        expect(() => publishLane(12, port)).toThrow(/requires --test <instructions>/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('refuses to open a pull request without an explicit summary', () => {
        const { port, calls } = fakePort();

        expect(() => publishLane(12, port, undefined, TEST_INSTRUCTIONS)).toThrow(/requires --summary <text>/);
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

        publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);

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

        publishLane(12, accepted.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, authorization);
        expect(accepted.calls).toContain(`pushHead:${classifiedHead}`);

        const changed = fakePort({ headSha: 'b'.repeat(40) });
        expect(() =>
            publishLane(12, changed.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, authorization)
        ).toThrow(/HEAD changed after its permission-scoped token was minted/);
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

        expect(() => publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, authorization)).toThrow(
            /origin\/main changed after its permission-scoped token was minted/
        );
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:') || call.startsWith('edit:'))).toBe(false);
    });

    it('publishes a lane that is behind origin/main when it still has lane commits to publish', () => {
        const { port, calls } = fakePort({ dirty: false, ahead: 1, behind: 1, existing: 41 });

        expect(publishLane(12, port)).toBe(41);

        expect(calls).toContain('push:agent/12/work');
        expect(calls).toContain('edit:41');
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('names the resolved lane before it pushes or opens a pull request', () => {
        const { port, calls } = fakePort();

        publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);

        const receipt = calls.indexOf(`log:publishing ${ISSUE_LANE} on agent/12/work`);
        expect(receipt).toBeGreaterThanOrEqual(0);
        expect(receipt).toBeLessThan(calls.findIndex((call) => call.startsWith('push:')));
        expect(receipt).toBeLessThan(calls.findIndex((call) => call.startsWith('create:')));
    });

    it('writes Closes #<issue> into the body when an issue is given', () => {
        const { port, bodies } = fakePort();

        publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);

        expect(bodies.at(-1)).toContain('Closes #12');
        expect(bodies.at(-1)).toContain(`### 🎯 What does this PR do?\n${DEFAULT_SUMMARY}`);
        expect(bodies.at(-1)).not.toContain(`### 🎯 What does this PR do?\n${DEFAULT_SUBJECT}`);
        expect(bodies.at(-1)).toContain(`### 🧪 How to test\n${TEST_INSTRUCTIONS}`);
    });

    it('takes Closes #<issue> from the lane branch when no issue argument is given', () => {
        const { port, calls, bodies } = fakePort({
            trees: [...otherAuthorLanes(), worktree()],
            cwd: `${ISSUE_LANE}/scripts`,
        });

        expect(publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);
        expect(calls).toContain('issueExists:12');
        expect(calls).toContain('push:agent/12/work');
        expect(bodies.at(-1)).toContain('Closes #12');
    });

    it('refuses a branch-derived issue that does not exist before mutating the lane or pull request', () => {
        const { port, calls } = fakePort({
            trees: [...otherAuthorLanes(), worktree()],
            cwd: ISSUE_LANE,
            issueExists: false,
        });

        expect(() => publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toThrow(
            /issue #12 does not exist/
        );
        expect(calls).toContain('issueExists:12');
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:') || call.startsWith('edit:'))).toBe(false);
    });

    it('references a campaign issue without closing it', () => {
        const { port, bodies } = fakePort();

        publishLane(12, port, 'relates', TEST_INSTRUCTIONS, DEFAULT_SUMMARY);

        expect(bodies.at(-1)).toContain('Related #12');
        expect(bodies.at(-1)).not.toContain('Closes #12');
    });

    it('takes the related issue from the lane branch', () => {
        const { port, bodies } = fakePort({
            trees: [...otherAuthorLanes(), worktree()],
            cwd: `${ISSUE_LANE}/scripts`,
        });

        publishLane(undefined, port, 'relates', TEST_INSTRUCTIONS, DEFAULT_SUMMARY);

        expect(bodies.at(-1)).toContain('Related #12');
    });

    it('preserves Related on a later flagless update', () => {
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS, 'relates'),
        });

        publishLane(12, port);

        expect(bodies.at(-1)).toContain('Related #12');
        expect(bodies.at(-1)).not.toContain('Closes #12');
    });

    it('preserves Closes on a later flagless update', () => {
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS),
        });

        publishLane(12, port);

        expect(bodies.at(-1)).toContain('Closes #12');
        expect(bodies.at(-1)).not.toContain('Related #12');
    });

    it('recomposes the Related section from Closes on a flagless update whose existing body carries extra Related lines', () => {
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS).replace(
                'Closes #12',
                'Closes #12\nRelated #7\nRelated #9'
            ),
        });

        publishLane(12, port);

        const relatedSection = bodies.at(-1)?.split('### 📌 Related issues & additional notes\n')[1]?.trim();
        expect(relatedSection).toBe('Closes #12');
    });

    it('skips recovering a relationship from a body naming a different issue when --relates is explicit', () => {
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(7, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS, 'relates'),
        });

        publishLane(12, port, 'relates');

        const relatedSection = bodies.at(-1)?.split('### 📌 Related issues & additional notes\n')[1]?.trim();
        expect(relatedSection).toBe('Related #12');
    });

    it('still refuses that same body on a flagless update, which must recover the lane-issue relationship', () => {
        const { port, calls } = fakePort({
            existing: 41,
            existingBody: composePublishBody(7, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS, 'relates'),
        });

        expect(() => publishLane(12, port)).toThrow('pull-request body must contain exactly one relationship to #12');
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('preserves valid existing test instructions when --test is omitted', () => {
        const existingInstructions = 'Open the settings panel and confirm the new control is visible.';
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, DEFAULT_SUMMARY, existingInstructions),
        });

        publishLane(12, port);

        expect(bodies.at(-1)).toContain(`### 🧪 How to test\n${existingInstructions}`);
    });

    it('preserves a valid existing What section when --summary is omitted', () => {
        const existingSummary = 'Name each authored change so reviewers can see who wrote it.';
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, existingSummary, TEST_INSTRUCTIONS),
        });

        publishLane(12, port);

        expect(bodies.at(-1)).toContain(`### 🎯 What does this PR do?\n${existingSummary}`);
        expect(bodies.at(-1)).not.toContain(DEFAULT_SUMMARY);
    });

    it('updates existing test instructions when --test is supplied', () => {
        const updatedInstructions = 'Run the publisher CLI and confirm the updated instructions appear.';
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS),
        });

        publishLane(12, port, undefined, updatedInstructions);

        expect(bodies.at(-1)).toContain(`### 🧪 How to test\n${updatedInstructions}`);
        expect(bodies.at(-1)).not.toContain(TEST_INSTRUCTIONS);
    });

    it('updates the existing What section when --summary is supplied', () => {
        const updatedSummary = 'Describe the change for a teammate who was not in the session.';
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS),
        });

        publishLane(12, port, undefined, undefined, updatedSummary);

        expect(bodies.at(-1)).toContain(`### 🎯 What does this PR do?\n${updatedSummary}`);
        expect(bodies.at(-1)).not.toContain(DEFAULT_SUMMARY);
    });

    it('changes a valid existing relationship only when requested', () => {
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: composePublishBody(12, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS),
        });

        publishLane(12, port, 'relates');

        expect(bodies.at(-1)).toContain('Related #12');
        expect(bodies.at(-1)).not.toContain('Closes #12');
    });

    it('validates existing state before an explicit relationship change', () => {
        const { port, calls } = fakePort({ existing: 41, existingBody: 'None.' });

        // --relates is explicit, so nothing recovers a relationship from this body; the update
        // still needs a valid existing How-to-test section to fill in the omitted --test flag.
        expect(() => publishLane(12, port, 'relates')).toThrow(/is missing: ### 🧪 How to test/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('validates existing state before a flagless update', () => {
        const { port, calls } = fakePort({ existing: 41, existingBody: null });

        expect(() => publishLane(12, port)).toThrow(/body is unreadable/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('refuses an existing pull request whose title is unreadable', () => {
        const { port, calls } = fakePort({ existing: 41, existingTitle: null });

        expect(() => publishLane(12, port)).toThrow(/title is unreadable/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('rejects mixed None and issue relationships before mutation', () => {
        const { port, calls } = fakePort({
            existing: 41,
            existingBody: '### 📌 Related issues & additional notes\nNone.\nCloses #12',
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
            existingBody: '### 📌 Related issues & additional notes\nCloses #12',
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
            existingBody: composePublishBody(undefined, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS),
        });

        publishLane(undefined, port);

        expect(bodies.at(-1)).toContain('### 📌 Related issues & additional notes\nNone.');
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

        expect(publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);
        expect(calls).toContain('push:agent/cleanup');
        expect(calls.some((call) => call.startsWith('issueExists:'))).toBe(false);
        expect(bodies.at(-1)).not.toContain('Closes #');
        expect(bodies.at(-1)).toContain('### 📌 Related issues & additional notes\nNone.');
        expect(logs.at(-1)).toBe('88');
    });

    it('resolves the lane from a nested subdirectory of the lane', () => {
        const { port, calls } = fakePort({
            trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
            cwd: `${CLEANUP_LANE}/scripts/__tests__`,
        });

        expect(publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);
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

        publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);

        expect(calls.some((call) => call.includes('feat(foo): bar'))).toBe(true);
    });

    it('does not retitle an existing pull request when the lane subject changes', () => {
        const { port, calls } = fakePort({
            existing: 41,
            subject: 'feat(foo): a later commit',
        });

        publishLane(12, port);

        expect(calls).toContain('edit:41');
        expect(calls).toContain('editKeys:body');
        expect(calls.some((call) => call.includes('feat(foo): a later commit'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('checks a later --summary against the existing GitHub title, not the newest commit subject', () => {
        const { port, calls, bodies } = fakePort({
            existing: 41,
            existingTitle: DEFAULT_SUBJECT,
            subject: 'feat(foo): a later commit',
        });

        publishLane(12, port, undefined, undefined, 'a later commit');

        expect(calls).toContain('edit:41');
        expect(bodies.at(-1)).toContain('### 🎯 What does this PR do?\na later commit');
    });

    it('refuses a later --summary that repeats the existing GitHub title', () => {
        const { port, calls } = fakePort({
            existing: 41,
            existingTitle: DEFAULT_SUBJECT,
            subject: 'feat(foo): a later commit',
        });

        expect(() => publishLane(12, port, undefined, undefined, 'add identities')).toThrow(
            /What section repeats the title/
        );
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('refuses a summary containing an unexpected closing reference naming the offending phrase and rule', () => {
        const { port, calls } = fakePort();

        expect(() => publishLane(12, port, undefined, TEST_INSTRUCTIONS, 'Addresses defect (closes #2174)')).toThrow(
            'pull-request body contains unexpected issue-closing references ("closes #2174"). ' +
                'GitHub closing keywords (close, fix, resolve #<issue>) in pull-request descriptions auto-close issues on merge; ' +
                'remove the keyword from prose or rephrase.'
        );
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('refuses to publish when the remote listing is unreadable, instead of skipping the fast-forward check', () => {
        // The defect this pins: an empty ls-remote answer was read as "branch absent", so a
        // branch that actually exists slipped the non-fast-forward gate and the push proceeded
        // from a stale base. An unreadable remote must refuse, never widen the gate.
        const { port, calls } = fakePort({ remoteRead: { kind: 'unreadable' } });

        expect(() => publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toThrow(
            /cannot read the remote heads for agent\/12\/work: the remote listing was unreadable/
        );
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('publishes a branch absent from a non-empty listing when no open pull request expects it', () => {
        // A non-empty remote listing that lacks the target branch reads `absent`. With no open pull
        // request whose head is that branch, absent is a legitimate first publication: the
        // fast-forward check is skipped and the first publish proceeds.
        const { port, calls } = fakePort({ remoteRead: { kind: 'absent' } });

        expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);
        expect(calls).toContain('push:agent/12/work');
    });

    it('refuses publication when an absent branch already has an open pull request heading it', () => {
        // The regression this lane closes: a reachable remote still lists `main`, so a branch the
        // transport fails to show arrives as a non-empty listing that omits it — classified `absent`
        // even though an open pull request for it proves it was published. That must refuse, not
        // widen the non-fast-forward check from remote-tip..head to base..head.
        const { port, calls } = fakePort({ remoteRead: { kind: 'absent' }, existing: 41 });

        expect(() => publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toThrow(
            /refusing publication of agent\/12\/work: the remote heads listing did not carry the branch although an open pull request for it exists/
        );
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it.each(REFUSED_PUBLISH_CASES)('refuses %s', (_case, input, message) => {
        const { port, calls } = fakePort(input);

        expect(() => publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toThrow(message);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('caps the refusal at eight named offending commits and counts the tail', () => {
        const { port } = fakePort({ commitEmails: Array.from({ length: 10 }, () => 'fixture-author@example.com') });

        const message = refusalMessage(() => publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY));

        expect(message).toContain('authored as fixture-author@example.com');
        expect(message).toContain('0700000 fixture-author@example.com');
        expect(message).toContain('+2 more');
        expect(message).not.toContain('0800000');
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
        expect(parsePublishLaneArgs(['--summary', DEFAULT_SUMMARY, '12', '--test', TEST_INSTRUCTIONS])).toEqual({
            issue: 12,
            summary: DEFAULT_SUMMARY,
            testInstructions: TEST_INSTRUCTIONS,
            help: false,
        });
        expect(parsePublishLaneArgs(['--relates'])).toEqual({ relationship: 'relates', help: false });
        expect(
            parsePublishLaneArgs([
                '12',
                '--model',
                'GLM-5.3',
                '--milestone',
                'v1.2',
                '--project',
                'Roadmap',
                '--project',
                'Backlog',
            ])
        ).toEqual({
            issue: 12,
            model: 'glm-5.3',
            milestone: 'v1.2',
            projects: ['Roadmap', 'Backlog'],
            help: false,
        });
        expect(parsePublishLaneArgs(['--project', 'Roadmap', '--project', 'Roadmap'])).toEqual({
            projects: ['Roadmap'],
            help: false,
        });
        expect(parsePublishLaneArgs(['12', '--label', 'bug', '--label', 'ENHANCEMENT', '--label', 'bug'])).toEqual({
            issue: 12,
            labels: ['bug', 'ENHANCEMENT'],
            help: false,
        });
        expect(() => parsePublishLaneArgs(['12', '--label'])).toThrow(/usage/);
        expect(parsePublishLaneArgs([])).toEqual({ help: false });
        expect(parsePublishLaneArgs(['--help'])).toEqual({ help: true });
        expect(() => parsePublishLaneArgs(['12', '13'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['--relates', '--relates'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['--test'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['--test', TEST_INSTRUCTIONS, '--test', TEST_INSTRUCTIONS])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['--summary'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['--summary', DEFAULT_SUMMARY, '--summary', DEFAULT_SUMMARY])).toThrow(
            /usage/
        );
        expect(() => parsePublishLaneArgs(['--lane', 'relative/lane'])).toThrow(/absolute path/);
        expect(() => parsePublishLaneArgs(['12', '--lane', CLEANUP_LANE])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['beat'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['12', '--model', 'glm 5.3'])).toThrow(
            /--model must be the lowercase public name of the model itself/
        );
        expect(() => parsePublishLaneArgs(['12', '--model', 'builtin:glm-5.3'])).toThrow(
            /dropping only deployment-routing prefixes and date-snapshot suffixes/
        );
        expect(() => parsePublishLaneArgs(['12', '--model', 'glm_5.3'])).toThrow(
            /--model must be the lowercase public name of the model itself/
        );
        expect(parsePublishLaneArgs(['12', '--model', 'GLM-5.3-Flash'])).toEqual({
            issue: 12,
            model: 'glm-5.3-flash',
            help: false,
        });
        expect(() => parsePublishLaneArgs(['12', '--model'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['12', '--model', 'glm-5.3', '--model', 'kimi-k2.5'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['12', '--milestone', 'v1.2', '--milestone', 'v1.3'])).toThrow(/usage/);
    });

    it('carries the selected lane path into the port for explicit path resolution', () => {
        const session: GhSession = { configDir: '/tmp/sourdaw-gh', env: {}, dispose: () => undefined };
        const here = import.meta.dirname;

        expect(here).not.toBe(resolvePrimaryRoot(undefined, here));
        expect(shellPort(session, here).cwd()).toBe(here);
        expect(shellPort(session).cwd()).toBe(process.cwd());
    });

    /**
     * Installation tokens cannot reach user-owned Projects v2, so the split between the two
     * credentials is the whole fix: a fake port can prove which port member is called, but only a
     * real `gh` child can prove which token each call carries.
     */
    it('carries the operator token on every project call and the App token on the rest', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-publish-operator-'));
        try {
            const log = join(root, 'gh.log');
            const ghPath = join(root, 'gh');
            writeFileSync(
                ghPath,
                '#!/usr/bin/env node\n' +
                    "import { appendFileSync } from 'node:fs';\n" +
                    'const args = process.argv.slice(2);\n' +
                    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ token: process.env.GH_TOKEN, args }) + '\\n');\n` +
                    "if (args[0] === 'project') console.log(JSON.stringify({ projects: [{ title: 'Sourdaw Bugs' }], totalCount: 1 }));\n" +
                    "else if (args[1] === 'view') console.log(JSON.stringify({ projectItems: [{ title: 'Sourdaw Roadmap' }] }));\n"
            );
            chmodSync(ghPath, 0o700);
            const app: GhSession = {
                configDir: join(root, 'app'),
                env: { PATH: process.env.PATH, GH_TOKEN: 'app-token' },
                dispose: () => {},
            };
            let operatorSessions = 0;
            const operator = operatorSessionAccess({}, () => {
                operatorSessions += 1;
                return {
                    session: {
                        configDir: join(root, 'operator'),
                        env: { PATH: process.env.PATH, GH_TOKEN: 'operator-token' },
                        dispose: () => {},
                    },
                };
            });
            const port = shellPort(app, root, root, { git: 'git', gh: ghPath }, operator);

            expect(port.knownProjectTitles()).toEqual(['Sourdaw Bugs']);
            expect(port.readIssueProjectTitles(12)).toEqual(['Sourdaw Roadmap']);
            expect(port.readPullRequestProjectTitles(88)).toEqual(['Sourdaw Roadmap']);
            port.readPullRequestMetadata(88);
            port.applyPullRequestMetadata(88, {
                addLabels: ['bug'],
                removeLabels: [],
                addProjectTitles: ['Sourdaw Bugs'],
            });

            const entries = readFileSync(log, 'utf8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as { token: string; args: string[] });
            const touchesProjects = (entry: { args: string[] }) =>
                entry.args[0] === 'project' ||
                entry.args.includes('projectItems') ||
                entry.args.includes('--add-project');
            // The listing, both membership reads, and the board write.
            expect(entries.filter(touchesProjects)).toHaveLength(4);
            for (const entry of entries) {
                expect(entry.token).toBe(touchesProjects(entry) ? 'operator-token' : 'app-token');
            }
            // Two edits, never one: the App writes labels and milestone, the operator writes the
            // board. A single edit carrying both would fail whole under either token.
            const edits = entries.filter((entry) => entry.args[0] === 'pr' && entry.args[1] === 'edit');
            expect(edits).toEqual([
                { token: 'app-token', args: ['pr', 'edit', '88', '--repo', 'jcosta33/sourdaw', '--add-label', 'bug'] },
                {
                    token: 'operator-token',
                    args: ['pr', 'edit', '88', '--repo', 'jcosta33/sourdaw', '--add-project', 'Sourdaw Bugs'],
                },
            ]);
            // One credential for the whole publish, opened on its first project call.
            expect(operatorSessions).toBe(1);
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    /**
     * A fake `gh` that only logs its token and argv per call, shared by the two guard cases below:
     * one proves the App edit stays silent on a project-only plan, the other proves the operator
     * edit stays silent on a board-less plan. Neither case needs stdout, so the script never prints.
     */
    function realGhHarness(root: string): {
        ghPath: string;
        readEntries: () => { token: string; args: string[] }[];
    } {
        const log = join(root, 'gh.log');
        const ghPath = join(root, 'gh');
        writeFileSync(
            ghPath,
            '#!/usr/bin/env node\n' +
                "import { appendFileSync } from 'node:fs';\n" +
                'const args = process.argv.slice(2);\n' +
                `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ token: process.env.GH_TOKEN, args }) + '\\n');\n`
        );
        chmodSync(ghPath, 0o700);
        return {
            ghPath,
            readEntries: () =>
                readFileSync(log, 'utf8')
                    .trim()
                    .split('\n')
                    .map((line) => JSON.parse(line) as { token: string; args: string[] }),
        };
    }

    /**
     * A plan that only touches project membership must never fire the App edit: the call-site
     * guard exists precisely because `gh pr edit` with no `--add-label`/`--remove-label`/
     * `--milestone` flag is refused, so an unguarded call would still reach a real `gh` with
     * nothing to do. Only a real `gh` child proves the App edit never happened at all.
     */
    it('carries a project-only plan through the operator edit alone, never the App edit', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-publish-project-only-'));
        try {
            const { ghPath, readEntries } = realGhHarness(root);
            const app: GhSession = {
                configDir: join(root, 'app'),
                env: { PATH: process.env.PATH, GH_TOKEN: 'app-token' },
                dispose: () => {},
            };
            const operator = operatorSessionAccess({}, () => ({
                session: {
                    configDir: join(root, 'operator'),
                    env: { PATH: process.env.PATH, GH_TOKEN: 'operator-token' },
                    dispose: () => {},
                },
            }));
            const port = shellPort(app, root, root, { git: 'git', gh: ghPath }, operator);

            port.applyPullRequestMetadata(88, {
                addLabels: [],
                removeLabels: [],
                addProjectTitles: ['Sourdaw Bugs'],
            });

            const edits = readEntries().filter((entry) => entry.args[0] === 'pr' && entry.args[1] === 'edit');
            expect(edits.filter((entry) => entry.token === 'app-token')).toEqual([]);
            expect(edits).toEqual([
                {
                    token: 'operator-token',
                    args: ['pr', 'edit', '88', '--repo', 'jcosta33/sourdaw', '--add-project', 'Sourdaw Bugs'],
                },
            ]);
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    /**
     * The mirror of the case above: a plan with no project titles must never fire the operator
     * edit. The call-site guard on `plan.addProjectTitles.length > 0` exists precisely because
     * `gh pr edit --add-project` with no title still reaches a real `gh` with nothing to add, and
     * would needlessly mint an operator session for a plan that never touches the board. Only a
     * real `gh` child proves the operator edit never happened at all.
     */
    it('keeps a board-less plan on the App edit alone, never the operator edit', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-publish-board-less-'));
        try {
            const { ghPath, readEntries } = realGhHarness(root);
            const app: GhSession = {
                configDir: join(root, 'app'),
                env: { PATH: process.env.PATH, GH_TOKEN: 'app-token' },
                dispose: () => {},
            };
            const operator = operatorSessionAccess({}, () => ({
                session: {
                    configDir: join(root, 'operator'),
                    env: { PATH: process.env.PATH, GH_TOKEN: 'operator-token' },
                    dispose: () => {},
                },
            }));
            const port = shellPort(app, root, root, { git: 'git', gh: ghPath }, operator);

            port.applyPullRequestMetadata(88, {
                addLabels: ['bug'],
                removeLabels: [],
                addProjectTitles: [],
            });

            const edits = readEntries().filter((entry) => entry.args[0] === 'pr' && entry.args[1] === 'edit');
            expect(edits.filter((entry) => entry.token === 'operator-token')).toEqual([]);
            expect(edits).toEqual([
                {
                    token: 'app-token',
                    args: ['pr', 'edit', '88', '--repo', 'jcosta33/sourdaw', '--add-label', 'bug'],
                },
            ]);
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    /**
     * A pull request already on its board must not be re-added: `assertPullRequestMetadata` reads
     * `readPullRequestProjectTitles` and folds it into the plan precisely so a rerun converges
     * instead of re-issuing the operator edit. Labels and milestone are already right too, so the
     * only way an edit could fire here is the project read being discarded.
     */
    it('issues no operator edit when the pull request already carries its derived board', () => {
        const laneBranch = 'agent/fix-board';
        const lanePath = '/repo/.agents/worktrees/agent--fix-board';
        const title = 'fix(delivery): keep pull requests on their board';
        const { port, calls } = fakePort({
            trees: [worktree({ path: lanePath, branch: laneBranch })],
            cwd: lanePath,
            existing: 88,
            existingTitle: title,
            // Issueless: the body's Related issues section must read `None.`, not the fixture
            // default's `Closes #12`.
            existingBody: composePublishBody(undefined, title, DEFAULT_SUMMARY, TEST_INSTRUCTIONS),
            knownProjects: ['Sourdaw Bugs'],
            currentMetadata: {
                labels: [modelLabelName('glm-5.3'), 'bug'],
                fencedAuthorLabels: [modelLabelName('glm-5.3')],
                projectTitles: ['Sourdaw Bugs'],
            },
        });

        expect(publishLane(undefined, port)).toBe(88);

        expect(calls).toContain('prProjects:88');
        expect(calls.some((call) => call.startsWith('metaEdit:'))).toBe(false);
    });

    it('refuses the project reads when the operator identity is unverifiable or absent', () => {
        const session: GhSession = { configDir: '/tmp/sourdaw-gh', env: {}, dispose: () => {} };
        const here = import.meta.dirname;
        const unverifiable = shellPort(
            session,
            here,
            here,
            { git: 'git', gh: 'gh' },
            operatorSessionAccess({}, () => {
                throw new Error('invalid orchestrator identity');
            })
        );

        expect(() => unverifiable.knownProjectTitles()).toThrow(/invalid orchestrator identity/);
        expect(() => shellPort(session, here, here).knownProjectTitles()).toThrow(
            /project membership needs the verified operator credential/
        );
    });

    /**
     * `runPublishLaneCli` disposes the operator access unconditionally in its `finally`, but
     * `operatorSessionAccess` opens the underlying session lazily on first `session()` call: a
     * publish that never reads project membership must never authenticate at all, and one that
     * does must dispose the real session exactly once no matter how many times `dispose` is
     * called afterward.
     */
    it('disposes the lazily opened operator session exactly once, and never authenticates unopened', () => {
        let authenticateCalls = 0;
        let disposeCalls = 0;
        const fakeSession: GhSession = {
            configDir: '/tmp/sourdaw-operator',
            env: {},
            dispose: () => {
                disposeCalls += 1;
            },
        };
        const access = operatorSessionAccess({}, () => {
            authenticateCalls += 1;
            return { session: fakeSession };
        });

        access.dispose();
        expect(authenticateCalls).toBe(0);
        expect(disposeCalls).toBe(0);

        access.session();
        access.session();
        expect(authenticateCalls).toBe(1);
        expect(disposeCalls).toBe(0);

        access.dispose();
        expect(disposeCalls).toBe(1);

        access.dispose();
        expect(disposeCalls).toBe(1);
    });

    /**
     * Every other `operatorSessionAccess` case in this file injects its own `authenticate`, which
     * proves the split against a fake session but never proves what the omitted default resolves
     * to. `runPublishLaneCli` is the only production caller and always omits it, so this drives a
     * real `gh` child through the unmodified default binding, `authenticateOrchestratorSession`,
     * and checks it both refuses a foreign identity and accepts the verified one.
     */
    it('binds the verified orchestrator authenticator by default and refuses a foreign identity', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-publish-orchestrator-default-'));
        try {
            const ghScript = (actor: { type: string; node_id: string }) =>
                '#!/usr/bin/env node\n' +
                'const args = process.argv.slice(2);\n' +
                "if (args[0] === 'auth') console.log('stored-token');\n" +
                `else console.log(${JSON.stringify(JSON.stringify(actor))});\n`;

            const foreignGhPath = join(root, 'gh-foreign');
            writeFileSync(foreignGhPath, ghScript({ type: 'User', node_id: 'foreign-user' }));
            chmodSync(foreignGhPath, 0o700);

            const realGhPath = join(root, 'gh-real');
            writeFileSync(realGhPath, ghScript({ type: 'User', node_id: ORCHESTRATOR_USER_NODE_ID }));
            chmodSync(realGhPath, 0o700);

            const foreign = operatorSessionAccess({ PATH: process.env.PATH, [TRUSTED_GH_PATH_ENV]: foreignGhPath });
            expect(() => foreign.session()).toThrow(/orchestrator/);

            const real = operatorSessionAccess({ PATH: process.env.PATH, [TRUSTED_GH_PATH_ENV]: realGhPath });
            const session = real.session();
            expect(session.env.GH_TOKEN).toBe('stored-token');
            const configDir = session.configDir;
            expect(existsSync(configDir)).toBe(true);
            real.dispose();
            expect(existsSync(configDir)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
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
                env: fixtureGitEnv({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
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

    /**
     * The conflict report must name paths a real merge actually conflicts on, so this measures the
     * port's own `git merge-tree` against real history: a fake can prove only that the report prints
     * what it is handed, never that the hand-off is a trial merge rather than a guess or a list.
     */
    it('derives conflicting paths from a real trial merge in the lane', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-trial-merge-'));
        const session: GhSession = {
            configDir: '/tmp/sourdaw-gh',
            env: { PATH: process.env.PATH, ...HERMETIC_GIT_CONFIG },
            dispose: () => undefined,
        };
        const git = (args: string[]) => fixtureGit(repository, args);
        const write = (file: string, content: string) => writeFileSync(join(repository, file), content);
        try {
            git(['init', '-b', 'main']);
            git(['config', 'user.name', 'Fixture']);
            git(['config', 'user.email', 'fixture@example.com']);
            write('conflicted.txt', 'base\n');
            write('untouched.txt', 'base\n');
            git(['add', '-A']);
            git(['commit', '--no-gpg-sign', '-m', 'chore(fixture): base']);

            git(['checkout', '-b', 'agent/12/work']);
            write('conflicted.txt', 'lane\n');
            write('lane-only.txt', 'lane\n');
            git(['add', '-A']);
            git(['commit', '--no-gpg-sign', '-m', 'feat(fixture): lane change']);
            const head = git(['rev-parse', 'HEAD']);

            git(['checkout', 'main']);
            write('conflicted.txt', 'main\n');
            git(['add', '-A']);
            git(['commit', '--no-gpg-sign', '-m', 'fix(fixture): main change']);
            const base = git(['rev-parse', 'HEAD']);

            const port = shellPort(session, repository);
            expect(port.conflictingPaths(repository, base, head)).toEqual(['conflicted.txt']);
            // A clean trial merge names nothing, so the report can never invent a path from it.
            expect(port.conflictingPaths(repository, base, base)).toEqual([]);
        } finally {
            rmSync(repository, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    /**
     * The read itself must not conflate "no ref for the branch" with "could not read the remote":
     * a fake port can only hand `publishLane` a pre-classified answer, so the classification of the
     * raw `ls-remote --heads` output is pinned here against the real port, with a git shim answering
     * the listing. The empty case is the guard the regression mutates.
     */
    describe('remote-tip read', () => {
        const REMOTE_HEAD_CASES: Array<[string, string, RemoteBranchRead]> = [
            ['an entirely empty listing', '', { kind: 'unreadable' }],
            ['a listing that lacks the branch', `${'f'.repeat(40)}\trefs/heads/main\n`, { kind: 'absent' }],
            [
                'a listing that names the branch',
                `${'a'.repeat(40)}\trefs/heads/agent/12/work\n`,
                { kind: 'present', sha: 'a'.repeat(40) },
            ],
        ];

        function remoteReadPort(output: string): { port: PublishLanePort; root: string } {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-publish-lsremote-'));
            const configDir = join(root, 'config');
            mkdirSync(configDir, { recursive: true });
            const gitShim = join(root, 'git');
            writeFileSync(
                gitShim,
                '#!/usr/bin/env node\n' +
                    'const args = process.argv.slice(2);\n' +
                    "if (args.includes('ls-remote')) { process.stdout.write(process.env.TEST_LS_REMOTE_OUTPUT ?? ''); process.exit(0); }\n" +
                    "console.error('unexpected git ' + args.join(' ')); process.exit(1);\n"
            );
            chmodSync(gitShim, 0o700);
            const session: GhSession = {
                configDir,
                env: { PATH: process.env.PATH, GH_TOKEN: 'ghs_fixture', TEST_LS_REMOTE_OUTPUT: output },
                dispose: () => {},
            };
            return { port: shellPort(session, root, root, { git: gitShim, gh: 'gh' }), root };
        }

        it.each(REMOTE_HEAD_CASES)('reads %s', (_case, output, expected) => {
            const { port, root } = remoteReadPort(output);
            try {
                expect(port.remoteBranchSha('agent/12/work')).toEqual(expected);
            } finally {
                rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
            }
        });
    });

    it('requests headRefName, isCrossRepository, the title, and the body the update path must preserve', () => {
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
            'number,headRefName,isCrossRepository,title,body,baseRefName,headRefOid',
        ]);
        expect(existingOpenPullRequestArgs('agent/12/work').join(' ')).not.toContain('jcosta33:agent');
    });

    it('edits an existing pull request body without sending a title', () => {
        expect(updatePullRequestArgs(41, 'body text')).toEqual([
            'pr',
            'edit',
            '41',
            '--repo',
            'jcosta33/sourdaw',
            '--body',
            'body text',
        ]);
        expect(updatePullRequestArgs(41, 'body text')).not.toContain('--title');
    });

    it('reads live mergeability from the pull request with only the field it needs', () => {
        expect(pullRequestMergeabilityArgs(88)).toEqual([
            'pr',
            'view',
            '88',
            '--repo',
            'jcosta33/sourdaw',
            '--json',
            'mergeable',
        ]);
    });

    describe('matchingOpenPullRequest', () => {
        function row(overrides: Partial<OpenPullRequestRow> = {}): OpenPullRequestRow {
            return {
                number: 41,
                headRefName: 'agent/12/work',
                isCrossRepository: false,
                title: 'feat(vcs): add identities',
                body: '### 📌 Related issues & additional notes\nCloses #12',
                ...overrides,
            };
        }

        it('accepts an exact same-repo head match, and carries its title and body forward', () => {
            expect(matchingOpenPullRequest([row()], 'agent/12/work')).toEqual({
                number: 41,
                headRefName: 'agent/12/work',
                isCrossRepository: false,
                title: 'feat(vcs): add identities',
                body: '### 📌 Related issues & additional notes\nCloses #12',
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
            expect(calls.some((call) => call.startsWith('label:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('readModel:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('prMeta:'))).toBe(false);
        });

        it('applies metadata to a legacy pull request only when --model is explicit', () => {
            // The flag is the one thing that proves the operator wants the mechanism applied to a
            // pull request this script never authored. Even then, its title and body stay
            // untouched: only label, milestone, and project membership are asserted, against the
            // existing pull request number the legacy path already re-proved open.
            const { port, calls, bodies } = fakePort({
                trees: [...otherAuthorLanes(), legacyWorktree()],
                cwd: LEGACY_LANE,
                existing: 2275,
                currentMetadata: { labels: [], projectTitles: [] },
            });

            expect(
                publishLane(undefined, port, undefined, undefined, undefined, undefined, { model: 'kimi-k2.5' })
            ).toBe(2275);

            expect(calls).toContain(`saveModel:${LEGACY_BRANCH}:kimi-k2.5`);
            expect(calls).toContain('label:kimi-k2.5');
            expect(calls).toContain('prMeta:2275');
            expect(calls).toContain('metaEdit:2275:kimi-k2.5:-:-:-');
            expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
            expect(bodies).toEqual([]);
        });

        it('refuses metadata flags on a legacy lane without --model instead of dropping them', () => {
            // A parsed-then-silently-dropped flag is the worst outcome: the operator believes the
            // milestone, project, or label was applied and the publish exits 0. Without --model the
            // whole mechanism is opted out for this lane, so the flags must refuse loudly.
            const milestone = fakePort({
                trees: [...otherAuthorLanes(), legacyWorktree()],
                cwd: LEGACY_LANE,
                existing: 2275,
            });

            expect(() =>
                publishLane(undefined, milestone.port, undefined, undefined, undefined, undefined, {
                    milestone: 'v1.2',
                })
            ).toThrow(/metadata flags require --model on a legacy lane/);
            expect(milestone.calls.some((call) => call.startsWith('push:'))).toBe(false);

            const project = fakePort({
                trees: [...otherAuthorLanes(), legacyWorktree()],
                cwd: LEGACY_LANE,
                existing: 2275,
            });

            expect(() =>
                publishLane(undefined, project.port, undefined, undefined, undefined, undefined, {
                    projects: ['Roadmap'],
                })
            ).toThrow(/metadata flags require --model on a legacy lane/);
            expect(project.calls.some((call) => call.startsWith('push:'))).toBe(false);

            const label = fakePort({
                trees: [...otherAuthorLanes(), legacyWorktree()],
                cwd: LEGACY_LANE,
                existing: 2275,
            });

            expect(() =>
                publishLane(undefined, label.port, undefined, undefined, undefined, undefined, {
                    labels: ['bug'],
                })
            ).toThrow(/metadata flags require --model on a legacy lane/);
            expect(label.calls.some((call) => call.startsWith('push:'))).toBe(false);
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

    describe('guard failure receipt check', () => {
        const failureReceipt: GuardFailureReceipt = {
            version: 1,
            lane: 'agent-12-work',
            branch: 'agent/12/work',
            headSha: '1234567890abcdef1234567890abcdef12345678',
            failedAt: '2026-09-07T12:00:00.000Z',
            reason: 'memory',
            command: 'pnpm',
            args: ['test:run', 'src/app.spec.ts'],
            profile: 'focused',
            peakRssBytes: 5 * 1024 ** 3,
            maxRssBytes: 4 * 1024 ** 3,
            durationMs: 1500,
        };

        it('refuses publish when an unresolved guard-failure receipt exists for the lane', () => {
            const { port, calls } = fakePort({ guardFailureReceipt: failureReceipt });

            expect(() => publishLane(12, port)).toThrow(
                "refusing publish: lane agent/12/work has an unresolved guard-failure receipt (memory at 123456789 during 'pnpm test:run src/app.spec.ts'): prove it resolved under pnpm guard or run 'pnpm guard --recover' before publishing"
            );
            expect(calls).toContain('guardFailure:agent-12-work');
            expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        });

        it('proceeds with publish when guardFailure returns undefined', () => {
            const { port, calls } = fakePort({ guardFailureReceipt: undefined });

            const pr = publishLane(12, port, 'closes', TEST_INSTRUCTIONS, DEFAULT_SUMMARY);
            expect(pr).toBe(88);
            expect(calls).toContain('guardFailure:agent-12-work');
            expect(calls.some((call) => call.startsWith('push:'))).toBe(true);
        });
    });

    describe('authoring model and tracker metadata', () => {
        it('refuses an invalid --model with the same rule and pattern lane:open enforces', () => {
            // The rule and pattern are mirrored in publishLane rather than imported (the trusted
            // publish snapshot's dependency graph is closed), so these pins hold the two spellings
            // to one contract: the quoted message alone would let a diverging pattern through.
            const message = refusalMessage(() => parsePublishLaneArgs(['12', '--model', 'glm 5.3']));
            expect(message).toBe(`--model must be ${AUTHOR_MODEL_RULE}`);
            expect(AUTHOR_MODEL_PATTERN).toEqual(OPEN_LANE_MODEL_PATTERN);
        });

        it('builds the idempotent model label creation command under the bare model name', () => {
            expect(ensureModelLabelArgs('glm-5.3')).toEqual([
                'label',
                'create',
                'glm-5.3',
                '--color',
                '8250df',
                '--description',
                'Authored by glm-5.3',
                '--force',
            ]);
            expect(modelLabelName('kimi-k2.5')).toBe('kimi-k2.5');
        });

        it('builds the metadata reads against the required repository', () => {
            // Labels and milestone are the author App's to read; projectItems is split off because
            // only the operator credential can reach user-owned Projects v2.
            expect(issueTrackerMetadataArgs(12)).toEqual([
                'issue',
                'view',
                '12',
                '--repo',
                'jcosta33/sourdaw',
                '--json',
                'labels,milestone',
            ]);
            expect(issueProjectItemsArgs(12)).toEqual([
                'issue',
                'view',
                '12',
                '--repo',
                'jcosta33/sourdaw',
                '--json',
                'projectItems',
            ]);
            expect(openMilestoneTitlesArgs()).toEqual(['api', 'repos/jcosta33/sourdaw/milestones?state=open']);
            expect(projectListArgs('jcosta33')).toEqual(['project', 'list', '--owner', 'jcosta33', '--format', 'json']);
            // gh's default page is 30; the limit keeps a growing label set from being truncated,
            // and the description is what the authorship fence reads.
            expect(labelListArgs()).toEqual(['label', 'list', '--limit', '200', '--json', 'name,description']);
            expect(pullRequestMetadataArgs(41)).toEqual([
                'pr',
                'view',
                '41',
                '--repo',
                'jcosta33/sourdaw',
                '--json',
                'labels,milestone',
            ]);
            expect(pullRequestProjectItemsArgs(41)).toEqual([
                'pr',
                'view',
                '41',
                '--repo',
                'jcosta33/sourdaw',
                '--json',
                'projectItems',
            ]);
        });

        it('parses tracker, milestone, project, label, and pull-request rows defensively', () => {
            expect(
                trackerMetadataFromIssueRow({
                    labels: [
                        { name: 'bug', description: "Something isn't working" },
                        'enhancement',
                        { name: 'kimi-k2.5', description: 'Authored by kimi-k2.5' },
                        {},
                        7,
                    ],
                    milestone: { title: 'v1.2' },
                })
            ).toEqual({
                milestoneTitle: 'v1.2',
                labels: [
                    { name: 'bug', description: "Something isn't working" },
                    { name: 'enhancement' },
                    { name: 'kimi-k2.5', description: 'Authored by kimi-k2.5' },
                ],
            });
            expect(trackerMetadataFromIssueRow({ milestone: null })).toEqual({ labels: [] });
            expect(
                projectTitlesFromRow({ projectItems: [{ title: 'Roadmap' }, { title: 'Roadmap' }, {}, { title: 3 }] })
            ).toEqual(['Roadmap']);
            expect(projectTitlesFromRow({ projectItems: undefined })).toEqual([]);
            expect(openMilestoneTitlesFromRows([{ title: 'v1.2' }, { title: 3 }, 'bare'])).toEqual(['v1.2']);
            expect(() => openMilestoneTitlesFromRows({})).toThrow(/malformed/);
            expect(projectTitlesFromListing({ projects: [{ title: 'Roadmap' }], totalCount: 1 })).toEqual(['Roadmap']);
            expect(() => projectTitlesFromListing([{ title: 'Roadmap' }])).toThrow(/malformed/);
            expect(
                labelRowsFromListing([
                    { name: 'bug', description: "Something isn't working" },
                    { name: 'glm-5.3', description: 'Authored by glm-5.3' },
                    { name: 3 },
                    'enhancement',
                    {},
                ])
            ).toEqual([
                { name: 'bug', description: "Something isn't working" },
                { name: 'glm-5.3', description: 'Authored by glm-5.3' },
                { name: 'enhancement' },
            ]);
            expect(() => labelRowsFromListing({})).toThrow(/malformed/);
            expect(
                pullRequestLabelMetadataFromRow({
                    labels: [{ name: 'glm-5.3' }, 'bug', {}],
                    milestone: { title: 'v1.2' },
                })
            ).toEqual({
                labels: ['glm-5.3', 'bug'],
                fencedAuthorLabels: [],
                milestoneTitle: 'v1.2',
            });
            expect(pullRequestLabelMetadataFromRow({ labels: undefined, milestone: null })).toEqual({
                labels: [],
                fencedAuthorLabels: [],
            });
            expect(mergeabilityFromPullRequestRow({ mergeable: 'CONFLICTING' })).toBe('conflicting');
            expect(mergeabilityFromPullRequestRow({ mergeable: 'MERGEABLE' })).toBe('mergeable');
            expect(mergeabilityFromPullRequestRow({ mergeable: 'UNKNOWN' })).toBe('unknown');
            expect(mergeabilityFromPullRequestRow({ mergeable: 3 })).toBe('unknown');
            expect(mergeabilityFromPullRequestRow({})).toBe('unknown');
            expect(
                conflictingPathsFromMergeTree(
                    'tree-oid\na.ts\nb.ts\n\nAuto-merging a.ts\nCONFLICT (content): Merge conflict in a.ts\n'
                )
            ).toEqual(['a.ts', 'b.ts']);
            expect(conflictingPathsFromMergeTree('tree-oid\n')).toEqual([]);
        });

        it('drops the issue-workflow namespaces and authored-by labels from inherited labels', () => {
            expect(
                descriptiveLabelNames([
                    { name: 'bug' },
                    { name: 'priority:P2' },
                    { name: 'status:ready' },
                    { name: 'kimi-k2.5', description: 'Authored by kimi-k2.5' },
                    { name: 'enhancement' },
                ])
            ).toEqual(['bug', 'enhancement']);
            expect(descriptiveLabelNames([])).toEqual([]);
        });

        it('derives one type label from the conventional subject and nothing beyond the map', () => {
            expect(derivedLabelFromSubject('feat(vcs): add identities')).toBe('enhancement');
            expect(derivedLabelFromSubject('fix(audio): repair dropout')).toBe('bug');
            expect(derivedLabelFromSubject('docs: explain lanes')).toBe('documentation');
            // TITLE_PATTERN's breaking-change marker derives like the plain type.
            expect(derivedLabelFromSubject('feat!: change the storage format')).toBe('enhancement');
            expect(derivedLabelFromSubject('fix(ui)!: urgent regression')).toBe('bug');
            expect(derivedLabelFromSubject('chore(build): bump')).toBeUndefined();
            expect(derivedLabelFromSubject('test(delivery): cover publish')).toBeUndefined();
            expect(derivedLabelFromSubject('refactor: simplify')).toBeUndefined();
            expect(derivedLabelFromSubject('Knob polishing pass')).toBeUndefined();
        });

        it('derives the board an issueless lane belongs on from its type label', () => {
            expect(derivedProjectFromSubject('fix(audio): repair dropout')).toBe('Sourdaw Bugs');
            expect(derivedProjectFromSubject('feat(vcs): add identities')).toBe('Sourdaw Roadmap');
            expect(derivedProjectFromSubject('docs: explain lanes')).toBe('Sourdaw Roadmap');
            expect(derivedProjectFromSubject('fix(ui)!: urgent regression')).toBe('Sourdaw Bugs');
            // A type outside the label map names work that is none of the three, so it names no
            // board either — the same deliberately small map, read once.
            expect(derivedProjectFromSubject('chore(build): bump')).toBeUndefined();
            expect(derivedProjectFromSubject('refactor: simplify')).toBeUndefined();
            expect(derivedProjectFromSubject('Knob polishing pass')).toBeUndefined();
        });

        it('resolves --label values to the canonical live spelling', () => {
            const known: LabelRow[] = [
                { name: 'bug', description: "Something isn't working" },
                { name: 'enhancement' },
            ];
            expect(canonicalLabelName('ENHANCEMENT', known)).toBe('enhancement');
            expect(() => canonicalLabelName('Nope', known)).toThrow(/--label "Nope" matches no label in gh label list/);
        });

        it('refuses a --label that resolves to an authored-by label, in every casing', () => {
            // The fence is the `Authored by ` description of the resolved label, and resolution
            // is case-insensitive, so every casing of the bare model token lands on the
            // repository's authorship label and refuses.
            const known: LabelRow[] = [
                { name: 'bug' },
                { name: 'glm-5.3', description: 'Authored by glm-5.3' },
                { name: 'model:glm-5.3', description: 'Authored by glm-5.3' },
            ];
            expect(canonicalLabelName('BUG', known)).toBe('bug');
            for (const spelling of ['glm-5.3', 'GLM-5.3', 'Glm-5.3']) {
                expect(() => canonicalLabelName(spelling, known)).toThrow(
                    `--label "${spelling}" names an authoring model; the authoring model is set with --model <model>, never --label`
                );
            }
            // A pre-change `model:`-prefixed label carries the same Authored-by description, so
            // the description fence still catches the legacy spelling now that no prefix check runs.
            expect(() => canonicalLabelName('MODEL:GLM-5.3', known)).toThrow(/names an authoring model/);
        });

        it('removes exactly the fenced authorship labels a model change supersedes', () => {
            const target = { model: 'glm-5.3', labels: ['glm-5.3'], projectTitles: [] };
            // A republish with a different --model leaves the previous fence behind (the old
            // add-only plan accumulated them); only the current model's fence may stay.
            const plan = metadataEditPlan(target, {
                labels: ['glm-5.3', 'glm-5.3-flash'],
                fencedAuthorLabels: ['glm-5.3', 'glm-5.3-flash'],
                projectTitles: [],
            });
            expect(plan).toEqual({ addLabels: [], removeLabels: ['glm-5.3-flash'], addProjectTitles: [] });
            // Every stale fence goes, not just the first.
            expect(
                metadataEditPlan(target, {
                    labels: ['glm-5.3', 'glm-5.3-flash', 'claude-opus-5'],
                    fencedAuthorLabels: ['glm-5.3', 'glm-5.3-flash', 'claude-opus-5'],
                    projectTitles: [],
                })?.removeLabels
            ).toEqual(['glm-5.3-flash', 'claude-opus-5']);
            if (plan === undefined) {
                throw new Error('expected a metadata edit plan');
            }
            expect(applyPullRequestMetadataArgs(42, plan)).toEqual([
                'pr',
                'edit',
                '42',
                '--repo',
                'jcosta33/sourdaw',
                '--remove-label',
                'glm-5.3-flash',
            ]);
            // The current fence survives a case-variant spelling, and a label outside the fence
            // list is never a removal candidate even when it shares a model's name.
            expect(
                metadataEditPlan(target, {
                    labels: ['glm-5.3'],
                    fencedAuthorLabels: ['GLM-5.3'],
                    projectTitles: [],
                })
            ).toBeUndefined();
            // Matching fences alone produce no edit at all.
            expect(
                metadataEditPlan(target, {
                    labels: ['glm-5.3'],
                    fencedAuthorLabels: ['glm-5.3'],
                    projectTitles: [],
                })
            ).toBeUndefined();
        });

        it('reads fenced authorship labels from the pull-request row', () => {
            expect(
                pullRequestLabelMetadataFromRow({
                    labels: [
                        { name: 'bug', description: 'Something is broken' },
                        { name: 'glm-5.3', description: 'Authored by glm-5.3' },
                        { name: 'glm-5.3-flash', description: 'Authored by glm-5.3-flash' },
                    ],
                }).fencedAuthorLabels
            ).toEqual(['glm-5.3', 'glm-5.3-flash']);
        });

        it('edits only the metadata pieces the pull request is missing', () => {
            const target = {
                model: 'glm-5.3',
                labels: ['glm-5.3', 'bug'],
                milestoneTitle: 'v1.2',
                projectTitles: ['Roadmap', 'Triage'],
            };
            const plan = metadataEditPlan(target, {
                labels: ['glm-5.3', 'enhancement'],
                fencedAuthorLabels: ['glm-5.3'],
                milestoneTitle: 'v1.0',
                projectTitles: ['Triage'],
            });
            expect(plan).toEqual({
                addLabels: ['bug'],
                removeLabels: [],
                milestoneTitle: 'v1.2',
                addProjectTitles: ['Roadmap'],
            });
            if (plan === undefined) {
                throw new Error('expected a metadata edit plan');
            }
            // The App edit carries labels and milestone only: --add-project needs the operator
            // credential, and one gh call cannot hold both identities.
            expect(applyPullRequestMetadataArgs(41, plan)).toEqual([
                'pr',
                'edit',
                '41',
                '--repo',
                'jcosta33/sourdaw',
                '--add-label',
                'bug',
                '--milestone',
                'v1.2',
            ]);
            expect(addPullRequestProjectsArgs(41, plan.addProjectTitles)).toEqual([
                'pr',
                'edit',
                '41',
                '--repo',
                'jcosta33/sourdaw',
                '--add-project',
                'Roadmap',
            ]);
            expect(addPullRequestProjectsArgs(41, ['Sourdaw Bugs', 'Sourdaw Roadmap'])).toEqual([
                'pr',
                'edit',
                '41',
                '--repo',
                'jcosta33/sourdaw',
                '--add-project',
                'Sourdaw Bugs',
                '--add-project',
                'Sourdaw Roadmap',
            ]);
        });

        it('composes one edit carrying every missing label', () => {
            const plan = metadataEditPlan(
                { model: 'glm-5.3', labels: ['glm-5.3', 'bug', 'security'], projectTitles: [] },
                { labels: [], fencedAuthorLabels: [], projectTitles: [] }
            );
            if (plan === undefined) {
                throw new Error('expected a metadata edit plan');
            }
            expect(applyPullRequestMetadataArgs(88, plan)).toEqual([
                'pr',
                'edit',
                '88',
                '--repo',
                'jcosta33/sourdaw',
                '--add-label',
                'glm-5.3',
                '--add-label',
                'bug',
                '--add-label',
                'security',
            ]);
        });

        it('issues no metadata edit when the pull request already carries the target', () => {
            const complete = metadataEditPlan(
                {
                    model: 'glm-5.3',
                    labels: ['glm-5.3', 'bug'],
                    milestoneTitle: 'v1.2',
                    projectTitles: ['Roadmap'],
                },
                {
                    labels: ['bug', 'glm-5.3'],
                    fencedAuthorLabels: ['glm-5.3'],
                    milestoneTitle: 'v1.2',
                    projectTitles: ['Roadmap'],
                }
            );
            expect(complete).toBeUndefined();
        });

        it('labels and asserts metadata on a freshly created pull request', () => {
            const { port, calls } = fakePort({ currentMetadata: { labels: [], projectTitles: [] } });

            expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            const labelIndex = calls.indexOf('label:glm-5.3');
            const createIndex = calls.findIndex((call) => call.startsWith('create:'));
            expect(labelIndex).toBeGreaterThanOrEqual(0);
            expect(labelIndex).toBeGreaterThan(calls.indexOf('push:agent/12/work'));
            expect(labelIndex).toBeLessThan(createIndex);
            expect(calls).toContain('prMeta:88');
            expect(calls).toContain('metaEdit:88:glm-5.3:-:-:-');
        });

        it('makes no metadata call at all when the pull request is already complete', () => {
            const { port, calls } = fakePort();

            expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(calls).toContain('label:glm-5.3');
            expect(calls).toContain('prMeta:88');
            expect(calls.some((call) => call.startsWith('metaEdit:'))).toBe(false);
        });

        it('backfills an explicit --model into the branch config and lets it override the recorded one', () => {
            const { port, calls } = fakePort({ currentMetadata: { labels: [], projectTitles: [] } });

            publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, { model: 'kimi-k2.5' });

            expect(calls).toContain('saveModel:agent/12/work:kimi-k2.5');
            expect(calls).toContain('label:kimi-k2.5');
            expect(calls).toContain('metaEdit:88:kimi-k2.5:-:-:-');
            expect(calls.some((call) => call.startsWith('label:glm-5.3'))).toBe(false);
        });

        it('fails closed on a lane with no model on record, naming the backfill', () => {
            const { port, calls } = fakePort({ authorModel: null });

            expect(() => publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toThrow(
                /agent\/12\/work has no authoring model on record; backfill it with pnpm lane:publish --model <model>, the lowercase public name of the model itself, e.g. glm-5.3-flash/
            );
            expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('label:'))).toBe(false);
        });

        it('skips an inherited milestone that is no longer open and dedupes inherited projects', () => {
            const { port, calls, logs } = fakePort({
                issueTracker: {
                    milestone: { title: 'v1.2' },
                    projectItems: [{ title: 'Roadmap' }, { title: 'Roadmap' }, { title: 'Triage' }],
                },
                openMilestoneTitles: ['v1.1'],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);

            expect(calls).toContain('milestones');
            expect(logs).toContain(
                'milestone "v1.2" on the lane\'s issue is no longer open; leaving the pull request milestone unset'
            );
            expect(calls).toContain('metaEdit:88:glm-5.3:-:Roadmap,Triage:-');
        });

        it('carries an open inherited milestone onto the pull request', () => {
            const { port, calls } = fakePort({
                issueTracker: { milestone: { title: 'v1.2' }, projectItems: [] },
                openMilestoneTitles: ['V1.2'],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);

            expect(calls).toContain('metaEdit:88:glm-5.3:v1.2:-:-');
        });

        it('lets --milestone and --project flags override what the issue carries', () => {
            const { port, calls } = fakePort({
                issueTracker: { milestone: { title: 'v1.2' }, projectItems: [{ title: 'Roadmap' }] },
                openMilestoneTitles: ['v1.2', 'v1.3'],
                knownProjects: ['Backlog'],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                milestone: 'v1.3',
                projects: ['Backlog'],
            });

            expect(calls).toContain('metaEdit:88:glm-5.3:v1.3:Backlog:-');
        });

        it('resolves flag titles to the canonical spelling the tracker reports', () => {
            expect(canonicalMilestoneTitle('V1.2', ['v1.1', 'v1.2'])).toBe('v1.2');
            expect(() => canonicalMilestoneTitle('v9.9', ['v1.2'])).toThrow(/matches no open milestone/);
            expect(canonicalProjectTitle('ROADMAP', ['Roadmap', 'Triage'])).toBe('Roadmap');
            expect(() => canonicalProjectTitle('Nope', ['Roadmap'])).toThrow(/matches no project/);
        });

        it('carries the canonical milestone spelling so a case-variant flag converges', () => {
            const { port, calls } = fakePort({
                openMilestoneTitles: ['v1.2'],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                milestone: 'V1.2',
            });

            // The edit carries the canonical 'v1.2', so a pull request that already stores it is
            // complete and the second publish issues no metadata edit at all.
            expect(calls).toContain('metaEdit:88:glm-5.3:v1.2:-:-');
            const afterFirst = calls.length;
            port.readPullRequestMetadata = () => ({
                labels: ['glm-5.3'],
                fencedAuthorLabels: ['glm-5.3'],
                milestoneTitle: 'v1.2',
            });

            publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                milestone: 'V1.2',
            });

            expect(calls.slice(afterFirst).some((call) => call.startsWith('metaEdit:'))).toBe(false);
        });

        it('applies one project once across repeated case-variant --project spellings', () => {
            const { port, calls } = fakePort({
                knownProjects: ['Roadmap'],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                projects: ['Roadmap', 'ROADMAP'],
            });

            expect(calls).toContain('metaEdit:88:glm-5.3:-:Roadmap:-');
            expect(calls).not.toContain('metaEdit:88:glm-5.3:-:Roadmap,Roadmap:-');
        });

        it('does not persist the model when a metadata validation refuses the run', () => {
            const { port, calls } = fakePort({ openMilestoneTitles: ['v1.2'] });

            expect(() =>
                publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                    model: 'kimi-k2.5',
                    milestone: 'v9.9',
                })
            ).toThrow(/matches no open milestone/);
            expect(calls.some((call) => call.startsWith('saveModel:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('label:'))).toBe(false);
        });

        it('inherits the bound issue labels minus the workflow namespaces and authored-by labels', () => {
            const { port, calls } = fakePort({
                issueTracker: {
                    labels: [
                        { name: 'bug' },
                        { name: 'priority:P2' },
                        { name: 'status:ready' },
                        { name: 'kimi-k2.5', description: 'Authored by kimi-k2.5' },
                        { name: 'glm-5.3', description: 'Authored by glm-5.3' },
                    ],
                    milestone: null,
                    projectItems: [],
                },
                currentMetadata: { labels: [], projectTitles: [] },
            });

            expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            // Exactly bug joins the model label — once: the boards' namespaces stay on the issue,
            // and an authorship label is this lane's own record, never inherited, so the issue's
            // authorship labels contribute nothing and the head of the list is not duplicated.
            expect(calls).toContain('metaEdit:88:glm-5.3,bug:-:-:-');
            expect(calls.some((call) => call.includes('priority:'))).toBe(false);
            expect(calls.some((call) => call.includes('status:'))).toBe(false);
            expect(calls.some((call) => call.includes('kimi'))).toBe(false);
        });

        it('derives the type label from the lane subject on an issueless lane without flags', () => {
            const { port, calls } = fakePort({
                trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
                cwd: CLEANUP_LANE,
                currentMetadata: { labels: [], projectTitles: [] },
            });

            expect(publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(calls.some((call) => call.startsWith('issueView:'))).toBe(false);
            expect(calls).toContain('metaEdit:88:glm-5.3,enhancement:-:-:-');
        });

        it('puts an issueless fix lane on the bugs board its type label names', () => {
            const { port, calls } = fakePort({
                trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
                cwd: CLEANUP_LANE,
                subject: 'fix(audio): repair the dropout',
                knownProjects: ['Sourdaw Bugs', 'Sourdaw Roadmap'],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            expect(publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(calls).toContain('projectList');
            expect(calls.some((call) => call.startsWith('issueProjects:'))).toBe(false);
            expect(calls).toContain('metaEdit:88:glm-5.3,bug:-:Sourdaw Bugs:-');
        });

        it('carries the live spelling of a derived board, not the table spelling', () => {
            const { port, calls } = fakePort({
                trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
                cwd: CLEANUP_LANE,
                subject: 'docs: explain the lane contract',
                knownProjects: ['SOURDAW ROADMAP'],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            expect(publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(calls).toContain('metaEdit:88:glm-5.3,documentation:-:SOURDAW ROADMAP:-');
        });

        it('derives from the frozen existing title on a republish, not the newest subject', () => {
            // lane:publish never retitles: the PR keeps the feat title it opened with, so a
            // fix-typed follow-up commit must not smuggle bug in next to enhancement.
            const { port, calls } = fakePort({
                trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
                cwd: CLEANUP_LANE,
                existing: 41,
                existingTitle: 'feat(foo): add knob',
                existingBody: composePublishBody(undefined, 'feat(foo): add knob', DEFAULT_SUMMARY, TEST_INSTRUCTIONS),
                subject: 'fix(foo): tighten knob',
                currentMetadata: { labels: [], projectTitles: [] },
            });

            expect(publishLane(undefined, port)).toBe(41);

            expect(calls).toContain('metaEdit:41:glm-5.3,enhancement:-:-:-');
            expect(calls.some((call) => call.includes('bug'))).toBe(false);
        });

        it('derives nothing from a manually retitled pull request', () => {
            const { port, calls } = fakePort({
                trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
                cwd: CLEANUP_LANE,
                existing: 41,
                existingTitle: 'Knob polishing pass',
                existingBody: composePublishBody(undefined, 'Knob polishing pass', DEFAULT_SUMMARY, TEST_INSTRUCTIONS),
                currentMetadata: { labels: [], projectTitles: [] },
            });

            expect(publishLane(undefined, port)).toBe(41);

            expect(calls).toContain('metaEdit:41:glm-5.3:-:-:-');
        });

        it('refuses a --label that resolves to an authored-by label before any write', () => {
            // The fence is the `Authored by ` description of the resolved label, and resolution
            // is case-insensitive, so every casing of the bare model token lands on the
            // repository's authorship label and refuses — it cannot sit next to a different
            // recorded model, and the refusal lands before the flagged model record persists.
            for (const spelling of ['glm-5.3', 'GLM-5.3', 'Glm-5.3']) {
                const { port, calls } = fakePort({
                    repositoryLabels: [{ name: 'bug' }, { name: 'glm-5.3', description: 'Authored by glm-5.3' }],
                });

                expect(() =>
                    publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                        model: 'kimi-k2.5',
                        labels: [spelling],
                    })
                ).toThrow(/names an authoring model; the authoring model is set with --model <model>, never --label/);
                expect(calls).toContain('labelList');
                expect(calls.some((call) => call.startsWith('saveModel:'))).toBe(false);
                expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
                expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
                expect(calls.some((call) => call.startsWith('label:'))).toBe(false);
                expect(calls.some((call) => call.startsWith('metaEdit:'))).toBe(false);
            }
        });

        it('refuses a model token that collides with a repository label before any write', () => {
            // `gh label create --force` would rewrite the color and description of whatever
            // label already owns the name, so a token naming a descriptive label must refuse
            // while nothing is written — in every casing, because GitHub holds label names
            // unique case-insensitively and the update would find the descriptive label anyway.
            for (const existing of ['security', 'Security']) {
                const { port, calls } = fakePort({
                    repositoryLabels: [{ name: existing, description: 'Something is not working' }],
                });

                expect(() =>
                    publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                        model: 'security',
                    })
                ).toThrow(
                    'the model token "security" collides with an existing repository label; ' +
                        "authorship labels never overwrite one; pick the model's exact public name"
                );
                expect(calls).toContain('labelList');
                expect(calls.some((call) => call.startsWith('saveModel:'))).toBe(false);
                expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
                expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
                expect(calls.some((call) => call.startsWith('label:'))).toBe(false);
                expect(calls.some((call) => call.startsWith('metaEdit:'))).toBe(false);
            }
        });

        it("publishes when the model's own label exists or the name is free", () => {
            // The guard's other two outcomes: a same-named label carrying the Authored-by
            // description is this mechanism's own output (the --force update lands on it), and a
            // name no label holds creates fresh.
            const own = fakePort({
                repositoryLabels: [{ name: 'glm-5.3', description: 'Authored by glm-5.3' }],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            expect(publishLane(12, own.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);
            expect(own.calls).toContain('label:glm-5.3');
            expect(own.calls).toContain('metaEdit:88:glm-5.3:-:-:-');

            const fresh = fakePort({
                repositoryLabels: [{ name: 'security', description: 'Something is not working' }],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            expect(publishLane(12, fresh.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);
            expect(fresh.calls).toContain('label:glm-5.3');
            expect(fresh.calls).toContain('metaEdit:88:glm-5.3:-:-:-');
        });

        it('refuses an unknown --label before writing anything, naming the live list', () => {
            const { port, calls } = fakePort({
                repositoryLabels: [{ name: 'bug', description: "Something isn't working" }, { name: 'enhancement' }],
            });

            expect(() =>
                publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                    model: 'kimi-k2.5',
                    labels: ['Nope'],
                })
            ).toThrow(/--label "Nope" matches no label in gh label list for jcosta33\/sourdaw/);
            expect(calls).toContain('labelList');
            expect(calls.some((call) => call.startsWith('saveModel:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('metaEdit:'))).toBe(false);
        });

        it('unions canonical --label flags with inheritance, deduped, in one edit', () => {
            const { port, calls } = fakePort({
                issueTracker: {
                    labels: [{ name: 'bug' }, { name: 'enhancement' }],
                    milestone: null,
                    projectItems: [],
                },
                repositoryLabels: [{ name: 'bug' }, { name: 'enhancement' }, { name: 'security' }],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                labels: ['ENHANCEMENT', 'security'],
            });

            expect(calls).toContain('labelList');
            // bug is inherited, enhancement arrives as a case-variant flag and dedupes against the
            // inherited spelling, security comes from the flag: all missing labels in ONE edit.
            expect(calls).toContain('metaEdit:88:glm-5.3,bug,enhancement,security:-:-:-');
            expect(calls.filter((call) => call.startsWith('metaEdit:'))).toHaveLength(1);
        });

        it('issues no metadata edit when the pull request already carries every label', () => {
            const { port, calls } = fakePort({
                issueTracker: {
                    labels: [{ name: 'bug' }],
                    milestone: null,
                    projectItems: [],
                },
                currentMetadata: { labels: ['glm-5.3', 'bug'], projectTitles: [] },
            });

            expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(calls).toContain('prMeta:88');
            expect(calls.some((call) => call.startsWith('metaEdit:'))).toBe(false);
        });

        it("fails an explicit --project when the owner's projects cannot be listed", () => {
            const { port, calls } = fakePort({ projectListError: 'cannot verify orchestrator authentication' });

            expect(() =>
                publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                    projects: ['Roadmap'],
                })
            ).toThrow(/installation tokens cannot access user-owned Projects v2/);
            expect(calls).toContain('projectList');
            expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('label:'))).toBe(false);
        });

        it('skips project inheritance loudly when the operator credential cannot list projects', () => {
            // Without a usable operator credential the owner's user-owned projects are unreadable,
            // so the bound issue's own membership cannot be read either. The probe must fire before
            // the inherited read, not after it, or the publish dies where it should warn.
            const { port, calls, logs } = fakePort({
                issueTracker: { milestone: { title: 'v1.2' }, projectItems: [{ title: 'Sourdaw Roadmap' }] },
                openMilestoneTitles: ['v1.2'],
                projectListError: 'cannot verify orchestrator authentication',
                currentMetadata: { labels: [], milestoneTitle: 'v1.0', projectTitles: [] },
            });

            expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(calls).toContain('projectList');
            expect(calls.some((call) => call.startsWith('issueProjects:'))).toBe(false);
            expect(logs).toContain(
                "cannot list the owner's projects with the verified operator credential " +
                    "(cannot verify orchestrator authentication); leaving the pull request's project " +
                    'membership to the operator backfill'
            );
            // Label and milestone still asserted, with no --add-project piece: the skip must not
            // drop the whole metadata assertion.
            expect(calls).toContain('metaEdit:88:glm-5.3:v1.2:-:-');
        });

        it('applies no projects and stays quiet when a bound issue reads empty and the list succeeds', () => {
            const { port, calls, logs } = fakePort({
                issueTracker: { milestone: null, projectItems: [] },
                currentMetadata: { labels: [], projectTitles: [] },
            });

            publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);

            expect(calls).toContain('projectList');
            expect(calls).toContain('issueProjects:12');
            expect(logs.some((line) => line.startsWith("cannot list the owner's projects"))).toBe(false);
            expect(calls).toContain('metaEdit:88:glm-5.3:-:-:-');
            // Nothing to add, so the pull request's own membership is never read either.
            expect(calls.some((call) => call.startsWith('prProjects:'))).toBe(false);
        });

        it('skips the project-list probe entirely when nothing can name a project', () => {
            // No issue, no flags, and a subject type that derives neither a label nor a board.
            const { port, calls } = fakePort({
                trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
                cwd: CLEANUP_LANE,
                subject: 'chore(build): bump the toolchain',
            });

            expect(publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(calls.some((call) => call === 'projectList')).toBe(false);
            expect(calls.some((call) => call.startsWith('issueView:'))).toBe(false);
        });

        it("applies a canonical --project on an issueless lane when the owner's projects list", () => {
            // The flags half of the probe trigger: nothing is inherited on this lane, so the
            // project piece of the edit can only come from the flag through the probe. If the
            // probe's guard ignored flags, the edit would carry no project piece at all. The
            // board this feat subject would derive is in the listing too, so the flag has to
            // replace it rather than join it.
            const { port, calls } = fakePort({
                trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
                cwd: CLEANUP_LANE,
                knownProjects: ['Roadmap', 'Sourdaw Roadmap'],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            expect(
                publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                    model: 'glm-5.3',
                    projects: ['ROADMAP'],
                })
            ).toBe(88);

            expect(calls).toContain('projectList');
            expect(calls.some((call) => call.startsWith('issueView:'))).toBe(false);
            // The default fixture subject is feat(...), so the derived enhancement label rides in
            // the same single edit as the model label and the canonicalized project.
            expect(calls).toContain('metaEdit:88:glm-5.3,enhancement:-:Roadmap:-');
        });

        it("fails an explicit --project on an issueless lane when the owner's projects cannot be listed", () => {
            const { port, calls } = fakePort({
                trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
                cwd: CLEANUP_LANE,
                projectListError: 'cannot verify orchestrator authentication',
            });

            expect(() =>
                publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                    model: 'glm-5.3',
                    projects: ['Roadmap'],
                })
            ).toThrow(/installation tokens cannot access user-owned Projects v2.*operator backfill/);
            expect(calls).toContain('projectList');
            expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('label:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('metaEdit:'))).toBe(false);
        });

        it("applies inherited projects when the operator credential can list the owner's projects", () => {
            const { port, calls } = fakePort({
                issueTracker: { milestone: null, projectItems: [{ title: 'Roadmap' }] },
                knownProjects: ['Roadmap'],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);

            // The probe proves the credential before the issue's own membership is read through it.
            expect(calls.indexOf('projectList')).toBeGreaterThanOrEqual(0);
            expect(calls.indexOf('issueProjects:12')).toBeGreaterThan(calls.indexOf('projectList'));
            expect(calls).toContain('prProjects:88');
            expect(calls).toContain('metaEdit:88:glm-5.3:-:Roadmap:-');
        });

        it('leaves the pull request off every board when its derived project does not exist', () => {
            const { port, calls, logs } = fakePort({
                trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
                cwd: CLEANUP_LANE,
                subject: 'fix(audio): repair the dropout',
                knownProjects: ['Sourdaw Roadmap'],
                currentMetadata: { labels: [], projectTitles: [] },
            });

            expect(publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(logs).toContain(
                'no project named "Sourdaw Bugs" exists for jcosta33/sourdaw\'s owner; leaving this ' +
                    "issueless lane's pull request off every board"
            );
            expect(calls).toContain('metaEdit:88:glm-5.3,bug:-:-:-');
        });

        it('skips the derived project loudly when the operator credential cannot list projects', () => {
            const { port, calls, logs } = fakePort({
                trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
                cwd: CLEANUP_LANE,
                subject: 'fix(audio): repair the dropout',
                projectListError: 'cannot read stored orchestrator authentication',
                currentMetadata: { labels: [], projectTitles: [] },
            });

            expect(publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(calls).toContain('projectList');
            expect(logs).toContain(
                "cannot list the owner's projects with the verified operator credential " +
                    "(cannot read stored orchestrator authentication); leaving the pull request's " +
                    'project membership to the operator backfill'
            );
            expect(calls).toContain('metaEdit:88:glm-5.3,bug:-:-:-');
        });

        it('refuses an unknown --milestone or --project before writing anything', () => {
            const unknownMilestone = fakePort({ openMilestoneTitles: ['v1.2'] });

            expect(() =>
                publishLane(12, unknownMilestone.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                    milestone: 'v9.9',
                })
            ).toThrow(/--milestone "v9\.9" matches no open milestone/);
            expect(unknownMilestone.calls.some((call) => call.startsWith('push:'))).toBe(false);
            expect(unknownMilestone.calls.some((call) => call.startsWith('create:'))).toBe(false);
            expect(unknownMilestone.calls.some((call) => call.startsWith('label:'))).toBe(false);

            const unknownProject = fakePort({ knownProjects: ['Roadmap'] });

            expect(() =>
                publishLane(12, unknownProject.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY, undefined, {
                    projects: ['Nope'],
                })
            ).toThrow(/--project "Nope" matches no project/);
            expect(unknownProject.calls.some((call) => call.startsWith('push:'))).toBe(false);
            expect(unknownProject.calls.some((call) => call.startsWith('label:'))).toBe(false);
        });

        it('reports a failed metadata edit as safely re-assertable', () => {
            const { port, calls } = fakePort({ currentMetadata: { labels: [], projectTitles: [] } });
            port.applyPullRequestMetadata = () => {
                throw new Error('gh: Label does not exist');
            };

            expect(() => publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toThrow(
                /the pull request exists, and rerunning pnpm lane:publish re-asserts its metadata safely/
            );
            expect(calls).toContain('push:agent/12/work');
            expect(calls.some((call) => call.startsWith('create:'))).toBe(true);
        });
    });
});

/**
 * The authorship gate is pinned against real Git so its delta semantics cannot drift from what the
 * push actually writes: a bare remote stands in for GitHub through `url.<remote>.insteadOf`, the
 * same substitution the push tests above use, and every git-backed port member is the real
 * `shellPort` one. Only the GitHub reads and writes are faked.
 */
describe('push delta authorship gate', () => {
    const BRANCH = 'agent/12/authorship';
    const HUMAN_EMAIL = 'fixture@example.com';

    function commitInLane(lane: string, filename: string, message: string, author: 'bot' | 'human' | 'forged'): string {
        writeFileSync(join(lane, filename), `${filename}\n`);
        fixtureGit(lane, ['add', '--', filename]);
        // 'forged' wears the App's display name under a foreign email: the gate keys on the email,
        // so this commit must be condemned exactly like any other foreign-authored one.
        const identities: Record<'bot' | 'human' | 'forged', NodeJS.ProcessEnv> = {
            bot: {
                GIT_AUTHOR_NAME: 'hplovecraft208[bot]',
                GIT_AUTHOR_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
                GIT_COMMITTER_NAME: 'hplovecraft208[bot]',
                GIT_COMMITTER_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
            },
            forged: {
                GIT_AUTHOR_NAME: 'hplovecraft208[bot]',
                GIT_AUTHOR_EMAIL: HUMAN_EMAIL,
                GIT_COMMITTER_NAME: 'hplovecraft208[bot]',
                GIT_COMMITTER_EMAIL: HUMAN_EMAIL,
            },
            human: {},
        };
        const overrides = identities[author];
        execFileSync('git', ['commit', '--no-gpg-sign', '-m', message], {
            cwd: lane,
            env: fixtureGitEnv(overrides),
            encoding: 'utf8',
        });
        return fixtureGit(lane, ['rev-parse', 'HEAD']);
    }

    function authorshipFixture(): {
        fixtureRoot: string;
        primary: string;
        lane: string;
        remote: string;
        baseSha: string;
        port: PublishLanePort;
        session: GhSession;
    } {
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-publish-authorship-'));
        const primary = join(fixtureRoot, 'primary');
        const lane = join(fixtureRoot, 'lane');
        const remote = join(fixtureRoot, 'remote.git');
        const systemGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        mkdirSync(primary, { recursive: true });
        fixtureGit(primary, ['init', '-b', 'main']);
        fixtureGit(primary, ['config', 'user.name', 'Fixture']);
        fixtureGit(primary, ['config', 'user.email', HUMAN_EMAIL]);
        writeFileSync(join(primary, 'base.txt'), 'base\n');
        fixtureGit(primary, ['add', 'base.txt']);
        fixtureGit(primary, ['commit', '--no-gpg-sign', '-m', 'chore: authorship fixture base']);
        const baseSha = fixtureGit(primary, ['rev-parse', 'HEAD']);
        fixtureGit(primary, ['worktree', 'add', '-b', BRANCH, lane]);
        fixtureGit(primary, ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, lane]);
        execFileSync(systemGit, ['init', '--bare', remote], {
            cwd: fixtureRoot,
            env: fixtureGitEnv(),
            encoding: 'utf8',
        });
        fixtureGit(primary, ['push', remote, 'main']);
        fixtureGit(primary, ['config', `url.${remote}.insteadOf`, GITHUB_HTTPS_REMOTE]);
        fixtureGit(primary, ['config', `branch.${BRANCH}.sourdaw-author-model`, 'glm-5.3']);
        const session = createGhSession('ghs_authorship_marker', { PATH: process.env.PATH });
        const port: PublishLanePort = {
            ...shellPort(session, lane, primary, { git: systemGit, gh: 'gh' }),
            issueExists: () => true,
            existingOpenPullRequest: () => undefined,
            createPullRequest: () => 88,
            updatePullRequest: () => undefined,
            readPullRequestMergeability: () => 'mergeable',
            ensureModelLabel: () => undefined,
            readIssueTrackerMetadata: () => trackerMetadataFromIssueRow({}),
            openMilestoneTitles: () => [],
            knownProjectTitles: () => {
                throw new Error('fixture holds no operator credential');
            },
            knownLabels: () => [],
            readPullRequestMetadata: () => ({ labels: [], fencedAuthorLabels: [] }),
            readPullRequestProjectTitles: () => [],
            applyPullRequestMetadata: () => undefined,
        };
        return { fixtureRoot, primary, lane, remote, baseSha, port, session };
    }

    function dispose(fixture: ReturnType<typeof authorshipFixture>): void {
        fixture.session.dispose();
        rmSync(fixture.fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }

    it('publishes a delta whose every commit is authored as the author App', () => {
        const f = authorshipFixture();
        try {
            commitInLane(f.lane, 'one.txt', 'feat(gate): first bot commit', 'bot');
            const head = commitInLane(f.lane, 'two.txt', 'feat(gate): second bot commit', 'bot');

            expect(publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toBe(head);
        } finally {
            dispose(f);
        }
    });

    it('refuses a delta carrying a human-authored commit before anything reaches the remote', () => {
        const f = authorshipFixture();
        try {
            commitInLane(f.lane, 'one.txt', 'feat(gate): bot commit', 'bot');
            commitInLane(f.lane, 'two.txt', 'feat(gate): human commit', 'human');

            const message = refusalMessage(() =>
                publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)
            );

            expect(message).toContain(`authored as ${HUMAN_EMAIL}`);
            expect(message).toContain('pnpm lane:identity');
            expect(message).toContain(
                `git rebase --rebase-merges --exec 'git commit --amend --reset-author --no-edit' ${f.baseSha}`
            );
            expect(() => fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toThrow();
        } finally {
            dispose(f);
        }
    });

    it('publishes when only the new delta is bot-authored and the remote tip holds human commits', () => {
        const f = authorshipFixture();
        try {
            const humanTip = commitInLane(f.lane, 'one.txt', 'feat(gate): human commit', 'human');
            fixtureGit(f.primary, ['push', f.remote, `${humanTip}:refs/heads/${BRANCH}`]);
            const head = commitInLane(f.lane, 'two.txt', 'feat(gate): bot commit on top', 'bot');
            // The full range above origin/main is deliberately not all-bot, so success below can
            // only come from gating the remote tip..head delta rather than the whole branch.
            expect(fixtureGit(f.lane, ['log', '--format=%ae', `${f.baseSha}..${head}`])).toContain(HUMAN_EMAIL);

            expect(publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toBe(head);
        } finally {
            dispose(f);
        }
    });

    const FOREIGN_EMAIL = 'dependabot[bot]@users.noreply.github.com';

    /** Advances the fixture's `main` with one foreign-authored commit and pushes it to the remote. */
    function commitForeignMainAdvance(primary: string, remote: string): void {
        writeFileSync(join(primary, 'main-side.txt'), 'main-side\n');
        fixtureGit(primary, ['add', 'main-side.txt']);
        execFileSync('git', ['commit', '--no-gpg-sign', '-m', 'chore: foreign main advance'], {
            cwd: primary,
            env: fixtureGitEnv({
                GIT_AUTHOR_NAME: 'dependabot[bot]',
                GIT_AUTHOR_EMAIL: FOREIGN_EMAIL,
                GIT_COMMITTER_NAME: 'dependabot[bot]',
                GIT_COMMITTER_EMAIL: FOREIGN_EMAIL,
            }),
            encoding: 'utf8',
        });
        fixtureGit(primary, ['push', remote, 'main']);
    }

    /** Merges the advanced `origin/main` into the lane as a merge commit the stamped lane authored. */
    function mergeMainAsBot(lane: string): void {
        fixtureGit(lane, ['fetch', GITHUB_HTTPS_REMOTE, '+refs/heads/main:refs/remotes/origin/main']);
        execFileSync('git', ['merge', '--no-edit', 'origin/main'], {
            cwd: lane,
            env: fixtureGitEnv({
                GIT_AUTHOR_NAME: 'hplovecraft208[bot]',
                GIT_AUTHOR_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
                GIT_COMMITTER_NAME: 'hplovecraft208[bot]',
                GIT_COMMITTER_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
            }),
            encoding: 'utf8',
        });
    }

    it('publishes a lane that merged a foreign-authored main while a remote tip exists', () => {
        const f = authorshipFixture();
        try {
            const remoteTip = commitInLane(f.lane, 'one.txt', 'feat(gate): first bot commit', 'bot');
            fixtureGit(f.primary, ['push', f.remote, `${remoteTip}:refs/heads/${BRANCH}`]);
            commitForeignMainAdvance(f.primary, f.remote);
            mergeMainAsBot(f.lane);
            const head = commitInLane(f.lane, 'two.txt', 'feat(gate): bot commit on merged main', 'bot');
            // The remote-tip..head delta holds the merged foreign commit, so success below can
            // only come from excluding the resolved base's side, never from gating that raw range.
            expect(fixtureGit(f.lane, ['log', '--format=%ae', `${remoteTip}..${head}`])).toContain(FOREIGN_EMAIL);

            expect(publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toBe(head);
        } finally {
            dispose(f);
        }
    });

    it('refuses a lane that merged a foreign-authored main while naming only the lane-owned human commit', () => {
        const f = authorshipFixture();
        try {
            const remoteTip = commitInLane(f.lane, 'one.txt', 'feat(gate): first bot commit', 'bot');
            fixtureGit(f.primary, ['push', f.remote, `${remoteTip}:refs/heads/${BRANCH}`]);
            commitForeignMainAdvance(f.primary, f.remote);
            mergeMainAsBot(f.lane);
            const head = commitInLane(f.lane, 'two.txt', 'feat(gate): human commit on merged main', 'human');
            // The foreign commit sits inside the raw remote-tip..head range, so a refusal naming
            // only the lane's own commit proves the base side was excluded, not rewritten.
            expect(fixtureGit(f.lane, ['log', '--format=%ae', `${remoteTip}..${head}`])).toContain(FOREIGN_EMAIL);

            const message = refusalMessage(() =>
                publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)
            );

            expect(message).toContain(`authored as ${HUMAN_EMAIL}`);
            expect(message).not.toContain(FOREIGN_EMAIL);
            expect(fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toBe(remoteTip);
        } finally {
            dispose(f);
        }
    });

    it('publishes a stack child whose merged main-side commit only the main exclusion clears', () => {
        const f = authorshipFixture();
        try {
            const parentBranch = 'agent/11/parent';
            // The parent head sits at the main tip the parent branched from; the foreign advance
            // below moves origin/main past it, so only the main exclusion — never the parent head —
            // reaches the main-side commit the child merged.
            f.port.stackBase = () => ({
                branch: parentBranch,
                head: f.baseSha,
                parentNumber: 11,
                parentState: 'OPEN',
                parentHead: f.baseSha,
            });
            f.port.pinStackParent = () => undefined;
            let created = false;
            f.port.createPullRequest = () => {
                created = true;
                return 88;
            };
            const remoteTip = commitInLane(f.lane, 'one.txt', 'feat(gate): first bot commit', 'bot');
            fixtureGit(f.primary, ['push', f.remote, `${remoteTip}:refs/heads/${BRANCH}`]);
            commitForeignMainAdvance(f.primary, f.remote);
            mergeMainAsBot(f.lane);
            const head = commitInLane(f.lane, 'two.txt', 'feat(gate): bot commit on merged main', 'bot');
            const mainSha = fixtureGit(f.primary, ['rev-parse', 'main']);
            f.port.existingOpenPullRequest = () =>
                created
                    ? {
                          number: 88,
                          title: 'feat(gate): bot commit on merged main',
                          body: '',
                          baseRefName: parentBranch,
                          headRefOid: head,
                      }
                    : undefined;
            // With only the parent head excluded, the gated range still condemns the merged
            // main-side commit; both resolved bases together are what clear it.
            const emails = (excluded: string[]) =>
                f.port.commitAttribution(f.lane, remoteTip, excluded, head).map((commit) => commit.email);
            expect(emails([f.baseSha])).toContain(FOREIGN_EMAIL);
            expect(emails([f.baseSha, mainSha])).not.toContain(FOREIGN_EMAIL);

            expect(publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toBe(head);
        } finally {
            dispose(f);
        }
    });

    it('publishes a stack child of an open parent whose parent-head git-range pin aliases comparisonHead', () => {
        const f = authorshipFixture();
        try {
            const parentBranch = 'agent/11/parent';
            const parentLane = join(f.fixtureRoot, 'parent-lane');
            fixtureGit(f.primary, ['worktree', 'add', '-b', parentBranch, parentLane]);
            fixtureGit(f.primary, ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, parentLane]);
            commitInLane(parentLane, 'parent-one.txt', 'chore: parent first advance', 'human');
            const remoteTip = commitInLane(f.lane, 'one.txt', 'feat(gate): child bot commit', 'bot');
            fixtureGit(f.primary, ['push', f.remote, `${remoteTip}:refs/heads/${BRANCH}`]);
            // The parent head advances after the child's in-flight publish began, and the child
            // merges that advanced head as a bot-authored merge commit. origin/main never reaches
            // the parent's human commits. This OPEN fixture sets stackBase.head and parentHead to
            // the same SHA, so production comparisonHead aliases parentHead and the third
            // excluded-base slot is a duplicate of comparisonHead.
            const parentHead = commitInLane(parentLane, 'parent-two.txt', 'chore: parent second advance', 'human');
            execFileSync('git', ['merge', '--no-edit', parentHead], {
                cwd: f.lane,
                env: fixtureGitEnv({
                    GIT_AUTHOR_NAME: 'hplovecraft208[bot]',
                    GIT_AUTHOR_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
                    GIT_COMMITTER_NAME: 'hplovecraft208[bot]',
                    GIT_COMMITTER_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
                }),
                encoding: 'utf8',
            });
            const head = fixtureGit(f.lane, ['rev-parse', 'HEAD']);
            f.port.stackBase = () => ({
                branch: parentBranch,
                head: parentHead,
                parentNumber: 11,
                parentState: 'OPEN',
                parentHead,
            });
            f.port.pinStackParent = () => undefined;
            let created = false;
            f.port.createPullRequest = () => {
                created = true;
                return 88;
            };
            f.port.existingOpenPullRequest = () =>
                created
                    ? {
                          number: 88,
                          title: 'feat(gate): child bot commit',
                          body: '',
                          baseRefName: parentBranch,
                          headRefOid: head,
                      }
                    : undefined;
            // emails([baseSha]) still sees the parent's human commits and emails([parentHead])
            // clears them — a git-range fact, not a proof that dropping production stackParentHead
            // would refuse. Production assembly of a distinct third slot is observed by the sibling
            // `publishes a stack child of a merged parent whose retained commits only the parent-head
            // exclusion clears`.
            const emails = (excluded: string[]) =>
                f.port.commitAttribution(f.lane, remoteTip, excluded, head).map((commit) => commit.email);
            expect(emails([f.baseSha])).toContain(HUMAN_EMAIL);
            expect(emails([parentHead])).not.toContain(HUMAN_EMAIL);

            expect(publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toBe(head);
        } finally {
            dispose(f);
        }
    });

    it('refuses publication while a replace ref exists, and still reads the human original beneath it', () => {
        const f = authorshipFixture();
        try {
            commitInLane(f.lane, 'one.txt', 'feat(gate): bot commit', 'bot');
            const humanHead = commitInLane(f.lane, 'two.txt', 'feat(gate): human commit', 'human');
            // A same-tree, same-parent clone authored as the App, grafted over the human commit:
            // plain reads follow the replacement and see only the bot author, while `git push`
            // packs the original object — the split the gate's read must not fall into.
            const tree = fixtureGit(f.lane, ['rev-parse', `${humanHead}^{tree}`]);
            const parent = fixtureGit(f.lane, ['rev-parse', `${humanHead}^`]);
            const clone = execFileSync('git', ['commit-tree', tree, '-p', parent, '-m', 'feat(gate): human commit'], {
                cwd: f.lane,
                env: fixtureGitEnv({
                    GIT_AUTHOR_NAME: 'hplovecraft208[bot]',
                    GIT_AUTHOR_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
                    GIT_COMMITTER_NAME: 'hplovecraft208[bot]',
                    GIT_COMMITTER_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
                }),
                encoding: 'utf8',
            }).trim();
            fixtureGit(f.lane, ['replace', humanHead, clone]);
            expect(fixtureGit(f.lane, ['log', '--format=%ae', `${f.baseSha}..${humanHead}`])).not.toContain(
                HUMAN_EMAIL
            );
            // The gate's own read disables replacements, so it still names the human original —
            // which is exactly why the read alone cannot decide a push: the store is split.
            expect(
                f.port
                    .commitAttribution(f.lane, f.baseSha, [f.baseSha, f.baseSha], humanHead)
                    .map((commit) => commit.email)
            ).toContain(HUMAN_EMAIL);

            const message = refusalMessage(() =>
                publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)
            );

            expect(message).toContain('info/grafts: none, refs/replace/* refs: 1');
            expect(() => fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toThrow();
        } finally {
            dispose(f);
        }
    });

    it('refuses a graft file the gate read itself follows, before anything reaches the remote', () => {
        const f = authorshipFixture();
        try {
            const humanCommit = commitInLane(f.lane, 'one.txt', 'feat(gate): human commit', 'human');
            const botHead = commitInLane(f.lane, 'two.txt', 'feat(gate): bot commit on top', 'bot');
            // Grafting the bot commit's parent to the base hides the human commit from the
            // `base..head` traversal, and `--no-replace-objects` does not stop it — grafts are
            // honored during traversal itself, so the gate's own read is fooled here, and only
            // refusing the file's existence keeps the read and the push on one history.
            expect(fixtureGit(f.lane, ['rev-parse', `${botHead}^`])).toBe(humanCommit);
            const graftsPath = join(f.primary, '.git', 'info', 'grafts');
            mkdirSync(dirname(graftsPath), { recursive: true });
            writeFileSync(graftsPath, `${botHead} ${f.baseSha}\n`);
            expect(
                f.port
                    .commitAttribution(f.lane, f.baseSha, [f.baseSha, f.baseSha], botHead)
                    .map((commit) => commit.email)
            ).not.toContain(HUMAN_EMAIL);

            const message = refusalMessage(() =>
                publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)
            );

            expect(message).toContain(graftsPath);
            expect(message).toContain('refs/replace/* refs: 0');
            expect(() => fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toThrow();
        } finally {
            dispose(f);
        }
    });

    it('refuses the merged-main repair push with a remedy never rooted at the remote tip', () => {
        const f = authorshipFixture();
        try {
            const remoteTip = commitInLane(f.lane, 'one.txt', 'feat(gate): first bot commit', 'bot');
            fixtureGit(f.primary, ['push', f.remote, `${remoteTip}:refs/heads/${BRANCH}`]);
            commitForeignMainAdvance(f.primary, f.remote);
            mergeMainAsBot(f.lane);
            const head = commitInLane(f.lane, 'two.txt', 'feat(gate): human commit on merged main', 'human');
            const shortSha = fixtureGit(f.lane, ['rev-parse', '--short', head]);

            const message = refusalMessage(() =>
                publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)
            );

            expect(message).toContain(`${shortSha} ${HUMAN_EMAIL}`);
            expect(message).toContain('pnpm lane:identity');
            // The remote branch already holds lane commits, so no rewrite command is offered at
            // all: the old remote-tip-rooted rebase replayed base-side commits as the App.
            expect(message).not.toContain('git rebase');
        } finally {
            dispose(f);
        }
    });

    it('offers a stack child no rebase when its parent head does not dominate the main it merged', () => {
        const f = authorshipFixture();
        try {
            const parentBranch = 'agent/11/parent';
            // The registered parent head stays at the main tip it branched from while origin/main
            // advances past it, so the comparison base dominates neither the main-side commits the
            // child merged nor any excluded base: rebasing onto it would re-author those commits
            // as the App, and re-creation is the only remedy that cannot.
            f.port.stackBase = () => ({
                branch: parentBranch,
                head: f.baseSha,
                parentNumber: 11,
                parentState: 'OPEN',
                parentHead: f.baseSha,
            });
            f.port.pinStackParent = () => undefined;
            f.port.createPullRequest = () => 88;
            commitForeignMainAdvance(f.primary, f.remote);
            mergeMainAsBot(f.lane);
            const head = commitInLane(f.lane, 'two.txt', 'feat(gate): human commit on merged main', 'human');
            const shortSha = fixtureGit(f.lane, ['rev-parse', '--short', head]);

            const message = refusalMessage(() =>
                publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)
            );

            expect(message).toContain(`${shortSha} ${HUMAN_EMAIL}`);
            expect(message).toContain('re-create the listed offending commits');
            expect(message).not.toContain('git rebase');
            expect(() => fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toThrow();
        } finally {
            dispose(f);
        }
    });

    it('offers the comparison-base rebase to a stack child whose parent head contains current main', () => {
        const f = authorshipFixture();
        try {
            const parentBranch = 'agent/11/parent';
            f.port.pinStackParent = () => undefined;
            commitForeignMainAdvance(f.primary, f.remote);
            mergeMainAsBot(f.lane);
            const mainSha = fixtureGit(f.primary, ['rev-parse', 'main']);
            // The registered parent head is exactly current main: the comparison base dominates
            // every excluded base, so the rewritten range can carry no base-side commit and the
            // rebase stays offerable, rooted at that base.
            f.port.stackBase = () => ({
                branch: parentBranch,
                head: mainSha,
                parentNumber: 11,
                parentState: 'OPEN',
                parentHead: mainSha,
            });
            commitInLane(f.lane, 'two.txt', 'feat(gate): human commit on merged main', 'human');

            const message = refusalMessage(() =>
                publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)
            );

            expect(message).toContain(`authored as ${HUMAN_EMAIL}`);
            expect(message).toContain(
                `git rebase --rebase-merges --exec 'git commit --amend --reset-author --no-edit' ${mainSha}`
            );
            expect(() => fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toThrow();
        } finally {
            dispose(f);
        }
    });

    /**
     * Squash-lands a human-authored parent lane onto the fixture main — one squash commit pushed to
     * the remote — then re-forks the child lane at the parent head and syncs it per the stack
     * workflow: a bot-authored merge of the parent head and the squash commit. Squash semantics keep
     * the parent's original commits off `main` forever, so the child retains them only through its
     * fork point, and only the parent-head exclusion can clear them from the gated range.
     */
    function mergedParentFixture(f: ReturnType<typeof authorshipFixture>): {
        parentCommits: string[];
        parentHead: string;
        squashSha: string;
    } {
        const parentBranch = 'agent/11/parent';
        const parentLane = join(f.fixtureRoot, 'parent-lane');
        fixtureGit(f.primary, ['worktree', 'add', '-b', parentBranch, parentLane]);
        fixtureGit(f.primary, ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, parentLane]);
        const parentCommits = [
            commitInLane(parentLane, 'parent-one.txt', 'chore: parent first advance', 'human'),
            commitInLane(parentLane, 'parent-two.txt', 'chore: parent second advance', 'human'),
        ];
        const parentHead = parentCommits[parentCommits.length - 1]!;
        // The merge lands as one squash commit on main: its tree carries the parent's content while
        // its history never will, so `main` cannot reach the parent's original human commits.
        const parentTree = fixtureGit(parentLane, ['rev-parse', 'HEAD^{tree}']);
        const squashSha = execFileSync(
            'git',
            ['commit-tree', parentTree, '-p', f.baseSha, '-m', 'chore: squash-land parent lane'],
            {
                cwd: parentLane,
                env: fixtureGitEnv({
                    GIT_AUTHOR_NAME: 'hplovecraft208[bot]',
                    GIT_AUTHOR_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
                    GIT_COMMITTER_NAME: 'hplovecraft208[bot]',
                    GIT_COMMITTER_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
                }),
                encoding: 'utf8',
            }
        ).trim();
        fixtureGit(f.primary, ['merge', '--ff-only', squashSha]);
        fixtureGit(f.primary, ['push', f.remote, 'main']);
        // The child forked at the parent head — retaining the parent's pre-squash commits exactly
        // as `lane:sync-parent` requires — and then merges the landed squash commit on top.
        fixtureGit(f.primary, ['worktree', 'unlock', f.lane]);
        fixtureGit(f.primary, ['worktree', 'remove', f.lane]);
        fixtureGit(f.primary, ['branch', '-f', BRANCH, parentHead]);
        fixtureGit(f.primary, ['worktree', 'add', f.lane, BRANCH]);
        fixtureGit(f.primary, ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, f.lane]);
        execFileSync('git', ['merge', '--no-edit', squashSha], {
            cwd: f.lane,
            env: fixtureGitEnv({
                GIT_AUTHOR_NAME: 'hplovecraft208[bot]',
                GIT_AUTHOR_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
                GIT_COMMITTER_NAME: 'hplovecraft208[bot]',
                GIT_COMMITTER_EMAIL: AUTHOR_BOT_COMMIT_EMAIL,
            }),
            encoding: 'utf8',
        });
        return { parentCommits, parentHead, squashSha };
    }

    it('publishes a stack child of a merged parent whose retained commits only the parent-head exclusion clears', () => {
        const f = authorshipFixture();
        try {
            const landed = mergedParentFixture(f);
            const mainSha = fixtureGit(f.primary, ['rev-parse', 'main']);
            const head = commitInLane(f.lane, 'child.txt', 'feat(gate): child bot commit', 'bot');
            f.port.stackBase = () => ({
                branch: 'main',
                head: mainSha,
                parentNumber: 11,
                parentState: 'MERGED',
                parentHead: landed.parentHead,
            });
            f.port.pinStackParent = () => undefined;
            let created = false;
            f.port.createPullRequest = () => {
                created = true;
                return 88;
            };
            f.port.existingOpenPullRequest = () =>
                created
                    ? {
                          number: 88,
                          title: 'feat(gate): child bot commit',
                          body: '',
                          baseRefName: 'main',
                          headRefOid: head,
                      }
                    : undefined;
            // Squash semantics guarantee `main` never reaches the parent's original commits, so the
            // raw comparison range still carries the human parent email; with the comparison head
            // resolved to main, only adding the parent-head exclusion clears what the child retained.
            expect(fixtureGit(f.lane, ['log', '--format=%ae', `${mainSha}..${head}`])).toContain(HUMAN_EMAIL);
            const emails = (excluded: string[]) =>
                f.port.commitAttribution(f.lane, mainSha, excluded, head).map((commit) => commit.email);
            expect(emails([mainSha])).toContain(HUMAN_EMAIL);
            expect(emails([mainSha, landed.parentHead])).not.toContain(HUMAN_EMAIL);

            expect(publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

            expect(fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toBe(head);
        } finally {
            dispose(f);
        }
    });

    it('refuses a merged-parent stack child naming only the human lane commit with no rebase to offer', () => {
        const f = authorshipFixture();
        try {
            const landed = mergedParentFixture(f);
            const mainSha = fixtureGit(f.primary, ['rev-parse', 'main']);
            commitInLane(f.lane, 'child.txt', 'feat(gate): child bot commit', 'bot');
            const head = commitInLane(f.lane, 'human-lane.txt', 'feat(gate): human lane commit', 'human');
            f.port.stackBase = () => ({
                branch: 'main',
                head: mainSha,
                parentNumber: 11,
                parentState: 'MERGED',
                parentHead: landed.parentHead,
            });
            f.port.pinStackParent = () => undefined;
            f.port.createPullRequest = () => 88;
            const humanShortSha = fixtureGit(f.lane, ['rev-parse', '--short', head]);
            const parentShortShas = landed.parentCommits.map((sha) =>
                fixtureGit(f.lane, ['rev-parse', '--short', sha])
            );

            const message = refusalMessage(() =>
                publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)
            );

            // The retained parent commits are foreign to main but excluded as base-side, so the
            // refusal names only the lane's own human commit. A rebase onto main would replay the
            // parent's pre-squash commits re-authored as the App, so re-creation is the only
            // remedy offered.
            expect(message).toContain(`${humanShortSha} ${HUMAN_EMAIL}`);
            for (const sha of parentShortShas) {
                expect(message).not.toContain(sha);
            }
            expect(message).toContain('re-create the listed offending commits');
            expect(message).not.toContain('git rebase');
            expect(() => fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toThrow();
        } finally {
            dispose(f);
        }
    });

    it('refuses a commit whose author email is empty instead of pushing it silently', () => {
        const f = authorshipFixture();
        try {
            commitInLane(f.lane, 'one.txt', 'feat(gate): bot commit', 'bot');
            writeFileSync(join(f.lane, 'empty.txt'), 'empty\n');
            fixtureGit(f.lane, ['add', '--', 'empty.txt']);
            execFileSync(
                'git',
                ['commit', '--no-gpg-sign', '--author=Jose <>', '-m', 'feat(gate): empty author email'],
                {
                    cwd: f.lane,
                    env: fixtureGitEnv(),
                    encoding: 'utf8',
                }
            );

            const message = refusalMessage(() =>
                publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)
            );

            expect(message).toContain('(empty author email)');
            expect(() => fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toThrow();
        } finally {
            dispose(f);
        }
    });

    it('refuses a forged display name — the App\u2019s name under a foreign email — before anything reaches the remote', () => {
        const f = authorshipFixture();
        try {
            commitInLane(f.lane, 'one.txt', 'feat(gate): bot commit', 'bot');
            commitInLane(f.lane, 'two.txt', 'feat(gate): forged display name', 'forged');

            const message = refusalMessage(() =>
                publishLane(12, f.port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)
            );

            expect(message).toContain(`authored as ${HUMAN_EMAIL}`);
            expect(() => fixtureGit(f.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toThrow();
        } finally {
            dispose(f);
        }
    });
});

describe('publication delta gating', () => {
    const HEAD = 'a'.repeat(40);
    const BASE = 'c'.repeat(40);
    const REMOTE_TIP = 'f'.repeat(40);

    it('gates only the remote-tip delta on a re-publication and pins the pushed head', () => {
        const { port, calls } = fakePort({
            baseSha: BASE,
            remoteRead: { kind: 'present', sha: REMOTE_TIP },
        });

        expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

        // The gate judges exactly the commits this publication adds above the remote tip, and the
        // read binds the head the push pins; nothing reads the set above the comparison base.
        expect(calls).toContain(`attribution:${REMOTE_TIP}:${BASE}:${HEAD}`);
        expect(calls).toContain(`pushHead:${HEAD}`);
        expect(calls.filter((call) => call.startsWith('attribution:'))).toEqual([
            `attribution:${REMOTE_TIP}:${BASE}:${HEAD}`,
        ]);
    });

    it('gates the comparison-base delta once on a first publication', () => {
        const { port, calls } = fakePort({ baseSha: BASE, remoteRead: { kind: 'absent' } });

        expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

        expect(calls.filter((call) => call.startsWith('attribution:'))).toEqual([
            `attribution:${BASE}:${BASE}:${HEAD}`,
        ]);
    });
});

/**
 * Placeholder for a dynamic operand inside a concatenation, so `'issues/' + n + '/comments'` reads
 * as the one endpoint it builds. A private-use code point, not a control character, so the pattern
 * below stays clear of `no-control-regex` and no TypeScript source carries it by accident.
 */
const CONCATENATED_COMMAND_PART = '\uE000';

/** The REST issue-comment endpoint in every spelling one module can assemble it from. */
const ISSUE_COMMENT_ENDPOINT_PATTERN = /issues\/(?:\d+|\$\{[^}]+\}|\uE000)\/comments/u;

/**
 * Every command-building literal one module carries: each string literal and template, each
 * consecutive run of literals (an argv array spelled in one stretch), and each string concatenation
 * with its dynamic operands folded to the placeholder above. Static analysis only — no module is
 * imported and nothing here observes publication behaviour.
 */
function commandLiteralsIn(modulePath: string): {
    literals: string[];
    literalRuns: string[][];
    concatenations: string[];
} {
    const sourceFile = ts.createSourceFile(
        modulePath,
        readFileSync(join(import.meta.dirname, '..', '..', modulePath), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const literals: string[] = [];
    const literalRuns: string[][] = [];
    const concatenations: string[] = [];
    const literalText = (node: ts.Node): string | undefined => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            return node.text;
        }
        return ts.isTemplateExpression(node) ? node.getText(sourceFile) : undefined;
    };
    const plusOperands = (node: ts.Node): ts.Node[] => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            return [...plusOperands(node.left), ...plusOperands(node.right)];
        }
        return [node];
    };
    const visit = (node: ts.Node): void => {
        const text = literalText(node);
        if (text !== undefined) {
            literals.push(text);
        }
        if (ts.isArrayLiteralExpression(node)) {
            // A consecutive run of string literals is an argv: `pr`, `comment` adjacent in one run is
            // the subcommand pair however the surrounding array is spelled.
            let run: string[] = [];
            const flush = (): void => {
                if (run.length > 1) {
                    literalRuns.push(run);
                }
                run = [];
            };
            for (const element of node.elements) {
                const elementText = literalText(element);
                if (elementText === undefined) {
                    flush();
                } else {
                    run.push(elementText);
                }
            }
            flush();
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            const operands = plusOperands(node);
            if (operands.some((operand) => literalText(operand) !== undefined)) {
                concatenations.push(
                    operands.map((operand) => literalText(operand) ?? CONCATENATED_COMMAND_PART).join('')
                );
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return { literals, literalRuns, concatenations };
}

/**
 * The source-attestation comment is retired: no publication writes to a pull request's
 * issue-comment channel. Five observations hold that, and each claims only what it checks.
 *
 * First, the recording double. Every shape below pins the whole member set its path invokes on the
 * proxied fixture, compared as one golden set rather than a name pattern, so a member reached by a
 * shape reddens that shape's pin however it is named. One shape's set cannot stand for the others —
 * a write that fires only when the pull request already exists rides the republication path, whose
 * members the create-path fixture never calls — so each shape carries its own set. The
 * fixture-surface completeness case beside them holds the table complete: every member the fixture
 * can expose is pinned by some shape, so a member with no shape reaching it fails there instead of
 * escaping unobserved.
 *
 * Second, the real port's behaviour. `REAL_PORT_SHAPES` drives the same ten shapes through the
 * unmodified `shellPort` bound to a recording `gh` stub, normalizes every invocation it recorded,
 * and asserts the shape's key set equals a golden allowlist stated beside it. Because the golden
 * set is the whole expectation, an invocation a reintroduction adds fails the shape whatever its
 * spelling, subcommand, or endpoint — a `pr comment`, an `api` read of `issues/<n>/comments`, a
 * `--method POST` write to one, or a GraphQL `addComment` mutation each key to something the golden
 * set does not carry. This is the part the member-set pins cannot see: a write inside an
 * already-pinned member, or an optional member added to the port and called on the publication
 * path, changes no member name at all but spawns an invocation this log records. Every shape that
 * makes a pull-request write also asserts it — a create, an update, or the invocations the shape's
 * own anchor names — so a shape whose run degraded cannot pass vacuously on its write; the
 * push-only legacy shape, which makes no write, anchors only on a non-empty recorded log. A
 * companion case holds the real-port table to exactly the shapes the golden sets pin, so a new
 * shape cannot be added to one table without being driven through the other.
 *
 * Third, and the enforcement, the command boundary. The rule is default-deny: `lane:publish` may
 * issue only the `gh` commands its own call sites assemble, enumerated in
 * `PERMITTED_GH_INVOCATIONS`, and `shellPort`'s `gh` runners refuse every argv that matches no
 * permitted shape before spawning `gh`. The boundary therefore reads the fully assembled argv at
 * the one place every spelling materialises, and it needs no blocklist to be complete: an
 * unenumerated verb, subcommand, endpoint, or flag cannot match, whether it was spelled whole,
 * assembled from a hoisted constant, gated on a path no shape drives, or carried a flag the old
 * blocklist's value-flag set never knew. The boundary case below pins the refusal on every refused
 * spelling, and the legitimate-arg-builder case beside it drives each argument builder the port
 * uses, so the allowlist cannot silently break a real call. The real-port shapes add the live half:
 * having refused nothing, they assert every invocation they recorded matches a permitted shape.
 * The undriven-path case drives a publication the ten shapes never reach, and the boundary refuses
 * the write it injects there with the rule's message. The runner case then drives that same write
 * through the port's own `gh`/`ghRun` runners, which is what observes the five guards themselves:
 * deleting them lets the write spawn, while the injected-write case above — which calls the rule
 * directly — would have stayed green.
 *
 * Fourth, and now only an earlier, cheaper signal, the source pin. Enumerating publication outcomes
 * chases an open set — five rounds of review each found one the tables did not drive — so
 * `builds no issue-comment invocation anywhere in the lane:publish closure` reads every module in
 * that trusted closure and fails on any string literal, template, or concatenation in any of them
 * that constructs an issue-comment invocation, whatever member or path it lives in. It matches
 * literal constructions only, so a spelling assembled beyond the literals it enumerates can escape
 * it — the boundary's default-deny rule is what enforces the invariant, which is why the boundary
 * is where the rule lives. It covers command construction anywhere inside the closure; a write
 * routed through a module outside it would enter the closure, and the exact-closure pin in
 * `agentDeliveryScripts.spec.ts` refuses that changed set first. Its own comment states the
 * boundary.
 *
 * The shapes are the publication outcomes `publishLane` can take for this command, each built the
 * way the rest of this spec builds it: a first publication that creates the pull request, an
 * issueless conforming publication that also creates one, an issueless republication that updates
 * one, a republication that updates it, a stacked child of either kind, a publication reporting a
 * conflicted head, a republication carrying an inherited milestone and board, the legacy pull
 * request this command only pushes to, and a legacy publication that applies metadata under an
 * explicit `--model`. All ten are driven through the real port, so no shape is observed only by
 * member names. The real-port key-name case is narrower still: it proves only that the port exposes
 * no member named for an attestation or comment, which names a surface, never a behaviour.
 */
describe('publication attestation retirement', () => {
    type PublicationShape = {
        /** Names the path this fixture drives in the case title. */
        shape: string;
        /** The pull request number this publication resolves to. */
        number: number;
        /** Runs one publication of this shape and reports the port members it invoked. */
        publish: () => { members: Set<string>; number: number };
        /** Every member this shape's path may invoke, alphabetically, compared as one set. */
        members: string[];
    };

    const STACK_BRANCH = 'agent/11/parent';
    const STACK_HEAD = 'a'.repeat(40);

    const FIRST_PUBLICATION_MEMBERS = [
        'aheadBehind',
        'baseSha',
        'commitAttribution',
        'createPullRequest',
        'cwd',
        'dirty',
        'ensureModelLabel',
        'existingOpenPullRequest',
        'guardFailure',
        'headSha',
        'isAncestor',
        'issueExists',
        'knownLabels',
        'knownProjectTitles',
        'laneSubject',
        'log',
        'objectStoreRewrites',
        'push',
        'readAuthorModel',
        'readIssueProjectTitles',
        'readIssueTrackerMetadata',
        'readPullRequestMergeability',
        'readPullRequestMetadata',
        'remoteBranchSha',
        'worktrees',
    ];

    /**
     * An issueless conforming lane's first publication. It makes none of the bound issue's reads
     * (`issueExists`, `readIssueTrackerMetadata`, `readIssueProjectTitles`) because no issue
     * constrains it, and reads no pull-request projects because its derived board is resolved from
     * the live project listing (`knownProjectTitles`) rather than the issue. The type label derived
     * from the lane subject is one the pull request does not carry yet, so the metadata plan is real
     * and `applyPullRequestMetadata` is reached — the write an issue-bound first publication with an
     * already-correct label set skips.
     */
    const ISSUELESS_CREATE_MEMBERS = [
        'aheadBehind',
        'applyPullRequestMetadata',
        'baseSha',
        'commitAttribution',
        'createPullRequest',
        'cwd',
        'dirty',
        'ensureModelLabel',
        'existingOpenPullRequest',
        'guardFailure',
        'headSha',
        'isAncestor',
        'knownLabels',
        'knownProjectTitles',
        'laneSubject',
        'log',
        'objectStoreRewrites',
        'push',
        'readAuthorModel',
        'readPullRequestMergeability',
        'readPullRequestMetadata',
        'remoteBranchSha',
        'worktrees',
    ];

    /**
     * An issueless conforming lane's republication, the outcome its create-path fixture never
     * reaches: the branch already has an open pull request, so the write is an update, not a create.
     * The member set is the issueless create's with `updatePullRequest` in place of
     * `createPullRequest`; the bound-issue reads stay absent for the same reason, and the update
     * path reaches the same derived-label metadata edit.
     */
    const ISSUELESS_UPDATE_MEMBERS = [
        'aheadBehind',
        'applyPullRequestMetadata',
        'baseSha',
        'commitAttribution',
        'cwd',
        'dirty',
        'ensureModelLabel',
        'existingOpenPullRequest',
        'guardFailure',
        'headSha',
        'isAncestor',
        'knownLabels',
        'knownProjectTitles',
        'laneSubject',
        'log',
        'objectStoreRewrites',
        'push',
        'readAuthorModel',
        'readPullRequestMergeability',
        'readPullRequestMetadata',
        'remoteBranchSha',
        'updatePullRequest',
        'worktrees',
    ];

    const REPUBLICATION_MEMBERS = [
        'aheadBehind',
        'baseSha',
        'commitAttribution',
        'cwd',
        'dirty',
        'ensureModelLabel',
        'existingOpenPullRequest',
        'guardFailure',
        'headSha',
        'isAncestor',
        'issueExists',
        'knownLabels',
        'knownProjectTitles',
        'laneSubject',
        'log',
        'objectStoreRewrites',
        'push',
        'readAuthorModel',
        'readIssueProjectTitles',
        'readIssueTrackerMetadata',
        'readPullRequestMergeability',
        'readPullRequestMetadata',
        'remoteBranchSha',
        'updatePullRequest',
        'worktrees',
    ];

    const STACK_CREATE_MEMBERS = [
        'aheadBehind',
        'baseSha',
        'commitAttribution',
        'createPullRequest',
        'cwd',
        'dirty',
        'ensureModelLabel',
        'existingOpenPullRequest',
        'guardFailure',
        'headSha',
        'isAncestor',
        'issueExists',
        'knownLabels',
        'knownProjectTitles',
        'laneSubject',
        'log',
        'objectStoreRewrites',
        'pinStackParent',
        'push',
        'readAuthorModel',
        'readIssueProjectTitles',
        'readIssueTrackerMetadata',
        'readPullRequestMergeability',
        'readPullRequestMetadata',
        'remoteBranchSha',
        'reportDiff',
        'stackBase',
        'worktrees',
    ];

    const STACK_UPDATE_MEMBERS = [
        'aheadBehind',
        'baseSha',
        'commitAttribution',
        'cwd',
        'dirty',
        'ensureModelLabel',
        'existingOpenPullRequest',
        'guardFailure',
        'headSha',
        'isAncestor',
        'issueExists',
        'knownLabels',
        'knownProjectTitles',
        'laneSubject',
        'log',
        'objectStoreRewrites',
        'pinStackParent',
        'push',
        'readAuthorModel',
        'readIssueProjectTitles',
        'readIssueTrackerMetadata',
        'readPullRequestMergeability',
        'readPullRequestMetadata',
        'remoteBranchSha',
        'reportDiff',
        'stackBase',
        'updatePullRequest',
        'worktrees',
    ];

    const CONFLICT_REPORT_MEMBERS = [
        'aheadBehind',
        'baseSha',
        'commitAttribution',
        'conflictingPaths',
        'createPullRequest',
        'cwd',
        'dirty',
        'ensureModelLabel',
        'existingOpenPullRequest',
        'guardFailure',
        'headSha',
        'isAncestor',
        'issueExists',
        'knownLabels',
        'knownProjectTitles',
        'laneSubject',
        'log',
        'objectStoreRewrites',
        'push',
        'readAuthorModel',
        'readIssueProjectTitles',
        'readIssueTrackerMetadata',
        'readPullRequestMergeability',
        'readPullRequestMetadata',
        'remoteBranchSha',
        'worktrees',
    ];

    const INHERITED_BOARD_MEMBERS = [
        'aheadBehind',
        'applyPullRequestMetadata',
        'baseSha',
        'commitAttribution',
        'cwd',
        'dirty',
        'ensureModelLabel',
        'existingOpenPullRequest',
        'guardFailure',
        'headSha',
        'isAncestor',
        'issueExists',
        'knownLabels',
        'knownProjectTitles',
        'laneSubject',
        'log',
        'objectStoreRewrites',
        'openMilestoneTitles',
        'push',
        'readAuthorModel',
        'readIssueProjectTitles',
        'readIssueTrackerMetadata',
        'readPullRequestMergeability',
        'readPullRequestMetadata',
        'readPullRequestProjectTitles',
        'remoteBranchSha',
        'updatePullRequest',
        'worktrees',
    ];

    const LEGACY_PUSH_ONLY_MEMBERS = [
        'aheadBehind',
        'baseSha',
        'commitAttribution',
        'cwd',
        'dirty',
        'existingOpenPullRequest',
        'guardFailure',
        'headSha',
        'isAncestor',
        'log',
        'objectStoreRewrites',
        'push',
        'readPullRequestMergeability',
        'remoteBranchSha',
        'worktrees',
    ];

    const LEGACY_METADATA_MEMBERS = [
        'aheadBehind',
        'applyPullRequestMetadata',
        'baseSha',
        'commitAttribution',
        'cwd',
        'dirty',
        'ensureModelLabel',
        'existingOpenPullRequest',
        'guardFailure',
        'headSha',
        'isAncestor',
        'knownLabels',
        'log',
        'objectStoreRewrites',
        'push',
        'readPullRequestMergeability',
        'readPullRequestMetadata',
        'remoteBranchSha',
        'saveAuthorModel',
        'worktrees',
    ];

    /** The off-convention, correctly locked worktree a legacy publication resolves. */
    function legacyLane(): PublishWorktree {
        return worktree({ path: LEGACY_LANE, branch: LEGACY_BRANCH });
    }

    /**
     * A registered stack child's fixture: the optional stack members its path reaches, plus the
     * post-mutation fence's read, which re-proves the child it just published. `mode` selects the
     * write that child takes — a create when no pull request exists yet, an update when one does.
     */
    function stackedChild(mode: 'create' | 'update'): { members: Set<string>; port: PublishLanePort } {
        const { port, members } = fakePort();
        const number = mode === 'update' ? 41 : 88;
        let published = mode === 'update';
        port.stackBase = () => ({
            branch: STACK_BRANCH,
            head: 'base',
            parentNumber: 11,
            parentState: 'OPEN',
            parentHead: 'base',
        });
        port.pinStackParent = () => undefined;
        port.reportDiff = () => undefined;
        port.createPullRequest = () => {
            published = true;
            return number;
        };
        port.existingOpenPullRequest = () =>
            published
                ? {
                      number,
                      title: DEFAULT_SUBJECT,
                      body: composePublishBody(12, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS),
                      baseRefName: STACK_BRANCH,
                      headRefOid: STACK_HEAD,
                  }
                : undefined;
        return { members, port };
    }

    const PUBLICATION_SHAPES: PublicationShape[] = [
        {
            shape: 'a first publication that creates the pull request',
            number: 88,
            members: FIRST_PUBLICATION_MEMBERS,
            publish: () => {
                const { port, members } = fakePort();
                const number = publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);
                return { members, number };
            },
        },
        {
            shape: 'an issueless conforming publication that creates the pull request',
            number: 88,
            members: ISSUELESS_CREATE_MEMBERS,
            publish: () => {
                const { port, members } = fakePort({
                    trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
                    cwd: CLEANUP_LANE,
                });
                const number = publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);
                return { members, number };
            },
        },
        {
            shape: 'an issueless republication that updates the pull request',
            number: 41,
            members: ISSUELESS_UPDATE_MEMBERS,
            publish: () => {
                const { port, members } = fakePort({
                    trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
                    cwd: CLEANUP_LANE,
                    existing: 41,
                    // The issueless body carries `None.` under Related tickets; a body naming an issue
                    // this lane does not have is refused before any write.
                    existingBody: composePublishBody(undefined, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS),
                });
                const number = publishLane(undefined, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);
                return { members, number };
            },
        },
        {
            shape: 'a republication that updates the pull request',
            number: 41,
            members: REPUBLICATION_MEMBERS,
            publish: () => {
                const { port, members } = fakePort({ existing: 41 });
                const number = publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);
                return { members, number };
            },
        },
        {
            shape: 'a stacked child that creates its pull request',
            number: 88,
            members: STACK_CREATE_MEMBERS,
            publish: () => {
                const { port, members } = stackedChild('create');
                const number = publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);
                return { members, number };
            },
        },
        {
            shape: 'a stacked child that updates its pull request',
            number: 41,
            members: STACK_UPDATE_MEMBERS,
            publish: () => {
                const { port, members } = stackedChild('update');
                const number = publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);
                return { members, number };
            },
        },
        {
            shape: 'a first publication that reports a conflicted head',
            number: 88,
            members: CONFLICT_REPORT_MEMBERS,
            publish: () => {
                const { port, members } = fakePort({
                    mergeability: 'conflicting',
                    conflictingPaths: ['src/modules/audio/engine.ts'],
                });
                const number = publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);
                return { members, number };
            },
        },
        {
            shape: 'a republication carrying its issue inherited milestone and board',
            number: 41,
            members: INHERITED_BOARD_MEMBERS,
            publish: () => {
                const { port, members } = fakePort({
                    existing: 41,
                    issueTracker: { milestone: { title: 'v1.2' }, projectItems: [{ title: 'Roadmap' }] },
                    openMilestoneTitles: ['v1.2'],
                    currentMetadata: { labels: [], projectTitles: [] },
                });
                const number = publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY);
                return { members, number };
            },
        },
        {
            shape: 'a legacy pull request that is pushed to only',
            number: 2275,
            members: LEGACY_PUSH_ONLY_MEMBERS,
            publish: () => {
                const { port, members } = fakePort({
                    trees: [...otherAuthorLanes(), legacyLane()],
                    cwd: LEGACY_LANE,
                    existing: 2275,
                });
                const number = publishLane(undefined, port);
                return { members, number };
            },
        },
        {
            shape: 'a legacy republication that applies metadata under an explicit --model',
            number: 2275,
            members: LEGACY_METADATA_MEMBERS,
            publish: () => {
                const { port, members } = fakePort({
                    trees: [...otherAuthorLanes(), legacyLane()],
                    cwd: LEGACY_LANE,
                    existing: 2275,
                    currentMetadata: { labels: [], projectTitles: [] },
                });
                const number = publishLane(undefined, port, undefined, undefined, undefined, undefined, {
                    model: 'kimi-k2.5',
                });
                return { members, number };
            },
        },
    ];

    it.each(PUBLICATION_SHAPES)('invokes exactly its pinned port member set: $shape', (shape) => {
        const published = shape.publish();

        expect(published.number).toBe(shape.number);
        expect([...published.members].sort()).toEqual(shape.members);
    });

    /**
     * The shape table stays complete only while every member the fixture can expose on a
     * publication path is pinned by some shape. A member added to the port that no shape here
     * reaches would widen the fixture with no golden set observing it — the same escape the shapes
     * close one path at a time — so this fails until a shape that invokes it is pinned too.
     */
    it('pins every member the fixture can expose, so no reachable path is unobserved', () => {
        const reachable = new Set([
            ...Object.keys(fakePort().port),
            // Optional members the stack shapes assign; the bare fixture carries no stack context.
            'pinStackParent',
            'reportDiff',
            'stackBase',
        ]);
        const pinned = new Set(PUBLICATION_SHAPES.flatMap((shape) => shape.members));

        expect([...reachable].sort()).toEqual([...pinned].sort());
    });

    it('names no attestation or comment member in the conforming fixture or its call ledger', () => {
        const { port, calls } = fakePort();

        expect(publishLane(12, port, undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY)).toBe(88);

        expect(Object.keys(port).filter((member) => /attest|comment/iu.test(member))).toEqual([]);
        expect(calls.filter((call) => /attest|comment/iu.test(call))).toEqual([]);
    });

    it('exposes no attestation comment writer on the real publication port', () => {
        const session: GhSession = { configDir: '/tmp/sourdaw-gh', env: {}, dispose: () => undefined };

        const port = shellPort(session, PRIMARY_ROOT, PRIMARY_ROOT, { git: 'git', gh: 'gh' });

        expect(Object.keys(port).filter((member) => /attest|comment/iu.test(member))).toEqual([]);
    });

    /**
     * The cheaper, earlier signal. The tables above enumerate publication outcomes, and outcomes are
     * an open set: a member reachable only on a state no shape drives, or a write inside an
     * already-pinned member, escapes them however carefully they are enumerated. This case drives
     * nothing. It takes the `lane:publish` trusted closure — the module set `agentDeliveryScripts.spec.ts`
     * pins exactly, derived here through `trustedDependencyPaths` rather than hand-copied so a closure
     * change is read without editing this file — reads every module in it, parses it, and fails when
     * any string literal, template, or string concatenation in it constructs an issue-comment
     * invocation:
     *
     * - the REST endpoint `issues/<n>/comments` in an `api` argument, with or without a query string,
     *   spelled whole or assembled from parts around a dynamic operand;
     * - a GraphQL `addComment` mutation;
     * - the `pr comment` or `issue comment` subcommand pair.
     *
     * It matches literal constructions only. An endpoint hoisted into a constant and referenced by a
     * template, or any other spelling that leaves the literals it enumerates, is not something this
     * source read can see, so it can name a reintroduction only early and cheaply, never completely.
     * The enforcement is the boundary refusal in `shellPort`: it reads the fully assembled argv at
     * the one place every spelling materialises, so a reintroduction still fails at runtime whatever
     * this pin misses.
     *
     * It covers command construction anywhere inside the `lane:publish` closure, and only there. A
     * write routed through a module outside that closure would itself enter the closure, and the
     * exact-closure pin in `agentDeliveryScripts.spec.ts` refuses the widened set before this pin
     * reads it. Nor does it judge the number: `issues/<n>/comments` is refused on any issue, pull
     * request or not.
     */
    it('builds no issue-comment invocation anywhere in the lane:publish closure', () => {
        const closure = trustedDependencyPaths('lane:publish');
        // The exact-closure pin elsewhere owns this set; the guard only refuses a derived list that
        // emptied and would leave every check below vacuous.
        expect(closure, 'the lane:publish closure must carry the publication module').toContain(
            'scripts/publishLane.ts'
        );

        for (const modulePath of closure) {
            const { literals, literalRuns, concatenations } = commandLiteralsIn(modulePath);

            expect(
                [...literals, ...concatenations].filter((value) => ISSUE_COMMENT_ENDPOINT_PATTERN.test(value)),
                `issue-comment endpoint literals in ${modulePath}`
            ).toEqual([]);
            expect(
                literals.filter((value) => /\baddComment\b/u.test(value)),
                `GraphQL addComment literals in ${modulePath}`
            ).toEqual([]);
            expect(
                literalRuns.filter((run) =>
                    run.some((token, index) => (token === 'pr' || token === 'issue') && run[index + 1] === 'comment')
                ),
                `comment subcommand pairs in ${modulePath}`
            ).toEqual([]);
        }
    });

    /**
     * The enforcement, pinned on the argv every `shellPort` `gh` runner passes through before it
     * spawns. The rule is default-deny: only the shapes `PERMITTED_GH_INVOCATIONS` enumerates are
     * allowed, so what this case proves is that the refused spellings match none of them. Unlike the
     * source pin above, the boundary sees only the assembled argv, so a segment hoisted into a
     * constant and one whole literal arrive here as the same value — which is why a reintroduction
     * cannot hide behind how its endpoint was spelled. Each refused argv is a write the deleted
     * attestation path made, or one a reintroduction could take: the issue-comment collection
     * (`POST`), the standing comment (`PATCH` and `DELETE` on `issues/comments/<id>`), the GraphQL
     * `addComment` mutation, and a refused endpoint carrying the `-p/--preview` flag. Only the first
     * of the six was refused by the pre-repair blocklist; the standing comment's two endpoints and
     * the `--preview` argv are the spellings it let through.
     */
    it('refuses every unenumerated gh command at the boundary, however it was assembled', () => {
        const number = 41;
        const RESOURCE = 'comments';
        const refused = [
            // The deleted whole-literal create endpoint.
            ['api', '--method', 'POST', `repos/${REQUIRED_REPOSITORY}/issues/${number}/comments`, '-f', 'body=x'],
            // The same endpoint with its last segment hoisted into a constant.
            ['api', '--method', 'POST', `repos/${REQUIRED_REPOSITORY}/issues/${number}/${RESOURCE}`, '-f', 'body=x'],
            // The standing comment's own update endpoint.
            ['api', '--method', 'PATCH', `repos/${REQUIRED_REPOSITORY}/issues/comments/${number}`, '-f', 'body=x'],
            // Its delete endpoint.
            ['api', '--method', 'DELETE', `repos/${REQUIRED_REPOSITORY}/issues/comments/${number}`],
            // GraphQL, whose mutation text is a field value rather than the endpoint.
            ['api', 'graphql', '-f', 'query=mutation { addComment(input: {subjectId: "x", body: "y"}) { id } }'],
            // `--preview` takes a value, so an argv carrying it misreads the endpoint it addresses.
            [
                'api',
                '--preview',
                'squirrel-girl',
                '--method',
                'PATCH',
                `repos/${REQUIRED_REPOSITORY}/issues/comments/${number}`,
                '-f',
                'body=x',
            ],
        ];
        for (const argv of refused) {
            expect(() => assertGhCommandAllowed(argv), argv.join(' ')).toThrow(PUBLICATION_COMMAND_RULE);
            expect(matchesPermittedGhInvocation(argv), argv.join(' ')).toBe(false);
        }
    });

    /**
     * Every argument builder the real port or its CLI drives must stay permitted, or the default-deny
     * rule would refuse the publication or its repository resolution itself. This is the builders'
     * half of the rule. The permit table is deliberately not derived from these calls — that would
     * let a builder's own change move the rule — so the two meet here instead: every entry below is
     * driven through the boundary, and the permit table is read to prove no two of its shapes
     * collapse to one signature. The variants after the builders cover flag multiplicities and
     * combinations a single call cannot express: two `--add-label` flags, an added and a removed
     * label beside a milestone, and an address flag written with `=`.
     */
    it('permits every legitimate argument builder the publication port calls', () => {
        const signatures = PERMITTED_GH_INVOCATIONS.map((shape) =>
            shape.command === 'api'
                ? `api ${shape.endpoint.source} ${shape.flags
                      .map((flag) => flag.name)
                      .sort()
                      .join(',')}`
                : `${shape.command} ${shape.subcommand} ${shape.positionals} ${shape.flags
                      .map((flag) => `${flag.name}=${typeof flag.value === 'string' ? flag.value : ''}`)
                      .join(' ')}`
        );
        expect(new Set(signatures).size, 'permit shapes that collapse to one signature').toBe(signatures.length);

        const builders = [
            issueLookupArgs(12),
            existingOpenPullRequestArgs('agent/12/x'),
            updatePullRequestArgs(41, 'closes #12'),
            issueTrackerMetadataArgs(12),
            issueProjectItemsArgs(12),
            openMilestoneTitlesArgs(),
            projectListArgs('jcosta33'),
            pullRequestMetadataArgs(41),
            pullRequestMergeabilityArgs(41),
            pullRequestProjectItemsArgs(41),
            labelListArgs(),
            ensureModelLabelArgs('glm-5.3'),
            applyPullRequestMetadataArgs(41, {
                addLabels: ['glm-5.3'],
                removeLabels: [],
                addProjectTitles: [],
            }),
            addPullRequestProjectsArgs(41, ['Roadmap']),
            stackParentQuery('agent/11/parent'),
            repositoryNameWithOwnerArgs(),
        ];
        for (const argv of builders) {
            expect(() => assertGhCommandAllowed(argv), argv.join(' ')).not.toThrow();
            expect(matchesPermittedGhInvocation(argv), argv.join(' ')).toBe(true);
        }

        const variants = [
            // Two authorship and type labels on one edit.
            ['pr', 'edit', '41', '--repo', REQUIRED_REPOSITORY, '--add-label', 'glm-5.3', '--add-label', 'bug'],
            // A superseded fence removal and an inherited milestone on one edit.
            ['pr', 'edit', '41', '--repo', REQUIRED_REPOSITORY, '--remove-label', 'gpt-5', '--milestone', 'v1.2'],
            // A pull-request metadata read whose field list is written with `=`.
            ['pr', 'view', '41', `--repo=${REQUIRED_REPOSITORY}`, '--json=projectItems'],
        ];
        for (const argv of variants) {
            expect(() => assertGhCommandAllowed(argv), argv.join(' ')).not.toThrow();
            expect(matchesPermittedGhInvocation(argv), argv.join(' ')).toBe(true);
        }
    });

    const REAL_PORT_BRANCH = 'agent/12/real-port';
    const REAL_PORT_CLEANUP_BRANCH = 'agent/cleanup';
    const REAL_PORT_LEGACY_BRANCH = 'fix/collab-sync-state-2039';
    const REAL_PORT_LEGACY_NUMBER = 2275;
    const REAL_PORT_STACK_PARENT = 'agent/11/parent';
    const REAL_PORT_STACK_PARENT_NUMBER = 11;

    /**
     * The recording `gh` the real port is bound to. It appends its argv, one JSON array per line, to
     * `TEST_GH_LOG` before answering the reads the driven shapes need from `TEST_GH_ANSWERS`. A
     * `TEST_GH_CREATED` marker makes `pr list` answer the created pull request only after a
     * `pr create` ran, which is what the stack post-mutation fence reads. Every command it does not
     * recognize exits 0 silently, exactly as a write with no output does.
     */
    const REAL_GH_RECORDER = String.raw`#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
appendFileSync(process.env.TEST_GH_LOG, JSON.stringify(args) + '\n');
const answers = JSON.parse(readFileSync(process.env.TEST_GH_ANSWERS, 'utf8'));
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const print = (value) => {
    if (value !== undefined) {
        process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
    }
};
const rows = (titles) => (titles === undefined ? [] : titles.map((title) => ({ title })));

if (args[0] === 'api') {
    const target = args.find((arg) => arg.indexOf('repos/') === 0) || '';
    if (/\/issues\/\d+$/.test(target)) {
        print({ number: Number(target.split('/').pop()), isPullRequest: false });
    } else if (target.indexOf('/milestones') !== -1) {
        print(answers.openMilestones || []);
    } else if (args.indexOf('--paginate') !== -1) {
        print(answers.stackParents || [[]]);
    }
} else if (args[0] === 'pr' && args[1] === 'list') {
    print(
        existsSync(process.env.TEST_GH_CREATED) && answers.pullRequestAfterCreate !== undefined
            ? [answers.pullRequestAfterCreate]
            : answers.openPullRequests || []
    );
} else if (args[0] === 'pr' && args[1] === 'create') {
    writeFileSync(process.env.TEST_GH_CREATED, '');
    print(answers.pullRequestUrl || 'https://github.com/jcosta33/sourdaw/pull/88');
} else if (args[0] === 'pr' && args[1] === 'view') {
    const json = valueAfter('--json');
    if (json === 'mergeable') {
        print({ mergeable: answers.mergeable || 'MERGEABLE' });
    } else if (json === 'projectItems') {
        print({ projectItems: rows(answers.pullRequestProjectTitles) });
    } else {
        print({ labels: answers.pullRequestLabels || [], milestone: answers.pullRequestMilestone || null });
    }
} else if (args[0] === 'issue' && args[1] === 'view') {
    const json = valueAfter('--json');
    if (json === 'projectItems') {
        print({ projectItems: rows(answers.issueProjectTitles) });
    } else {
        print({ labels: answers.issueLabels || [], milestone: answers.issueMilestone || null });
    }
} else if (args[0] === 'label' && args[1] === 'list') {
    print(answers.repositoryLabels || []);
} else if (args[0] === 'project' && args[1] === 'list') {
    const titles = answers.knownProjects || [];
    print({ projects: rows(titles), totalCount: titles.length });
}
process.exit(0);
`;

    /** The reads the recording `gh` answers; a field left out answers the shape's benign default. */
    type RealPortAnswers = {
        openPullRequests?: unknown[];
        pullRequestAfterCreate?: unknown;
        mergeable?: string;
        stackParents?: unknown[];
        issueLabels?: unknown[];
        issueMilestone?: unknown;
        openMilestones?: unknown[];
        knownProjects?: string[];
        issueProjectTitles?: string[];
        pullRequestProjectTitles?: string[];
        repositoryLabels?: unknown[];
        pullRequestLabels?: unknown[];
        pullRequestUrl?: string;
    };

    /**
     * A real-Git publication fixture whose GitHub side is the recording `gh` above: the port is the
     * real `shellPort`, so every member it invokes spawns a real `gh` invocation into one log, and
     * `git` stays the real binary. It carries an issue-bound conforming lane, an issueless
     * conforming lane, and a lock-shaped off-convention lane, any of which `portFor` binds as the
     * port's cwd.
     */
    function realPortFixture(answers: RealPortAnswers) {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-publish-real-port-'));
        const primary = join(root, 'primary');
        const lane = join(root, 'lane');
        const cleanupLane = join(root, 'cleanup-lane');
        const legacyLane = join(root, 'legacy-lane');
        const remote = join(root, 'remote.git');
        const ghPath = join(root, 'gh');
        const answersPath = join(root, 'gh-answers.json');
        const createdMarker = join(root, 'gh-created');
        const log = join(root, 'gh.log');
        const systemGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();

        mkdirSync(primary, { recursive: true });
        fixtureGit(primary, ['init', '-b', 'main']);
        fixtureGit(primary, ['config', 'user.name', 'Fixture']);
        fixtureGit(primary, ['config', 'user.email', 'fixture@example.com']);
        writeFileSync(join(primary, 'base.txt'), 'base\n');
        fixtureGit(primary, ['add', 'base.txt']);
        fixtureGit(primary, ['commit', '--no-gpg-sign', '-m', 'chore: real-port fixture base']);
        const baseSha = fixtureGit(primary, ['rev-parse', 'HEAD']);
        fixtureGit(primary, ['worktree', 'add', '-b', REAL_PORT_BRANCH, lane]);
        fixtureGit(primary, ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, lane]);
        fixtureGit(primary, ['worktree', 'add', '-b', REAL_PORT_CLEANUP_BRANCH, cleanupLane]);
        fixtureGit(primary, ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, cleanupLane]);
        fixtureGit(primary, ['worktree', 'add', '-b', REAL_PORT_LEGACY_BRANCH, legacyLane]);
        fixtureGit(primary, ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, legacyLane]);
        execFileSync(systemGit, ['init', '--bare', remote], { cwd: root, env: fixtureGitEnv(), encoding: 'utf8' });
        fixtureGit(primary, ['push', remote, 'main']);
        fixtureGit(primary, ['config', `url.${remote}.insteadOf`, GITHUB_HTTPS_REMOTE]);
        fixtureGit(primary, ['config', `branch.${REAL_PORT_BRANCH}.sourdaw-author-model`, 'glm-5.3']);
        fixtureGit(primary, ['config', `branch.${REAL_PORT_CLEANUP_BRANCH}.sourdaw-author-model`, 'glm-5.3']);
        writeFileSync(answersPath, JSON.stringify(answers));
        writeFileSync(ghPath, REAL_GH_RECORDER);
        chmodSync(ghPath, 0o700);
        const session = createGhSession('ghs_real_port_marker', {
            PATH: process.env.PATH,
            TEST_GH_LOG: log,
            TEST_GH_ANSWERS: answersPath,
            TEST_GH_CREATED: createdMarker,
        });
        // Project reads are the operator credential's; the recording stub answers for both roles.
        const operator = operatorSessionAccess({}, () => ({ session }));

        return {
            primary,
            lane,
            cleanupLane,
            legacyLane,
            remote,
            baseSha,
            writeAnswers: (next: RealPortAnswers) => writeFileSync(answersPath, JSON.stringify(next)),
            portFor: (cwd: string) => shellPort(session, cwd, primary, { git: systemGit, gh: ghPath }, operator),
            recorded: () =>
                readFileSync(log, 'utf8')
                    .split('\n')
                    .filter((line) => line !== '')
                    .map((line) => JSON.parse(line) as string[]),
            dispose: () => {
                session.dispose();
                rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
            },
        };
    }

    type RealPortFixture = ReturnType<typeof realPortFixture>;

    /** `gh` flags whose next token is the flag's value, so a value is never read as a subcommand. */
    const GH_VALUE_FLAGS = new Set([
        '-F',
        '-X',
        '-f',
        '--add-label',
        '--add-project',
        '--base',
        '--body',
        '--color',
        '--description',
        '--field',
        '--format',
        '--head',
        '--input',
        '--jq',
        '--json',
        '--limit',
        '--method',
        '--milestone',
        '--owner',
        '--raw-field',
        '--remove-label',
        '--repo',
        '--state',
        '--title',
    ]);

    /**
     * Flags whose value names what the invocation addresses: the fields a read projects, the method
     * and payload a write carries. Those values stay in the key, so a reintroduced read of a
     * different field (`--json comments`) or a write under a different method cannot key onto an
     * invocation the golden set already carries. Every other flag's value is content — a title, a
     * label, a body — and changing one is not a new invocation.
     */
    const GH_ADDRESS_FLAGS = new Set([
        '-F',
        '-X',
        '-f',
        '--field',
        '--input',
        '--jq',
        '--json',
        '--method',
        '--raw-field',
    ]);

    /**
     * A token with its volatile segments — temporary paths, full SHAs, and wholly numeric segments —
     * replaced by stable placeholders. Replacement is segment-wise on `/`, so a path segment
     * (`repos/<owner>/<repo>/issues/12`) or a bare issue number normalizes, while a model token like
     * `kimi-k2.5` survives. Only a segment that is *entirely* numeric is placeholdered: a hyphenated
     * token such as `fix/collab-sync-state-2039` keeps its digits inside a larger segment and passes
     * through unchanged.
     */
    function normalizeGhToken(token: string): string {
        return token
            .replaceAll(/(?:\/private)?\/var\/folders\/\S*|\/tmp\/\S*/gu, '<path>')
            .split('/')
            .map((segment) => {
                if (/^[0-9a-f]{40}$/iu.test(segment)) {
                    return '<sha>';
                }
                return /^\d+$/u.test(segment) ? '<n>' : segment;
            })
            .join('/');
    }

    /**
     * One recorded `gh` invocation as a stable key: its subcommand tokens, and for an `api` call its
     * path with the query string stripped and every volatile segment placeholdered. Flag names stay
     * in the key, and the flags that name what the invocation addresses keep their values too. The
     * golden sets below compare this key, so an invocation no golden set carries — whatever its
     * spelling, subcommand, or endpoint — reddens the shape that recorded it.
     */
    function normalizeGhInvocation(args: string[]): string {
        const parts: string[] = [];
        for (let index = 0; index < args.length;) {
            const token = args[index] ?? '';
            if (!token.startsWith('-')) {
                const [positional] = token.split('?');
                parts.push(normalizeGhToken(positional ?? token));
                index += 1;
                continue;
            }
            const separator = token.indexOf('=');
            const flag = separator === -1 ? token : token.slice(0, separator);
            const inline = separator === -1 ? undefined : token.slice(separator + 1);
            if (GH_ADDRESS_FLAGS.has(flag)) {
                parts.push(`${flag}=${normalizeGhToken(inline ?? args[index + 1] ?? '')}`);
                index += inline === undefined ? 2 : 1;
                continue;
            }
            parts.push(flag);
            index += inline === undefined && GH_VALUE_FLAGS.has(flag) ? 2 : 1;
        }
        return parts.join(' ');
    }

    /** A pull request row the recording `gh` answers for the conforming branch. */
    function conformingRow(
        number: number,
        head: string,
        overrides: Partial<OpenPullRequestRow> = {}
    ): OpenPullRequestRow {
        return {
            number,
            headRefName: REAL_PORT_BRANCH,
            isCrossRepository: false,
            title: DEFAULT_SUBJECT,
            body: composePublishBody(12, DEFAULT_SUBJECT, DEFAULT_SUMMARY, TEST_INSTRUCTIONS),
            baseRefName: 'main',
            headRefOid: head,
            ...overrides,
        };
    }

    /** The off-convention pull request row a legacy publication only pushes beneath. */
    function legacyRow(): OpenPullRequestRow {
        return {
            number: REAL_PORT_LEGACY_NUMBER,
            headRefName: REAL_PORT_LEGACY_BRANCH,
            isCrossRepository: false,
            title: 'fix(collab): keep sync state',
            body: '',
        };
    }

    /** One `--paginate --slurp` page holding the open stack-parent pull request at `parentHead`. */
    function stackParentPages(parentHead: string): Record<string, unknown>[][] {
        return [
            [
                {
                    number: REAL_PORT_STACK_PARENT_NUMBER,
                    state: 'open',
                    merged_at: null,
                    head: { ref: REAL_PORT_STACK_PARENT, sha: parentHead, repo: { full_name: REQUIRED_REPOSITORY } },
                    user: { node_id: AUTHOR_BOT_NODE_ID },
                },
            ],
        ];
    }

    /** Records the child's stack lineage the real `stackBase` member reads from disk. */
    function registerStackChild(fixture: RealPortFixture): void {
        writeLaneStack(fixture.primary, {
            version: 1,
            childBranch: REAL_PORT_BRANCH,
            parentBranch: REAL_PORT_STACK_PARENT,
            forkHead: fixture.baseSha,
            parentHead: fixture.baseSha,
        });
        fixtureGit(fixture.primary, ['config', `branch.${REAL_PORT_BRANCH}.sourdaw-stack-fork`, fixture.baseSha]);
    }

    /** Runs one publication through the real port and hands back every `gh` argv it recorded. */
    function publishThroughRealPort(
        answers: RealPortAnswers,
        prepare: (fixture: RealPortFixture) => void,
        publish: (fixture: RealPortFixture) => number,
        expected: number
    ): string[][] {
        const fixture = realPortFixture(answers);
        try {
            prepare(fixture);
            expect(publish(fixture)).toBe(expected);
            return fixture.recorded();
        } finally {
            fixture.dispose();
        }
    }

    /**
     * The golden allowlist of normalized invocations each real-port shape must record. It is stated
     * per shape rather than derived from a run, so a reintroduced invocation fails the shape instead
     * of being absorbed into its own expectation. Shapes whose publications differ only in values a
     * key drops — a conflicted first publication records exactly what a clean one does — share one
     * list deliberately.
     */
    const CREATE_PUBLICATION_INVOCATIONS = [
        'api repos/jcosta33/sourdaw/issues/<n> --jq={number: .number, isPullRequest: (has("pull_request"))}',
        'issue view <n> --repo --json=labels,milestone',
        'issue view <n> --repo --json=projectItems',
        'label create glm-5.3 --color --description --force',
        'label list --limit --json=name,description',
        'pr create --repo --base --head --title --body',
        'pr edit <n> --repo --add-label',
        'pr list --repo --head --state --json=number,headRefName,isCrossRepository,title,body,baseRefName,headRefOid',
        'pr view <n> --repo --json=labels,milestone',
        'pr view <n> --repo --json=mergeable',
        'project list --owner --format',
    ];

    /**
     * The issueless conforming create. It records no bound-issue read — no `api .../issues/<n>`
     * existence lookup and no `gh issue view` tracker read — because no issue constrains the lane,
     * and no `pr view --json projectItems` because its derived board comes from `gh project list`
     * and the live listing names no such project. The metadata edit carries two `--add-label` flags:
     * the recorded model label plus the type label derived from the lane subject.
     */
    const ISSUELESS_CREATE_INVOCATIONS = [
        'label create glm-5.3 --color --description --force',
        'label list --limit --json=name,description',
        'pr create --repo --base --head --title --body',
        'pr edit <n> --repo --add-label --add-label',
        'pr list --repo --head --state --json=number,headRefName,isCrossRepository,title,body,baseRefName,headRefOid',
        'pr view <n> --repo --json=labels,milestone',
        'pr view <n> --repo --json=mergeable',
        'project list --owner --format',
    ];

    /**
     * The issueless conforming republication. It records the issueless create's reads — no bound-issue
     * existence lookup, no `gh issue view` tracker read, and no `pr view --json projectItems` — with
     * the update path's `pr edit --body` write in place of the create, because the branch already
     * carries an open pull request.
     */
    const ISSUELESS_UPDATE_INVOCATIONS = [
        'label create glm-5.3 --color --description --force',
        'label list --limit --json=name,description',
        'pr edit <n> --repo --add-label --add-label',
        'pr edit <n> --repo --body',
        'pr list --repo --head --state --json=number,headRefName,isCrossRepository,title,body,baseRefName,headRefOid',
        'pr view <n> --repo --json=labels,milestone',
        'pr view <n> --repo --json=mergeable',
        'project list --owner --format',
    ];

    const UPDATE_PUBLICATION_INVOCATIONS = [
        'api repos/jcosta33/sourdaw/issues/<n> --jq={number: .number, isPullRequest: (has("pull_request"))}',
        'issue view <n> --repo --json=labels,milestone',
        'issue view <n> --repo --json=projectItems',
        'label create glm-5.3 --color --description --force',
        'label list --limit --json=name,description',
        'pr edit <n> --repo --add-label',
        'pr edit <n> --repo --body',
        'pr list --repo --head --state --json=number,headRefName,isCrossRepository,title,body,baseRefName,headRefOid',
        'pr view <n> --repo --json=labels,milestone',
        'pr view <n> --repo --json=mergeable',
        'project list --owner --format',
    ];

    const STACK_CREATE_INVOCATIONS = [
        'api --paginate --slurp repos/jcosta33/sourdaw/pulls',
        'api repos/jcosta33/sourdaw/issues/<n> --jq={number: .number, isPullRequest: (has("pull_request"))}',
        'issue view <n> --repo --json=labels,milestone',
        'issue view <n> --repo --json=projectItems',
        'label create glm-5.3 --color --description --force',
        'label list --limit --json=name,description',
        'pr create --repo --base --head --title --body',
        'pr edit <n> --repo --add-label',
        'pr list --repo --head --state --json=number,headRefName,isCrossRepository,title,body,baseRefName,headRefOid',
        'pr view <n> --repo --json=labels,milestone',
        'pr view <n> --repo --json=mergeable',
        'project list --owner --format',
    ];

    const STACK_UPDATE_INVOCATIONS = [
        'api --paginate --slurp repos/jcosta33/sourdaw/pulls',
        'api repos/jcosta33/sourdaw/issues/<n> --jq={number: .number, isPullRequest: (has("pull_request"))}',
        'issue view <n> --repo --json=labels,milestone',
        'issue view <n> --repo --json=projectItems',
        'label create glm-5.3 --color --description --force',
        'label list --limit --json=name,description',
        'pr edit <n> --repo --add-label',
        'pr edit <n> --repo --body',
        'pr list --repo --head --state --json=number,headRefName,isCrossRepository,title,body,baseRefName,headRefOid',
        'pr view <n> --repo --json=labels,milestone',
        'pr view <n> --repo --json=mergeable',
        'project list --owner --format',
    ];

    const INHERITED_BOARD_INVOCATIONS = [
        'api repos/jcosta33/sourdaw/issues/<n> --jq={number: .number, isPullRequest: (has("pull_request"))}',
        'api repos/jcosta33/sourdaw/milestones',
        'issue view <n> --repo --json=labels,milestone',
        'issue view <n> --repo --json=projectItems',
        'label create glm-5.3 --color --description --force',
        'label list --limit --json=name,description',
        'pr edit <n> --repo --add-label --add-label --milestone',
        'pr edit <n> --repo --add-project',
        'pr edit <n> --repo --body',
        'pr list --repo --head --state --json=number,headRefName,isCrossRepository,title,body,baseRefName,headRefOid',
        'pr view <n> --repo --json=labels,milestone',
        'pr view <n> --repo --json=mergeable',
        'pr view <n> --repo --json=projectItems',
        'project list --owner --format',
    ];

    const LEGACY_PUSH_ONLY_INVOCATIONS = [
        'pr list --repo --head --state --json=number,headRefName,isCrossRepository,title,body,baseRefName,headRefOid',
        'pr view <n> --repo --json=mergeable',
    ];

    const LEGACY_METADATA_INVOCATIONS = [
        'label create kimi-k2.5 --color --description --force',
        'label list --limit --json=name,description',
        'pr edit <n> --repo --add-label',
        'pr list --repo --head --state --json=number,headRefName,isCrossRepository,title,body,baseRefName,headRefOid',
        'pr view <n> --repo --json=labels,milestone',
        'pr view <n> --repo --json=mergeable',
    ];

    type RealPortShape = {
        shape: string;
        /** The pull-request write the shape must record, so the observation cannot pass vacuously. */
        createsPullRequest?: boolean;
        editsPullRequest?: number;
        /** The shape must have resolved a real stack parent, not degraded to a plain publication. */
        stackChild?: boolean;
        /**
         * Normalized invocations this shape must record. The golden set is compared as a whole, so
         * this names the writes that prove the shape ran the publication it claims to, rather than a
         * degraded path whose allowlist happened to match.
         */
        mustRecord?: string[];
        /** Every distinct normalized invocation this shape records, alphabetically. */
        invocations: string[];
        drive: () => string[][];
    };

    const REAL_PORT_SHAPES: RealPortShape[] = [
        {
            shape: 'a first publication that creates the pull request',
            createsPullRequest: true,
            invocations: CREATE_PUBLICATION_INVOCATIONS,
            drive: () =>
                publishThroughRealPort(
                    { openPullRequests: [] },
                    (f) => {
                        commitAsAuthorApp(f.lane, 'one.txt', 'feat(gate): first bot commit');
                    },
                    (f) => publishLane(12, f.portFor(f.lane), undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY),
                    88
                ),
        },
        {
            shape: 'an issueless conforming publication that creates the pull request',
            mustRecord: ['pr create --repo --base --head --title --body', 'pr edit <n> --repo --add-label --add-label'],
            invocations: ISSUELESS_CREATE_INVOCATIONS,
            drive: () =>
                publishThroughRealPort(
                    {},
                    (f) => {
                        commitAsAuthorApp(f.cleanupLane, 'cleanup.txt', DEFAULT_SUBJECT);
                    },
                    (f) =>
                        publishLane(undefined, f.portFor(f.cleanupLane), undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY),
                    88
                ),
        },
        {
            shape: 'an issueless republication that updates the pull request',
            editsPullRequest: 41,
            mustRecord: ['pr edit <n> --repo --body', 'pr edit <n> --repo --add-label --add-label'],
            invocations: ISSUELESS_UPDATE_INVOCATIONS,
            drive: () =>
                publishThroughRealPort(
                    {},
                    (f) => {
                        const head = commitAsAuthorApp(f.cleanupLane, 'cleanup.txt', DEFAULT_SUBJECT);
                        fixtureGit(f.primary, ['push', f.remote, `${head}:refs/heads/${REAL_PORT_CLEANUP_BRANCH}`]);
                        f.writeAnswers({
                            openPullRequests: [
                                conformingRow(41, head, {
                                    headRefName: REAL_PORT_CLEANUP_BRANCH,
                                    body: composePublishBody(
                                        undefined,
                                        DEFAULT_SUBJECT,
                                        DEFAULT_SUMMARY,
                                        TEST_INSTRUCTIONS
                                    ),
                                }),
                            ],
                        });
                    },
                    (f) =>
                        publishLane(undefined, f.portFor(f.cleanupLane), undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY),
                    41
                ),
        },
        {
            shape: 'a republication that updates the pull request',
            editsPullRequest: 41,
            invocations: UPDATE_PUBLICATION_INVOCATIONS,
            drive: () =>
                publishThroughRealPort(
                    { openPullRequests: [] },
                    (f) => {
                        const head = commitAsAuthorApp(f.lane, 'one.txt', 'feat(gate): first bot commit');
                        fixtureGit(f.primary, ['push', f.remote, `${head}:refs/heads/${REAL_PORT_BRANCH}`]);
                        f.writeAnswers({ openPullRequests: [conformingRow(41, head)] });
                    },
                    (f) => publishLane(12, f.portFor(f.lane), undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY),
                    41
                ),
        },
        {
            shape: 'a stacked child that creates its pull request',
            createsPullRequest: true,
            stackChild: true,
            invocations: STACK_CREATE_INVOCATIONS,
            drive: () =>
                publishThroughRealPort(
                    {},
                    (f) => {
                        const head = commitAsAuthorApp(f.lane, 'one.txt', 'feat(gate): first bot commit');
                        registerStackChild(f);
                        f.writeAnswers({
                            openPullRequests: [],
                            pullRequestAfterCreate: conformingRow(88, head, { baseRefName: REAL_PORT_STACK_PARENT }),
                            stackParents: stackParentPages(f.baseSha),
                        });
                    },
                    (f) => publishLane(12, f.portFor(f.lane), undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY),
                    88
                ),
        },
        {
            shape: 'a stacked child that updates its pull request',
            editsPullRequest: 41,
            stackChild: true,
            invocations: STACK_UPDATE_INVOCATIONS,
            drive: () =>
                publishThroughRealPort(
                    {},
                    (f) => {
                        const head = commitAsAuthorApp(f.lane, 'one.txt', 'feat(gate): first bot commit');
                        fixtureGit(f.primary, ['push', f.remote, `${head}:refs/heads/${REAL_PORT_BRANCH}`]);
                        registerStackChild(f);
                        f.writeAnswers({
                            openPullRequests: [conformingRow(41, head, { baseRefName: REAL_PORT_STACK_PARENT })],
                            stackParents: stackParentPages(f.baseSha),
                        });
                    },
                    (f) => publishLane(12, f.portFor(f.lane), undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY),
                    41
                ),
        },
        {
            shape: 'a first publication that reports a conflicted head',
            createsPullRequest: true,
            invocations: CREATE_PUBLICATION_INVOCATIONS,
            drive: () =>
                publishThroughRealPort(
                    { openPullRequests: [], mergeable: 'CONFLICTING' },
                    (f) => {
                        commitAsAuthorApp(f.lane, 'base.txt', 'feat(gate): lane rewrites base');
                        writeFileSync(join(f.primary, 'base.txt'), 'main\n');
                        fixtureGit(f.primary, ['add', 'base.txt']);
                        fixtureGit(f.primary, ['commit', '--no-gpg-sign', '-m', 'fix(fixture): main rewrites base']);
                        fixtureGit(f.primary, ['push', f.remote, 'main']);
                    },
                    (f) => publishLane(12, f.portFor(f.lane), undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY),
                    88
                ),
        },
        {
            shape: 'a republication carrying its issue inherited milestone and board',
            editsPullRequest: 41,
            invocations: INHERITED_BOARD_INVOCATIONS,
            drive: () =>
                publishThroughRealPort(
                    {},
                    (f) => {
                        const head = commitAsAuthorApp(f.lane, 'one.txt', 'feat(gate): first bot commit');
                        fixtureGit(f.primary, ['push', f.remote, `${head}:refs/heads/${REAL_PORT_BRANCH}`]);
                        f.writeAnswers({
                            openPullRequests: [conformingRow(41, head)],
                            issueLabels: [{ name: 'bug', description: 'Something is broken' }],
                            issueMilestone: { title: 'v1.2' },
                            openMilestones: [{ title: 'v1.2' }],
                            knownProjects: ['Roadmap'],
                            issueProjectTitles: ['Roadmap'],
                        });
                    },
                    (f) => publishLane(12, f.portFor(f.lane), undefined, TEST_INSTRUCTIONS, DEFAULT_SUMMARY),
                    41
                ),
        },
        {
            shape: 'a legacy pull request that is pushed to only',
            invocations: LEGACY_PUSH_ONLY_INVOCATIONS,
            drive: () =>
                publishThroughRealPort(
                    {},
                    (f) => {
                        const head = commitAsAuthorApp(f.legacyLane, 'legacy.txt', 'fix(collab): keep sync state');
                        fixtureGit(f.primary, ['push', f.remote, `${head}:refs/heads/${REAL_PORT_LEGACY_BRANCH}`]);
                        f.writeAnswers({ openPullRequests: [legacyRow()] });
                    },
                    (f) => publishLane(undefined, f.portFor(f.legacyLane)),
                    REAL_PORT_LEGACY_NUMBER
                ),
        },
        {
            shape: 'a legacy republication that applies metadata under an explicit --model',
            editsPullRequest: REAL_PORT_LEGACY_NUMBER,
            invocations: LEGACY_METADATA_INVOCATIONS,
            drive: () =>
                publishThroughRealPort(
                    {},
                    (f) => {
                        const head = commitAsAuthorApp(f.legacyLane, 'legacy.txt', 'fix(collab): keep sync state');
                        fixtureGit(f.primary, ['push', f.remote, `${head}:refs/heads/${REAL_PORT_LEGACY_BRANCH}`]);
                        f.writeAnswers({ openPullRequests: [legacyRow()] });
                    },
                    (f) =>
                        publishLane(undefined, f.portFor(f.legacyLane), undefined, undefined, undefined, undefined, {
                            model: 'kimi-k2.5',
                        }),
                    REAL_PORT_LEGACY_NUMBER
                ),
        },
    ];

    it.each(REAL_PORT_SHAPES)('records exactly its pinned gh invocation keys: $shape', (shape) => {
        const recorded = shape.drive();

        // A shape that recorded nothing proved nothing; these pin the write that must appear.
        expect(recorded.length).toBeGreaterThan(0);
        if (shape.createsPullRequest === true) {
            expect(recorded.some((args) => args[0] === 'pr' && args[1] === 'create')).toBe(true);
        }
        if (shape.editsPullRequest !== undefined) {
            expect(
                recorded.some(
                    (args) => args[0] === 'pr' && args[1] === 'edit' && args[2] === String(shape.editsPullRequest)
                )
            ).toBe(true);
        }
        if (shape.stackChild === true) {
            // The real `stackBase` resolves the parent through gh; without it the shape would be a
            // plain publication under a stack name and its recorded invocations would prove less.
            expect(recorded.some((args) => args[0] === 'api' && args.includes('--paginate'))).toBe(true);
            if (shape.createsPullRequest === true) {
                const create = recorded.find((args) => args[0] === 'pr' && args[1] === 'create') ?? [];
                const baseIndex = create.indexOf('--base');
                expect(baseIndex).toBeGreaterThanOrEqual(0);
                expect(create[baseIndex + 1]).toBe(REAL_PORT_STACK_PARENT);
            }
        }

        const keys = [...new Set(recorded.map(normalizeGhInvocation))].sort();
        // A shape whose run degraded can still land an allowlist that matches what it recorded;
        // naming the invocations its own path must emit makes that failure land here.
        for (const required of shape.mustRecord ?? []) {
            expect(keys, `required invocation for ${shape.shape}`).toContain(required);
        }

        // Every invocation the unmodified real port actually issued — recorded as the argv it handed
        // `gh`, not as the key above — matches a shape `PERMITTED_GH_INVOCATIONS` enumerates. A
        // legitimate call the enumeration missed would be refused here rather than silently breaking
        // a publication, and a call the golden set does not carry reddens above with the rule's own
        // boundary message because the publication itself refused it.
        for (const args of recorded) {
            expect(() => assertGhCommandAllowed(args), args.join(' ')).not.toThrow();
            expect(matchesPermittedGhInvocation(args), args.join(' ')).toBe(true);
        }

        // The allowlist is the whole observation: any invocation a reintroduction adds — whatever its
        // subcommand, endpoint, or spelling — keys to something this golden set does not carry.
        expect(keys, `gh invocations for ${shape.shape}`).toEqual(shape.invocations);
    });

    /**
     * An allowlist is only as good as its key: if the normalizer collapsed two different invocations,
     * a reintroduced write could ride an existing key past the shape cases. Every pair below differs
     * in subcommand, endpoint, or an identifying flag value and must key apart; the pairs after them
     * differ only in a volatile segment and must key alike.
     */
    it('keys distinct invocations apart and volatile spellings alike', () => {
        const distinct = [
            [
                'pr',
                'create',
                '--repo',
                REQUIRED_REPOSITORY,
                '--base',
                'main',
                '--head',
                'agent/12/x',
                '--title',
                't',
                '--body',
                'b',
            ],
            ['pr', 'edit', '41', '--repo', REQUIRED_REPOSITORY, '--body', 'b'],
            ['pr', 'edit', '41', '--repo', REQUIRED_REPOSITORY, '--add-label', 'glm-5.3'],
            ['pr', 'comment', '41', '--body', 'x'],
            [
                'pr',
                'list',
                '--repo',
                REQUIRED_REPOSITORY,
                '--head',
                'agent/12/x',
                '--state',
                'open',
                '--json',
                'number',
            ],
            ['pr', 'view', '41', '--repo', REQUIRED_REPOSITORY, '--json', 'mergeable'],
            ['issue', 'view', '12', '--repo', REQUIRED_REPOSITORY, '--json', 'labels,milestone'],
            ['issue', 'view', '12', '--repo', REQUIRED_REPOSITORY, '--json', 'comments'],
            ['label', 'create', 'glm-5.3', '--color', '8250df', '--description', 'Authored by glm-5.3', '--force'],
            ['project', 'list', '--owner', 'jcosta33', '--format', 'json'],
            ['api', `repos/${REQUIRED_REPOSITORY}/issues/12`, '--jq', ISSUE_LOOKUP_JQ],
            ['api', `repos/${REQUIRED_REPOSITORY}/issues/12/comments`, '--paginate'],
            ['api', `repos/${REQUIRED_REPOSITORY}/issues/12/comments`, '--method', 'POST', '-f', 'body=x'],
            ['api', `repos/${REQUIRED_REPOSITORY}/pulls?state=all&head=x&per_page=100`, '--paginate', '--slurp'],
            ['api', 'graphql', '-f', 'query=mutation { addComment(input: {subjectId: "x", body: "y"}) { id } }'],
        ];

        const keys = distinct.map(normalizeGhInvocation);

        expect(new Set(keys).size).toBe(distinct.length);
        expect(normalizeGhInvocation(['pr', 'edit', '41', '--repo', REQUIRED_REPOSITORY, '--body', 'a'])).toBe(
            normalizeGhInvocation(['pr', 'edit', '2275', '--repo', REQUIRED_REPOSITORY, '--body', 'b'])
        );
        expect(normalizeGhInvocation(['api', `repos/${REQUIRED_REPOSITORY}/issues/12/comments?per_page=100`])).toBe(
            normalizeGhInvocation(['api', `repos/${REQUIRED_REPOSITORY}/issues/99/comments`])
        );
    });

    /**
     * The golden sets have to distinguish the shapes they pin, or one collapsed list could stand for
     * every publication and the allowlist would stop observing which path ran. The legacy push-only
     * shape is the sharpest contrast: it addresses the pull request without an issue, a model label,
     * or a created pull request at all.
     */
    it('pins golden invocation sets that differ across the shapes', () => {
        expect(new Set(REAL_PORT_SHAPES.map((shape) => shape.invocations.join('\n'))).size).toBeGreaterThan(1);
        expect(LEGACY_PUSH_ONLY_INVOCATIONS).not.toEqual(CREATE_PUBLICATION_INVOCATIONS);
        expect(UPDATE_PUBLICATION_INVOCATIONS).not.toEqual(STACK_UPDATE_INVOCATIONS);
    });

    /**
     * The two shape tables are one obligation split by what each can observe: the golden sets pin
     * member names on the double, the real-port cases compare `gh` invocations against their own
     * golden allowlist. A shape added to only one table would leave the other blind to it, so this
     * fails until both carry the same shapes.
     */
    it('drives every shape the golden sets pin through the real port too', () => {
        expect(REAL_PORT_SHAPES.map((shape) => shape.shape).sort()).toEqual(
            PUBLICATION_SHAPES.map((shape) => shape.shape).sort()
        );
    });

    /**
     * The rule's refusal of the deleted attestation path's write, driven on a real publication path
     * none of the ten shapes reaches. Every shape above publishes with a flagless relationship, so
     * the `--relates` body section — the real, undriven condition — fires only here: gate the
     * refusal on the `--relates` relationship inside any existing member and this is the only case
     * that can observe it. The write is injected into a real documented member's call rather than
     * assembled by the module, so the source pin above stays green while the rule still refuses it.
     * The injection calls `assertGhCommandAllowed` itself, so this case observes the rule and not
     * `shellPort`'s guards; the runner case after it drives the same write through the port so those
     * guards are observed too. On the clean tree the boundary refuses nothing and the publication
     * succeeds; with such a write reintroduced the assembled argv reaches `assertGhCommandAllowed`,
     * the publication fails with `PUBLICATION_COMMAND_RULE`, and this case reddens carrying that
     * message. Restoring the tree byte-identically returns it to green.
     */
    it('publishes the undriven --relates path and refuses an issue-comment write injected there', () => {
        const recorded = publishThroughRealPort(
            { openPullRequests: [] },
            (fixture) => {
                commitAsAuthorApp(fixture.lane, 'one.txt', 'feat(gate): first bot commit');
            },
            (fixture) => publishLane(12, fixture.portFor(fixture.lane), 'relates', TEST_INSTRUCTIONS, DEFAULT_SUMMARY),
            88
        );

        // The undriven condition really ran: the created body carries the relates section rather
        // than the closes one every shape writes.
        const create = recorded.find((args) => args[0] === 'pr' && args[1] === 'create') ?? [];
        expect(create[create.indexOf('--body') + 1]).toContain('Related #12');

        // The invocation set is the create path's whole golden set, and the default-deny rule
        // permits every one of them.
        const keys = [...new Set(recorded.map(normalizeGhInvocation))].sort();
        expect(keys).toEqual(CREATE_PUBLICATION_INVOCATIONS);
        for (const args of recorded) {
            expect(() => assertGhCommandAllowed(args), args.join(' ')).not.toThrow();
        }

        // The same real port, with one already-observed read replaced by a comment write carrying
        // the `--relates` condition: the write is refused by the rule, not by the source pin.
        const fixture = realPortFixture({ openPullRequests: [] });
        try {
            commitAsAuthorApp(fixture.lane, 'one.txt', 'feat(gate): first bot commit');
            const port = fixture.portFor(fixture.lane);
            port.existingOpenPullRequest = () => {
                assertGhCommandAllowed([
                    'api',
                    '--method',
                    'POST',
                    `repos/${REQUIRED_REPOSITORY}/issues/12/comments`,
                    '-f',
                    'body=related',
                ]);
                return undefined;
            };
            const thrown = (() => {
                try {
                    publishLane(12, port, 'relates', TEST_INSTRUCTIONS, DEFAULT_SUMMARY);
                    return undefined;
                } catch (error) {
                    return error;
                }
            })();
            expect(thrown, 'the injected write must be refused before gh spawns').toBeInstanceOf(Error);
            expect((thrown as Error).message).toContain(PUBLICATION_COMMAND_RULE);
        } finally {
            fixture.dispose();
        }
    });

    /**
     * The boundary's wiring, driven on the port's own runners. The case above proves the rule refuses
     * a comment write, but the injection calls the exported `assertGhCommandAllowed` itself: delete
     * the five calls that guard `shellPort`'s spawns and it stays green, which is exactly the escape
     * a review round observed. Here a documented port member is replaced by one that drives each
     * runner the port exposes with the deleted attestation path's write, on a real publication path,
     * so the argv reaches the closure the five calls live in. `PERMITTED_GH_INVOCATIONS` carries no
     * `api` write, so the runner must refuse it with `PUBLICATION_COMMAND_RULE` before spawning, and
     * the recording `gh` log proves no spawn followed. With a guard deleted the write spawns instead,
     * the publication no longer fails with the rule, and the case reddens; restoring the guard
     * returns it to green.
     */
    it.each(['gh', 'ghRun'] as const)(
        "refuses an unpermitted argv driven through the port's own %s runner before spawning",
        (runner) => {
            const commentWrite = [
                'api',
                '--method',
                'POST',
                `repos/${REQUIRED_REPOSITORY}/issues/12/comments`,
                '-f',
                'body=related',
            ];
            const fixture = realPortFixture({ openPullRequests: [] });
            try {
                commitAsAuthorApp(fixture.lane, 'one.txt', 'feat(gate): first bot commit');
                const port = fixture.portFor(fixture.lane);
                const spawn = port[runner];
                // The port's own runner is captured before the member is replaced, so the override
                // spawns through `shellPort`'s closure rather than around it. The argv is assembled
                // here rather than by the module, so the source pin stays green while the boundary
                // still has to refuse it.
                port.existingOpenPullRequest = () => {
                    spawn(commentWrite);
                    return undefined;
                };
                const thrown = (() => {
                    try {
                        publishLane(12, port, 'relates', TEST_INSTRUCTIONS, DEFAULT_SUMMARY);
                        return undefined;
                    } catch (error) {
                        return error;
                    }
                })();
                const message = thrown instanceof Error ? thrown.message : `not an Error: ${String(thrown)}`;
                expect(
                    message,
                    `the port's own ${runner} runner must refuse the write with the rule's message`
                ).toContain(PUBLICATION_COMMAND_RULE);
                expect(thrown, `the port's own ${runner} runner must refuse the write`).toBeInstanceOf(Error);
                expect(
                    fixture.recorded().filter((args) => args.includes('--method')),
                    `the refused write must never reach ${runner}`
                ).toEqual([]);
            } finally {
                fixture.dispose();
            }
        }
    );
});
